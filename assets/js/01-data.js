// ====== Data ======
const STORAGE_KEY = 'texasholdem_data';
const DB_NAME = 'texasholdem_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';
let dbPromise = null;

// ====== Schema Version & Migration Pipeline ======
const DATA_SCHEMA_VERSION = 3;

const MIGRATIONS = [
  // v0 → v1: normalize legacy fields (cashGame.tournamentId → date, buyIns → rebuys, blindTemplates reset)
  function migrateV0toV1(d) {
    if (!Array.isArray(d.players)) d.players = [];
    if (!Array.isArray(d.tournaments)) d.tournaments = [];
    if (!Array.isArray(d.currentRatio) || d.currentRatio.length !== 3) d.currentRatio = [5, 3, 2];
    if (!Array.isArray(d.cashGames)) d.cashGames = [];
    if (!d.cashSettings) d.cashSettings = { chipsPerHand: 1000, pricePerHand: 20 };

    d.cashGames.forEach(cg => {
      if (cg.tournamentId !== undefined && !cg.date) {
        const t = d.tournaments.find(x => x.id === cg.tournamentId);
        if (t) cg.date = t.date;
        delete cg.tournamentId;
      }
      if (!Array.isArray(cg.players)) cg.players = [];
      cg.players.forEach(p => {
        if (p.buyIns !== undefined && !p.rebuys) {
          p.rebuys = [{ time: '21:00', amount: p.buyIns }];
          delete p.buyIns;
        }
        if (!Array.isArray(p.rebuys)) p.rebuys = [];
      });
    });

    if (!d._migrationCleaned) {
      d.blindTemplates = [];
      d._migrationCleaned = true;
    }
    if (!Array.isArray(d.blindTemplates)) d.blindTemplates = [];
    if (!d.tournamentSettings) d.tournamentSettings = { currentTemplateId: null, customSettings: null };
  },

  // v1 → v2: stamp schema version, remove internal migration flag
  function migrateV1toV2(d) {
    delete d._migrationCleaned;
  },

  // v2 → v3: currentRatio [5,3,2] → scoringRule { baseScore, weights }
  function migrateV2toV3(d) {
    if (Array.isArray(d.currentRatio) && d.currentRatio.length > 0) {
      d.scoringRule = { baseScore: 1, weights: d.currentRatio.map(Number) };
    } else {
      d.scoringRule = { baseScore: 1, weights: [5, 3, 2] };
    }
    // Convert per-tournament ratio arrays too
    (d.tournaments || []).forEach(t => {
      if (Array.isArray(t.ratio)) {
        t.scoringRule = { baseScore: 1, weights: t.ratio.map(Number) };
      }
    });
    delete d.currentRatio;
  }
];

function migrateData(d) {
  const fromVersion = typeof d._schemaVersion === 'number' ? d._schemaVersion : 0;
  for (let v = fromVersion; v < DATA_SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) {
      console.log(`[data] migrate v${v} → v${v + 1}`);
      MIGRATIONS[v](d);
    }
  }
  d._schemaVersion = DATA_SCHEMA_VERSION;
}

