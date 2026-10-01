// ============================================================================
// Dot Internet Unified BDIX Addon (DFlix + CircleFTP) for Vercel
// ============================================================================

import url from 'node:url';
import { getStreamById, getCatalogItems, getTotalStreamCount } from '../lib/db.js';

const ADDON_NAME = 'Dot Internet BDIX Pack';
const ADDON_ID = 'community.bdix.dotinternet';
const ADDON_VERSION = '2.0.0';

function getManifest(hostUrl) {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description: 'Unified high-speed Dot Internet BDIX streaming for Movies & TV Shows from DFlix and CircleFTP.',
    logo: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=256&auto=format&fit=crop',
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920&auto=format&fit=crop',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'bdix_movies',
        name: 'Dot Internet Movies',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      },
      {
        type: 'series',
        id: 'bdix_series',
        name: 'Dot Internet TV Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      }
    ],
    idPrefixes: ['tt', 'dflix:', 'circleftp:']
  };
}

// Fallback stream fetcher from live bridges if not in DB yet
async function fetchBridgeFallback(type, id) {
  const streams = [];

  // Query DFlix bridge
  try {
    const dRes = await fetch(`https://dstremio.mehedihtanvir.me/stream/${type}/${id}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (dRes.ok) {
      const dData = await dRes.json();
      for (const s of (dData.streams || [])) {
        streams.push({
          name: '⚡ DFlix [BDIX]',
          title: s.title || 'DFlix Direct Stream',
          url: s.url,
          behaviorHints: { notWebReady: false }
        });
      }
    }
  } catch (e) {}

  // Query CircleFTP bridge
  try {
    const cRes = await fetch(`https://cstremio.mehedihtanvir.me/stream/${type}/${id}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (cRes.ok) {
      const cData = await cRes.json();
      for (const s of (cData.streams || [])) {
        streams.push({
          name: '⚡ CircleFTP [BDIX]',
          title: s.title || 'CircleFTP Direct Stream',
          url: s.url,
          behaviorHints: { notWebReady: false }
        });
      }
    }
  } catch (e) {}

  return streams;
}

