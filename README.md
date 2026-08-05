# 策略博弈研习社（Texas Hold'em）

德州扑克积分与现金局记录 Web App，面向手机场景，支持离线使用与数据本地保存。

## 在线地址
- GitHub Pages: https://xueyuanhuang.github.io/texasholdem/
- Cloudflare Pages（当前生产）: https://poker-ema.pages.dev
- 锦标赛计时器: https://poker-ema.pages.dev/timer/
- iPhone 主屏默认名称: `poker`

## 核心功能
- 锦标赛记录：参赛名单、排名（含并列）、积分自动计算
- 独立计时器：盲注模版选择、保存、删除，逐级时间/盲注设置，当前与下一级展示
- 实时对局模式：盲注计时、思考计时、补码与淘汰跟踪
- 现金局记录：补码流水、筹码校验、自动转账建议
- 邮箱验证码登录与云端同步：可选 Supabase Auth，同一账号跨设备恢复数据
- 完整 PWA：支持安装到主屏幕、离线打开、版本更新提示
- 排行榜与历史：累计积分、按日期回看比赛
- 数据管理：JSON 导出/导入、重置、玩家管理
- 社群 CTA：设置页可复制微信群口令「AI 小作坊」

## 技术栈
- 纯静态前端：HTML + CSS + JavaScript
- 前端架构：`index.html` + `assets/css` + `assets/js` 多文件分层
- 数据层：IndexedDB 本地缓存 + 可选 Supabase 云端同步（自动迁移兼容旧 localStorage）
- PWA：`manifest.webmanifest` + `sw.js`，采用网络优先、离线兜底缓存策略
- 托管：GitHub Pages / Cloudflare Pages

## 数据与安全
- 未配置 Supabase 时不依赖服务端，所有比赛数据保存在浏览器本地（IndexedDB）
- 配置 Supabase 后，使用邮箱验证码登录，每个账号独立保存一份数据
- 前端只使用 Supabase anon key；不要存储 service role key
- 建议定期在设置页导出 JSON 备份

## Supabase 同步
第一版使用单表 JSON state：
- 设置说明：[docs/SUPABASE.md](./docs/SUPABASE.md)
- 配置文件：`assets/js/00-supabase-config.js`
- 数据隔离：Supabase RLS 按 `auth.uid()` 限制每个账号只能读写自己的数据
- Cash Game：点击“开始记录”后生成可恢复的进行中记录，重新打开页面会自动恢复

## 本地开发
```bash
python3 -m http.server 8080
```
访问 `http://localhost:8080`

## PWA 更新
- 应用入口：`manifest.webmanifest`
- 离线与更新：`sw.js`
- 客户端注册与更新提示：`assets/js/15-pwa.js`
- 设置页可点击“检查更新”；检测到新版本时底部会出现“新版本已就绪”提示

## 自动部署（Cloudflare Pages）
已提供 GitHub Actions 工作流：
- 文件：`.github/workflows/deploy-cloudflare-pages.yml`
- 触发：push 到 `main`
- 必需 Secrets：
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
- 可选 Variables：
  - `CLOUDFLARE_PAGES_PROJECT`（当前为 `poker`）

详细步骤见 [DEPLOY.md](./DEPLOY.md)。

## 项目约定
- 协作与架构说明见 [CLAUDE.md](./CLAUDE.md)
- 并行开发边界见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- 需求改动遵循 `/align`：复述 → 确认 → 实现

## 联系方式
- 建议通过 GitHub Issue 反馈问题或改进建议
