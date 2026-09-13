// Club membership and game permissions are server-authorized.
let clubState = { active: null, revision: null, clubs: [], busy: false, error: null, ready: false };
let clubSaveQueue = Promise.resolve();

function clubsEnabled() { return !!window.TEXASHOLDEM_SUPABASE_CONFIG?.clubsEnabled; }
function clubCanWrite(managerOnly = false) {
  if (clubsEnabled() && !clubState.active) return false;
  if (!clubState.active) return !clubState.busy && !remoteState.loading &&
    (!clubsEnabled() || !isRemoteSignedIn() || remoteState.dataReady);
  return !clubState.busy && clubState.ready && navigator.onLine !== false &&
    clubState.active.status === 'approved' &&
    (clubState.active.owner || (!managerOnly && clubState.active.can_manage_games));
}
function requireClubWrite(managerOnly = false) {
  if (clubCanWrite(managerOnly)) return true;
  if (remoteState.loading || clubState.busy) { safeToast('Syncing. Please wait.'); return false; }
  safeToast(managerOnly ? 'Only the manager can edit club players and settings.' : 'Game access from the manager and an internet connection are required.');
  return false;
}
function clubServiceError(message) {
  const translations = {
    '请先登录': 'Please sign in first.',
    '需要邮箱账号': 'An email account is required.',
    '俱乐部名称需为 1–80 字': 'Club names must be 1–80 characters.',
    '请先同步个人数据，再创建俱乐部': 'Sync personal records before creating a club.',
    '俱乐部不存在': 'Club not found.',
    '需要管理员批准加入俱乐部': 'Membership approval is required.',
    '请选择俱乐部已有玩家': 'Select an existing club player.',
    '只有获授权的成员可以管理比赛': 'Game-management access is required.',
    '记录已被其他人更新，请先从云端刷新后重试': 'Records changed on another device. Refresh and try again.',
    '数据格式无效': 'Invalid data format.',
    '只有管理员可以修改玩家及设置': 'Only the manager can edit players and settings.',
    '玩家已有邮箱绑定，请先由管理员解除绑定再改名或删除': 'The manager must unlink this player before renaming or deleting them.',
    '只有管理员可以执行此操作': 'Only the manager can do this.',
    '不能更改管理员的成员权限': 'The owner’s membership cannot be changed.',
    '无效审核结果': 'Invalid approval status.',
    '不能撤销管理员权限': 'The owner’s access cannot be revoked.',
    '未知俱乐部操作': 'Unknown club action.'
  };
  return translations[message] || message;
}

