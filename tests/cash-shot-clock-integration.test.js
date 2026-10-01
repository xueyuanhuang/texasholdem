const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=name=>fs.readFileSync(`assets/js/${name}.js`,'utf8');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=value=>JSON.parse(JSON.stringify(value));
function load(ctx,...files) { for(const file of files)vm.runInContext(source(file),ctx); }
function player(name,endChips,timerPlayerId) {
 return {name,endChips,rebuys:[{time:'20:00',amount:1}],...(timerPlayerId?{timerPlayerId}: {})};
}
function game(id,status,players,date='2026-10-01') {
 return {id,status,date,chipsPerHand:1000,pricePerHand:20,players};
}

test('loading, regular saving, history editing and emergency saving retain timed-player identity',()=>{
 const timedId='11111111-1111-4111-8111-111111111111';
 const current=game('current','active',[player('Alice',1200,timedId),player('Bob',800)]);
 const data={players:['Alice','Bob'],cashGames:[current],activeCashGameId:'current'};
 const elements=new Map([['cash-cpp',{value:'1000'}],['cash-pph',{value:'20'}]]);
 let stored,cleared=0;
 const ctx=vm.createContext({data,document:{getElementById:id=>elements.get(id),addEventListener(){}},
  window:{addEventListener(){}},sortPlayerNamesForDisplay:names=>names.slice().sort(),
  clubState:{active:{id:'club'}},clubCanWrite:()=>true,STORAGE_KEY:'test-cash',
  clearTimeout:()=>{cleared++;},localStorage:{setItem:(key,value)=>{stored={key,value:JSON.parse(value)};}},
  console:{log(){},warn(message,error){throw error;}}});
 load(ctx,'11-cash-game');
 ctx.current=current;
 vm.runInContext('loadCashGameIntoEditor(current); cashPlayerData.Alice.endChips=1300; cashPlayerData.Bob.endChips=700;',ctx);
 const regular=plain(vm.runInContext('buildCurrentCashGameSnapshot()',ctx));
 assert.equal(regular.players.find(p=>p.name==='Alice').timerPlayerId,timedId);
 assert.equal(regular.players.find(p=>p.name==='Alice').endChips,1300);
 assert.equal(regular.players.find(p=>p.name==='Bob').timerPlayerId,undefined,'Old untracked entries do not receive an invented identity');
 const edited=plain(vm.runInContext('buildCashGameSnapshotForEdit({...current,status:"settled"})',ctx));
 assert.equal(edited.ok,true);
 assert.equal(edited.snapshot.players.find(p=>p.name==='Alice').timerPlayerId,timedId);
 assert.equal(edited.snapshot.status,'settled');
 assert.equal(edited.snapshot.players.find(p=>p.name==='Alice').endChips,1300);

 // Exercise the actual synchronous suspend fallback without starting the app.
 vm.runInContext(source('14-init').split('// ====== Boot ======')[0],ctx);
 vm.runInContext('autoSaveTimeout=42; _emergencyFlushCashDebounce()',ctx);
 assert.equal(cleared,1);
 assert.equal(stored.key,'test-cash');
 const saved=stored.value.cashGames.find(g=>g.id==='current');
 assert.equal(saved.players.find(p=>p.name==='Alice').timerPlayerId,timedId);
 assert.equal(saved.players.find(p=>p.name==='Alice').endChips,1300);
 assert.equal(saved.players.find(p=>p.name==='Bob').timerPlayerId,undefined);
 assert.equal(vm.runInContext('autoSaveTimeout',ctx),null);
});

test('ordinary participants receive clocks for all active players without gaining chip-edit controls',()=>{
 const active=game('shared','active',[player('Alice',1100),player('<Bob>',900)]);
 const data={cashGames:[active,game('finished','settled',[player('Past',1000)])]};
 const target={hidden:true,innerHTML:''};const calls=[];let refreshed=0;
 const ctx=vm.createContext({data,escapeHtml,formatScore:String,
  clubState:{active:{status:'approved',player_name:'Alice'}},clubHasGameAccess:()=>false,
  requireClubWrite:()=>false,document:{getElementById:id=>id==='member-games'?target:null},
  renderCashShotClock:(id,name,options)=>{calls.push({id,name,interactive:options.interactive});return '<span><button>30 seconds</button><button>60 seconds</button></span>';},
  refreshCashShotClocks:()=>{refreshed++;}});
 load(ctx,'07-cash-settlement','09-history','11-cash-game','04-navigation');
 vm.runInContext('renderMemberGames()',ctx);
 assert.equal(target.hidden,false);
 assert.deepEqual(calls,[{id:'shared',name:'Alice',interactive:true},{id:'shared',name:'<Bob>',interactive:true}]);
 assert.equal(refreshed,1);
 assert.match(target.innerHTML,/toggleCashShotClock\(this\)/);
 assert.match(target.innerHTML,/30 seconds/);
 assert.match(target.innerHTML,/60 seconds/);
 assert.match(target.innerHTML,/&lt;Bob&gt;/);
 assert.doesNotMatch(target.innerHTML,/<Bob>|Past|<input|changeBuyIn|updateEndChips|cash-buyin-btn|Finish game/);
 ctx.active=active;
 vm.runInContext('loadCashGameIntoEditor(active)',ctx);
 const before=JSON.stringify(data);
 const editorBefore=vm.runInContext('JSON.stringify(cashPlayerData)',ctx);
 vm.runInContext('changeBuyIn("Alice",1); updateEndChips("Alice",9999)',ctx);
 assert.equal(JSON.stringify(data),before,'Timer eligibility does not bypass the existing chip-write guard');
 assert.equal(vm.runInContext('JSON.stringify(cashPlayerData)',ctx),editorBefore);
});

