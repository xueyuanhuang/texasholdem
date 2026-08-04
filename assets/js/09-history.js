// ====== UI: History ======
let cashLeaderboardExpanded = false;
let expandedCashLeaderboardPlayers = new Set();
let expandedCashLeaderboardGames = new Set();

function escapeHistoryHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);
}

function getCashLeaderboardScoreClass(score) {
  if (score > 0) return 'profit';
  if (score < 0) return 'loss';
  return 'zero';
}

function formatSignedHistoryScore(score) {
  return `${score >= 0 ? '+' : ''}${formatScore(score)}`;
}

function formatHistoryChipCount(value) {
  return Number(value || 0).toLocaleString('zh-Hans-CN');
}

function formatHistoryDateForLeaderboard(date) {
  if (date && typeof formatDateShort === 'function') return formatDateShort(date);
  return date || '未知日期';
}

function makeCashLeaderboardGameDetailKey(playerName, gameKey) {
  return `${encodeURIComponent(playerName)}::${encodeURIComponent(gameKey)}`;
}

function getCashLeaderboardGameTitle(gameDetail) {
  const date = formatHistoryDateForLeaderboard(gameDetail.date);
  const suffix = gameDetail.dateGameCount > 1 ? ` #${gameDetail.dateGameNumber}` : '';
  return `${date} · Cash Game${suffix}`;
}

function renderCashLeaderboardFullGameDetail(gameDetail) {
  const rowsHtml = gameDetail.rows.map(row => {
    const scoreClass = getCashLeaderboardScoreClass(row.pnlScore);
    return `
      <div class="cash-leaderboard-full-row">
        <span class="cash-leaderboard-full-name">${escapeHistoryHtml(row.name)}</span>
        <span class="cash-leaderboard-full-meta">${row.buyIns}手 · 剩余 ${formatHistoryChipCount(row.endChips)}</span>
        <span class="cash-pnl ${scoreClass}">${formatSignedHistoryScore(row.pnlScore)} 分</span>
      </div>
    `;
  }).join('');

  const transfers = gameDetail.settlementPlan && Array.isArray(gameDetail.settlementPlan.transfers)
    ? gameDetail.settlementPlan.transfers
    : [];
  const transferTitle = gameDetail.settlementPlan && gameDetail.settlementPlan.isOptimal
    ? '转账方案（精确）'
    : '转账方案（近似）';
  const transfersHtml = transfers.length === 0
    ? '<div class="cash-leaderboard-empty compact">无需转账</div>'
    : transfers.map(transfer => `
      <div class="cash-leaderboard-transfer-row">
        <span>${escapeHistoryHtml(transfer.from)}</span>
        <span class="transfer-arrow">→</span>
        <span>${escapeHistoryHtml(transfer.to)}</span>
        <span class="transfer-amount">${formatScore(transfer.amountScore)} 分</span>
      </div>
    `).join('');

  return `
    <div class="cash-leaderboard-full-section">
      <div class="cash-leaderboard-section-title">整场明细</div>
      ${rowsHtml}
      <div class="cash-leaderboard-section-title transfer">${transferTitle}</div>
      ${transfersHtml}
    </div>
  `;
}

function renderCashLeaderboardGameDetails(playerName, gameDetails) {
  if (!Array.isArray(gameDetails) || gameDetails.length === 0) {
    return '<div class="cash-leaderboard-empty compact">暂无明细</div>';
  }

  return gameDetails.map(gameDetail => {
    const detailKey = makeCashLeaderboardGameDetailKey(playerName, gameDetail.gameKey);
    const expanded = expandedCashLeaderboardGames.has(detailKey);
    const scoreClass = getCashLeaderboardScoreClass(gameDetail.playerRow.pnlScore);
    const detailClass = expanded ? 'cash-leaderboard-game-detail open' : 'cash-leaderboard-game-detail';
    return `
      <div class="cash-leaderboard-game-block">
        <button class="cash-leaderboard-game-toggle" type="button" onclick="toggleCashLeaderboardGame(this)" data-detail-key="${escapeHistoryHtml(detailKey)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <div class="cash-leaderboard-game-copy">
            <div class="cash-leaderboard-game-title">${escapeHistoryHtml(getCashLeaderboardGameTitle(gameDetail))}</div>
            <div class="cash-leaderboard-game-meta">${gameDetail.playerRow.buyIns}手 · 剩余 ${formatHistoryChipCount(gameDetail.playerRow.endChips)} · ${gameDetail.playerCount}人</div>
          </div>
          <span class="cash-pnl ${scoreClass}">${formatSignedHistoryScore(gameDetail.playerRow.pnlScore)} 分</span>
          <span class="cash-leaderboard-chevron">${expanded ? '▾' : '▸'}</span>
        </button>
        <div class="${detailClass}">
          ${renderCashLeaderboardFullGameDetail(gameDetail)}
        </div>
      </div>
    `;
  }).join('');
}

