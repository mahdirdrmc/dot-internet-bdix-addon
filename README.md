# ⚡ Unified Dot Internet BDIX Pack (DFlix + CircleFTP) for Stremio & Nuvio

A high-performance, 24/7 cloud-ready Stremio & Nuvio addon that merges **DFlix** (`https://dflix.live`) and **CircleFTP** (`http://circleftp.net`) into a single unified catalog and stream provider for Dot Internet BDIX users.

---

## ✨ Features

- 🚀 **Unified Dual BDIX Streams**: Every movie and TV show episode delivers streams from both **⚡ DFlix [BDIX]** and **⚡ CircleFTP [BDIX]**.
- 🎬 **Full Movies & TV Shows**: Supports 55,000+ titles including complete seasons and episodes of TV series.
- ☁️ **24/7 Free Cloud Hosting on Vercel**: No need to keep your PC turned on to watch on your tablet, phone, or TV.
- ⚡ **Zero-Buffering BDIX Bandwidth**: Directly routes video streams to local ISP BDIX IP connections for maximum speed.
- 🔄 **Automated Silent Background Sync**: Automatically crawls newly uploaded releases in the background when your PC boots.

---

## 🚀 1-Click 24/7 Vercel Deployment

Deploy this addon directly to your free Vercel account in under 60 seconds:

1. Click here: **[Deploy with Vercel](https://vercel.com/new/import?s=https://github.com/mahdirdrmc/dot-internet-bdix-addon)**
2. Click **Deploy** (No extra build settings or environment variables needed!).
3. Once deployed, your manifest URL will be:
   ```
   https://<your-project-name>.vercel.app/manifest.json
   ```
4. Visit `https://<your-project-name>.vercel.app` in your browser and click **"Install on Stremio"** or copy the URL into **Nuvio**!

---

## 📲 How to Install

### 1. In Stremio
- Open `https://<your-project-name>.vercel.app` in your browser and click **"Install on Stremio"**.
- Alternatively, in Stremio search or addon URL bar, paste:
  ```
  https://<your-project-name>.vercel.app/manifest.json
  ```
- *Tip:* Once installed on Stremio Desktop while logged into your Stremio account, it automatically syncs to your **Android Tablet**, **Phone**, and **Android TV**!

### 2. In Nuvio
- In Nuvio, go to **Settings** -> **Plugins / Addons** -> **Add New Plugin**.
- Paste your manifest URL:
  ```
  https://<your-project-name>.vercel.app/manifest.json
  ```

---

## 🤖 PC Background Crawler & Scraper

A silent background crawler is set up in `scraper/` on your PC to regularly index newly uploaded releases and deep archive titles into the cache:

### 1. Automatic Startup Sync
- A shortcut is already placed in your Windows Startup folder (`DotInternet-BDIX-Sync.lnk`).
- Whenever you boot your PC, `sync_master.js` runs silently in the background and indexes the newest releases.

### 2. Manual Deep Crawl
To crawl hundreds of additional archive pages using your PC's multi-core hardware and RAM:
- Double-click [`scraper/run_deep_archive.bat`](file:///E:/Codes/Stremio/scraper/run_deep_archive.bat)
- This crawls 30 pages of movies and series in parallel with 25 concurrent workers and saves them to your database cache.

---

## 🗄️ Optional: MongoDB Atlas Cloud Sync

If you want your PC scraper to automatically push newly scraped titles directly to your Vercel cloud addon in real-time:
1. Create a free MongoDB Atlas cluster at [mongodb.com](https://www.mongodb.com).
2. Set the `MONGODB_URI` environment variable in your Vercel Project Settings.
3. Add `MONGODB_URI` to a `.env` file in this directory on your PC.
Both your PC scraper and Vercel will then share the same live cloud database!
