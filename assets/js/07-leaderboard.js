// ====== UI: Leaderboard ======
function renderLeaderboard() {
  const lb = getSortedLeaderboard();
  const container = document.getElementById('leaderboard');
  container.innerHTML = '';

  lb.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    const rankClass = entry.rank <= 3 ? ` top${entry.rank}` : '';
    row.innerHTML = `
      <span class="lb-rank${rankClass}">${entry.rank}</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-score">${entry.score.toFixed(2)}</span>
    `;
    container.appendChild(row);
  });
}
