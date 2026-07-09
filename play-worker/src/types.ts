export type Suit = "s" | "h" | "d" | "c";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  r: Rank;
  s: Suit;
}

export interface TableConfig {
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  actionSeconds: number;
  buyIn: number;
  allowRebuy: boolean;
  rebuyCapByChipLeader: boolean;
  durationHours: number;
}

export interface Player {
  id: string;
  username: string;
  nickname: string;
  seat: number;
  stack: number;
  totalBuyIn: number;
  /** chips returned when sitting out mid-session (for settlement) */
  cashedOut: number;
  holeCards: Card[] | null;
  inHand: boolean;
  folded: boolean;
  betThisRound: number;
  totalBetHand: number;
  allIn: boolean;
  connected: boolean;
}

export type Phase =
  | "lobby"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "between"
  | "ended";

export interface SidePot {
  amount: number;
  eligibleIds: string[];
}

export interface SettlementRow {
  userId: string;
  username: string;
  nickname: string;
  totalBuyIn: number;
  endingChips: number;
  net: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  config: TableConfig;
  phase: Phase;
  players: Player[];
  deck: Card[];
  community: Card[];
  pot: number;
  sidePots: SidePot[];
  buttonSeat: number;
  currentSeat: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressorSeat: number | null;
  handNumber: number;
  actionDeadline: number | null;
  endsAt: number | null;
  startedAt: number | null;
  showdownRevealed: Record<string, Card[]>;
  lastWinners: { userIds: string[]; amount: number; handName?: string }[];
  settlement: SettlementRow[] | null;
  log: string[];
  /** seats that acted this street (check/call/raise/fold); for betting round complete */
  actedSeats: number[];
}

export interface JwtPayload {
  sub: string;
  username: string;
  nickname: string;
  exp: number;
}

export interface Env {
  DB: D1Database;
  POKER_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CORS_ORIGIN?: string;
}
