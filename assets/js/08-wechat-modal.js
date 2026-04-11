// ====== UI: WeChat Modal ======
function showWechatModal() {
  const modal = document.getElementById('wechat-modal');
  const select = document.getElementById('wechat-tournament-select');
  select.innerHTML = '';

  data.tournaments.slice().reverse().forEach((t, i) => {
    const idx = data.tournaments.length - i;
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `第${idx}场 — ${formatDateShort(t.date)} (${t.participants.length}人)`;
    select.appendChild(opt);
  });

  modal.classList.add('open');
  generateShareImage();
}

function closeWechatModal() {
  document.getElementById('wechat-modal').classList.remove('open');
}

function generateShareImage() {
  const select = document.getElementById('wechat-tournament-select');
  const id = parseInt(select.value);
  const t = data.tournaments.find(x => x.id === id);
  if (!t) return;

  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 2;

  const tournamentIndex = getTournamentIndex(t.id);
  const scores = calcScores(t.participants, t.rankings, t.ratio);
  const n = t.participants.length;
  const dateStr = formatDateCN(t.date);
  const lb = getSortedLeaderboard();

  // Top 3 from this tournament
  const top3 = [];
  for (const r of t.rankings) {
    for (const p of r.players) {
      top3.push({ name: p, score: scores[p], place: r.place });
    }
  }

  // Layout constants
  const W = 420;
  const pad = 28;
  const titleFont = 'bold 18px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const subFont = '13px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const nameFont = '15px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const nameBoldFont = 'bold 15px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const scoreFont = 'bold 15px "SF Mono", "Menlo", monospace';
  const smallFont = '12px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  // Pre-calculate height
  let totalH = 0;
  totalH += pad;          // top padding
  totalH += 24;           // title
  totalH += 8;
  totalH += 18;           // subtitle
  totalH += 24;           // gap
  totalH += top3.length * 34; // top 3
  totalH += 20;           // divider gap
  totalH += 2;            // divider line
  totalH += 20;           // gap
  totalH += 22;           // "总积分排行榜" header
  totalH += 12;           // gap
  totalH += lb.length * 30; // leaderboard rows
  totalH += 20;           // gap
  totalH += 16;           // footer
  totalH += pad;          // bottom padding

  // Set canvas size (HiDPI)
  canvas.width = W * dpr;
  canvas.height = totalH * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = totalH + 'px';
  ctx.scale(dpr, dpr);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, totalH);
  grad.addColorStop(0, '#1a1f2e');
  grad.addColorStop(1, '#0f1218');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, totalH, 16);
  ctx.fill();

  let y = pad;

  // Title
  ctx.font = titleFont;
  ctx.fillStyle = '#e6edf3';
  ctx.textAlign = 'center';
  ctx.fillText(`Poker Session · Tournament #${tournamentIndex}`, W / 2, y + 18);
  y += 24 + 8;

  // Subtitle
  ctx.font = subFont;
  ctx.fillStyle = '#8b949e';
  ctx.fillText(`${dateStr}  ·  ${n}人参赛`, W / 2, y + 13);
  y += 18 + 24;

  // Top 3
  ctx.textAlign = 'left';
  const rankColors = ['#f0c040', '#c0c0c0', '#cd7f32'];
  for (let i = 0; i < top3.length; i++) {
    const p = top3[i];
    const color = rankColors[p.place - 1] || '#8b949e';

    // Rank
    ctx.font = nameFont;
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'right';
    ctx.fillText(`${p.place}.`, pad + 18, y + 19);
    ctx.textAlign = 'left';

    // Name
    ctx.font = nameBoldFont;
    ctx.fillStyle = color;
    ctx.fillText(p.name, pad + 28, y + 19);

    // Score (right-aligned)
    ctx.font = scoreFont;
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(p.score.toFixed(1), W - pad, y + 19);
    ctx.textAlign = 'left';

    y += 34;
  }

  // Divider
  y += 10;
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 2 + 20;

  // Leaderboard header
  ctx.font = titleFont;
  ctx.fillStyle = '#e6edf3';
  ctx.textAlign = 'center';
  ctx.fillText('Overall Leaderboard', W / 2, y + 18);
  y += 22 + 12;

  // Leaderboard rows
  ctx.textAlign = 'left';
  for (const entry of lb) {
    const isTop3 = entry.rank <= 3;
    const rowColor = isTop3 ? rankColors[entry.rank - 1] : '#c9d1d9';
    const dimColor = '#6e7681';

    // Rank
    ctx.font = isTop3 ? nameBoldFont : nameFont;
    ctx.fillStyle = dimColor;
    const rankText = entry.rank + '.';
    ctx.textAlign = 'right';
    ctx.fillText(rankText, pad + 28, y + 18);

    // Name
    ctx.textAlign = 'left';
    ctx.font = isTop3 ? nameBoldFont : nameFont;
    ctx.fillStyle = rowColor;
    ctx.fillText(entry.name, pad + 36, y + 18);

    // Score
    ctx.font = scoreFont;
    ctx.fillStyle = rowColor;
    ctx.textAlign = 'right';
    ctx.fillText(entry.score.toFixed(2), W - pad, y + 18);
    ctx.textAlign = 'left';

    y += 30;
  }

  // Footer
  y += 10;
  ctx.font = smallFont;
  ctx.fillStyle = '#484f58';
  ctx.textAlign = 'center';
  ctx.fillText('poker', W / 2, y + 12);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function downloadShareImage() {
  const canvas = document.getElementById('share-canvas');
  const link = document.createElement('a');
  const selectedId = document.getElementById('wechat-tournament-select').value || 'latest';
  link.download = `poker_tournament_${selectedId}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
