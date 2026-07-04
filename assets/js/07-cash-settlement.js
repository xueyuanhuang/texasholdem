// ====== Cash Game Settlement ======
const CASH_SETTLEMENT_EXACT_LIMIT = 12;

function roundScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function scoreToCents(value) {
  return Math.round(roundScore(value) * 100);
}

function centsToScore(value) {
  return roundScore(value / 100);
}

function compareSettlementNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base'
  });
}

function isPositiveSettlementNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isSafeNonNegativeInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0;
}

function isSafePositiveInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0;
}

function getSettlementStatus(pnlScore, invalid) {
  if (invalid) return 'invalid';
  if (pnlScore > 0) return 'profit';
  if (pnlScore < 0) return 'loss';
  return 'zero';
}

function normalizeSettlementPlayer(rawPlayer, index, config) {
  const name = String(rawPlayer && rawPlayer.name || '').trim();
  const displayName = name || `玩家${index + 1}`;
  const issues = [];
  const rebuys = Array.isArray(rawPlayer && rawPlayer.rebuys) ? rawPlayer.rebuys : [];
  let buyIns = 0;
  const timeline = [];

  if (!name) {
    issues.push('玩家名称无效');
  }

  if (rebuys.length === 0) {
    issues.push(`${displayName} 的买入手数至少为 1 手`);
  }

  rebuys.forEach(rebuy => {
    const amount = Number(rebuy && rebuy.amount);
    if (!isSafePositiveInt(amount)) {
      issues.push(`${displayName} 的买入记录金额无效`);
      return;
    }
    buyIns += amount;
    if (rebuy && rebuy.time) {
      timeline.push({ name: displayName, time: String(rebuy.time), amount });
    }
  });

  if (buyIns < 1) {
    const message = `${displayName} 的买入手数至少为 1 手`;
    if (!issues.includes(message)) issues.push(message);
  }

  const endChipsValue = Number(rawPlayer && rawPlayer.endChips);
  const hasValidEndChips = isSafeNonNegativeInt(endChipsValue);
  if (!hasValidEndChips) {
    issues.push(`${displayName} 的剩余筹码无效`);
  }

  const investedChips = config.chipsValid ? buyIns * config.chipsPerHand : 0;
  const endChips = hasValidEndChips ? endChipsValue : 0;
  const pnlChips = config.chipsValid ? endChips - investedChips : 0;
  const rawPnlScore = config.valid ? (pnlChips / config.chipsPerHand) * config.pricePerHand : 0;
  const pnlScore = config.valid ? roundScore(rawPnlScore) : 0;

  return {
    row: {
      name: displayName,
      buyIns,
      investedChips,
      endChips,
      pnlChips,
      pnlScore,
      _rawPnlScore: rawPnlScore,
      status: getSettlementStatus(pnlScore, issues.length > 0 || !config.valid),
      issues
    },
    timeline
  };
}

function buildGreedySettlementPlan(balances) {
  const winners = balances
    .filter(balance => balance.cents > 0)
    .map(balance => ({ ...balance }))
    .sort((a, b) => b.cents - a.cents || compareSettlementNames(a.name, b.name));
  const losers = balances
    .filter(balance => balance.cents < 0)
    .map(balance => ({ name: balance.name, cents: -balance.cents }))
    .sort((a, b) => b.cents - a.cents || compareSettlementNames(a.name, b.name));

  const transfers = [];
  let winnerIndex = 0;
  let loserIndex = 0;

  while (winnerIndex < winners.length && loserIndex < losers.length) {
    const cents = Math.min(winners[winnerIndex].cents, losers[loserIndex].cents);
    if (cents > 0) {
      transfers.push({
        from: losers[loserIndex].name,
        to: winners[winnerIndex].name,
        amountScore: centsToScore(cents)
      });
    }
    winners[winnerIndex].cents -= cents;
    losers[loserIndex].cents -= cents;
    if (winners[winnerIndex].cents === 0) winnerIndex++;
    if (losers[loserIndex].cents === 0) loserIndex++;
  }

  return sortSettlementTransfers(transfers);
}

function sortSettlementTransfers(transfers) {
  return transfers.slice().sort((a, b) =>
    b.amountScore - a.amountScore ||
    compareSettlementNames(a.from, b.from) ||
    compareSettlementNames(a.to, b.to)
  );
}

function getMaskBitCount(mask) {
  let count = 0;
  while (mask > 0) {
    count += mask & 1;
    mask >>= 1;
  }
  return count;
}

function getExactSettlementGroups(balances) {
  const n = balances.length;
  const size = 1 << n;
  const sums = new Array(size).fill(0);

  for (let mask = 1; mask < size; mask++) {
    const lowBit = mask & -mask;
    const index = Math.trunc(Math.log2(lowBit));
    sums[mask] = sums[mask ^ lowBit] + balances[index].cents;
  }

  const bestGroupCounts = new Array(size).fill(-Infinity);
  const choices = new Array(size).fill(0);
  bestGroupCounts[0] = 0;

  for (let mask = 1; mask < size; mask++) {
    for (let submask = mask; submask > 0; submask = (submask - 1) & mask) {
      if (sums[submask] !== 0) continue;
      const remaining = mask ^ submask;
      const candidate = bestGroupCounts[remaining] + 1;
      const currentChoice = choices[mask];
      const shouldPrefer =
        candidate > bestGroupCounts[mask] ||
        (
          candidate === bestGroupCounts[mask] &&
          currentChoice &&
          getMaskBitCount(submask) < getMaskBitCount(currentChoice)
        );
      if (candidate > bestGroupCounts[mask] || shouldPrefer || !currentChoice) {
        bestGroupCounts[mask] = candidate;
        choices[mask] = submask;
      }
    }
  }

  const groups = [];
  let mask = size - 1;
  while (mask > 0) {
    const choice = choices[mask] || mask;
    const group = [];
    for (let index = 0; index < n; index++) {
      if (choice & (1 << index)) group.push(balances[index]);
    }
    groups.push(group);
    mask ^= choice;
  }

  return groups;
}

