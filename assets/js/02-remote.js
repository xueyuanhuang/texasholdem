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
  if (!value) return 'Not synced yet';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not synced yet';
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
    const seconds = getAuthOtpCooldownSeconds();
    const button = document.getElementById('auth-send-code-btn');
    const hint = document.getElementById('auth-cooldown-hint');
    if (button && !remoteState.loading && !remoteState.oauthPending) {
      button.disabled = seconds > 0;
      button.textContent = seconds > 0 ? `Resend in ${seconds}s` : 'Resend code';
    }
    if (hint) hint.textContent = seconds > 0 ? `Request another code in ${seconds}s.` : '';
    scheduleAuthOtpCountdown();
  }, 1000);
}

function getFriendlyAuthError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (/token has expired|expired or invalid|invalid/i.test(message)) {
    return 'The code is invalid or expired. Use the code in the most recent email.';
  }
  if (/after \d+ seconds|rate limit|429|too many/i.test(message)) {
    return 'Too many code requests. Try again later.';
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
      lastError: cfg.enabled ? 'Cloud configuration is incomplete' : null
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
    remoteState.lastError = 'Google sign-in was not completed. Try again or use an email code.';
  }
  client.auth.onAuthStateChange((_event, session) => {
    const oldUserId = remoteState.session && remoteState.session.user && remoteState.session.user.id;
    const newUserId = session && session.user && session.user.id;
    setRemoteStatus({ session, lastError: session ? null : remoteState.lastError });
    if (newUserId && newUserId !== oldUserId) {
      closeLoginDialog();
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
    setRemoteStatus({ oauthPending: false, lastError: 'Google sign-in was not completed. Try again or use an email code.' });
    safeToast('Google sign-in was not completed');
  }
}

async function sendLoginCode() {
  if (!remoteState.configured || !remoteState.client) {
    safeToast('Cloud sync is not configured');
    renderAuthPanel();
    return;
  }

  const emailInput = document.getElementById('auth-email-input');
  const email = String(emailInput && emailInput.value || '').trim();
  if (!email || !email.includes('@')) {
    safeToast('Enter a valid email address.');
    return;
  }

  const cooldownSeconds = getAuthOtpCooldownSeconds();
  if (cooldownSeconds > 0) {
    safeToast(`Request another code in ${cooldownSeconds}s.`);
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
    safeToast('Could not send code');
    return;
  }

  startAuthOtpCooldown();
  setRemoteStatus({ loading: false, loginEmailSentTo: email });
  safeToast('Code sent');
}

async function verifyLoginCode() {
  if (!remoteState.configured || !remoteState.client) {
    safeToast('Cloud sync is not configured');
    renderAuthPanel();
    return;
  }

  const emailInput = document.getElementById('auth-email-input');
  const tokenInput = document.getElementById('auth-code-input');
  const email = String((emailInput && emailInput.value) || remoteState.loginEmailSentTo || '').trim();
  const token = String(tokenInput && tokenInput.value || '').replace(/\D+/g, '');

  if (!email || !email.includes('@')) {
    safeToast('Enter a valid email address.');
    return;
  }
  if (token.length < 6) {
    safeToast('Enter the verification code from your email.');
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
    safeToast('Could not verify code');
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
  safeToast('Signed in');
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
  safeToast('Signed out');
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
      setRemoteStatus({ loading: false });
      switchTab('settings');
      return;
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
    safeToast('Cloud sync failed');
  }
}

function scheduleRemoteSave() {
  if (!isRemoteSignedIn() || remoteState.applyingRemote || remoteState.loading) return;
  if (clubsEnabled() && !clubCanWrite()) return;
  if (remoteState.saveTimer) clearTimeout(remoteState.saveTimer);
  remoteState.saveTimer = setTimeout(() => {
    remoteState.saveTimer = null;
    if (!remoteState.loading) upsertRemoteStateNow();
  }, 800);
}

async function upsertRemoteStateNow() {
  if (!isRemoteSignedIn() || !data) return false;
  if (clubState.active) return saveClubData();
  if (clubsEnabled()) return false;
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
    safeToast('Cloud save failed');
    return false;
  }

  setRemoteStatus({ saving: false, lastSyncedAt: now, lastError: null });
  updateCashRemoteStatus();
  return true;
}