// ====== Default Data ======
const DEFAULT_DATA = {
  _schemaVersion: DATA_SCHEMA_VERSION,
  players: [
    '咖啡因自咖啡果', '我们都是炎黄子孙', '浪里翻个跟头', '和光同尘',
    'Liscpss', 'Lucas', 'mango', 'Claire', 'hunter',
    '🍶後莱 哲恩', 'allen', 'jangsangwoo', '夜空中的星辰', 'peak'
  ],
  tournaments: [
    {
      id: 1, date: '2026-01-09',
      participants: ['咖啡因自咖啡果', '我们都是炎黄子孙', 'Lucas', 'mango', 'Claire', 'hunter', '夜空中的星辰'],
      rankings: [
        { place: 1, players: ['咖啡因自咖啡果'] },
        { place: 2, players: ['Claire'] },
        { place: 3, players: ['hunter'] }
      ],
      ratio: [6, 3, 1]
    },
    {
      id: 2, date: '2026-01-18',
      participants: ['Liscpss', '浪里翻个跟头', '我们都是炎黄子孙', '咖啡因自咖啡果', 'mango', '🍶後莱 哲恩', 'jangsangwoo'],
      rankings: [
        { place: 1, players: ['Liscpss'] },
        { place: 2, players: ['浪里翻个跟头'] },
        { place: 3, players: ['我们都是炎黄子孙'] }
      ],
      ratio: [6, 3, 1]
    },
    {
      id: 3, date: '2026-01-25',
      participants: ['和光同尘', '我们都是炎黄子孙', '浪里翻个跟头', '咖啡因自咖啡果', 'mango', 'hunter', '🍶後莱 哲恩', 'allen'],
      rankings: [
        { place: 1, players: ['和光同尘'] },
        { place: 2, players: ['我们都是炎黄子孙'] },
        { place: 3, players: ['浪里翻个跟头'] }
      ],
      ratio: [6, 3, 1]
    },
    {
      id: 4, date: '2026-01-31',
      participants: ['Lucas', '浪里翻个跟头', '咖啡因自咖啡果', 'mango', '我们都是炎黄子孙'],
      rankings: [
        { place: 1, players: ['Lucas'] },
        { place: 2, players: ['浪里翻个跟头'] },
        { place: 3, players: ['咖啡因自咖啡果', 'mango'] }
      ],
      ratio: [6, 3, 1]
    },
    {
      id: 5, date: '2026-02-06',
      participants: ['咖啡因自咖啡果', 'mango', '我们都是炎黄子孙', '浪里翻个跟头', 'Claire', 'hunter', 'peak', '夜空中的星辰'],
      rankings: [
        { place: 1, players: ['咖啡因自咖啡果'] },
        { place: 2, players: ['mango'] },
        { place: 3, players: ['我们都是炎黄子孙'] }
      ],
      ratio: [5, 3, 2]
    }
  ],
  scoringRule: { baseScore: 1, weights: [5, 3, 2] },
  cashGames: [
    {
      id: 1,
      date: '2026-01-09',
      chipsPerHand: 1000,
      pricePerHand: 20,
      players: [
        { name: '咖啡因自咖啡果', endChips: 2500, rebuys: [{ time: '21:00', amount: 1 }, { time: '22:30', amount: 1 }] },
        { name: '我们都是炎黄子孙', endChips: 800, rebuys: [{ time: '21:00', amount: 1 }] },
        { name: 'Lucas', endChips: 0, rebuys: [{ time: '21:00', amount: 1 }, { time: '21:45', amount: 1 }] },
        { name: 'Claire', endChips: 1500, rebuys: [{ time: '21:15', amount: 1 }] },
        { name: 'hunter', endChips: 1200, rebuys: [{ time: '21:15', amount: 1 }] }
      ]
    }
  ],
  cashSettings: { chipsPerHand: 1000, pricePerHand: 20 },
  blindTemplates: [],
  tournamentSettings: {
    currentTemplateId: null,
    customSettings: null
  }
};

let data;

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

// ====== Player Name Sorting (A-Z / 拼音首字母) ======
const PLAYER_NAME_SORT_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true
});
const HAN_INITIAL_BOUNDARIES = [
  // Boundary chars tuned for pinyin-initial grouping in browser locale compare.
  // Example: "咖" should fall into K bucket, not J.
  ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '哒'], ['E', '妸'],
  ['F', '发'], ['G', '旮'], ['H', '哈'], ['J', '击'], ['K', '咔'],
  ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'], ['P', '啪'],
  ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'],
  ['X', '昔'], ['Y', '压'], ['Z', '匝']
];

function normalizePlayerNameForSort(name) {
  const raw = String(name ?? '').trim();
  // Ignore leading symbols/emojis so "🍶後莱 哲恩" sorts by "後莱 哲恩"
  const trimmedLeadingSymbols = raw.replace(/^[^\p{L}\p{N}]+/u, '');
  return trimmedLeadingSymbols || raw;
}

function getPlayerSortBucket(name) {
  const key = normalizePlayerNameForSort(name);
  if (!key) return '{';

  const first = key[0];
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  if (/[0-9]/.test(first)) return '0';

  if (/\p{Script=Han}/u.test(first)) {
    for (let i = 0; i < HAN_INITIAL_BOUNDARIES.length; i++) {
      const [initial] = HAN_INITIAL_BOUNDARIES[i];
      const next = HAN_INITIAL_BOUNDARIES[i + 1];
      if (!next || PLAYER_NAME_SORT_COLLATOR.compare(first, next[1]) < 0) {
        return initial;
      }
    }
    return 'Z';
  }

  return first.toUpperCase();
}