async function clubRpc(action, args = {}) {
  if (!isRemoteSignedIn()) throw new Error('Please sign in first.');
  const actor = getRemoteUser().id;
  const response = await remoteState.client.rpc('poker_club_action', { action, args });
  if (actor !== getRemoteUser()?.id) throw new Error('Account changed. Please reload.');
  if (response.error) throw new Error(response.error.code === '23505'
    ? 'This player is linked to another account. Ask the manager to check.'
    : response.error.code === '22P02' ? 'Invalid club code. Copy the full code from your manager.'
    : clubServiceError(response.error.message));
  return response.data;
}
function clubPreferenceKey() { return `poker_active_club_${getRemoteUser().id}`; }
async function refreshClubList() {
  clubState.clubs = await clubRpc('list');
  if (clubState.active) {
    clubState.active = clubState.clubs.find(c => c.id === clubState.active.id) ||
      { ...clubState.active, status: 'rejected', can_manage_games: false, owner: false };
  }
  renderClubPanel();
}
function clearClubGameEditors() {
  if (typeof autoSaveTimeout !== 'undefined') { clearTimeout(autoSaveTimeout); autoSaveTimeout = null; }
  if (typeof playerActivitySaveTimer !== 'undefined') { clearTimeout(playerActivitySaveTimer); playerActivitySaveTimer = null; }
  if (typeof stopBlindTimer === 'function') stopBlindTimer();
  if (typeof stopThinkingTimer === 'function') stopThinkingTimer();
  if (typeof isRecording !== 'undefined') isRecording = false;
  if (typeof editingCashGameId !== 'undefined') editingCashGameId = null;
  if (typeof cashSelectedPlayers !== 'undefined') cashSelectedPlayers = new Set();
  if (typeof cashPlayerData !== 'undefined') cashPlayerData = {};
  if (typeof inGameState !== 'undefined') { inGameState.active = false; inGameState.players = []; inGameState.playerData = {}; }
  if (typeof selectedPlayers !== 'undefined') selectedPlayers = new Set();
}
async function prepareClubContext() {
  if (!clubsEnabled() || !isRemoteSignedIn()) return;
  clubState.ready = false;
  await refreshClubList();
  await loadAccountUsername();
  const selected = localStorage.getItem(clubPreferenceKey());
  clubState.active = clubState.clubs.find(c => c.id === selected) ||
    clubState.clubs.find(c => c.status === 'approved') || clubState.clubs.find(c => c.status === 'pending') || null;
  clubState.ready = false;
  clubState.revision = null;
}
async function loadClubData() {
  const c = clubState.active;
  if (!c) return;
  clubState.ready = false;
  // Never display another scope's cached history while authorization is pending.
  clearClubGameEditors();
  data = cloneDefaultData();
  data.players = []; data.tournaments = []; data.cashGames = []; data.activeCashGameId = null;
  renderAppAfterDataChange();
  if (c.status !== 'approved') return;
  const row = await clubRpc('read', { club_id: c.id });
  data = row.payload;
  migrateData(data);
  clubState.revision = row.revision;
  clubState.ready = true;
  remoteState.applyingRemote = true;
  await saveData({ remote: false });
  remoteState.applyingRemote = false;
  setRemoteStatus({ lastSyncedAt: row.updated_at, lastError: null });
  renderAppAfterDataChange();
}
function saveClubData() {
  // Capture scope, actor and data before awaiting anything. Revisions are advanced
  // inside the queue so simultaneous auto-saves cannot race each other.
  const actor = getRemoteUser()?.id;
  const clubId = clubState.active?.id;
  const payload = JSON.parse(JSON.stringify(data));
  const job = async () => {
    if (actor !== getRemoteUser()?.id || clubId !== clubState.active?.id || !clubCanWrite()) return false;
    setRemoteStatus({ saving: true, lastError: null });
    try {
      const row = await clubRpc('save', { club_id: clubId, revision: clubState.revision, payload });
      clubState.revision = row.revision;
      setRemoteStatus({ saving: false, lastSyncedAt: row.updated_at, lastError: null });
      return true;
    } catch (e) {
      // Freeze writes after a conflict or permission revocation. Do not silently
      // overwrite a newer snapshot or report an unsuccessful write as saved.
      clubState.ready = false;
      setRemoteStatus({ saving: false, lastError: e.message });
      safeToast(e.message);
      renderClubPanel();
      return false;
    }
  };
  clubSaveQueue = clubSaveQueue.then(job, job);
  return clubSaveQueue;
}
async function runClubAction(task) {
  if (clubState.busy) return;
  clubState.busy = true; clubState.error = null; renderClubPanel();
  try { await task(); }
  catch (e) { clubState.error = e.message; safeToast(e.message); }
  finally { clubState.busy = false; renderClubPanel(); if (clubState.active?.owner) await showClubMembers(); }
}
async function switchClub(id) {
  if (!id || clubState.busy || remoteState.loading || remoteState.saving) return;
  if (clubState.active && !clubState.ready && clubState.active.status === 'approved') {
    safeToast('Refresh from the cloud, or export unsynced changes first.'); return;
  }
  if (typeof _emergencyFlushCashDebounce === 'function') _emergencyFlushCashDebounce();
  await _saveQueue;
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  if (clubState.active && clubCanWrite() && !(await saveClubData())) return;
  await runClubAction(async () => {
    clearClubGameEditors();
    localStorage.setItem(clubPreferenceKey(), id || '');
    await prepareClubContext();
    if (clubState.active) { STORAGE_KEY = `texasholdem_club_${getRemoteUser().id}_${clubState.active.id}`; await loadClubData(); }
    else await loadRemoteDataIfSignedIn({ preferRemote: true, contextPrepared: true });
  });
}
async function createClub() {
  const name = document.getElementById('club-name').value.trim();
  if (!name || clubState.busy) return;
  await runClubAction(async () => {
    const c = await clubRpc('create', { name });
    localStorage.setItem(clubPreferenceKey(), c.id);
    await prepareClubContext(); STORAGE_KEY = `texasholdem_club_${getRemoteUser().id}_${clubState.active.id}`; await loadClubData();
  });
}
let clubLookupTimer;
let clubLookupGeneration = 0;
let clubLookupResult = null;
function previewJoinClub() {
  clearTimeout(clubLookupTimer);
  const generation = ++clubLookupGeneration;
  clubLookupResult = null;
  const input = document.getElementById('club-code');
  const label = document.getElementById('club-join-preview');
  const button = document.getElementById('club-join-submit');
  const code = input.value.trim().toLowerCase();
  button.disabled = true;
  if (!code) { label.textContent = ''; return; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(code)) {
    label.textContent = 'Enter the complete club code.'; return;
  }
  label.textContent = 'Looking up club…';
  const actor = getRemoteUser()?.id;
  clubLookupTimer = setTimeout(async () => {
    try {
      const { data: club, error } = await remoteState.client.rpc('poker_club_lookup', { club_id: code });
      if (generation !== clubLookupGeneration || actor !== getRemoteUser()?.id || !input.isConnected) return;
      if (error || !club) throw new Error('lookup failed');
      clubLookupResult = { ...club, actor };
      label.textContent = 'Club: ' + club.name;
      button.disabled = false;
    } catch (error) {
      if (generation === clubLookupGeneration && input.isConnected) label.textContent = 'Club not found or unavailable. Check the code and your connection.';
    }
  }, 350);
}

