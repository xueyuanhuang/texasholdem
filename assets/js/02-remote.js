// ====== Supabase Auth + Remote Sync ======
const REMOTE_DEFAULT_TABLE = 'texasholdem_user_states';
const REMOTE_PLACEHOLDER_VALUES = new Set(['', 'YOUR_SUPABASE_URL', 'YOUR_SUPABASE_ANON_KEY']);
const AUTH_OTP_COOLDOWN_MS = 60000;
const AUTH_OTP_COOLDOWN_STORAGE_KEY = 'texasholdem_auth_otp_next_send_at';

let authOtpCountdownTimer = null;

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
  applyingRemote: false,
  dataReady: false,
  oauthPending: false
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

function getAuthOtpNextSendAt() {
  try {
    const value = Number(localStorage.getItem(AUTH_OTP_COOLDOWN_STORAGE_KEY) || '0');
    return Number.isFinite(value) ? value : 0;
  } catch (e) {
    return 0;
  }
}

function setAuthOtpNextSendAt(value) {
  try {
    if (value > Date.now()) {
      localStorage.setItem(AUTH_OTP_COOLDOWN_STORAGE_KEY, String(value));
    } else {
      localStorage.removeItem(AUTH_OTP_COOLDOWN_STORAGE_KEY);
    }
  } catch (e) {
    // localStorage can be unavailable in private or constrained WebViews.
  }
}

function getAuthOtpCooldownSeconds() {
  const remaining = getAuthOtpNextSendAt() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

function clearAuthOtpCooldown() {
  if (authOtpCountdownTimer) {
    clearTimeout(authOtpCountdownTimer);
    authOtpCountdownTimer = null;
  }
  setAuthOtpNextSendAt(0);
}

function startAuthOtpCooldown(ms = AUTH_OTP_COOLDOWN_MS) {
  setAuthOtpNextSendAt(Date.now() + ms);
  scheduleAuthOtpCountdown();
}

function scheduleAuthOtpCountdown() {
  if (authOtpCountdownTimer) clearTimeout(authOtpCountdownTimer);
  if (getAuthOtpCooldownSeconds() <= 0) {
    clearAuthOtpCooldown();
    return;
  }
  authOtpCountdownTimer = setTimeout(() => {
    authOtpCountdownTimer = null;
    renderAuthPanel();
  }, 1000);
}

function getFriendlyAuthError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (/token has expired|expired or invalid|invalid/i.test(message)) {
    return '验证码已失效或不匹配。请等待最新邮件到达，只输入最新一封邮件里的验证码。';
  }
  if (/after \d+ seconds|rate limit|429|too many/i.test(message)) {
    return '验证码发送太频繁，请稍后再试。';
  }
  return message;
}

function setRemoteStatus(patch) {
  remoteState = { ...remoteState, ...patch };
  renderAuthPanel();
  renderClubPanel();
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

  const callbackParams = new URLSearchParams(window.location.hash.slice(1));
  const oauthDenied = callbackParams.has('error');
  const { data: sessionData, error } = await client.auth.getSession();
  if (error) {
    setRemoteStatus({ lastError: error.message });
    return;
  }

  remoteState.session = sessionData.session || null;
  if (oauthDenied) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    remoteState.lastError = 'Google 登录未完成，请重试或使用邮箱验证码。';
  }
  client.auth.onAuthStateChange((_event, session) => {
    const oldUserId = remoteState.session && remoteState.session.user && remoteState.session.user.id;
    const newUserId = session && session.user && session.user.id;
    setRemoteStatus({ session, lastError: session ? null : remoteState.lastError });
    if (newUserId && newUserId !== oldUserId) {
      remoteState.dataReady = false;
      clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
      clubState.active = null; clubState.ready = false;
      // Run outside the Supabase auth callback to avoid its session lock.
      setTimeout(() => loadRemoteDataIfSignedIn({ preferRemote: true }), 0);
    }
    if (!newUserId && oldUserId) {
      remoteState.dataReady = false;
      clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
      clearClubGameEditors(); clubState.active = null; clubState.ready = false;
      data = cloneDefaultData();
      data.players = []; data.tournaments = []; data.cashGames = [];
      renderAppAfterDataChange();
    }
  });
}

