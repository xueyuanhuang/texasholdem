// Club membership is server-authorized. Personal mode remains available.
let clubState = { active: null, revision: null, clubs: [], busy: false, error: null, ready: false };
let clubSaveQueue = Promise.resolve();

function clubsEnabled() { return !!window.TEXASHOLDEM_SUPABASE_CONFIG?.clubsEnabled; }
function clubCanWrite(managerOnly = false) {
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
  const selected = localStorage.getItem(clubPreferenceKey());
  clubState.active = clubState.clubs.find(c => c.id === selected) || null;
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
  if (clubState.busy || remoteState.loading || remoteState.saving) return;
  if (clubState.active && !clubState.ready && clubState.active.status === 'approved') {
    safeToast('Refresh from the cloud, or export unsynced changes first.'); return;
  }
  if (typeof _emergencyFlushCashDebounce === 'function') _emergencyFlushCashDebounce();
  await _saveQueue;
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  if (clubState.active && clubCanWrite() && !(await saveClubData())) return;
  if (!clubState.active && !(await upsertRemoteStateNow())) return;
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
  if (!name || clubState.active || clubState.busy) return;
  await runClubAction(async () => {
    // Ensure the migration source is the owner's latest personal snapshot.
    if (!(await upsertRemoteStateNow())) throw new Error('Personal records could not sync. The club was not created.');
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
  await runClubAction(async () => {
    await clubRpc('join', { club_id });
    await refreshClubList(); safeToast('Request sent. Waiting for manager approval.');
  });
}
async function requestPlayerBinding() {
  const player_name = document.getElementById('club-bind-player').value;
  await runClubAction(async () => {
    await clubRpc('request_binding', { club_id: clubState.active.id, player_name });
    await refreshClubList(); safeToast('Player link request sent.');
  });
}
async function manageClubMember(action, button) {
  const row = button.closest('[data-member]');
  const args = { club_id: clubState.active.id, user_id: row.dataset.member };
  if (action === 'review') args.status = button.dataset.status;
  if (action === 'grant') args.allowed = button.dataset.allowed === 'true';
  if (action === 'bind') args.player_name = row.querySelector('select').value;
  await runClubAction(async () => { await clubRpc(action, args); await showClubMembers(); });
}
async function showClubMembers() {
  try {
    const members = await clubRpc('members', { club_id: clubState.active.id });
    const panel = document.getElementById('club-members');
    if (!panel) return;
    panel.innerHTML = members.map(m => `<div class="club-member" data-member="${escapeHtml(m.user_id)}">
      <strong>${escapeHtml(m.email)}</strong><div>${{approved:'Approved',pending:'Pending',rejected:'Rejected'}[m.status]} · Linked player: ${escapeHtml(m.player_name || 'None')}</div>
      ${m.requested_player_name ? `<div>Request player link：${escapeHtml(m.requested_player_name)}</div>` : ''}
      ${m.user_id !== getRemoteUser().id ? `<button class="btn btn-sm btn-outline" data-status="${m.status === 'approved' ? 'rejected' : 'approved'}" onclick="manageClubMember('review',this)">${m.status === 'approved' ? 'Remove member' : 'Approve membership'}</button>
      ${m.status === 'pending' ? '<button class="btn btn-sm btn-outline" data-status="rejected" onclick="manageClubMember(\'review\',this)">Reject</button>' : ''}` : ''}
      ${m.status === 'approved' ? `<select aria-label="Select linked player">${clubPlayerOptions(m.player_name || m.requested_player_name)}</select><button class="btn btn-sm btn-outline" onclick="manageClubMember('bind',this)">Confirm link</button>
      ${m.user_id !== getRemoteUser().id ? `<button class="btn btn-sm btn-outline" data-allowed="${!m.can_manage_games}" onclick="manageClubMember('grant',this)">${m.can_manage_games ? 'Revoke game access' : 'Grant game access'}</button>` : ''}` : ''}
    </div>`).join('');
  } catch (e) { safeToast(e.message); }
}
function clubPlayerOptions(selected = '') {
  return '<option value="">No player / Unlink</option>' + (data?.players || []).map(p =>
    `<option value="${escapeHtml(p)}" ${p === selected ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
}
function renderClubPanel() {
  const panel = document.getElementById('club-panel');
  if (!panel) return;
  panel.hidden = !clubsEnabled();
  if (!clubsEnabled()) return;
  if (!clubState.active) document.body.classList.remove('club-readonly','club-member','club-context');
  if (!isRemoteSignedIn()) { panel.innerHTML = '<p>Sign in to create or join a club.</p>'; return; }
  const c = clubState.active;
  panel.innerHTML = `
    <select id="club-selector" aria-label="Current club" onchange="switchClub(this.value)" ${clubState.busy ? 'disabled' : ''}>
    <option value="">Personal records</option>${clubState.clubs.map(x => `<option value="${escapeHtml(x.id)}" ${c?.id === x.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.status === 'pending' ? ' (pending)' : x.status === 'rejected' ? ' (not approved)' : ''}</option>`).join('')}</select>
    <button class="btn btn-sm btn-outline" onclick="pullRemoteNow()">Refresh club</button>
    ${c ? `<p>${c.owner ? 'Manager' : c.can_manage_games ? 'Game organizer' : 'Read-only member'} · ${c.status === 'approved' ? 'Can view all history' : 'Membership pending approval'}</p>
      ${c.status === 'approved' ? `<p>Club code: <code>${escapeHtml(c.id)}</code></p><p>Linked player: ${escapeHtml(c.player_name || 'Not linked')}</p><select id="club-bind-player" aria-label="Choose a player to link">${clubPlayerOptions(c.player_name)}</select><button class="btn btn-sm btn-outline" onclick="requestPlayerBinding()">Request player link</button>${c.requested_player_name ? `<p>Pending: ${escapeHtml(c.requested_player_name)}</p>` : ''}` : ''}
      ${c.owner ? '<button class="btn btn-sm btn-primary" onclick="showClubMembers()">Manage members</button><div id="club-members"></div>' : ''}` :
      '<p>Create a club from your players and history. Your personal records are kept as a backup.</p><input id="club-name" maxlength="80" placeholder="Club name"><button class="btn btn-sm btn-primary" onclick="createClub()">Create club</button>'}
    <details><summary>Join another club</summary><input id="club-code" placeholder="Club code from your manager" aria-describedby="club-join-preview" oninput="previewJoinClub()"><p id="club-join-preview" role="status" aria-live="polite"></p><button id="club-join-submit" class="btn btn-sm btn-outline" onclick="requestClubJoin()" disabled>Request to join</button></details>
    ${clubState.busy ? '<p>Working…</p>' : ''}${clubState.error ? `<p class="warn">${escapeHtml(clubState.error)}</p>` : ''}`;
  const notice = document.getElementById('club-readonly-notice');
  if (notice && c) notice.textContent = c.status !== 'approved'
    ? 'Membership approval is required to view club history.'
    : !clubState.ready ? 'Club data is not synced. Refresh the club in Settings.'
    : 'Read-only access. View all records in History; game access requires manager approval.';
  document.body.classList.toggle('club-readonly', !!c && !clubCanWrite());
  document.body.classList.toggle('club-member', !!c && !c.owner);
  document.body.classList.toggle('club-context', !!c);
}