function renderCashLeaderboardCard() {
  const leaderboard = typeof buildCashLeaderboard === 'function'
    ? buildCashLeaderboard(data)
    : { rows: [], countedGames: 0, skippedGames: 0 };
  const actionText = cashLeaderboardExpanded ? '收起' : '展开';
  const detailClass = cashLeaderboardExpanded ? 'history-detail open' : 'history-detail';
  const metaText = leaderboard.countedGames > 0
    ? `${leaderboard.countedGames} 场已统计 · ${leaderboard.rows.length} 名玩家`
    : '暂无可统计的现金局';
  const rowsHtml = leaderboard.rows.length === 0
    ? '<div class="cash-leaderboard-empty">暂无可统计的现金局</div>'
    : leaderboard.rows.map((row, index) => {
      const rank = index + 1;
      const rankClass = rank <= 3 ? ` top${rank}` : '';
      const scoreClass = getCashLeaderboardScoreClass(row.totalScore);
      const playerExpanded = expandedCashLeaderboardPlayers.has(row.name);
      const playerDetailClass = playerExpanded
        ? 'cash-leaderboard-player-detail open'
        : 'cash-leaderboard-player-detail';
      return `
        <div class="cash-leaderboard-player-block">
          <button class="lb-row cash-leaderboard-row cash-leaderboard-player-toggle" type="button" onclick="toggleCashLeaderboardPlayer(this)" data-player-name="${escapeHistoryHtml(row.name)}" aria-expanded="${playerExpanded ? 'true' : 'false'}">
            <span class="lb-rank${rankClass}">${rank}</span>
            <div class="cash-leaderboard-player">
              <div class="lb-name">${escapeHistoryHtml(row.name)}</div>
              <div class="cash-leaderboard-meta">${row.games} 局 · 均 ${formatSignedHistoryScore(row.averageScore)}</div>
            </div>
            <span class="lb-score cash-pnl ${scoreClass}">${formatSignedHistoryScore(row.totalScore)} 分</span>
            <span class="cash-leaderboard-row-action">${playerExpanded ? '收起' : '明细'}</span>
          </button>
          <div class="${playerDetailClass}">
            ${renderCashLeaderboardGameDetails(row.name, row.gameDetails)}
          </div>
        </div>
      `;
    }).join('');

  return `
    <div class="history-item cash-leaderboard-card">
      <button class="history-header cash-leaderboard-toggle" type="button" onclick="toggleCashLeaderboard()" aria-expanded="${cashLeaderboardExpanded ? 'true' : 'false'}">
        <div>
          <div class="history-title">现金局排行榜</div>
          <div class="history-meta">${metaText}</div>
        </div>
        <span class="cash-leaderboard-action" id="cash-leaderboard-action">${actionText}</span>
      </button>
      <div class="${detailClass}" id="cash-leaderboard-detail">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function renderHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '';

  // Group tournaments and cash games by date
  const grouped = {};
  data.tournaments.forEach(t => {
    if (!grouped[t.date]) grouped[t.date] = { tournaments: [], cashGames: [] };
    grouped[t.date].tournaments.push(t);
  });
  data.cashGames.forEach(cg => {
    if (!grouped[cg.date]) grouped[cg.date] = { tournaments: [], cashGames: [] };
    grouped[cg.date].cashGames.push(cg);
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  if (sortedDates.length === 0) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--text2);">暂无历史记录</div>';
    return;
  }

  if ((data.cashGames || []).length > 0) {
    container.insertAdjacentHTML('beforeend', renderCashLeaderboardCard());
  }

  sortedDates.forEach((date) => {
    const group = grouped[date];
    const tournaments = group.tournaments.slice().sort((a, b) => {
      const aIdx = getTournamentIndex(a.id);
      const bIdx = getTournamentIndex(b.id);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.id || 0) - (b.id || 0);
    });
    const cashGames = group.cashGames.slice().sort(compareCashGamesAsc);

    const item = document.createElement('div');
    item.className = 'history-item';

    let contentHtml = '';

    tournaments.forEach((t, tIdx) => {
      const tournamentIndex = getTournamentIndex(t.id);
      const placeLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

      const rowsHtml = (t.rankings || []).map(r => {
        const label = placeLabels[r.place - 1] || r.place + 'th';
        return r.players.map(name => {
          const rebuyInfo = t.rebuys && t.rebuys[name]
            ? ` <span style="color:var(--text2);font-size:12px;">(+${t.rebuys[name]}手)</span>`
            : '';
          return `<div class="score-row">
            <span class="score-rank">${label}</span>
            <span class="score-name">${name}${rebuyInfo}</span>
          </div>`;
        }).join('');
      }).join('');

      // List participants not in rankings
      const rankedPlayers = new Set();
      (t.rankings || []).forEach(r => r.players.forEach(p => rankedPlayers.add(p)));
      const unranked = (t.participants || []).filter(p => !rankedPlayers.has(p));
      const unrankedHtml = unranked.map(name => {
        const rebuyInfo = t.rebuys && t.rebuys[name]
          ? ` <span style="color:var(--text2);font-size:12px;">(+${t.rebuys[name]}手)</span>`
          : '';
        return `<div class="score-row"><span class="score-rank" style="color:var(--text2);">—</span><span class="score-name">${name}${rebuyInfo}</span></div>`;
      }).join('');

      const sectionTopBorder = tIdx > 0 ? 'padding-top:12px;border-top:1px solid var(--border);' : '';
      contentHtml += `
        <div style="${sectionTopBorder}">
          <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">
            Tournament #${tournamentIndex} · ${t.participants.length}人
          </div>
          ${rowsHtml}${unrankedHtml}
          <div class="history-actions" style="margin-top:12px;">
            <button class="btn btn-sm btn-danger" onclick="deleteTournament(${t.id})">删除锦标赛</button>
          </div>
        </div>
      `;
    });

    cashGames.forEach((cg, cgIdx) => {
      const cpp = cg.chipsPerHand;
      const pph = cg.pricePerHand;
      const settlement = evaluateCashGameSettlement({
        chipsPerHand: cpp,
        pricePerHand: pph,
        players: Array.isArray(cg.players) ? cg.players : []
      });
      const showIndex = cashGames.length > 1 ? ` #${cgIdx + 1}` : '';
      const statusLabel = cg.status === 'active' ? ' · 进行中' : '';
      const sectionTopBorder = (tournaments.length > 0 || cgIdx > 0) ? 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);' : '';
      const cashId = String(cg.id).replace(/'/g, "\\'");

      const playersHtml = settlement.rows.map(row => {
        const pnlClass = row.status === 'invalid' ? 'zero' : row.status;
        const pnlText = row.status === 'invalid'
          ? '—'
          : `${row.pnlScore >= 0 ? '+' : ''}${formatScore(row.pnlScore)}分`;
        const rebuyTimes = settlement.timeline
          .filter(item => item.name === row.name)
          .map(item => item.time)
          .filter(Boolean);
        const rebuyInfo = rebuyTimes.length > 1 ? ` (${rebuyTimes.join(', ')})` : '';
        return '<div class="score-row">' +
          `<span class="score-name">${row.name}</span>` +
          `<span style="color:var(--text2);font-size:12px;margin-right:8px;">${row.buyIns}手${rebuyInfo}</span>` +
          `<span class="cash-pnl ${pnlClass}">${pnlText}</span>` +
        '</div>';
      }).join('');

      contentHtml += `
        <div style="${sectionTopBorder}">
          <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">
            Cash Game${showIndex}${statusLabel} · ${(cg.players || []).length}人 · ${cpp}码/手 · ${pph}分/手
          </div>
          ${playersHtml}
          <div style="margin-top:8px;">
            <button class="btn btn-sm btn-danger" onclick="deleteCashGame('${cashId}')">删除 Cash Game</button>
          </div>
        </div>
      `;
    });

    const hasTournament = tournaments.length > 0;
    const hasCash = cashGames.length > 0;
    const titleSuffix = hasTournament && hasCash ? ' · Mixed' : hasTournament ? ' · Tournament' : ' · Cash';

    const metaParts = [];
    if (hasTournament) metaParts.push(`${tournaments.length} 场锦标赛`);
    if (hasCash) metaParts.push(`${cashGames.length} 场 Cash Game`);
    const allPlayers = new Set();
    tournaments.forEach(t => (t.participants || []).forEach(p => allPlayers.add(p)));
    cashGames.forEach(cg => (cg.players || []).forEach(p => {
      if (p && p.name) allPlayers.add(p.name);
    }));
    if (allPlayers.size > 0) metaParts.push(`${allPlayers.size} 名玩家`);

    item.innerHTML = `
      <div class="history-header" onclick="toggleHistory(this)">
        <div>
          <div class="history-title">${formatDateShort(date)}${titleSuffix}</div>
          <div class="history-meta">${metaParts.join(' · ')}</div>
        </div>
        <span style="color:var(--text2);">▸</span>
      </div>
      <div class="history-detail" id="history-detail-${date}">
        ${contentHtml}
      </div>
    `;
    container.appendChild(item);
  });
}

