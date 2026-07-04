// ====== UI: Entry Page ======
let selectedPlayers = new Set();
let playerPickerMode = 'tournament';
let playerPickerDraft = new Set();
let playerPickerKeyword = '';

function escapeEntryHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pruneSelectionWithCurrentRoster(selectionSet) {
  const roster = new Set(data.players || []);
  Array.from(selectionSet).forEach(name => {
    if (!roster.has(name)) selectionSet.delete(name);
  });
}

function renderSelectionSummary(containerId, selectedNames, totalCount) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const selected = sortPlayerNamesForDisplay(Array.isArray(selectedNames) ? selectedNames : []);
  const safeTotal = Number.isFinite(totalCount) ? totalCount : 0;

  if (selected.length === 0) {
    container.innerHTML = `
      <div class="selection-summary-head"><span>Selected</span><b>0 / ${safeTotal}</b></div>
      <div class="selection-summary-empty">尚未选择玩家</div>
    `;
    return;
  }

  const visible = selected.slice(0, 6);
  const overflow = selected.length - visible.length;
  container.innerHTML = `
    <div class="selection-summary-head"><span>Selected</span><b>${selected.length} / ${safeTotal}</b></div>
    <div class="selection-chip-list">
      ${visible.map(name => `<span class="selection-chip">${name}</span>`).join('')}
      ${overflow > 0 ? `<span class="selection-chip more">+${overflow}</span>` : ''}
    </div>
  `;
}

function renderTournamentPlayerSummary() {
  pruneSelectionWithCurrentRoster(selectedPlayers);
  renderSelectionSummary('tournament-player-summary', Array.from(selectedPlayers), data.players.length);
}

function getLatestLineup(mode) {
  if (mode === 'cash') {
    const list = (data.cashGames || []).slice().sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
      const aNum = Number(a.id);
      const bNum = Number(b.id);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
    const latest = list.find(item => Array.isArray(item.players) && item.players.length > 0);
    return latest ? latest.players.map(p => p.name).filter(Boolean) : [];
  }

  const list = (data.tournaments || []).slice().sort((a, b) => {
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return (b.id || 0) - (a.id || 0);
  });
  const latest = list.find(item => Array.isArray(item.participants) && item.participants.length > 0);
  return latest ? latest.participants.slice() : [];
}

function openPlayerPicker(mode) {
  playerPickerMode = mode === 'cash' ? 'cash' : 'tournament';
  playerPickerKeyword = '';

  const sourceSet = playerPickerMode === 'cash'
    ? (typeof cashSelectedPlayers !== 'undefined' ? cashSelectedPlayers : new Set())
    : selectedPlayers;

  playerPickerDraft = new Set(Array.from(sourceSet));
  pruneSelectionWithCurrentRoster(playerPickerDraft);

  const title = document.getElementById('player-picker-title');
  if (title) {
    title.textContent = playerPickerMode === 'cash' ? 'Cash Game Players' : 'Tournament Players';
  }

  const search = document.getElementById('player-picker-search');
  if (search) search.value = '';

  renderPlayerPickerSelected();
  renderPlayerPickerList();
  document.getElementById('player-picker-modal').classList.add('open');
}

function closePlayerPicker() {
  commitPlayerPickerSelection();
  const modal = document.getElementById('player-picker-modal');
  if (modal) modal.classList.remove('open');
}

function onPlayerPickerSearch(value) {
  playerPickerKeyword = String(value || '').trimStart();
  renderPlayerPickerList();
}

function doesPlayerPickerMatchKeyword(name, keyword) {
  if (typeof doesPlayerMatchKeyword === 'function') {
    return doesPlayerMatchKeyword(name, keyword);
  }
  const query = String(keyword || '').trim().toLowerCase();
  return !query || String(name).toLowerCase().includes(query);
}

