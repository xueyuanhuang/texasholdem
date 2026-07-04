const assert = require('node:assert/strict');

const { evaluateCashGameSettlement } = require('../assets/js/07-cash-settlement.js');

function player(name, scoreBalance, buyIns = 5) {
  const chipsPerHand = 100;
  return {
    name,
    endChips: (buyIns + scoreBalance) * chipsPerHand,
    rebuys: [{ time: '21:00', amount: buyIns }]
  };
}

function assertTransfersSettleRows(result) {
  const balances = new Map(
    result.rows.map(row => [row.name, Math.round(row.pnlScore * 100)])
  );

  result.settlementPlan.transfers.forEach(transfer => {
    const cents = Math.round(transfer.amountScore * 100);
    balances.set(transfer.from, balances.get(transfer.from) + cents);
    balances.set(transfer.to, balances.get(transfer.to) - cents);
  });

  assert.deepEqual(
    Array.from(balances.values()).filter(value => value !== 0),
    []
  );
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('returns exact minimum-transfer Settlement Plan for a valid Cash Game', () => {
  const result = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 1,
    players: [
      player('Ada', 3),
      player('Ben', 2),
      player('Chen', -2),
      player('Dina', -2),
      player('Eli', -1)
    ]
  });

  assert.equal(result.canSettle, true);
  assert.equal(result.settlementPlan.isOptimal, true);
  assert.equal(result.settlementPlan.transfers.length, 3);
  assert.equal(result.totals.diffChips, 0);
  assertTransfersSettleRows(result);
});

test('returns row issues and no transfers for invalid Cash Game input', () => {
  const result = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 1,
    players: [
      { name: 'Ada', endChips: 200, rebuys: [] },
      { name: 'Ada', endChips: -1, rebuys: [{ time: '21:10', amount: 1 }] },
      { name: 'Ben', endChips: 100, rebuys: [{ time: '21:20', amount: 0 }] }
    ]
  });

  assert.equal(result.canSettle, false);
  assert.deepEqual(result.settlementPlan.transfers, []);
  assert(result.issues.includes('玩家名称重复：Ada'));
  assert(result.rows[0].issues.includes('Ada 的买入手数至少为 1 手'));
  assert(result.rows[1].issues.includes('Ada 的剩余筹码无效'));
  assert(result.rows[2].issues.includes('Ben 的买入记录金额无效'));
});

test('marks Settlement Plan approximate when more than 12 non-zero balances need transfers', () => {
  const players = [];
  for (let i = 1; i <= 7; i++) players.push(player(`Winner ${i}`, 1));
  for (let i = 1; i <= 6; i++) players.push(player(`Loser ${i}`, -1));
  players.push(player('Loser 7', -1));

  const result = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 1,
    players
  });

  assert.equal(result.canSettle, true);
  assert.equal(result.settlementPlan.isOptimal, false);
  assert(result.settlementPlan.transfers.length > 0);
  assertTransfersSettleRows(result);
});

test('blocks settlement when chips do not balance', () => {
  const overfilled = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 1,
    players: [
      player('Ada', 2),
      player('Ben', -1)
    ]
  });

  assert.equal(overfilled.canSettle, false);
  assert.equal(overfilled.totals.diffChips, 100);
  assert.deepEqual(overfilled.settlementPlan.transfers, []);
  assert(overfilled.issues.includes('玩家筹码多填 100'));

  const underfilled = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 1,
    players: [
      player('Ada', 1),
      player('Ben', -2)
    ]
  });

  assert.equal(underfilled.canSettle, false);
  assert.equal(underfilled.totals.diffChips, -100);
  assert.deepEqual(underfilled.settlementPlan.transfers, []);
  assert(underfilled.issues.includes('玩家筹码少填 100'));
});

test('keeps chip-balanced Cash Games settleable when Score rounding needs a cent adjustment', () => {
  const result = evaluateCashGameSettlement({
    chipsPerHand: 3,
    pricePerHand: 1,
    players: [
      { name: 'Ada', endChips: 4, rebuys: [{ time: '21:00', amount: 1 }] },
      { name: 'Ben', endChips: 4, rebuys: [{ time: '21:00', amount: 1 }] },
      { name: 'Chen', endChips: 1, rebuys: [{ time: '21:00', amount: 1 }] }
    ]
  });

  assert.equal(result.totals.diffChips, 0);
  assert.equal(result.canSettle, true);
  assert.equal(result.rows.reduce((sum, row) => sum + Math.round(row.pnlScore * 100), 0), 0);
  assertTransfersSettleRows(result);
});

test('still returns chip calculations when only Score configuration is invalid', () => {
  const result = evaluateCashGameSettlement({
    chipsPerHand: 100,
    pricePerHand: 0,
    players: [
      { name: 'Ada', endChips: 250, rebuys: [{ time: '21:00', amount: 2 }] }
    ]
  });

  assert.equal(result.canSettle, false);
  assert(result.issues.includes('每手积分必须是正数'));
  assert.equal(result.rows[0].investedChips, 200);
  assert.equal(result.rows[0].pnlChips, 50);
  assert.equal(result.rows[0].pnlScore, 0);
});