async function requestClubJoin() {
  const club_id = document.getElementById('club-code').value.trim().toLowerCase();
  if (clubLookupResult?.id !== club_id || clubLookupResult.actor !== getRemoteUser()?.id) { previewJoinClub(); return; }
  const display_name = null;
  await runClubAction(async () => {
    const actor = getRemoteUser().id;
    const result = await remoteState.client.rpc('poker_join_club', {club_id,display_name});
    if (result.error) throw new Error(result.error.message);
    if (actor !== getRemoteUser()?.id) throw new Error('Account changed. Please reload.');
    localStorage.setItem(clubPreferenceKey(), club_id);
    await prepareClubContext();
    STORAGE_KEY = `texasholdem_club_${getRemoteUser().id}_${club_id}`;
    await loadClubData();
    safeToast('Request sent. Your player will be added after approval.');
  });
}
async function requestPlayerBinding() {
  const player_name = document.getElementById('club-bind-player').value;
  await runClubAction(async () => {
    await clubRpc(clubState.active.owner ? 'bind' : 'request_binding', { club_id: clubState.active.id, user_id: getRemoteUser().id, player_name });
    await refreshClubList(); safeToast(clubState.active.owner ? 'Player link saved.' : 'Player link request sent.');
  });
}
async function manageClubMember(action, button) {
  const row = button.closest('[data-member]');
  const args = { club_id: clubState.active.id, user_id: row.dataset.member };
  if (action === 'review') args.status = button.dataset.status;
  if (action === 'grant' || action === 'history') args.allowed = button.dataset.allowed === 'true';
  if (action === 'bind') args.player_name = row.querySelector('select').value;
  await _saveQueue;
  await clubSaveQueue;
  await runClubAction(async () => {
    if (action === 'history') {
      const result = await remoteState.client.rpc('poker_grant_history',{club_id:args.club_id,member_id:args.user_id,allowed:args.allowed});
      if(result.error) throw new Error(result.error.message);
    } else await clubRpc(action, args);
    if (action === 'review' && args.status === 'approved') await loadClubData();
    await showClubMembers();
  });
  const playerDialog = document.getElementById('player-details-dialog');
  if (playerDialog?.open) {
    if (action === 'review' || action === 'bind') playerDialog.close();
    else await openPlayerDetails(document.getElementById('player-details-title').textContent);
  }
}
async function showClubMembers() {
  try {
    const members = await clubRpc('members', { club_id: clubState.active.id });
    const panel = document.getElementById('club-members');
    if (!panel) return;
    const others = members.filter(m => m.user_id !== getRemoteUser().id && (m.status !== 'approved' || !m.player_name));
    others.sort((a,b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
    const count = document.getElementById('club-member-count');
    if (count) count.textContent = `${others.length} to review`;
    panel.innerHTML = others.length ? others.map(renderClubMember).join('') : '<p class="club-help">No pending requests.</p>';
  } catch (e) { safeToast(e.message); }
}
function clubPlayerOptions(selected = '') {
  return '<option value="">No player linked</option>' + (data?.players || []).map(p =>
    `<option value="${escapeHtml(p)}" ${p === selected ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
}
function renderClubPanel() {
  const panel = document.getElementById('club-panel');
  if (!panel) return;
  panel.hidden = !clubsEnabled();
  if (!clubsEnabled()) return;
  document.body.classList.toggle('club-required', !clubState.active || clubState.active.status !== 'approved');
  if (!clubState.active) document.body.classList.remove('club-readonly','club-member','club-context');
  if (!isRemoteSignedIn()) { panel.innerHTML = '<p>Sign in to create or join a club.</p>'; return; }
  const membersOpen = document.getElementById('club-members-section')?.open;
  const c = clubState.active;
  panel.innerHTML = `
    <select id="club-selector" aria-label="Current club" onchange="switchClub(this.value)" ${clubState.busy ? 'disabled' : ''}>
    ${!c ? '<option value="" disabled selected>Select a club</option>' : ''}${clubState.clubs.map(x => `<option value="${escapeHtml(x.id)}" ${c?.id === x.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.status === 'pending' ? ' (pending)' : x.status === 'rejected' ? ' (not approved)' : ''}</option>`).join('')}</select>
    ${c?.status === 'approved' ? `<div class="club-code-row"><span>Club code</span><code title="${escapeHtml(c.id)}">${escapeHtml(c.id.slice(0,8))}…${escapeHtml(c.id.slice(-6))}</code><button class="btn btn-sm btn-outline" onclick="copyCurrentClubCode()">Copy</button></div>` : ''}
    <div class="club-overview"><span class="club-badge">${c ? c.owner ? 'Club owner' : c.status !== 'approved' ? 'Awaiting approval' : c.can_manage_games ? 'Game organizer' : c.can_view_history ? 'History access' : 'Member' : 'Join or create a club'}</span></div>
    ${c ? `${c.status === 'approved' ? `
      <p class="club-help">${c.owner || c.can_view_history ? 'You can view club games in History.' : 'The manager can grant history and game access.'}</p>` : '<p class="club-help">The club owner must approve your request before you can view history.</p>'}
      ${c.owner ? '<details class="club-section" id="club-members-section" ontoggle="if(this.open) showClubMembers()"><summary><span>Join requests</span><span class="club-summary-value" id="club-member-count">Approvals</span></summary><p class="club-help">Review requests to join your club.</p><div id="club-members"></div></details>' : ''}` :
      '<p class="club-help">Join a club or create one to get started.</p>'}
    <details ${!c ? 'open' : ''}><summary>${c ? 'Join another club' : 'Join a club'}</summary><input id="club-code" placeholder="Club code from your manager" aria-describedby="club-join-preview" oninput="previewJoinClub()"><p id="club-join-preview" role="status" aria-live="polite"></p><button id="club-join-submit" class="btn btn-sm btn-outline" onclick="requestClubJoin()" disabled>Request to join</button></details>
    <details><summary>Create a club</summary><input id="club-name" maxlength="80" placeholder="Club name"><button class="btn btn-sm btn-primary" onclick="createClub()">Create club</button></details>
    ${c?.owner ? '<details class="club-section"><summary>Club settings</summary><p class="club-help">Only the creator can delete this club.</p><button class="btn btn-sm club-remove" onclick="openDeleteClubDialog()">Delete club</button></details>' : ''}
    ${clubAutoSyncError || remoteState.lastError ? '<div role="status" class="club-help">Could not sync club data. <button class="btn btn-sm btn-outline" onclick="pullRemoteNow()">Retry</button></div>' : ''}
    ${clubState.busy ? '<p>Working…</p>' : ''}${clubState.error ? `<p class="warn">${escapeHtml(clubState.error)}</p>` : ''}`;
  if (membersOpen && document.getElementById('club-members-section')) document.getElementById('club-members-section').open = true;
  const notice = document.getElementById('club-readonly-notice');
  if (notice && c) notice.textContent = c.status !== 'approved'
    ? 'Membership approval is required to view club history.'
    : !clubState.ready ? 'Club data is not synced. Refresh the club in Settings.'
    : 'Read-only access. View all records in History; game access requires manager approval.';
  document.body.classList.toggle('club-readonly', !!c && !clubCanWrite());
  document.body.classList.toggle('club-member', !!c && !c.owner);
  document.body.classList.toggle('club-context', !!c);
}

let clubAutoSyncRunning = false;
let clubAutoSyncRequested = true;
let clubAutoSyncCheckedAt = 0;
let clubAutoSyncError = null;
function clubAutoSyncSafe() {
  return clubsEnabled() && isRemoteSignedIn() && document.visibilityState === 'visible' && navigator.onLine !== false &&
    !clubState.busy && !remoteState.loading && !remoteState.saving && !remoteState.saveTimer && !remoteState.lastError &&
    !document.querySelector('dialog[open], .modal-overlay.open, details[open] select') &&
    !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) &&
    !['club-code','club-name','new-player-name','player-search-input'].some(id => document.getElementById(id)?.value?.trim()) &&
    !(typeof isRecording !== 'undefined' && isRecording) &&
    !(typeof editingCashGameId !== 'undefined' && editingCashGameId !== null) &&
    !(typeof inGameState !== 'undefined' && inGameState.active) &&
    !(typeof cashSelectedPlayers !== 'undefined' && cashSelectedPlayers.size) &&
    !(typeof selectedPlayers !== 'undefined' && selectedPlayers.size) &&
    !(typeof autoSaveTimeout !== 'undefined' && autoSaveTimeout !== null);
}
async function refreshClubAutomatically() {
  if (clubAutoSyncRunning || !clubAutoSyncSafe()) return;
  if (!clubAutoSyncRequested && Date.now() - clubAutoSyncCheckedAt < 30000) return;
  clubAutoSyncRunning = true;
  const actor = getRemoteUser().id, clubId = clubState.active?.id;
  const stillSafe = () => actor === getRemoteUser()?.id && clubId === clubState.active?.id && clubAutoSyncSafe();
  try {
    await _saveQueue;
    await clubSaveQueue;
    if (!stillSafe()) return;
    clubAutoSyncCheckedAt = Date.now();
    clubAutoSyncRequested = false;
    const clubs = await clubRpc('list');
    if (!stillSafe()) { clubAutoSyncRequested = true; return; }
    const current = clubs.find(c => c.id === clubId);
    const row = current?.status === 'approved' ? await clubRpc('read', {club_id:clubId}) : null;
    if (!stillSafe()) { clubAutoSyncRequested = true; return; }
    const changed = JSON.stringify(clubs) !== JSON.stringify(clubState.clubs) ||
      (row && (row.revision !== clubState.revision || !clubState.ready));
    const hadError = !!clubAutoSyncError;
    clubAutoSyncError = null;
    if (changed) await loadRemoteDataIfSignedIn({preferRemote:true});
    else if (hadError) renderClubPanel();
  } catch (error) {
    if (actor === getRemoteUser()?.id && clubId === clubState.active?.id) {
      clubAutoSyncError = 'Could not refresh club data.';
      if (stillSafe()) renderClubPanel();
    }
  } finally { clubAutoSyncRunning = false; }
}
function requestClubAutoSync() {
  clubAutoSyncRequested = true;
  void refreshClubAutomatically();
}
function initClubAutoSync() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestClubAutoSync();
  });
  window.addEventListener('online', requestClubAutoSync);
  window.addEventListener('pageshow', requestClubAutoSync);
  setInterval(() => void refreshClubAutomatically(), 10000);
}

async function copyCurrentClubCode() {
  const club = clubState.active;
  if (!club || club.status !== 'approved') return;
  try {
    await navigator.clipboard.writeText(club.id);
    safeToast('Club code copied');
  } catch (_) { safeToast('Could not copy. Club code: ' + club.id); }
}

let clubDeleteTarget = null;
function openDeleteClubDialog() {
  if (!clubState.active?.owner || !clubCanWrite(true)) return;
  clubDeleteTarget = {id:clubState.active.id,name:clubState.active.name,revision:clubState.revision,actor:getRemoteUser().id};
  const dialog = document.getElementById('delete-club-dialog');
  document.getElementById('delete-club-name').textContent = clubDeleteTarget.name;
  document.getElementById('delete-club-confirmation').value = '';
  document.getElementById('delete-club-error').textContent = '';
  document.getElementById('delete-club-submit').disabled = true;
  document.getElementById('delete-club-cancel').disabled = false;
  dialog.showModal();
}
function updateDeleteClubConfirmation() {
  document.getElementById('delete-club-submit').disabled = clubState.busy ||
    document.getElementById('delete-club-confirmation').value !== clubDeleteTarget?.name;
}
async function deleteCurrentClub() {
  const target = clubDeleteTarget;
  const confirmation = document.getElementById('delete-club-confirmation').value;
  if (!target || confirmation !== target.name || target.actor !== getRemoteUser()?.id ||
      target.id !== clubState.active?.id || !clubState.active.owner || clubState.busy) return;
  clubState.busy = true;
  document.getElementById('delete-club-submit').disabled = true;
  document.getElementById('delete-club-cancel').disabled = true;
  try {
    await _saveQueue;
    await clubSaveQueue;
    if (target.actor !== getRemoteUser()?.id || target.id !== clubState.active?.id) throw new Error('Account or club changed. Close this dialog and try again.');
    const result = await remoteState.client.rpc('poker_delete_club', {
      club_id:target.id,confirmation_name:confirmation,expected_revision:target.revision
    });
    if (result.error) throw new Error(result.error.message);
    document.getElementById('delete-club-dialog').close();
    localStorage.removeItem(`texasholdem_club_${target.actor}_${target.id}`);
    localStorage.removeItem(`poker_active_club_${target.actor}`);
    if (target.actor !== getRemoteUser()?.id) return;
    clearClubGameEditors();
    clubState.active = null; clubState.ready = false; clubState.revision = null;
    clubAutoSyncError = null;
    await loadRemoteDataIfSignedIn({preferRemote:true});
    safeToast('Club deleted');
  } catch (error) {
    document.getElementById('delete-club-error').textContent = error.message;
  } finally {
    clubState.busy = false;
    document.getElementById('delete-club-cancel').disabled = false;
    updateDeleteClubConfirmation();
    renderClubPanel();
  }
}

async function saveAccountClubName() {
  const club = clubState.active;
  if (!isRemoteSignedIn() || clubState.busy) return;
  const actor = getRemoteUser().id;
  const display_name = document.getElementById('account-club-name').value.trim();
  if (remoteState.saveTimer || remoteState.saving || remoteState.lastError || (typeof selectedPlayers !== 'undefined' && selectedPlayers.size) || (typeof isRecording !== 'undefined' && isRecording) || (typeof editingCashGameId !== 'undefined' && editingCashGameId !== null) || (typeof cashSelectedPlayers !== 'undefined' && cashSelectedPlayers.size) || (typeof inGameState !== 'undefined' && inGameState.active)) {
    document.getElementById('account-name-error').textContent = 'Finish and sync the current game or edit before changing your name.'; return;
  }
  clubState.busy = true;
  try {
    await _saveQueue; await clubSaveQueue;
    if (actor !== getRemoteUser()?.id || club?.id !== clubState.active?.id) throw new Error('Account or club changed. Try again.');
    const result = await remoteState.client.rpc('poker_account_profile',{action:'set',username:display_name});
    if (result.error) throw new Error(result.error.message);
    if (actor !== getRemoteUser()?.id) return;
    accountUsername = {actor,username:result.data?.username || ''};
    closeLoginDialog();
    await refreshClubList(); if (clubState.active) await loadClubData();
    safeToast('Name saved');
  } catch(error) { document.getElementById('account-name-error').textContent=error.message; }
  finally { clubState.busy=false; renderClubPanel(); }
}

let accountUsername = {actor:null,username:''};
async function loadAccountUsername() {
 const actor=getRemoteUser()?.id;
 if (!actor) return;
 const result=await remoteState.client.rpc('poker_account_profile',{action:'get'});
 if (actor!==getRemoteUser()?.id) return;
 if (result.error) throw new Error(result.error.message);
 accountUsername={actor,username:result.data?.username || ''};
}

function renderClubMember(m) { return `<details class="club-person" data-member="${escapeHtml(m.user_id)}">
      <summary><span class="club-person-info"><strong>${escapeHtml(m.email)}</strong><span>${escapeHtml(m.player_name || 'No player linked')}</span></span><span class="club-badge ${m.status === 'pending' ? 'pending' : ''}">${m.status === 'pending' ? 'Pending approval' : m.status === 'rejected' ? 'Removed' : m.can_manage_games ? 'Organizer' : m.can_view_history ? 'History access' : 'Member'}</span></summary>
      <div class="club-person-controls">
      ${m.status !== 'approved' ? `<p class="club-help">${m.status === 'pending' ? 'Approval adds this member to Players. Grant history or game access separately.' : 'This account no longer has access.'}</p><div class="club-actions"><button class="btn btn-sm btn-primary" data-status="approved" onclick="manageClubMember('review',this)">Approve membership</button>${m.status === 'pending' ? '<button class="btn btn-sm btn-outline" data-status="rejected" onclick="manageClubMember(\'review\',this)">Decline</button>' : ''}</div>` : `
      <label class="club-field-label">Linked player</label>
      ${m.requested_player_name ? `<p class="club-request">Requested: ${escapeHtml(m.requested_player_name)}</p>` : ''}
      <select aria-label="Linked player for ${escapeHtml(m.email)}">${clubPlayerOptions(m.requested_player_name || m.player_name)}</select>
      <button class="btn btn-sm btn-outline" onclick="manageClubMember('bind',this)">Save player link</button>
      <div class="club-access"><div><strong>View history</strong><p class="club-help">${m.can_view_history ? 'Can view club history.' : 'No history access.'}</p></div><button class="btn btn-sm btn-outline" data-allowed="${!m.can_view_history}" onclick="manageClubMember('history',this)">${m.can_view_history ? 'Revoke history access' : 'Allow history access'}</button></div>
      <div class="club-access"><div><strong>Manage games</strong><p class="club-help">${m.can_manage_games ? 'Can start, edit and delete games.' : 'Cannot manage games.'}</p></div><button class="btn btn-sm btn-outline" data-allowed="${!m.can_manage_games}" onclick="manageClubMember('grant',this)">${m.can_manage_games ? 'Revoke access' : 'Allow access'}</button></div>
      <button class="btn btn-sm club-remove" data-status="rejected" onclick="manageClubMember('review',this)">Remove member</button>`}
      </div></details>`; }
