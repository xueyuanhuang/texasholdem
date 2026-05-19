# 策略博弈研习社（Texas Hold'em）

德州扑克积分与现金局记录 Web App，面向手机场景，支持离线使用与数据本地保存。

## 在线地址
- GitHub Pages: https://xueyuanhuang.github.io/texasholdem/
- Cloudflare Pages（当前生产）: https://poker-ema.pages.dev
- 锦标赛计时器: https://poker-ema.pages.dev/timer/
- iPhone 主屏默认名称: `poker`

## 核心功能
- 锦标赛记录：参赛名单、排名（含并列）、积分自动计算
- 独立计时器：自带盲注模板、逐级时间/盲注设置、当前与下一级展示
- 实时对局模式：盲注计时、思考计时、补码与淘汰跟踪
- 现金局记录：补码流水、筹码校验、自动转账建议
- 排行榜与历史：累计积分、按日期回看比赛
- 数据管理：JSON 导出/导入、重置、玩家管理
- 社群 CTA：设置页可复制微信群口令「AI 小作坊」

## 技术栈
- 纯静态前端：HTML + CSS + JavaScript
- 前端架构：`index.html` + `assets/css` + `assets/js` 多文件分层
- 数据层：IndexedDB（自动迁移兼容旧 localStorage）
- 托管：GitHub Pages / Cloudflare Pages

## 数据与安全
- 默认不依赖服务端与账号系统
- 所有比赛数据保存在浏览器本地（IndexedDB）
- 不存储第三方 API 密钥
- 建议定期在设置页导出 JSON 备份

## 本地开发
```bash
python3 -m http.server 8080
```
访问 `http://localhost:8080`

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
