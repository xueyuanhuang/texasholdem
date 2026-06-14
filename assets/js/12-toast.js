// ====== Toast ======
let toastTimer = null;
let toastModalObserver = null;

function hasOpenModal() {
  return !!document.querySelector('.modal-overlay.open');
}

function syncToastPosition() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.toggle('toast-top', hasOpenModal());
}

function initToastObserver() {
  if (toastModalObserver || !document.body) return;
  toastModalObserver = new MutationObserver(syncToastPosition);
  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    toastModalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
  syncToastPosition();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  initToastObserver();
  syncToastPosition();
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, 1600);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initToastObserver);
} else {
  initToastObserver();
}
