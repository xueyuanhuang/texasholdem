# Architecture (Parallel Dev Ready)

## Goal
Refactor from single-file app to multi-file static architecture so multiple developers/windows can work in parallel with low merge conflicts.

## Runtime Layout
- `index.html`: page structure + script/style entrypoints only
- `assets/css/app.css`: all styles
- `assets/js/*.js`: functional slices, loaded in deterministic order

## JS Ownership Map
- `01-data.js`: persistence, schema normalization, migration
- `02-scoring.js`: points engine and ranking math
- `03-share.js`: share-image helpers
- `04-navigation.js`: tab/mode switches
- `05-tournament-settings.js`: tournament settings/template flows
- `06-entry.js`: tournament entry interactions
- `07-leaderboard.js`: leaderboard rendering
- `08-wechat-modal.js`: share modal rendering
- `09-history.js`: history rendering
- `10-settings.js`: settings CRUD/import/export/reset
- `11-cash-game.js`: cash game flows and settlement
- `12-toast.js`: toast notifications
- `13-ingame.js`: in-game tournament timers/state
- `14-init.js`: bootstrapping

## Collaboration Rules
- Preserve script load order unless explicitly coordinating a cross-file refactor.
- New feature should prefer adding a new focused file over expanding unrelated files.
- Cross-cutting changes should be split into commits by ownership area.
- Keep data schema changes centralized in `01-data.js` migration logic.

---

## Data Layer Contract (`01-data.js`)

### Schema Versioning

Every persisted data object carries `_schemaVersion` (integer). The current version is defined by `DATA_SCHEMA_VERSION`. On load or import, `migrateData(d)` runs all pending migration steps in order from `d._schemaVersion` (or 0 if absent) up to `DATA_SCHEMA_VERSION`.

Adding a new migration:
1. Bump `DATA_SCHEMA_VERSION` by 1.
2. Append a function to the `MIGRATIONS` array (index = source version).
3. The function receives the raw data object and mutates it in place.

### Persistence: IndexedDB primary, localStorage fallback

| Operation | Primary | Fallback |
|-----------|---------|----------|
| Read | `readFromIndexedDB()` | `localStorage.getItem(STORAGE_KEY)` + JSON.parse |
| Write | `writeToIndexedDB(data)` | `localStorage.setItem(STORAGE_KEY, ...)` |
| Clear | `clearIndexedDBData()` | `localStorage.removeItem(STORAGE_KEY)` |

On successful IndexedDB write, localStorage key is removed to avoid stale copies.

### Save Serialization

`saveData()` enqueues writes through a promise chain (`_saveQueue`). This guarantees:
- No two IndexedDB transactions overlap for the same key.
- Callers can fire-and-forget (`saveData()`) or `await saveData()` for confirmation.
- If IndexedDB fails, the fallback localStorage write is atomic (single `setItem`).

### Public API

| Function | Behavior |
|----------|----------|
| `loadData()` | Read from IDB → fallback LS → fallback defaults. Run `migrateData()`. Auto-save if migrated or first load. Sets global `data`. |
| `saveData()` | Serialized write of current `data` to IDB (fallback LS). Returns a promise. |
| `clearDataStorage()` | Wipe both IDB and LS entries. Does **not** reset `data` in memory. |
| `cloneDefaultData()` | Deep clone of `DEFAULT_DATA` (seed data for fresh installs). |
| `migrateData(d)` | Run pending migrations on object `d`, stamp `_schemaVersion`. |
| `validateImportedData(obj)` | (`10-settings.js`) Structural validation — returns `{ ok, error?, summary? }`. |

### Import Flow (`10-settings.js`)

1. Parse JSON (catch syntax errors → toast).
2. `validateImportedData()` — reject structurally invalid data before touching `data`.
3. Assign to `data`, run `migrateData(data)` to normalize/upgrade.
4. `saveData()` — persist.
5.坏数据永远不落盘 (bad data never persists).

### Reset Flow

`resetData()` → double-confirm → `clearDataStorage()` → `loadData()` (re-creates from defaults).

### iOS PWA Cold-Start Resilience

IndexedDB can be temporarily unavailable on iOS PWA cold-start (after force-kill).

**Read path** (`loadData`):
- `readFromIndexedDBWithRetry(3, 500)` — retries IDB read up to 3 times with 500ms intervals.
- If IDB is unavailable AND localStorage is empty (already cleaned up after migration), loads defaults in memory but **does NOT persist** — preventing overwrite of real data still in IDB.

**Write path** (`14-init.js`):
- `visibilitychange` (hidden) and `pagehide` events trigger `_emergencyFlushCashDebounce()`.
- If a cash game auto-save is pending (1s debounce timer), it flushes immediately via **synchronous localStorage write** — async IDB may not complete before process kill.
- On next successful app load, `loadData()` will find and migrate this localStorage data back to IDB.
