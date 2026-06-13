// ====== PWA Install + Update ======
const PWA_APP_VERSION = '2026.06.13-otp.3';

let pwaRegistration = null;
let pendingPwaWorker = null;
let pwaRefreshing = false;

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
    const display = getPwaDisplayMode() === 'standalone' ? '主屏幕应用' : '浏览器';
    versionEl.textContent = `v${PWA_APP_VERSION} · ${display}`;
  }
}

function showPwaUpdate(worker) {
  pendingPwaWorker = worker;
  const banner = document.getElementById('pwa-update');
  if (banner) banner.hidden = false;
  setPwaStatus('有新版本可更新', 'ok');
}

function hidePwaUpdate() {
  const banner = document.getElementById('pwa-update');
  if (banner) banner.hidden = true;
}

function applyPwaUpdate() {
  if (!pendingPwaWorker) {
    window.location.reload();
    return;
  }
  pendingPwaWorker.postMessage({ type: 'SKIP_WAITING' });
}

async function checkPwaUpdate() {
  if (!('serviceWorker' in navigator)) {
    setPwaStatus('当前浏览器不支持离线更新', 'warn');
    return;
  }
  if (!pwaRegistration) {
    setPwaStatus('应用更新服务尚未就绪', 'warn');
    return;
  }

  setPwaStatus('正在检查更新', 'muted');
  try {
    await pwaRegistration.update();
    if (pwaRegistration.waiting) {
      showPwaUpdate(pwaRegistration.waiting);
      return;
    }
    setPwaStatus('已是最新版本', 'ok');
    if (typeof showToast === 'function') showToast('已是最新版本');
  } catch (e) {
    console.warn('[pwa] update check failed', e);
    setPwaStatus('更新检查失败，稍后再试', 'warn');
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
  setPwaStatus('正在检查应用状态', 'muted');
  if (!('serviceWorker' in navigator)) {
    setPwaStatus('当前浏览器不支持 PWA', 'warn');
    return;
  }
  if (window.location.protocol === 'file:') {
    setPwaStatus('本地文件模式不支持 PWA', 'warn');
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pwaRefreshing) return;
    pwaRefreshing = true;
    hidePwaUpdate();
    window.location.reload();
  });

  try {
    const swUrl = new URL('sw.js', window.location.href);
    pwaRegistration = await navigator.serviceWorker.register(swUrl.href, { scope: './' });

    if (pwaRegistration.waiting && navigator.serviceWorker.controller) {
      showPwaUpdate(pwaRegistration.waiting);
    } else {
      const status = navigator.serviceWorker.controller ? 'PWA 已启用，可离线打开' : 'PWA 已安装，下次打开生效';
      setPwaStatus(status, 'ok');
    }

    watchPwaWorker(pwaRegistration.installing);
    pwaRegistration.addEventListener('updatefound', () => {
      watchPwaWorker(pwaRegistration.installing);
    });
  } catch (e) {
    console.warn('[pwa] registration failed', e);
    setPwaStatus('PWA 初始化失败', 'warn');
  }
}

window.applyPwaUpdate = applyPwaUpdate;
window.checkPwaUpdate = checkPwaUpdate;
window.addEventListener('load', initPwa);
