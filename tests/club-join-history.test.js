const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');

test('join history preserves removed, approved rejoin and withdrawn requests with owner-only access', async () => {
  const db=new PGlite();
  const [owner,member,legacy,otherOwner]=[1,2,3,4].map(n=>`00000000-0000-0000-0000-00000000000${n}`);
  const migration=async name=>db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
  async function as(actor,sql,params=[]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
    await db.exec('set role authenticated');
    try { return (await db.query(sql,params)).rows[0]?.result; }
    finally { await db.exec('reset role'); }
  }
  const rpc=(actor,action,args={})=>as(actor,'select poker_club_action($1,$2) result',[action,JSON.stringify(args)]);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table texasholdem_user_states(user_id uuid primary key,payload jsonb);`);
    for (const [i,id] of [owner,member,legacy,otherOwner].entries()) await db.query('insert into auth.users(id,email) values($1,$2)',[id,`user${i}@test.com`]);
    for (const name of ['20260913_clubs.sql','20260913_club_auto_players.sql','20260913_club_only.sql','20260913_delete_club.sql','20260913_club_display_names.sql','20260913_history_access.sql','20260913_account_username.sql','20260913_player_details.sql','20260913_merge_linked_players.sql','20260913_link_activity_fix.sql','20260913_legacy_profile_names.sql','20260913_leave_club.sql','20260913_own_games.sql']) await migration(name);
    const {id:club_id}=await rpc(owner,'create',{name:'History club'});
    await rpc(legacy,'join',{club_id});
    await rpc(owner,'review',{club_id,user_id:legacy,status:'approved'});
    await migration('20260913_permission_stability.sql');
    await migration('20261001_join_request_history.sql');
    const requests=()=>rpc(owner,'join_requests',{club_id});
    const history=async()=> (await requests()).find(m=>m.user_id===member);
    assert.deepEqual((await requests()).map(m=>m.user_id),[legacy]);
    assert.deepEqual((await requests())[0].membership_events,[],'No invented dates for legacy memberships');

    await as(member,'select poker_join_club($1) result',[club_id]);
    await as(member,'select poker_join_club($1) result',[club_id]);
    assert.equal((await history()).status,'pending');
    assert.equal((await history()).membership_events.length,1,'Repeated pending submission is one request');
    await assert.rejects(rpc(member,'join_requests',{club_id}));
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    const playerName=(await history()).player_name;
    await as(owner,'select poker_grant_history($1,$2,true) result',[club_id,member]);
    await rpc(owner,'grant',{club_id,user_id:member,allowed:true});
    await assert.rejects(rpc(member,'join_requests',{club_id}),/管理员/,'Even organizers cannot read join history');
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    assert.equal((await history()).membership_events.length,2,'No duplicate approvals or permission-only events');
    assert.equal((await history()).can_manage_games,true);

    await rpc(owner,'review',{club_id,user_id:member,status:'rejected'});
    const removed=await history();
    assert.equal(removed.status,'rejected');assert.equal(removed.player_name,null);
    assert.equal(removed.can_manage_games,false);assert.equal(removed.can_view_history,false);
    await assert.rejects(rpc(member,'read',{club_id}));
    const club=await rpc(owner,'read',{club_id});
    club.payload.players=club.payload.players.filter(p=>p!==playerName);
    await rpc(owner,'save',{club_id,revision:club.revision,payload:club.payload});
    assert.equal((await history()).user_id,member,'Deleting the linked roster player keeps the account history');
    await as(member,'select poker_join_club($1) result',[club_id]);
    assert.equal((await history()).status,'pending');
    assert.equal((await history()).membership_events.length,4);
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    const rejoined=await history();
    assert.equal(rejoined.status,'approved');assert.equal(rejoined.player_name,playerName);
    assert.equal(rejoined.can_manage_games,false);assert.equal(rejoined.can_view_history,false);
    assert.deepEqual(rejoined.membership_events.map(e=>e.status),['approved','pending','rejected','approved','pending']);
    assert.equal(rejoined.membership_events[1].previous_status,'rejected');
    assert.ok(rejoined.membership_events.every(e=>Number.isFinite(Date.parse(e.happened_at))));
    assert.equal((await requests())[0].user_id,member,'Most recently changed account appears first');

    await as(member,'select poker_leave_club($1) result',[club_id]);
    assert.equal((await history()).status,'left');
    assert.ok(!(await rpc(owner,'members',{club_id})).some(m=>m.user_id===member),'Player-management response remains unchanged');
    assert.ok(!(await rpc(member,'list')).some(c=>c.id===club_id));
    await as(member,'select poker_join_club($1) result',[club_id]);
    await rpc(owner,'review',{club_id,user_id:member,status:'rejected'});
    assert.equal((await history()).membership_events[0].previous_status,'pending','Declined requests can be distinguished from removal');
    await as(member,'select poker_join_club($1) result',[club_id]);
    await as(member,'select poker_leave_club($1) result',[club_id]);
    assert.equal((await history()).membership_events[0].previous_status,'pending','Withdrawn requests can be distinguished from leaving');

    const other=await rpc(otherOwner,'create',{name:'Other club'});
    await as(member,'select poker_join_club($1) result',[other.id]);
    const otherRequests=await rpc(otherOwner,'join_requests',{club_id:other.id});
    assert.equal(otherRequests.length,1);assert.equal(otherRequests[0].membership_events.length,1);
    assert.equal((await history()).membership_events.length,10,'Other club events do not leak into this history');
    for (const actor of [member,legacy,otherOwner,null]) await assert.rejects(rpc(actor,'join_requests',{club_id}));
    await assert.rejects(as(owner,'select * from poker_member_access_events'),/permission/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select poker_club_action($1,$2)',['join_requests',JSON.stringify({club_id})]),/permission/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
