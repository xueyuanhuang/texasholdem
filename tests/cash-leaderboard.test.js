const assert = require('node:assert/strict');

const { buildCashLeaderboard } = require('../assets/js/08-cash-leaderboard.js');

function player(name, scoreBalance, buyIns = 5) {
  const chipsPerHand = 100;
  return {
    name,
    endChips: (buyIns + scoreBalance) * chipsPerHand,
    rebuys: [{ time: '21:00', amount: buyIns }]
  };
}

function cashGame(id, status, players, overrides = {}) {
  return {
    id,
    status,
    date: overrides.date,
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
    chipsPerHand: 100,
    pricePerHand: 1,
    players,
    ...overrides
  };
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

test('builds Cash Game leaderboard from settled, valid history only', () => {
  const leaderboard = buildCashLeaderboard({
    cashGames: [
      cashGame('settled-1', 'settled', [
        player('Ada', 3),
        player('Ben', -3)
      ]),
      cashGame('active-1', 'active', [
        player('Ada', 20),
        player('Ben', -20)
      ]),
      cashGame('invalid-1', 'settled', [
        player('Ada', 2),
        player('Ben', -1)
      ]),
      cashGame('settled-2', 'settled', [
        player('Ada', -5),
        player('Ben', 5)
      ])
    ]
  });

  assert.equal(leaderboard.countedGames, 2);
  assert.equal(leaderboard.skippedGames, 2);
  assert.deepEqual(
    leaderboard.rows.map(row => ({
      name: row.name,
      games: row.games,
      totalScore: row.totalScore,
      averageScore: row.averageScore
    })),
    [
      { name: 'Ben', games: 2, totalScore: 2, averageScore: 1 },
      { name: 'Ada', games: 2, totalScore: -2, averageScore: -1 }
    ]
  );
});

test('sorts ties by average score, games, then name', () => {
  const leaderboard = buildCashLeaderboard({
    cashGames: [
      cashGame('settled-1', 'settled', [
        player('Ada', 2),
        player('Ben', -2)
      ]),
      cashGame('settled-2', 'settled', [
        player('Ada', -1),
        player('Chen', 1)
      ])
    ]
  });

  assert.deepEqual(
    leaderboard.rows.map(row => row.name),
    ['Chen', 'Ada', 'Ben']
  );
  assert.deepEqual(
    leaderboard.rows.map(row => row.totalScore),
    [1, 1, -2]
  );
});

test('includes per-player game details and full Cash Game details', () => {
  const leaderboard = buildCashLeaderboard({
    cashGames: [
      cashGame('same-day-1', 'settled', [
        player('Ada', 1),
        player('Ben', -1)
      ], {
        date: '2026-08-02',
        createdAt: '2026-08-02T10:00:00.000Z'
      }),
      cashGame('same-day-2', 'settled', [
        player('Ada', 2),
        player('Ben', -2)
      ], {
        date: '2026-08-02',
        createdAt: '2026-08-02T20:00:00.000Z'
      })
    ]
  });

  const ada = leaderboard.rows.find(row => row.name === 'Ada');
  assert.equal(ada.games, 2);
  assert.equal(ada.totalScore, 3);
  assert.deepEqual(
    ada.gameDetails.map(detail => detail.dateGameNumber),
    [2, 1]
  );
  assert.deepEqual(
    ada.gameDetails.map(detail => detail.dateGameCount),
    [2, 2]
  );
  assert.equal(ada.gameDetails[0].playerRow.pnlScore, 2);
  assert.deepEqual(
    ada.gameDetails[0].rows.map(row => ({
      name: row.name,
      buyIns: row.buyIns,
      endChips: row.endChips,
      pnlScore: row.pnlScore
    })),
    [
      { name: 'Ada', buyIns: 5, endChips: 700, pnlScore: 2 },
      { name: 'Ben', buyIns: 5, endChips: 300, pnlScore: -2 }
    ]
  );
  assert.deepEqual(
    ada.gameDetails[0].settlementPlan.transfers,
    [{ from: 'Ben', to: 'Ada', amountScore: 2 }]
  );
});
