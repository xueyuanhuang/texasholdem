# Play 部署状态

- 日期：2026-07-09
- Worker URL：https://poker-play.xue-yuanhuang.workers.dev
- D1 database_id：41891be4-5737-420d-917d-5c5327d8fac1
- JWT_SECRET：已设置（不要写明文）
- GitHub secrets：CLOUDFLARE_API_TOKEN 本次 Actions 校验失败（Cloudflare Authentication error code 10000）；PLAY_JWT_SECRET 未由本机更新
- 部署方式：本机 wrangler OAuth；GitHub Actions run #29007672517 失败后兜底部署
- play/config.js apiBase：https://poker-play.xue-yuanhuang.workers.dev
- health 检查：通过
- 备注：已将 Durable Object migration 改为 `new_sqlite_classes`，以兼容 Cloudflare Workers Free 计划。
