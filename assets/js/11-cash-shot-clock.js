// Shared cash-game clocks are independent of the editable game snapshot.
let cashShotClockState = {
  scope: '', generation: 0, games: new Map(), expanded: new Set(), pending: new Map(),
  errors: new Map(), stale: new Set(), updatedAt: new Map(), reading: null, anchor: null, started: false, audio: null,
  wakeLock: null, wakeAttempt: '', owned: null, screen: null, screenRequest: null
};

function cashShotClockScope() {
  const actor = typeof getRemoteUser === 'function' && getRemoteUser()?.id;
  const club = typeof clubState !== 'undefined' && clubState.active;
  return actor && club?.status === 'approved' ? `${actor}:${club.id}` : '';
}
function cashShotClockMonotonic() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
function cashShotClockNow() {
  const anchor = cashShotClockState.anchor;
  return anchor ? anchor.server + Math.max(0, cashShotClockMonotonic() - anchor.local) : Date.now();
}
function cashShotClockRemaining(timer) {
  return timer?.status === 'running' ? Math.max(0, Math.ceil((Date.parse(timer.ends_at) - cashShotClockNow()) / 1000)) : 0;
}
function cashShotClockExpiryVisible(timer) {
  const elapsed = cashShotClockNow() - Date.parse(timer?.ends_at);
  return !!timer && timer.status !== 'stopped' && elapsed >= 0 && elapsed < 2000;
}
function cashShotClockKey(gameId, name) { return JSON.stringify([String(gameId), String(name)]); }
function cashShotClockContext() {
  const scope = cashShotClockScope();
  if (scope !== cashShotClockState.scope) clearCashShotClockContext();
  return scope;
}
function clearCashShotClockContext() {
  closeCashShotClockScreen();
  cashShotClockState.generation++;
  cashShotClockState.scope = cashShotClockScope();
  cashShotClockState.games.clear();
  cashShotClockState.expanded.clear();
  cashShotClockState.pending.clear();
  cashShotClockState.errors.clear();
  cashShotClockState.stale.clear();
  cashShotClockState.updatedAt.clear();
  cashShotClockState.reading = null;
  cashShotClockState.anchor = null;
  cashShotClockState.wakeAttempt = '';
  releaseCashShotClockWakeLock();
  // The originating tab's saved start IDs survive a refresh, never the shared clock itself.
}
function cashShotClockPlayerId(gameId, name) {
  if (!cashShotClockContext()) return null;
  return cashShotClockState.games.get(String(gameId))?.players?.find(p => p.name === name)?.player_id || null;
}
function cashShotClockCanControl(gameId) {
  if (!cashShotClockContext()) return false;
  const game = cashShotClockState.games.get(String(gameId));
  return !!(game?.active && game.can_control);
}
function cashShotClockIsRunning() {
  if (!cashShotClockContext()) return false;
  return Array.from(cashShotClockState.games.values()).some(game => cashShotClockRemaining(game.timer) > 0) ||
    Array.from(cashShotClockState.pending.values()).some(command => command.action === 'start');
}
function cashShotClockAttributes(gameId, name) {
  return `data-game-id="${escapeHtml(String(gameId))}" data-player-name="${escapeHtml(name)}"`;
}
function cashShotClockView(gameId, name, interactive) {
  const game = cashShotClockState.games.get(String(gameId));
  const player = game?.players?.find(p => p.name === name);
  const expanded = cashShotClockState.expanded.has(cashShotClockKey(gameId, name));
  const pending = cashShotClockState.pending.get(String(gameId));
  const error = cashShotClockState.errors.get(String(gameId));
  const remaining = cashShotClockRemaining(game?.timer);
  const target = !!game?.timer && (player?.player_id === game.timer.player_id || name === game.timer.player_name);
  const enabled = interactive && game?.active && game.can_control;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return {game, player, expanded, pending, error, remaining, target, enabled, offline, expiryVisible: cashShotClockExpiryVisible(game?.timer)};
}
function cashShotClockBody(gameId, name, interactive) {
  const {game, player, expanded, pending, error, remaining, target, enabled, offline, expiryVisible} = cashShotClockView(gameId, name, interactive);
  const attrs = cashShotClockAttributes(gameId, name);
  let html = game?.tracked && player ? `<span class="cash-shot-clock-count">Timed ${Number(player.count) || 0}×</span>` : '';
  if (interactive && target && game?.active && game.timer.status !== 'stopped') {
    html += remaining > 0
      ? `<span class="cash-shot-clock-live"><button type="button" class="cash-shot-clock-expand" ${attrs} onclick="openCashShotClockScreen(this)" aria-label="Full-screen countdown for ${escapeHtml(name)}"><span class="cash-shot-clock-seconds" data-cash-clock-value aria-label="Seconds remaining">${remaining}s</span><span class="cash-shot-clock-expand-label">Full screen</span></button>${enabled ? `<button type="button" class="btn btn-sm btn-outline cash-shot-clock-stop" ${attrs} onclick="stopCashShotClock(this)" ${offline || pending?.inFlight ? 'disabled' : ''}>${pending?.inFlight && pending.action === 'stop' ? 'Stopping…' : 'Stop'}</button>` : ''}</span>`
      : expiryVisible ? '<span class="cash-shot-clock-expired" role="status">Time’s up</span>' : '';
  }
  if (interactive && expanded) {
    if (!game) html += '<span class="cash-shot-clock-message" role="status">Loading countdown…</span>';
    else if (enabled) {
      const disabled = offline || !!pending?.inFlight || remaining > 0 || (cashShotClockState.stale.has(String(gameId)) && !pending);
      html += `<span class="cash-shot-clock-controls"><button type="button" class="btn btn-sm btn-outline cash-shot-clock-start" ${attrs} data-duration="30" onclick="startCashShotClock(this)" ${disabled ? 'disabled' : ''}>30 seconds</button><button type="button" class="btn btn-sm btn-outline cash-shot-clock-start" ${attrs} data-duration="60" onclick="startCashShotClock(this)" ${disabled ? 'disabled' : ''}>60 seconds</button></span>`;
      if (remaining > 0 && !target) html += `<span class="cash-shot-clock-message">${escapeHtml(game.timer.player_name)} has a running countdown.</span>`;
      if (offline) html += '<span class="cash-shot-clock-message">Reconnect to start or stop a countdown.</span>';
      if (pending && !pending.inFlight) html += '<span class="cash-shot-clock-message">Connection interrupted. Tap the same action to retry safely.</span>';
    } else if (game.active) html += '<span class="cash-shot-clock-message">Only players in this game and organizers can control its countdown.</span>';
  }
  if (interactive && error && (expanded || target)) html += `<span class="cash-shot-clock-error" role="status">${escapeHtml(error)}</span>`;
  return html;
}
function renderCashShotClock(gameId, name, options = {}) {
  const scope = cashShotClockContext();
  if (!scope || gameId === undefined || gameId === null) return '';
  const interactive = options.interactive !== false;
  return `<span class="cash-shot-clock" ${cashShotClockAttributes(gameId, name)} data-cash-shot-clock data-interactive="${interactive ? 'true' : 'false'}">${cashShotClockBody(gameId, name, interactive)}</span>`;
}
function paintCashShotClocks() {
  if (!cashShotClockContext()) return;
  document.querySelectorAll('[data-cash-shot-clock]').forEach(element => {
    const gameId = element.dataset.gameId, name = element.dataset.playerName, interactive = element.dataset.interactive === 'true';
    const view = cashShotClockView(gameId, name, interactive);
    const signature = JSON.stringify([view.game, view.expanded, view.pending?.inFlight, view.pending?.command_id, view.error, view.offline, view.remaining > 0, view.expiryVisible, cashShotClockState.stale.has(gameId)]);
    if (element.dataset.clockSignature !== signature) {
      element.innerHTML = cashShotClockBody(gameId, name, interactive);
      element.dataset.clockSignature = signature;
    }
    const value = element.querySelector('[data-cash-clock-value]');
    if (value && value.textContent !== `${view.remaining}s`) value.textContent = `${view.remaining}s`;
  });
  document.querySelectorAll('[data-cash-clock-toggle]').forEach(button => {
    button.setAttribute('aria-expanded', String(cashShotClockState.expanded.has(cashShotClockKey(button.dataset.gameId, button.dataset.playerName))));
  });
  checkCashShotClockExpiry();
  syncCashShotClockWakeLock();
  paintCashShotClockScreen();
}
function openCashShotClockScreen(button) {
  if (!cashShotClockContext()) return;
  const game = cashShotClockState.games.get(String(button.dataset.gameId));
  if (!game?.active || cashShotClockRemaining(game.timer) <= 0) return;
  cashShotClockState.screen = {gameId: String(game.game_id), timerId: game.timer.id, returnFocus: document.activeElement};
  paintCashShotClockScreen();
}
function closeCashShotClockScreen() {
  const previous = cashShotClockState.screen;
  cashShotClockState.screen = null;
  cashShotClockState.screenRequest = null;
  const dialog = document.getElementById?.('cash-clock-screen');
  if (dialog) {
    if (dialog.open) dialog.close();
    dialog.hidden = true;
  }
  document.body?.classList.remove('cash-clock-screen-open');
  if (previous?.returnFocus?.isConnected) previous.returnFocus.focus({preventScroll: true});
}
function paintCashShotClockScreen() {
  const request = cashShotClockState.screenRequest;
  const requestedGame = request && cashShotClockState.games.get(request.gameId);
  if (request && requestedGame?.timer?.id === request.timerId) {
    cashShotClockState.screenRequest = null;
    if (requestedGame.active && cashShotClockRemaining(requestedGame.timer) > 0) {
      cashShotClockState.screen = {...request, returnFocus: document.activeElement};
    }
  }
  const screen = cashShotClockState.screen;
  if (!screen) return;
  const game = cashShotClockState.games.get(screen.gameId), timer = game?.timer;
  if (!game?.active || timer?.id !== screen.timerId || timer.status === 'stopped' ||
      !game.players?.some(player => player.player_id === timer.player_id)) {
    closeCashShotClockScreen(); return;
  }
  const remaining = cashShotClockRemaining(timer);
  if (!remaining && !cashShotClockExpiryVisible(timer)) { closeCashShotClockScreen(); return; }
  const dialog = document.getElementById?.('cash-clock-screen');
  if (!dialog) return;
  const pending = cashShotClockState.pending.get(screen.gameId), offline = navigator.onLine === false;
  const fraction = remaining ? Math.max(0, Math.min(1, (Date.parse(timer.ends_at) - cashShotClockNow()) / (Number(timer.duration) * 1000))) : 0;
  dialog.style.setProperty('--remaining', String(fraction));
  dialog.style.setProperty('--elapsed', String(1 - fraction));
  dialog.dataset.phase = remaining ? 'running' : 'expired';
  dialog.dataset.urgent = String(remaining > 0 && remaining <= 10);
  const text = (id, value) => {
    const element = document.getElementById(id);
    if (element.textContent !== value) element.textContent = value;
  };
  text('cash-clock-screen-player', timer.player_name);
  text('cash-clock-screen-seconds', String(remaining).padStart(2, '0'));
  text('cash-clock-screen-status', remaining ? 'Seconds remaining' : 'Time’s up');
  const stop = document.getElementById('cash-clock-screen-stop');
  stop.dataset.gameId = screen.gameId;
  stop.hidden = !game.can_control || !remaining;
  stop.disabled = offline || !!pending?.inFlight;
  text('cash-clock-screen-stop', pending?.inFlight && pending.action === 'stop' ? 'Stopping…' : 'Stop countdown');
  text('cash-clock-screen-error', cashShotClockState.errors.get(screen.gameId) || (offline ? 'Reconnect to stop the countdown.' : ''));
  if (!dialog.open) {
    dialog.hidden = false;
    dialog.showModal();
    document.body?.classList.add('cash-clock-screen-open');
    document.getElementById('cash-clock-screen-back').focus({preventScroll: true});
  }
}
function toggleCashShotClock(button) {
  if (!cashShotClockContext()) return;
  const key = cashShotClockKey(button.dataset.gameId, button.dataset.playerName);
  if (cashShotClockState.expanded.has(key)) cashShotClockState.expanded.delete(key);
  else cashShotClockState.expanded.add(key);
  button.setAttribute('aria-expanded', String(cashShotClockState.expanded.has(key)));
  paintCashShotClocks();
  refreshCashShotClocks();
}
function cashShotClockRequestedGames(force) {
  const ids = new Set();
  if (typeof data !== 'undefined') (data.cashGames || []).filter(game => game.status === 'active').forEach(game => ids.add(String(game.id)));
  cashShotClockState.games.forEach(game => { if (game.active) ids.add(String(game.game_id)); });
  document.querySelectorAll('[data-cash-shot-clock]').forEach(element => {
    const id = element.dataset.gameId;
    if (id && (force || !cashShotClockState.games.has(id))) ids.add(id);
  });
  return Array.from(ids);
}
function applyCashShotClockResponse(result, scope, generation, requestStarted, requestedIds = null) {
  if (scope !== cashShotClockScope() || generation !== cashShotClockState.generation) return false;
  const received = cashShotClockMonotonic();
  const server = Date.parse(result?.server_now);
  if (Number.isFinite(server) && (!cashShotClockState.anchor || server >= cashShotClockState.anchor.reported)) {
    // Receipt proves the server has reached this time. Guessing half the request
    // duration can run ahead during a slow request, then rewind on the next poll.
    // Keep elapsed time monotonic; later samples may only advance the clock.
    const current = cashShotClockState.anchor ? cashShotClockNow() : server;
    cashShotClockState.anchor = {server: Math.max(server, current), local: received, reported: server};
  }
  (result?.games || []).forEach(game => {
    const id = String(game.game_id), previous = cashShotClockState.games.get(id);
    if (previous && Number(previous.version) > Number(game.version)) return;
    cashShotClockState.games.set(id, game);
    cashShotClockState.updatedAt.set(id, requestStarted);
    cashShotClockState.stale.delete(id);
    const pending = cashShotClockState.pending.get(id);
    if (pending && (game.timer?.id === pending.command_id || Number(game.version) > pending.expected_version)) cashShotClockState.pending.delete(id);
    // IDs are authoritative metadata only; never save a snapshot merely to hydrate them.
    if (typeof data !== 'undefined') {
      const local = (data.cashGames || []).find(row => String(row.id) === id);
      (game.players || []).forEach(player => {
        const row = local?.players?.find(p => p.name === player.name);
        if (row) row.timerPlayerId = player.player_id;
        if (String(data.activeCashGameId) === id && typeof cashPlayerData !== 'undefined' && cashPlayerData[player.name]) cashPlayerData[player.name].timerPlayerId = player.player_id;
      });
    }
  });
  if (requestedIds) {
    const returned = new Set((result?.games || []).map(game => String(game.game_id)));
    requestedIds.forEach(id => {
      if (!returned.has(id) && (cashShotClockState.updatedAt.get(id) ?? -Infinity) <= requestStarted) {
        cashShotClockState.games.delete(id);
        cashShotClockState.pending.delete(id);
        cashShotClockState.stale.delete(id);
        if (cashShotClockState.screenRequest?.gameId === id) cashShotClockState.screenRequest = null;
      }
    });
  }
  paintCashShotClocks();
  return true;
}
async function refreshCashShotClocks(options = {}) {
  const scope = cashShotClockContext();
  if (!scope || document.visibilityState === 'hidden' || navigator.onLine === false || !remoteState.client) return;
  if (cashShotClockState.reading) return cashShotClockState.reading;
  const ids = cashShotClockRequestedGames(options.force !== false);
  if (!ids.length) return;
  const generation = cashShotClockState.generation, started = cashShotClockMonotonic();
  const read = (async () => {
    try {
      const response = await remoteState.client.rpc('poker_cash_timer', {action: 'read', args: {club_id: clubState.active.id, game_ids: ids}});
      if (response.error) throw response.error;
      if (applyCashShotClockResponse(response.data, scope, generation, started, ids)) ids.forEach(id => cashShotClockState.errors.delete(id));
    } catch (error) {
      if (scope === cashShotClockScope() && generation === cashShotClockState.generation) {
        const rejected = /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(String(error.code || ''));
        ids.forEach(id => {
          cashShotClockState.errors.set(id, rejected ? error.message || 'Countdown access is unavailable.' : 'Countdown could not sync. Reconnect and try again.');
          if (rejected) {
            cashShotClockState.games.delete(id); cashShotClockState.pending.delete(id);
            if (cashShotClockState.screenRequest?.gameId === id) cashShotClockState.screenRequest = null;
          }
          else cashShotClockState.stale.add(id);
        });
        paintCashShotClocks();
      }
    }
  })();
  cashShotClockState.reading = read;
  try { await read; } finally { if (cashShotClockState.reading === read) cashShotClockState.reading = null; }
}
function cashShotClockOwned() {
  if (cashShotClockState.owned) return cashShotClockState.owned;
  try {
    const saved = JSON.parse(sessionStorage.getItem('poker_cash_clock_starts') || '{}');
    cashShotClockState.owned = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  catch (_) { cashShotClockState.owned = {}; }
  return cashShotClockState.owned;
}
function saveCashShotClockOwned() {
  const entries = Object.entries(cashShotClockOwned());
  if (entries.length > 50) cashShotClockState.owned = Object.fromEntries(entries.slice(-50));
  try { sessionStorage.setItem('poker_cash_clock_starts', JSON.stringify(cashShotClockState.owned)); } catch (_) {}
}
function unlockCashShotClockAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!cashShotClockState.audio) cashShotClockState.audio = new Audio();
    const audio = cashShotClockState.audio;
    Promise.resolve(audio.resume()).catch(() => {});
    const silent = audio.createBufferSource();
    silent.buffer = audio.createBuffer(1, 1, 22050); silent.connect(audio.destination); silent.start(0);
  } catch (_) { /* The visual countdown does not depend on sound permission. */ }
}
function beepCashShotClock() {
  try {
    const audio = cashShotClockState.audio;
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.42);
  } catch (_) {}
}
function checkCashShotClockExpiry() {
  if (document.visibilityState === 'hidden') return;
  const owned = cashShotClockOwned();
  cashShotClockState.games.forEach(game => {
    const timer = game.timer, key = timer && `${cashShotClockState.scope}:${timer.id}`, record = key && owned[key];
    if (!record || record.done) return;
    if (timer.status === 'stopped' || !game.active) { record.done = true; saveCashShotClockOwned(); return; }
    if (cashShotClockRemaining(timer) === 0) {
      record.done = true; saveCashShotClockOwned();
      // Avoid a surprise delayed alarm when an old backgrounded tab is reopened.
      if (cashShotClockNow() - Date.parse(timer.ends_at) <= 5000) beepCashShotClock();
    }
  });
}
function releaseCashShotClockWakeLock() {
  const lock = cashShotClockState.wakeLock;
  cashShotClockState.wakeLock = null;
  if (lock) Promise.resolve(lock.release()).catch(() => {});
}
function syncCashShotClockWakeLock() {
  const running = Array.from(cashShotClockState.games.values()).find(game => cashShotClockRemaining(game.timer) > 0);
  if (document.visibilityState === 'hidden' || !running) {
    releaseCashShotClockWakeLock(); cashShotClockState.wakeAttempt = ''; return;
  }
  if (!navigator.wakeLock || cashShotClockState.wakeLock || cashShotClockState.wakeAttempt === running.timer.id) return;
  cashShotClockState.wakeAttempt = running.timer.id;
  const generation = cashShotClockState.generation;
  Promise.resolve(navigator.wakeLock.request('screen')).then(lock => {
    if (generation !== cashShotClockState.generation || document.visibilityState === 'hidden' || !cashShotClockIsRunning()) { lock.release(); return; }
    cashShotClockState.wakeLock = lock;
    lock.addEventListener?.('release', () => { if (cashShotClockState.wakeLock === lock) cashShotClockState.wakeLock = null; });
  }).catch(() => {});
}
function startCashShotClock(button) {
  unlockCashShotClockAudio();
  const duration = Number(button.dataset.duration);
  if (![30, 60].includes(duration)) return Promise.resolve();
  return sendCashShotClockCommand('start', button.dataset.gameId, button.dataset.playerName, duration);
}
function stopCashShotClock(button) {
  return sendCashShotClockCommand('stop', button.dataset.gameId);
}
async function sendCashShotClockCommand(action, gameId, name, duration) {
  const scope = cashShotClockContext(), id = String(gameId);
  if (!scope) return;
  if (navigator.onLine === false) { safeToast('Reconnect to start or stop a countdown.'); return; }
  let command = cashShotClockState.pending.get(id);
  if (command?.inFlight) return;
  if (command && (command.action !== action || command.player_name !== name || command.duration !== duration)) {
    safeToast('The previous countdown request is still being checked. Retry the same action first.'); return;
  }
  const generation = cashShotClockState.generation;
  if (!command) {
    command = {action, game_id: id, player_name: name, duration, command_id: crypto.randomUUID(), inFlight: true};
    cashShotClockState.pending.set(id, command);
  } else command.inFlight = true;
  cashShotClockState.errors.delete(id);
  paintCashShotClocks();
  let sent = false;
  try {
    // Only a new game/player depends on its initial save. Existing shared clocks
    // remain usable if an unrelated buy-in save is waiting or has failed.
    const known = cashShotClockState.games.get(id);
    if (action === 'start' && (!known?.tracked || !known.players?.some(player => player.name === name))) {
      if (typeof _saveQueue !== 'undefined') await _saveQueue;
      if (typeof clubSaveQueue !== 'undefined' && (await clubSaveQueue) === false) throw new Error('Save this game to the cloud before starting a countdown.');
      if (cashShotClockState.reading) await cashShotClockState.reading;
    }
    if (scope !== cashShotClockScope() || generation !== cashShotClockState.generation) return;
    if (!cashShotClockState.games.has(id)) await refreshCashShotClocks();
    if (scope !== cashShotClockScope() || generation !== cashShotClockState.generation) return;
    const game = cashShotClockState.games.get(id);
    if (command.expected_version === undefined) {
      if (action === 'start' && cashShotClockState.stale.has(id)) throw new Error('Reconnect and refresh the countdown before starting a new one.');
      if (!game?.can_control || !game.active) throw new Error('Countdown access is available to players in this game and organizers.');
      if (action === 'start' && cashShotClockRemaining(game.timer) > 0) throw new Error('A countdown is already running in this game.');
      command.expected_version = Number(game.version);
    }
    const args = {club_id: clubState.active.id, game_id: id, expected_version: command.expected_version, command_id: command.command_id};
    if (action === 'start') {
      args.player_name = name; args.duration = duration;
      if (!command.screenRequested) {
        command.screenRequested = true;
        cashShotClockState.screenRequest = {gameId: id, timerId: command.command_id};
      }
      cashShotClockOwned()[`${scope}:${command.command_id}`] = {game: id, done: false};
      saveCashShotClockOwned();
    }
    const started = cashShotClockMonotonic();
    sent = true;
    const response = await remoteState.client.rpc('poker_cash_timer', {action, args});
    if (response.error) {
      // PostgREST returns transport failures in `error` too. Only a concrete
      // server rejection proves the command did not commit before disconnection.
      sent = !/^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(String(response.error.code || ''));
      throw new Error(response.error.message || 'Countdown could not be updated.');
    }
    if (!applyCashShotClockResponse(response.data, scope, generation, started)) return;
    if (cashShotClockState.screenRequest?.timerId === command.command_id) cashShotClockState.screenRequest = null;
    // A poll may confirm this command before its response arrives, allowing a
    // newer action to begin. Finishing the old request must not erase that action.
    const current = cashShotClockState.pending.get(id);
    if (current === command) cashShotClockState.pending.delete(id);
    if (response.data?.conflict && (!current || current === command)) cashShotClockState.errors.set(id, 'The countdown changed on another phone. Check the current clock and try again.');
  } catch (error) {
    if (scope !== cashShotClockScope() || generation !== cashShotClockState.generation) return;
    if (cashShotClockState.pending.get(id) !== command) return;
    cashShotClockState.errors.set(id, sent ? 'Could not confirm the countdown. Retry the same action to check it safely.' : error.message || 'Countdown could not be updated.');
    if (!sent) {
      if (cashShotClockState.screenRequest?.timerId === command.command_id) cashShotClockState.screenRequest = null;
      cashShotClockState.pending.delete(id);
      delete cashShotClockOwned()[`${scope}:${command.command_id}`]; saveCashShotClockOwned();
    }
  } finally {
    command.inFlight = false;
    if (scope === cashShotClockScope() && generation === cashShotClockState.generation) paintCashShotClocks();
  }
}
function initCashShotClocks() {
  if (cashShotClockState.started) return;
  cashShotClockState.started = true;
  setInterval(() => { if (document.visibilityState !== 'hidden') paintCashShotClocks(); }, 250);
  setInterval(() => refreshCashShotClocks({force: false}), 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseCashShotClockWakeLock();
    else { cashShotClockState.wakeAttempt = ''; refreshCashShotClocks(); paintCashShotClocks(); }
  });
  window.addEventListener('online', () => refreshCashShotClocks());
  window.addEventListener('offline', () => paintCashShotClocks());
  window.addEventListener('pagehide', releaseCashShotClockWakeLock);
  refreshCashShotClocks();
}
