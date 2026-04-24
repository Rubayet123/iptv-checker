# IPTV Stream Checker

Browser-based IPTV stream health checker. Paste or upload any `.m3u` playlist and instantly see which streams are LIVE, DEAD, or TIMEOUT.

**Live at:** `https://YOUR-USERNAME.github.io/iptv-checker`

## Features
- Paste M3U or load `.m3u`/`.m3u8` files
- Concurrent checking (1–50 workers)
- Real-time LIVE/DEAD/TIMEOUT badges with latency
- Progress bar + ETA + speed (channels/sec)
- Filter by status, search, sort any column
- Export results as CSV or LIVE-only `.m3u`
- Configurable CORS proxy

## Deploy to GitHub Pages (5 min)

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR-USERNAME/iptv-checker.git
git push -u origin main
```

### 2. Enable Pages
Settings → Pages → Source → **GitHub Actions**

The `.github/workflows/deploy.yml` workflow runs automatically.  
Your app goes live at `https://YOUR-USERNAME.github.io/iptv-checker`

## Optional: Cloudflare Worker (faster + private)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers → Create Worker
2. Paste `cloudflare-worker.js`, update `ALLOWED_ORIGINS` with your Pages URL, deploy
3. In the app, set **CORS Proxy URL** to `https://YOUR-WORKER.workers.dev/probe?url=`

CF free tier = 100k requests/day.

## Local dev
```bash
npm install && npm run dev
```
