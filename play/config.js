// API base for poker-play Worker.
// Local: wrangler dev → http://127.0.0.1:8787
// Prod:  set to your workers.dev or custom domain after deploy.
window.PLAY_CONFIG = {
  apiBase: localStorage.getItem("PLAY_API_BASE") || "http://127.0.0.1:8787",
};
