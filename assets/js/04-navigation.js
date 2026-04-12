// ====== UI: Tab Switching ======
function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const tabs = ['match', 'history', 'settings'];
  document.querySelectorAll('.tab')[tabs.indexOf(name)].classList.add('active');

  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
  if (name === 'match') showModeSelection();
}

// ====== Mode Selection ======
let currentMatchMode = null;

function updateMatchModeButtons(mode) {
  const toggleBtn = document.getElementById('mode-toggle-btn');
  if (!toggleBtn) return;

  if (mode === 'cash') {
    toggleBtn.className = 'btn btn-green';
    toggleBtn.textContent = 'Cash Game';
  } else {
    toggleBtn.className = 'btn btn-primary';
    toggleBtn.textContent = 'Tournament';
  }
}

function applyMatchModeVisibility(mode) {
  const normalizedMode = mode === 'cash' ? 'cash' : 'tournament';
  const modeModal = document.getElementById('mode-modal');
  if (modeModal) modeModal.classList.remove('open');

  if (normalizedMode === 'cash') {
    document.getElementById('tournament-mode').style.display = 'none';
    document.getElementById('cash-mode').style.display = '';
  } else {
    document.getElementById('tournament-mode').style.display = '';
    document.getElementById('cash-mode').style.display = 'none';
  }

  updateMatchModeButtons(normalizedMode);
}

function showModeSelection() {
  if (!currentMatchMode) {
    selectMode('cash');
    return;
  }
  applyMatchModeVisibility(currentMatchMode);
}

function selectMode(mode) {
  const normalizedMode = mode === 'cash' ? 'cash' : 'tournament';
  currentMatchMode = normalizedMode;
  applyMatchModeVisibility(normalizedMode);

  if (normalizedMode === 'tournament') {
    renderEntryPage();
    updateTournamentSettingsSummary();
  } else {
    renderCashPage();
  }
}

function toggleMode() {
  const nextMode = currentMatchMode === 'cash' ? 'tournament' : 'cash';
  selectMode(nextMode);
}