function renderPlayerPickerSelected() {
  const container = document.getElementById('player-picker-selected');
  if (!container) return;
  const selected = sortPlayerNamesForDisplay(Array.from(playerPickerDraft));
  const safeTotal = Number.isFinite(data.players.length) ? data.players.length : 0;

  if (selected.length === 0) {
    container.innerHTML = `
      <div class="selection-summary-head"><span>Selected</span><b>0 / ${safeTotal}</b></div>
      <div class="selection-summary-empty">尚未选择玩家</div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="selection-summary-head"><span>Selected</span><b>${selected.length} / ${safeTotal}</b></div>
    <div class="selection-chip-list">
      ${selected.map(name => {
        const safeName = escapeEntryHtml(name);
        return `<button class="selection-chip selection-chip-button" data-player-name="${safeName}" onclick="togglePlayerInPickerFromButton(this)">${safeName}</button>`;
      }).join('')}
    </div>
  `;
}

function renderPlayerPickerList() {
  const container = document.getElementById('player-picker-list');
  if (!container) return;

  const keyword = playerPickerKeyword;
  const players = sortPlayerNamesForDisplay((data.players || []).filter(name => {
    return doesPlayerPickerMatchKeyword(name, keyword);
  }));

  if (players.length === 0) {
    container.innerHTML = '<div class="picker-empty">没有匹配玩家</div>';
    return;
  }

  container.innerHTML = players.map(name => {
    const active = playerPickerDraft.has(name);
    const safeName = escapeEntryHtml(name);
    return `
      <button class="picker-player-item${active ? ' active' : ''}" data-player-name="${safeName}" onclick="togglePlayerInPickerFromButton(this)">
        <span>${safeName}</span>
        <span class="picker-player-check">${active ? 'SELECTED' : ''}</span>
      </button>
    `;
  }).join('');
}

function togglePlayerInPickerFromButton(button) {
  const name = button && button.dataset ? button.dataset.playerName : '';
  if (name) togglePlayerInPicker(name);
}

function togglePlayerInPicker(name) {
  if (playerPickerDraft.has(name)) {
    playerPickerDraft.delete(name);
  } else {
    playerPickerDraft.add(name);
  }
  renderPlayerPickerSelected();
  renderPlayerPickerList();
}

function useLastLineupInPicker() {
  const lineup = getLatestLineup(playerPickerMode).filter(name => (data.players || []).includes(name));
  if (lineup.length === 0) {
    showToast('没有可用的最近阵容');
    return;
  }
  playerPickerDraft = new Set(lineup);
  renderPlayerPickerSelected();
  renderPlayerPickerList();
}

function clearPlayerPickerSelection() {
  playerPickerDraft.clear();
  renderPlayerPickerSelected();
  renderPlayerPickerList();
}

function commitPlayerPickerSelection() {
  if (playerPickerMode === 'cash') {
    if (typeof applyCashPlayerSelectionFromPicker === 'function') {
      applyCashPlayerSelectionFromPicker(Array.from(playerPickerDraft));
    }
  } else {
    selectedPlayers = new Set(Array.from(playerPickerDraft));
    renderEntryPage();
  }
}

function applyPlayerPickerSelection() {
  closePlayerPicker();
}

function renderEntryPage() {
  renderTournamentPlayerSummary();
  updateRankSelects();
  updatePreview();

  // Show/hide "Start Game" button based on player selection
  const startBtn = document.getElementById('start-game-btn');
  if (selectedPlayers.size >= 2) {
    startBtn.style.display = '';
  } else {
    startBtn.style.display = 'none';
  }

}

function togglePlayer(name) {
  if (selectedPlayers.has(name)) {
    selectedPlayers.delete(name);
  } else {
    selectedPlayers.add(name);
  }
  renderEntryPage();
}

function updateRankSelects() {
  const selected = sortPlayerNamesForDisplay(Array.from(selectedPlayers));
  for (let rank = 1; rank <= 3; rank++) {
    const container = document.getElementById(`rank${rank}-selects`);
    if (!container) continue; // May not exist in all views
    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = `<option value="">-- 选择第${rank}名 --</option>`;
      selected.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      if (selected.includes(currentVal)) {
        sel.value = currentVal;
      }
    });
  }
}

function resetRankSelectRows() {
  for (let rank = 1; rank <= 3; rank++) {
    const container = document.getElementById(`rank${rank}-selects`);
    if (!container) continue;
    container.innerHTML = `<select id="rank${rank}-0" onchange="onRankChange()"><option value="">-- 选择第${rank}名 --</option></select>`;
  }
}

function addTie(rank) {
  const container = document.getElementById(`rank${rank}-selects`);
  const count = container.querySelectorAll('select').length;
  const sel = document.createElement('select');
  sel.id = `rank${rank}-${count}`;
  sel.onchange = onRankChange;
  sel.style.marginTop = '6px';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-tie-btn';
  removeBtn.textContent = '✕';
  removeBtn.onclick = () => {
    wrapper.remove();
    onRankChange();
  };

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '4px';
  wrapper.style.marginTop = '6px';
  sel.style.flex = '1';
  wrapper.appendChild(sel);
  wrapper.appendChild(removeBtn);
  container.appendChild(wrapper);
  updateRankSelects();
}

