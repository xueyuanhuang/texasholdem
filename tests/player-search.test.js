const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function app(extra={}) {
 const context=vm.createContext({console,...extra});
 for(const file of ['assets/vendor/pinyin-pro.js','assets/js/05-player-search.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
 return {context,run: source=>vm.runInContext(source,context)};
}
test('shared search handles exact, partial, pinyin, initials, case and spaces',()=>{
 const a=app();
 for(const [name,query] of [['遥远','YY'],['遥远','yao yuan'],['蒋火淦','JHG'],['蒋火淦','jianghuogan'],['King',' k I n G '],['John Smith','JS'],['阿童木','童'],['xue@163.com','163']]) assert.equal(a.run(`doesPlayerMatchKeyword(${JSON.stringify(name)},${JSON.stringify(query)})`),true,`${name}: ${query}`);
 assert.equal(a.run(`doesPlayerMatchKeyword('遥远','zz')`),false);
 assert.equal(a.run(`JSON.stringify(searchPlayerNames(['Kingston','king','King Kong'], 'king'))`),'["king","Kingston","King Kong"]');
});
test('historical aliases use current names and never cross club/account scopes',()=>{
 const a=app({clubState:{active:{id:'a',status:'approved'}},getRemoteUser:()=>({id:'user'})});
 a.run(`playerSearchHistory={scope:'user:a',names:new Map([['King',{aliases:['遥远','<old>']} ]])}`);
 assert.equal(a.run(`JSON.stringify(searchPlayerNames(['King'], 'YY'))`),'["King"]');
 assert.match(a.run(`playerSearchPreviousHtml('King','old')`),/&lt;old&gt;/);
 a.run(`clubState.active.id='b'`);
 assert.equal(a.run(`doesPlayerMatchKeyword('King','YY')`),false);
});
test('late historical-name responses are discarded after a club switch',async()=>{
 let resolve;
 const a=app({clubState:{active:{id:'a',status:'approved'}},getRemoteUser:()=>({id:'user'}),data:{players:['King']},remoteState:{client:{rpc:()=>new Promise(r=>resolve=r)}}});
 const pending=a.run(`loadPlayerSearchHistory('YY')`);
 a.run(`clubState.active.id='b'`);
 resolve({data:{history:[{old_name:'遥远',new_name:'King'}]}});
 await pending;
 assert.equal(a.run(`doesPlayerMatchKeyword('King','YY')`),false);
});
test('leaderboard filtering retains the original rank and handles no matches',()=>{
 const a=app({formatScore: String, data:{},buildCashLeaderboard:()=>({countedGames:2,rows:[{name:'Alice',games:2,totalScore:200,averageScore:100,gameDetails:[]},{name:'遥远',games:1,totalScore:50,averageScore:50,gameDetails:[]}]} )});
 vm.runInContext(fs.readFileSync('assets/js/09-history.js','utf8'),a.context);
 a.run(`cashLeaderboardKeyword='YY'`);
 const html=a.run('renderCashLeaderboardCard()');
 assert.match(html,/<span class="lb-rank top2">2<\/span>/);
 assert.doesNotMatch(html,/data-player-name="Alice"/);
 a.run(`cashLeaderboardKeyword='notfound'`);
 assert.match(a.run('renderCashLeaderboardCard()'),/No matching players/);
});
