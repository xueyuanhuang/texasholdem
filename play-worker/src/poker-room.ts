import {
  bestHandScore,
  cardLabel,
  chipLeaderStack,
  compareScores,
  computePots,
  deal,
  freshDeck,
  nextOccupiedSeat,
  shuffleDeck,
} from "./poker-engine";
import type {
  Card,
  Env,
  Phase,
  Player,
  RoomState,
  SettlementRow,
  TableConfig,
} from "./types";
import { newId, saveSession, verifyJwt } from "./auth";

interface ConnMeta {
  userId: string;
  username: string;
  nickname: string;
}

const DEFAULT_CONFIG: TableConfig = {
  maxPlayers: 9,
  smallBlind: 5,
  bigBlind: 10,
  actionSeconds: 20,
  buyIn: 1000,
  allowRebuy: true,
  rebuyCapByChipLeader: true,
  durationHours: 1,
};

function emptyState(code: string, hostId: string, config: TableConfig): RoomState {
  return {
    code,
    hostId,
    config,
    phase: "lobby",
    players: [],
    deck: [],
    community: [],
    pot: 0,
    sidePots: [],
    buttonSeat: 0,
    currentSeat: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    lastAggressorSeat: null,
    handNumber: 0,
    actionDeadline: null,
    endsAt: null,
    startedAt: null,
    showdownRevealed: {},
    lastWinners: [],
    settlement: null,
    log: [],
    actedSeats: [],
  };
}

