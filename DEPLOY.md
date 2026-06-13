# 部署指南

## 方案 A：Cloudflare Pages（推荐）

### 1) 创建 Pages 项目（只做一次）
```bash
npm i -g wrangler
wrangler login
wrangler pages project create poker
```

如项目名不是 `poker`，请在仓库 `Settings -> Secrets and variables -> Actions -> Variables` 设置：
- `CLOUDFLARE_PAGES_PROJECT=<你的项目名>`

### 2) 配置 GitHub Actions Secrets
在仓库 `Settings -> Secrets and variables -> Actions` 添加：
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

API Token 权限建议至少包含：
- `Cloudflare Pages:Edit`
- `Account:Read`

### 3) 自动部署
本仓库已包含工作流：
- `.github/workflows/deploy-cloudflare-pages.yml`

触发方式：
- push 到 `main`
- 手动运行 `workflow_dispatch`

部署成功后可访问：
- `https://<project>.pages.dev`

当前项目已上线：
- `https://poker-ema.pages.dev`

## 方案 B：GitHub Pages（备选）

1. 打开仓库 `Settings -> Pages`
2. `Source` 选择：
   - Branch: `main`
   - Folder: `/ (root)`
3. 保存后等待构建
4. 访问 `https://<username>.github.io/texasholdem/`

## iPhone 添加到主屏幕

1. 在 Safari 打开线上地址
2. 点击分享按钮
3. 选择“添加到主屏幕”
4. 完成

## PWA 更新机制

- `manifest.webmanifest` 提供安装信息、主题色和图标。
- `sw.js` 提供离线缓存，并采用网络优先策略，避免手机端长期停留在旧版本。
- 当 service worker 检测到新版本时，页面底部会提示“新版本已就绪”，点击“更新”后刷新到最新版。
- 设置页“应用更新”区域可手动检查更新。

## 发布前检查清单

1. README 已更新在线链接、技术栈、联系方式
2. App 设置页的微信 CTA 可正常复制（`AI 小作坊`）
3. `manifest.webmanifest`、`sw.js`、`icon-192.png`、`icon-512.png` 可访问
4. Cloudflare Pages 或 GitHub Pages 构建通过

## 可选：启用 Supabase 邮箱验证码登录

1. 按 [docs/SUPABASE.md](./docs/SUPABASE.md) 创建 `texasholdem_user_states` 表并开启 RLS。
2. 在 Supabase Auth URL Configuration 中添加：
   - Site URL: `https://poker-ema.pages.dev`
   - Redirect URL: `https://poker-ema.pages.dev/**`
3. 在 Supabase Dashboard -> Authentication -> Emails -> Magic Link / OTP 中，让邮件模板包含 `{{ .Token }}`。
4. 修改 `assets/js/00-supabase-config.js`：
   - `enabled: true`
   - `url` 填 Supabase Project URL
   - `anonKey` 填 public anon key
5. 提交并推送到 `main`，Cloudflare Pages 会自动更新。
