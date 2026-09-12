const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app() {
  const storage = new Map();
  const context = vm.createContext({ console, setTimeout: () => 1, clearTimeout() {}, navigator: { onLine: true },
    window: { TEXASHOLDEM_SUPABASE_CONFIG: { clubsEnabled: true } },
    document: { getElementById: () => null },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }
  });
  for (const file of ['01-data.js','02-remote.js','02-clubs.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js',file),'utf8'),context);
  }
  vm.runInContext(`data=cloneDefaultData(); remoteState.configured=true;
    remoteState.session={user:{id:'owner'}};
    renderAppAfterDataChange=()=>{};
    clubState.active={id:'club-a',owner:true,status:'approved',can_manage_games:true};
    clubState.ready=true; clubState.revision=1;`,context);
  return { context, run: source => vm.runInContext(source,context), storage };
}
test('members are read only; organizer grants do not grant roster management', () => {
  const a=app();
  assert.equal(a.run('clubCanWrite(true)'),true);
  a.run('clubState.active.owner=false; clubState.active.can_manage_games=false');
  assert.equal(a.run('clubCanWrite()'),false);
  a.run('clubState.active.can_manage_games=true');
  assert.equal(a.run('clubCanWrite()'),true);
  assert.equal(a.run('clubCanWrite(true)'),false);
  a.run('navigator.onLine=false');
  assert.equal(a.run('clubCanWrite()'),false);
  a.run("navigator.onLine=true; clubState.active.status='pending'");
  assert.equal(a.run('clubCanWrite()'),false);
});
test('serialized saves use successive revisions and preserve individual snapshots', async () => {
  const a=app(), writes=[];
  a.context.rpc = async (_name,{args}) => { writes.push(args); return {data:{revision:args.revision+1}}; };
  a.run('remoteState.client={rpc}');
  await a.run("data.cashGames=[]; var firstSave=saveClubData(); data.cashGames=[{id:'new'}]; var secondSave=saveClubData(); Promise.all([firstSave,secondSave])");
  assert.deepEqual(writes.map(w=>w.revision),[1,2]);
  assert.equal(writes[0].payload.cashGames.length,0);
  assert.equal(writes[1].payload.cashGames.length,1);
});
test('queued writes cannot cross clubs or authenticated accounts', async () => {
  const a=app(); let calls=0;
  a.context.rpc=async()=>{calls++;return {data:{revision:2}};};
  a.run('remoteState.client={rpc}');
  const pending=a.run("var pendingSave=saveClubData(); clubState.active.id='club-b'; pendingSave");
  assert.equal(await pending,false); assert.equal(calls,0);
  const signedOut=a.run("var pendingSave=saveClubData(); remoteState.session=null; pendingSave");
  assert.equal(await signedOut,false); assert.equal(calls,0);
});
test('conflicts freeze writes and do not advance revisions', async () => {
  const a=app();
  a.context.rpc=async()=>({error:{message:'record conflict'}});
  a.run('remoteState.client={rpc}');
  assert.equal(await a.run('saveClubData()'),false);
  assert.equal(a.run('clubState.ready'),false);
  assert.equal(a.run('clubState.revision'),1);
  assert.equal(a.run('remoteState.lastError'),'record conflict');
});
test('pending members receive no cached history and never call read', async () => {
  const a=app(); let calls=0;
  a.context.rpc=async()=>{calls++;return {data:{}};};
  a.run("remoteState.client={rpc}; clubState.active.status='pending'");
  await a.run('loadClubData()');
  assert.equal(a.run('data.cashGames.length'),0);
  assert.equal(a.run('data.tournaments.length'),0);
  assert.equal(a.run('data.players.length'),0);
  assert.equal(calls,0);
});
test('local save queue captures storage scope and data before a club switch', async () => {
  const a=app(), writes=[];
  a.context.write=async(value,key)=>{writes.push({value,key});return true;};
  a.run('writeToIndexedDB=write');
  await a.run("STORAGE_KEY='scope-a'; data.players=['Alice']; var saved=saveData({remote:false}); STORAGE_KEY='scope-b'; data.players=['Bob']; saved");
  assert.equal(writes[0].key,'scope-a');
  assert.equal(writes[0].value.players[0],'Alice');
});

test('a failed initial cloud read cannot be uploaded as an empty personal state', async () => {
  const a=app(); let writes=0;
  a.context.rpc=async()=>({error:{message:'temporarily unavailable'}});
  a.context.from=()=>({upsert:async()=>{writes++;return {};}});
  a.run('clubState.active=null; remoteState.client={rpc,from}');
  await a.run('loadRemoteDataIfSignedIn()');
  assert.equal(a.run('remoteState.dataReady'),false);
  assert.equal(await a.run('upsertRemoteStateNow()'),false);
  assert.equal(a.run('clubCanWrite()'),false);
  assert.equal(writes,0);
});

test('Google OAuth keeps redirects on the app path and prevents duplicate requests', async () => {
  const a = app(); let finish, calls = [];
  a.context.URL = URL;
  a.context.window.location = {origin:'https://xueyuanhuang.github.io',pathname:'/texasholdem/',search:'?next=https://other.example'};
  a.context.oauth = args => { calls.push(args); return new Promise(resolve => { finish = resolve; }); };
  a.run('remoteState.session=null; remoteState.client={auth:{signInWithOAuth:oauth}}');
  const pending = a.run('signInWithGoogle()');
  await a.run('signInWithGoogle()');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'google');
  assert.equal(calls[0].options.redirectTo, 'https://xueyuanhuang.github.io/texasholdem/');
  finish({error:{message:'provider disabled'}});
  await pending;
  assert.equal(a.run('remoteState.oauthPending'), false);
  assert.match(a.run('remoteState.lastError'), /Google/);
  assert.equal(a.run('remoteState.session'), null);
});

test('OTP countdown updates labels without replacing the form or clearing a pasted code', () => {
  const a = app(); let tick;
  const code = {value:'123456'};
  const send = {disabled:true,textContent:''};
  const hint = {textContent:''};
  a.context.document.getElementById = id => ({'auth-code-input':code,'auth-send-code-btn':send,'auth-cooldown-hint':hint}[id] || null);
  a.context.setTimeout = fn => { tick = fn; return 1; };
  a.run("renderAuthPanel=()=>{throw new Error('Form must not be rebuilt by countdown')}; startAuthOtpCooldown(60000)");
  tick();
  assert.equal(code.value,'123456');
  assert.match(send.textContent,/Resend in/);
  a.run('setAuthOtpNextSendAt(0)');
  tick();
  assert.equal(send.disabled,false);
  assert.equal(code.value,'123456');
});