// Use a full-page redirect so Safari and installed web apps do not depend on popups.
async function signInWithGoogle() {
  if (!remoteState.configured || !remoteState.client || remoteState.loading || remoteState.oauthPending) return;
  setRemoteStatus({ oauthPending: true, lastError: null });
  try {
    const redirectTo = new URL(window.location.pathname, window.location.origin).href;
    const { error } = await remoteState.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } }
    });
    if (error) throw error;
  } catch (error) {
    setRemoteStatus({ oauthPending: false, lastError: 'Google 登录未完成，请重试或使用邮箱验证码。' });
    safeToast('Google 登录未完成');
  }
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

  const cooldownSeconds = getAuthOtpCooldownSeconds();
  if (cooldownSeconds > 0) {
    safeToast(`请等待 ${cooldownSeconds} 秒后再重发`);
    renderAuthPanel();
    return;
  }

  setRemoteStatus({ loading: true, lastError: null });
  const { error } = await remoteState.client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });

  if (error) {
    const message = getFriendlyAuthError(error);
    const match = String(error.message || '').match(/after (\d+) seconds/i);
    if (match) startAuthOtpCooldown(Number(match[1]) * 1000);
    setRemoteStatus({ loading: false, lastError: message });
    safeToast('验证码发送失败');
    return;
  }

  startAuthOtpCooldown();
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
  const token = String(tokenInput && tokenInput.value || '').replace(/\D+/g, '');

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
    setRemoteStatus({ loading: false, lastError: getFriendlyAuthError(error) });
    safeToast('验证码验证失败');
    return;
  }

  clearAuthOtpCooldown();
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
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  await clubSaveQueue;
  setRemoteStatus({ loading: true, lastError: null });
  const { error } = await remoteState.client.auth.signOut();
  if (error) { setRemoteStatus({ loading: false, lastError: error.message }); return; }
  clearClubGameEditors();
  clubState = { active: null, revision: null, clubs: [], busy: false, error: null, ready: false };
  STORAGE_KEY = 'texasholdem_data';
  remoteState.session = null;
  remoteState.loginEmailSentTo = null;
  clearAuthOtpCooldown();
  await loadData();
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
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  const loadingActor = getRemoteUser().id;
  setRemoteStatus({ loading: true, lastError: null });
  await clubSaveQueue;
  remoteState.dataReady = false;
  const preferRemote = options.preferRemote !== false;

  setRemoteStatus({ loading: true, lastError: null });
  try {
    if (clubsEnabled()) {
      clearClubGameEditors();
      data = cloneDefaultData();
      data.players = []; data.tournaments = []; data.cashGames = []; data.activeCashGameId = null;
      renderAppAfterDataChange();
      if (!options.contextPrepared) await prepareClubContext();
      if (clubState.active) {
        STORAGE_KEY = `texasholdem_club_${getRemoteUser().id}_${clubState.active.id}`;
        await loadClubData();
        setRemoteStatus({ loading: false });
        return;
      }
      STORAGE_KEY = `texasholdem_user_${getRemoteUser().id}`;
    }
    const row = await fetchRemoteRow();
    if (loadingActor !== getRemoteUser()?.id) return;
    if (row && row.payload && preferRemote) {
      remoteState.applyingRemote = true;
      data = row.payload;
      migrateData(data);
      if (row.active_cash_game_id && !data.activeCashGameId) {
        data.activeCashGameId = row.active_cash_game_id;
      }
      await saveData({ remote: false });
      remoteState.applyingRemote = false;
      remoteState.dataReady = true;
      setRemoteStatus({ loading: false, lastSyncedAt: row.updated_at || new Date().toISOString() });
      renderAppAfterDataChange();
      return;
    }

    if (!row && clubsEnabled()) {
      await loadData();
    }
    remoteState.dataReady = true;
    await upsertRemoteStateNow();
    setRemoteStatus({ loading: false });
  } catch (e) {
    remoteState.applyingRemote = false;
    setRemoteStatus({ loading: false, lastError: e.message || String(e) });
    safeToast('云端同步失败');
  }
}

function scheduleRemoteSave() {
  if (!isRemoteSignedIn() || remoteState.applyingRemote || remoteState.loading) return;
  if (clubState.active && !clubCanWrite()) return;
  if (remoteState.saveTimer) clearTimeout(remoteState.saveTimer);
  remoteState.saveTimer = setTimeout(() => {
    remoteState.saveTimer = null;
    if (!remoteState.loading) upsertRemoteStateNow();
  }, 800);
}

async function upsertRemoteStateNow() {
  if (!isRemoteSignedIn() || !data) return false;
  if (clubState.active) return saveClubData();
  if (clubsEnabled() && !remoteState.dataReady) {
    safeToast('请先成功加载云端个人记录，再进行同步或创建俱乐部');
    return false;
  }
  const user = getRemoteUser();
  const now = new Date().toISOString();
  setRemoteStatus({ saving: true, lastError: null });

  const { error } = await remoteState.client
    .from(remoteState.tableName)
    .upsert({
      user_id: user.id,
      payload: JSON.parse(JSON.stringify(data)),
      active_cash_game_id: data.activeCashGameId || null,
      updated_at: now
    }, { onConflict: 'user_id' });

  if (error) {
    setRemoteStatus({ saving: false, lastError: error.message });
    safeToast('云端保存失败');
    return false;
  }

  setRemoteStatus({ saving: false, lastSyncedAt: now, lastError: null });
  updateCashRemoteStatus();
  return true;
}