test('per-match counts appear in date history and player profiles while results remain ordered by points',()=>{
 const tracked=game('tracked','settled',[player('Loser',0),player('Winner',1800),player('Even',1000),player('Runner-up',1200)]);
 const old=game('old','settled',[player('Winner',1000),player('Loser',1000)],'2026-09-01');
 const data={players:['Winner','Loser','Even','Runner-up'],tournaments:[],cashGames:[tracked,old]};
 const appended=[];const calls=[];let refreshed=0;
 const container={innerHTML:'',insertAdjacentHTML(){},appendChild:item=>appended.push(item)};
 const counts={Winner:1,'Runner-up':2,Loser:3};
 const ctx=vm.createContext({data,escapeHtml,formatScore:String,formatDateShort:String,
  clubState:{active:{status:'approved',owner:true}},
  compareCashGamesAsc:(a,b)=>String(a.id).localeCompare(String(b.id)),
  searchPlayerNames:names=>names,playerSearchPreviousHtml:()=>'',
  document:{getElementById:id=>id==='history-list'?container:null,createElement:()=>({innerHTML:''})},
  renderCashShotClock:(id,name,options)=>{calls.push({id,name,interactive:options.interactive});return id==='tracked'&&counts[name]?`<span>Timed ${counts[name]}×</span>`:'';},
  refreshCashShotClocks:()=>{refreshed++;}});
 load(ctx,'07-cash-settlement','08-cash-leaderboard','09-history');
 vm.runInContext('renderHistory()',ctx);
 assert.equal(refreshed,1);
 assert.equal(appended.length,2);
 const dateHtml=appended[0].innerHTML;
 const names=['Winner','Runner-up','Even','Loser'];
 const positions=names.map(name=>dateHtml.indexOf(`>${name}</button>`));
 assert.ok(positions.every((position,index)=>position>=0&&(index===0||position>positions[index-1])), 'Date history orders winners before losers');
 for(const count of [1,2,3])assert.match(dateHtml,new RegExp(`Timed ${count}×`));
 assert.doesNotMatch(appended[1].innerHTML,/Timed/,'Old games stay untracked');

 calls.length=0;
 const profile=vm.runInContext('renderHistoryPlayerLeaderboard("Winner")',ctx);
 const profilePositions=names.map(name=>profile.indexOf(`cash-leaderboard-full-name">${name}`));
 assert.ok(profilePositions.every((position,index)=>position>=0&&(index===0||position>profilePositions[index-1])), 'Profile match details retain descending points order');
 for(const count of [1,2,3])assert.match(profile,new RegExp(`Timed ${count}×`));
 assert.equal(calls.filter(call=>call.id==='tracked').length,4);
 assert.equal(calls.filter(call=>call.id==='old').length,2);
 assert.ok(calls.every(call=>call.interactive===false),'Past results never expose start or stop actions');
 assert.deepEqual(tracked.players.map(p=>p.name),['Loser','Winner','Even','Runner-up'],'Display ordering does not rewrite saved player attribution');
});

test('a running shared clock blocks PWA activation and reload until it ends',async()=>{
 let now=0,running=true,activated=0,reloaded=0;
 const ctx=vm.createContext({Date:{now:()=>now},cashShotClockIsRunning:()=>running,setInterval(){},
  navigator:{},console,document:{visibilityState:'visible',activeElement:{tagName:'BODY'},querySelector:()=>null,getElementById:()=>null,addEventListener(){}},
  window:{addEventListener(){},location:{reload(){reloaded++;}}},worker:{postMessage(){activated++;}}});
 load(ctx,'15-pwa');
 now=20000;
 vm.runInContext('pendingPwaWorker=worker',ctx);
 await vm.runInContext('applyIdlePwaUpdate()',ctx);
 assert.equal(activated,0);
 running=false;
 await vm.runInContext('applyIdlePwaUpdate()',ctx);
 assert.equal(activated,1);
 vm.runInContext('pwaControllerChanged=true',ctx);
 running=true;
 await vm.runInContext('applyIdlePwaUpdate()',ctx);
 assert.equal(reloaded,0);
 running=false;
 await vm.runInContext('applyIdlePwaUpdate()',ctx);
 assert.equal(reloaded,1);
});