export class PokerRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room: RoomState | null = null;
  /** non-hibernation fallback; hibernatable WS use serializeAttachment */
  private sessions = new Map<WebSocket, ConnMeta>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<RoomState>("room")) || null;
    });
  }

  private setMeta(ws: WebSocket, meta: ConnMeta) {
    this.sessions.set(ws, meta);
    try {
      ws.serializeAttachment(meta);
    } catch {
      /* non-hibernatable path */
    }
  }

  private getMeta(ws: WebSocket): ConnMeta | null {
    const cached = this.sessions.get(ws);
    if (cached) return cached;
    try {
      const att = ws.deserializeAttachment() as ConnMeta | null;
      if (att?.userId) {
        this.sessions.set(ws, att);
        return att;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private allSockets(): WebSocket[] {
    try {
      const hib = this.state.getWebSockets?.() || [];
      if (hib.length) return hib;
    } catch {
      /* ignore */
    }
    return [...this.sessions.keys()];
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname.endsWith("/create") && request.method === "POST") {
      return this.handleCreate(request);
    }

    if (url.pathname.endsWith("/info") && request.method === "GET") {
      if (!this.room) return json({ ok: false, error: "房间不存在" }, 404);
      return json({
        ok: true,
        code: this.room.code,
        phase: this.room.phase,
        players: this.room.players.length,
        maxPlayers: this.room.config.maxPlayers,
        endsAt: this.room.endsAt,
      });
    }

    return json({ ok: false, error: "not found" }, 404);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    const roomAny = this.room as RoomState & { nextHandAt?: number };

    // Session time up → force end
    if (this.room.endsAt && now >= this.room.endsAt && this.room.phase !== "ended") {
      await this.endSession("时间到，自动结束");
      return;
    }

    // Between hands → start next
    if (
      this.room.phase === "between" &&
      roomAny.nextHandAt &&
      now >= roomAny.nextHandAt
    ) {
      delete roomAny.nextHandAt;
      const withChips = this.room.players.filter((p) => p.stack > 0);
      if (withChips.length < 2) {
        await this.endSession("不足两人有筹码，结束");
        return;
      }
      await this.startHand();
      return;
    }

    // Action timeout
    if (
      this.room.actionDeadline &&
      now >= this.room.actionDeadline &&
      this.room.phase !== "lobby" &&
      this.room.phase !== "ended" &&
      this.room.phase !== "between" &&
      this.room.phase !== "showdown"
    ) {
      await this.autoFoldTimeout();
    }

    await this.scheduleAlarm();
  }

  private async handleCreate(request: Request): Promise<Response> {
    const auth = await this.authUser(request);
    if (!auth.ok) return json({ ok: false, error: auth.error }, 401);

    const body = (await request.json().catch(() => ({}))) as Partial<TableConfig> & {
      code?: string;
    };
    const config = normalizeConfig(body);
    const code = (body.code || randomCode()).toUpperCase();

    if (this.room && this.room.phase !== "ended") {
      return json({ ok: false, error: "该房间码已被占用" }, 409);
    }

    this.room = emptyState(code, auth.user.id, config);
    this.pushLog(`房主 ${auth.user.nickname} 创建了牌桌`);
    await this.persist();
    return json({ ok: true, code, config });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      this.send(ws, { type: "error", message: "无效消息" });
      return;
    }

    const type = String(data.type || "");
    try {
      switch (type) {
        case "hello":
          await this.onHello(ws, data);
          break;
        case "join":
          await this.onJoin(ws, data);
          break;
        case "start":
          await this.onStart(ws);
          break;
        case "action":
          await this.onAction(ws, data);
          break;
        case "rebuy":
          await this.onRebuy(ws, data);
          break;
        case "leave":
          await this.onLeave(ws);
          break;
        case "end":
          await this.onEnd(ws);
          break;
        case "ping":
          this.send(ws, { type: "pong", t: Date.now() });
          break;
        default:
          this.send(ws, { type: "error", message: `未知指令: ${type}` });
      }
    } catch (e) {
      this.send(ws, { type: "error", message: e instanceof Error ? e.message : "操作失败" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = this.getMeta(ws);
    this.sessions.delete(ws);
    if (meta && this.room) {
      const p = this.room.players.find((x) => x.id === meta.userId);
      if (p) {
        p.connected = false;
        await this.persist();
        this.broadcast();
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  private async onHello(ws: WebSocket, data: Record<string, unknown>) {
    const token = String(data.token || "");
    const payload = await verifyJwt(token, this.env.JWT_SECRET);
    if (!payload) {
      this.send(ws, { type: "error", message: "未登录" });
      ws.close(4001, "auth");
      return;
    }
    this.setMeta(ws, {
      userId: payload.sub,
      username: payload.username,
      nickname: payload.nickname,
    });
    if (!this.room) {
      this.send(ws, { type: "error", message: "房间不存在，请先创建" });
      return;
    }
    // refresh nickname from token
    const p = this.room.players.find((x) => x.id === payload.sub);
    if (p) {
      p.nickname = payload.nickname;
      p.connected = true;
    }
    this.send(ws, { type: "state", state: this.publicState(payload.sub) });
  }

  private async onJoin(ws: WebSocket, _data: Record<string, unknown>) {
    const meta = this.getMeta(ws);
    if (!meta) throw new Error("请先 hello");
    if (!this.room) throw new Error("房间不存在");
    if (this.room.phase === "ended") throw new Error("牌局已结束");

    const existing = this.room.players.find((p) => p.id === meta.userId);
    if (existing) {
      existing.connected = true;
      existing.nickname = meta.nickname;
      await this.persist();
      this.broadcast();
      return;
    }

    if (this.room.phase !== "lobby") {
      throw new Error("牌局已开始，无法中途入座（仅可重连）");
    }
    if (this.room.players.length >= this.room.config.maxPlayers) {
      throw new Error("人数已满");
    }

    const seat = this.nextFreeSeat();
    if (seat === null) throw new Error("无空座位");

    const buyIn = this.room.config.buyIn;
    const player: Player = {
      id: meta.userId,
      username: meta.username,
      nickname: meta.nickname,
      seat,
      stack: buyIn,
      totalBuyIn: buyIn,
      cashedOut: 0,
      holeCards: null,
      inHand: false,
      folded: false,
      betThisRound: 0,
      totalBetHand: 0,
      allIn: false,
      connected: true,
    };
    this.room.players.push(player);
    this.room.players.sort((a, b) => a.seat - b.seat);
    this.pushLog(`${meta.nickname} 入座 #${seat + 1}，买入 ${buyIn}`);
    await this.persist();
    this.broadcast();
  }

  private async onStart(ws: WebSocket) {
    const meta = this.requireMeta(ws);
    if (!this.room) throw new Error("无房间");
    if (meta.userId !== this.room.hostId) throw new Error("仅房主可开局");
    if (this.room.phase !== "lobby") throw new Error("已开始");
    if (this.room.players.length < 2) throw new Error("至少 2 人才能开局");

    const now = Date.now();
    this.room.startedAt = now;
    this.room.endsAt = now + this.room.config.durationHours * 3600 * 1000;
    this.room.buttonSeat = this.room.players[0]!.seat;
    this.pushLog(
      `开局！时长 ${this.room.config.durationHours}h，盲注 ${this.room.config.smallBlind}/${this.room.config.bigBlind}`
    );
    await this.startHand();
    await this.scheduleAlarm();
  }

  private async onEnd(ws: WebSocket) {
    const meta = this.requireMeta(ws);
    if (!this.room) throw new Error("无房间");
    if (meta.userId !== this.room.hostId) throw new Error("仅房主可提前结束");
    if (this.room.phase === "ended") return;
    await this.endSession("房主结束牌局");
  }

  private async onLeave(ws: WebSocket) {
    const meta = this.requireMeta(ws);
    if (!this.room) return;
    if (this.room.phase !== "lobby") {
      throw new Error("开局后不能离开（可断线重连）");
    }
    this.room.players = this.room.players.filter((p) => p.id !== meta.userId);
    this.pushLog(`${meta.nickname} 离开`);
    await this.persist();
    this.broadcast();
  }

  private async onRebuy(ws: WebSocket, data: Record<string, unknown>) {
    const meta = this.requireMeta(ws);
    if (!this.room) throw new Error("无房间");
    if (!this.room.config.allowRebuy) throw new Error("本桌不允许补码");
    if (this.room.phase === "ended") throw new Error("已结束");
    if (this.room.phase !== "lobby" && this.room.phase !== "between") {
      throw new Error("请在两手牌之间补码");
    }

    const p = this.room.players.find((x) => x.id === meta.userId);
    if (!p) throw new Error("未入座");

    let amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      amount = this.room.config.buyIn;
    }
    amount = Math.floor(amount);

    if (this.room.config.rebuyCapByChipLeader) {
      const leader = chipLeaderStack(this.room.players.filter((x) => x.id !== p.id));
      const cap = leader > 0 ? leader : this.room.config.buyIn;
      if (p.stack + amount > cap) {
        amount = Math.max(0, cap - p.stack);
        if (amount <= 0) throw new Error(`补码后不能超过 chip leader（当前领先 ${cap}）`);
      }
    }

    p.stack += amount;
    p.totalBuyIn += amount;
    this.pushLog(`${p.nickname} 补码 ${amount}（桌上 ${p.stack}）`);
    await this.persist();
    this.broadcast();
  }

  private async onAction(ws: WebSocket, data: Record<string, unknown>) {
    const meta = this.requireMeta(ws);
    if (!this.room) throw new Error("无房间");
    if (this.room.currentSeat === null) throw new Error("非行动阶段");
    const actor = this.room.players.find((p) => p.seat === this.room!.currentSeat);
    if (!actor || actor.id !== meta.userId) throw new Error("还没轮到你");

    const action = String(data.action || "");
    const toCall = this.room.currentBet - actor.betThisRound;

    if (action === "fold") {
      actor.folded = true;
      actor.inHand = false;
      this.markActed(actor.seat);
      this.pushLog(`${actor.nickname} 弃牌`);
    } else if (action === "check") {
      if (toCall > 0) throw new Error("不能过牌，需跟注或弃牌");
      this.markActed(actor.seat);
      this.pushLog(`${actor.nickname} 过牌`);
    } else if (action === "call") {
      if (toCall <= 0) throw new Error("无需跟注，请过牌");
      this.putChips(actor, Math.min(toCall, actor.stack));
      this.markActed(actor.seat);
      this.pushLog(`${actor.nickname} 跟注`);
    } else if (action === "raise" || action === "bet") {
      let raiseTo = Math.floor(Number(data.amount));
      if (!Number.isFinite(raiseTo)) throw new Error("加注金额无效");
      // amount is total bet this round (raise-to)
      if (raiseTo <= this.room.currentBet && actor.stack > toCall) {
        throw new Error(`加注至少到 ${this.room.currentBet + this.room.minRaise}`);
      }
      const need = raiseTo - actor.betThisRound;
      if (need <= 0) throw new Error("加注无效");
      if (need > actor.stack) raiseTo = actor.betThisRound + actor.stack;
      const actualNeed = raiseTo - actor.betThisRound;
      const prevBet = this.room.currentBet;
      this.putChips(actor, actualNeed);
      if (actor.betThisRound > prevBet) {
        const raiseSize = actor.betThisRound - prevBet;
        if (raiseSize >= this.room.minRaise || actor.allIn) {
          this.room.minRaise = Math.max(this.room.minRaise, raiseSize);
        }
        this.room.currentBet = actor.betThisRound;
        this.room.lastAggressorSeat = actor.seat;
        // re-open action for others
        this.room.actedSeats = [actor.seat];
      } else {
        this.markActed(actor.seat);
      }
      this.pushLog(`${actor.nickname} 加注到 ${actor.betThisRound}`);
    } else if (action === "allin") {
      const prevBet = this.room.currentBet;
      this.putChips(actor, actor.stack);
      if (actor.betThisRound > prevBet) {
        const raiseSize = actor.betThisRound - prevBet;
        this.room.minRaise = Math.max(this.room.minRaise, raiseSize || this.room.minRaise);
        this.room.currentBet = actor.betThisRound;
        this.room.lastAggressorSeat = actor.seat;
        this.room.actedSeats = [actor.seat];
      } else {
        this.markActed(actor.seat);
      }
      this.pushLog(`${actor.nickname} 全下 ${actor.totalBetHand}`);
    } else {
      throw new Error("未知行动");
    }

    await this.afterAction();
  }

  private putChips(p: Player, amount: number) {
    const n = Math.min(amount, p.stack);
    p.stack -= n;
    p.betThisRound += n;
    p.totalBetHand += n;
    this.room!.pot += n;
    if (p.stack === 0) p.allIn = true;
  }

  private markActed(seat: number) {
    if (!this.room!.actedSeats.includes(seat)) this.room!.actedSeats.push(seat);
  }

  private async afterAction() {
    if (!this.room) return;

    // Only one player left
    const live = this.room.players.filter((p) => p.inHand && !p.folded);
    if (live.length === 1) {
      await this.awardFoldWin(live[0]!);
      return;
    }

    if (this.bettingRoundComplete()) {
      await this.advanceStreet();
    } else {
      this.room.currentSeat = this.nextActor(this.room.currentSeat!);
      this.armActionDeadline();
      await this.persist();
      this.broadcast();
    }
  }

  private bettingRoundComplete(): boolean {
    if (!this.room) return true;
    const active = this.room.players.filter((p) => p.inHand && !p.folded && !p.allIn);
    if (!active.length) return true;
    for (const p of active) {
      if (p.betThisRound !== this.room.currentBet) return false;
      if (!this.room.actedSeats.includes(p.seat)) return false;
    }
    return true;
  }

  private async advanceStreet() {
    if (!this.room) return;
    // reset round bets
    for (const p of this.room.players) {
      p.betThisRound = 0;
    }
    this.room.currentBet = 0;
    this.room.minRaise = this.room.config.bigBlind;
    this.room.actedSeats = [];
    this.room.lastAggressorSeat = null;

    const phase = this.room.phase;
    if (phase === "preflop") {
      const d = deal(this.room.deck, 3);
      this.room.community = d.cards;
      this.room.deck = d.deck;
      this.room.phase = "flop";
      this.pushLog(`翻牌 ${this.room.community.map(cardLabel).join(" ")}`);
    } else if (phase === "flop") {
      const d = deal(this.room.deck, 1);
      this.room.community.push(...d.cards);
      this.room.deck = d.deck;
      this.room.phase = "turn";
      this.pushLog(`转牌 ${cardLabel(d.cards[0]!)}`);
    } else if (phase === "turn") {
      const d = deal(this.room.deck, 1);
      this.room.community.push(...d.cards);
      this.room.deck = d.deck;
      this.room.phase = "river";
      this.pushLog(`河牌 ${cardLabel(d.cards[0]!)}`);
    } else if (phase === "river") {
      await this.showdown();
      return;
    }

    // If everyone all-in, run out board
    const canAct = this.room.players.filter((p) => p.inHand && !p.folded && !p.allIn);
    if (canAct.length <= 1) {
      await this.runoutAndShowdown();
      return;
    }

    // first to act: left of button
    this.room.currentSeat = nextOccupiedSeat(
      this.room.players,
      this.room.buttonSeat,
      (p) => p.inHand && !p.folded && !p.allIn
    );
    this.armActionDeadline();
    await this.persist();
    this.broadcast();
  }

  private async runoutAndShowdown() {
    if (!this.room) return;
    while (this.room.community.length < 5) {
      const d = deal(this.room.deck, this.room.community.length === 0 ? 3 : 1);
      this.room.community.push(...d.cards);
      this.room.deck = d.deck;
    }
    this.room.phase = "river";
    await this.showdown();
  }

  private async showdown() {
    if (!this.room) return;
    this.room.phase = "showdown";
    this.room.currentSeat = null;
    this.room.actionDeadline = null;

    const pots = computePots(this.room.players);
    this.room.sidePots = pots;
    this.room.lastWinners = [];
    this.room.showdownRevealed = {};

    for (const p of this.room.players) {
      if (p.inHand && !p.folded && p.holeCards) {
        this.room.showdownRevealed[p.id] = p.holeCards;
      }
    }

    for (const pot of pots) {
      if (!pot.eligibleIds.length) continue;
      let bestScore: number[] = [-1];
      let winners: Player[] = [];
      let handName = "";
      for (const id of pot.eligibleIds) {
        const p = this.room.players.find((x) => x.id === id);
        if (!p?.holeCards) continue;
        const seven = [...p.holeCards, ...this.room.community];
        const { score, name } = bestHandScore(seven);
        const cmp = compareScores(score, bestScore);
        if (cmp > 0) {
          bestScore = score;
          winners = [p];
          handName = name;
        } else if (cmp === 0) {
          winners.push(p);
        }
      }
      if (!winners.length) continue;
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) {
        let gain = share;
        if (rem > 0) {
          gain++;
          rem--;
        }
        w.stack += gain;
      }
      this.room.lastWinners.push({
        userIds: winners.map((w) => w.id),
        amount: pot.amount,
        handName,
      });
      this.pushLog(
        `底池 ${pot.amount} → ${winners.map((w) => w.nickname).join(",")}${handName ? `（${handName}）` : ""}`
      );
    }

    this.room.pot = 0;
    this.room.phase = "between";
    this.room.currentSeat = null;
    this.room.actionDeadline = null;
    (this.room as RoomState & { nextHandAt?: number }).nextHandAt = Date.now() + 3200;
    await this.persist();
    this.broadcast();
    await this.state.storage.setAlarm(Date.now() + 3200);
  }

  private async awardFoldWin(winner: Player) {
    if (!this.room) return;
    winner.stack += this.room.pot;
    this.room.lastWinners = [{ userIds: [winner.id], amount: this.room.pot }];
    this.pushLog(`${winner.nickname} 赢下底池 ${this.room.pot}（无人跟注）`);
    this.room.pot = 0;
    this.room.phase = "between";
    this.room.currentSeat = null;
    this.room.actionDeadline = null;
    this.room.showdownRevealed = {};
    (this.room as RoomState & { nextHandAt?: number }).nextHandAt = Date.now() + 2000;
    await this.persist();
    this.broadcast();
    await this.state.storage.setAlarm(Date.now() + 2000);
  }

  private async startHand() {
    if (!this.room) return;
    if (this.room.endsAt && Date.now() >= this.room.endsAt) {
      await this.endSession("时间到，自动结束");
      return;
    }

    // remove broke optional - keep seated with 0, skip dealing
    const eligible = this.room.players.filter((p) => p.stack > 0);
    if (eligible.length < 2) {
      await this.endSession("不足两人有筹码，结束");
      return;
    }

    this.room.handNumber += 1;
    this.room.community = [];
    this.room.pot = 0;
    this.room.sidePots = [];
    this.room.showdownRevealed = {};
    this.room.lastWinners = [];
    this.room.actedSeats = [];
    this.room.deck = shuffleDeck(freshDeck());
    this.room.phase = "preflop";
    this.room.minRaise = this.room.config.bigBlind;
    this.room.currentBet = 0;

    for (const p of this.room.players) {
      p.holeCards = null;
      p.folded = false;
      p.allIn = false;
      p.betThisRound = 0;
      p.totalBetHand = 0;
      p.inHand = p.stack > 0;
    }

    // move button
    if (this.room.handNumber > 1) {
      const nextBtn = nextOccupiedSeat(
        this.room.players,
        this.room.buttonSeat,
        (p) => p.stack > 0
      );
      if (nextBtn !== null) this.room.buttonSeat = nextBtn;
    } else {
      const first = eligible[0]!.seat;
      this.room.buttonSeat = first;
    }

    // deal hole cards
    for (const p of this.room.players) {
      if (!p.inHand) continue;
      const d = deal(this.room.deck, 2);
      p.holeCards = d.cards;
      this.room.deck = d.deck;
    }

    const headsUp = eligible.length === 2;
    // blinds
    let sbSeat: number | null;
    let bbSeat: number | null;
    if (headsUp) {
      sbSeat = this.room.buttonSeat;
      bbSeat = nextOccupiedSeat(this.room.players, sbSeat, (p) => p.inHand);
    } else {
      sbSeat = nextOccupiedSeat(this.room.players, this.room.buttonSeat, (p) => p.inHand);
      bbSeat = sbSeat !== null ? nextOccupiedSeat(this.room.players, sbSeat, (p) => p.inHand) : null;
    }

    if (sbSeat !== null) {
      const sb = this.room.players.find((p) => p.seat === sbSeat)!;
      this.putChips(sb, Math.min(this.room.config.smallBlind, sb.stack));
    }
    if (bbSeat !== null) {
      const bb = this.room.players.find((p) => p.seat === bbSeat)!;
      this.putChips(bb, Math.min(this.room.config.bigBlind, bb.stack));
      this.room.currentBet = bb.betThisRound;
    }

    this.room.lastAggressorSeat = bbSeat;
    // first actor: left of BB (UTG), heads-up: button/SB acts first preflop
    if (headsUp) {
      this.room.currentSeat = sbSeat;
    } else {
      this.room.currentSeat =
        bbSeat !== null
          ? nextOccupiedSeat(this.room.players, bbSeat, (p) => p.inHand && !p.allIn)
          : null;
    }

    // blinds already "acted" in a sense but must still respond to raises — don't mark acted
    this.room.actedSeats = [];
    this.armActionDeadline();
    this.pushLog(`第 ${this.room.handNumber} 手开始`);
    await this.persist();
    this.broadcast();
    await this.scheduleAlarm();
  }

  private async autoFoldTimeout() {
    if (!this.room || this.room.currentSeat === null) return;
    const actor = this.room.players.find((p) => p.seat === this.room!.currentSeat);
    if (!actor) return;
    const toCall = this.room.currentBet - actor.betThisRound;
    if (toCall <= 0) {
      this.markActed(actor.seat);
      this.pushLog(`${actor.nickname} 超时过牌`);
    } else {
      actor.folded = true;
      actor.inHand = false;
      this.markActed(actor.seat);
      this.pushLog(`${actor.nickname} 超时弃牌`);
    }
    await this.afterAction();
  }

  private async endSession(reason: string) {
    if (!this.room || this.room.phase === "ended") return;
    // return current pot to no one — split is complex mid-hand; give to pot participants pro-rata skipped: just add pot back? Better: fold-award not possible. Refund pot by totalBetHand.
    if (this.room.pot > 0) {
      for (const p of this.room.players) {
        if (p.totalBetHand > 0) {
          p.stack += p.totalBetHand;
          p.totalBetHand = 0;
          p.betThisRound = 0;
        }
      }
      this.room.pot = 0;
    }

    const settlement: SettlementRow[] = this.room.players.map((p) => {
      const ending = p.stack + p.cashedOut;
      return {
        userId: p.id,
        username: p.username,
        nickname: p.nickname,
        totalBuyIn: p.totalBuyIn,
        endingChips: ending,
        net: ending - p.totalBuyIn,
      };
    });
    settlement.sort((a, b) => b.net - a.net);

    this.room.settlement = settlement;
    this.room.phase = "ended";
    this.room.currentSeat = null;
    this.room.actionDeadline = null;
    this.pushLog(reason);
    this.pushLog("结算完成");

    const sessionId = newId();
    try {
      await saveSession(this.env, {
        id: sessionId,
        room_code: this.room.code,
        host_user_id: this.room.hostId,
        config_json: JSON.stringify(this.room.config),
        started_at: new Date(this.room.startedAt || Date.now()).toISOString(),
        ended_at: new Date().toISOString(),
        duration_hours: this.room.config.durationHours,
        settlement_json: JSON.stringify(settlement),
      });
    } catch (e) {
      this.pushLog(`会话存档失败: ${e instanceof Error ? e.message : e}`);
    }

    await this.persist();
    this.broadcast();
  }

  private nextActor(fromSeat: number): number | null {
    if (!this.room) return null;
    return nextOccupiedSeat(
      this.room.players,
      fromSeat,
      (p) => p.inHand && !p.folded && !p.allIn
    );
  }

  private nextFreeSeat(): number | null {
    if (!this.room) return null;
    const used = new Set(this.room.players.map((p) => p.seat));
    for (let i = 0; i < this.room.config.maxPlayers; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }

  private armActionDeadline() {
    if (!this.room) return;
    this.room.actionDeadline = Date.now() + this.room.config.actionSeconds * 1000;
  }

  private async scheduleAlarm() {
    if (!this.room || this.room.phase === "ended") {
      await this.state.storage.deleteAlarm();
      return;
    }
    const times: number[] = [];
    if (this.room.endsAt) times.push(this.room.endsAt);
    if (this.room.actionDeadline) times.push(this.room.actionDeadline);
    const nextHandAt = (this.room as RoomState & { nextHandAt?: number }).nextHandAt;
    if (nextHandAt) times.push(nextHandAt);
    if (!times.length) return;
    const next = Math.min(...times);
    await this.state.storage.setAlarm(next);
  }

  private pushLog(msg: string) {
    if (!this.room) return;
    this.room.log.push(msg);
    if (this.room.log.length > 80) this.room.log = this.room.log.slice(-80);
  }

  private async persist() {
    if (this.room) await this.state.storage.put("room", this.room);
  }

  private requireMeta(ws: WebSocket): ConnMeta {
    const m = this.getMeta(ws);
    if (!m) throw new Error("未认证");
    return m;
  }

  private async authUser(request: Request) {
    const h = request.headers.get("Authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const payload = await verifyJwt(token, this.env.JWT_SECRET);
    if (!payload) return { ok: false as const, error: "未登录" };
    return {
      ok: true as const,
      user: { id: payload.sub, username: payload.username, nickname: payload.nickname },
    };
  }

  private publicState(viewerId: string) {
    if (!this.room) return null;
    const now = Date.now();
    return {
      code: this.room.code,
      hostId: this.room.hostId,
      config: this.room.config,
      phase: this.room.phase,
      handNumber: this.room.handNumber,
      community: this.room.community,
      pot: this.room.pot,
      buttonSeat: this.room.buttonSeat,
      currentSeat: this.room.currentSeat,
      currentBet: this.room.currentBet,
      minRaise: this.room.minRaise,
      actionDeadline: this.room.actionDeadline,
      endsAt: this.room.endsAt,
      startedAt: this.room.startedAt,
      serverNow: now,
      lastWinners: this.room.lastWinners,
      settlement: this.room.settlement,
      log: this.room.log.slice(-30),
      players: this.room.players.map((p) => ({
        id: p.id,
        username: p.username,
        nickname: p.nickname,
        seat: p.seat,
        stack: p.stack,
        totalBuyIn: p.totalBuyIn,
        betThisRound: p.betThisRound,
        folded: p.folded,
        allIn: p.allIn,
        inHand: p.inHand,
        connected: p.connected,
        isHost: p.id === this.room!.hostId,
        holeCards:
          p.id === viewerId || this.room!.showdownRevealed[p.id]
            ? p.holeCards || this.room!.showdownRevealed[p.id] || null
            : p.holeCards
              ? [{ r: 0, s: "?" }, { r: 0, s: "?" }]
              : null,
        isYou: p.id === viewerId,
      })),
      legal:
        this.room.currentSeat !== null &&
        this.room.players.find((p) => p.seat === this.room!.currentSeat)?.id === viewerId
          ? this.legalActions(viewerId)
          : null,
    };
  }

  private legalActions(userId: string) {
    if (!this.room || this.room.currentSeat === null) return null;
    const p = this.room.players.find((x) => x.id === userId);
    if (!p || p.seat !== this.room.currentSeat) return null;
    const toCall = this.room.currentBet - p.betThisRound;
    return {
      canFold: true,
      canCheck: toCall <= 0,
      canCall: toCall > 0 && p.stack > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise: p.stack > toCall,
      minRaiseTo: this.room.currentBet + this.room.minRaise,
      maxRaiseTo: p.betThisRound + p.stack,
      canAllIn: p.stack > 0,
    };
  }

  private broadcast() {
    for (const ws of this.allSockets()) {
      const meta = this.getMeta(ws);
      if (!meta) continue;
      try {
        this.send(ws, { type: "state", state: this.publicState(meta.userId) });
      } catch {
        /* ignore */
      }
    }
  }

  private send(ws: WebSocket, obj: unknown) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* closed */
    }
  }
}

function normalizeConfig(body: Partial<TableConfig>): TableConfig {
  const maxPlayers = clamp(Math.floor(Number(body.maxPlayers) || 9), 2, 9);
  const smallBlind = clamp(Math.floor(Number(body.smallBlind) || 5), 1, 1_000_000);
  const bigBlind = clamp(Math.floor(Number(body.bigBlind) || smallBlind * 2), smallBlind, 2_000_000);
  const actionSeconds = clamp(Math.floor(Number(body.actionSeconds) || 20), 10, 120);
  const buyIn = clamp(Math.floor(Number(body.buyIn) || 1000), bigBlind * 10, 50_000_000);
  const allowRebuy = body.allowRebuy !== false;
  const rebuyCapByChipLeader = body.rebuyCapByChipLeader !== false;
  let durationHours = Number(body.durationHours) || 1;
  // snap to 0.5 steps, min 0.5
  durationHours = Math.max(0.5, Math.round(durationHours * 2) / 2);
  if (durationHours > 8) durationHours = 8;

  return {
    maxPlayers,
    smallBlind,
    bigBlind,
    actionSeconds,
    buyIn,
    allowRebuy,
    rebuyCapByChipLeader,
    durationHours,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// silence unused import
void (null as unknown as Phase);
void (null as unknown as Card);
