// ====== Scoring Engine ======

// Normalize scoring rule from various formats (legacy ratio array, new scoringRule object)
function normalizeScoringRule(ruleOrRatio) {
  if (ruleOrRatio && typeof ruleOrRatio === 'object' && !Array.isArray(ruleOrRatio)) {
    const base = Number.isFinite(ruleOrRatio.baseScore) && ruleOrRatio.baseScore >= 0 ? ruleOrRatio.baseScore : 1;
    const weights = Array.isArray(ruleOrRatio.weights) ? ruleOrRatio.weights.map(Number).filter(Number.isFinite) : [5, 3, 2];
    return { baseScore: base, weights: weights.length > 0 ? weights : [5, 3, 2] };
  }
  // Legacy: plain array like [5, 3, 2]
  if (Array.isArray(ruleOrRatio) && ruleOrRatio.length > 0) {
    return { baseScore: 1, weights: ruleOrRatio.map(Number).filter(Number.isFinite) };
  }
  return { baseScore: 1, weights: [5, 3, 2] };
}

function calcScores(participants, rankings, ruleOrRatio) {
  const uniqueParticipants = [];
  const participantSet = new Set();
  (participants || []).forEach(name => {
    if (!name || participantSet.has(name)) return;
    participantSet.add(name);
    uniqueParticipants.push(name);
  });

  if (uniqueParticipants.length === 0) return {};

  const rule = normalizeScoringRule(ruleOrRatio);
  const n = uniqueParticipants.length;
  const totalWeight = rule.weights.reduce((s, w) => s + Math.max(w, 0), 0);

  // Calculate extra points for each place: participants × weight / totalWeight
  const placeExtras = {};
  rule.weights.forEach((w, i) => {
    placeExtras[i + 1] = totalWeight > 0 ? n * Math.max(w, 0) / totalWeight : 0;
  });

  const scores = {};
  uniqueParticipants.forEach(p => { scores[p] = rule.baseScore; });

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
      scores[player] = rule.baseScore + avgExtra;
    });
  }

  // Round to 2 decimal places
  for (const p in scores) {
    scores[p] = Math.round(scores[p] * 100) / 100;
  }
  return scores;
}

// Preview: calculate what each place would score for a given player count
function previewScoring(rule, playerCount) {
  const normalized = normalizeScoringRule(rule);
  const n = playerCount;
  const totalWeight = normalized.weights.reduce((s, w) => s + Math.max(w, 0), 0);
  const results = [];
  normalized.weights.forEach((w, i) => {
    const extra = totalWeight > 0 ? n * Math.max(w, 0) / totalWeight : 0;
    const total = normalized.baseScore + extra;
    results.push({
      place: i + 1,
      weight: w,
      extra: Math.round(extra * 100) / 100,
      total: Math.round(total * 100) / 100,
      formula: `${normalized.baseScore} + ${n}×${w}/${totalWeight}`
    });
  });
  return { baseScore: normalized.baseScore, totalWeight, places: results };
}

function getTotalScores() {
  const totals = {};
  data.tournaments.forEach(t => {
    // Support both new scoringRule and legacy ratio
    const rule = t.scoringRule || t.ratio;
    const scores = calcScores(t.participants, t.rankings, rule);
    for (const p in scores) {
      totals[p] = (totals[p] || 0) + scores[p];
    }
  });
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
