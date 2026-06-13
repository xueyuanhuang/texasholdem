// ====== UI: History ======
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
      const showIndex = cashGames.length > 1 ? ` #${cgIdx + 1}` : '';
      const statusLabel = cg.status === 'active' ? ' · 进行中' : '';
      const sectionTopBorder = (tournaments.length > 0 || cgIdx > 0) ? 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);' : '';
      const cashId = String(cg.id).replace(/'/g, "\\'");

      const playersHtml = (cg.players || []).map(p => {
        const rebuys = p.rebuys || [];
        const buyIns = getBuyIns(rebuys);
        const pnlChips = (p.endChips || 0) - buyIns * cpp;
        const pnlRmb = pnlChips / cpp * pph;
        const pnlClass = pnlRmb > 0 ? 'profit' : pnlRmb < 0 ? 'loss' : 'zero';
        const pnlText = pnlRmb >= 0 ? `+${pnlRmb.toFixed(0)}分` : `-${Math.abs(pnlRmb).toFixed(0)}分`;
        const rebuyTimes = rebuys.map(r => r.time).filter(Boolean);
        const rebuyInfo = rebuyTimes.length > 1 ? ` (${rebuyTimes.join(', ')})` : '';
        return '<div class="score-row">' +
          `<span class="score-name">${p.name}</span>` +
          `<span style="color:var(--text2);font-size:12px;margin-right:8px;">${buyIns}手${rebuyInfo}</span>` +
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
