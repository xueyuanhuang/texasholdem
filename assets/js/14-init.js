// ====== Init ======
async function initApp() {
  if (typeof initRemoteSync === 'function') {
    try {
      await initRemoteSync();
    } catch (e) {
      console.warn('云端同步初始化失败，继续本地模式。', e);
    }
  }

  try {
    await loadData();
  } catch (e) {
    console.error('初始化失败，回退默认数据。', e);
    data = cloneDefaultData();
  }

  if (typeof loadRemoteDataIfSignedIn === 'function') {
    await loadRemoteDataIfSignedIn({ preferRemote: true });
  }

  showModeSelection();
  if (typeof renderAuthPanel === 'function') renderAuthPanel();
  if (typeof updateCashRemoteStatus === 'function') updateCashRemoteStatus();
}

// ====== Emergency Flush on App Suspend/Kill ======
// On iOS PWA, beforeunload does NOT fire. pagehide fires when the app
// enters background (which happens before a force-kill).
// visibilitychange fires even more reliably on some WebKit versions.
// We flush synchronously via localStorage as a safety net because
// async IndexedDB writes may not complete before the process is killed.

function _emergencyFlushCashDebounce() {
  // If there's a pending cash auto-save debounce, execute it immediately
  if (typeof autoSaveTimeout !== 'undefined' && autoSaveTimeout !== null) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;

    // Synchronous localStorage write — guaranteed to complete before kill
    try {
      const date = new Date().toISOString().split('T')[0];
      if (typeof cashSelectedPlayers !== 'undefined' && cashSelectedPlayers.size > 0) {
        const { cpp, pph } = getCashConfig(true);
        const players = Array.from(cashSelectedPlayers).map(name => ({
          name,
          endChips: Number.isSafeInteger(cashPlayerData[name]?.endChips) ? cashPlayerData[name].endChips : 0,
          rebuys: Array.isArray(cashPlayerData[name]?.rebuys) ? cashPlayerData[name].rebuys : []
        }));

        const now = new Date().toISOString();
        const id = data.activeCashGameId || `cash_${Date.now()}`;
        const snapshot = {
          id,
          date,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          chipsPerHand: cpp,
          pricePerHand: pph,
          players
        };

        data.activeCashGameId = id;
        const existingIndex = data.cashGames.findIndex(c => String(c.id) === String(id));
        if (existingIndex >= 0) {
          data.cashGames[existingIndex] = { ...data.cashGames[existingIndex], ...snapshot };
        } else {
          data.cashGames.push(snapshot);
        }

        // Synchronous fallback write — async IDB may not finish in time
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('[data] emergency flush: cash game saved to localStorage');
      }
    } catch (e) {
      console.warn('[data] emergency flush failed', e);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _emergencyFlushCashDebounce();
  }
});

window.addEventListener('pagehide', () => {
  _emergencyFlushCashDebounce();
});

// ====== Boot ======
initApp();