function getDashboardHtml(hostUrl, totalIndexed = 0) {
  const manifestUrl = `${hostUrl}/manifest.json`;
  const stremioInstallUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dot Internet BDIX Pack (DFlix + CircleFTP)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070b14;
      --card-bg: rgba(15, 23, 42, 0.75);
      --card-border: rgba(255, 255, 255, 0.1);
      --brand: #0284c7;
      --brand-hover: #0369a1;
      --accent: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(2, 132, 199, 0.2) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(56, 189, 248, 0.15) 0px, transparent 50%);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
    }
    .container {
      width: 100%;
      max-width: 820px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }
    .header {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
    }
    .dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
    }
    h1 {
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #ffffff 40%, #7dd3fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 16px;
      max-width: 620px;
      line-height: 1.6;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 28px;
      backdrop-filter: blur(16px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .cta-group {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 14px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-size: 15px;
      font-weight: 700;
      padding: 14px 24px;
      border-radius: 12px;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
      flex: 1 1 200px;
    }
    .btn-primary {
      background: var(--brand);
      color: #fff;
      box-shadow: 0 8px 24px rgba(2, 132, 199, 0.35);
    }
    .btn-primary:hover {
      background: var(--brand-hover);
      transform: translateY(-2px);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.14);
      transform: translateY(-2px);
    }
    .manifest-box {
      margin-top: 20px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .manifest-url {
      font-family: monospace;
      color: #7dd3fc;
      font-size: 13px;
      overflow-x: auto;
      white-space: nowrap;
      flex: 1;
    }
    .copy-btn {
      background: rgba(56, 189, 248, 0.2);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #7dd3fc;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: 0.2s;
    }
    .copy-btn:hover {
      background: rgba(56, 189, 248, 0.35);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-top: 14px;
    }
    .stat-card {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .stat-num {
      font-size: 24px;
      font-weight: 800;
      color: #38bdf8;
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge"><div class="dot"></div> 24/7 Cloud Addon Active</div>
      <h1>Dot Internet BDIX Pack</h1>
      <p class="subtitle">Unified high-speed streaming for Stremio & Nuvio. Powered by <b>DFlix</b> and <b>CircleFTP</b> local BDIX servers.</p>
    </div>

    <!-- Installation Card -->
    <div class="card">
      <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 6px;">Install in 1 Click</h2>
      <p style="font-size: 14px; color: var(--text-muted);">Works on any device (Tablet, Phone, Android TV, PC, Web) 24/7 without needing your PC on.</p>

      <div class="cta-group">
        <a href="${stremioInstallUrl}" class="btn btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
          Install to Stremio
        </a>
        <button onclick="copyManifest()" class="btn btn-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Copy for Nuvio
        </button>
      </div>

      <div class="manifest-box">
        <span class="manifest-url" id="manifestUrlText">${manifestUrl}</span>
        <button class="copy-btn" onclick="copyManifest()">Copy URL</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num">${totalIndexed > 0 ? totalIndexed : 'Dual-Engine'}</div>
          <div class="stat-label">Indexed Titles</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">DFlix</div>
          <div class="stat-label">BDIX Server 1</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">CircleFTP</div>
          <div class="stat-label">BDIX Server 2</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function copyManifest() {
      const text = document.getElementById('manifestUrlText').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert('Manifest URL copied to clipboard! Paste it into Nuvio or Stremio Addons.');
      });
    }
  </script>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// Request Handler
// ----------------------------------------------------------------------------
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';
  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const hostUrl = `${protocol}://${host}`;

  try {
    // 1. Web Dashboard
    if (pathname === '/' || pathname === '/configure') {
      const count = await getTotalStreamCount();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(hostUrl, count));
      return;
    }

    // 2. Manifest
    if (pathname === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getManifest(hostUrl)));
      return;
    }

    // 3. Catalogs: /catalog/:type/:id.json or /catalog/:type/:id/:extra.json
    const catalogMatch = pathname.match(/^\/catalog\/([^\/]+)\/([^\/\.]+)(?:\/([^\/]+))?\.json$/);
    if (catalogMatch) {
      const type = catalogMatch[1];
      const extraStr = catalogMatch[3] || '';

      let skip = 0;
      let search = '';

      if (extraStr) {
        const skipMatch = extraStr.match(/skip=(\d+)/);
        if (skipMatch) skip = parseInt(skipMatch[1], 10);
        const searchMatch = extraStr.match(/search=([^&]+)/);
        if (searchMatch) search = decodeURIComponent(searchMatch[1]);
      }

      if (parsedUrl.query.skip) skip = parseInt(parsedUrl.query.skip, 10);
      if (parsedUrl.query.search) search = parsedUrl.query.search;

      const items = await getCatalogItems(type, skip, 50, search);
      const metas = items.map(it => ({
        id: it._id,
        type: it.type,
        name: it.title,
        poster: it.poster,
        releaseInfo: it.year ? String(it.year) : undefined,
        description: `Stream via Dot Internet BDIX (DFlix & CircleFTP)`
      }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ metas }));
      return;
    }

    // 4. Streams: /stream/:type/:id.json
    const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\/]+)\.json$/);
    if (streamMatch) {
      const type = streamMatch[1];
      const id = streamMatch[2];

      // Check DB first
      const item = await getStreamById(id);
      let streams = item?.streams || [];

      // If no streams in DB, fetch from live bridge fallback
      if (streams.length === 0) {
        streams = await fetchBridgeFallback(type, id);
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ streams }));
      return;
    }

    // 5. Status
    if (pathname === '/api/status') {
      const count = await getTotalStreamCount();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', addon: ADDON_NAME, totalStreamsIndexed: count }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  } catch (err) {
    console.error(`[Addon Error] on ${pathname}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
  }
}
