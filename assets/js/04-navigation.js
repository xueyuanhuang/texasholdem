// ====== UI: Tab Switching ======
function switchTab(name) {
  if (clubsEnabled() && (!clubState.active || clubState.active.status !== 'approved')) name = 'settings';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const tabs = ['match', 'history', 'settings'];
  document.querySelectorAll('.tab')[tabs.indexOf(name)].classList.add('active');

  if (name === 'history') renderHistory();
  if (name === 'settings') {
    renderSettings();
    if (!clubAutoSyncRunning) requestClubAutoSync();
  }
  if (name === 'match') {
    renderMemberGames();
    if (!clubState.active || clubCanWrite()) showModeSelection();
    requestClubAutoSync();
  }
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

let accessNoticeTimer;
function showAccessNotice(message) {
  const notice = document.getElementById('access-notice');
  clearTimeout(accessNoticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  accessNoticeTimer = setTimeout(() => { notice.hidden = true; }, 3000);
}

function renderMemberGames() {
  const target = document.getElementById('member-games');
  if (!target) return;
  const readonly = !!clubState.active && !clubCanWrite();
  target.hidden = !readonly;
  if (!readonly) return;
  const games = (data.cashGames || []).filter(g => g.status === 'active');
  const tournament = data.activeTournament;
  const card = (title, rows) => `<div class="card"><div class="card-title">${title}</div><p class="club-help">In progress · Read only</p>${rows.map(([name, detail]) => `<div class="cash-leaderboard-full-row"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></div>`).join('')}</div>`;
  target.innerHTML = games.map(g => card(`Cash game · ${escapeHtml(g.date || '')}`,  (g.players || []).map(p => [p.name, `${getBuyIns(p.rebuys)} buy-ins · Chips ${p.endChips ?? '—'}`]))).join('');
  if (tournament?.active) target.innerHTML += card('Tournament', (tournament.players || []).map(name => [name, tournament.playerData?.[name]?.eliminated ? 'Eliminated' : `${tournament.playerData?.[name]?.rebuys || 0} rebuys`]));
  if (!target.innerHTML) target.innerHTML = '<div class="card"><div class="card-title">No ongoing games</div><p class="club-help">Games you participate in will appear here automatically.</p></div>';
}
