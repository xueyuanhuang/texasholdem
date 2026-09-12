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
  if (remoteState.loading || clubState.busy) { safeToast('正在同步，请稍候'); return false; }
  safeToast(managerOnly ? '只有管理员可以修改俱乐部玩家及设置' : '需要管理员授予比赛管理权限，并保持联网');
  return false;
}
async function clubRpc(action, args = {}) {
  if (!isRemoteSignedIn()) throw new Error('请先登录');
  const actor = getRemoteUser().id;
  const response = await remoteState.client.rpc('poker_club_action', { action, args });
  if (actor !== getRemoteUser()?.id) throw new Error('账号已切换，请重新加载');
  if (response.error) throw new Error(response.error.code === '23505'
    ? '这个玩家已绑定其他邮箱，请由管理员检查绑定关系'
    : response.error.code === '22P02' ? '俱乐部编号格式不正确，请完整复制管理员提供的编号'
    : response.error.message);
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
    safeToast('请先从云端刷新，或导出未同步修改作为备份'); return;
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
    if (!(await upsertRemoteStateNow())) throw new Error('个人数据同步失败，尚未创建俱乐部');
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
    label.textContent = '请输入完整的俱乐部编号'; return;
  }
  label.textContent = '正在查询俱乐部…';
  const actor = getRemoteUser()?.id;
  clubLookupTimer = setTimeout(async () => {
    try {
      const { data: club, error } = await remoteState.client.rpc('poker_club_lookup', { club_id: code });
      if (generation !== clubLookupGeneration || actor !== getRemoteUser()?.id || !input.isConnected) return;
      if (error || !club) throw new Error('lookup failed');
      clubLookupResult = { ...club, actor };
      label.textContent = '俱乐部：' + club.name;
      button.disabled = false;
    } catch (error) {
      if (generation === clubLookupGeneration && input.isConnected) label.textContent = '未找到俱乐部或暂时无法查询，请检查编号和网络后重试';
    }
  }, 350);
}

