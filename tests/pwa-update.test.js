const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('automatic updates wait for idle time, closed dialogs, and completed games and saves', async () => {
  let now=30000, dialog=false, sent=0, reloaded=0;
  const ctx=vm.createContext({ Date:{now:()=>now}, setInterval(){}, console,
    document:{visibilityState:'visible',activeElement:{tagName:'BODY'},querySelector:()=>dialog,getElementById:()=>null,addEventListener(){}},
    navigator:{},window:{addEventListener(){},location:{reload(){reloaded++;}}} });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/15-pwa.js'),'utf8'),ctx);
  ctx.worker={postMessage(){sent++;}};
  vm.runInContext('pendingPwaWorker=worker; var isRecording=false; var remoteState={};',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(sent,0);
  now+=16000; dialog=true;
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(sent,0);
  dialog=false;vm.runInContext('isRecording=true',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(sent,0);
  vm.runInContext('isRecording=false; remoteState.saving=true',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(sent,0);
  vm.runInContext('remoteState.saving=false',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(sent,1);
  vm.runInContext('pwaControllerChanged=true; isRecording=true',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(reloaded,0);
  vm.runInContext('isRecording=false',ctx);
  await vm.runInContext('applyIdlePwaUpdate()',ctx); assert.equal(reloaded,1);
});
