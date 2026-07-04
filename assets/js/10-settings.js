// ====== UI: Settings ======
let playerManageKeyword = '';
let playerManageEditMode = false;
let playerActivitySaveTimer = null;

function escapePlayerManageHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePlayerSearchValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getPlayerSearchInitials(name) {
  const value = typeof normalizePlayerNameForSort === 'function'
    ? normalizePlayerNameForSort(name)
    : String(name ?? '').trim();
  return Array.from(value).map(char => {
    if (/[A-Za-z0-9]/.test(char)) return char.toLowerCase();
    if (/\p{Script=Han}/u.test(char) && typeof getPlayerSortBucket === 'function') {
      return String(getPlayerSortBucket(char)).toLowerCase();
    }
    return '';
  }).join('');
}

function doesPlayerMatchKeyword(name, keyword) {
  const query = normalizePlayerSearchValue(keyword);
  if (!query) return true;
  const normalizedName = normalizePlayerSearchValue(name);
  const initials = getPlayerSearchInitials(name);
  return normalizedName.includes(query) || initials.includes(query);
}

function sortPlayerNamesForManagement(names) {
  if (typeof sortPlayerNamesByRecentActivity === 'function') {
    return sortPlayerNamesByRecentActivity(names);
  }
  return sortPlayerNamesForDisplay(names);
}

function getFilteredPlayers() {
  const keyword = normalizePlayerSearchValue(playerManageKeyword);
  if (!keyword) return sortPlayerNamesForManagement(data.players);
  return sortPlayerNamesForManagement(data.players.filter(name => doesPlayerMatchKeyword(name, keyword)));
}

function renderSettings() {
  if (typeof renderAuthPanel === 'function') renderAuthPanel();

  const list = document.getElementById('player-manage-list');
  const searchInput = document.getElementById('player-search-input');
  const editBtn = document.getElementById('player-edit-toggle-btn');

  if (searchInput && searchInput.value !== playerManageKeyword) {
    searchInput.value = playerManageKeyword;
  }
  if (editBtn) {
    editBtn.textContent = playerManageEditMode ? '完成' : '编辑';
    editBtn.className = playerManageEditMode ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  }

  list.innerHTML = '';
  const filteredPlayers = getFilteredPlayers();
  if (filteredPlayers.length === 0) {
    list.innerHTML = `<div class="player-manage-empty">${playerManageKeyword.trim() ? '未找到匹配玩家' : '暂无玩家'}</div>`;
  }

  filteredPlayers.forEach(name => {
    const safeName = escapePlayerManageHtml(name);
    const item = document.createElement('div');
    item.className = 'player-list-item';
    item.dataset.playerName = name;
    item.innerHTML = `
      <span class="player-list-name">${safeName}</span>
      <div class="player-list-actions${playerManageEditMode ? '' : ' hidden'}">
        <button class="rename-player" onclick="renamePlayerFromButton(this)">改名</button>
        <button class="delete-player" onclick="removePlayerFromButton(this)">删除</button>
      </div>
    `;
    list.appendChild(item);
  });


}

function onPlayerSearchChange(value) {
  playerManageKeyword = String(value || '').trimStart();
  touchPlayerSearchMatches(playerManageKeyword);
  renderSettings();
}

function schedulePlayerActivityLocalSave() {
  if (playerActivitySaveTimer) clearTimeout(playerActivitySaveTimer);
  playerActivitySaveTimer = setTimeout(() => {
    playerActivitySaveTimer = null;
    saveData({ remote: false });
  }, 600);
}

function touchPlayerSearchMatches(keyword) {
  const query = normalizePlayerSearchValue(keyword);
  if (!query || typeof touchPlayersActivity !== 'function') return;
  const matches = (data.players || []).filter(name => doesPlayerMatchKeyword(name, query));
  if (matches.length > 0 && touchPlayersActivity(matches)) {
    schedulePlayerActivityLocalSave();
  }
}

function togglePlayerEditMode() {
  playerManageEditMode = !playerManageEditMode;
  renderSettings();
}

