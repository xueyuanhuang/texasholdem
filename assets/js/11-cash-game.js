// ====== Cash Game ======
let cashSelectedPlayers = new Set();
let cashPlayerData = {}; // { name: { endChips, rebuys: [{time, amount}] } }
let isRecording = false; // Auto-save recording mode
let editingCashGameId = null;

function parseStrictPositiveInt(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function parseStrictNonNegativeInt(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return 0;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function getCashConfig(allowFallback = true) {
  const cppInput = document.getElementById('cash-cpp');
  const pphInput = document.getElementById('cash-pph');
  const errors = [];

  const cpp = parseStrictPositiveInt(cppInput?.value);
  const pph = parseStrictPositiveInt(pphInput?.value);

  if (cpp === null) errors.push('Chips per buy-in must be a positive integer');
  if (pph === null) errors.push('Points per buy-in must be a positive integer');

  if (errors.length > 0 && !allowFallback) {
    return { valid: false, errors, cpp: null, pph: null };
  }

  return {
    valid: errors.length === 0,
    errors,
    cpp: cpp === null ? getLastCashDefaults().cpp : cpp,
    pph: pph === null ? getLastCashDefaults().pph : pph
  };
}

function getCashCpp() { return getCashConfig(true).cpp; }
function getCashPph() { return getCashConfig(true).pph; }
function getBuyIns(rebuys) {
  if (!Array.isArray(rebuys)) return 0;
  return rebuys.reduce((sum, r) => {
    const amount = Number(r?.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
}

function formatScore(amount) {
  const fixed = (Math.round(amount * 100) / 100).toFixed(2);
  return fixed.endsWith('.00') ? String(Math.round(amount)) : fixed;
}

function getCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function toggleRecording() {
  if (editingCashGameId !== null) return;
  if (!isRecording) return;
  stopCashRecording();
}

function renderCashPage() {
  renderCashImportOptions();

  const restoredActive = editingCashGameId === null && restoreActiveCashGameIfNeeded();
  if (!restoredActive && editingCashGameId === null) {
    // Default values: inherit from most recent cash game, fallback 1000/20
    const cppInput = document.getElementById('cash-cpp');
    const pphInput = document.getElementById('cash-pph');
    if (!cppInput.value || cppInput.value === '1000') {
      cppInput.value = getLastCashDefaults().cpp;
    }
    if (!pphInput.value || pphInput.value === '20') {
      pphInput.value = getLastCashDefaults().pph;
    }
  }

  updateRecordButton();
  updateCashRemoteStatus();
  renderCashPlayerGrid();
  renderCashPlayers();
}

function getCashImportSource() {
  const sourceSelect = document.getElementById('cash-import-source');
  return sourceSelect && sourceSelect.value === 'cash' ? 'cash' : 'tournament';
}

function getCashImportRecords(source) {
  if (source === 'cash') {
    return (data.cashGames || [])
      .filter(cg => Array.isArray(cg.players) && cg.players.length > 0)
      .slice()
      .sort((a, b) => {
        const dateCmp = String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || ''));
        if (dateCmp !== 0) return dateCmp;
        return compareCashGameIdsDesc(a.id, b.id);
      })
      .map(cg => ({
        label: `${formatDateShort(cg.date)} · ${cg.players.length} players${cg.status === 'active' ? ' · Recording' : ''}`,
        names: cg.players.map(player => player && player.name).filter(Boolean)
      }));
  }

  return (data.tournaments || [])
    .map((t, index) => ({ ...t, matchNo: index + 1 }))
    .filter(t => Array.isArray(t.participants) && t.participants.length > 0)
    .sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return (b.id || 0) - (a.id || 0);
    })
    .map(t => ({
      label: `Game ${t.matchNo} · ${formatDateShort(t.date)} (${t.participants.length} players)`,
      names: t.participants.slice()
    }));
}

function renderCashImportOptions() {
  const recordSelect = document.getElementById('cash-history-select');
  const importBtn = document.getElementById('cash-import-btn');
  if (!recordSelect) return;

  const source = getCashImportSource();
  const records = getCashImportRecords(source);
  recordSelect.innerHTML = '';

  if (records.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = source === 'cash' ? 'No cash game history' : 'No tournament history';
    recordSelect.appendChild(opt);
    recordSelect.disabled = true;
    if (importBtn) importBtn.disabled = true;
    return;
  }

  records.forEach((record, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    opt.textContent = record.label;
    recordSelect.appendChild(opt);
  });
  recordSelect.disabled = false;
  if (importBtn) importBtn.disabled = false;
}

function onCashImportSourceChange() {
  renderCashImportOptions();
}

function importCashPlayers(names) {
  const importedNames = (names || []).filter(name => (data.players || []).includes(name));
  if (importedNames.length === 0) {
    showToast('No players to import');
    return;
  }

  importedNames.forEach(name => {
    cashSelectedPlayers.add(name);
    if (!cashPlayerData[name]) {
      cashPlayerData[name] = { endChips: 0, rebuys: [{ time: getCurrentTime(), amount: 1 }] };
    }
  });

  renderCashPlayerGrid();
  renderCashPlayers();
  if (typeof touchPlayersActivity === 'function' && touchPlayersActivity(importedNames)) {
    saveData({ remote: false });
  }
  showToast(`Imported ${importedNames.length} players`);
}

function importFromHistoryRecord() {
  const recordSelect = document.getElementById('cash-history-select');
  if (!recordSelect || recordSelect.disabled) return;

  const records = getCashImportRecords(getCashImportSource());
  const record = records[parseInt(recordSelect.value, 10)];
  if (!record || record.names.length === 0) {
    showToast('No players to import');
    return;
  }

  importCashPlayers(record.names);
}

function onCashTournamentSelect() {
  // Compatibility hook for older cached markup.
}

function importFromTournament() {
  const legacySelect = document.getElementById('cash-tournament-select');
  if (legacySelect) {
    const tId = parseInt(legacySelect.value, 10);
    const t = data.tournaments.find(x => x.id === tId);
    if (t) importCashPlayers(t.participants);
    return;
  }
  importFromHistoryRecord();
}

function syncCashSelectedPlayersWithRoster() {
  const roster = new Set(data.players || []);
  Array.from(cashSelectedPlayers).forEach(name => {
    if (!roster.has(name)) {
      cashSelectedPlayers.delete(name);
      delete cashPlayerData[name];
    }
  });
}

function renderCashPlayerSummary() {
  syncCashSelectedPlayersWithRoster();
  const selected = sortPlayerNamesForDisplay(Array.from(cashSelectedPlayers));
  if (typeof renderSelectionSummary === 'function') {
    renderSelectionSummary('cash-player-summary', selected, data.players.length);
    return;
  }

  const container = document.getElementById('cash-player-summary');
  if (!container) return;
  if (selected.length === 0) {
    container.innerHTML = '<div class="selection-summary-empty">No players selected</div>';
    return;
  }
  container.innerHTML = selected.map(name => `<span class="selection-chip">${name}</span>`).join('');
}

function renderCashPlayerGrid() {
  renderCashPlayerSummary();
}

function toggleCashPlayer(name) {
  if (cashSelectedPlayers.has(name)) {
    cashSelectedPlayers.delete(name);
    delete cashPlayerData[name];
  } else {
    cashSelectedPlayers.add(name);
    if (!cashPlayerData[name]) {
      cashPlayerData[name] = { endChips: 0, rebuys: [{ time: getCurrentTime(), amount: 1 }] };
    }
  }
  renderCashPlayerGrid();
  renderCashPlayers();
}

function applyCashPlayerSelectionFromPicker(nextSelectedNames) {
  const roster = new Set(data.players || []);
  const nextSet = new Set((nextSelectedNames || []).filter(name => roster.has(name)));

  Array.from(cashSelectedPlayers).forEach(name => {
    if (!nextSet.has(name)) delete cashPlayerData[name];
  });

  Array.from(nextSet).forEach(name => {
    if (!cashPlayerData[name]) {
      cashPlayerData[name] = { endChips: 0, rebuys: [{ time: getCurrentTime(), amount: 1 }] };
    }
  });

  cashSelectedPlayers = nextSet;
  renderCashPlayerGrid();
  renderCashPlayers();
}

function buildCashSettlementInput(config = getCashConfig(false)) {
  return {
    chipsPerHand: config.cpp,
    pricePerHand: config.pph,
    players: sortPlayerNamesForDisplay(Array.from(cashSelectedPlayers)).map(name => {
      const pd = cashPlayerData[name] || { endChips: 0, rebuys: [] };
      return {
        name,
        endChips: pd.endChips,
        rebuys: Array.isArray(pd.rebuys) ? pd.rebuys : []
      };
    })
  };
}

function evaluateCurrentCashSettlement(config = getCashConfig(false)) {
  return evaluateCashGameSettlement(buildCashSettlementInput(config));
}

function renderCashPlayers() {
  const list = document.getElementById('cash-players-list');
  const timeline = document.getElementById('cash-timeline');
  const settlementCard = document.getElementById('cash-settlement-card');
  const timelineCard = document.getElementById('cash-timeline-card');
  list.innerHTML = '';
  timeline.innerHTML = '';

  const players = sortPlayerNamesForDisplay(Array.from(cashSelectedPlayers));
  if (players.length === 0) {
    settlementCard.style.display = 'none';
    timelineCard.style.display = 'none';
    document.getElementById('cash-validation').style.display = 'none';
    document.getElementById('cash-transfers-card').style.display = 'none';
    if (isRecording) autoSaveCashGame();
    updateRecordButton();
    return;
  }

  settlementCard.style.display = '';
  timelineCard.style.display = '';
  const config = getCashConfig(false);
  const settlement = evaluateCurrentCashSettlement(config);

  settlement.rows.forEach((rowData) => {
    const name = rowData.name;
    const pd = cashPlayerData[name] || { endChips: rowData.endChips, rebuys: [] };
    cashPlayerData[name] = pd;
    if (!Array.isArray(pd.rebuys)) pd.rebuys = [];

    const pnlClass = rowData.status === 'invalid' ? 'zero' : rowData.status;
    const pnlText = rowData.status === 'invalid'
      ? '—'
      : rowData.pnlScore >= 0 ? `+${formatScore(rowData.pnlScore)}` : formatScore(rowData.pnlScore);

    const row = document.createElement('div');
    row.className = 'cash-player-row';
    row.innerHTML = `
      <span class="cash-player-name">${name}</span>
      <div class="cash-buyin-ctrl">
        <button class="cash-buyin-btn" onclick="changeBuyIn('${name.replace(/'/g, "\\'")}', -1)">−</button>
        <span class="cash-buyin-val">${rowData.buyIns}</span>
        <button class="cash-buyin-btn" onclick="changeBuyIn('${name.replace(/'/g, "\\'")}', 1)">+</button>
      </div>
      <input class="cash-input" type="number" inputmode="numeric" min="0" step="1" value="${rowData.endChips}"
        placeholder="0" onchange="updateEndChips('${name.replace(/'/g, "\\'")}', this.value)" onfocus="this.select()">
      <span class="cash-pnl ${pnlClass}">${pnlText}</span>
    `;
    list.appendChild(row);
  });

  // Render timeline sorted by time
  if (settlement.timeline.length === 0) {
    timeline.innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px;">No buy-ins yet</div>';
  } else {
    settlement.timeline.forEach(r => {
      const item = document.createElement('div');
      item.className = 'transfer-item';
      item.innerHTML = `
        <span style="color:var(--text2);font-family:monospace;">${r.time}</span>
        <span>${r.name}</span>
        <span class="transfer-amount" style="color:var(--accent);">+${r.amount} buy-ins</span>
      `;
      timeline.appendChild(item);
    });
  }

  updateCashValidation(settlement);
  autoSaveCashGame();
  updateRecordButton();
}

function changeBuyIn(name, delta) {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  const pd = cashPlayerData[name];
  if (pd && Array.isArray(pd.rebuys)) {
    const currentBuyIns = getBuyIns(pd.rebuys);
    const newBuyIns = Math.max(1, currentBuyIns + delta);
    if (newBuyIns > currentBuyIns) {
      // Add rebuy
      pd.rebuys.push({ time: getCurrentTime(), amount: newBuyIns - currentBuyIns });
    } else if (newBuyIns < currentBuyIns) {
      // Remove from last rebuy
      let toRemove = currentBuyIns - newBuyIns;
      for (let i = pd.rebuys.length - 1; i >= 0 && toRemove > 0; i--) {
        if (pd.rebuys[i].amount <= toRemove) {
          toRemove -= pd.rebuys[i].amount;
          pd.rebuys.splice(i, 1);
        } else {
          pd.rebuys[i].amount -= toRemove;
          toRemove = 0;
        }
      }
    }
    renderCashPlayers();
  }
}

function addRebuy(name) {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  const pd = cashPlayerData[name];
  if (pd) {
    if (!Array.isArray(pd.rebuys)) pd.rebuys = [];
    pd.rebuys.push({ time: getCurrentTime(), amount: 1 });
    renderCashPlayers();
    showToast(`${name} added one rebuy`);
  }
}

function updateEndChips(name, value) {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  const pd = cashPlayerData[name];
  if (!pd) return;

  const parsed = parseStrictNonNegativeInt(value);
  if (parsed === null) {
    showToast('Remaining chips must be a non-negative integer');
    renderCashPlayers();
    return;
  }

  pd.endChips = parsed;
  renderCashPlayers();
}

function updateCashValidation(settlement = evaluateCurrentCashSettlement()) {
  const players = sortPlayerNamesForDisplay(Array.from(cashSelectedPlayers));
  const validCard = document.getElementById('cash-validation');
  const transferCard = document.getElementById('cash-transfers-card');
  const summary = document.getElementById('cash-summary');

  if (players.length === 0) {
    validCard.style.display = 'none';
    transferCard.style.display = 'none';
    return;
  }

  validCard.style.display = '';

  const issues = new Set(settlement.issues);

  if (issues.size > 0) {
    summary.innerHTML = `
      <div class="cash-summary-row warn">
        <span>Balance check</span>
        <span>Not ready to settle</span>
      </div>
      ${Array.from(issues).map(msg => `
        <div class="cash-summary-row" style="color:var(--text2);font-size:12px;">
          <span>Note</span>
          <span>${msg}</span>
        </div>
      `).join('')}
    `;
    transferCard.style.display = 'none';
    return;
  }

  const totalBuyIn = settlement.totals.investedChips;
  const totalEnd = settlement.totals.endChips;
  const diff = settlement.totals.diffChips;
  const isValid = settlement.canSettle;
  const config = getCashConfig(false);

  summary.innerHTML = `
    <div class="cash-summary-row">
      <span>Total chips bought in</span>
      <span>${totalBuyIn.toLocaleString()}</span>
    </div>
    <div class="cash-summary-row">
      <span>Total remaining chips</span>
      <span>${totalEnd.toLocaleString()}</span>
    </div>
    <div class="cash-summary-row ${isValid ? 'ok' : 'warn'}">
      <span>Difference</span>
      <span>${isValid ? 'Balanced' : `Difference: ${diff > 0 ? '+' : ''}${diff.toLocaleString()} chips`}</span>
    </div>
    <div class="cash-summary-row" style="color:var(--text2);font-size:12px;">
      <span>Conversion</span>
      <span>${config.cpp} chips = ${config.pph} points</span>
    </div>
  `;

  if (isValid) {
    transferCard.style.display = '';
    renderTransfers(settlement.settlementPlan);
  } else {
    transferCard.style.display = 'none';
  }
}

function renderTransfers(settlementPlan = evaluateCurrentCashSettlement().settlementPlan) {
  const container = document.getElementById('cash-transfers');
  const title = document.querySelector('#cash-transfers-card .card-title');
  container.innerHTML = '';
  if (title) title.textContent = settlementPlan.isOptimal ? 'Settlement plan (exact)' : 'Settlement plan (approximate)';

  if (settlementPlan.transfers.length === 0) {
    container.innerHTML = '<div style="color:var(--text2);font-size:14px;text-align:center;padding:12px;">No transfers needed</div>';
    return;
  }

  settlementPlan.transfers.forEach(t => {
    const item = document.createElement('div');
    item.className = 'transfer-item';
    item.innerHTML = `
      <span>${t.from}</span>
      <span class="transfer-arrow">→</span>
      <span>${t.to}</span>
      <span class="transfer-amount">${formatScore(t.amountScore)} pts</span>
    `;
    container.appendChild(item);
  });
}

// Auto-save cash game state
let autoSaveTimeout = null;
function autoSaveCashGame() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (editingCashGameId !== null || (!isRecording && cashSelectedPlayers.size === 0)) return;
  isRecording = true;
  upsertCurrentCashGameSnapshot('active');
  saveData({remote:false}).then(showSaveIndicator);
  if (typeof upsertRemoteStateNow === 'function') upsertRemoteStateNow();

}

