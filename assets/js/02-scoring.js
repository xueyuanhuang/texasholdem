// ====== Scoring Engine ======
function calcScores(participants, rankings, ratio) {
  const uniqueParticipants = [];
  const participantSet = new Set();
  (participants || []).forEach(name => {
    if (!name || participantSet.has(name)) return;
    participantSet.add(name);
    uniqueParticipants.push(name);
  });

  if (uniqueParticipants.length === 0) return {};

  let safeRatio = [5, 3, 2];
  if (Array.isArray(ratio) && ratio.length === 3) {
    safeRatio = ratio.map(v => Math.max(parseFloat(v) || 0, 0));
    if (safeRatio[0] + safeRatio[1] + safeRatio[2] <= 0) {
      safeRatio = [5, 3, 2];
    }
  }

  const n = uniqueParticipants.length;
  const total = safeRatio[0] + safeRatio[1] + safeRatio[2];
  const extras = safeRatio.map(r => n * r / total);
  const scores = {};
  uniqueParticipants.forEach(p => { scores[p] = 1; });

  // Build place-to-extra mapping: place 1->extras[0], 2->extras[1], 3->extras[2], rest->0
  // Handle ties: if multiple players share places, average the extras for those places
  const placeExtras = { 1: extras[0], 2: extras[1], 3: extras[2] };
  const usedRankPlayers = new Set();

  for (const rank of rankings || []) {
    const place = parseInt(rank.place, 10);
    if (Number.isNaN(place) || place < 1 || !Array.isArray(rank.players)) continue;
    const tiedPlayers = rank.players.filter(player => {
      if (!participantSet.has(player) || usedRankPlayers.has(player)) return false;
      usedRankPlayers.add(player);
      return true;
    });
    const numTied = tiedPlayers.length;
    if (numTied === 0) continue;

    // Collect all place extras this tie group covers
    let totalExtra = 0;
    for (let i = 0; i < numTied; i++) {
      const p = place + i;
      if (placeExtras[p] !== undefined) {
        totalExtra += placeExtras[p];
      }
    }
    const avgExtra = totalExtra / numTied;

    tiedPlayers.forEach(player => {
      scores[player] = 1 + avgExtra;
    });
  }

  // Round to 2 decimal places
  for (const p in scores) {
    scores[p] = Math.round(scores[p] * 100) / 100;
  }
  return scores;
}

function getTotalScores() {
  const totals = {};
  data.tournaments.forEach(t => {
    const scores = calcScores(t.participants, t.rankings, t.ratio);
    for (const p in scores) {
      totals[p] = (totals[p] || 0) + scores[p];
    }
  });
  // Round
  for (const p in totals) {
    totals[p] = Math.round(totals[p] * 100) / 100;
  }
  return totals;
}

function getSortedLeaderboard() {
  const totals = getTotalScores();
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const result = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1] < sorted[i - 1][1]) {
      rank = i + 1;
    }
    result.push({ rank, name: sorted[i][0], score: sorted[i][1] });
  }
  return result;
}
