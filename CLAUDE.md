# CLAUDE.md

## 1) 一句话描述
策略博弈研习社是一个纯前端德州扑克积分与现金局记录 Web App，目标是在手机端快速、离线、低学习成本地完成一场比赛全流程记录。

## 2) /align 协作约定（先对齐再实现）
每次改需求先走三步：
1. 复述：用 2-4 句复述目标、边界、验收标准。
2. 确认：列出假设与风险，确认是否继续。
3. 实现：只在确认后开始改代码与部署。

## 3) 架构
- 前端：静态页面入口（`index.html`）+ 多文件资源（`assets/css`、`assets/js`）。
- 存储：`IndexedDB` 主存储，自动兼容迁移旧 `localStorage` 数据。
- 数据备份：应用内 JSON 导出/导入。
- 部署：静态托管（GitHub Pages / Cloudflare Pages）。

## 4) 关键文件
- `index.html`：页面结构与资源入口。
- `assets/css/app.css`：全局样式。
- `assets/js/*.js`：按功能拆分的业务代码（按编号顺序加载）。
- `README.md`：项目介绍、使用方式、部署入口。
- `DEPLOY.md`：部署流程（Cloudflare Pages + GitHub Pages）。
- `.github/workflows/deploy-cloudflare-pages.yml`：Cloudflare 自动部署流水线。
- `docs/ARCHITECTURE.md`：并行开发分工与模块边界。
- `.claude/PROJECT_CONTEXT.md`：项目上下文摘要（可更新）。

## 5) 常用命令
- 本地预览：`python3 -m http.server 8080`
- 查看状态：`git status -sb`
- 推送触发自动部署：`git push origin main`

## 6) 安全模型
- 当前项目不依赖任何第三方密钥，不在前端存储 API Secret。
- 若未来接入密钥型能力，默认采用：
  - 浏览器端签名；
  - 代理层只转发请求，不持久化密钥。

## 7) 开发约定
- 功能优先做最小可验证版本（MVP），再扩展。
- 业务代码优先改对应模块文件，不回退到大段内联脚本。
- 所有数据结构变更必须保留迁移逻辑，避免历史数据丢失。
