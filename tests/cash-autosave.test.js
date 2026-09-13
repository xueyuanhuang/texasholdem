const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('removing the final selected player discards only the active game',async()=>{
 const data={activeCashGameId:2,cashGames:[{id:1,status:'settled',players:[]},{id:2,status:'active',players:[{name:'Alice'}]}]};
 let cloudSaves=0;
 const ctx=vm.createContext({data,Set,requireClubWrite:()=>true,saveData:()=>Promise.resolve(),upsertRemoteStateNow:()=>cloudSaves++,document:{getElementById:()=>null}});
 vm.runInContext(fs.readFileSync('assets/js/11-cash-game.js','utf8'),ctx);
 vm.runInContext('isRecording=true; autoSaveCashGame();',ctx);
 assert.equal(data.activeCashGameId,null);
 assert.deepEqual(data.cashGames,[{id:1,status:'settled',players:[]}]);
 assert.equal(vm.runInContext('isRecording',ctx),false);
 assert.equal(cloudSaves,1);
 vm.runInContext('autoSaveCashGame();',ctx);
 assert.equal(cloudSaves,1);
});
