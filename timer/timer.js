const LEGACY_TIMER_CONFIG_KEY = 'texasholdem_timer_config_v1';
const TIMER_STATE_FALLBACK_KEY = 'texasholdem_timer_state_v1';
const TIMER_DB_NAME = 'texasholdem_timer_db';
const TIMER_DB_VERSION = 1;
const TIMER_STORE_NAME = 'timer_state';
const TIMER_STATE_KEY = 'state';
const TIMER_STATE_SCHEMA_VERSION = 1;

const DEFAULT_TEMPLATES = [
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

let timerState = createDefaultTimerState();
let timerConfig = { levels: clone(timerState.currentLevels) };
let activeTemplateId = timerState.activeTemplateId;
let clockState = {
  levelIndex: 0,
  remainingSeconds: getLevelDurationSeconds(timerConfig.levels[0]),
  running: false,
  intervalId: null,
  ended: false
};
let audioContext = null;
let timerDbPromise = null;
let saveQueue = Promise.resolve();
let pendingDeleteTemplateId = null;
let templateNameDraft = '';
let lastSaveActionAt = 0;
let setupToastTimeoutId = null;

const setupView = document.getElementById('setup-view');
const clockView = document.getElementById('clock-view');
const templateButtons = document.getElementById('template-buttons');
const templateNameInput = document.getElementById('template-name-input');
const openTemplatePickerBtn = document.getElementById('open-template-picker-btn');
const closeTemplatePickerBtn = document.getElementById('close-template-picker-btn');
const templatePicker = document.getElementById('template-picker');
const templatePickerBackdrop = document.getElementById('template-picker-backdrop');
const openAuthorContactBtn = document.getElementById('open-author-contact-btn');
const closeAuthorContactBtn = document.getElementById('close-author-contact-btn');
const authorContactDialog = document.getElementById('author-contact-dialog');
const authorContactBackdrop = document.getElementById('author-contact-backdrop');
const deleteTemplateBtn = document.getElementById('delete-template-btn');
const createTemplateBtn = document.getElementById('create-template-btn');
const levelList = document.getElementById('level-list');
const levelCountLabel = document.getElementById('level-count-label');
const setupStatus = document.getElementById('setup-status');
const setupToast = document.getElementById('setup-toast');
const clockStatus = document.getElementById('clock-status');
const countdown = document.getElementById('countdown');
const progressFill = document.getElementById('progress-fill');
const clockLevelNumber = document.getElementById('clock-level-number');
const previousBlinds = document.getElementById('previous-blinds');
const previousAnte = document.getElementById('previous-ante');
const currentBlinds = document.getElementById('current-blinds');
const currentAnte = document.getElementById('current-ante');
const nextBlinds = document.getElementById('next-blinds');
const nextAnte = document.getElementById('next-ante');
const toggleClockBtn = document.getElementById('toggle-clock-btn');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function areLevelsEqual(a, b) {
  const left = normalizeLevels(a);
  const right = normalizeLevels(b);
  if (left.length !== right.length) return false;

  return left.every((level, index) => {
    const other = right[index];
    return level.minutes === other.minutes &&
      level.sb === other.sb &&
      level.bb === other.bb &&
      level.ante === other.ante;
  });
}

function createDefaultTimerState() {
  return {
    _schemaVersion: TIMER_STATE_SCHEMA_VERSION,
    templates: clone(DEFAULT_TEMPLATES),
    activeTemplateId: DEFAULT_TEMPLATES[0].id,
    currentLevels: clone(DEFAULT_TEMPLATES[0].levels)
  };
}

function createTemplateId() {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels.map(level => ({
    minutes: normalizeNumber(level && level.minutes, 0),
    sb: normalizeNumber(level && level.sb, 0),
    bb: normalizeNumber(level && level.bb, 0),
    ante: normalizeNumber(level && level.ante, 0)
  }));
}

function isValidLevel(level) {
  return Number.isSafeInteger(level.minutes) && level.minutes > 0 &&
    Number.isSafeInteger(level.sb) && level.sb > 0 &&
    Number.isSafeInteger(level.bb) && level.bb >= level.sb &&
    Number.isSafeInteger(level.ante) && level.ante >= 0;
}

function normalizeTemplate(template, fallbackName = '未命名模版') {
  const levels = normalizeLevels(template && template.levels);
  if (levels.length === 0 || levels.some(level => !isValidLevel(level))) return null;
  return {
    id: String((template && template.id) || createTemplateId()),
    name: String((template && template.name) || fallbackName).trim() || fallbackName,
    levels,
    createdAt: template && template.createdAt ? template.createdAt : new Date().toISOString(),
    updatedAt: template && template.updatedAt ? template.updatedAt : new Date().toISOString()
  };
}

function normalizeTimerState(raw) {
  const fallback = createDefaultTimerState();
  const source = raw && typeof raw === 'object' ? raw : fallback;

  const templates = (Array.isArray(source.templates) ? source.templates : fallback.templates)
    .map((template, index) => normalizeTemplate(template, `模版 ${index + 1}`))
    .filter(Boolean);

  let currentLevels = normalizeLevels(source.currentLevels || source.levels);
  if (currentLevels.length === 0) {
    const activeTemplate = templates.find(template => template.id === source.activeTemplateId);
    currentLevels = clone((activeTemplate || templates[0] || fallback.templates[0]).levels);
  }

  const activeTemplateId = templates.some(template => template.id === source.activeTemplateId)
    ? source.activeTemplateId
    : null;

  return {
    _schemaVersion: TIMER_STATE_SCHEMA_VERSION,
    templates,
    activeTemplateId,
    currentLevels
  };
}

function openTimerDatabase() {
  if (timerDbPromise) return timerDbPromise;
  timerDbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(TIMER_DB_NAME, TIMER_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TIMER_STORE_NAME)) {
        db.createObjectStore(TIMER_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return timerDbPromise;
}

async function readTimerStateFromIndexedDB() {
  const db = await openTimerDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMER_STORE_NAME, 'readonly');
    const store = tx.objectStore(TIMER_STORE_NAME);
    const request = store.get(TIMER_STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeTimerStateToIndexedDB(state) {
  const db = await openTimerDatabase();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIMER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TIMER_STORE_NAME);
    const request = store.put(state, TIMER_STATE_KEY);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function readJSONFromLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeFallbackState(state) {
  try {
    localStorage.setItem(TIMER_STATE_FALLBACK_KEY, JSON.stringify(state));
  } catch {
    // If localStorage is unavailable, IndexedDB remains the primary path.
  }
}

async function loadTimerState() {
  let stored = null;
  let shouldPersist = false;

  try {
    stored = await readTimerStateFromIndexedDB();
  } catch (error) {
    console.warn('[timer] IndexedDB read failed', error);
  }

  if (!stored) {
    stored = readJSONFromLocalStorage(TIMER_STATE_FALLBACK_KEY);
    if (stored) shouldPersist = true;
  }

  if (!stored) {
    const legacy = readJSONFromLocalStorage(LEGACY_TIMER_CONFIG_KEY);
    if (legacy && Array.isArray(legacy.levels)) {
      const seeded = createDefaultTimerState();
      stored = {
        ...seeded,
        activeTemplateId: seeded.templates.some(template => template.id === legacy.templateId)
          ? legacy.templateId
          : null,
        currentLevels: normalizeLevels(legacy.levels)
      };
      shouldPersist = true;
    }
  }

  if (!stored) {
    stored = createDefaultTimerState();
    shouldPersist = true;
  }

  const normalized = normalizeTimerState(stored);
  if (shouldPersist) {
    await persistLoadedTimerState(normalized);
  }
  return normalized;
}

async function persistLoadedTimerState(state) {
  try {
    const saved = await writeTimerStateToIndexedDB(state);
    if (saved) {
      try {
        localStorage.removeItem(TIMER_STATE_FALLBACK_KEY);
        localStorage.removeItem(LEGACY_TIMER_CONFIG_KEY);
      } catch {
        // Ignore cleanup failures.
      }
      return;
    }
  } catch (error) {
    console.warn('[timer] initial IndexedDB write failed, using fallback', error);
  }
  writeFallbackState(state);
}

function syncTimerStateFromEditor() {
  timerState.activeTemplateId = activeTemplateId;
  timerState.currentLevels = clone(timerConfig.levels);
}

function saveTimerState() {
  syncTimerStateFromEditor();
  const snapshot = clone(timerState);
  saveQueue = saveQueue.then(async () => {
    try {
      const saved = await writeTimerStateToIndexedDB(snapshot);
      if (saved) {
        try {
          localStorage.removeItem(TIMER_STATE_FALLBACK_KEY);
          localStorage.removeItem(LEGACY_TIMER_CONFIG_KEY);
        } catch {
          // Ignore cleanup failures.
        }
        return;
      }
    } catch (error) {
      console.warn('[timer] IndexedDB write failed, using fallback', error);
    }
    writeFallbackState(snapshot);
  }).catch(error => {
    console.warn('[timer] save failed', error);
  });
  return saveQueue;
}

function getActiveTemplate() {
  return timerState.templates.find(template => template.id === activeTemplateId) || null;
}

function getLevelDurationSeconds(level) {
  return Math.max(1, normalizeNumber(level && level.minutes, 1)) * 60;
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
  const baseClass = target === setupStatus
    ? 'status-line setup-status-line'
    : target === clockStatus
      ? 'status-line clock-status-line'
      : 'status-line';
  target.className = `${baseClass}${tone ? ` ${tone}` : ''}`;
}

function showSetupToast(message, tone = 'ok') {
  if (!message) return;
  if (setupToastTimeoutId) {
    window.clearTimeout(setupToastTimeoutId);
  }
  setupToast.textContent = message;
  setupToast.className = `setup-toast ${tone || 'ok'} show`;
  setupToastTimeoutId = window.setTimeout(() => {
    setupToast.classList.remove('show');
    setupToastTimeoutId = window.setTimeout(() => {
      setupToast.textContent = '';
      setupToast.className = 'setup-toast';
      setupToastTimeoutId = null;
    }, 220);
  }, 2800);
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

function getTemplateNameInputValue() {
  return templateNameInput.value.trim();
}

function hasDuplicateTemplateName(name, ignoredTemplateId = null) {
  return timerState.templates.some(template =>
    template.id !== ignoredTemplateId && template.name.trim() === name.trim()
  );
}

function openTemplatePicker() {
  pendingDeleteTemplateId = null;
  renderTemplateEditor();
  templatePicker.hidden = false;
  templatePickerBackdrop.hidden = false;
}

function closeTemplatePicker() {
  templatePicker.hidden = true;
  templatePickerBackdrop.hidden = true;
}

function openAuthorContact() {
  authorContactDialog.hidden = false;
  authorContactBackdrop.hidden = false;
}

function closeAuthorContact() {
  authorContactDialog.hidden = true;
  authorContactBackdrop.hidden = true;
}

function renderTemplateButtons() {
  templateButtons.innerHTML = '';

  if (timerState.templates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'template-empty';
    empty.textContent = '暂无模版，可编辑下方级别后保存';
    templateButtons.appendChild(empty);
    return;
  }

  timerState.templates.forEach(template => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `template-btn${activeTemplateId === template.id ? ' active' : ''}`;
    button.dataset.templateId = template.id;

    const name = document.createElement('span');
    name.className = 'template-name';
    name.textContent = template.name;

    const meta = document.createElement('span');
    meta.className = 'template-meta';
    const firstLevel = template.levels[0];
    meta.textContent = `${template.levels.length} 级 · ${firstLevel.minutes} 分钟起`;

    button.append(name, meta);
    button.addEventListener('click', () => applyTemplate(template.id));
    templateButtons.appendChild(button);
  });
}

function renderTemplateEditor() {
  const activeTemplate = getActiveTemplate();
  const isConfirmingDelete = activeTemplate && pendingDeleteTemplateId === activeTemplate.id;
  templateNameInput.value = templateNameDraft || (activeTemplate ? activeTemplate.name : '');
  templateNameInput.placeholder = activeTemplate ? `当前：${activeTemplate.name}` : '输入模版名称';
  deleteTemplateBtn.disabled = !activeTemplate;
  deleteTemplateBtn.textContent = isConfirmingDelete ? 'Y' : '删除';
  createTemplateBtn.textContent = isConfirmingDelete ? 'N' : '保存';
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

    const actions = document.createElement('div');
    actions.className = 'level-actions';

    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'insert-level-btn';
    insert.textContent = '+';
    insert.setAttribute('aria-label', `在第 ${index + 1} 级后添加级别`);
    insert.addEventListener('click', () => insertLevelAfter(index));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-level-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除第 ${index + 1} 级`);
    remove.addEventListener('click', () => removeLevel(index));

    actions.append(remove, insert);
    row.append(label, minutes, sb, bb, ante, actions);
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
  pendingDeleteTemplateId = null;
  saveTimerState();
  const validation = validateConfig();
  setStatus(setupStatus, validation || '当前配置已保存，可点击保存', validation ? 'warn' : 'ok');
}

function createNextLevelFrom(level) {
  const base = level || { minutes: 20, sb: 25, bb: 50, ante: 0 };
  return {
    minutes: base.minutes,
    sb: base.bb,
    bb: base.bb * 2,
    ante: base.ante
  };
}

function insertLevelAfter(index) {
  const base = timerConfig.levels[index] || timerConfig.levels[timerConfig.levels.length - 1];
  timerConfig.levels.splice(index + 1, 0, createNextLevelFrom(base));
  pendingDeleteTemplateId = null;
  saveTimerState();
  renderAllSetup();
}

function removeLevel(index) {
  if (timerConfig.levels.length <= 1) {
    setStatus(setupStatus, '至少保留 1 个级别', 'warn');
    return;
  }
  timerConfig.levels.splice(index, 1);
  pendingDeleteTemplateId = null;
  saveTimerState();
  renderAllSetup();
}

function applyTemplate(templateId) {
  const template = timerState.templates.find(item => item.id === templateId);
  if (!template) return;
  activeTemplateId = template.id;
  timerConfig = { levels: clone(template.levels) };
  pendingDeleteTemplateId = null;
  templateNameDraft = '';
  saveTimerState();
  setStatus(setupStatus, `已载入${template.name}`, 'ok');
  closeTemplatePicker();
  renderAllSetup();
}

function saveTemplateFromCurrent(showToast = false) {
  const reportSaveResult = (message, tone = 'ok') => {
    setStatus(setupStatus, message, tone);
    if (showToast) {
      showSetupToast(message, tone);
    }
  };

  const validation = validateConfig();
  if (validation) {
    reportSaveResult(validation, 'warn');
    return;
  }

  const activeTemplate = getActiveTemplate();
  const draftName = getTemplateNameInputValue();
  const name = draftName || (activeTemplate ? activeTemplate.name : '');
  if (!name) {
    reportSaveResult('请输入模版名称', 'warn');
    templateNameInput.focus();
    return;
  }

  if (activeTemplate) {
    const nameChanged = name !== activeTemplate.name;
    const levelsChanged = !areLevelsEqual(timerConfig.levels, activeTemplate.levels);

    if (!nameChanged) {
      activeTemplate.levels = clone(timerConfig.levels);
      activeTemplate.updatedAt = new Date().toISOString();
      templateNameDraft = '';
      pendingDeleteTemplateId = null;
      saveTimerState();
      reportSaveResult(`已更新模版：${name}`, 'ok');
      renderAllSetup();
      return;
    }

    if (hasDuplicateTemplateName(name, activeTemplate.id)) {
      reportSaveResult('模版名称已存在，请换一个名称', 'warn');
      templateNameInput.focus();
      return;
    }

    if (!levelsChanged) {
      activeTemplate.name = name;
      activeTemplate.updatedAt = new Date().toISOString();
      templateNameDraft = '';
      pendingDeleteTemplateId = null;
      saveTimerState();
      reportSaveResult(`已重命名模版：${name}`, 'ok');
      renderAllSetup();
      return;
    }
  }

  if (hasDuplicateTemplateName(name)) {
    reportSaveResult('模版名称已存在，请换一个名称', 'warn');
    templateNameInput.focus();
    return;
  }

  const now = new Date().toISOString();
  const template = {
    id: createTemplateId(),
    name,
    levels: clone(timerConfig.levels),
    createdAt: now,
    updatedAt: now
  };
  timerState.templates.push(template);
  activeTemplateId = template.id;
  pendingDeleteTemplateId = null;
  templateNameDraft = '';
  saveTimerState();
  reportSaveResult(`已保存新模版：${name}`, 'ok');
  renderAllSetup();
}

function isDeleteConfirming() {
  const activeTemplate = getActiveTemplate();
  return Boolean(activeTemplate && pendingDeleteTemplateId === activeTemplate.id);
}

function cancelTemplateDelete() {
  pendingDeleteTemplateId = null;
  setStatus(setupStatus, '', '');
  renderTemplateEditor();
}

function deleteCurrentTemplate() {
  const template = getActiveTemplate();
  if (!template) {
    setStatus(setupStatus, '请先选择一个模版', 'warn');
    return;
  }

  if (pendingDeleteTemplateId !== template.id) {
    pendingDeleteTemplateId = template.id;
    setStatus(setupStatus, `确认删除模版：${template.name}`, 'warn');
    renderTemplateEditor();
    return;
  }

  timerState.templates = timerState.templates.filter(item => item.id !== template.id);
  activeTemplateId = null;
  pendingDeleteTemplateId = null;
  templateNameDraft = '';
  saveTimerState();
  setStatus(setupStatus, `已删除模版：${template.name}`, 'ok');
  renderAllSetup();
}

function renderAllSetup() {
  renderTemplateButtons();
  renderTemplateEditor();
  renderLevels();
}

function enterClock() {
  const validation = validateConfig();
  if (validation) {
    setStatus(setupStatus, validation, 'warn');
    return;
  }

  saveTimerState();
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

function getPreviousLevel() {
  return timerConfig.levels[clockState.levelIndex - 1] || null;
}

function getNextLevel() {
  return timerConfig.levels[clockState.levelIndex + 1] || null;
}

function renderClock() {
  const previous = getPreviousLevel();
  const current = getCurrentLevel();
  const next = getNextLevel();
  const totalLevels = Math.max(1, timerConfig.levels.length);
  const levelProgress = ((clockState.levelIndex + 1) / totalLevels) * 100;

  clockLevelNumber.textContent = String(clockState.levelIndex + 1);
  countdown.textContent = formatClock(clockState.remainingSeconds);
  progressFill.style.width = `${Math.max(0, Math.min(100, levelProgress))}%`;
  previousBlinds.textContent = previous ? formatBlinds(previous) : '无上一级';
  previousAnte.textContent = previous ? formatAnte(previous) : '无上一级';
  currentBlinds.textContent = formatBlinds(current);
  currentAnte.textContent = formatAnte(current);
  nextBlinds.textContent = next ? formatBlinds(next) : '最后一级';
  nextAnte.textContent = next ? formatAnte(next) : '无下一盲注';

  toggleClockBtn.textContent = clockState.running ? '暂停' : '开始';
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
    renderClock();
    return;
  }

  stopClock();
  clockState.remainingSeconds = 0;
  clockState.ended = true;
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

function bindEvents() {
  const handleSaveTemplatePress = event => {
    event.preventDefault();
    const now = Date.now();
    if (isDeleteConfirming()) {
      lastSaveActionAt = now;
      cancelTemplateDelete();
      return;
    }
    if (now - lastSaveActionAt < 350) return;
    lastSaveActionAt = now;
    templateNameInput.blur();
    saveTemplateFromCurrent(true);
  };
  createTemplateBtn.addEventListener('pointerdown', handleSaveTemplatePress);
  createTemplateBtn.addEventListener('touchstart', handleSaveTemplatePress);
  createTemplateBtn.addEventListener('mousedown', handleSaveTemplatePress);
  createTemplateBtn.addEventListener('click', event => {
    event.preventDefault();
    if (isDeleteConfirming()) {
      lastSaveActionAt = Date.now();
      cancelTemplateDelete();
      return;
    }
    if (Date.now() - lastSaveActionAt < 600) return;
    lastSaveActionAt = Date.now();
    saveTemplateFromCurrent(true);
  });
  deleteTemplateBtn.addEventListener('click', deleteCurrentTemplate);
  openTemplatePickerBtn.addEventListener('click', openTemplatePicker);
  closeTemplatePickerBtn.addEventListener('click', closeTemplatePicker);
  templatePickerBackdrop.addEventListener('click', closeTemplatePicker);
  openAuthorContactBtn.addEventListener('click', openAuthorContact);
  closeAuthorContactBtn.addEventListener('click', closeAuthorContact);
  authorContactBackdrop.addEventListener('click', closeAuthorContact);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!templatePicker.hidden) {
      closeTemplatePicker();
    }
    if (!authorContactDialog.hidden) {
      closeAuthorContact();
    }
  });
  document.getElementById('start-timer-btn').addEventListener('click', enterClock);
  document.getElementById('back-to-setup-btn').addEventListener('click', enterSetup);
  toggleClockBtn.addEventListener('click', toggleClock);
  document.getElementById('reset-clock-btn').addEventListener('click', resetCurrentLevel);
  document.getElementById('prev-level-btn').addEventListener('click', () => goToLevel(clockState.levelIndex - 1));
  document.getElementById('next-level-btn').addEventListener('click', () => goToLevel(clockState.levelIndex + 1));
  templateNameInput.addEventListener('input', () => {
    templateNameDraft = templateNameInput.value;
    if (pendingDeleteTemplateId) {
      pendingDeleteTemplateId = null;
      renderTemplateEditor();
    }
  });
  templateNameInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveTemplateFromCurrent();
  });
}

async function initTimerApp() {
  bindEvents();
  timerState = await loadTimerState();
  activeTemplateId = timerState.activeTemplateId;
  timerConfig = { levels: clone(timerState.currentLevels) };
  clockState.remainingSeconds = getLevelDurationSeconds(timerConfig.levels[0]);
  renderAllSetup();
}

initTimerApp();