function clearDuplicateRankSelections() {
  const used = new Set();
  let removed = false;

  for (let rank = 1; rank <= 3; rank++) {
    const container = document.getElementById(`rank${rank}-selects`);
    if (!container) continue;
    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      if (!sel.value) return;
      if (used.has(sel.value)) {
        sel.value = '';
        removed = true;
        return;
      }
      used.add(sel.value);
    });
  }

  return removed;
}

function applyRankingsToTop3(rankings) {
  resetRankSelectRows();
  updateRankSelects();

  const placePlayers = { 1: [], 2: [], 3: [] };
  const used = new Set();
  (rankings || []).forEach(r => {
    const place = parseInt(r.place, 10);
    if (![1, 2, 3].includes(place) || !Array.isArray(r.players)) return;
    r.players.forEach(name => {
      if (!name || used.has(name)) return;
      used.add(name);
      placePlayers[place].push(name);
    });
  });

  [1, 2, 3].forEach(place => {
    const players = placePlayers[place];
    for (let i = 1; i < players.length; i++) {
      addTie(place);
    }
  });

  updateRankSelects();

  [1, 2, 3].forEach(place => {
    const container = document.getElementById(`rank${place}-selects`);
    if (!container) return;
    const selects = Array.from(container.querySelectorAll('select'));
    placePlayers[place].forEach((name, idx) => {
      if (selects[idx]) {
        selects[idx].value = name;
      }
    });
  });
}

function getRankings() {
  const rankings = [];
  const used = new Set();
  for (let rank = 1; rank <= 3; rank++) {
    const container = document.getElementById(`rank${rank}-selects`);
    if (!container) continue;
    const selects = container.querySelectorAll('select');
    const players = [];
    selects.forEach(sel => {
      if (!sel.value || used.has(sel.value)) return;
      players.push(sel.value);
      used.add(sel.value);
    });
    if (players.length > 0) {
      rankings.push({ place: rank, players });
    }
  }
  return rankings;
}

function onRankChange() {
  const hadDuplicate = clearDuplicateRankSelections();
  if (hadDuplicate) {
    showToast('同一玩家不能重复占用多个名次，重复项已清空');
  }
  updatePreview();
}

function updatePreview() {
  const rankings = getRankings();
  const selected = Array.from(selectedPlayers);

  const saveBtn = document.getElementById('save-btn');
  if (!saveBtn) return;

  if (selected.length < 2 || rankings.length === 0) {
    saveBtn.style.display = 'none';
    return;
  }

  saveBtn.style.display = '';
}

async function saveTournament() {
  const date = new Date().toISOString().split('T')[0];

  const participants = Array.from(selectedPlayers);
  if (participants.length < 2) { showToast('至少需要2名参赛玩家'); return; }

  const rankings = getRankings();
  if (rankings.length === 0) { showToast('请选择至少第1名'); return; }

  const id = data.tournaments.length > 0
    ? Math.max(...data.tournaments.map(t => t.id)) + 1
    : 1;

  // Include rebuy data from in-game state if available
  const rebuys = {};
  if (inGameState.playerData) {
    participants.forEach(name => {
      const pd = inGameState.playerData[name];
      if (pd && pd.rebuys > 0) {
        rebuys[name] = pd.rebuys;
      }
    });
  }

  data.tournaments.push({
    id,
    date,
    participants,
    rankings,
    scoringRule: data.scoringRule || { baseScore: 1, weights: [5, 3, 2] },
    rebuys: Object.keys(rebuys).length > 0 ? rebuys : undefined
  });

  // Add new players if any
  participants.forEach(p => {
    if (!data.players.includes(p)) data.players.push(p);
  });
  if (typeof touchPlayersActivity === 'function') touchPlayersActivity(participants);

  await saveData();
  showToast('比赛已保存！');

  // Reset form and in-game state
  selectedPlayers.clear();
  // Reset rank selects
  resetRankSelectRows();
  // Reset in-game state
  inGameState.active = false;
  inGameState.playerData = {};
  inGameState.eliminatedOrder = [];
  inGameState.players = [];
  // Show rankings card again
  document.getElementById('rankings-card').style.display = '';
  document.getElementById('start-game-btn').style.display = 'none';
  document.getElementById('save-btn').style.display = 'none';
  renderEntryPage();
}