async function addPlayer() {
  const input = document.getElementById('new-player-name');
  const name = input.value.trim();
  if (!name) return;
  if (data.players.includes(name)) {
    showToast('玩家已存在');
    return;
  }
  data.players.push(name);
  if (typeof touchPlayersActivity === 'function') touchPlayersActivity(name);
  await saveData();
  playerManageKeyword = '';
  const searchInput = document.getElementById('player-search-input');
  if (searchInput) searchInput.value = '';
  input.value = '';
  renderSettings();
  showToast('已添加');
}

async function removePlayer(name) {
  if (!confirm(`确定删除玩家「${name}」吗？`)) return;

  const usedInTournament = data.tournaments.some(t => t.participants.includes(name));
  const usedInCash = data.cashGames.some(cg => (cg.players || []).some(p => p.name === name));
  if (usedInTournament || usedInCash) {
    showToast('该玩家有历史记录，无法删除');
    return;
  }
  data.players = data.players.filter(p => p !== name);
  await saveData();
  renderSettings();
  showToast('玩家已删除');
}

function getPlayerNameFromActionButton(button) {
  const item = button && button.closest ? button.closest('.player-list-item') : null;
  return item ? item.dataset.playerName : '';
}

function removePlayerFromButton(button) {
  const name = getPlayerNameFromActionButton(button);
  if (name) removePlayer(name);
}

function renamePlayerFromButton(button) {
  const name = getPlayerNameFromActionButton(button);
  if (name) renamePlayer(name);
}

function renameNameInSet(set, oldName, newName) {
  if (!set || typeof set.has !== 'function' || !set.has(oldName)) return;
  set.delete(oldName);
  set.add(newName);
}

function renameNameArray(list, oldName, newName) {
  return Array.isArray(list) ? list.map(name => name === oldName ? newName : name) : list;
}

function renameObjectKey(map, oldName, newName) {
  if (!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, oldName)) return;
  if (!Object.prototype.hasOwnProperty.call(map, newName)) {
    map[newName] = map[oldName];
  }
  delete map[oldName];
}

function renameCurrentPlayerState(oldName, newName) {
  if (typeof selectedPlayers !== 'undefined') renameNameInSet(selectedPlayers, oldName, newName);
  if (typeof playerPickerDraft !== 'undefined') renameNameInSet(playerPickerDraft, oldName, newName);

  if (typeof cashSelectedPlayers !== 'undefined') renameNameInSet(cashSelectedPlayers, oldName, newName);
  if (typeof cashPlayerData !== 'undefined') renameObjectKey(cashPlayerData, oldName, newName);

  if (typeof inGameState !== 'undefined' && inGameState) {
    inGameState.players = renameNameArray(inGameState.players, oldName, newName);
    inGameState.eliminatedOrder = renameNameArray(inGameState.eliminatedOrder, oldName, newName);
    renameObjectKey(inGameState.playerData, oldName, newName);
  }
}

function renamePlayerEverywhere(oldName, newName) {
  data.players = renameNameArray(data.players, oldName, newName);
  if (typeof renamePlayerActivity === 'function') renamePlayerActivity(oldName, newName);

  (data.tournaments || []).forEach(t => {
    t.participants = renameNameArray(t.participants, oldName, newName);
    (t.rankings || []).forEach(r => {
      r.players = renameNameArray(r.players, oldName, newName);
    });
    renameObjectKey(t.rebuys, oldName, newName);
  });

  (data.cashGames || []).forEach(cg => {
    (cg.players || []).forEach(player => {
      if (player && player.name === oldName) player.name = newName;
    });
  });

  renameCurrentPlayerState(oldName, newName);
}

async function renamePlayer(oldName) {
  const currentName = String(oldName || '');
  if (!data.players.includes(currentName)) {
    showToast('玩家不存在');
    renderSettings();
    return;
  }

  const nextName = String(prompt('修改玩家名称', currentName) || '').trim();
  if (!nextName || nextName === currentName) return;
  if (data.players.includes(nextName)) {
    showToast('玩家已存在');
    return;
  }

  renamePlayerEverywhere(currentName, nextName);
  await saveData();
  if (playerManageKeyword === currentName) playerManageKeyword = nextName;
  renderSettings();
  if (typeof renderEntryPage === 'function') renderEntryPage();
  if (typeof renderCashPage === 'function') renderCashPage();
  if (typeof renderInGamePlayers === 'function' && typeof inGameState !== 'undefined' && inGameState.active) renderInGamePlayers();
  showToast('玩家已改名');
}


