// ====== Supabase Auth + Remote Sync ======
const REMOTE_DEFAULT_TABLE = 'texasholdem_user_states';
const REMOTE_PLACEHOLDER_VALUES = new Set(['', 'YOUR_SUPABASE_URL', 'YOUR_SUPABASE_ANON_KEY']);

let remoteState = {
  configured: false,
  client: null,
  session: null,
  tableName: REMOTE_DEFAULT_TABLE,
  loading: false,
  saving: false,
  lastSyncedAt: null,
  lastError: null,
  loginEmailSentTo: null,
  saveTimer: null,
  applyingRemote: false
};

function getRemoteConfig() {
  const cfg = window.TEXASHOLDEM_SUPABASE_CONFIG || {};
  return {
    enabled: !!cfg.enabled,
    url: String(cfg.url || '').trim(),
    anonKey: String(cfg.anonKey || '').trim(),
    tableName: String(cfg.tableName || REMOTE_DEFAULT_TABLE).trim() || REMOTE_DEFAULT_TABLE
  };
}

function isRemoteConfigUsable(cfg = getRemoteConfig()) {
  return !!(
    cfg.enabled &&
    cfg.url &&
    cfg.anonKey &&
    !REMOTE_PLACEHOLDER_VALUES.has(cfg.url) &&
    !REMOTE_PLACEHOLDER_VALUES.has(cfg.anonKey) &&
    window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
}

function isRemoteSignedIn() {
  return !!(remoteState.configured && remoteState.session && remoteState.session.user);
}

function getRemoteUser() {
  return isRemoteSignedIn() ? remoteState.session.user : null;
}

function formatSyncTime(value) {
  if (!value) return '尚未同步';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '尚未同步';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function safeToast(message) {
  if (typeof showToast === 'function') showToast(message);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setRemoteStatus(patch) {
  remoteState = { ...remoteState, ...patch };
  renderAuthPanel();
  updateCashRemoteStatus();
}

async function initRemoteSync() {
  const cfg = getRemoteConfig();
  remoteState.tableName = cfg.tableName;

  if (!isRemoteConfigUsable(cfg)) {
    setRemoteStatus({
      configured: false,
      client: null,
      session: null,
      lastError: cfg.enabled ? 'Supabase 配置不完整' : null
    });
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  remoteState.client = client;
  remoteState.configured = true;
  remoteState.lastError = null;

  const { data: sessionData, error } = await client.auth.getSession();
  if (error) {
    setRemoteStatus({ lastError: error.message });
    return;
  }

  remoteState.session = sessionData.session || null;
  client.auth.onAuthStateChange((_event, session) => {
    const oldUserId = remoteState.session && remoteState.session.user && remoteState.session.user.id;
    const newUserId = session && session.user && session.user.id;
    setRemoteStatus({ session, lastError: null });
    if (newUserId && newUserId !== oldUserId) {
      loadRemoteDataIfSignedIn({ preferRemote: true });
    }
  });
}

async function sendLoginCode() {
  if (!remoteState.configured || !remoteState.client) {
    safeToast('Supabase 尚未配置');
    renderAuthPanel();
    return;
  }

  const emailInput = document.getElementById('auth-email-input');
  const email = String(emailInput && emailInput.value || '').trim();
  if (!email || !email.includes('@')) {
    safeToast('请输入有效邮箱');
    return;
  }

  setRemoteStatus({ loading: true, lastError: null });
  const { error } = await remoteState.client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });

  if (error) {
    setRemoteStatus({ loading: false, lastError: error.message });
    safeToast('验证码发送失败');
    return;
  }

  setRemoteStatus({ loading: false, loginEmailSentTo: email });
  safeToast('验证码已发送');
}

async function verifyLoginCode() {
  if (!remoteState.configured || !remoteState.client) {
    safeToast('Supabase 尚未配置');
    renderAuthPanel();
    return;
  }

  const emailInput = document.getElementById('auth-email-input');
  const tokenInput = document.getElementById('auth-code-input');
  const email = String((emailInput && emailInput.value) || remoteState.loginEmailSentTo || '').trim();
  const token = String(tokenInput && tokenInput.value || '').replace(/\s+/g, '');

  if (!email || !email.includes('@')) {
    safeToast('请输入有效邮箱');
    return;
  }
  if (token.length < 6) {
    safeToast('请输入邮件中的验证码');
    return;
  }

  setRemoteStatus({ loading: true, lastError: null, loginEmailSentTo: email });
  const { data: authData, error } = await remoteState.client.auth.verifyOtp({
    email,
    token,
    type: 'email'
  });

  if (error) {
    setRemoteStatus({ loading: false, lastError: error.message });
    safeToast('验证码验证失败');
    return;
  }

  setRemoteStatus({
    loading: false,
    session: authData && authData.session ? authData.session : remoteState.session,
    loginEmailSentTo: null,
    lastError: null
  });
  await loadRemoteDataIfSignedIn({ preferRemote: true });
  safeToast('已登录');
}

async function signOutRemote() {
  if (!remoteState.client) return;
  setRemoteStatus({ loading: true, lastError: null });
  await remoteState.client.auth.signOut();
  remoteState.session = null;
  remoteState.loginEmailSentTo = null;
  await clearDataStorage();
  data = cloneDefaultData();
  migrateData(data);
  await saveData({ remote: false });
  setRemoteStatus({ loading: false, lastSyncedAt: null });
  renderAppAfterDataChange();
  safeToast('已退出登录');
}

async function fetchRemoteRow() {
  const user = getRemoteUser();
  if (!user) return null;
  const { data: row, error } = await remoteState.client
    .from(remoteState.tableName)
    .select('payload, active_cash_game_id, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  return row || null;
}

async function loadRemoteDataIfSignedIn(options = {}) {
  if (!isRemoteSignedIn() || remoteState.loading) return;
  const preferRemote = options.preferRemote !== false;

  setRemoteStatus({ loading: true, lastError: null });
  try {
    const row = await fetchRemoteRow();
    if (row && row.payload && preferRemote) {
      remoteState.applyingRemote = true;
      data = row.payload;
      migrateData(data);
      if (row.active_cash_game_id && !data.activeCashGameId) {
        data.activeCashGameId = row.active_cash_game_id;
      }
      await saveData({ remote: false });
      remoteState.applyingRemote = false;
      setRemoteStatus({ loading: false, lastSyncedAt: row.updated_at || new Date().toISOString() });
      renderAppAfterDataChange();
      return;
    }

    await upsertRemoteStateNow();
    setRemoteStatus({ loading: false });
  } catch (e) {
    remoteState.applyingRemote = false;
    setRemoteStatus({ loading: false, lastError: e.message || String(e) });
    safeToast('云端同步失败');
  }
}

function scheduleRemoteSave() {
  if (!isRemoteSignedIn() || remoteState.applyingRemote) return;
  if (remoteState.saveTimer) clearTimeout(remoteState.saveTimer);
  remoteState.saveTimer = setTimeout(() => {
    remoteState.saveTimer = null;
    upsertRemoteStateNow();
  }, 800);
}

async function upsertRemoteStateNow() {
  if (!isRemoteSignedIn() || !data) return;
  const user = getRemoteUser();
  const now = new Date().toISOString();
  setRemoteStatus({ saving: true, lastError: null });

  const { error } = await remoteState.client
    .from(remoteState.tableName)
    .upsert({
      user_id: user.id,
      payload: data,
      active_cash_game_id: data.activeCashGameId || null,
      updated_at: now
    }, { onConflict: 'user_id' });

  if (error) {
    setRemoteStatus({ saving: false, lastError: error.message });
    safeToast('云端保存失败');
    return;
  }

  setRemoteStatus({ saving: false, lastSyncedAt: now, lastError: null });
  updateCashRemoteStatus();
}

async function pushRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('请先登录');
    return;
  }
  await upsertRemoteStateNow();
  safeToast('已同步到云端');
}

async function pullRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('请先登录');
    return;
  }
  await loadRemoteDataIfSignedIn({ preferRemote: true });
  safeToast('已从云端刷新');
}

