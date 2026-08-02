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

function cashGame(id, status, players) {
  return {
    id,
    status,
    chipsPerHand: 100,
    pricePerHand: 1,
    players
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
