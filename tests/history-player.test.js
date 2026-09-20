const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function app(full=true) {
 const ctx=vm.createContext({data:{},formatScore:String,clubState:{active:{status:'approved',can_view_history:full}},buildCashLeaderboard:()=>({rows:[{name:'Alice',totalScore:200,games:2,averageScore:100,gameDetails:[]},{name:'遥远',totalScore:50,games:1,averageScore:50,gameDetails:[{gameKey:'selected',date:'2026-09-20',dateGameCount:1,playerRow:{pnlScore:50},rows:[],settlementPlan:{transfers:[]}}]}]})});
 vm.runInContext(fs.readFileSync('assets/js/09-history.js','utf8'),ctx);
 return source=>vm.runInContext(source,ctx);
}
test('history player popup shows original rank and highlights clicked game',()=>{
 const run=app();const html=run(`renderHistoryPlayerLeaderboard('遥远','selected')`);
 assert.match(html,/#2/);assert.match(html,/Total points/);assert.match(html,/selected" open/);assert.match(html,/Selected game/);
});
test('restricted history never presents partial results as club-wide statistics',()=>{
 const html=app(false)(`renderHistoryPlayerLeaderboard('遥远')`);
 assert.match(html,/Club-wide rank and totals are hidden/);assert.doesNotMatch(html,/history-player-stats/);assert.match(html,/Game results/);
});
test('unranked players have an explicit empty state and unsafe names are escaped',()=>{
 const run=app();assert.match(run(`renderHistoryPlayerLeaderboard('new player')`),/No ranked cash-game results yet/);
 const html=run(`historyPlayerLink('<img src=x>', '"')`);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/data-game-key="&quot;"/);
});
