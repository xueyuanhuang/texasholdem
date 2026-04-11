// ====== Share Image Generation ======
// (Canvas-based rendering in showWechatModal / generateShareImage)

function formatDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Get tournament index by date (1-based)
function getTournamentIndex(tournamentId) {
  const targetT = data.tournaments.find(x => x.id === tournamentId);
  if (!targetT) return 1;

  // Sort tournaments by date, then by id (for same-day tournaments)
  const sortedTournaments = [...data.tournaments].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id - b.id;
  });

  // Find the index of target tournament in sorted list
  const index = sortedTournaments.findIndex(t => t.id === tournamentId);
  return index + 1;
}

