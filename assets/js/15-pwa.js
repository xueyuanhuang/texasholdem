// ====== PWA Install + Update ======
const PWA_APP_VERSION = '2026.09.13-club-names.2';

let pwaRegistration = null;
let pendingPwaWorker = null;
let pwaRefreshing = false;
let pwaControllerChanged = false;
let pwaLastInteraction = Date.now();
function pwaCanUpdateNow() {
  const focused = document.activeElement;
  return document.visibilityState === 'visible' && Date.now() - pwaLastInteraction >= 15000 &&
    !document.querySelector('dialog[open], .modal-overlay.open') &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(focused?.tagName) &&
    !(typeof isRecording !== 'undefined' && isRecording) &&
    !(typeof editingCashGameId !== 'undefined' && editingCashGameId !== null) &&
    !(typeof inGameState !== 'undefined' && inGameState.active) &&
    !(typeof selectedPlayers !== 'undefined' && selectedPlayers.size) &&
    !(typeof cashSelectedPlayers !== 'undefined' && cashSelectedPlayers.size) &&
    !(typeof remoteState !== 'undefined' && (remoteState.loading || remoteState.saving || remoteState.saveTimer || remoteState.lastError)) &&
    !(typeof clubState !== 'undefined' && clubState.busy);
}
async function applyIdlePwaUpdate() {
  if ((!pendingPwaWorker && !pwaControllerChanged) || pwaRefreshing || !pwaCanUpdateNow()) return;
  if (typeof _saveQueue !== 'undefined') await _saveQueue;
  if (typeof clubSaveQueue !== 'undefined') await clubSaveQueue;
  if (!pwaCanUpdateNow()) return;
  if (pwaControllerChanged) { pwaRefreshing = true; window.location.reload(); }
  else pendingPwaWorker.postMessage({ type: 'SKIP_WAITING' });
}

function getPwaDisplayMode() {
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.navigator.standalone) return 'standalone';
  return 'browser';
}

function setPwaStatus(text, mode = 'muted') {
  const statusEl = document.getElementById('pwa-status-text');
  const versionEl = document.getElementById('pwa-version-text');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = `pwa-status-text ${mode}`;
  }
  if (versionEl) {
    const display = getPwaDisplayMode() === 'standalone' ? 'Home screen app' : 'Browser';
    versionEl.textContent = `v${PWA_APP_VERSION} · ${display}`;
  }
}

function showPwaUpdate(worker) {
  pendingPwaWorker = worker;
  void applyIdlePwaUpdate();
}

function hidePwaUpdate() {
  const banner = document.getElementById('pwa-update');
  if (banner) banner.hidden = true;
}

function applyPwaUpdate() { return applyIdlePwaUpdate(); }

async function checkPwaUpdate() {
  if (!('serviceWorker' in navigator)) {
    setPwaStatus('Offline updates are not supported by this browser', 'warn');
    return;
  }
  if (!pwaRegistration) {
    setPwaStatus('Update service is not ready', 'warn');
    return;
  }

  setPwaStatus('Checking for updates', 'muted');
  try {
    await pwaRegistration.update();
    if (pwaRegistration.waiting) {
      showPwaUpdate(pwaRegistration.waiting);
      return;
    }
    setPwaStatus('Up to date', 'ok');

  } catch (e) {
    console.warn('[pwa] update check failed', e);
    setPwaStatus('Update check failed. Try again later.', 'warn');
  }
}

function watchPwaWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      showPwaUpdate(worker);
    }
  });
}

async function initPwa() {
  setPwaStatus('Checking app status', 'muted');
  if (!('serviceWorker' in navigator)) {
    setPwaStatus('This browser does not support PWA', 'warn');
    return;
  }
  if (window.location.protocol === 'file:') {
    setPwaStatus('PWA is unavailable in local file mode', 'warn');
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pwaControllerChanged = true;
    void applyIdlePwaUpdate();
  });

  try {
    const swUrl = new URL('sw.js', window.location.href);
    pwaRegistration = await navigator.serviceWorker.register(swUrl.href, { scope: './' });

    if (pwaRegistration.waiting && navigator.serviceWorker.controller) {
      showPwaUpdate(pwaRegistration.waiting);
    } else {
      const status = navigator.serviceWorker.controller ? 'Available offline' : 'Offline support will be ready next time';
      setPwaStatus(status, 'ok');
    }

    watchPwaWorker(pwaRegistration.installing);
    pwaRegistration.addEventListener('updatefound', () => {
      watchPwaWorker(pwaRegistration.installing);
    });
  } catch (e) {
    console.warn('[pwa] registration failed', e);
    setPwaStatus('Could not initialize offline support', 'warn');
  }
}

window.applyPwaUpdate = applyPwaUpdate;
window.checkPwaUpdate = checkPwaUpdate;
window.addEventListener('load', initPwa);
for (const event of ['pointerdown', 'keydown', 'input']) document.addEventListener(event, () => { pwaLastInteraction = Date.now(); }, { passive: true });
setInterval(() => { void applyIdlePwaUpdate(); }, 5000);
setInterval(() => { if (document.visibilityState === 'visible' && pwaRegistration) void checkPwaUpdate(); }, 300000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { pwaLastInteraction = Date.now(); if (pwaRegistration) void checkPwaUpdate(); }
});
