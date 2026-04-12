// ====== In-Game Tournament Mode ======
let inGameState = {
  active: false,
  paused: false,
  currentLevel: 0,        // 0-based index
  levelTimeRemaining: 0,  // seconds
  blindDuration: 20,      // minutes per level
  levels: [],             // blind levels array
  rebuyEarlyLevels: 3,
  rebuyEarlyMax: 2,
  thinkTimeNormal: 20,
  thinkTimeAllin: 40,
  players: [],            // participating players
  playerData: {},         // { name: { rebuys: 0, eliminated: false, eliminateTime: null } }
  eliminatedOrder: [],    // names in elimination order
  thinkingTimer: null,
  thinkingSeconds: 0,
  thinkingType: null,     // 'normal' or 'allin'
  blindTimerInterval: null,
  thinkingTimerInterval: null
};

// Simple sound using Web Audio API
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(type = 'short') {
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'short') {
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } else if (type === 'long') {
      oscillator.frequency.value = 600;
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } else if (type === 'triple') {
      // Three short beeps for timeout
      const now = audioContext.currentTime;
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.setValueAtTime(0.01, now + 0.15);
      gainNode.gain.setValueAtTime(0.3, now + 0.2);
      gainNode.gain.setValueAtTime(0.01, now + 0.35);
      gainNode.gain.setValueAtTime(0.3, now + 0.4);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
      oscillator.start(now);
      oscillator.stop(now + 0.55);
    }
  } catch (e) {
    console.log('Audio not available:', e);
  }
}

function startInGameMode() {
  const participants = Array.from(selectedPlayers);
  if (participants.length < 2) {
    showToast('至少需要2名参赛玩家');
    return;
  }

  // Resolve tournament settings from a single source (template/custom/default fallback)
  const activeConfig = getActiveTournamentConfig();
  const levels = cloneTournamentLevels(activeConfig.levels);
  const blindDuration = activeConfig.blindDuration;
  const rebuyEarlyLevels = activeConfig.rebuyEarlyLevels;
  const rebuyEarlyMax = activeConfig.rebuyEarlyMax;
  const thinkTimeNormal = activeConfig.thinkTimeNormal;
  const thinkTimeAllin = activeConfig.thinkTimeAllin;

  // Initialize game state
  inGameState = {
    active: true,
    paused: false,
    currentLevel: 0,
    levelTimeRemaining: blindDuration * 60, // convert to seconds
    blindDuration: blindDuration,
    levels: levels,
    rebuyEarlyLevels: rebuyEarlyLevels,
    rebuyEarlyMax: rebuyEarlyMax,
    thinkTimeNormal: thinkTimeNormal,
    thinkTimeAllin: thinkTimeAllin,
    players: participants,
    playerData: {},
    eliminatedOrder: [],
    thinkingTimer: null,
    thinkingSeconds: 0,
    thinkingType: null,
    blindTimerInterval: null,
    thinkingTimerInterval: null
  };

  // Initialize player data
  participants.forEach(name => {
    inGameState.playerData[name] = { rebuys: 0, eliminated: false, eliminateTime: null };
  });

  // Switch UI
  document.getElementById('tournament-mode').style.display = 'none';
  document.getElementById('ingame-mode').style.display = '';

  // Resume audio context (browsers require user interaction)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // Start the blind timer
  startBlindTimer();
  renderInGamePlayers();
  updateThinkingTimerButtons();
  updateInGameDisplay();
  showToast('对局开始！');
}

function endInGameMode() {
  if (!confirm('确定要结束对局吗？将进入排名录入页面。')) return;

  // Stop all timers
  stopBlindTimer();
  stopThinkingTimer();

  // Switch UI back
  document.getElementById('ingame-mode').style.display = 'none';
  document.getElementById('tournament-mode').style.display = '';
  document.getElementById('rankings-card').style.display = '';

  // Generate rankings based on elimination order
  generateRankingsFromElimination();

  inGameState.active = false;
  showToast('对局结束，请确认排名');
}

function getUniqueInGamePlayers() {
  const used = new Set();
  const uniquePlayers = [];
  (inGameState.players || []).forEach(name => {
    if (!name || used.has(name)) return;
    used.add(name);
    uniquePlayers.push(name);
  });
  return uniquePlayers;
}

