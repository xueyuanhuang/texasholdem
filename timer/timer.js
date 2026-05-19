const TIMER_CONFIG_KEY = 'texasholdem_timer_config_v1';

const TEMPLATES = [
  {
    id: 'standard',
    name: '标准局',
    levels: [
      { minutes: 20, sb: 25, bb: 50, ante: 0 },
      { minutes: 20, sb: 50, bb: 100, ante: 0 },
      { minutes: 20, sb: 100, bb: 200, ante: 0 },
      { minutes: 20, sb: 150, bb: 300, ante: 0 },
      { minutes: 20, sb: 200, bb: 400, ante: 0 },
      { minutes: 20, sb: 300, bb: 600, ante: 50 },
      { minutes: 20, sb: 400, bb: 800, ante: 75 },
      { minutes: 20, sb: 500, bb: 1000, ante: 100 }
    ]
  },
  {
    id: 'turbo',
    name: '快速局',
    levels: [
      { minutes: 12, sb: 25, bb: 50, ante: 0 },
      { minutes: 12, sb: 50, bb: 100, ante: 0 },
      { minutes: 12, sb: 100, bb: 200, ante: 25 },
      { minutes: 12, sb: 200, bb: 400, ante: 50 },
      { minutes: 12, sb: 300, bb: 600, ante: 75 },
      { minutes: 12, sb: 500, bb: 1000, ante: 100 }
    ]
  }
];

let timerConfig = loadTimerConfig();
let activeTemplateId = timerConfig.templateId || TEMPLATES[0].id;
let clockState = {
  levelIndex: 0,
  remainingSeconds: getLevelDurationSeconds(timerConfig.levels[0]),
  running: false,
  intervalId: null,
  ended: false
};
let audioContext = null;

const setupView = document.getElementById('setup-view');
const clockView = document.getElementById('clock-view');
const templateButtons = document.getElementById('template-buttons');
const levelList = document.getElementById('level-list');
const levelCountLabel = document.getElementById('level-count-label');
const setupStatus = document.getElementById('setup-status');
const clockStatus = document.getElementById('clock-status');
const countdown = document.getElementById('countdown');
const progressFill = document.getElementById('progress-fill');
const clockLevelNumber = document.getElementById('clock-level-number');
const clockStateLabel = document.getElementById('clock-state-label');
const currentBlinds = document.getElementById('current-blinds');
const currentAnte = document.getElementById('current-ante');
const nextBlinds = document.getElementById('next-blinds');
const nextAnte = document.getElementById('next-ante');
const toggleClockBtn = document.getElementById('toggle-clock-btn');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadTimerConfig() {
  const fallback = {
    templateId: TEMPLATES[0].id,
    levels: clone(TEMPLATES[0].levels)
  };

  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_CONFIG_KEY) || 'null');
    if (!saved || !Array.isArray(saved.levels)) return fallback;
    const normalized = normalizeLevels(saved.levels);
    if (normalized.length === 0) return fallback;
    return {
      templateId: saved.templateId || 'custom',
      levels: normalized
    };
  } catch {
    return fallback;
  }
}