async function pushRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('请先登录');
    return;
  }
  if (await upsertRemoteStateNow()) safeToast('已同步到云端');
}

async function pullRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('请先登录');
    return;
  }
  if (clubState.active && remoteState.lastError && !confirm('刷新将使用云端版本替换本机修改。需要保留本机修改时，请先导出 JSON 备份。继续刷新？')) return;
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  await clubSaveQueue;
  await loadRemoteDataIfSignedIn({ preferRemote: true });
  if (!remoteState.lastError) safeToast('已从云端刷新');
}

function closeLoginDialog() {
  const dialog = document.getElementById('login-dialog');
  if (dialog && dialog.open) dialog.close();
}

function handleAccountAction() {
  if (isRemoteSignedIn()) return signOutRemote();
  renderAuthPanel();
  const dialog = document.getElementById('login-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function renderAuthPanel() {
  const user = getRemoteUser();
  const action = document.getElementById('account-action');
  const identity = document.getElementById('account-identity');
  const status = document.getElementById('account-error');
  if (action) {
    action.textContent = user ? '退出登录' : '登录 / 注册';
    action.disabled = !!remoteState.loading || !!remoteState.saving;
  }
  if (identity) {
    identity.textContent = user ? user.email || '已登录' : '';
    identity.title = identity.textContent;
  }
  if (status) {
    status.textContent = user && remoteState.lastError ? remoteState.lastError : '';
    status.hidden = !status.textContent;
  }
  if (user) closeLoginDialog();
  const panel = document.getElementById('auth-panel');
  if (!panel) return;

  if (!remoteState.configured) {
    panel.innerHTML = `
      <div class="auth-status muted">本地模式</div>
      <div class="auth-help">Supabase 未配置。填好 <code>assets/js/00-supabase-config.js</code> 后可启用邮箱登录与云端同步。</div>
    `;
    return;
  }

  if (!user) {
    const emailValue = escapeHtml(remoteState.loginEmailSentTo || '');
    const isLoading = remoteState.loading || remoteState.oauthPending;
    const cooldownSeconds = getAuthOtpCooldownSeconds();
    const canSendCode = !isLoading && cooldownSeconds <= 0;
    const sendButtonText = isLoading
      ? '发送中...'
      : cooldownSeconds > 0
        ? `${cooldownSeconds}s 后重发`
        : remoteState.loginEmailSentTo ? '重新发送' : '发送验证码';
    const sent = remoteState.loginEmailSentTo
      ? `<div class="auth-help ok">验证码已发送到 ${escapeHtml(remoteState.loginEmailSentTo)}。请等待最新邮件到达，只使用最新一封邮件里的验证码。</div>`
      : '';
    const cooldown = cooldownSeconds > 0
      ? `<div class="auth-help">为避免旧验证码失效，${cooldownSeconds} 秒内不能重新发送。</div>`
      : '';
    const error = remoteState.lastError ? `<div class="auth-help warn">${escapeHtml(remoteState.lastError)}</div>` : '';
    const codeRow = remoteState.loginEmailSentTo
      ? `
        <div class="auth-login-row">
          <input type="text" id="auth-code-input" placeholder="邮件验证码" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*">
          <button class="btn btn-sm btn-primary" onclick="verifyLoginCode()">${isLoading ? '验证中...' : '登录'}</button>
        </div>
      `
      : '';
    panel.innerHTML = `
      <div class="auth-status">登录 / 注册</div>
      <button class="btn btn-outline auth-google-btn" onclick="signInWithGoogle()" ${isLoading ? 'disabled' : ''}>${remoteState.oauthPending ? '正在前往 Google…' : '使用 Google 继续'}</button>
      <div class="auth-help">首次使用会自动创建账号。也可以使用邮箱验证码。<a href="privacy.html" target="_blank" rel="noopener">隐私说明</a></div>
      <div class="auth-login-row">
        <input type="email" id="auth-email-input" placeholder="you@example.com" inputmode="email" autocomplete="email" value="${emailValue}">
        <button class="btn btn-sm btn-primary" onclick="sendLoginCode()" ${canSendCode ? '' : 'disabled'}>${sendButtonText}</button>
      </div>
      ${codeRow}${sent}${cooldown}${error}
    `;
    scheduleAuthOtpCountdown();
    return;
  }

  panel.innerHTML = '';
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