function showSaveIndicator() {
  const indicator = document.getElementById('save-indicator');
  if (!indicator) return;
  indicator.classList.remove('save-flash');
  void indicator.offsetWidth; // Trigger reflow
  indicator.classList.add('save-flash');
  indicator.style.opacity = '1';
}

// Get default cash game params from most recent saved game
function getLastCashDefaults() {
  const sorted = (data.cashGames || []).slice().sort((a, b) => {
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return compareCashGameIdsDesc(a.id, b.id);
  });
  const last = sorted[0];
  return {
    cpp: (last && Number.isFinite(last.chipsPerHand) && last.chipsPerHand > 0) ? last.chipsPerHand : 1000,
    pph: (last && Number.isFinite(last.pricePerHand) && last.pricePerHand > 0) ? last.pricePerHand : 20
  };
}

function compareCashGameIdsDesc(aId, bId) {
  const aNum = Number(aId);
  const bNum = Number(bId);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
  return String(bId || '').localeCompare(String(aId || ''));
}

function getActiveCashGameRecord() {
  const activeId = data && data.activeCashGameId;
  if (activeId) {
    const byId = (data.cashGames || []).find(cg => String(cg.id) === String(activeId) && cg.status === 'active');
    if (byId) return byId;
  }
  const activeGames = (data.cashGames || []).filter(cg => cg.status === 'active');
  activeGames.sort((a, b) => String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || '')));
  return activeGames[0] || null;
}