async function requestClubJoin() {
  const club_id = document.getElementById('club-code').value.trim().toLowerCase();
  if (clubLookupResult?.id !== club_id || clubLookupResult.actor !== getRemoteUser()?.id) { previewJoinClub(); return; }
  await runClubAction(async () => {
    await clubRpc('join', { club_id });
    await refreshClubList(); safeToast('申请已提交，等待管理员审核');
  });
}
async function requestPlayerBinding() {
  const player_name = document.getElementById('club-bind-player').value;
  await runClubAction(async () => {
    await clubRpc('request_binding', { club_id: clubState.active.id, player_name });
    await refreshClubList(); safeToast('绑定申请已提交');
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
      <strong>${escapeHtml(m.email)}</strong><div>${{approved:'已批准',pending:'待批准',rejected:'已拒绝'}[m.status]} · 绑定：${escapeHtml(m.player_name || '无')}</div>
      ${m.requested_player_name ? `<div>申请绑定：${escapeHtml(m.requested_player_name)}</div>` : ''}
      ${m.user_id !== getRemoteUser().id ? `<button class="btn btn-sm btn-outline" data-status="${m.status === 'approved' ? 'rejected' : 'approved'}" onclick="manageClubMember('review',this)">${m.status === 'approved' ? '移除成员' : '批准加入'}</button>
      ${m.status === 'pending' ? '<button class="btn btn-sm btn-outline" data-status="rejected" onclick="manageClubMember(\'review\',this)">拒绝</button>' : ''}` : ''}
      ${m.status === 'approved' ? `<select aria-label="选择绑定玩家">${clubPlayerOptions(m.player_name || m.requested_player_name)}</select><button class="btn btn-sm btn-outline" onclick="manageClubMember('bind',this)">确认绑定</button>
      ${m.user_id !== getRemoteUser().id ? `<button class="btn btn-sm btn-outline" data-allowed="${!m.can_manage_games}" onclick="manageClubMember('grant',this)">${m.can_manage_games ? '撤销比赛管理权限' : '授予比赛管理权限'}</button>` : ''}` : ''}
    </div>`).join('');
  } catch (e) { safeToast(e.message); }
}
function clubPlayerOptions(selected = '') {
  return '<option value="">未绑定 / 解除绑定</option>' + (data?.players || []).map(p =>
    `<option value="${escapeHtml(p)}" ${p === selected ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
}
function renderClubPanel() {
  const panel = document.getElementById('club-panel');
  if (!panel) return;
  panel.hidden = !clubsEnabled();
  if (!clubsEnabled()) return;
  if (!clubState.active) document.body.classList.remove('club-readonly','club-member','club-context');
  if (!isRemoteSignedIn()) { panel.innerHTML = '<div class="card-title">俱乐部</div><p>使用自己的邮箱登录后创建或加入俱乐部。</p>'; return; }
  const c = clubState.active;
  panel.innerHTML = `<div class="card-title">俱乐部</div>
    <select id="club-selector" aria-label="当前俱乐部" onchange="switchClub(this.value)" ${clubState.busy ? 'disabled' : ''}>
    <option value="">个人记录</option>${clubState.clubs.map(x => `<option value="${escapeHtml(x.id)}" ${c?.id === x.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.status === 'pending' ? '（待批准）' : x.status === 'rejected' ? '（未获批准）' : ''}</option>`).join('')}</select>
    <button class="btn btn-sm btn-outline" onclick="pullRemoteNow()">刷新数据及权限</button>
    ${c ? `<p>${c.owner ? '管理员' : c.can_manage_games ? '比赛管理员' : '只读成员'} · ${c.status === 'approved' ? '可查看全部历史' : '加入申请尚未获批准'}</p>
      ${c.status === 'approved' ? `<p>俱乐部编号：<code>${escapeHtml(c.id)}</code></p><p>绑定玩家：${escapeHtml(c.player_name || '尚未绑定')}</p><select id="club-bind-player" aria-label="申请绑定玩家">${clubPlayerOptions(c.player_name)}</select><button class="btn btn-sm btn-outline" onclick="requestPlayerBinding()">申请绑定</button>${c.requested_player_name ? `<p>待审核：${escapeHtml(c.requested_player_name)}</p>` : ''}` : ''}
      ${c.owner ? '<button class="btn btn-sm btn-primary" onclick="showClubMembers()">成员审批与授权</button><div id="club-members"></div>' : ''}` :
      '<p>创建俱乐部会复制当前账号的玩家和历史，个人记录保留为备份。</p><input id="club-name" maxlength="80" placeholder="俱乐部名称"><button class="btn btn-sm btn-primary" onclick="createClub()">创建俱乐部</button>'}
    <details><summary>申请加入其他俱乐部</summary><input id="club-code" placeholder="管理员提供的俱乐部编号" aria-describedby="club-join-preview" oninput="previewJoinClub()"><p id="club-join-preview" role="status" aria-live="polite"></p><button id="club-join-submit" class="btn btn-sm btn-outline" onclick="requestClubJoin()" disabled>提交加入申请</button></details>
    ${clubState.busy ? '<p>处理中…</p>' : ''}${clubState.error ? `<p class="warn">${escapeHtml(clubState.error)}</p>` : ''}`;
  const notice = document.getElementById('club-readonly-notice');
  if (notice && c) notice.textContent = c.status !== 'approved'
    ? '加入申请尚未获管理员批准，暂时不能查看俱乐部历史。'
    : !clubState.ready ? '俱乐部数据尚未同步。请在设置中刷新数据及权限。'
    : '当前俱乐部为只读权限，可在「历史」查看全部记录。比赛管理权限由管理员授予。';
  document.body.classList.toggle('club-readonly', !!c && !clubCanWrite());
  document.body.classList.toggle('club-member', !!c && !c.owner);
  document.body.classList.toggle('club-context', !!c);
}