function buildExactSettlementPlan(balances) {
  const groups = getExactSettlementGroups(balances);
  const transfers = groups.flatMap(group => buildGreedySettlementPlan(group));
  return sortSettlementTransfers(transfers);
}

function balanceRoundedScoreRows(rows) {
  const eligibleRows = rows.filter(row => row.issues.length === 0 && row._rawPnlScore !== 0);
  let residualCents = rows.reduce((sum, row) => sum + scoreToCents(row.pnlScore), 0);

  while (residualCents !== 0 && eligibleRows.length > 0) {
    const direction = residualCents > 0 ? -1 : 1;
    const candidates = eligibleRows.slice().sort((a, b) => {
      const aRounded = scoreToCents(a.pnlScore);
      const bRounded = scoreToCents(b.pnlScore);
      const aDelta = direction > 0
        ? (a._rawPnlScore * 100) - aRounded
        : aRounded - (a._rawPnlScore * 100);
      const bDelta = direction > 0
        ? (b._rawPnlScore * 100) - bRounded
        : bRounded - (b._rawPnlScore * 100);
      return bDelta - aDelta || Math.abs(bRounded) - Math.abs(aRounded) || compareSettlementNames(a.name, b.name);
    });
    const target = candidates[0];
    target.pnlScore = centsToScore(scoreToCents(target.pnlScore) + direction);
    target.status = getSettlementStatus(target.pnlScore, false);
    residualCents += direction;
  }
}

function evaluateCashGameSettlement(input) {
  const chipsPerHand = Number(input && input.chipsPerHand);
  const pricePerHand = Number(input && input.pricePerHand);
  const config = {
    chipsValid: isPositiveSettlementNumber(chipsPerHand),
    valid: isPositiveSettlementNumber(chipsPerHand) && isPositiveSettlementNumber(pricePerHand),
    chipsPerHand,
    pricePerHand
  };
  const issues = [];

  if (!isPositiveSettlementNumber(chipsPerHand)) issues.push('每手筹码必须是正数');
  if (!isPositiveSettlementNumber(pricePerHand)) issues.push('每手积分必须是正数');

  const rawPlayers = Array.isArray(input && input.players) ? input.players : [];
  if (rawPlayers.length === 0) issues.push('缺少玩家');

  const normalized = rawPlayers.map((rawPlayer, index) => normalizeSettlementPlayer(rawPlayer, index, config));
  const rows = normalized.map(item => item.row);
  const timeline = normalized
    .flatMap(item => item.timeline)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)) || compareSettlementNames(a.name, b.name));

  const nameCounts = new Map();
  rows.forEach(row => {
    if (!row.name) return;
    nameCounts.set(row.name, (nameCounts.get(row.name) || 0) + 1);
  });
  nameCounts.forEach((count, name) => {
    if (count <= 1) return;
    const message = `玩家名称重复：${name}`;
    issues.push(message);
    rows.forEach(row => {
      if (row.name === name && !row.issues.includes(message)) {
        row.issues.push(message);
        row.status = 'invalid';
      }
    });
  });

  rows.forEach(row => {
    row.issues.forEach(issue => {
      if (!issues.includes(issue)) issues.push(issue);
    });
  });

  const totals = {
    investedChips: rows.reduce((sum, row) => sum + row.investedChips, 0),
    endChips: rows.reduce((sum, row) => sum + row.endChips, 0),
    diffChips: 0
  };
  totals.diffChips = totals.endChips - totals.investedChips;

  if (config.valid && totals.diffChips !== 0) {
    issues.push('总剩余筹码与总买入筹码不一致');
  }

  if (config.valid && totals.diffChips === 0) {
    balanceRoundedScoreRows(rows);
  }

  let canSettle = issues.length === 0;
  let settlementPlan = { isOptimal: true, transfers: [] };

  if (canSettle) {
    const balances = rows
      .map(row => ({ name: row.name, cents: scoreToCents(row.pnlScore) }))
      .filter(balance => balance.cents !== 0)
      .sort((a, b) => b.cents - a.cents || compareSettlementNames(a.name, b.name));
    const residualCents = balances.reduce((sum, balance) => sum + balance.cents, 0);

    if (residualCents !== 0) {
      issues.push('Score 四舍五入后无法平衡结算');
      canSettle = false;
    } else if (balances.length > CASH_SETTLEMENT_EXACT_LIMIT) {
      settlementPlan = {
        isOptimal: false,
        transfers: buildGreedySettlementPlan(balances)
      };
    } else {
      settlementPlan = {
        isOptimal: true,
        transfers: buildExactSettlementPlan(balances)
      };
    }
  }

  if (!canSettle) {
    settlementPlan = { isOptimal: true, transfers: [] };
  }

  return {
    rows: rows.map(row => {
      const { _rawPnlScore, ...publicRow } = row;
      return publicRow;
    }),
    totals,
    issues,
    canSettle,
    settlementPlan,
    timeline
  };
}

if (typeof window !== 'undefined') {
  window.evaluateCashGameSettlement = evaluateCashGameSettlement;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    evaluateCashGameSettlement
  };
}