function ensureActiveCashGameId() {
  if (!data.activeCashGameId) {
    data.activeCashGameId = `cash_${Date.now()}`;
  }
  return data.activeCashGameId;
}

function buildCurrentCashGameSnapshot(status = 'active') {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const existingId = status === 'active' ? ensureActiveCashGameId() : data.activeCashGameId;
  const id = existingId || `cash_${Date.now()}`;
  const existing = (data.cashGames || []).find(cg => String(cg.id) === String(id));
  const { cpp, pph } = getCashConfig(true);
  const players = Array.from(cashSelectedPlayers).map(name => ({
    name,
    endChips: Number.isSafeInteger(cashPlayerData[name]?.endChips) ? cashPlayerData[name].endChips : 0,
    rebuys: Array.isArray(cashPlayerData[name]?.rebuys) ? cashPlayerData[name].rebuys : [{ time: getCurrentTime(), amount: 1 }]
  }));

  return {
    id,
    date: existing?.date || date,
    status,
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    chipsPerHand: cpp,
    pricePerHand: pph,
    players
  };
}

function buildCashGameSnapshotForEdit(existing) {
  const config = getCashConfig(false);
  if (!config.valid) {
    return { ok: false, error: config.errors.join('; ') || 'Invalid game settings' };
  }

  const players = sortPlayerNamesForDisplay(Array.from(cashSelectedPlayers)).map(name => {
    const pd = cashPlayerData[name] || { endChips: 0, rebuys: [] };
    return {
      name,
      endChips: Number.isSafeInteger(pd.endChips) ? pd.endChips : 0,
      rebuys: Array.isArray(pd.rebuys) ? pd.rebuys.map(rebuy => ({
        time: rebuy && rebuy.time ? String(rebuy.time) : getCurrentTime(),
        amount: Number(rebuy && rebuy.amount)
      })).filter(rebuy => Number.isSafeInteger(rebuy.amount) && rebuy.amount > 0) : []
    };
  });

  if (players.length === 0) {
    return { ok: false, error: 'Select at least one player' };
  }

  return {
    ok: true,
    snapshot: {
      ...existing,
      status: existing.status || 'settled',
      updatedAt: new Date().toISOString(),
      chipsPerHand: config.cpp,
      pricePerHand: config.pph,
      players
    }
  };
}