function sortPlayerNamesForDisplay(names) {
  if (!Array.isArray(names)) return [];
  return names.slice().sort((a, b) => {
    const aRaw = String(a ?? '').trim();
    const bRaw = String(b ?? '').trim();

    if (!aRaw && !bRaw) return 0;
    if (!aRaw) return 1;
    if (!bRaw) return -1;

    const aBucket = getPlayerSortBucket(aRaw);
    const bBucket = getPlayerSortBucket(bRaw);
    if (aBucket !== bBucket) return aBucket.localeCompare(bBucket, 'en');

    const aKey = normalizePlayerNameForSort(aRaw);
    const bKey = normalizePlayerNameForSort(bRaw);

    const keyCmp = PLAYER_NAME_SORT_COLLATOR.compare(aKey, bKey);
    if (keyCmp !== 0) return keyCmp;

    const rawCmp = PLAYER_NAME_SORT_COLLATOR.compare(aRaw, bRaw);
    if (rawCmp !== 0) return rawCmp;

    return aRaw.localeCompare(bRaw, 'en');
  });
}

// ====== IndexedDB Persistence ======
function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function readFromIndexedDB() {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(STORAGE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// iOS PWA cold-start: IndexedDB may be temporarily unavailable.
// Retry up to 3 times with 500ms intervals before giving up.
async function readFromIndexedDBWithRetry(maxRetries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      dbPromise = null; // reset cached promise so openDatabase() retries connection
      const result = await readFromIndexedDB();
      return result;
    } catch (e) {
      console.warn(`[data] IDB read attempt ${attempt}/${maxRetries} failed`, e);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  return null;
}

async function writeToIndexedDB(value) {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, STORAGE_KEY);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function clearIndexedDBData() {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(STORAGE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ====== Serialized Save Queue ======
let _saveQueue = Promise.resolve();

async function loadData() {
  let storedData = null;
  let loadedFromLegacyStorage = false;
  let idbWasUnavailable = false;

  // Use retry logic for iOS PWA cold-start resilience
  storedData = await readFromIndexedDBWithRetry(3, 500);
  if (!storedData) {
    // Check if IDB itself is working (null result vs connection failure)
    try {
      const db = await openDatabase();
      if (!db) idbWasUnavailable = true;
    } catch {
      idbWasUnavailable = true;
    }
  }

  if (!storedData) {
    const legacyStored = localStorage.getItem(STORAGE_KEY);
    if (legacyStored) {
      try {
        storedData = JSON.parse(legacyStored);
        loadedFromLegacyStorage = true;
      } catch (e) {
        console.warn('localStorage 数据损坏，回退默认数据。', e);
      }
    }
  }

  if (storedData) {
    data = storedData;
  } else if (idbWasUnavailable) {
    // IDB was unavailable AND localStorage was empty — this is likely a cold-start
    // where LS was already cleaned up. Use defaults in memory but DO NOT persist,
    // so we don't overwrite real data that's still in IDB.
    console.warn('[data] IDB unavailable on cold start, using defaults in memory (not persisting)');
    data = cloneDefaultData();
    return; // ← critical: do not save, do not remove localStorage
  } else {
    // Both IDB and LS are genuinely empty — true first-time user
    data = cloneDefaultData();
  }

  const hadNoVersion = typeof data._schemaVersion !== 'number';
  migrateData(data);

  if (hadNoVersion || loadedFromLegacyStorage || !storedData) {
    await saveData();
  } else if (localStorage.getItem(STORAGE_KEY)) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveData() {
  _saveQueue = _saveQueue.then(_doSave).catch(err => {
    console.error('[data] save failed', err);
  });
  return _saveQueue;
}

async function _doSave() {
  try {
    const saved = await writeToIndexedDB(data);
    if (saved) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
  } catch (e) {
    console.warn('IndexedDB 保存失败，回退 localStorage。', e);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function clearDataStorage() {
  try {
    await clearIndexedDBData();
  } catch (e) {
    console.warn('IndexedDB 清理失败。', e);
  }
  localStorage.removeItem(STORAGE_KEY);
}
