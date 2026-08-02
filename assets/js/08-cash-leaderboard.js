// ====== Cash Game Leaderboard ======
function cashLeaderboardScoreToCents(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function cashLeaderboardCentsToScore(value) {
  return Math.round(value) / 100;
}

function compareCashLeaderboardNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base'
  });
}

function resolveCashSettlementEvaluator(customEvaluator) {
  if (typeof customEvaluator === 'function') return customEvaluator;
  if (typeof evaluateCashGameSettlement === 'function') return evaluateCashGameSettlement;
  if (typeof require === 'function') {
    try {
      return require('./07-cash-settlement.js').evaluateCashGameSettlement;
    } catch (e) {
      return null;
    }
  }
  return null;
}

function buildCashLeaderboard(source, options = {}) {
  const evaluateSettlement = resolveCashSettlementEvaluator(options.evaluateSettlement);
  const cashGames = Array.isArray(source && source.cashGames) ? source.cashGames : [];
  const entries = new Map();
  let countedGames = 0;
  let skippedGames = 0;

  if (!evaluateSettlement) {
    return { rows: [], countedGames, skippedGames: cashGames.length };
  }

  cashGames.forEach(cashGame => {
    if (!cashGame || cashGame.status === 'active') {
      skippedGames += 1;
      return;
    }

    const settlement = evaluateSettlement({
      chipsPerHand: cashGame.chipsPerHand,
      pricePerHand: cashGame.pricePerHand,
      players: Array.isArray(cashGame.players) ? cashGame.players : []
    });

    if (!settlement.canSettle) {
      skippedGames += 1;
      return;
    }

    countedGames += 1;
    settlement.rows.forEach(row => {
      const name = String(row && row.name || '').trim();
      if (!name || row.status === 'invalid') return;

      if (!entries.has(name)) {
        entries.set(name, { name, games: 0, totalCents: 0 });
      }

      const entry = entries.get(name);
      entry.games += 1;
      entry.totalCents += cashLeaderboardScoreToCents(row.pnlScore);
    });
  });

  const rows = Array.from(entries.values()).map(entry => ({
    name: entry.name,
    games: entry.games,
    totalScore: cashLeaderboardCentsToScore(entry.totalCents),
    averageScore: entry.games > 0
      ? cashLeaderboardCentsToScore(entry.totalCents / entry.games)
      : 0
  })).sort((a, b) =>
    cashLeaderboardScoreToCents(b.totalScore) - cashLeaderboardScoreToCents(a.totalScore) ||
    cashLeaderboardScoreToCents(b.averageScore) - cashLeaderboardScoreToCents(a.averageScore) ||
    b.games - a.games ||
    compareCashLeaderboardNames(a.name, b.name)
  );

  return {
    rows,
    countedGames,
    skippedGames
  };
}

if (typeof window !== 'undefined') {
  window.buildCashLeaderboard = buildCashLeaderboard;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCashLeaderboard
  };
}