function upsertCashGameSnapshot(snapshot) {
  if (!Array.isArray(data.cashGames)) data.cashGames = [];
  const idx = data.cashGames.findIndex(cg => String(cg.id) === String(snapshot.id));
  if (idx >= 0) {
    data.cashGames[idx] = { ...data.cashGames[idx], ...snapshot };
  } else {
    data.cashGames.push(snapshot);
  }
}

function upsertCurrentCashGameSnapshot(status = 'active') {
  const snapshot = buildCurrentCashGameSnapshot(status);
  upsertCashGameSnapshot(snapshot);
  if (status === 'active') {
    data.activeCashGameId = snapshot.id;
  } else if (String(data.activeCashGameId) === String(snapshot.id)) {
    data.activeCashGameId = null;
  }
  if (typeof touchPlayersActivity === 'function') {
    touchPlayersActivity((snapshot.players || []).map(player => player.name));
  }
  return snapshot;
}

function startCashRecording() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  isRecording = true;
  upsertCurrentCashGameSnapshot('active');
  saveData();
  updateRecordButton();
  showToast('Recording started. You can close the page and resume later.');
}

function stopCashRecording() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
  }
  upsertCurrentCashGameSnapshot('settled');
  isRecording = false;
  cashSelectedPlayers = new Set();
  cashPlayerData = {};
  saveData({remote:false});
  upsertRemoteStateNow();
  renderCashPage();
  showToast('Recording finished and saved to history');
}