function renderAuthPanel() {
  const panel = document.getElementById('auth-panel');
  if (!panel) return;

  if (!remoteState.configured) {
    panel.innerHTML = `
      <div class="auth-status muted">本地模式</div>
      <div class="auth-help">Supabase 未配置。填好 <code>assets/js/00-supabase-config.js</code> 后可启用邮箱登录与云端同步。</div>
    `;
    return;
  }

  const user = getRemoteUser();
  if (!user) {
    const emailValue = escapeHtml(remoteState.loginEmailSentTo || '');
    const isLoading = remoteState.loading;
    const sent = remoteState.loginEmailSentTo
      ? `<div class="auth-help ok">验证码已发送到 ${escapeHtml(remoteState.loginEmailSentTo)}，请直接在这里输入验证码。</div>`
      : '';
    const error = remoteState.lastError ? `<div class="auth-help warn">${escapeHtml(remoteState.lastError)}</div>` : '';
    const codeRow = remoteState.loginEmailSentTo
      ? `
        <div class="auth-login-row">
          <input type="text" id="auth-code-input" placeholder="6 位验证码" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
          <button class="btn btn-sm btn-primary" onclick="verifyLoginCode()">${isLoading ? '验证中...' : '登录'}</button>
        </div>
      `
      : '';
    panel.innerHTML = `
      <div class="auth-status">邮箱登录</div>
      <div class="auth-login-row">
        <input type="email" id="auth-email-input" placeholder="you@example.com" inputmode="email" autocomplete="email" value="${emailValue}">
        <button class="btn btn-sm btn-primary" onclick="sendLoginCode()">${remoteState.loginEmailSentTo ? '重新发送' : '发送验证码'}</button>
      </div>
      ${codeRow}${sent}${error}
    `;
    return;
  }

  const syncing = remoteState.saving ? '正在保存...' : remoteState.loading ? '正在同步...' : `上次同步 ${formatSyncTime(remoteState.lastSyncedAt)}`;
  const error = remoteState.lastError ? `<div class="auth-help warn">${escapeHtml(remoteState.lastError)}</div>` : '';
  panel.innerHTML = `
    <div class="auth-status ok">已登录</div>
    <div class="auth-user">${escapeHtml(user.email || user.id)}</div>
    <div class="auth-help">${syncing}</div>
    ${error}
    <div class="auth-actions">
      <button class="btn btn-sm btn-outline" onclick="pullRemoteNow()">从云端刷新</button>
      <button class="btn btn-sm btn-outline" onclick="pushRemoteNow()">立即同步</button>
      <button class="btn btn-sm btn-danger" onclick="signOutRemote()">退出</button>
    </div>
  `;
}

