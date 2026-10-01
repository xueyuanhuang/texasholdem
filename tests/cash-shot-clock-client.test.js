const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness() {
  let user={id:'owner'}, monotonic=0, serial=0;
  const nodes=[], storage=new Map(), calls=[], toasts=[], beeps=[];
  const listeners={}, intervals=[];
  const context=vm.createContext({console,Date,Map,Set,Promise,
    performance:{now:()=>monotonic},crypto:{randomUUID:()=>`10000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
    navigator:{onLine:true},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    document:{visibilityState:'visible',querySelectorAll:selector=>selector==='[data-cash-shot-clock]'?nodes:[],addEventListener:(name,fn)=>{listeners[name]=fn;}},
    window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},setInterval:fn=>intervals.push(fn),
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    getRemoteUser:()=>user,clubState:{active:{id:'club',status:'approved'}},
    remoteState:{client:{rpc:async(name,args)=>{calls.push({name,args});return{data:{server_now:'2026-10-01T00:00:00Z',games:[]}};}}},
    data:{cashGames:[{id:'game',status:'active',players:[{name:'Alice'},{name:'Bob'}]}],activeCashGameId:'game'},
    cashPlayerData:{Alice:{endChips:1000}},_saveQueue:Promise.resolve(),clubSaveQueue:Promise.resolve(),
    safeToast:text=>toasts.push(text)
  });
  const run=source=>vm.runInContext(source,context);
  run(fs.readFileSync('assets/js/11-cash-shot-clock.js','utf8'));
  run('cashShotClockContext()');
  context.recordBeep=()=>beeps.push(monotonic);run('beepCashShotClock=recordBeep');
  function apply(game,server='2026-10-01T00:00:00Z') {
    context.response={server_now:server,games:[game]};
    run('applyCashShotClockResponse(response,cashShotClockState.scope,cashShotClockState.generation,performance.now())');
  }
  function node(name='Alice',interactive=true) {
    const value={textContent:''};
    const element={dataset:{gameId:'game',playerName:name,interactive:String(interactive)},innerHTML:'',querySelector:()=>value,value};
    nodes.push(element);return element;
  }
  return {context,run,calls,toasts,beeps,storage,listeners,intervals,apply,node,advance:amount=>{monotonic+=amount;},setUser:value=>{user=value;}};
}
function game(overrides={}) {
  return {game_id:'game',tracked:true,active:true,can_control:true,version:1,timer:null,
    players:[{player_id:'alice-id',name:'Alice',count:0},{player_id:'bob-id',name:'Bob',count:2}],...overrides};
}
function timer(overrides={}) {
  return {id:'timer-id',player_id:'alice-id',player_name:'Alice',started_at:'2026-10-01T00:00:00Z',ends_at:'2026-10-01T00:00:30Z',duration:30,started_by:'owner',status:'running',...overrides};
}
const button=(name='Alice',duration=30)=>({dataset:{gameId:'game',playerName:name,duration:String(duration)}});

test('cash clock markup shows counts only for tracked games and offers inline controls with safe player names',()=>{
  const h=harness();h.apply(game());h.context.button={...button(),setAttribute(){}};
  h.run('toggleCashShotClock(button)');
  const markup=h.run("renderCashShotClock('game','Alice',{interactive:true})");
  assert.match(markup,/Timed 0×/);assert.match(markup,/30s · Pre-flop \/ Flop \/ Turn/);assert.match(markup,/60s · River/);
  assert.doesNotMatch(h.run("renderCashShotClock('game','Bob',{interactive:false})"),/onclick=/);
  h.apply(game({tracked:false,players:[],active:false}));
  assert.doesNotMatch(h.run("renderCashShotClock('game','Alice',{interactive:false})"),/Timed/);
  assert.doesNotMatch(h.run(`renderCashShotClock('game','<img src=x onerror=alert(1)>')`),/<img/);
});

test('countdown uses server time with monotonic elapsed time; background expiry is derived without decrement loops',()=>{
  const h=harness();h.apply(game({timer:timer()}));
  assert.equal(h.run('cashShotClockRemaining(cashShotClockState.games.get("game").timer)'),30);
  h.advance(10500);assert.equal(h.run('cashShotClockRemaining(cashShotClockState.games.get("game").timer)'),20);
  h.context.document.visibilityState='hidden';h.advance(22000);
  h.context.document.visibilityState='visible';h.run('paintCashShotClocks()');
  assert.equal(h.run('cashShotClockRemaining(cashShotClockState.games.get("game").timer)'),0);
  assert.match(h.run("renderCashShotClock('game','Alice')"),/Time’s up/);
  assert.equal(h.run('cashShotClockIsRunning()'),false);
});

test('newer versions win, actor/club races are ignored, and stable player IDs hydrate without saving',()=>{
  const h=harness();h.apply(game({version:3,timer:timer(),players:[{player_id:'alice-id',name:'Alice',count:3}]}));
  assert.equal(h.context.cashPlayerData.Alice.timerPlayerId,'alice-id');
  assert.equal(h.context.data.cashGames[0].players[0].timerPlayerId,'alice-id');
  h.apply(game({version:2}));assert.equal(h.run('cashShotClockState.games.get("game").version'),3);
  h.context.late={server_now:'2026-10-01T00:00:02Z',games:[game({version:4})]};
  h.setUser({id:'other'});
  assert.equal(h.run('applyCashShotClockResponse(late,"owner:club",cashShotClockState.generation,performance.now())'),false);
  assert.equal(h.run("cashShotClockPlayerId('game','Alice')"),null);
  h.context.clubState.active.id='different';
  assert.equal(h.run("renderCashShotClock('game','Alice')").includes('Timed'),false);
});

test('duplicate taps send one start, wait for a new game save, and never optimistically increment a count',async()=>{
  const h=harness();h.apply(game({tracked:false}));h.context.button=button();let saved,finish;
  h.context._saveQueue=new Promise(resolve=>saved=resolve);
  h.context.remoteState.client.rpc=(name,args)=>{h.calls.push({name,args});return new Promise(resolve=>finish=resolve);};
  const first=h.run('startCashShotClock(button)');const duplicate=h.run('startCashShotClock(button)');
  await duplicate;assert.equal(h.calls.length,0);assert.doesNotMatch(h.run("renderCashShotClock('game','Alice')"),/Timed 1×/);
  saved();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.action,'start');
  const command=h.calls[0].args.args;
  finish({data:{server_now:'2026-10-01T00:00:00Z',games:[game({version:2,timer:timer({id:command.command_id}),players:[{player_id:'alice-id',name:'Alice',count:1}]})]}});
  await first;assert.match(h.run("renderCashShotClock('game','Alice')"),/Timed 1×/);
  assert.equal(h.run('cashShotClockState.pending.size'),0);
});

test('uncertain network results reuse the command ID, while confirmed server rejections do not count',async()=>{
  const h=harness();h.apply(game());h.context.button=button();
  h.context.remoteState.client.rpc=async(name,args)=>{h.calls.push({name,args});return{error:{message:'TypeError: Failed to fetch',code:''}};};
  await h.run('startCashShotClock(button)');assert.equal(h.run('cashShotClockState.pending.size'),1);
  const original=h.calls[0].args.args.command_id;
  await h.run('startCashShotClock(button)');assert.equal(h.calls[1].args.args.command_id,original);
  assert.match(h.run("renderCashShotClock('game','Alice')"),/Timed 0×/);
  h.context.remoteState.client.rpc=async()=>({error:{code:'42501',message:'Participation required'}});
  await h.run('startCashShotClock(button)');
  assert.equal(h.run('cashShotClockState.pending.size'),0);
  assert.equal(h.run('Object.keys(cashShotClockOwned()).length'),0);
  h.context.navigator.onLine=false;await h.run('startCashShotClock(button)');
  assert.match(h.toasts.at(-1),/Reconnect/);
});

test('a conflicting start cannot claim another phone’s beep, and stopping retains its count',async()=>{
  const h=harness();h.apply(game());h.context.button=button();
  h.context.remoteState.client.rpc=async()=>({data:{server_now:'2026-10-01T00:00:00Z',conflict:true,games:[game({version:2,timer:timer(),players:[{player_id:'alice-id',name:'Alice',count:1}]})]}});
  await h.run('startCashShotClock(button)');h.advance(30000);h.run('checkCashShotClockExpiry()');assert.equal(h.beeps.length,0);
  h.apply(game({version:3,timer:timer({status:'stopped'}),players:[{player_id:'alice-id',name:'Alice',count:1}]}),'2026-10-01T00:00:30Z');
  const markup=h.run("renderCashShotClock('game','Alice')");
  assert.match(markup,/Timed 1×/);assert.doesNotMatch(markup,/Time’s up|cash-shot-clock-seconds/);
});

test('only the initiating tab beeps once, remembers that through refresh, and skips delayed background alarms',()=>{
  const h=harness();h.run('cashShotClockOwned()["owner:club:timer-id"]={done:false};saveCashShotClockOwned()');
  h.apply(game({timer:timer()}));h.advance(30000);h.run('checkCashShotClockExpiry();checkCashShotClockExpiry()');
  assert.equal(h.beeps.length,1);
  h.run('cashShotClockState.owned=null;checkCashShotClockExpiry()');assert.equal(h.beeps.length,1);
  h.run('cashShotClockOwned()["owner:club:late-timer"]={done:false}');
  h.apply(game({version:2,timer:timer({id:'late-timer'})}),'2026-10-01T00:00:45Z');assert.equal(h.beeps.length,1);
  const other=harness();other.apply(game({timer:timer()}));other.advance(30000);other.run('checkCashShotClockExpiry()');assert.equal(other.beeps.length,0);
});

test('polling updates only timer placeholders and does not refetch old completed games every second',async()=>{
  const h=harness();const element=h.node();h.apply(game({timer:timer()}));
  const before=element.innerHTML;h.advance(1000);h.run('paintCashShotClocks()');
  assert.equal(element.innerHTML,before,'Countdown ticks do not replace buttons or surrounding focused inputs');
  assert.equal(element.value.textContent,'29s');
  h.context.remoteState.client.rpc=async(name,args)=>{h.calls.push({name,args});return{data:{server_now:'2026-10-01T00:00:01Z',games:[game({active:false})]}};};
  await h.run('refreshCashShotClocks()');h.context.data.cashGames[0].status='settled';
  await h.run('refreshCashShotClocks({force:false})');assert.equal(h.calls.length,1);
  h.context.document.visibilityState='hidden';await h.run('refreshCashShotClocks()');assert.equal(h.calls.length,1);
});

test('wake lock is released on hide and context changes, including a late acquisition',async()=>{
  const h=harness();let acquire,releases=0;
  h.context.navigator.wakeLock={request:()=>new Promise(resolve=>acquire=resolve)};
  h.apply(game({timer:timer()}));h.context.document.visibilityState='hidden';
  acquire({release:async()=>{releases++;},addEventListener(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(releases,1);
  h.context.document.visibilityState='visible';h.run('cashShotClockState.wakeAttempt="";syncCashShotClockWakeLock()');
  acquire({release:async()=>{releases++;},addEventListener(){}});await new Promise(resolve=>setImmediate(resolve));
  h.run('clearCashShotClockContext()');assert.equal(releases,2);
});

test('missing or unauthorized games discard cached controls/counts while transport failures retain display and disable new starts',async()=>{
  const h=harness();h.node();h.apply(game({timer:timer()}));
  h.context.remoteState.client.rpc=async()=>({data:{server_now:'2026-10-01T00:00:00Z',games:[]}});
  await h.run('refreshCashShotClocks()');
  assert.equal(h.run('cashShotClockState.games.size'),0);
  assert.doesNotMatch(h.run("renderCashShotClock('game','Alice')"),/Timed|cash-shot-clock-stop/);
  h.apply(game({timer:timer()}));
  h.context.remoteState.client.rpc=async()=>({error:{code:'P0001',message:'Club approval is required.'}});
  await h.run('refreshCashShotClocks()');assert.equal(h.run('cashShotClockState.games.size'),0);
  h.apply(game());h.run('cashShotClockState.expanded.add(cashShotClockKey("game","Alice"))');
  h.context.remoteState.client.rpc=async()=>({error:{message:'Failed to fetch',code:''}});
  await h.run('refreshCashShotClocks()');assert.equal(h.run('cashShotClockState.games.size'),1);
  assert.match(h.run("renderCashShotClock('game','Alice')"),/data-duration="30"[^>]*disabled/);
  h.context.button=button();await h.run('startCashShotClock(button)');assert.equal(h.run('cashShotClockState.pending.size'),0);
  h.context.remoteState.client.rpc=async()=>({data:{server_now:'2026-10-01T00:00:01Z',games:[game()]}});
  await h.run('refreshCashShotClocks()');assert.equal(h.run('cashShotClockState.stale.size'),0);
});

test('existing shared timer actions stay independent of a failed buy-in save',async()=>{
  const h=harness();h.apply(game());h.context.button=button();h.context.clubSaveQueue=Promise.resolve(false);
  h.context.remoteState.client.rpc=async(name,args)=>{h.calls.push({name,args});return{data:{server_now:'2026-10-01T00:00:00Z',games:[game({version:2,timer:timer({id:args.args.command_id})})]}};};
  await h.run('startCashShotClock(button)');assert.equal(h.calls[0].args.action,'start');
  h.context._saveQueue=new Promise(()=>{});
  await h.run('stopCashShotClock(button)');assert.equal(h.calls[1].args.action,'stop');
});

test('late start success or rejection cannot erase a newer stop command confirmed independently by polling',async()=>{
  for (const lateFailure of [false,true]) {
    const h=harness();h.apply(game());h.context.button=button();const finish=[];
    h.context.remoteState.client.rpc=(name,args)=>{h.calls.push({name,args});return new Promise(resolve=>finish.push(resolve));};
    const starting=h.run('startCashShotClock(button)');
    const startId=h.calls[0].args.args.command_id;
    // The regular read sees the accepted start before its delayed response returns.
    h.advance(1000);
    const running=game({version:2,timer:timer({id:startId}),players:[{player_id:'alice-id',name:'Alice',count:1}]});
    h.apply(running,'2026-10-01T00:00:01Z');assert.equal(h.run('cashShotClockState.pending.size'),0);
    const stopping=h.run('stopCashShotClock(button)');
    const stopId=h.calls[1].args.args.command_id;
    finish[0](lateFailure ? {error:{code:'42501',message:'Late rejection'}} : {data:{server_now:'2026-10-01T00:00:00Z',games:[running]}});
    await starting;
    assert.equal(h.run('cashShotClockState.pending.get("game").command_id'),stopId);
    assert.equal(h.run('cashShotClockState.pending.get("game").inFlight'),true);
    await h.run('stopCashShotClock(button)');assert.equal(h.calls.length,2,'Duplicate taps remain blocked until the newer command resolves');
    finish[1]({error:{message:'Failed to fetch',code:''}});await stopping;
    assert.equal(h.run('cashShotClockState.pending.get("game").command_id'),stopId,'The stop request retains its retry ID');
    assert.match(h.run('cashShotClockState.errors.get("game")'),/Could not confirm/);
  }
});