function updateRecordButton() {
  const btn = document.getElementById('record-btn');
  const editSaveBtn = document.getElementById('cash-edit-save-btn');
  const editCancelBtn = document.getElementById('cash-edit-cancel-btn');
  const editBanner = document.getElementById('cash-edit-banner');
  if (!btn) return;

  if (editingCashGameId !== null) {
    btn.style.display = 'none';
    if (editSaveBtn) editSaveBtn.style.display = '';
    if (editCancelBtn) editCancelBtn.style.display = '';
    if (editBanner) editBanner.style.display = '';
    return;
  }

  btn.style.display = '';
  if (editSaveBtn) editSaveBtn.style.display = 'none';
  if (editCancelBtn) editCancelBtn.style.display = 'none';
  if (editBanner) editBanner.style.display = 'none';

  btn.textContent = 'Finish game';
  btn.className = 'btn btn-primary';
  btn.disabled = !isRecording;
  btn.style.display = isRecording ? '' : 'none';
}

function loadCashGameIntoEditor(cg) {
  const cppInput = document.getElementById('cash-cpp');
  const pphInput = document.getElementById('cash-pph');
  if (cppInput && Number.isFinite(cg.chipsPerHand)) cppInput.value = cg.chipsPerHand;
  if (pphInput && Number.isFinite(cg.pricePerHand)) pphInput.value = cg.pricePerHand;

  cashSelectedPlayers = new Set();
  cashPlayerData = {};
  (cg.players || []).forEach(player => {
    if (!player || !player.name) return;
    if (Array.isArray(data.players) && !data.players.includes(player.name)) {
      data.players.push(player.name);
    }
    cashSelectedPlayers.add(player.name);
    cashPlayerData[player.name] = {
      endChips: Number.isSafeInteger(player.endChips) ? player.endChips : 0,
      rebuys: Array.isArray(player.rebuys) ? player.rebuys : [{ time: getCurrentTime(), amount: 1 }]
    };
  });
}