function saveTimerConfig() {
  localStorage.setItem(TIMER_CONFIG_KEY, JSON.stringify(timerConfig));
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizeLevels(levels) {
  return levels.map(level => ({
    minutes: normalizeNumber(level.minutes, 0),
    sb: normalizeNumber(level.sb, 0),
    bb: normalizeNumber(level.bb, 0),
    ante: normalizeNumber(level.ante, 0)
  }));
}

function getLevelDurationSeconds(level) {
  return Math.max(1, normalizeNumber(level?.minutes, 1)) * 60;
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatBlinds(level) {
  if (!level) return '无';
  return `${level.sb.toLocaleString()} / ${level.bb.toLocaleString()}`;
}

function formatAnte(level) {
  if (!level) return '无下一盲注';
  return level.ante > 0 ? `Ante ${level.ante.toLocaleString()}` : '无 Ante';
}

function setStatus(target, message, tone = '') {
  target.textContent = message || '';
  target.className = `status-line${tone ? ` ${tone}` : ''}`;
}

function validateConfig() {
  if (!Array.isArray(timerConfig.levels) || timerConfig.levels.length === 0) {
    return '至少需要 1 个盲注级别';
  }

  for (let i = 0; i < timerConfig.levels.length; i++) {
    const level = timerConfig.levels[i];
    if (!Number.isSafeInteger(level.minutes) || level.minutes <= 0) {
      return `第 ${i + 1} 级时间必须是正整数`;
    }
    if (!Number.isSafeInteger(level.sb) || level.sb <= 0) {
      return `第 ${i + 1} 级小盲必须是正整数`;
    }
    if (!Number.isSafeInteger(level.bb) || level.bb < level.sb) {
      return `第 ${i + 1} 级大盲不能小于小盲`;
    }
    if (!Number.isSafeInteger(level.ante) || level.ante < 0) {
      return `第 ${i + 1} 级 Ante 必须是非负整数`;
    }
  }

  return '';
}

function renderTemplateButtons() {
  templateButtons.innerHTML = '';
  TEMPLATES.forEach(template => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `template-btn${activeTemplateId === template.id ? ' active' : ''}`;
    button.dataset.templateId = template.id;

    const name = document.createElement('span');
    name.className = 'template-name';
    name.textContent = template.name;

    const meta = document.createElement('span');
    meta.className = 'template-meta';
    meta.textContent = `${template.levels.length} 级 · ${template.levels[0].minutes} 分钟/级`;

    button.append(name, meta);
    button.addEventListener('click', () => applyTemplate(template.id));
    templateButtons.appendChild(button);
  });
}

function renderLevels() {
  levelList.innerHTML = '';
  levelCountLabel.textContent = `${timerConfig.levels.length} 个级别`;

  timerConfig.levels.forEach((level, index) => {
    const row = document.createElement('div');
    row.className = 'level-row';

    const label = document.createElement('div');
    label.className = 'level-index';
    label.textContent = `L${index + 1}`;

    const minutes = createLevelField('分钟', 'field-minutes', level.minutes, value => updateLevel(index, 'minutes', value));
    const sb = createLevelField('小盲', 'field-sb', level.sb, value => updateLevel(index, 'sb', value));
    const bb = createLevelField('大盲', 'field-bb', level.bb, value => updateLevel(index, 'bb', value));
    const ante = createLevelField('Ante', 'field-ante', level.ante, value => updateLevel(index, 'ante', value));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-level-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除第 ${index + 1} 级`);
    remove.addEventListener('click', () => removeLevel(index));

    row.append(label, minutes, sb, bb, ante, remove);
    levelList.appendChild(row);
  });
}

function createLevelField(labelText, fieldClass, value, onChange) {
  const field = document.createElement('label');
  field.className = `level-field ${fieldClass}`;

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'level-input';
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.step = '1';
  input.placeholder = labelText;
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  input.addEventListener('change', () => onChange(input.value));
  input.addEventListener('focus', () => input.select());

  field.append(label, input);
  return field;
}

function updateLevel(index, field, value) {
  const nextValue = normalizeNumber(value, field === 'ante' ? 0 : 1);
  timerConfig.levels[index][field] = nextValue;
  activeTemplateId = 'custom';
  timerConfig.templateId = 'custom';
  saveTimerConfig();
  renderTemplateButtons();
  const validation = validateConfig();
  setStatus(setupStatus, validation || '已保存当前设置', validation ? 'warn' : 'ok');
}

function addLevel() {
  const last = timerConfig.levels[timerConfig.levels.length - 1] || { minutes: 20, sb: 25, bb: 50, ante: 0 };
  timerConfig.levels.push({
    minutes: last.minutes,
    sb: last.bb,
    bb: last.bb * 2,
    ante: last.ante
  });
  activeTemplateId = 'custom';
  timerConfig.templateId = 'custom';
  saveTimerConfig();
  renderAllSetup();
}

function removeLevel(index) {
  if (timerConfig.levels.length <= 1) {
    setStatus(setupStatus, '至少保留 1 个级别', 'warn');
    return;
  }
  timerConfig.levels.splice(index, 1);
  activeTemplateId = 'custom';
  timerConfig.templateId = 'custom';
  saveTimerConfig();
  renderAllSetup();
}

function applyTemplate(templateId) {
  const template = TEMPLATES.find(item => item.id === templateId);
  if (!template) return;
  activeTemplateId = template.id;
  timerConfig = {
    templateId: template.id,
    levels: clone(template.levels)
  };
  saveTimerConfig();
  setStatus(setupStatus, `已载入${template.name}`, 'ok');
  renderAllSetup();
}

function resetActiveTemplate() {
  const templateId = activeTemplateId === 'custom' ? TEMPLATES[0].id : activeTemplateId;
  applyTemplate(templateId);
}

function renderAllSetup() {
  renderTemplateButtons();
  renderLevels();
}

function enterClock() {
  const validation = validateConfig();
  if (validation) {
    setStatus(setupStatus, validation, 'warn');
    return;
  }

  saveTimerConfig();
  clockState.levelIndex = 0;
  clockState.remainingSeconds = getLevelDurationSeconds(timerConfig.levels[0]);
  clockState.running = false;
  clockState.ended = false;
  setupView.classList.remove('active');
  clockView.classList.add('active');
  renderClock();
  startClock();
}

function enterSetup() {
  stopClock();
  clockView.classList.remove('active');
  setupView.classList.add('active');
  setStatus(setupStatus, '', '');
}

function getCurrentLevel() {
  return timerConfig.levels[clockState.levelIndex];
}

function getNextLevel() {
  return timerConfig.levels[clockState.levelIndex + 1] || null;
}

function renderClock() {
  const current = getCurrentLevel();
  const next = getNextLevel();
  const duration = getLevelDurationSeconds(current);
  const progress = duration > 0 ? (clockState.remainingSeconds / duration) * 100 : 0;

  clockLevelNumber.textContent = String(clockState.levelIndex + 1);
  countdown.textContent = formatClock(clockState.remainingSeconds);
  progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  currentBlinds.textContent = formatBlinds(current);
  currentAnte.textContent = formatAnte(current);
  nextBlinds.textContent = next ? formatBlinds(next) : '最后一级';
  nextAnte.textContent = next ? formatAnte(next) : '无下一盲注';

  toggleClockBtn.textContent = clockState.running ? '暂停' : '开始';
  if (clockState.ended) {
    clockStateLabel.textContent = '最后一级结束';
  } else {
    clockStateLabel.textContent = clockState.running ? '计时中' : '已暂停';
  }
}

function startClock() {
  if (clockState.running || clockState.ended) return;
  ensureAudioContext();
  clockState.running = true;
  clockState.intervalId = window.setInterval(tickClock, 1000);
  setStatus(clockStatus, '', '');
  renderClock();
}

function stopClock() {
  if (clockState.intervalId) {
    window.clearInterval(clockState.intervalId);
    clockState.intervalId = null;
  }
  clockState.running = false;
  renderClock();
}

function toggleClock() {
  if (clockState.running) {
    stopClock();
    return;
  }
  if (clockState.ended) {
    resetCurrentLevel();
  }
  startClock();
}

function tickClock() {
  clockState.remainingSeconds -= 1;
  if (clockState.remainingSeconds <= 0) {
    handleLevelComplete();
    return;
  }
  renderClock();
}

function handleLevelComplete() {
  playBeep();
  if (clockState.levelIndex < timerConfig.levels.length - 1) {
    clockState.levelIndex += 1;
    clockState.remainingSeconds = getLevelDurationSeconds(getCurrentLevel());
    setStatus(clockStatus, `进入第 ${clockState.levelIndex + 1} 级`, 'ok');
    renderClock();
    return;
  }

  stopClock();
  clockState.remainingSeconds = 0;
  clockState.ended = true;
  setStatus(clockStatus, '最后一级已结束', 'ok');
  renderClock();
}

function resetCurrentLevel() {
  clockState.remainingSeconds = getLevelDurationSeconds(getCurrentLevel());
  clockState.ended = false;
  setStatus(clockStatus, '', '');
  renderClock();
}

function goToLevel(index) {
  const nextIndex = Math.max(0, Math.min(timerConfig.levels.length - 1, index));
  clockState.levelIndex = nextIndex;
  clockState.remainingSeconds = getLevelDurationSeconds(getCurrentLevel());
  clockState.ended = false;
  setStatus(clockStatus, `已切换到第 ${clockState.levelIndex + 1} 级`, 'ok');
  renderClock();
}

function ensureAudioContext() {
  if (audioContext) return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  audioContext = new AudioContextCtor();
}

function playBeep() {
  try {
    ensureAudioContext();
    if (!audioContext) return;
    if (audioContext.state === 'suspended') audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 720;
    gainNode.gain.setValueAtTime(0.28, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.45);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.45);
  } catch {
    // Audio is optional.
  }

  if ('vibrate' in navigator) {
    navigator.vibrate([160, 80, 160]);
  }
}

document.getElementById('add-level-btn').addEventListener('click', addLevel);
document.getElementById('reset-template-btn').addEventListener('click', resetActiveTemplate);
document.getElementById('start-timer-btn').addEventListener('click', enterClock);
document.getElementById('back-to-setup-btn').addEventListener('click', enterSetup);
toggleClockBtn.addEventListener('click', toggleClock);
document.getElementById('reset-clock-btn').addEventListener('click', resetCurrentLevel);
document.getElementById('prev-level-btn').addEventListener('click', () => goToLevel(clockState.levelIndex - 1));
document.getElementById('next-level-btn').addEventListener('click', () => goToLevel(clockState.levelIndex + 1));

renderAllSetup();
