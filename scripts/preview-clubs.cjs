// Isolated UI preview: in-memory PostgreSQL and synthetic users, localhost only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'..');
const ids = Object.fromEntries(['owner','member','organizer','pending','newuser'].map((role,i)=>[role,`00000000-0000-0000-0000-00000000000${i+1}`]));

(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table texasholdem_user_states(user_id uuid primary key,payload jsonb);`);
  const ctx=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/01-data.js'),'utf8'),ctx);
  const seed=vm.runInContext('cloneDefaultData()',ctx);
  seed.players=['Alice','Bob']; seed.playerActivity={}; seed.tournaments=[];
  seed.cashGames=[{id:'example-game',date:'2026-09-13',status:'settled',chipsPerHand:1000,pricePerHand:20,
    players:[{name:'Alice',endChips:1200,rebuys:[{time:'20:00',amount:1}]},{name:'Bob',endChips:800,rebuys:[{time:'20:00',amount:1}]}]}];
  for (const [role,id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}@example.test`]);
    await db.query('insert into texasholdem_user_states values($1,$2)',[id,JSON.stringify(seed)]);
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260913_clubs.sql'),'utf8'));
  async function rpc(user,action,args={}) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    return (await db.query('select poker_club_action($1,$2) result',[action,JSON.stringify(args)])).rows[0].result;
  }
  const {id:club_id}=await rpc(ids.owner,'create',{name:'示例俱乐部'});
  for (const role of ['member','organizer','pending']) {
    await rpc(ids[role],'join',{club_id,player_name:role==='member'?'Alice':'Bob'});
    if (role!=='pending') await rpc(ids.owner,'review',{club_id,user_id:ids[role],status:'approved'});
  }
  await rpc(ids.owner,'grant',{club_id,user_id:ids.organizer,allowed:true});
  for (const migration of ['20260913_club_auto_players.sql','20260913_club_only.sql','20260913_delete_club.sql','20260913_club_display_names.sql','20260913_history_access.sql','20260913_account_username.sql','20260913_player_details.sql','20260913_merge_linked_players.sql','20260913_link_activity_fix.sql','20260913_legacy_profile_names.sql','20260913_leave_club.sql','20260913_own_games.sql','20260913_permission_stability.sql']) await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
  await rpc(ids.owner,'bind',{club_id,user_id:ids.member,player_name:'Alice'});
  await db.query(`update poker_clubs set payload=jsonb_set(payload,'{cashGames}', $1::jsonb) where id=$2`,[JSON.stringify([
    {id:'active-test',date:'2026-09-13',status:'active',chipsPerHand:1000,pricePerHand:20,players:[{name:'member@example.test',endChips:900,rebuys:[{amount:1}]},{name:'Alice',endChips:1100,rebuys:[{amount:1}]}]},
    {id:'private',date:'2026-09-12',status:'settled',players:[{name:'Bob',endChips:1000,rebuys:[{amount:1}]}]}
  ]),club_id]);
  let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const role=Object.hasOwn(ids,url.searchParams.get('as'))?url.searchParams.get('as'):'owner';
    const user={id:ids[role],email:`${role}@example.test`};
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/__test_rpc' && req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk;
      const work=async()=>{try{const {action,args}=JSON.parse(body);res.setHeader('Content-Type','application/json');
        let result;
        if(action==='personal-read') { const row=(await db.query('select payload from texasholdem_user_states where user_id=$1',[user.id])).rows[0];result=row?{...row,updated_at:new Date().toISOString()}:null; }
        else if(action==='personal-save') { await db.query('update texasholdem_user_states set payload=$1 where user_id=$2',[JSON.stringify(args.payload),user.id]);result=null; }
        else if(action==='poker_leave_club') { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]); result=(await db.query('select poker_leave_club($1) result',[args.club_id])).rows[0].result; }
        else if(action==='poker_player_details') { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]); result=(await db.query('select poker_player_details($1,$2) result',[args.club_id,args.player_name])).rows[0].result; }
        else if(action==='poker_account_profile') { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]); result=(await db.query('select poker_account_profile($1,$2) result',[args.action,args.username || null])).rows[0].result; }
        else if(['poker_join_club','poker_set_club_name','poker_grant_history'].includes(action)) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]); const query=action==='poker_grant_history'?'select poker_grant_history($1,$2,$3) result':`select ${action}($1,$2) result`; result=(await db.query(query,action==='poker_grant_history'?[args.club_id,args.member_id,args.allowed]:[args.club_id,args.display_name])).rows[0].result; }
        else if(action==='delete-club') { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]); result=(await db.query('select poker_delete_club($1,$2,$3) result',[args.club_id,args.confirmation_name,args.expected_revision])).rows[0].result; }
        else result=await rpc(user.id,action,args);
        res.end(JSON.stringify({data:result}));}catch(e){res.end(JSON.stringify({error:{message:e.message}}));}};
      queue=queue.then(work,work);return;
    }
    if(url.pathname==='/sw.js'){res.statusCode=404;res.end();return;}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
    if(file===path.join(root,'index.html')) {
      let html=fs.readFileSync(file,'utf8');
      const fixture=`<script>
        window.TEXASHOLDEM_SUPABASE_CONFIG={enabled:true,clubsEnabled:true,url:'http://localhost',anonKey:'test'};
        if(localStorage.getItem('preview_seed_${user.id}')!==${JSON.stringify(club_id)}) { localStorage.setItem('poker_active_club_${user.id}',${JSON.stringify(club_id)}); localStorage.setItem('preview_seed_${user.id}',${JSON.stringify(club_id)}); }
        const call=async(action,args)=>fetch('/__test_rpc?as=${role}',{method:'POST',body:JSON.stringify({action,args})}).then(r=>r.json());
        window.supabase={createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>call('personal-read',{})})}),upsert:args=>call('personal-save',args)}),auth:{getSession:async()=>({data:{session:{user:${JSON.stringify(user)}}}}),onAuthStateChange:()=>({})},
          rpc:async(name,params)=>call(name==='poker_delete_club'?'delete-club':name==='poker_club_action'?params.action:name,name==='poker_club_action'?params.args:params)})};
      </script>`;
      html=html.replace('<script src="assets/js/00-supabase-config.js"></script>',fixture).replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','');
      html=html.replace('<body>',`<body><div style="padding:12px;background:#fff4cd;color:#222">本地测试数据：${Object.keys(ids).map(r=>`<a href="/?as=${r}" style="margin:8px">${r}</a>`).join('')}</div>`);
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;
    }
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  server.listen(Number(process.env.PORT || 8093),'127.0.0.1',()=>console.log('Club preview: http://127.0.0.1:8093/?as=owner'));
})().catch(e=>{console.error(e);process.exitCode=1;});
