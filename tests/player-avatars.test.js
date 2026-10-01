const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const jpeg=(padding=0)=>'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,...new Array(padding).fill(0),255,217]).toString('base64');

test('avatar storage is self-service, bounded and readable only within approved club memberships',async()=>{
 const db=new PGlite();
 const [owner,member,outsider]=[1,2,3].map(n=>`00000000-0000-0000-0000-00000000000${n}`);
 async function as(actor,sql,params=[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec('set role authenticated');
  try{return (await db.query(sql,params)).rows[0]?.result;}finally{await db.exec('reset role');}
 }
 const rpc=(actor,action,args={})=>as(actor,'select poker_club_action($1,$2) result',[action,JSON.stringify(args)]);
 const avatar=(actor,action,photo=null,thumbnail=null)=>as(actor,'select poker_account_avatar($1,$2,$3) result',[action,photo,thumbnail]);
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table texasholdem_user_states(user_id uuid primary key,payload jsonb);`);
  for(const [i,id] of [owner,member,outsider].entries())await db.query('insert into auth.users(id,email) values($1,$2)',[id,`user${i}@test.com`]);
  for(const name of ['20260913_clubs.sql','20260913_club_auto_players.sql','20260913_club_only.sql','20260913_club_display_names.sql','20260913_history_access.sql','20260913_account_username.sql','20260913_player_details.sql','20260913_leave_club.sql','20261001_player_avatars.sql'])await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
  const {id:club}=await rpc(owner,'create',{name:'Photos'});
  const {id:other}=await rpc(outsider,'create',{name:'Other'});
  const photo=jpeg(128),thumbnail=jpeg(24);
  assert.deepEqual(await avatar(member,'get'),{});
  const saved=await avatar(member,'set',photo,thumbnail);
  assert.equal(saved.photo,photo);assert.equal(saved.thumbnail,thumbnail);
  assert.deepEqual(await avatar(owner,'get'),{},'Uploading cannot overwrite another account');
  await rpc(member,'join',{club_id:club});
  const list=()=>as(owner,'select poker_club_avatars($1) result',[club]);
  assert.deepEqual(await list(),[],'Pending members have no leaderboard photo');
  await assert.rejects(as(member,'select poker_club_avatars($1) result',[club]),/approval/);
  await rpc(owner,'review',{club_id:club,user_id:member,status:'approved'});
  assert.equal((await list())[0].thumbnail,thumbnail);
  assert.equal((await list())[0].photo,undefined,'Leaderboard batches exclude full images');
  let name=(await list())[0].player_name;
  assert.equal((await as(owner,'select poker_player_avatar($1,$2) result',[club,name])).photo,photo);
  assert.deepEqual(await as(owner,'select poker_player_avatar($1,$2) result',[club,'Unlinked historical player']),{});
  await as(member,"select poker_account_profile('set','Renamed') result");
  assert.equal((await list())[0].player_name,'Renamed');
  assert.deepEqual(await as(owner,'select poker_player_avatar($1,$2) result',[club,name]),{});
  assert.equal((await as(member,'select poker_player_avatar($1,$2) result',[club,'Renamed'])).photo,photo);
  assert.deepEqual(await as(outsider,'select poker_club_avatars($1) result',[other]),[]);
  for(const actor of [outsider,null]) {
   await assert.rejects(as(actor,'select poker_club_avatars($1) result',[club]),/approval/);
   await assert.rejects(as(actor,'select poker_player_avatar($1,$2) result',[club,'Renamed']),/approval/);
  }
  for(const invalid of [null,'https://example.test/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,YmFk',jpeg(262144)]) {
   await assert.rejects(avatar(member,'set',invalid,thumbnail));
   assert.equal((await avatar(member,'get')).photo,photo,'Rejected uploads retain the previous photo');
  }
  await assert.rejects(avatar(member,'set',photo,jpeg(24576)));
  await assert.rejects(avatar(null,'set',photo,thumbnail),/sign in/);
  await assert.rejects(as(owner,'select * from poker_account_avatars'),/permission/);
  await rpc(owner,'review',{club_id:club,user_id:member,status:'rejected'});
  assert.deepEqual(await list(),[]);
  await assert.rejects(as(member,'select poker_club_avatars($1) result',[club]),/approval/);
  assert.deepEqual(await as(owner,'select poker_player_avatar($1,$2) result',[club,'Renamed']),{});
  assert.equal((await avatar(member,'get')).photo,photo,'Membership removal does not delete the account photo');
  await avatar(member,'remove');assert.deepEqual(await avatar(member,'get'),{});
  await db.exec('set role anon');
  await assert.rejects(db.query('select poker_account_avatar()'),/permission/);
  await db.exec('reset role');
 }finally{await db.close();}
});

function client() {
 const elements=new Map();let user={id:'owner'};
 const context=vm.createContext({console,Date,navigator:{onLine:true},getRemoteUser:()=>user,
  clubState:{active:{id:'club-a',status:'approved'}},remoteState:{client:{rpc:async()=>({data:{}})}},
  escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},renderAuthPanel(){},safeToast(){}});
 vm.runInContext(fs.readFileSync('assets/js/02-avatars.js','utf8'),context);
 return {context,elements,run:source=>vm.runInContext(source,context),setUser:value=>{user=value;}};
}
test('avatar rendering rejects URLs and markup, falls back to initials, and isolates cached photos by club/account',()=>{
 const a=client();a.context.photo=jpeg(12);
 assert.equal(a.run('validAvatarImage(photo)'),true);
 for(const value of ['https://example.com/image','javascript:alert(1)','data:image/svg+xml;base64,aaaa']) {
  a.context.bad=value;assert.equal(a.run('validAvatarImage(bad)'),false);
 }
 a.run(`clubAvatars={scope:'owner:club-a',photos:new Map([['Alice',photo]])}`);
 assert.match(a.run("renderPlayerAvatar('Alice')"),/<img/);
 assert.doesNotMatch(a.run("renderPlayerAvatar('<script>')"),/<script>/);
 a.run("clubState.active.id='club-b'");assert.doesNotMatch(a.run("renderPlayerAvatar('Alice')"),/<img/);
 a.run("clubState.active.id='club-a'");a.setUser({id:'other'});assert.doesNotMatch(a.run("renderPlayerAvatar('Alice')"),/<img/);
});
test('late avatar responses cannot cross an account or club switch',async()=>{
 const a=client();let finish;
 a.context.remoteState.client.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=a.run('loadClubAvatars()');
 a.run("clubState.active.id='club-b'");finish({data:[{player_name:'Alice',thumbnail:jpeg()}]});await pending;
 assert.equal(a.run("playerAvatarPhoto('Alice')"),'');
 a.run("accountAvatar={actor:'owner',loaded:false,loading:false,busy:false,photo:'',thumbnail:''}");
 const own=a.run('loadAccountAvatar()');a.setUser({id:'other'});
 finish({data:{photo:jpeg(),thumbnail:jpeg()}});await own;
 assert.equal(a.run('currentAccountPhoto()'),'');
});
test('invalid or failed uploads retain the previous photo and never send invalid data',async()=>{
 const a=client();let calls=0;a.context.photo=jpeg();
 a.run("accountAvatar={actor:'owner',loaded:true,loading:false,busy:false,photo,thumbnail:photo,error:''}");
 a.context.remoteState.client.rpc=async()=>{calls++;return {error:{message:'offline'}};};
 a.context.file={type:'image/svg+xml',size:100};await a.run('saveAccountAvatar(file)');
 assert.equal(calls,0);assert.equal(a.run('accountAvatar.photo'),jpeg());assert.match(a.run('accountAvatar.error'),/JPG/);
 await a.run('saveAccountAvatar(null)');assert.equal(calls,1);assert.equal(a.run('accountAvatar.photo'),jpeg());
 assert.match(a.run('accountAvatar.error'),/Could not save/);assert.equal(a.run('accountAvatar.busy'),false);
 a.context.file={type:'image/jpeg',size:11*1024*1024};assert.match(a.run('avatarUploadError(file)'),/10 MB/);
});
test('zoom controls clamp to 100–400%, enlarge the actual image, and reset',()=>{
 const a=client();
 const viewport={clientWidth:300,clientHeight:300,scrollLeft:0,scrollTop:0};
 const stage={style:{},get clientWidth(){return parseFloat(this.style.width)||300;},get clientHeight(){return parseFloat(this.style.height)||300;}};
 a.elements.set('avatar-zoom-viewport',viewport);a.elements.set('avatar-zoom-stage',stage);
 for(const id of ['avatar-viewer-image','avatar-zoom-range','avatar-zoom-value','avatar-zoom-out','avatar-zoom-in'])a.elements.set(id,{style:{}});
 a.run('avatarViewer.baseWidth=300;avatarViewer.baseHeight=200;setAvatarZoom(2)');
 assert.equal(a.elements.get('avatar-viewer-image').style.width,'600px');assert.equal(a.elements.get('avatar-zoom-value').textContent,'200%');
 a.run('setAvatarZoom(9)');assert.equal(a.run('avatarViewer.scale'),4);assert.equal(a.elements.get('avatar-zoom-in').disabled,true);
 a.run('setAvatarZoom(-1)');assert.equal(a.run('avatarViewer.scale'),1);assert.equal(a.elements.get('avatar-zoom-out').disabled,true);assert.equal(viewport.scrollLeft,0);
});
