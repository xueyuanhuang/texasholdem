# Window Status (A / B / C)

> Last Updated: 2026-04-11

## 目的
这份文档只回答两件事：
1. 每个窗口负责哪些文件。
2. 当前做到哪一步。

---

## 窗口 A（数据层）

### 负责范围
- `assets/js/01-data.js`
- `assets/js/14-init.js`

### 已完成
- 统一数据迁移入口：`migrateData(d)`
- 存储层：IndexedDB 主存储 + localStorage 回退
- 启动加载：`loadData()` 后再初始化页面

### 你要找的入口函数
- `migrateData`
- `loadData`
- `saveData`
- `clearDataStorage`

---

## 窗口 B（锦标赛链路）

### 负责范围
- `assets/js/02-scoring.js`
- `assets/js/05-tournament-settings.js`
- `assets/js/06-entry.js`
- `assets/js/13-ingame.js`

### 当前状态
- 已完成（用户确认 B 窗口修改已完成）
- 建议按 `docs/UAT_CHECKLIST.md` 做全链路人工验收

### 你要找的入口函数
- `calcScores`（积分计算）
- `saveCurrentSettings` / `selectTemplate`（对局配置）
- `saveTournament` / `getRankings`（赛果保存）
- `startInGameMode` / `generateRankingsFromElimination`（实时对局）

---

## 窗口 C（现金局 + 设置 + 历史）

### 负责范围
- `assets/js/09-history.js`
- `assets/js/10-settings.js`
- `assets/js/11-cash-game.js`
- `assets/js/12-toast.js`

### 已完成
- 历史页支持同日多场锦标赛，不再覆盖
- 导入/导出/重置提示更清晰
- 现金局输入/参数校验更严格，错误时不给错误转账方案

### 你要找的入口函数
- `renderHistory`
- `importData` / `resetData`
- `renderCashPlayers` / `updateCashValidation` / `renderTransfers`

---

## 一句话记忆法
- A：管“数据怎么存、怎么读”
- B：管“锦标赛怎么打、怎么算”
- C：管“现金局和设置页怎么用”

---

## 当前线上体验地址
- Cloudflare Pages: `https://poker-ema.pages.dev`