async function pushRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('Please sign in first.');
    return;
  }
  if (await upsertRemoteStateNow()) safeToast('Saved to cloud');
}

async function pullRemoteNow() {
  if (!isRemoteSignedIn()) {
    safeToast('Please sign in first.');
    return;
  }
  if (clubState.active && remoteState.lastError && !confirm('Refresh will replace unsynced local edits with the cloud version. Continue?')) return;
  clearTimeout(remoteState.saveTimer); remoteState.saveTimer = null;
  await clubSaveQueue;
  await loadRemoteDataIfSignedIn({ preferRemote: true });
  if (!remoteState.lastError) { clubAutoSyncError = null; renderClubPanel(); safeToast('Refreshed from cloud'); }
}

function closeLoginDialog() {
  const dialog = document.getElementById('login-dialog');
  if (dialog && dialog.open) dialog.close();
}

function handleAccountAction() {
  renderAuthPanel();
  const dialog = document.getElementById('login-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function renderAuthPanel() {
  const user = getRemoteUser();
  const previousEmail = document.getElementById('auth-email-input');
  const previousCode = document.getElementById('auth-code-input');
  const emailDraft = previousEmail ? previousEmail.value : remoteState.loginEmailSentTo || '';
  const codeDraft = previousCode ? previousCode.value : '';
  const focusedId = document.activeElement?.id;
  const action = document.getElementById('account-action');
  const identity = document.getElementById('account-identity');
  const status = document.getElementById('account-error');
  if (action) {
    action.setAttribute('aria-label', user ? 'Account menu' : 'Sign in / Sign up');
    action.title = user ? user.email || 'Account' : 'Sign in / Sign up';
    const photo = user?.user_metadata?.avatar_url;
    action.innerHTML = user
      ? (typeof photo === 'string' && /^https:\/\//i.test(photo)
        ? `<img src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true">`
        : `<span>${escapeHtml((user.email || 'P').slice(0,1).toUpperCase())}</span>`)
      : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20v-2a6.5 6.5 0 0 1 13 0v2"/></svg>';
    action.disabled = !!remoteState.loading || !!remoteState.saving;
  }
  const dialog = document.getElementById('login-dialog');
  if (dialog) { dialog.classList.toggle('account-menu', !!user); dialog.setAttribute('aria-label', user ? 'Account menu' : 'Sign in / Sign up'); }
  if (identity) {
    identity.textContent = user ? user.email || 'Signed in' : '';
    identity.title = identity.textContent;
  }
  if (status) {
    status.textContent = user && remoteState.lastError ? remoteState.lastError : '';
    status.hidden = !status.textContent;
  }

  const panel = document.getElementById('auth-panel');
  if (!panel) return;

  if (!remoteState.configured) {
    panel.innerHTML = `
      <div class="auth-status muted">Local mode</div>
      <div class="auth-help">Cloud sync is not configured. Complete <code>assets/js/00-supabase-config.js</code> to enable email sign-in and cloud sync.</div>
    `;
    return;
  }

  if (!user) {
    const emailValue = escapeHtml(emailDraft);
    const isLoading = remoteState.loading || remoteState.oauthPending;
    const cooldownSeconds = getAuthOtpCooldownSeconds();
    const canSendCode = !isLoading && cooldownSeconds <= 0;
    const sendButtonText = isLoading
      ? 'Sending…'
      : cooldownSeconds > 0
        ? `Resend in ${cooldownSeconds}s`
        : remoteState.loginEmailSentTo ? 'Resend code' : 'Send code';
    const sent = remoteState.loginEmailSentTo
      ? `<div class="auth-help ok">Code sent to ${escapeHtml(remoteState.loginEmailSentTo)}. Use the code in the most recent email.</div>`
      : '';
    const cooldown = cooldownSeconds > 0
      ? `<div id="auth-cooldown-hint" class="auth-help">Request another code in ${cooldownSeconds}s.</div>`
      : '';
    const error = remoteState.lastError ? `<div class="auth-help warn">${escapeHtml(remoteState.lastError)}</div>` : '';
    const codeRow = remoteState.loginEmailSentTo
      ? `
        <div class="auth-login-row">
          <input type="text" id="auth-code-input" placeholder="Email verification code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*">
          <button class="btn btn-sm btn-primary" onclick="verifyLoginCode()">${isLoading ? 'Verifying…' : 'Sign in'}</button>
        </div>
      `
      : '';
    panel.innerHTML = `
      <div class="auth-status">Sign in / Sign up</div>
      <button class="btn btn-outline auth-google-btn" onclick="signInWithGoogle()" ${isLoading ? 'disabled' : ''}>${remoteState.oauthPending ? 'Opening Google…' : 'Continue with Google'}</button>
      <div class="auth-help">New users get an account automatically. Or sign in with an email code. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></div>
      <div class="auth-login-row">
        <input type="email" id="auth-email-input" placeholder="you@example.com" inputmode="email" autocomplete="email" value="${emailValue}">
        <button id="auth-send-code-btn" class="btn btn-sm btn-primary" onclick="sendLoginCode()" ${canSendCode ? '' : 'disabled'}>${sendButtonText}</button>
      </div>
      ${codeRow}${sent}${cooldown}${error}
    `;
    const codeInput = document.getElementById('auth-code-input');
    if (codeInput) codeInput.value = codeDraft;
    if (focusedId === 'auth-email-input' || focusedId === 'auth-code-input') document.getElementById(focusedId)?.focus();
    scheduleAuthOtpCountdown();
    return;
  }

  const nameDraft = document.getElementById('login-dialog')?.open ? document.getElementById('account-club-name')?.value : undefined;
  panel.innerHTML = `${clubState.active?.status === 'approved' ? `<label class="club-field-label" for="account-club-name">Name in this club</label><input id="account-club-name" maxlength="80" value="${escapeHtml(nameDraft ?? (clubState.active.player_name === user.email ? '' : clubState.active.player_name || ''))}" placeholder="${escapeHtml(user.email || '')}"><p class="club-help">Leave blank to use your email.</p><button class="btn btn-sm btn-primary" onclick="saveAccountClubName()" ${clubState.busy ? 'disabled' : ''}>Save name</button><p id="account-name-error" class="warn" role="alert"></p>` : ''}<div class="auth-user">${escapeHtml(user.email || 'Signed in')}</div><button class="btn btn-outline" onclick="signOutRemote().then(() => closeLoginDialog())">Sign out</button>`;
}

function updateCashRemoteStatus() {
  const el = document.getElementById('cash-remote-status');
  if (!el) return;
  if (!remoteState.configured) {
    el.textContent = 'Saved locally';
    el.className = 'remote-pill muted';
    return;
  }
  if (!isRemoteSignedIn()) {
    el.textContent = 'Not signed in';
    el.className = 'remote-pill muted';
    return;
  }
  if (remoteState.saving) {
    el.textContent = 'Saving to cloud';
    el.className = 'remote-pill';
    return;
  }
  if (remoteState.lastError) {
    el.textContent = 'Sync error';
    el.className = 'remote-pill warn';
    return;
  }
  el.textContent = `Cloud connected`;
  el.className = 'remote-pill ok';
}

function renderAppAfterDataChange() {
  if (clubsEnabled() && (!clubState.active || clubState.active.status !== 'approved')) {
    switchTab('settings');
    return;
  }
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

function dismissAccountOutside(event) {
  const dialog = document.getElementById('login-dialog');
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeLoginDialog();
}