function copyWechatCTA() {
  const text = '_xueyuanhuang';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制微信号，备注「poker」添加');
    }).catch(() => {
      showToast('复制失败，请手动添加');
    });
    return;
  }

  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    showToast('已复制微信号，备注「poker」添加');
  } catch {
    showToast('复制失败，请手动添加');
  } finally {
    document.body.removeChild(temp);
  }
}

function validateImportedData(imported) {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
    return { ok: false, error: '根对象格式错误（应为 JSON 对象）' };
  }
  if (!Array.isArray(imported.players)) {
    return { ok: false, error: '缺少 players 数组' };
  }
  if (!Array.isArray(imported.tournaments)) {
    return { ok: false, error: '缺少 tournaments 数组' };
  }
  if (imported.cashGames !== undefined && !Array.isArray(imported.cashGames)) {
    return { ok: false, error: 'cashGames 必须是数组' };
  }

  const invalidPlayer = imported.players.find(p => typeof p !== 'string' || !p.trim());
  if (invalidPlayer !== undefined) {
    return { ok: false, error: 'players 中存在空名称或非字符串项' };
  }
  if (new Set(imported.players).size !== imported.players.length) {
    return { ok: false, error: 'players 中存在重复玩家名称' };
  }

  for (let i = 0; i < imported.tournaments.length; i++) {
    const t = imported.tournaments[i];
    if (!t || typeof t !== 'object') {
      return { ok: false, error: `tournaments[${i}] 不是对象` };
    }
    if (!Array.isArray(t.participants)) {
      return { ok: false, error: `tournaments[${i}].participants 必须是数组` };
    }
    if (!Array.isArray(t.rankings)) {
      return { ok: false, error: `tournaments[${i}].rankings 必须是数组` };
    }
    const hasLegacyRatio = Array.isArray(t.ratio) && t.ratio.length === 3 && t.ratio.every(v => Number.isFinite(v) && v > 0);
    const hasScoringRule = t.scoringRule && Array.isArray(t.scoringRule.weights) && t.scoringRule.weights.length > 0;
    if (!hasLegacyRatio && !hasScoringRule) {
      return { ok: false, error: `tournaments[${i}] 缺少有效积分规则` };
    }
  }

  const cashGames = imported.cashGames || [];
  for (let i = 0; i < cashGames.length; i++) {
    const cg = cashGames[i];
    if (!cg || typeof cg !== 'object') {
      return { ok: false, error: `cashGames[${i}] 不是对象` };
    }
    if (!Array.isArray(cg.players)) {
      return { ok: false, error: `cashGames[${i}].players 必须是数组` };
    }
  }

  return {
    ok: true,
    summary: {
      players: imported.players.length,
      tournaments: imported.tournaments.length,
      cashGames: cashGames.length
    }
  };
}

function exportData() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `texasholdem_data_${date}_${hh}${mm}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`已导出：${data.tournaments.length} 场锦标赛 / ${data.cashGames.length} 场 Cash Game`);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      const validation = validateImportedData(imported);
      if (!validation.ok) {
        showToast(`导入失败：${validation.error}`);
        return;
      }

      data = imported;
      migrateData(data);
      await saveData();
      renderEntryPage();
      if (document.getElementById('page-history').classList.contains('active')) renderHistory();
      if (document.getElementById('page-settings').classList.contains('active')) renderSettings();
      showToast(`导入成功：${validation.summary.tournaments} 场锦标赛 / ${validation.summary.cashGames} 场 Cash Game`);
    } catch {
      showToast(`导入失败：${file.name} 不是有效 JSON`);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

async function resetData() {
  const tournamentCount = data.tournaments.length;
  const cashCount = data.cashGames.length;
  if (!confirm(`确定要重置所有数据吗？将删除 ${tournamentCount} 场锦标赛、${cashCount} 场 Cash Game。`)) return;
  if (!confirm('最后确认：该操作不可撤销。')) return;
  await clearDataStorage();
  await loadData();
  renderEntryPage();
  if (document.getElementById('page-settings').classList.contains('active')) renderSettings();
  showToast('数据已重置为默认状态');
}
