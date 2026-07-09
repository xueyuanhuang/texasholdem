import type { Card, Player, Rank, SidePot, Suit } from "./types";

const SUITS: Suit[] = ["s", "h", "d", "c"];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABEL: Record<number, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export function cardLabel(c: Card): string {
  return `${RANK_LABEL[c.r]}${c.s}`;
}

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return d;
}

/** Fisher–Yates with crypto randomness */
export function shuffleDeck(deck: Card[]): Card[] {
  const a = deck.slice();
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.map((i) => arr[i]!));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
  return out;
}

/** Higher score is better. Format: [category, t1, t2, ...] */
export function scoreFive(cards: Card[]): number[] {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const flush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) straightHigh = uniq[0]!;
    // wheel A-5
    if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      straightHigh = 5;
    }
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0]![1] === 4) {
    const kicker = groups.find((g) => g[1] === 1)![0];
    return [7, groups[0]![0], kicker];
  }
  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    return [6, groups[0]![0], groups[1]![0]];
  }
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0]![1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return [3, groups[0]![0], ...kickers];
  }
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const high = Math.max(groups[0]![0], groups[1]![0]);
    const low = Math.min(groups[0]![0], groups[1]![0]);
    const kicker = groups.find((g) => g[1] === 1)![0];
    return [2, high, low, kicker];
  }
  if (groups[0]![1] === 2) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return [1, groups[0]![0], ...kickers];
  }
  return [0, ...ranks];
}

export function compareScores(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function bestHandScore(seven: Card[]): { score: number[]; name: string } {
  let best: number[] = [-1];
  for (const five of combinations(seven, 5)) {
    const sc = scoreFive(five);
    if (compareScores(sc, best) > 0) best = sc;
  }
  return { score: best, name: handName(best) };
}

const CAT_NAMES = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
];

export function handName(score: number[]): string {
  const cat = score[0] || 0;
  return CAT_NAMES[cat] || "未知";
}

export function deal(deck: Card[], n: number): { cards: Card[]; deck: Card[] } {
  return { cards: deck.slice(0, n), deck: deck.slice(n) };
}

/** Build main + side pots from totalBetHand commitments among non-folded in-hand players. */
export function buildSidePots(players: Player[]): SidePot[] {
  const contenders = players.filter((p) => p.inHand && p.totalBetHand > 0);
  if (!contenders.length) return [];

  const levels = [...new Set(contenders.map((p) => p.totalBetHand))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prev = 0;

  for (const level of levels) {
    const layer = level - prev;
    if (layer <= 0) continue;
    // everyone who put at least `level` contributes `layer`
    let amount = 0;
    const eligible: string[] = [];
    for (const p of players) {
      if (p.totalBetHand >= level) {
        amount += layer;
      } else if (p.totalBetHand > prev) {
        amount += p.totalBetHand - prev;
      }
      if (p.inHand && !p.folded && p.totalBetHand >= level) {
        eligible.push(p.id);
      }
    }
    if (amount > 0 && eligible.length) {
      pots.push({ amount, eligibleIds: eligible });
    }
    prev = level;
  }

  // Dead money from folded players already included via contribution loop;
  // ensure folded chips that weren't in levels still counted:
  // Recompute more carefully:
  return recomputePots(players);
}

function recomputePots(players: Player[]): SidePot[] {
  const stillIn = players.filter((p) => p.inHand && !p.folded);
  if (!stillIn.length) {
    const all = players.filter((p) => p.totalBetHand > 0);
    const amount = all.reduce((s, p) => s + p.totalBetHand, 0);
    return amount ? [{ amount, eligibleIds: [] }] : [];
  }

  const contribs = players
    .filter((p) => p.totalBetHand > 0)
    .map((p) => ({ id: p.id, amt: p.totalBetHand, live: p.inHand && !p.folded }))
    .sort((a, b) => a.amt - b.amt);

  const pots: SidePot[] = [];
  let carried = 0;
  const remaining = contribs.map((c) => ({ ...c }));

  while (remaining.some((c) => c.amt > 0)) {
    const liveRemaining = remaining.filter((c) => c.amt > 0);
    if (!liveRemaining.length) break;
    const minAmt = Math.min(...liveRemaining.map((c) => c.amt));
    let potAmt = 0;
    const eligible: string[] = [];
    for (const c of remaining) {
      if (c.amt <= 0) continue;
      const take = Math.min(c.amt, minAmt);
      c.amt -= take;
      potAmt += take;
      if (c.live && c.amt === 0 ? true : c.live) {
        // eligible if was live and contributed to this pot level
      }
    }
    // Re-do eligibility: anyone still live who had at least the cumulative level
    for (const c of contribs) {
      const p = players.find((x) => x.id === c.id)!;
      if (p.inHand && !p.folded && p.totalBetHand >= carried + minAmt) {
        eligible.push(p.id);
      }
    }
    carried += minAmt;
    if (potAmt > 0) pots.push({ amount: potAmt, eligibleIds: [...new Set(eligible)] });
    // remove zero
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i]!.amt === 0 && !remaining[i]!.live) remaining.splice(i, 1);
    }
  }

  return pots.length ? pots : [{ amount: players.reduce((s, p) => s + p.totalBetHand, 0), eligibleIds: stillIn.map((p) => p.id) }];
}

/** Simpler, correct side-pot builder */
export function computePots(players: Player[]): SidePot[] {
  const byCommit = players
    .map((p) => ({
      id: p.id,
      commit: p.totalBetHand,
      eligible: p.inHand && !p.folded,
    }))
    .filter((p) => p.commit > 0)
    .sort((a, b) => a.commit - b.commit);

  if (!byCommit.length) return [];

  const pots: SidePot[] = [];
  let prevLevel = 0;
  const levels = [...new Set(byCommit.map((p) => p.commit))];

  for (const level of levels) {
    const contributors = byCommit.filter((p) => p.commit >= level);
    const layerSize = level - prevLevel;
    const amount = layerSize * contributors.length;
    // also players between prev and level with partial? handled by levels being all commits
    const eligibleIds = byCommit
      .filter((p) => p.eligible && p.commit >= level)
      .map((p) => p.id);
    if (amount > 0) {
      pots.push({ amount, eligibleIds });
    }
    prevLevel = level;
  }

  // Fix: players with commit between levels already form levels. Good.
  // But wait: if A=100, B=50, C=50 folded: levels 50,100
  // pot1: 50*3=150 eligible A,B (if C folded, eligible A,B)
  // pot2: 50*1=50 eligible A
  // Correct.

  return pots;
}

export function nextOccupiedSeat(
  players: Player[],
  fromSeat: number,
  pred: (p: Player) => boolean
): number | null {
  const seats = players.map((p) => p.seat).sort((a, b) => a - b);
  if (!seats.length) return null;
  for (let step = 1; step <= 9; step++) {
    const seat = (fromSeat + step) % 9;
    const p = players.find((x) => x.seat === seat);
    if (p && pred(p)) return seat;
  }
  return null;
}

export function chipLeaderStack(players: Player[]): number {
  if (!players.length) return 0;
  return Math.max(...players.map((p) => p.stack));
}
