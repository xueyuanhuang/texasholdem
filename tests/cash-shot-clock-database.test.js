const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

const migrations=['20260913_clubs.sql','20260913_club_auto_players.sql','20260913_club_only.sql','20260913_delete_club.sql','20260913_club_display_names.sql','20260913_history_access.sql','20260913_account_username.sql','20260913_player_details.sql','20260913_merge_linked_players.sql','20260913_link_activity_fix.sql','20260913_legacy_profile_names.sql','20260913_leave_club.sql','20260913_own_games.sql','20260913_permission_stability.sql','20261001_join_request_history.sql','20261001_player_avatars.sql'];

test('cash countdowns enforce participant rights, independent versions, idempotency and stable match identities',async()=>{
 const db=new PGlite();
 const [owner,alice,bob,organizer,spectator,pending,outsider]=Array.from({length:7},(_,n)=>`00000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`);
 const apply=name=>db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
 async function as(actor,sql,params=[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec('set role authenticated');
  try{return (await db.query(sql,params)).rows[0]?.result;}finally{await db.exec('reset role');}
 }
 const clubRpc=(actor,action,args={})=>as(actor,'select poker_club_action($1,$2) result',[action,JSON.stringify(args)]);
 let cid;
 const timer=(actor,action,args={})=>as(actor,'select poker_cash_timer($1,$2) result',[action,JSON.stringify({club_id:cid,...args})]);
 const read=async(actor=owner,ids=['active'])=>(await timer(actor,'read',{game_ids:ids})).games;
 const start=(actor,name,version,duration=30,command_id=randomUUID(),game_id='active')=>timer(actor,'start',{game_id,player_name:name,duration,expected_version:version,command_id});
 const stop=(actor,version,command_id=randomUUID(),game_id='active')=>timer(actor,'stop',{game_id,expected_version:version,command_id});
 const snapshot=()=>clubRpc(owner,'read',{club_id:cid});
 async function edit(change){const state=await snapshot();change(state.payload);return clubRpc(owner,'save',{club_id:cid,revision:state.revision,payload:state.payload});}
 const count=(state,name)=>state.players.find(p=>p.name===name)?.count;
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table texasholdem_user_states(user_id uuid primary key,payload jsonb);
   alter default privileges grant execute on functions to anon;`);
  for(const [i,id] of [owner,alice,bob,organizer,spectator,pending,outsider].entries()) await db.query('insert into auth.users(id,email) values($1,$2)',[id,`user${i}@test.com`]);
  for(const name of migrations)await apply(name);
  for(const [actor,name] of [[owner,'Owner'],[alice,'Alice'],[bob,'Bob'],[organizer,'Organizer'],[spectator,'Spectator']])await as(actor,"select poker_account_profile('set',$1) result",[name]);
  cid=(await clubRpc(owner,'create',{name:'Countdowns'})).id;
  for(const member of [alice,bob,organizer,spectator,pending]) {
   await clubRpc(member,'join',{club_id:cid});
   if(member!==pending)await clubRpc(owner,'review',{club_id:cid,user_id:member,status:'approved'});
  }
  await as(owner,'select poker_grant_history($1,$2,true) result',[cid,organizer]);
  await clubRpc(owner,'grant',{club_id:cid,user_id:organizer,allowed:true});
  await as(owner,'select poker_grant_history($1,$2,true) result',[cid,spectator]);
  await edit(p=>{p.players.push('Guest');p.cashGames=[
   {id:'active',status:'active',players:[{name:'Alice',buyins:[100],finalChips:0},{name:'Bob',buyins:[100],finalChips:0},{name:'Guest',buyins:[100],finalChips:0}]},
   {id:'other',status:'active',players:[{name:'Bob',buyins:[100]}]},
   {id:'legacy',status:'completed',players:[{name:'Alice',profit:50},{name:'Bob',profit:-50}]}
  ];});
  const before=await snapshot();await apply('20261001_cash_shot_clock.sql');
  const after=await snapshot();assert.equal(after.revision,before.revision,'Backfill leaves financial revision unchanged');
  const scrub=p=>({...p,cashGames:p.cashGames.map(g=>({...g,players:g.players.map(({timerPlayerId,...player})=>player)}))});
  assert.deepEqual(scrub(after.payload),before.payload,'Backfill only adds stable player IDs');
  assert.equal(after.payload.cashGames[2].players[0].timerPlayerId,undefined,'Old finished matches do not gain invented timing records');
  assert.ok(after.payload.cashGames[0].players.every(p=>/^[a-f\d-]{36}$/.test(p.timerPlayerId)));
  const aliceId=after.payload.cashGames[0].players[0].timerPlayerId;
  assert.deepEqual((await read(alice,['active','other','legacy'])).map(g=>g.game_id),['active','legacy']);
  assert.equal((await read(spectator))[0].can_control,false,'Full history is not countdown control');
  assert.equal((await read(alice))[0].can_control,true);
  assert.equal((await read(organizer))[0].can_control,true,'Nonparticipant organizer can control');
  assert.deepEqual((await read(owner,['legacy']))[0],{game_id:'legacy',tracked:false,active:false,can_control:false,version:0,timer:null,players:[]});
  for(const actor of [pending,outsider,null])await assert.rejects(read(actor),/approval|sign in/);
  await assert.rejects(start(spectator,'Alice',0),/participants/);
  await assert.rejects(start(alice,'Bob',0,30,randomUUID(),'other'),/participants/);
  await assert.rejects(start(alice,'Missing',0),/currently/);
  await assert.rejects(start(alice,'Bob',0,45),/30 or 60/);
  await assert.rejects(start(alice,'Alice',0,30,randomUUID(),'legacy'),/tracking|finished/);
  await assert.rejects(clubRpc(alice,'save',{club_id:cid,revision:after.revision,payload:after.payload}),/History access|授权/,'Countdown permission never permits chip edits');

  const cmd=randomUUID();const accepted=await start(alice,'Guest',0,30,cmd);let game=accepted.games[0];
  assert.equal(game.version,1);assert.equal(game.timer.id,cmd);assert.equal(game.timer.status,'running');assert.equal(game.timer.duration,30);
  assert.equal(game.timer.started_by,alice);assert.equal(count(game,'Guest'),1);
  assert.equal(Date.parse(game.timer.ends_at)-Date.parse(game.timer.started_at),30000);
  assert.ok(Math.abs(Date.parse(accepted.server_now)-Date.parse(game.timer.started_at))<100);
  assert.deepEqual(await snapshot(),after,'Clock starts do not change financial snapshots or revision');
  assert.equal((await start(alice,'Guest',0,30,cmd)).games[0].version,1,'Lost-response retry starts once');
  await assert.rejects(start(bob,'Guest',0,30,cmd),/already used/);
  await assert.rejects(start(alice,'Guest',0,60,cmd),/already used/);
  const collision=await start(bob,'Bob',0);assert.equal(collision.conflict,true);assert.equal(collision.games[0].version,1);assert.equal(count(collision.games[0],'Bob'),0);
  assert.equal((await start(bob,'Bob',1)).conflict,true,'An up-to-date version cannot replace a running clock');
  assert.equal((await stop(bob,0)).conflict,true,'A stale stop cannot stop a newer clock');
  const stopCmd=randomUUID();game=(await stop(bob,1,stopCmd)).games[0];assert.equal(game.timer.status,'stopped');assert.equal(game.version,2);assert.equal(count(game,'Guest'),1);
  assert.equal((await stop(bob,1,stopCmd)).games[0].version,2,'Stop retry is idempotent');
  assert.equal((await start(owner,'Alice',2,60)).games[0].timer.duration,60,'Owner controls without being seated');
  game=(await stop(organizer,3)).games[0];assert.equal(game.version,4);assert.equal(count(game,'Alice'),1);
  // Competing requests made against exactly the same observed version accept one.
  const first=await start(alice,'Alice',4);const second=await start(bob,'Bob',4);
  assert.equal(first.games[0].version,5);assert.equal(second.conflict,true);assert.equal(count(second.games[0],'Alice'),2);assert.equal(count(second.games[0],'Bob'),0);
  await db.query("update poker_cash_timer_attempts set ends_at=clock_timestamp()-interval '1 second' where club_id=$1 and id=$2",[cid,first.games[0].timer.id]);
  game=(await read(bob))[0];assert.equal(game.timer.status,'expired');assert.equal(game.version,5);
  assert.equal((await read(alice))[0].version,5,'Expiry polling performs no writes');
  game=(await start(bob,'Bob',5)).games[0];assert.equal(game.version,6);assert.equal(count(game,'Bob'),1);
  await stop(alice,6);

  await as(alice,"select poker_account_profile('set','Alicia') result");
  game=(await read(alice))[0];assert.equal(count(game,'Alicia'),2);assert.equal(game.players.find(p=>p.name==='Alicia').player_id,aliceId);
  assert.equal(count(game,'Alice'),undefined);
  await clubRpc(owner,'bind',{club_id:cid,user_id:spectator,player_name:'Guest'});
  game=(await read(spectator))[0];assert.equal(game.can_control,true);assert.equal(count(game,'Spectator'),1,'Linking a guest retains accepted-start count');
  assert.equal(count(game,'Guest'),undefined);
  await start(alice,'Spectator',7);await clubRpc(owner,'review',{club_id:cid,user_id:spectator,status:'rejected'});
  await assert.rejects(read(spectator),/approval/);await assert.rejects(stop(spectator,8),/approval/);
  assert.equal(count((await read(owner))[0],'Spectator'),2,'Membership removal retains historical attribution');
  await stop(owner,8);
  const stable=(await snapshot()).payload.cashGames[0].players.map(p=>p.timerPlayerId);
  await edit(p=>p.cashGames[0].players.forEach(player=>{delete player.timerPlayerId;player.buyins.push(10);}));
  assert.deepEqual((await snapshot()).payload.cashGames[0].players.map(p=>p.timerPlayerId),stable,'Old clients that omit IDs retain exact-name matches');
  assert.equal(count((await read())[0],'Alicia'),2);
  // An accidentally copied ID must never combine two players' counters.
  await edit(p=>{p.cashGames[0].players[1].timerPlayerId=p.cashGames[0].players[0].timerPlayerId;});
  const canonical=(await snapshot()).payload.cashGames[0].players;
  assert.equal(new Set(canonical.map(p=>p.timerPlayerId)).size,canonical.length);
  assert.deepEqual(canonical.map(p=>p.timerPlayerId),stable,'Duplicate IDs fall back to each existing exact-name identity');
  await edit(p=>{p.cashGames[0].players.find(player=>player.name==='Spectator').name='Returning guest';});
  assert.equal(count((await read())[0],'Returning guest'),2,'A guest rename retains its known identity');
  const returningGuest=(await snapshot()).payload.cashGames[0].players.find(p=>p.name==='Returning guest');
  await edit(p=>{p.cashGames[0].players=p.cashGames[0].players.filter(player=>player.name!=='Returning guest');});
  assert.equal(count((await read())[0],'Returning guest'),undefined,'Removed rows are not selectable or counted against another current player');
  await edit(p=>{const {timerPlayerId,...guest}=returningGuest;p.cashGames[0].players.push(guest);});
  game=(await read())[0];assert.equal(count(game,'Returning guest'),2,'Removing and re-adding a guest preserves match usage');
  assert.equal(game.players.filter(p=>p.name==='Returning guest').length,1);
  assert.equal(game.players.find(p=>p.name==='Returning guest').player_id,returningGuest.timerPlayerId);
  await assert.rejects(edit(p=>p.cashGames.push({...p.cashGames[0]})),/unique IDs/);
  await start(bob,'Bob',9);
  await edit(p=>p.cashGames[0].players=p.cashGames[0].players.filter(player=>player.name!=='Bob'));
  game=(await read())[0];assert.equal(game.timer.status,'stopped');assert.equal(game.version,11);assert.equal(count(game,'Bob'),undefined,'Removed targets are omitted from current-player counts');
  assert.equal((await db.query("select count(*)::int n from poker_cash_timer_attempts a join poker_cash_timer_players p using(club_id,game_id,player_id) where a.club_id=$1 and a.game_id='active' and p.name='Bob'",[cid])).rows[0].n,2,'Removed target attempts remain in historical storage');
  await assert.rejects(start(bob,'Alicia',11),/participants/,'Removed participants immediately lose control');
  await start(alice,'Alicia',11);
  await edit(p=>p.cashGames[0].status='completed');
  game=(await read(alice))[0];assert.equal(game.timer.status,'stopped');assert.equal(game.active,false);assert.equal(game.can_control,false);assert.equal(game.version,13);
  assert.equal(count(game,'Alicia'),3);assert.equal(count(game,'Bob'),undefined);assert.equal(count(game,'Returning guest'),2);
  await assert.rejects(start(owner,'Alicia',13),/finished/);
  await assert.rejects(stop(alice,13),/finished/);
  await edit(p=>p.cashGames=p.cashGames.filter(g=>g.id!=='active'));
  assert.deepEqual(await read(),[]);
  for(const table of ['games','players','attempts','commands']) {
   assert.equal((await db.query(`select count(*)::int n from poker_cash_timer_${table} where club_id=$1 and game_id='active'`,[cid])).rows[0].n,0,'Deleting game removes associated state');
   await assert.rejects(as(owner,`select * from poker_cash_timer_${table}`),/permission/);
  }
  for(const signature of ['poker_cash_timer(text,jsonb)','poker_cash_timer_state(uuid,jsonb,boolean,timestamp with time zone)','poker_cash_timer_normalize()','poker_cash_timer_sync()'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',['anon',signature,'execute'])).rows[0].allowed,false);
  await assert.rejects(as(owner,"select poker_cash_timer_state($1,'{}',true,now()) result",[cid]),/permission/);
 }finally{await db.close();}
});
