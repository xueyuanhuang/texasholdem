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

function compareCashLeaderboardGamesAsc(a, b) {
  const aGame = a && a.cashGame ? a.cashGame : a;
  const bGame = b && b.cashGame ? b.cashGame : b;
  const createdCmp = String(aGame && (aGame.createdAt || aGame.updatedAt || aGame.date) || '')
    .localeCompare(String(bGame && (bGame.createdAt || bGame.updatedAt || bGame.date) || ''));
  if (createdCmp !== 0) return createdCmp;
  const aNum = Number(aGame && aGame.id);
  const bNum = Number(bGame && bGame.id);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(aGame && aGame.id || '').localeCompare(String(bGame && bGame.id || ''));
}

function compareCashLeaderboardGameDetailsDesc(a, b) {
  const createdCmp = String(b.createdAt || b.updatedAt || b.date || '')
    .localeCompare(String(a.createdAt || a.updatedAt || a.date || ''));
  if (createdCmp !== 0) return createdCmp;
  if (b.dateGameNumber !== a.dateGameNumber) return b.dateGameNumber - a.dateGameNumber;
  return String(b.gameKey || '').localeCompare(String(a.gameKey || ''));
}

function getCashLeaderboardGameKey(cashGame, index) {
  const id = cashGame && cashGame.id !== undefined && cashGame.id !== null && cashGame.id !== ''
    ? String(cashGame.id)
    : `index-${index}`;
  return `${String(cashGame && cashGame.date || 'unknown')}::${id}::${index}`;
}

function getCashLeaderboardDate(cashGame) {
  if (cashGame && cashGame.date) return String(cashGame.date);
  const timestamp = cashGame && (cashGame.createdAt || cashGame.updatedAt);
  if (timestamp) return String(timestamp).slice(0, 10);
  return '';
}

function buildCashLeaderboardGamePositions(cashGames) {
  const byDate = new Map();

  cashGames.forEach((cashGame, index) => {
    const date = getCashLeaderboardDate(cashGame);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      cashGame,
      index,
      key: getCashLeaderboardGameKey(cashGame, index)
    });
  });

  const positions = new Map();
  byDate.forEach(games => {
    games.sort(compareCashLeaderboardGamesAsc);
    games.forEach((game, index) => {
      positions.set(game.key, {
        dateGameNumber: index + 1,
        dateGameCount: games.length
      });
    });
  });

  return positions;
}

function cloneCashLeaderboardRow(row) {
  return {
    name: row.name,
    buyIns: row.buyIns,
    investedChips: row.investedChips,
    endChips: row.endChips,
    pnlChips: row.pnlChips,
    pnlScore: row.pnlScore,
    status: row.status,
    issues: Array.isArray(row.issues) ? row.issues.slice() : []
  };
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
  const gamePositions = buildCashLeaderboardGamePositions(cashGames);
  let countedGames = 0;
  let skippedGames = 0;

  if (!evaluateSettlement) {
    return { rows: [], countedGames, skippedGames: cashGames.length };
  }

  cashGames.forEach((cashGame, cashGameIndex) => {
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
    const gameKey = getCashLeaderboardGameKey(cashGame, cashGameIndex);
    const position = gamePositions.get(gameKey) || { dateGameNumber: 1, dateGameCount: 1 };
    const settledRows = settlement.rows.map(cloneCashLeaderboardRow);
    settlement.rows.forEach(row => {
      const name = String(row && row.name || '').trim();
      if (!name || row.status === 'invalid') return;

      if (!entries.has(name)) {
        entries.set(name, { name, games: 0, totalCents: 0, gameDetails: [] });
      }

      const entry = entries.get(name);
      entry.games += 1;
      entry.totalCents += cashLeaderboardScoreToCents(row.pnlScore);
      entry.gameDetails.push({
        gameKey,
        cashGameId: cashGame.id,
        date: getCashLeaderboardDate(cashGame),
        createdAt: cashGame.createdAt || '',
        updatedAt: cashGame.updatedAt || '',
        dateGameNumber: position.dateGameNumber,
        dateGameCount: position.dateGameCount,
        chipsPerHand: cashGame.chipsPerHand,
        pricePerHand: cashGame.pricePerHand,
        playerCount: settledRows.length,
        playerRow: cloneCashLeaderboardRow(row),
        rows: settledRows,
        settlementPlan: {
          isOptimal: Boolean(settlement.settlementPlan && settlement.settlementPlan.isOptimal),
          transfers: settlement.settlementPlan && Array.isArray(settlement.settlementPlan.transfers)
            ? settlement.settlementPlan.transfers.map(transfer => ({ ...transfer }))
            : []
        }
      });
    });
  });

  const rows = Array.from(entries.values()).map(entry => ({
    name: entry.name,
    games: entry.games,
    totalScore: cashLeaderboardCentsToScore(entry.totalCents),
    averageScore: entry.games > 0
      ? cashLeaderboardCentsToScore(entry.totalCents / entry.games)
      : 0,
    gameDetails: entry.gameDetails
      .slice()
      .sort(compareCashLeaderboardGameDetailsDesc)
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
