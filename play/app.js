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
    state.roomCode = code;
    showView("room");
    $("roomCodePill").textContent = `房间 ${code}`;
    $("settlementCard").classList.add("hidden");

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
      if (state.roomCode === code) toast("连接断开，请重新进入房间");
    };
    ws.onerror = () => toast("WebSocket 连接失败，检查 API 地址");

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
    if (!card || card.s === "?" || !card.r) {
      div.classList.add("back");
      div.textContent = "";
      return div;
    }
    const ranks = {
      11: "J",
      12: "Q",
      13: "K",
      14: "A",
    };
    const suits = { s: "♠", h: "♥", d: "♦", c: "♣" };
    const r = ranks[card.r] || String(card.r);
    const s = suits[card.s] || card.s;
    div.textContent = r + s;
    if (card.s === "h" || card.s === "d") div.classList.add("red");
    return div;
  }

  function seatPosition(i, n) {
    // place around ellipse
    const angle = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
    const x = 50 + Math.cos(angle) * 38;
    const y = 50 + Math.sin(angle) * 36;
    return { left: `${x}%`, top: `${y}%` };
  }

  function renderTable() {
    const t = state.table;
    if (!t) return;

    const phaseMap = {
      lobby: "大厅等待",
      preflop: "翻前",
      flop: "翻牌",
      turn: "转牌",
      river: "河牌",
      showdown: "摊牌",
      between: "手间",
      ended: "已结束",
    };
    $("phasePill").textContent = phaseMap[t.phase] || t.phase;
    $("potLabel").textContent = `底池 ${t.pot || 0}`;
    $("metaLine").textContent = t.handNumber
      ? `第 ${t.handNumber} 手 · 盲注 ${t.config.smallBlind}/${t.config.bigBlind}`
      : `盲注 ${t.config.smallBlind}/${t.config.bigBlind} · 买入 ${t.config.buyIn} · ${t.config.durationHours}h`;

    const community = $("community");
    community.innerHTML = "";
    (t.community || []).forEach((c) => community.appendChild(cardEl(c, true)));

    const seats = $("seats");
    seats.innerHTML = "";
    const players = t.players || [];
    // fixed 9 visual seats or maxPlayers
    const max = t.config.maxPlayers || 9;
    const bySeat = new Map(players.map((p) => [p.seat, p]));
    for (let i = 0; i < max; i++) {
      const p = bySeat.get(i);
      const el = document.createElement("div");
      el.className = "seat";
      const pos = seatPosition(i, max);
      el.style.left = pos.left;
      el.style.top = pos.top;
      if (!p) {
        el.innerHTML = `<div class="name">空位 #${i + 1}</div>`;
        seats.appendChild(el);
        continue;
      }
      if (p.isYou) el.classList.add("you");
      if (t.currentSeat === p.seat) el.classList.add("turn");
      if (p.folded) el.classList.add("folded");
      const tags = [];
      if (p.isHost) tags.push('<span class="tag host">房主</span>');
      if (t.buttonSeat === p.seat) tags.push('<span class="tag btn">D</span>');
      if (p.allIn) tags.push('<span class="tag allin">全下</span>');
      if (!p.connected) tags.push('<span class="tag">离线</span>');

      const cards = document.createElement("div");
      cards.className = "cards";
      if (p.holeCards) {
        p.holeCards.forEach((c) => cards.appendChild(cardEl(c)));
      }

      el.innerHTML = `
        <div class="name">${escapeHtml(p.nickname)}</div>
        <div class="stack">${p.stack}</div>
        <div class="bet">${p.betThisRound ? "注 " + p.betThisRound : ""}</div>
        <div class="tags">${tags.join("")}</div>
      `;
      el.appendChild(cards);
      seats.appendChild(el);
    }

    $("log").textContent = (t.log || []).join("\n");

    // lobby / host controls
    const me = players.find((p) => p.isYou);
    const isHost = t.hostId === state.user?.id;
    const inLobby = t.phase === "lobby";
    const between = t.phase === "between";
    const ended = t.phase === "ended";

    $("lobbyActions").classList.toggle("hidden", ended || (!inLobby && !between && t.phase !== "lobby"));
    if (!ended) {
      // show lobby actions in lobby/between; hide during active betting (use playActions)
      const activePlay = ["preflop", "flop", "turn", "river"].includes(t.phase);
      $("lobbyActions").classList.toggle("hidden", activePlay);
      $("playActions").classList.toggle("hidden", !activePlay || !t.legal);
    } else {
      $("lobbyActions").classList.add("hidden");
      $("playActions").classList.add("hidden");
    }

    $("btnSit").classList.toggle("hidden", !inLobby || !!me);
    $("btnStart").classList.toggle("hidden", !inLobby || !isHost);
    $("btnRebuy").classList.toggle(
      "hidden",
      !(inLobby || between) || !me || !t.config.allowRebuy
    );
    $("btnEnd").classList.toggle("hidden", inLobby || ended || !isHost);
    $("lobbyHint").textContent = inLobby
      ? `已入座 ${players.length}/${t.config.maxPlayers} · 至少 2 人后房主可开局 · 时间到自动结束`
      : between
        ? "手间可补码；即将发下一手"
        : "";

    // legal actions
    if (t.legal) {
      const L = t.legal;
      $("btnFold").disabled = !L.canFold;
      $("btnCheck").disabled = !L.canCheck;
      $("btnCheck").classList.toggle("hidden", !L.canCheck);
      $("btnCall").disabled = !L.canCall;
      $("btnCall").classList.toggle("hidden", !L.canCall);
      $("btnCall").textContent = L.canCall ? `跟注 ${L.callAmount}` : "跟注";
      $("btnAllIn").disabled = !L.canAllIn;
      $("btnRaise").disabled = !L.canRaise;
      const min = L.minRaiseTo || 0;
      const max = L.maxRaiseTo || 0;
      const range = $("raiseRange");
      range.min = min;
      range.max = Math.max(min, max);
      range.value = Math.min(Math.max(Number(range.value) || min, min), max);
      $("raiseAmt").textContent = range.value;
    }

    if (ended && t.settlement) {
      renderSettlement(t.settlement);
    }

    renderTimers();
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
        `<tr><td>${escapeHtml(r.nickname)}</td><td>${r.totalBuyIn}</td><td>${r.endingChips}</td><td class="${cls}">${sign}${r.net}</td></tr>`
      );
    }
    html.push("</tbody></table>");
    body.innerHTML = html.join("");
  }

  function renderTimers() {
    const t = state.table;
    if (!t) return;
    const now = Date.now();
    // sync skew using serverNow if present
    const skew = t.serverNow ? t.serverNow - now : 0;
    const localNow = now + skew;

    if (t.endsAt) {
      const left = Math.max(0, t.endsAt - localNow);
      $("sessionTimer").textContent = `剩余 ${fmtMs(left)}`;
      $("sessionTimer").classList.toggle("warn", left < 5 * 60 * 1000);
      $("sessionTimer").classList.toggle("danger", left < 60 * 1000);
    } else {
      $("sessionTimer").textContent = `时长 ${t.config?.durationHours || "-"}h`;
      $("sessionTimer").classList.remove("warn", "danger");
    }

    if (t.actionDeadline && t.currentSeat != null) {
      const left = Math.max(0, t.actionDeadline - localNow);
      $("actionTimer").textContent = `行动 ${Math.ceil(left / 1000)}s`;
      $("actionTimer").classList.toggle("danger", left < 5000);
    } else {
      $("actionTimer").textContent = "行动 --";
      $("actionTimer").classList.remove("danger");
    }
  }

  function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Events
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
  $("btnFold").addEventListener("click", () => send("action", { action: "fold" }));
  $("btnCheck").addEventListener("click", () => send("action", { action: "check" }));
  $("btnCall").addEventListener("click", () => send("action", { action: "call" }));
  $("btnAllIn").addEventListener("click", () => send("action", { action: "allin" }));
  $("btnRaise").addEventListener("click", () => {
    send("action", { action: "raise", amount: Number($("raiseRange").value) });
  });
  $("raiseRange").addEventListener("input", () => {
    $("raiseAmt").textContent = $("raiseRange").value;
  });
  $("btnSetApi").addEventListener("click", (e) => {
    e.preventDefault();
    const next = prompt("Worker API 地址", apiBase());
    if (!next) return;
    localStorage.setItem("PLAY_API_BASE", next.replace(/\/+$/, ""));
    window.PLAY_CONFIG.apiBase = next.replace(/\/+$/, "");
    $("apiBaseLabel").textContent = apiBase();
    toast("API 已更新，请重新登录/进房");
  });

  // boot
  $("apiBaseLabel").textContent = apiBase();
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
