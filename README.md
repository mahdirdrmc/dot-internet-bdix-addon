# ⚡ DFLIX BDIX Addon for Stremio & Nuvio

A high-performance Stremio and Nuvio addon that connects directly to the **DFLIX ISP / BDIX server** (`https://dflix.live`), providing ultra-fast local direct streaming for Movies and TV Series with subtitles.

---

## ✨ Features

- 🚀 **Full BDIX / ISP Speeds**: Streams directly from your ISP's library server with zero buffering.
- 🎬 **Movies & TV Shows**: Supports movies up to 4K / 1080p and all seasons / episodes of TV series.
- 💬 **Subtitles Support**: Automatically attaches WebVTT / SRT subtitles from DFLIX.
- 🔍 **Seamless Cinemeta Integration**: Works automatically when searching or selecting any movie/series in Stremio or Nuvio (resolves IMDb IDs `tt...`).
- 📚 **DFLIX Catalogs**: Browse DFLIX Movies and TV Series directly inside the Stremio / Nuvio "Discover" tab.
- ⚡ **Zero External Dependencies**: Built with native Node.js (Node 18+). No heavy dependencies needed.
- 🖥️ **Interactive Web Dashboard**: Built-in 1-click installation button, manifest URL copy, and live stream tester at `http://localhost:7000`.

---

## 🚀 Quick Start (Windows)

1. Double-click [`run.bat`](file:///E:/Codes/Stremio/run.bat) in this folder.
2. The addon server will start, and your browser will automatically open:
   ```
   http://localhost:7000
   ```
3. Click the **"Install on Stremio"** button, or copy the Manifest URL for **Nuvio**.

---

## 💻 Manual Start (Any OS - Windows / Mac / Linux)

Ensure you have **Node.js 18+** installed:

```bash
# Start the server
node server.js
```

Or with npm:

```bash
npm start
```

The server will listen on `http://localhost:7000`.

---

## 📲 How to Install

### 1. In Stremio (Desktop)
1. Ensure the addon server is running (`node server.js` or `run.bat`).
2. Open `http://localhost:7000` in your browser.
3. Click **"Install on Stremio"** (or open the link `stremio://localhost:7000/manifest.json`).
4. Stremio will open and ask: **"Install Addon DFLIX BDIX Server?"** -> Click **Install**.

### 2. In Stremio (Android TV / FireStick / Mobile)
1. If running locally on your PC, find your PC's local IP address on Wi-Fi/LAN (e.g. `192.168.1.100` via `ipconfig`).
2. On your phone or TV browser (or in Stremio's Addon search box), enter:
   ```
   http://<YOUR_PC_IP>:7000/manifest.json
   ```
   *(e.g., `http://192.168.1.100:7000/manifest.json`)*
3. Alternatively, install it once on Stremio Desktop while logged into your Stremio account; your installed addons automatically sync across all your devices (TV, Android, iOS Web)!

### 3. In Nuvio
1. Copy the Manifest URL:
   ```
   http://localhost:7000/manifest.json
   ```
   *(or `http://<YOUR_PC_IP>:7000/manifest.json` if using Nuvio on another device)*
2. In the **Nuvio** app, go to **Settings** -> **Addons** (or **Plugins**).
3. Paste the Manifest URL and confirm installation.

---

## 🐳 Running with Docker

```bash
docker compose up -d
```

---

## ☁️ Free 24/7 Cloud Hosting (Optional)

If you want the addon available 24/7 without keeping your computer running, you can deploy it to any free Node.js hosting platform (such as [Koyeb](https://www.koyeb.com), [Render](https://render.com), [Railway](https://railway.app), or any VPS):

1. Upload this folder to a GitHub repository.
2. In Koyeb or Render, create a new Web Service pointing to your repo.
3. Build Command: *(leave empty)*
4. Run Command: `node server.js`
5. You will get a free HTTPS URL (e.g., `https://my-dflix-addon.koyeb.app/manifest.json`) that can be installed on any device anytime!

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7000` | Port for the addon HTTP server |
| `DFLIX_BASE_URL` | `https://dflix.live` | Target DFLIX server URL |