function toggleCashLeaderboard() {
  cashLeaderboardExpanded = !cashLeaderboardExpanded;
  const detail = document.getElementById('cash-leaderboard-detail');
  const action = document.getElementById('cash-leaderboard-action');
  const toggle = document.querySelector('.cash-leaderboard-toggle');
  if (!detail || !action || !toggle) return;

  detail.classList.toggle('open', cashLeaderboardExpanded);
  action.textContent = cashLeaderboardExpanded ? '收起' : '展开';
  toggle.setAttribute('aria-expanded', cashLeaderboardExpanded ? 'true' : 'false');
}

function toggleCashLeaderboardPlayer(button) {
  const playerName = button && button.dataset ? button.dataset.playerName : '';
  if (!playerName) return;

  const isExpanded = expandedCashLeaderboardPlayers.has(playerName);
  if (isExpanded) {
    expandedCashLeaderboardPlayers.delete(playerName);
  } else {
    expandedCashLeaderboardPlayers.add(playerName);
  }

  const nextExpanded = !isExpanded;
  const detail = button.nextElementSibling;
  const action = button.querySelector('.cash-leaderboard-row-action');
  if (detail) detail.classList.toggle('open', nextExpanded);
  if (action) action.textContent = nextExpanded ? '收起' : '明细';
  button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
}

