// Profile photos are separate from game snapshots and never saved to localStorage.
let accountAvatar = {actor:null,loaded:false,loading:false,busy:false,photo:'',thumbnail:'',error:''};
let clubAvatars = {scope:'',loadedAt:0,loading:false,photos:new Map()};
let avatarViewer = {generation:0,scope:'',scale:1,baseWidth:0,baseHeight:0};

function validAvatarImage(value) {
  return typeof value === 'string' && value.length <= 350000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value);
}
function avatarScope() {
  const actor=getRemoteUser()?.id, club=clubState.active;
  return actor && club?.status==='approved' ? `${actor}:${club.id}` : '';
}
function avatarImageHtml(photo, name) {
  const initial=Array.from(String(name || 'P').trim())[0] || 'P';
  return `<span class="avatar-initial" aria-hidden="true">${escapeHtml(initial.toUpperCase())}</span>` +
    (validAvatarImage(photo) ? `<img src="${escapeHtml(photo)}" alt="" onerror="this.remove()">` : '');
}
function currentAccountPhoto() {
  return accountAvatar.actor===getRemoteUser()?.id ? accountAvatar.thumbnail : '';
}
function syncAvatarAccount() {
  const actor=getRemoteUser()?.id || null;
  if (accountAvatar.actor!==actor) {
    accountAvatar={actor,loaded:false,loading:false,busy:false,photo:'',thumbnail:'',error:''};
    clubAvatars={scope:'',loadedAt:0,loading:false,photos:new Map()};
    document.getElementById('avatar-viewer-dialog')?.close();
  }
  if (avatarViewer.scope && avatarViewer.scope!==avatarScope()) document.getElementById('avatar-viewer-dialog')?.close();
  if (actor && !accountAvatar.loaded && !accountAvatar.loading) void loadAccountAvatar();
}
async function loadAccountAvatar() {
  const state=accountAvatar, actor=getRemoteUser()?.id;
  if (!actor || actor!==state.actor || state.loading || state.busy) return;
  state.loading=true;
  try {
    const result=await remoteState.client.rpc('poker_account_avatar',{action:'get'});
    if (state!==accountAvatar || actor!==getRemoteUser()?.id) return;
    if (result.error) throw new Error('Could not load your photo. Try again.');
    state.photo=validAvatarImage(result.data?.photo)?result.data.photo:'';
    state.thumbnail=validAvatarImage(result.data?.thumbnail)?result.data.thumbnail:'';
    state.error='';
  } catch(error) { if (state===accountAvatar) state.error=error.message; }
  finally {
    state.loading=false;state.loaded=true;
    if (state===accountAvatar && actor===getRemoteUser()?.id) renderAuthPanel();
  }
}
function renderAccountAvatarEditor() {
  const state=accountAvatar, name=getRemoteUser()?.email || 'Player';
  return `<div class="account-photo-editor">
    <span class="player-avatar account-photo-preview">${avatarImageHtml(currentAccountPhoto(),name)}</span>
    <div><strong>Profile photo</strong><p class="club-help">Shown to players in your clubs.</p>
      <input id="account-photo-file" type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="uploadAccountAvatar(this)">
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('account-photo-file').click()" ${state.busy || state.loading ? 'disabled' : ''}>${state.busy ? 'Saving…' : state.photo ? 'Change photo' : 'Upload photo'}</button>
      ${state.photo ? `<button class="btn btn-sm btn-outline" onclick="saveAccountAvatar(null)" ${state.busy?'disabled':''}>Remove photo</button>` : ''}
    </div></div><p class="club-help">JPG, PNG or WebP · up to 10 MB</p>
    ${state.error ? `<p class="warn" role="alert">${escapeHtml(state.error)} <button class="btn btn-sm btn-outline" onclick="loadAccountAvatar()">Retry</button></p>` : ''}`;
}
function avatarUploadError(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) return 'Choose a JPG, PNG or WebP image.';
  if (!file.size || file.size>10*1024*1024) return 'Choose an image smaller than 10 MB.';
  return '';
}
async function prepareAvatarImage(file) {
  const error=avatarUploadError(file);
  if (error) throw new Error(error);
  const url=URL.createObjectURL(file), image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('This image could not be opened. Choose another photo.'));image.src=url;});
    const w=image.naturalWidth,h=image.naturalHeight;
    if (!w || !h || w*h>40000000) throw new Error('Choose a photo with a smaller resolution.');
    function encode(maxSize, maxBytes, square=false) {
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      if (!context) throw new Error('Photo upload is not supported in this browser.');
      let size=maxSize;
      for (let attempt=0;attempt<4;attempt++,size=Math.round(size*.75)) {
        const ratio=Math.min(1,size/Math.max(w,h));
        canvas.width=square?size:Math.max(1,Math.round(w*ratio));
        canvas.height=square?size:Math.max(1,Math.round(h*ratio));
        context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
        if (square) { const side=Math.min(w,h);context.drawImage(image,(w-side)/2,(h-side)/2,side,side,0,0,size,size); }
        else context.drawImage(image,0,0,canvas.width,canvas.height);
        for (const quality of [.85,.7,.55]) {
          const result=canvas.toDataURL('image/jpeg',quality);
          if (validAvatarImage(result) && (result.length-23)*3/4<=maxBytes) return result;
        }
      }
      throw new Error('This photo is too large. Choose a smaller image.');
    }
    return {photo:encode(1024,262144),thumbnail:encode(96,24576,true)};
  } finally { URL.revokeObjectURL(url); }
}
async function uploadAccountAvatar(input) {
  const file=input.files?.[0];input.value='';
  if (file) await saveAccountAvatar(file);
}
async function saveAccountAvatar(file) {
  const state=accountAvatar, actor=getRemoteUser()?.id;
  if (!actor || state.actor!==actor || state.busy || state.loading) return;
  state.busy=true;state.error='';renderAuthPanel();
  try {
    if (navigator.onLine===false) throw new Error('Connect to the internet to save your photo.');
    const images=file?await prepareAvatarImage(file):{};
    if (state!==accountAvatar || actor!==getRemoteUser()?.id) return;
    const result=await remoteState.client.rpc('poker_account_avatar',{action:file?'set':'remove',...images});
    if (state!==accountAvatar || actor!==getRemoteUser()?.id) return;
    if (result.error) throw new Error('Could not save your photo. Please try again.');
    state.photo=validAvatarImage(result.data?.photo)?result.data.photo:'';
    state.thumbnail=validAvatarImage(result.data?.thumbnail)?result.data.thumbnail:'';
    clubAvatars={scope:'',loadedAt:0,loading:false,photos:new Map()};
    void loadClubAvatars(true);
    safeToast(file?'Profile photo saved':'Profile photo removed');
  } catch(error) { if (state===accountAvatar && actor===getRemoteUser()?.id) state.error=error.message; }
  finally { state.busy=false;if (state===accountAvatar && actor===getRemoteUser()?.id) renderAuthPanel(); }
}
function playerAvatarPhoto(name) {
  return clubAvatars.scope===avatarScope()?clubAvatars.photos.get(name)||'':'';
}
function renderPlayerAvatar(name) {
  return `<span class="player-avatar" data-player-avatar-name="${escapeHtml(name)}">${avatarImageHtml(playerAvatarPhoto(name),name)}</span>`;
}
function renderHistoryProfilePhoto(name) {
  const hasPhoto=!!playerAvatarPhoto(name);
  return `<button class="profile-photo-button" data-player-name="${escapeHtml(name)}" onclick="openPlayerAvatarImage(this)" aria-label="View ${escapeHtml(name)}’s photo" ${hasPhoto?'':'disabled'}>${renderPlayerAvatar(name)}</button>
    <p class="club-help">${hasPhoto?'Tap photo to zoom':'No profile photo'}</p>`;
}
function refreshAvatarElements() {
  document.querySelectorAll('[data-player-avatar-name]').forEach(el=>{el.innerHTML=avatarImageHtml(playerAvatarPhoto(el.dataset.playerAvatarName),el.dataset.playerAvatarName);});
  const dialog=document.getElementById('history-player-dialog'),photo=document.getElementById('history-player-photo');
  if (dialog?.open && photo && dialog.dataset.avatarScope===avatarScope()) photo.innerHTML=renderHistoryProfilePhoto(dialog.dataset.playerName);
}
async function loadClubAvatars(force=false) {
  const scope=avatarScope();
  if (!scope) { clubAvatars={scope:'',loadedAt:0,loading:false,photos:new Map()};refreshAvatarElements();return; }
  if (clubAvatars.scope!==scope) clubAvatars={scope,loadedAt:0,loading:false,photos:new Map()};
  const state=clubAvatars;
  if (state.loading || (!force && state.loadedAt && Date.now()-state.loadedAt<60000)) return;
  state.loading=true;
  try {
    const result=await remoteState.client.rpc('poker_club_avatars',{club_id:clubState.active.id});
    if (scope!==avatarScope() || state!==clubAvatars) return;
    if (result.error) { state.photos=new Map();return; }
    state.photos=new Map((result.data||[]).filter(row=>validAvatarImage(row.thumbnail)).map(row=>[row.player_name,row.thumbnail]));
    state.loadedAt=Date.now();
  } catch(_) { if (state===clubAvatars) state.photos=new Map(); }
  finally { state.loading=false;if (scope===avatarScope() && state===clubAvatars) refreshAvatarElements(); }
}
async function openPlayerAvatarImage(button) {
  const scope=avatarScope(),clubId=clubState.active?.id,name=button.dataset.playerName;
  if (!scope || !name) return;
  const generation=++avatarViewer.generation;
  avatarViewer={generation,scope,scale:1,baseWidth:0,baseHeight:0};
  const dialog=document.getElementById('avatar-viewer-dialog');
  document.getElementById('avatar-viewer-title').textContent=name;
  document.getElementById('avatar-viewer-status').textContent='Loading photo…';
  document.getElementById('avatar-viewer-image').removeAttribute('src');
  document.getElementById('avatar-zoom-controls').hidden=true;
  dialog.showModal();
  try {
    const result=await remoteState.client.rpc('poker_player_avatar',{club_id:clubId,player_name:name});
    if (scope!==avatarScope() || generation!==avatarViewer.generation || !dialog.open) return;
    if (result.error) throw new Error('Could not load this photo. Close and try again.');
    if (!validAvatarImage(result.data?.photo)) throw new Error('This player has no profile photo.');
    document.getElementById('avatar-viewer-image').src=result.data.photo;
  } catch(error) {
    if (generation===avatarViewer.generation && scope===avatarScope() && dialog.open) document.getElementById('avatar-viewer-status').textContent=error.message;
  }
}
function fitAvatarImage() {
  const image=document.getElementById('avatar-viewer-image'),viewport=document.getElementById('avatar-zoom-viewport');
  if (!document.getElementById('avatar-viewer-dialog').open || !image.naturalWidth) return;
  const ratio=Math.min(viewport.clientWidth/image.naturalWidth,viewport.clientHeight/image.naturalHeight,1);
  avatarViewer.baseWidth=image.naturalWidth*ratio;avatarViewer.baseHeight=image.naturalHeight*ratio;
  document.getElementById('avatar-viewer-status').textContent='Use + / − or the slider to zoom. Scroll to move around the photo.';
  document.getElementById('avatar-zoom-controls').hidden=false;
  setAvatarZoom(1);
}
function setAvatarZoom(value) {
  const scale=Math.max(1,Math.min(4,Number(value)||1));
  const viewport=document.getElementById('avatar-zoom-viewport'),stage=document.getElementById('avatar-zoom-stage'),image=document.getElementById('avatar-viewer-image');
  if (!avatarViewer.baseWidth) return;
  const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/Math.max(stage.clientWidth,1);
  const centerY=(viewport.scrollTop+viewport.clientHeight/2)/Math.max(stage.clientHeight,1);
  avatarViewer.scale=scale;
  image.style.width=`${avatarViewer.baseWidth*scale}px`;image.style.height=`${avatarViewer.baseHeight*scale}px`;
  stage.style.width=`${Math.max(viewport.clientWidth,avatarViewer.baseWidth*scale)}px`;
  stage.style.height=`${Math.max(viewport.clientHeight,avatarViewer.baseHeight*scale)}px`;
  viewport.scrollLeft=scale===1?0:centerX*stage.clientWidth-viewport.clientWidth/2;
  viewport.scrollTop=scale===1?0:centerY*stage.clientHeight-viewport.clientHeight/2;
  document.getElementById('avatar-zoom-range').value=String(scale*100);
  document.getElementById('avatar-zoom-value').textContent=`${Math.round(scale*100)}%`;
  document.getElementById('avatar-zoom-out').disabled=scale<=1;
  document.getElementById('avatar-zoom-in').disabled=scale>=4;
}
function clearAvatarViewer() {
  avatarViewer={generation:avatarViewer.generation+1,scope:'',scale:1,baseWidth:0,baseHeight:0};
  document.getElementById('avatar-viewer-image').removeAttribute('src');
}
