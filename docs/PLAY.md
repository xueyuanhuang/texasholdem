# /play 在线德扑

实时 Cash 局，挂在现有 `texasholdem` 项目下的 `/play` 路径。

## 功能

- 用户名 + 密码注册/登录，昵称可改
- 房主建桌：人数 2–9、盲注、买入、行动时限、时长（0.5h 步进）、是否补码、补码不超过 chip leader
- WebSocket 实时牌局（Cloudflare Durable Object）
- 到点**自动结束**并展示会话级净输赢账单

## 结构

```
play/                 # 前端静态页
play-worker/          # Cloudflare Worker + D1 + Durable Objects
docs/play-supabase.sql
docs/PLAY.md
```

## 本地开发

```bash
cd play-worker
npm install
# 应用 D1 migration（本地）
npx wrangler d1 migrations apply poker-play-db --local
# 本地密钥
export JWT_SECRET=dev-secret-change-me
# 或在 .dev.vars 写入 JWT_SECRET=...
npx wrangler dev
```

另开终端托管前端：

```bash
cd play
python3 -m http.server 8081
```

浏览器打开 `http://localhost:8081`，API 默认 `http://127.0.0.1:8787`。

可在页面底部「切换地址」修改 API。

### `.dev.vars` 示例

```
JWT_SECRET=dev-local-secret
# 可选 Supabase 镜像
# SUPABASE_URL=https://xxxx.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=...
```

## 生产部署

### 1. D1 + Worker

```bash
cd play-worker
npx wrangler d1 create poker-play-db
# 把输出的 database_id 写进 wrangler.toml
npx wrangler d1 migrations apply poker-play-db --remote
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

记下 Worker URL，例如 `https://poker-play.<account>.workers.dev`。

### 2. 前端

- 修改 `play/config.js` 的 `apiBase` 为 Worker URL  
- 或用户首次打开后用页面「切换地址」写入 localStorage  
- Pages 部署时把 `play/` 拷进 `dist/play/`（见 GitHub Actions）

### 3. 可选 Supabase

在 Supabase SQL Editor 执行 `docs/play-supabase.sql`，并为 Worker 配置：

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

用于镜像用户与结算记录（主存储仍是 D1）。

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/register` | `{username,password,nickname}` |
| POST | `/api/login` | `{username,password}` |
| GET | `/api/me` | 当前用户 |
| POST | `/api/nickname` | `{nickname}` |
| POST | `/api/rooms` | 建桌（Bearer） |
| GET | `/api/rooms/:code` | 房间信息 |
| WS | `/ws/:code` | 实时牌桌 |

### WebSocket 消息

Client → Server: `hello` / `join` / `start` / `action` / `rebuy` / `leave` / `end` / `ping`  
Server → Client: `state` / `error` / `pong`
