const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('club permissions, migration, bindings and optimistic concurrency in PostgreSQL', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001';
  const alice = '00000000-0000-0000-0000-000000000002';
  const bob = '00000000-0000-0000-0000-000000000003';
  const payload = { players: ['Alice', 'Bob'], cashGames: [], tournaments: [{ id: 1 }], _schemaVersion: 5 };
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create table public.texasholdem_user_states(user_id uuid primary key,payload jsonb);`);
    for (const [id, email] of [[owner, 'owner@example.com'], [alice, 'alice@example.com'], [bob, 'bob@example.com']]) {
      await db.query('insert into auth.users values ($1,$2)', [id,email]);
    }
    await db.query('insert into texasholdem_user_states values ($1,$2)', [owner,JSON.stringify(payload)]);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913_clubs.sql'),'utf8'));
    async function rpc(user, action, args = {}) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
      await db.exec('set role authenticated');
      try { return (await db.query('select poker_club_action($1,$2) as result',[action,JSON.stringify(args)])).rows[0].result; }
      finally { await db.exec('reset role'); }
    }
    await assert.rejects(rpc(null,'list'), /请先登录/);
    await assert.rejects(rpc(alice,'create',{name:'Unauthorized import'}), /先同步个人数据/);
    const { id: club_id } = await rpc(owner,'create',{name:'Test Club'});
    assert.deepEqual((await rpc(owner,'read',{club_id})).payload,payload);
    assert.deepEqual((await db.query('select payload from texasholdem_user_states where user_id=$1',[owner])).rows[0].payload,payload);
    await assert.rejects(rpc(alice,'read',{club_id}), /批准/);
    await rpc(alice,'join',{club_id,player_name:'Alice',can_manage_games:true,status:'approved'});
    await assert.rejects(rpc(alice,'read',{club_id}), /批准/);
    await assert.rejects(rpc(alice,'review',{club_id,user_id:alice,status:'approved'}), /批准/);
    await rpc(owner,'review',{club_id,user_id:alice,status:'approved'});
    assert.deepEqual((await rpc(alice,'read',{club_id})).payload,payload);
    await assert.rejects(rpc(alice,'members',{club_id}), /管理员/);
    await assert.rejects(rpc(alice,'save',{club_id,revision:1,payload}), /获授权/);
    await assert.rejects(rpc(alice,'grant',{club_id,user_id:alice,allowed:true}), /管理员/);
    await rpc(alice,'request_binding',{club_id,player_name:'Alice'});
    assert.equal((await rpc(alice,'list'))[0].player_name,null);
    await rpc(owner,'bind',{club_id,user_id:alice,player_name:'Alice'});
    assert.equal((await rpc(alice,'list'))[0].player_name,'Alice');
    await rpc(bob,'join',{club_id});
    await rpc(owner,'review',{club_id,user_id:bob,status:'approved'});
    await assert.rejects(rpc(owner,'bind',{club_id,user_id:bob,player_name:'Alice'}), /unique/i);
    await assert.rejects(rpc(owner,'bind',{club_id,user_id:bob,player_name:'Missing'}), /已有玩家/);
    await rpc(owner,'grant',{club_id,user_id:alice,allowed:true});
    const next = { ...payload, cashGames: [{ id: 'game-1', status: 'active' }] };
    assert.equal((await rpc(alice,'save',{club_id,revision:1,payload:next})).revision,2);
    await assert.rejects(rpc(owner,'save',{club_id,revision:1,payload}), /其他人更新/);
    await assert.rejects(rpc(alice,'save',{club_id,revision:2,payload:{...next,players:['Alice']}}), /只有管理员/);
    await assert.rejects(rpc(owner,'save',{club_id,revision:2,payload:{...next,players:['Bob']}}), /已有邮箱绑定/);
    await rpc(owner,'grant',{club_id,user_id:alice,allowed:false});
    await assert.rejects(rpc(alice,'save',{club_id,revision:2,payload:next}), /获授权/);
    await rpc(owner,'review',{club_id,user_id:alice,status:'rejected'});
    await assert.rejects(rpc(alice,'read',{club_id}), /批准/);
    await rpc(alice,'join',{club_id});
    assert.equal((await rpc(alice,'list'))[0].can_manage_games,false);
    await assert.rejects(rpc(owner,'grant',{club_id,user_id:owner,allowed:false}), /管理员权限/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from poker_clubs'), /permission denied/i);
    await assert.rejects(db.query("update poker_club_members set can_manage_games=true"), /permission denied/i);
    await db.exec('reset role');
    // Another club owner cannot read or approve members of this club.
    await db.query('insert into texasholdem_user_states values ($1,$2)',[bob,JSON.stringify(payload)]);
    const second = await rpc(bob,'create',{name:'Other Club'});
    await assert.rejects(rpc(owner,'read',{club_id:second.id}), /批准/);
  } finally { await db.close(); }
});
