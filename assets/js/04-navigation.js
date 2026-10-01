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

function renderMemberCashGame(game) {
  const gameId = String(game.id);
  const settlement = evaluateCashGameSettlement({
    chipsPerHand: game.chipsPerHand,
    pricePerHand: game.pricePerHand,
    players: Array.isArray(game.players) ? game.players : []
  });
  return `<div class="card"><div class="card-title">Cash game · ${escapeHtml(game.date || '')}</div>
    <p class="club-help">In progress · Buy-ins and chips are read only. Tap a player’s name for the shot clock.</p>
    <div class="card-title">Buy-ins and settlement</div>
    <div class="cash-member-columns" aria-hidden="true"><span>Player</span><span>Buy-ins</span><span>Remaining chips</span><span>Profit / loss</span></div>
    ${settlement.rows.map(row => `<div class="cash-player-block"><div class="cash-player-row">
      <button type="button" class="cash-player-name cash-shot-clock-name" data-cash-clock-toggle data-game-id="${escapeHtml(gameId)}" data-player-name="${escapeHtml(row.name)}" onclick="toggleCashShotClock(this)" aria-expanded="false" aria-label="Shot clock for ${escapeHtml(row.name)}">${escapeHtml(row.name)}</button>
      <span class="cash-member-buyins">${row.buyIns}</span>
      <span class="cash-member-chips">${formatHistoryChipCount(row.endChips)}</span>
      <span class="cash-pnl ${row.status === 'invalid' ? 'zero' : row.status}">${row.status === 'invalid' ? '—' : formatSignedHistoryScore(row.pnlScore)}</span>
      </div><div class="cash-player-timing">${typeof renderCashShotClock === 'function' ? renderCashShotClock(gameId,row.name,{interactive:true}) : ''}</div></div>`).join('')}
    </div>`;
}

function renderMemberGames() {
  const target = document.getElementById('member-games');
  if (!target) return;
  const readonly = !!clubState.active && !clubHasGameAccess();
  target.hidden = !readonly;
  if (!readonly) return;
  const games = (data.cashGames || []).filter(g => g.status === 'active');
  const tournament = data.activeTournament;
  const card = (title, rows) => `<div class="card"><div class="card-title">${title}</div><p class="club-help">In progress · Read only</p>${rows.map(([name, detail]) => `<div class="cash-leaderboard-full-row"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></div>`).join('')}</div>`;
  target.innerHTML = games.map(renderMemberCashGame).join('');
  if (tournament?.active) target.innerHTML += card('Tournament', (tournament.players || []).map(name => [name, tournament.playerData?.[name]?.eliminated ? 'Eliminated' : `${tournament.playerData?.[name]?.rebuys || 0} rebuys`]));
  if (!target.innerHTML) target.innerHTML = '<div class="card"><div class="card-title">No ongoing games</div><p class="club-help">Games you participate in will appear here automatically.</p></div>';
  if (typeof refreshCashShotClocks === 'function') refreshCashShotClocks();
}