function buildRankingsFromElimination() {
  const participants = getUniqueInGamePlayers();
  const participantSet = new Set(participants);
  const eliminatedOrder = Array.isArray(inGameState.eliminatedOrder)
    ? inGameState.eliminatedOrder
    : [];

  const dedupedEliminated = [];
  const eliminatedSet = new Set();
  let hadDataIssue = false;

  eliminatedOrder.forEach(name => {
    if (!participantSet.has(name)) {
      hadDataIssue = true;
      return;
    }
    if (eliminatedSet.has(name)) {
      hadDataIssue = true;
      return;
    }
    eliminatedSet.add(name);
    dedupedEliminated.push(name);
  });

  // If playerData says a player was eliminated but elimination order missed it, append by elimination time.
  const missingEliminated = participants.filter(name => {
    const pd = inGameState.playerData[name];
    return pd && pd.eliminated && !eliminatedSet.has(name);
  });
  if (missingEliminated.length > 0) {
    hadDataIssue = true;
    missingEliminated.sort((a, b) => {
      const aTime = (inGameState.playerData[a] && inGameState.playerData[a].eliminateTime) || '';
      const bTime = (inGameState.playerData[b] && inGameState.playerData[b].eliminateTime) || '';
      return aTime.localeCompare(bTime);
    });
    missingEliminated.forEach(name => {
      eliminatedSet.add(name);
      dedupedEliminated.push(name);
    });
  }

  const remaining = participants.filter(name => !eliminatedSet.has(name));
  const rankings = [];
  let nextPlace = 1;

  // Early finish: all remaining players share the best available place.
  if (remaining.length > 0) {
    rankings.push({ place: 1, players: remaining });
    nextPlace += remaining.length;
  }

  // Assign eliminated players from latest elimination to earliest elimination.
  for (let i = dedupedEliminated.length - 1; i >= 0;) {
    const currentPlayer = dedupedEliminated[i];
    const currentTime = inGameState.playerData[currentPlayer] && inGameState.playerData[currentPlayer].eliminateTime;
    const currentBucket = currentTime ? String(currentTime).slice(0, 19) : '';
    const tiePlayers = [currentPlayer];
    i--;

    // If two eliminations happened in the same second, treat as tie.
    while (i >= 0 && currentBucket) {
      const candidate = dedupedEliminated[i];
      const candidateTime = inGameState.playerData[candidate] && inGameState.playerData[candidate].eliminateTime;
      const candidateBucket = candidateTime ? String(candidateTime).slice(0, 19) : '';
      if (candidateBucket !== currentBucket) break;
      tiePlayers.push(candidate);
      i--;
    }

    rankings.push({ place: nextPlace, players: tiePlayers });
    nextPlace += tiePlayers.length;
  }

  rankings.sort((a, b) => a.place - b.place);
  return { rankings, hadDataIssue };
}

function generateRankingsFromElimination() {
  const { rankings, hadDataIssue } = buildRankingsFromElimination();

  if (typeof applyRankingsToTop3 === 'function') {
    applyRankingsToTop3(rankings);
  } else {
    updateRankSelects();
    rankings.filter(r => r.place <= 3).forEach(r => {
      const container = document.getElementById(`rank${r.place}-selects`);
      if (!container) return;
      const select = container.querySelector('select');
      if (select && r.players[0]) {
        select.value = r.players[0];
      }
    });
  }

  // Hide start game button
  const startBtn = document.getElementById('start-game-btn');
  if (startBtn) startBtn.style.display = 'none';

  // Update preview with all rankings
  updatePreviewWithRankings(rankings);

  if (hadDataIssue) {
    showToast('检测到重复或异常淘汰记录，排名已自动修正');
  }
}

function updatePreviewWithRankings(rankings) {
  const previewCard = document.getElementById('preview-card');
  const saveBtn = document.getElementById('save-btn');
  if (!previewCard || !saveBtn) return;

  previewCard.style.display = '';
  saveBtn.style.display = '';

  const preview = document.getElementById('score-preview');
  preview.innerHTML = '';

  const participants = getUniqueInGamePlayers();
  const scoresMap = calcScores(participants, rankings, data.scoringRule);

  rankings.forEach(r => {
    const medal = r.place + '.';
    r.players.forEach(player => {
      const row = document.createElement('div');
      row.className = 'score-row';
      const score = scoresMap[player] || 0;
      row.innerHTML = `
        <span class="score-rank">${medal}</span>
        <span class="score-name">${player}</span>
        <span class="score-pts">${score.toFixed(2)}</span>
      `;
      preview.appendChild(row);
    });
  });
}

function startBlindTimer() {
  if (inGameState.blindTimerInterval) clearInterval(inGameState.blindTimerInterval);

  inGameState.blindTimerInterval = setInterval(() => {
    if (inGameState.paused) return;

    inGameState.levelTimeRemaining--;
    updateInGameDisplay();

    if (inGameState.levelTimeRemaining <= 0) {
      // Level up!
      nextBlindLevel();
    }
  }, 1000);
}

function stopBlindTimer() {
  if (inGameState.blindTimerInterval) {
    clearInterval(inGameState.blindTimerInterval);
    inGameState.blindTimerInterval = null;
  }
}

