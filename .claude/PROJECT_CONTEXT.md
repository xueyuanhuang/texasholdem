# Texas Hold'em Project Context

## Last Updated
- 2026-04-12

## Project Overview
- App Name: poker
- Type: Static Web App (mobile-first, PWA-friendly)
- Language: Mixed CN/EN UI
- Tech: Vanilla HTML/CSS/JavaScript

## Current Architecture (Refactored)
- Entry: `index.html` (page structure + asset loading)
- Styles: `assets/css/app.css`
- Logic modules:
  - `assets/js/01-data.js` (storage, migration, boot data)
  - `assets/js/02-scoring.js` (points engine)
  - `assets/js/03-share.js` (share helpers)
  - `assets/js/04-navigation.js` (tab/mode navigation)
  - `assets/js/05-tournament-settings.js` (template/settings flows)
  - `assets/js/06-entry.js` (tournament entry + save)
  - `assets/js/07-leaderboard.js` (leaderboard rendering)
  - `assets/js/08-wechat-modal.js` (share modal)
  - `assets/js/09-history.js` (history rendering + delete)
  - `assets/js/10-settings.js` (settings + import/export/reset)
  - `assets/js/11-cash-game.js` (cash game flow + settlement)
  - `assets/js/12-toast.js` (toast notifications)
  - `assets/js/13-ingame.js` (in-game timers/elimination/rebuy)
  - `assets/js/14-init.js` (app init)

## Data Storage
- Primary: IndexedDB (`texasholdem_db` / `app_state`)
- Key: `texasholdem_data`
- Compatibility: automatic fallback/migration from legacy localStorage
- Backup: JSON export/import in Settings page

## Feature Status
- Tournament mode: available
- In-game tournament mode: available
- Cash game mode: available
- Leaderboard/history/settings: available
- Landing behavior: no top title block; mode switch is a single English toggle button in one slot; default mode is `Cash Game` (no auto popup)
- Visual style (2026-04-11 update): migrated to a minimal dark theme; removed emoji/logo-style labels from HTML + JS dynamic rendering; bottom tab is now text-only.
- Settings -> Player Management (2026-04-11 update):
  - list is card-internal scroll (`max-height`), no full-page endless growth
  - added player search input
  - delete action is now hidden behind `Edit` mode toggle
  - add-player row stays visible at card bottom with sticky behavior
- Match -> Player Selection (2026-04-11 update):
  - Tournament and Cash now both use a shared Bottom Sheet selector
  - page cards show selected summary + `Edit Players` action
  - selector supports search, clear, and `Use Last Lineup`
  - player names are sorted by alphabet/pinyin initials (Chinese included, leading emoji/symbols ignored for sort)
- Open Incident (2026-04-12): records lost after force-killing process/app and reopening
  - User report: "每次杀掉进程后再次打开记录就没了"
  - Scope to verify: both Tournament saved records and Cash in-progress records
  - Likely causes identified:
    1. Tournament save path did not await persistence completion before UI reset/exit risk
    2. Cash save path uses 1s debounce and can miss final flush on force-kill
    3. Storage is origin-scoped (`IndexedDB/localStorage`), so switching preview URLs can look like data loss
  - Local change already applied (not yet verified/deployed in this handoff):
    - `assets/js/06-entry.js`: `saveTournament` changed to `async` + `await saveData()`
  - Remaining tasks for CC:
    1. Add cash final-flush on `pagehide/visibilitychange/beforeunload` to persist pending debounce
    2. Confirm no other non-awaited critical save paths
    3. Validate on iOS Safari/PWA force-kill reopen behavior
    4. Confirm user is always opening same origin (production URL vs preview URL)
- A/B/C windows:
  - A (data): completed
  - B (tournament chain): user confirmed completed
  - C (cash/settings/history): completed

## Deployment
- GitHub Pages: `https://xueyuanhuang.github.io/texasholdem/`
- Cloudflare Pages project: `poker`
- Cloudflare production URL: `https://poker-ema.pages.dev`
- iOS Add to Home Screen default title: `poker`
- Current app icon baseline: `assets/icon-candidates/option-4.svg` -> `apple-touch-icon.png`
- CI workflow: `.github/workflows/deploy-cloudflare-pages.yml`
- GitHub Variable: `CLOUDFLARE_PAGES_PROJECT=poker`

## Documentation Map
- `CLAUDE.md`: collaboration rules and engineering conventions
- `docs/ARCHITECTURE.md`: module boundaries and ownership
- `docs/WINDOW_STATUS.md`: A/B/C responsibility + status
- `docs/UAT_CHECKLIST.md`: human acceptance checklist
- `DEPLOY.md`: deployment workflow

## Recommended Next Step
- Run `docs/UAT_CHECKLIST.md` + visual smoke test on mobile Safari, then deploy to Cloudflare Pages for real-device acceptance.
