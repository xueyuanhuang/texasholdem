const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
test('approval creates a unique player atomically; rejoining preserves identity and history', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001';
  const member = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.texasholdem_user_states(user_id uuid primary key,payload jsonb);`);
    await db.query('insert into auth.users values ($1,$2,$3),($4,$5,$6)',[owner,'owner@test.com','{}',member,'new@test.com',JSON.stringify({full_name:'Alice'})]);
    const payload = {players:['Alice'],cashGames:[{id:'old'}],tournaments:[]};
    await db.query('insert into texasholdem_user_states values($1,$2)',[owner,JSON.stringify(payload)]);
    for (const name of ['20260913_clubs.sql','20260913_club_auto_players.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
    async function rpc(actor, action, args={}) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
      return (await db.query('select poker_club_action($1,$2) result',[action,JSON.stringify(args)])).rows[0].result;
    }
    const {id:club_id} = await rpc(owner,'create',{name:'Club'});
    await rpc(member,'join',{club_id});
    assert.deepEqual((await rpc(owner,'read',{club_id})).payload,payload);
    await assert.rejects(rpc(member,'review',{club_id,user_id:member,status:'approved'}));
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    const after = await rpc(member,'read',{club_id});
    assert.deepEqual(after.payload.players,['Alice','Alice (1)']);
    assert.deepEqual(after.payload.cashGames,payload.cashGames);
    assert.equal(after.revision,2);
    assert.equal((await rpc(member,'list'))[0].player_name,'Alice (1)');
    assert.equal((await rpc(member,'list'))[0].can_manage_games,false);
    await assert.rejects(rpc(owner,'save',{club_id,revision:1,payload}));
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    assert.equal((await rpc(owner,'read',{club_id})).revision,2);
    await rpc(owner,'review',{club_id,user_id:member,status:'rejected'});
    await rpc(member,'join',{club_id});
    await rpc(owner,'review',{club_id,user_id:member,status:'approved'});
    assert.deepEqual((await rpc(member,'read',{club_id})).payload,after.payload);
    assert.equal((await rpc(member,'list'))[0].player_name,'Alice (1)');
    assert.deepEqual((await db.query('select payload from texasholdem_user_states')).rows[0].payload,payload);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913_club_only.sql'),'utf8'));
    const fresh = await rpc(member,'create',{name:'New club without personal records'});
    const empty = await rpc(member,'read',{club_id:fresh.id});
    assert.deepEqual(empty.payload.players,[]);
    assert.deepEqual(empty.payload.cashGames,[]);
    assert.deepEqual(empty.payload.tournaments,[]);
  } finally { await db.close(); }
});