function nextBlindLevel() {
  inGameState.currentLevel++;

  // Check if we have more levels
  if (inGameState.currentLevel >= inGameState.levels.length) {
    // Repeat the last level indefinitely
    inGameState.currentLevel = inGameState.levels.length - 1;
  }

  inGameState.levelTimeRemaining = inGameState.blindDuration * 60;
  playBeep('long');

  const level = inGameState.levels[inGameState.currentLevel];
  const sb = level.sb;
  const bb = level.bb;
  const ante = level.ante || 0;

  alert(`升盲\n\n当前级别：第 ${inGameState.currentLevel + 1} 级\n盲注：${sb}/${bb}${ante ? ' + Ante ' + ante : ''}`);
  updateInGameDisplay();
  renderInGamePlayers();
}

function updateInGameDisplay() {
  const minutes = Math.floor(inGameState.levelTimeRemaining / 60);
  const seconds = inGameState.levelTimeRemaining % 60;
  const timerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('ingame-timer').textContent = timerText;

  const level = inGameState.levels[inGameState.currentLevel];
  document.getElementById('ingame-level-display').textContent = `第 ${inGameState.currentLevel + 1} 级`;
  document.getElementById('ingame-blind-display').textContent = `${level.sb} / ${level.bb}`;
  if (level.ante) {
    document.getElementById('ingame-ante-display').textContent = `Ante: ${level.ante}`;
  } else {
    document.getElementById('ingame-ante-display').textContent = '';
  }
}

function toggleInGamePause() {
  inGameState.paused = !inGameState.paused;
  const btn = document.getElementById('ingame-pause-btn');
  const overlay = document.getElementById('ingame-paused-overlay');

  if (inGameState.paused) {
    btn.textContent = '继续';
    overlay.style.display = 'flex';
  } else {
    btn.textContent = '暂停';
    overlay.style.display = 'none';
  }
}

function updateThinkingTimerButtons() {
  const normalBtn = document.querySelector('#ingame-mode button[onclick="startThinkingTimer(\'normal\')"]');
  const allinBtn = document.querySelector('#ingame-mode button[onclick="startThinkingTimer(\'allin\')"]');
  if (normalBtn) {
    normalBtn.textContent = `正常思考 ${inGameState.thinkTimeNormal}s`;
  }
  if (allinBtn) {
    allinBtn.textContent = `All-in ${inGameState.thinkTimeAllin}s`;
  }
}

function startThinkingTimer(type) {
  stopThinkingTimer(); // Clear any existing timer

  const duration = type === 'normal' ? inGameState.thinkTimeNormal : inGameState.thinkTimeAllin;
  inGameState.thinkingType = type;
  inGameState.thinkingSeconds = duration;

  const timerEl = document.getElementById('thinking-timer');
  const labelEl = document.getElementById('thinking-timer-label');

  labelEl.textContent = type === 'normal' ? '正常思考' : 'All-in 思考';
  timerEl.textContent = String(inGameState.thinkingSeconds);
  timerEl.classList.remove('thinking-timer-warning');

  inGameState.thinkingTimerInterval = setInterval(() => {
    if (inGameState.paused) return;

    inGameState.thinkingSeconds--;
    timerEl.textContent = String(inGameState.thinkingSeconds);

    // Warning when 5 seconds left
    if (inGameState.thinkingSeconds <= 5) {
      timerEl.classList.add('thinking-timer-warning');
      if (inGameState.thinkingSeconds > 0) {
        playBeep('short');
      }
    }

    if (inGameState.thinkingSeconds <= 0) {
      stopThinkingTimer();
      playBeep('triple');
      alert('思考时间到');
    }
  }, 1000);
}

function stopThinkingTimer() {
  if (inGameState.thinkingTimerInterval) {
    clearInterval(inGameState.thinkingTimerInterval);
    inGameState.thinkingTimerInterval = null;
  }
  const timerEl = document.getElementById('thinking-timer');
  const labelEl = document.getElementById('thinking-timer-label');
  timerEl.textContent = '--';
  timerEl.classList.remove('thinking-timer-warning');
  labelEl.textContent = '点击上方按钮开始';
}

