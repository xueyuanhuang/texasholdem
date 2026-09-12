const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('only the creator can delete a club, with exact name and current revision',async()=>{
 const db=new PGlite();
 const owner='00000000-0000-0000-0000-000000000001',member='00000000-0000-0000-0000-000000000002';
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table texasholdem_user_states(user_id uuid primary key,payload jsonb);
   alter default privileges grant execute on functions to anon;`);
  await db.query('insert into auth.users values($1,$2),($3,$4)',[owner,'owner@test',member,'member@test']);
  await db.query('insert into texasholdem_user_states values($1,$2)',[owner,JSON.stringify({players:['Alice'],cashGames:[{id:1}],tournaments:[]})]);
  for(const file of ['20260913_clubs.sql','20260913_delete_club.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  async function rpc(actor,action,args={}){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
   return (await db.query('select poker_club_action($1,$2) result',[action,JSON.stringify(args)])).rows[0].result;
  }
  const {id}=await rpc(owner,'create',{name:'Delete test'});
  const other=await rpc(owner,'create',{name:'Keep this club'});
  await rpc(member,'join',{club_id:id});await rpc(owner,'review',{club_id:id,user_id:member,status:'approved'});
  await rpc(owner,'grant',{club_id:id,user_id:member,allowed:true});
  async function remove(actor,name,revision){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
   await db.exec('set role authenticated');
   try{return await db.query('select poker_delete_club($1,$2,$3)',[id,name,revision]);}finally{await db.exec('reset role');}
  }
  await assert.rejects(remove('','Delete test',1),/sign in/);
  await assert.rejects(remove(member,'Delete test',1),/creator/);
  await assert.rejects(remove(owner,'wrong',1),/exact club name/);
  await assert.rejects(remove(owner,'Delete test',0),/records changed/);
  assert.equal((await db.query("select has_function_privilege('anon','poker_delete_club(uuid,text,bigint)','execute') allowed")).rows[0].allowed,false);
  await remove(owner,'Delete test',1);
  assert.equal((await db.query('select count(*)::int n from poker_club_members where club_id=$1',[id])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from poker_clubs where id=$1',[id])).rows[0].n,0);
  assert.equal((await rpc(owner,'read',{club_id:other.id})).payload.cashGames.length,1);
  assert.equal((await db.query('select count(*)::int n from texasholdem_user_states')).rows[0].n,1);
 }finally{await db.close();}
});