async function editCashGameFromHistory(id) {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  const cg = (data.cashGames || []).find(item => String(item.id) === String(id));
  if (!cg) {
    showToast('Cash game not found');
    return;
  }

  if (isRecording && String(data.activeCashGameId) !== String(cg.id)) {
    const ok = confirm('A cash game is in progress. Save it before editing history?');
    if (!ok) return;
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }
    upsertCurrentCashGameSnapshot('active');
    await saveData();
  }

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
  }

  isRecording = false;
  editingCashGameId = String(cg.id);
  loadCashGameIntoEditor(cg);

  if (typeof currentMatchMode !== 'undefined') currentMatchMode = 'cash';
  if (typeof switchTab === 'function') switchTab('match');
  if (typeof applyMatchModeVisibility === 'function') applyMatchModeVisibility('cash');
  renderCashPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Editing a past cash game');
}

async function saveCashGameEdit() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (editingCashGameId === null) return;
  const existing = (data.cashGames || []).find(item => String(item.id) === String(editingCashGameId));
  if (!existing) {
    showToast('Cash game not found');
    editingCashGameId = null;
    updateRecordButton();
    return;
  }

  const result = buildCashGameSnapshotForEdit(existing);
  if (!result.ok) {
    showToast(result.error);
    renderCashPlayers();
    return;
  }

  upsertCashGameSnapshot(result.snapshot);
  if (result.snapshot.status === 'active') {
    data.activeCashGameId = result.snapshot.id;
  } else if (String(data.activeCashGameId) === String(result.snapshot.id)) {
    data.activeCashGameId = null;
  }
  if (typeof touchPlayersActivity === 'function') {
    touchPlayersActivity((result.snapshot.players || []).map(player => player.name));
  }

  editingCashGameId = null;
  cashSelectedPlayers = new Set();
  cashPlayerData = {};
  await saveData();
  if (typeof switchTab === 'function') switchTab('history');
  showToast('Cash game changes saved');
}

function cancelCashGameEdit() {
  if (editingCashGameId === null) return;
  editingCashGameId = null;
  cashSelectedPlayers = new Set();
  cashPlayerData = {};
  isRecording = false;
  if (typeof switchTab === 'function') switchTab('history');
  showToast('Editing canceled');
}

function restoreActiveCashGameIfNeeded() {
  if (typeof clubState !== 'undefined' && clubState.active && !clubCanWrite()) return false;
  const active = getActiveCashGameRecord();
  if (!active) return false;
  if (!data.activeCashGameId) data.activeCashGameId = active.id;
  loadCashGameIntoEditor(active);
  isRecording = true;
  return true;
}