function updateCashRemoteStatus() {
  const el = document.getElementById('cash-remote-status');
  if (!el) return;
  if (!remoteState.configured) {
    el.textContent = '本地保存';
    el.className = 'remote-pill muted';
    return;
  }
  if (!isRemoteSignedIn()) {
    el.textContent = '未登录';
    el.className = 'remote-pill muted';
    return;
  }
  if (remoteState.saving) {
    el.textContent = '云端保存中';
    el.className = 'remote-pill';
    return;
  }
  if (remoteState.lastError) {
    el.textContent = '同步异常';
    el.className = 'remote-pill warn';
    return;
  }
  el.textContent = `云端已连接`;
  el.className = 'remote-pill ok';
}

function renderAppAfterDataChange() {
  if (typeof renderEntryPage === 'function') renderEntryPage();
  if (typeof updateTournamentSettingsSummary === 'function') updateTournamentSettingsSummary();
  if (typeof renderCashPage === 'function' && currentMatchMode === 'cash') renderCashPage();
  const historyPage = document.getElementById('page-history');
  if (historyPage && historyPage.classList.contains('active') && typeof renderHistory === 'function') {
    renderHistory();
  }
  const settingsPage = document.getElementById('page-settings');
  if (settingsPage && settingsPage.classList.contains('active') && typeof renderSettings === 'function') {
    renderSettings();
  } else {
    renderAuthPanel();
  }
}
