// ====== Cash Game ======
let cashSelectedPlayers = new Set();
let cashPlayerData = {}; // { name: { endChips, rebuys: [{time, amount}] } }
let isRecording = false; // Auto-save recording mode

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

  if (cpp === null) errors.push('每手筹码必须是正整数');
  if (pph === null) errors.push('每手积分必须是正整数');

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
  if (!isRecording) {
    startCashRecording();
    return;
  }
  stopCashRecording();
}

function renderCashPage() {
  renderCashImportOptions();

  const restoredActive = restoreActiveCashGameIfNeeded();
  if (!restoredActive) {
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
        label: `${formatDateShort(cg.date)} · ${cg.players.length}名玩家${cg.status === 'active' ? ' · 记录中' : ''}`,
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
      label: `第${t.matchNo}场 · ${formatDateShort(t.date)} (${t.participants.length}人)`,
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
    opt.textContent = source === 'cash' ? '暂无 Cash Game 记录' : '暂无锦标赛记录';
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
    showToast('没有可导入的玩家');
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
  showToast(`已导入 ${importedNames.length} 名玩家`);
}

function importFromHistoryRecord() {
  const recordSelect = document.getElementById('cash-history-select');
  if (!recordSelect || recordSelect.disabled) return;

  const records = getCashImportRecords(getCashImportSource());
  const record = records[parseInt(recordSelect.value, 10)];
  if (!record || record.names.length === 0) {
    showToast('没有可导入的玩家');
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
    container.innerHTML = '<div class="selection-summary-empty">尚未选择玩家</div>';
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
    timeline.innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px;">暂无买入记录</div>';
  } else {
    settlement.timeline.forEach(r => {
      const item = document.createElement('div');
      item.className = 'transfer-item';
      item.innerHTML = `
        <span style="color:var(--text2);font-family:monospace;">${r.time}</span>
        <span>${r.name}</span>
        <span class="transfer-amount" style="color:var(--accent);">+${r.amount}手</span>
      `;
      timeline.appendChild(item);
    });
  }

  updateCashValidation(settlement);
  autoSaveCashGame();
  updateRecordButton();
}

function changeBuyIn(name, delta) {
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
  const pd = cashPlayerData[name];
  if (pd) {
    if (!Array.isArray(pd.rebuys)) pd.rebuys = [];
    pd.rebuys.push({ time: getCurrentTime(), amount: 1 });
    renderCashPlayers();
    showToast(`${name} 补码 1 手`);
  }
}

function updateEndChips(name, value) {
  const pd = cashPlayerData[name];
  if (!pd) return;

  const parsed = parseStrictNonNegativeInt(value);
  if (parsed === null) {
    showToast('剩余筹码必须是非负整数');
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
        <span>校验结果</span>
        <span>暂不可结算</span>
      </div>
      ${Array.from(issues).map(msg => `
        <div class="cash-summary-row" style="color:var(--text2);font-size:12px;">
          <span>提示</span>
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
      <span>总买入筹码</span>
      <span>${totalBuyIn.toLocaleString()}</span>
    </div>
    <div class="cash-summary-row">
      <span>总剩余筹码</span>
      <span>${totalEnd.toLocaleString()}</span>
    </div>
    <div class="cash-summary-row ${isValid ? 'ok' : 'warn'}">
      <span>差额</span>
      <span>${isValid ? '校验通过' : `差 ${diff > 0 ? '+' : ''}${diff.toLocaleString()} 筹码`}</span>
    </div>
    <div class="cash-summary-row" style="color:var(--text2);font-size:12px;">
      <span>换算</span>
      <span>${config.cpp} 筹码 = ${config.pph} 积分</span>
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
  if (title) title.textContent = settlementPlan.isOptimal ? '转账方案（最优）' : '转账方案（近似）';

  if (settlementPlan.transfers.length === 0) {
    container.innerHTML = '<div style="color:var(--text2);font-size:14px;text-align:center;padding:12px;">无需转账，皆大欢喜！</div>';
    return;
  }

  settlementPlan.transfers.forEach(t => {
    const item = document.createElement('div');
    item.className = 'transfer-item';
    item.innerHTML = `
      <span>${t.from}</span>
      <span class="transfer-arrow">→</span>
      <span>${t.to}</span>
      <span class="transfer-amount">${formatScore(t.amountScore)} 分</span>
    `;
    container.appendChild(item);
  });
}

// Auto-save cash game state
let autoSaveTimeout = null;
function autoSaveCashGame() {
  if (!isRecording) return; // Only save when recording
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(async () => {
    upsertCurrentCashGameSnapshot('active');
    await saveData();
    showSaveIndicator();
  }, 1000); // Debounce 1 second
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
  isRecording = true;
  upsertCurrentCashGameSnapshot('active');
  saveData();
  updateRecordButton();
  showToast('已开始记录，可关闭页面后继续');
}

function stopCashRecording() {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
  }
  upsertCurrentCashGameSnapshot('settled');
  isRecording = false;
  cashSelectedPlayers = new Set();
  cashPlayerData = {};
  saveData();
  renderCashPage();
  showToast('已结束记录，已保存到历史');
}

function updateRecordButton() {
  const btn = document.getElementById('record-btn');
  if (!btn) return;
  if (isRecording) {
    btn.textContent = '结束记录';
    btn.className = 'btn btn-danger';
  } else {
    btn.textContent = '开始记录';
    btn.className = 'btn btn-primary';
  }
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
    cashSelectedPlayers.add(player.name);
    cashPlayerData[player.name] = {
      endChips: Number.isSafeInteger(player.endChips) ? player.endChips : 0,
      rebuys: Array.isArray(player.rebuys) ? player.rebuys : [{ time: getCurrentTime(), amount: 1 }]
    };
  });
}

function restoreActiveCashGameIfNeeded() {
  const active = getActiveCashGameRecord();
  if (!active) return false;
  if (!data.activeCashGameId) data.activeCashGameId = active.id;
  loadCashGameIntoEditor(active);
  isRecording = true;
  return true;
}
