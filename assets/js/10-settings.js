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

  renderScoringRuleEditor();

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

// ====== Scoring Rule Editor ======
function renderScoringRuleEditor() {
  const rule = normalizeScoringRule(data.scoringRule);
  document.getElementById('scoring-base').value = rule.baseScore;
  renderScoringWeightsList(rule.weights);
  renderScoringPreview();
}

function renderScoringWeightsList(weights) {
  const list = document.getElementById('scoring-weights-list');
  if (!list) return;
  const w = weights || getScoringWeightsFromUI();
  const placeLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  list.innerHTML = w.map((val, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <span style="font-size:13px;width:36px;color:var(--text2);">${placeLabels[i] || (i + 1) + 'th'}</span>
      <input type="number" class="scoring-weight-input" min="0" step="1" value="${val}"
        style="flex:1;text-align:center;" oninput="renderScoringPreview()">
      ${w.length > 1 ? `<button class="btn btn-sm btn-outline" onclick="removeScoringWeight(${i})" style="padding:2px 8px;font-size:12px;">✕</button>` : ''}
    </div>
  `).join('');
}

function getScoringWeightsFromUI() {
  return Array.from(document.querySelectorAll('.scoring-weight-input')).map(el => {
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });
}

function addScoringWeight() {
  const weights = getScoringWeightsFromUI();
  const lastVal = weights.length > 0 ? Math.max(1, weights[weights.length - 1] - 1) : 1;
  weights.push(lastVal);
  renderScoringWeightsList(weights);
  renderScoringPreview();
}

function removeScoringWeight(index) {
  const weights = getScoringWeightsFromUI();
  if (weights.length <= 1) return;
  weights.splice(index, 1);
  renderScoringWeightsList(weights);
  renderScoringPreview();
}

function renderScoringPreview() {
  const container = document.getElementById('scoring-preview');
  if (!container) return;
  const baseEl = document.getElementById('scoring-base');
  const countEl = document.getElementById('scoring-preview-count');
  const base = parseInt(baseEl?.value, 10);
  const count = parseInt(countEl?.value, 10);
  const weights = getScoringWeightsFromUI();

  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(count) || count < 2 || weights.length === 0) {
    container.innerHTML = '<div style="color:var(--text2);">请输入有效参数</div>';
    return;
  }

  const preview = previewScoring({ baseScore: base, weights }, count);
  const lines = preview.places.map(p =>
    `<div style="display:flex;justify-content:space-between;padding:2px 0;">
      <span style="color:var(--text2);">${p.place}st → ${p.formula}</span>
      <span style="font-weight:600;">${p.total} 分</span>
    </div>`
  );
  lines.push(`<div style="display:flex;justify-content:space-between;padding:2px 0;color:var(--text2);">
    <span>其他人</span><span style="font-weight:600;">${base}.00 分</span>
  </div>`);
  container.innerHTML = lines.join('');
}

async function saveScoringRule() {
  const base = parseInt(document.getElementById('scoring-base').value, 10);
  const weights = getScoringWeightsFromUI();

  if (!Number.isFinite(base) || base < 0) {
    showToast('底分必须是非负整数');
    return;
  }
  if (weights.length === 0 || weights.every(w => w <= 0)) {
    showToast('至少需要一个正权重');
    return;
  }

  data.scoringRule = { baseScore: base, weights };
  await saveData();
  renderSettings();
  showToast('积分规则已保存');
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
