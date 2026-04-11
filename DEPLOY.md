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

## 发布前检查清单

1. README 已更新在线链接、技术栈、联系方式
2. App 设置页的微信 CTA 可正常复制（`AI 小作坊`）
3. Cloudflare Pages 或 GitHub Pages 构建通过
