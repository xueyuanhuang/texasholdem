/**
 * Minimal smoke tests for hand ranking & pots (no wrangler required).
 * Run: node tests/engine.test.mjs
 */

function scoreFive(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      straightHigh = 5;
    }
  }
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : b[0] - a[0]));
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups.find((g) => g[1] === 1)[0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const high = Math.max(groups[0][0], groups[1][0]);
    const low = Math.min(groups[0][0], groups[1][0]);
    return [2, high, low, groups.find((g) => g[1] === 1)[0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0])];
  return [0, ...ranks];
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function computePots(players) {
  const byCommit = players
    .map((p) => ({ id: p.id, commit: p.totalBetHand, eligible: p.inHand && !p.folded }))
    .filter((p) => p.commit > 0)
    .sort((a, b) => a.commit - b.commit);
  if (!byCommit.length) return [];
  const pots = [];
  let prevLevel = 0;
  const levels = [...new Set(byCommit.map((p) => p.commit))];
  for (const level of levels) {
    const contributors = byCommit.filter((p) => p.commit >= level);
    const layerSize = level - prevLevel;
    const amount = layerSize * contributors.length;
    const eligibleIds = byCommit.filter((p) => p.eligible && p.commit >= level).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligibleIds });
    prevLevel = level;
  }
  return pots;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

// pair of aces beats pair of kings
const aa = scoreFive([
  { r: 14, s: "s" },
  { r: 14, s: "h" },
  { r: 2, s: "d" },
  { r: 5, s: "c" },
  { r: 9, s: "s" },
]);
const kk = scoreFive([
  { r: 13, s: "s" },
  { r: 13, s: "h" },
  { r: 2, s: "d" },
  { r: 5, s: "c" },
  { r: 9, s: "s" },
]);
assert(cmp(aa, kk) > 0, "AA > KK");

// wheel straight
const wheel = scoreFive([
  { r: 14, s: "s" },
  { r: 2, s: "h" },
  { r: 3, s: "d" },
  { r: 4, s: "c" },
  { r: 5, s: "s" },
]);
assert(wheel[0] === 4 && wheel[1] === 5, "A-5 straight");

// side pots: A 100 all-in, B 50, C 50
const pots = computePots([
  { id: "A", totalBetHand: 100, inHand: true, folded: false },
  { id: "B", totalBetHand: 50, inHand: true, folded: false },
  { id: "C", totalBetHand: 50, inHand: true, folded: false },
]);
const total = pots.reduce((s, p) => s + p.amount, 0);
assert(total === 200, "pot total 200");
assert(pots[0].amount === 150 && pots[0].eligibleIds.length === 3, "main pot 150 3-way");
assert(pots[1].amount === 50 && pots[1].eligibleIds[0] === "A", "side pot 50 for A");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
