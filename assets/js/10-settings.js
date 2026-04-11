// ====== UI: Settings ======
let playerManageKeyword = '';
let playerManageEditMode = false;

function getFilteredPlayers() {
  const keyword = playerManageKeyword.trim().toLowerCase();
  if (!keyword) return sortPlayerNamesForDisplay(data.players);
  return sortPlayerNamesForDisplay(data.players.filter(name => String(name).toLowerCase().includes(keyword)));
}

function renderSettings() {
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
    const item = document.createElement('div');
    item.className = 'player-list-item';
    item.innerHTML = `
      <span>${name}</span>
      <button class="delete-player${playerManageEditMode ? '' : ' hidden'}" onclick="removePlayer('${name.replace(/'/g, "\\'")}')">删除</button>
    `;
    list.appendChild(item);
  });

  document.getElementById('ratio1').value = data.currentRatio[0];
  document.getElementById('ratio2').value = data.currentRatio[1];
  document.getElementById('ratio3').value = data.currentRatio[2];
  document.getElementById('current-ratio-display').textContent = data.currentRatio.join(' : ');

  document.getElementById('setting-chips-per-hand').value = data.cashSettings.chipsPerHand;
  document.getElementById('setting-price-per-hand').value = data.cashSettings.pricePerHand;
}

function onPlayerSearchChange(value) {
  playerManageKeyword = String(value || '').trimStart();
  renderSettings();
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

async function updateRatio() {
  const r1 = parseInt(document.getElementById('ratio1').value, 10);
  const r2 = parseInt(document.getElementById('ratio2').value, 10);
  const r3 = parseInt(document.getElementById('ratio3').value, 10);
  if (isNaN(r1) || isNaN(r2) || isNaN(r3) || r1 <= 0 || r2 <= 0 || r3 <= 0) {
    showToast('请输入有效的正整数');
    return;
  }
  data.currentRatio = [r1, r2, r3];
  await saveData();
  renderSettings();
  showToast('比例已更新');
}

function copyWechatCTA() {
  const text = 'AI 小作坊';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制：AI 小作坊');
    }).catch(() => {
      showToast('复制失败，请手动添加');
    });
    return;
  }

  // 兼容旧环境：临时 textarea 复制
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    showToast('已复制：AI 小作坊');
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
    if (!Array.isArray(t.ratio) || t.ratio.length !== 3 || t.ratio.some(v => !Number.isFinite(v) || v <= 0)) {
      return { ok: false, error: `tournaments[${i}].ratio 必须是 3 个正数` };
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
      if (document.getElementById('page-leaderboard').classList.contains('active')) renderLeaderboard();
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