function getRebuyValidation(name) {
  const pd = inGameState.playerData[name];
  if (!pd) {
    return { canRebuy: false, message: '玩家不存在' };
  }
  if (pd.eliminated) {
    return { canRebuy: false, message: `${name} 已淘汰，不能补码` };
  }
  if (inGameState.rebuyEarlyLevels <= 0 || inGameState.rebuyEarlyMax <= 0) {
    return { canRebuy: false, message: '当前对局设置不允许补码' };
  }
  if (inGameState.currentLevel >= inGameState.rebuyEarlyLevels) {
    return {
      canRebuy: false,
      message: `第${inGameState.currentLevel + 1}级已超过补码期限（前${inGameState.rebuyEarlyLevels}级可补）`
    };
  }
  if (pd.rebuys >= inGameState.rebuyEarlyMax) {
    return {
      canRebuy: false,
      message: `${name} 已达到补码上限（${inGameState.rebuyEarlyMax}手）`
    };
  }
  return { canRebuy: true, message: '' };
}

function renderInGamePlayers() {
  const container = document.getElementById('ingame-players-list');
  container.innerHTML = '';

  getUniqueInGamePlayers().forEach(name => {
    const pd = inGameState.playerData[name];
    const row = document.createElement('div');
    row.className = 'ingame-player-row';

    const nameClass = pd.eliminated ? 'ingame-player-name eliminated' : 'ingame-player-name';
    const eliminateBtnClass = pd.eliminated ? 'ingame-eliminate-btn eliminated' : 'ingame-eliminate-btn';
    const eliminateBtnText = pd.eliminated ? '已淘汰' : '淘汰';
    const eliminateDisabled = pd.eliminated ? 'disabled' : '';

    const rebuyValidation = getRebuyValidation(name);
    const rebuyDisabledAttr = rebuyValidation.canRebuy ? '' : 'disabled';
    const rebuyOpacity = rebuyValidation.canRebuy ? '' : 'style="opacity:0.3"';
    const rebuyTitle = rebuyValidation.message.replace(/"/g, '&quot;');
    const rebuyTitleAttr = rebuyValidation.canRebuy ? '' : `title="${rebuyTitle}"`;

    row.innerHTML = `
      <span class="${nameClass}">${name}</span>
      <button class="ingame-rebuy-btn" onclick="ingameAddRebuy('${name.replace(/'/g, "\\'")}')"
        ${rebuyDisabledAttr} ${rebuyOpacity} ${rebuyTitleAttr}>+</button>
      <span class="ingame-rebuy-count">${pd.rebuys}/${inGameState.rebuyEarlyMax}</span>
      <button class="${eliminateBtnClass}" onclick="ingameEliminate('${name.replace(/'/g, "\\'")}')"
        ${eliminateDisabled}>${eliminateBtnText}</button>
    `;
    container.appendChild(row);
  });

  // Add rebuy summary at the bottom
  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:16px;padding-top:12px;border-top:1px solid var(--border);';
  summary.innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">补码汇总</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
  `;

  getUniqueInGamePlayers().forEach(name => {
    const pd = inGameState.playerData[name];
    const nameSpan = pd.eliminated ? `<s style="color:var(--text2);">${name}</s>` : name;
    summary.innerHTML += `
      <div style="font-size:13px;">
        ${nameSpan}: <span style="color:${pd.rebuys > 0 ? 'var(--accent)' : 'var(--text2)'}">${pd.rebuys}手</span>
      </div>
    `;
  });

  summary.innerHTML += '</div>';
  container.appendChild(summary);
}

function ingameAddRebuy(name) {
  const validation = getRebuyValidation(name);
  if (!validation.canRebuy) {
    showToast(validation.message);
    return;
  }

  const pd = inGameState.playerData[name];
  pd.rebuys++;
  renderInGamePlayers();
  showToast(`${name} 补码 1 手`);
}

function ingameEliminate(name) {
  const pd = inGameState.playerData[name];
  if (pd && !pd.eliminated) {
    if (confirm(`确定淘汰 ${name} 吗？`)) {
      pd.eliminated = true;
      pd.eliminateTime = new Date().toISOString();
      if (!inGameState.eliminatedOrder.includes(name)) {
        inGameState.eliminatedOrder.push(name);
      }
      renderInGamePlayers();

      // Check if only one player remains
      const remainingPlayers = getUniqueInGamePlayers().filter(p => !inGameState.playerData[p].eliminated);
      if (remainingPlayers.length === 1) {
        // Auto-end the game
        setTimeout(() => {
          alert(`${remainingPlayers[0]} 获得冠军`);
          autoEndInGameMode();
        }, 100);
      } else {
        showToast(`${name} 已淘汰`);
      }
    }
  }
}

function autoEndInGameMode() {
  // Stop all timers
  stopBlindTimer();
  stopThinkingTimer();

  // Switch UI back
  document.getElementById('ingame-mode').style.display = 'none';
  document.getElementById('tournament-mode').style.display = '';
  document.getElementById('rankings-card').style.display = '';

  // Generate rankings based on elimination order
  generateRankingsFromElimination();

  inGameState.active = false;
  showToast('对局结束，请确认排名');
}
