(() => {
  const STORAGE_KEY = "poker_play_auth";
  const cfg = () => window.PLAY_CONFIG || { apiBase: "http://127.0.0.1:8787" };

  const $ = (id) => document.getElementById(id);
  const state = {
    token: null,
    user: null,
    roomCode: null,
    ws: null,
    table: null,
    timerIv: null,
    closingWs: false,
  };

  const phaseMap = {
    lobby: "大厅",
    preflop: "翻前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
    showdown: "摊牌",
    between: "手间",
    ended: "已结束",
  };

  const ranks = {
    11: "J",
    12: "Q",
    13: "K",
    14: "A",
  };

  const suits = {
    s: "♠",
    h: "♥",
    d: "♦",
    c: "♣",
  };

  function apiBase() {
    return (cfg().apiBase || "").replace(/\/+$/, "");
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
  }

  function loadAuth() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.token = data.token;
      state.user = data.user;
    } catch {
      /* ignore */
    }
  }

  function saveAuth() {
    if (!state.token) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: state.token, user: state.user })
    );
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({ ok: false, error: "无效响应" }));
    return { res, data };
  }

  function showView(name) {
    $("viewAuth").classList.toggle("hidden", name !== "auth");
    $("viewLobby").classList.toggle("hidden", name !== "lobby");
    $("viewRoom").classList.toggle("hidden", name !== "room");
    $("userArea").classList.toggle("hidden", !state.user);
    if (state.user) {
      $("userLabel").textContent = `${state.user.nickname} (@${state.user.username})`;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function setAuthTab(tab) {
    document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.authTab === tab);
    });
    $("authLogin").classList.toggle("hidden", tab !== "login");
    $("authRegister").classList.toggle("hidden", tab !== "register");
    $("authError").textContent = "";
  }

  async function doLogin() {
    $("authError").textContent = "";
    const { data } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("loginUser").value.trim(),
        password: $("loginPass").value,
      }),
    });
    if (!data.ok) {
      $("authError").textContent = data.error || "登录失败";
      return;
    }
    state.token = data.token;
    state.user = data.user;
    saveAuth();
    showView("lobby");
    toast("登录成功");
  }

  async function doRegister() {
    $("authError").textContent = "";
    const { data } = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("regUser").value.trim(),
        password: $("regPass").value,
        nickname: $("regNick").value.trim(),
      }),
    });
    if (!data.ok) {
      $("authError").textContent = data.error || "注册失败";
      return;
    }
    state.token = data.token;
    state.user = data.user;
    saveAuth();
    showView("lobby");
    toast("注册成功");
  }

  async function doNickname() {
    const n = prompt("新昵称", state.user?.nickname || "");
    if (n == null) return;
    const { data } = await api("/api/nickname", {
      method: "POST",
      body: JSON.stringify({ nickname: n }),
    });
    if (!data.ok) {
      toast(data.error || "修改失败");
      return;
    }
    state.token = data.token;
    state.user = data.user;
    saveAuth();
    showView(state.roomCode ? "room" : "lobby");
    toast("昵称已更新");
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: "hello", token: state.token }));
    }
  }

  function logout() {
    closeWs();
    state.token = null;
    state.user = null;
    state.roomCode = null;
    state.table = null;
    saveAuth();
    showView("auth");
  }

  async function createRoom() {
    $("createError").textContent = "";
    const body = {
      maxPlayers: Number($("cfgMax").value),
      durationHours: Number($("cfgDuration").value),
      smallBlind: Number($("cfgSB").value),
      bigBlind: Number($("cfgBB").value),
      buyIn: Number($("cfgBuyIn").value),
      actionSeconds: Number($("cfgAction").value),
      allowRebuy: $("cfgRebuy").checked,
      rebuyCapByChipLeader: $("cfgRebuyCap").checked,
    };
    const { data } = await api("/api/rooms", { method: "POST", body: JSON.stringify(body) });
    if (!data.ok) {
      $("createError").textContent = data.error || "创建失败";
      return;
    }
    await enterRoom(data.code);
    toast(`房间 ${data.code} 已创建`);
  }

  async function joinRoom() {
    $("joinError").textContent = "";
    const code = $("joinCode").value.trim().toUpperCase();
    if (!code) {
      $("joinError").textContent = "请输入房间码";
      return;
    }
    const { data } = await api(`/api/rooms/${code}`);
    if (!data.ok) {
      $("joinError").textContent = data.error || "房间不存在";
      return;
    }
    await enterRoom(code);
  }

  function wsUrl(code) {
    const base = apiBase();
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = `/ws/${code}`;
    u.search = "";
    return u.toString();
  }

  function closeWs() {
    state.closingWs = true;
    if (state.ws) {
      try {
        state.ws.close();
      } catch {
        /* ignore */
      }
    }
    state.ws = null;
    if (state.timerIv) {
      clearInterval(state.timerIv);
      state.timerIv = null;
    }
  }

  async function enterRoom(code) {
    closeWs();
    state.closingWs = false;
    state.roomCode = code;
    state.table = null;
    showView("room");
    $("roomCodePill").textContent = `房间 ${code}`;
    $("settlementCard").classList.add("hidden");
    $("winnerLine").classList.add("hidden");

    const ws = new WebSocket(wsUrl(code));
    state.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", token: state.token }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "error") {
        toast(msg.message || "错误");
        return;
      }
      if (msg.type === "state") {
        state.table = msg.state;
        renderTable();
      }
    };
    ws.onclose = () => {
      if (!state.closingWs && state.roomCode === code) {
        toast("连接断开，请重新进入房间");
      }
    };
    ws.onerror = () => toast("WebSocket 连接失败");

    if (state.timerIv) clearInterval(state.timerIv);
    state.timerIv = setInterval(renderTimers, 250);
  }

  function send(type, extra = {}) {
    if (!state.ws || state.ws.readyState !== 1) {
      toast("未连接");
      return;
    }
    state.ws.send(JSON.stringify({ type, ...extra }));
  }

  function cardEl(card, lg = false) {
    const div = document.createElement("div");
    div.className = "playing-card" + (lg ? " lg" : "");
    if (!card) {
      div.classList.add("empty");
      return div;
    }
    if (card.s === "?" || !card.r) {
      div.classList.add("back");
      return div;
    }
    const rank = ranks[card.r] || String(card.r);
    div.textContent = `${rank}${suits[card.s] || card.s}`;
    if (card.s === "h") div.classList.add("red");
    if (card.s === "d") div.classList.add("diamond");
    if (card.s === "c") div.classList.add("club");
    if (card.s === "s") div.classList.add("spade");
    return div;
  }

  function seatPosition(i, n) {
    const angle = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
    const x = 50 + Math.cos(angle) * 40;
    const y = 50 + Math.sin(angle) * 34;
    return { left: `${x}%`, top: `${y}%` };
  }

  function renderTable() {
    const t = state.table;
    if (!t) return;

    const players = t.players || [];
    const me = players.find((p) => p.isYou);
    const actor = players.find((p) => p.seat === t.currentSeat);
    const isHost = t.hostId === state.user?.id;
    const inLobby = t.phase === "lobby";
    const between = t.phase === "between";
    const ended = t.phase === "ended";

    $("roomCodePill").textContent = `房间 ${t.code}`;
    $("phasePill").textContent = phaseMap[t.phase] || t.phase;
    $("potLabel").textContent = `底池 ${formatChips(t.pot || 0)}`;
    $("metaLine").textContent = t.handNumber
      ? `第 ${t.handNumber} 手 · 当前注额 ${formatChips(t.currentBet || 0)} · 最小加注 ${formatChips(t.minRaise || 0)}`
      : `盲注 ${formatChips(t.config.smallBlind)}/${formatChips(t.config.bigBlind)} · 买入 ${formatChips(t.config.buyIn)}`;
    $("statPlayers").textContent = `${players.length}/${t.config.maxPlayers}`;
    $("statBlinds").textContent = `${formatChips(t.config.smallBlind)}/${formatChips(t.config.bigBlind)}`;
    $("statBuyIn").textContent = formatChips(t.config.buyIn);
    $("statHand").textContent = String(t.handNumber || 0);

    renderCommunity(t);
    renderSeats(t);
    renderLog(t.log || []);
    renderWinner(t);

    $("lobbyActions").classList.toggle("hidden", ended);
    $("btnSit").classList.toggle("hidden", !inLobby || !!me);
    $("btnLeave").classList.toggle("hidden", !inLobby || !me);
    $("btnStart").classList.toggle("hidden", !inLobby || !isHost);
    $("btnStart").disabled = players.length < 2;
    $("btnRebuy").classList.toggle(
      "hidden",
      !(inLobby || between) || !me || !t.config.allowRebuy
    );
    $("btnEnd").classList.toggle("hidden", inLobby || ended || !isHost);
    $("lobbyHint").textContent = lobbyHint(t, me, actor);

    if (ended && t.settlement) {
      renderSettlement(t.settlement);
    } else {
      $("settlementCard").classList.add("hidden");
    }

    renderActions(t, me, actor);
    renderTimers();
  }

  function renderCommunity(t) {
    const community = $("community");
    community.innerHTML = "";
    const cards = t.community || [];
    for (let i = 0; i < 5; i++) {
      community.appendChild(cardEl(cards[i] || null, true));
    }
  }

  function renderSeats(t) {
    const seats = $("seats");
    seats.innerHTML = "";
    const players = t.players || [];
    const max = t.config.maxPlayers || 9;
    const bySeat = new Map(players.map((p) => [p.seat, p]));
    for (let i = 0; i < max; i++) {
      const p = bySeat.get(i);
      const el = document.createElement("div");
      const pos = seatPosition(i, max);
      el.style.left = pos.left;
      el.style.top = pos.top;

      if (!p) {
        el.className = "seat empty";
        el.textContent = `空位 ${i + 1}`;
        seats.appendChild(el);
        continue;
      }

      el.className = "seat";
      if (p.isYou) el.classList.add("you");
      if (t.currentSeat === p.seat) {
        el.classList.add("turn");
        el.style.setProperty("--progress", `${actionProgress(t)}%`);
      }
      if (p.folded) el.classList.add("folded");

      const tags = [];
      if (p.isHost) tags.push('<span class="tag host">房主</span>');
      if (t.buttonSeat === p.seat) tags.push('<span class="tag btn">D</span>');
      if (p.allIn) tags.push('<span class="tag allin">ALL-IN</span>');
      if (!p.connected) tags.push('<span class="tag offline">离线</span>');
      if (p.isYou) tags.push('<span class="tag">你</span>');

      const cards = document.createElement("div");
      cards.className = "cards";
      if (p.holeCards) {
        p.holeCards.forEach((card) => cards.appendChild(cardEl(card)));
      }

      el.innerHTML = `
        <div class="seat-head">
          <div class="seat-name">${escapeHtml(p.nickname)}</div>
        </div>
        <div class="seat-stack">${formatChips(p.stack)}</div>
        <div class="seat-bet">${p.betThisRound ? `下注 ${formatChips(p.betThisRound)}` : ""}</div>
        <div class="seat-tags">${tags.join("")}</div>
      `;
      el.appendChild(cards);
      seats.appendChild(el);
    }
  }

  function renderLog(log) {
    const el = $("log");
    if (!log.length) {
      el.innerHTML = '<div class="log-entry">等待牌局事件</div>';
      return;
    }
    el.innerHTML = log
      .slice(-24)
      .reverse()
      .map((entry) => `<div class="log-entry">${escapeHtml(entry)}</div>`)
      .join("");
  }

  function renderWinner(t) {
    const el = $("winnerLine");
    const winners = t.lastWinners || [];
    if (!winners.length || t.phase === "preflop" || t.phase === "flop" || t.phase === "turn" || t.phase === "river") {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    const players = t.players || [];
    const lines = winners.map((w) => {
      const names = (w.userIds || [])
        .map((id) => players.find((p) => p.id === id)?.nickname || "玩家")
        .join(" / ");
      return `${names} 赢 ${formatChips(w.amount)}${w.handName ? ` · ${w.handName}` : ""}`;
    });
    el.textContent = lines.join("；");
    el.classList.remove("hidden");
  }

  function renderActions(t, me, actor) {
    const activePlay = ["preflop", "flop", "turn", "river"].includes(t.phase);
    const hasLegal = activePlay && !!t.legal;
    $("playActions").classList.toggle("hidden", !hasLegal);
    if (!hasLegal) return;

    const L = t.legal;
    $("turnLabel").textContent = actor ? `轮到你行动 · ${phaseMap[t.phase]}` : "轮到你行动";
    $("toCallLabel").textContent = L.canCall ? `需跟注 ${formatChips(L.callAmount)}` : "可过牌";

    $("btnFold").disabled = !L.canFold;
    $("btnCheck").disabled = !L.canCheck;
    $("btnCheck").classList.toggle("hidden", !L.canCheck);
    $("btnCall").disabled = !L.canCall;
    $("btnCall").classList.toggle("hidden", !L.canCall);
    $("btnCall").textContent = L.canCall ? `跟注 ${formatChips(L.callAmount)}` : "跟注";
    $("btnAllIn").disabled = !L.canAllIn;

    const bounds = raiseBounds(t, me);
    const canRaise = !!L.canRaise && bounds.max > 0 && bounds.max >= bounds.min;
    $("btnRaise").disabled = !canRaise;
    $("quickBets").querySelectorAll("button").forEach((btn) => {
      btn.disabled = !canRaise;
    });

    const range = $("raiseRange");
    range.disabled = !canRaise;
    range.min = canRaise ? bounds.min : 0;
    range.max = canRaise ? bounds.max : 0;
    range.step = 1;
    if (canRaise) {
      const current = Number(range.value) || bounds.min;
      range.value = String(clamp(current, bounds.min, bounds.max));
      $("raiseAmt").textContent = formatChips(Number(range.value));
    } else {
      range.value = "0";
      $("raiseAmt").textContent = "--";
    }
  }

  function renderSettlement(rows) {
    $("settlementCard").classList.remove("hidden");
    const body = $("settlementBody");
    const html = [
      "<table><thead><tr><th>玩家</th><th>买入</th><th>离桌</th><th>净输赢</th></tr></thead><tbody>",
    ];
    for (const r of rows) {
      const cls = r.net > 0 ? "pos" : r.net < 0 ? "neg" : "";
      const sign = r.net > 0 ? "+" : "";
      html.push(
        `<tr><td>${escapeHtml(r.nickname)}</td><td>${formatChips(r.totalBuyIn)}</td><td>${formatChips(r.endingChips)}</td><td class="${cls}">${sign}${formatChips(r.net)}</td></tr>`
      );
    }
    html.push("</tbody></table>");
    body.innerHTML = html.join("");
  }

  function renderTimers() {
    const t = state.table;
    if (!t) return;
    const now = Date.now();
    const skew = t.serverNow ? t.serverNow - now : 0;
    const localNow = now + skew;

    $("sessionTimer").classList.remove("warn", "danger");
    if (t.endsAt) {
      const left = Math.max(0, t.endsAt - localNow);
      $("sessionTimer").textContent = `剩余 ${fmtMs(left)}`;
      $("sessionTimer").classList.toggle("warn", left < 5 * 60 * 1000);
      $("sessionTimer").classList.toggle("danger", left < 60 * 1000);
    } else {
      $("sessionTimer").textContent = `时长 ${t.config?.durationHours || "-"}h`;
    }

    $("actionTimer").classList.remove("danger");
    if (t.actionDeadline && t.currentSeat != null) {
      const left = Math.max(0, t.actionDeadline - localNow);
      const actor = (t.players || []).find((p) => p.seat === t.currentSeat);
      $("actionTimer").textContent = `${actor ? actor.nickname : "行动"} ${Math.ceil(left / 1000)}s`;
      $("actionTimer").classList.toggle("danger", left < 5000);
    } else {
      $("actionTimer").textContent = "行动 --";
    }

    const currentSeatEl = document.querySelector(".seat.turn");
    if (currentSeatEl) currentSeatEl.style.setProperty("--progress", `${actionProgress(t)}%`);
  }

  function actionProgress(t) {
    if (!t.actionDeadline || !t.config?.actionSeconds) return 0;
    const now = Date.now();
    const skew = t.serverNow ? t.serverNow - now : 0;
    const localNow = now + skew;
    const total = t.config.actionSeconds * 1000;
    const left = Math.max(0, t.actionDeadline - localNow);
    return clamp((left / total) * 100, 0, 100);
  }

  function lobbyHint(t, me, actor) {
    if (t.phase === "lobby") {
      if (!me) return `已入座 ${t.players.length}/${t.config.maxPlayers}`;
      if (t.players.length < 2) return "等待第二名玩家入座";
      if (t.hostId === state.user?.id) return "人数已满足，可以开局";
      return "等待房主开局";
    }
    if (t.phase === "between") return "手间可补码，系统会自动发下一手";
    if (actor) return `当前行动：${actor.nickname}`;
    return phaseMap[t.phase] || "";
  }

  function raiseBounds(t, me) {
    const L = t.legal || {};
    const max = Math.max(0, Number(L.maxRaiseTo) || 0);
    const min = Math.max(0, Number(L.minRaiseTo) || 0);
    return { min, max, me };
  }

  function quickBetAmount(kind) {
    const t = state.table;
    if (!t?.legal) return 0;
    const me = (t.players || []).find((p) => p.isYou);
    const bounds = raiseBounds(t, me);
    if (bounds.max < bounds.min) return bounds.max;
    const bb = Number(t.config?.bigBlind) || 1;
    const pot = Number(t.pot) || 0;
    let target = bounds.min;
    if (kind === "2.5bb") target = Math.ceil(bb * 2.5);
    if (kind === "half") target = (Number(t.currentBet) || 0) + Math.ceil(pot * 0.5);
    if (kind === "pot") target = (Number(t.currentBet) || 0) + pot;
    return clamp(Math.max(target, bounds.min), bounds.min, bounds.max);
  }

  function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function formatChips(n) {
    const value = Number(n) || 0;
    return value.toLocaleString("zh-CN");
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });
  $("btnLogin").addEventListener("click", doLogin);
  $("btnRegister").addEventListener("click", doRegister);
  $("btnLogout").addEventListener("click", logout);
  $("btnNick").addEventListener("click", doNickname);
  $("btnCreate").addEventListener("click", createRoom);
  $("btnJoin").addEventListener("click", joinRoom);
  $("btnSit").addEventListener("click", () => send("join"));
  $("btnLeave").addEventListener("click", () => send("leave"));
  $("btnStart").addEventListener("click", () => send("start"));
  $("btnEnd").addEventListener("click", () => {
    if (confirm("确认提前结束并结算？")) send("end");
  });
  $("btnRebuy").addEventListener("click", () => {
    const t = state.table;
    const def = t?.config?.buyIn || 1000;
    const raw = prompt(`补码数量（默认 ${def}）`, String(def));
    if (raw == null) return;
    send("rebuy", { amount: Number(raw) || def });
  });
  $("btnBackLobby").addEventListener("click", () => {
    closeWs();
    state.roomCode = null;
    state.table = null;
    showView("lobby");
  });
  $("btnSettlementDone").addEventListener("click", () => {
    closeWs();
    state.roomCode = null;
    state.table = null;
    showView("lobby");
  });
  $("btnCopyCode").addEventListener("click", async () => {
    const code = state.table?.code || state.roomCode || "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("房间码已复制");
    } catch {
      toast(`房间码：${code}`);
    }
  });
  $("btnFold").addEventListener("click", () => send("action", { action: "fold" }));
  $("btnCheck").addEventListener("click", () => send("action", { action: "check" }));
  $("btnCall").addEventListener("click", () => send("action", { action: "call" }));
  $("btnAllIn").addEventListener("click", () => send("action", { action: "allin" }));
  $("btnRaise").addEventListener("click", () => {
    send("action", { action: "raise", amount: Number($("raiseRange").value) });
  });
  $("raiseRange").addEventListener("input", () => {
    $("raiseAmt").textContent = formatChips(Number($("raiseRange").value));
  });
  $("quickBets").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-quick]");
    if (!btn || btn.disabled) return;
    const amount = quickBetAmount(btn.dataset.quick);
    if (!amount) return;
    $("raiseRange").value = String(amount);
    $("raiseAmt").textContent = formatChips(amount);
  });
  ["loginUser", "loginPass"].forEach((id) => {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") doLogin();
    });
  });
  ["regUser", "regPass", "regNick"].forEach((id) => {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") doRegister();
    });
  });
  $("joinCode").addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom();
  });

  loadAuth();
  if (state.token && state.user) {
    showView("lobby");
    api("/api/me").then(({ data }) => {
      if (!data.ok) logout();
      else {
        state.user = data.user;
        saveAuth();
        showView("lobby");
      }
    });
  } else {
    showView("auth");
  }
})();