function toggleCashLeaderboardGame(button) {
  const detailKey = button && button.dataset ? button.dataset.detailKey : '';
  if (!detailKey) return;

  const isExpanded = expandedCashLeaderboardGames.has(detailKey);
  if (isExpanded) {
    expandedCashLeaderboardGames.delete(detailKey);
  } else {
    expandedCashLeaderboardGames.add(detailKey);
  }

  const nextExpanded = !isExpanded;
  const detail = button.nextElementSibling;
  const chevron = button.querySelector('.cash-leaderboard-chevron');
  if (detail) detail.classList.toggle('open', nextExpanded);
  if (chevron) chevron.textContent = nextExpanded ? '▾' : '▸';
  button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
}

function toggleHistory(el) {
  const detail = el.nextElementSibling;
  detail.classList.toggle('open');
  const arrow = el.querySelector('span:last-child');
  arrow.textContent = detail.classList.contains('open') ? '▾' : '▸';
}

async function deleteCashGame(id) {
  if (!confirm('确定要删除这场 Cash Game 吗？')) return;
  data.cashGames = data.cashGames.filter(c => String(c.id) !== String(id));
  if (String(data.activeCashGameId) === String(id)) data.activeCashGameId = null;
  await saveData();
  renderHistory();
  showToast('Cash Game 已删除');
}

async function deleteTournament(id) {
  if (!confirm('确定要删除这场比赛吗？')) return;
  data.tournaments = data.tournaments.filter(t => t.id !== id);
  await saveData();
  renderHistory();
  showToast('锦标赛已删除');
}

function compareCashGamesAsc(a, b) {
  const createdCmp = String(a.createdAt || a.updatedAt || a.date || '')
    .localeCompare(String(b.createdAt || b.updatedAt || b.date || ''));
  if (createdCmp !== 0) return createdCmp;
  const aNum = Number(a.id);
  const bNum = Number(b.id);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a.id || '').localeCompare(String(b.id || ''));
}
