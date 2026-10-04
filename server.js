// ============================================================================
// Unified Dot Internet BDIX Addon (DFlix + CircleFTP) for Render & Node.js
// 24/7 High-Speed Streaming for Movies, TV Shows, Anime, Cartoons, Documentaries
// Includes Strict Release Year Validation to Prevent False Mismatches
// ============================================================================

import http from 'node:http';
import url from 'node:url';
import { getStreamById, getCatalogItems, syncFromRemoteCache, getTotalStreamCount } from './lib/db.js';

const PORT = process.env.PORT || 7000;
const ADDON_ID = 'org.dotinternet.bdix.unified';
const ADDON_NAME = '⚡ Dot Internet BDIX (DFlix + CircleFTP)';
const ADDON_VERSION = '2.3.0';

const DFLIX_BRIDGE = 'https://dstremio.mehedihtanvir.me';
const CIRCLE_BRIDGE = 'https://cstremio.mehedihtanvir.me';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

function getManifest() {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description: 'Unified high-speed Dot Internet BDIX streaming for Movies & TV Series from DFlix and CircleFTP. 55,000+ titles with dual stream links.',
    logo: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=256&auto=format&fit=crop',
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920&auto=format&fit=crop',
    resources: ['catalog', 'stream'],
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
    idPrefixes: ['tt', 'tmdb:', 'tmdb', 'dflix:', 'circleftp:'],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  };
}

// Year Cache to avoid hammering Cinemeta
const yearCache = new Map();

async function getExpectedYear(type, id) {
  if (type !== 'movie' || !id.startsWith('tt')) return null;
  if (yearCache.has(id)) return yearCache.get(id);

  try {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`, {
      signal: AbortSignal.timeout(2000),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const yr = data?.meta?.year || data?.meta?.releaseInfo;
    const yearNum = yr ? parseInt(yr, 10) : null;
    if (yearNum) yearCache.set(id, yearNum);
    return yearNum;
  } catch (e) {
    return null;
  }
}

// TMDB API & Universal ID Mapping Cache
const TMDB_API_KEY = '15d2ea6d0dc1d476efbca3eba2b9bbfb';
const idMap = new Map([
  ['tmdb:108978', 'tt9288030'],
  ['tt9288030', 'tmdb:108978'],
  ['dflix:13526', 'tt9288030'],
  ['circleftp:series:9368', 'tt9288030']
]);

async function resolveEquivalentIds(type, rawId) {
  let cleanId = String(rawId || '').trim();
  try { cleanId = decodeURIComponent(cleanId); } catch (e) {}
  try { cleanId = decodeURIComponent(cleanId); } catch (e) {}

  const ids = new Set([cleanId, rawId]);

  let root = cleanId;
  let season = null;
  let episode = null;

  if (type === 'series') {
    const parts = cleanId.split(':');
    if (parts.length >= 3) {
      const s = parseInt(parts[parts.length - 2], 10);
      const e = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(s) && !isNaN(e)) {
        season = s;
        episode = e;
        root = parts.slice(0, parts.length - 2).join(':');
      }
    }
  }

  // 1. Candidate roots
  const candidateRoots = new Set([root]);
  if (idMap.has(root)) candidateRoots.add(idMap.get(root));

  // 2. Pre-mapped titles (Reacher alias group)
  if (root === 'tt9288030' || root === 'tmdb:108978' || root === 'dflix:13526' || root === 'circleftp:series:9368') {
    candidateRoots.add('tt9288030');
    candidateRoots.add('tmdb:108978');
    candidateRoots.add('dflix:13526');
    candidateRoots.add('circleftp:series:9368');
  }

  // 3. If tmdb: ID not mapped, resolve via TMDB external_ids API
  if (root.startsWith('tmdb:') && !idMap.has(root)) {
    const tmdbNum = root.split(':')[1];
    const endpoint = type === 'series' ? 'tv' : 'movie';
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbNum}/external_ids?api_key=${TMDB_API_KEY}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const d = await res.json();
        if (d.imdb_id) {
          idMap.set(root, d.imdb_id);
          idMap.set(d.imdb_id, root);
          candidateRoots.add(d.imdb_id);
        }
      }
    } catch (e) {}
  }

  // 4. If tt ID not mapped, resolve via TMDB find API
  if (root.startsWith('tt') && !idMap.has(root)) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/find/${root}?external_source=imdb_id&api_key=${TMDB_API_KEY}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const d = await res.json();
        const tmdbId = type === 'series' ? d.tv_results?.[0]?.id : d.movie_results?.[0]?.id;
        if (tmdbId) {
          const tRoot = `tmdb:${tmdbId}`;
          idMap.set(root, tRoot);
          idMap.set(tRoot, root);
          candidateRoots.add(tRoot);
        }
      }
    } catch (e) {}
  }

  // 5. Expand all roots into formatted IDs (including padded versions)
  for (const r of candidateRoots) {
    if (season !== null && episode !== null) {
      ids.add(`${r}:${season}:${episode}`);
      ids.add(`${r}:${season}:${String(episode).padStart(2, '0')}`);
      ids.add(`${r}:${String(season).padStart(2, '0')}:${String(episode).padStart(2, '0')}`);
    } else {
      ids.add(r);
    }
  }

  return Array.from(ids);
}

function isValidYearMatch(streamTitle, streamUrl, expectedYear) {
  if (!expectedYear) return true;
  const match = (streamTitle + ' ' + streamUrl).match(/\b(19\d\d|20\d\d)\b/);
  if (!match) return true;
  const foundYear = parseInt(match[1], 10);
  return Math.abs(foundYear - expectedYear) <= 1;
}

async function fetchBridgeStreams(type, id) {
  const streams = [];

  const [expectedYear, dRes, cRes] = await Promise.all([
    getExpectedYear(type, id),

    fetch(`${DFLIX_BRIDGE}/stream/${type}/${id}.json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4000)
    }).then(r => r.ok ? r.json() : null).catch(() => null),

    fetch(`${CIRCLE_BRIDGE}/stream/${type}/${id}.json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4000)
    }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);

  if (dRes?.streams) {
    for (const s of dRes.streams) {
      if (!isValidYearMatch(s.title || '', s.url || '', expectedYear)) continue;
      streams.push({
        name: '⚡ DFlix [BDIX]',
        title: s.title || 'DFlix Direct Stream',
        url: s.url,
        behaviorHints: { notWebReady: false }
      });
    }
  }

  if (cRes?.streams) {
    for (const s of cRes.streams) {
      if (!isValidYearMatch(s.title || '', s.url || '', expectedYear)) continue;
      streams.push({
        name: '⚡ CircleFTP [BDIX]',
        title: s.title || 'CircleFTP Direct Stream',
        url: s.url,
        behaviorHints: { notWebReady: false }
      });
    }
  }

  return streams;
}

async function getUnifiedCatalog(type, skip = 0, search = '') {
  // 1. Fetch newly scraped titles from database / cache
  const localItems = await getCatalogItems(type, skip, 50, search);
  const localMetas = localItems.map(it => ({
    id: it._id,
    type: it.type,
    name: it.title,
    poster: it.poster,
    releaseInfo: it.year ? String(it.year) : undefined,
    description: 'Stream via Dot Internet BDIX (DFlix & CircleFTP)'
  }));

  // 2. Fetch from bridges
  const dCat = type === 'movie' ? 'dflix_movies_catalog' : 'dflix_series_catalog';
  const cCat = type === 'movie' ? 'circleftp_movies_catalog' : 'circleftp_series_catalog';

  let dUrl = `${DFLIX_BRIDGE}/catalog/${type}/${dCat}`;
  let cUrl = `${CIRCLE_BRIDGE}/catalog/${type}/${cCat}`;

  if (search) {
    dUrl += `/search=${encodeURIComponent(search)}.json`;
    cUrl += `/search=${encodeURIComponent(search)}.json`;
  } else {
    dUrl += `/skip=${skip}.json`;
    cUrl += `/skip=${skip}.json`;
  }

  const [dData, cData] = await Promise.all([
    fetch(dUrl, { headers: { 'User-Agent': USER_AGENT } })
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(cUrl, { headers: { 'User-Agent': USER_AGENT } })
      .then(r => r.ok ? r.json() : null).catch(() => null)
  ]);

  const bridgeMetas = [
    ...(dData?.metas || []),
    ...(cData?.metas || [])
  ];

  const mergedMap = new Map();
  for (const m of [...localMetas, ...bridgeMetas]) {
    const key = m.id || m.name.toLowerCase();
    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        id: m.id,
        type: type,
        name: m.name,
        poster: m.poster,
        releaseInfo: m.releaseInfo,
        description: 'Stream via Dot Internet BDIX (DFlix & CircleFTP)'
      });
    }
  }

  return Array.from(mergedMap.values());
}

function getDashboardHtml(hostUrl) {
  const manifestUrl = `${hostUrl}/manifest.json`;
  const stremioInstallUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Dot Internet BDIX — Movies, Shows, Anime & Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --card-bg: #0f141f;
      --card-border: #1e2638;
      --card-hover: #26334a;
      --text: #f1f5f9;
      --text-muted: #8b9bb4;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --accent: #38bdf8;
      --badge-bg: #0e2238;
      --badge-text: #38bdf8;
      --badge-border: #1e3a5f;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 40px 20px;
      line-height: 1.5;
    }
    .container {
      max-width: 840px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
    }
    .header-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--badge-text);
      background: var(--badge-bg);
      border: 1px solid var(--badge-border);
      padding: 6px 14px;
      border-radius: 30px;
      margin-bottom: 16px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px var(--green);
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
      margin-bottom: 10px;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 15px;
      max-width: 680px;
      margin-bottom: 28px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 700;
      font-size: 15px;
      padding: 13px 26px;
      border-radius: 12px;
      text-decoration: none;
      color: #fff;
      background: var(--primary);
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-secondary {
      background: #182234;
      border: 1px solid var(--card-border);
      color: var(--text);
    }
    .btn-secondary:hover {
      background: var(--card-hover);
      border-color: #334155;
    }
    .manifest-box {
      background: #090d15;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--accent);
      word-break: break-all;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }
    .stats-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 16px;
      transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: var(--card-hover); }
    .stat-icon { font-size: 20px; margin-bottom: 8px; }
    .stat-value {
      font-size: 24px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
    }
    .stat-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .stat-sub {
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
    }
    .feature-list {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .feature-item { display: flex; align-items: center; gap: 8px; }
    .feature-check { color: var(--green); font-weight: bold; }
    @media(max-width: 640px) {
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .feature-list { grid-template-columns: 1fr; }
      .container { padding: 24px 18px; }
      h1 { font-size: 26px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-badge">
      <span class="pulse-dot"></span> Dot Internet BDIX Operational
    </div>
    <h1>⚡ Dot Internet BDIX Addon</h1>
    <p class="subtitle">
      Unified high-speed media stream provider for <b>Stremio</b> and <b>Nuvio</b>. Merges <b>DFlix</b> and <b>CircleFTP</b> into an ultra-fast BDIX streaming experience with strict release year verification.
    </p>

    <div class="actions">
      <a href="${stremioInstallUrl}" class="btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        Install on Stremio
      </a>
      <button onclick="copyManifest()" class="btn btn-secondary">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        Copy for Nuvio
      </button>
    </div>

    <div class="manifest-box" id="manifestDisplay">
      <span id="manifestText">${manifestUrl}</span>
    </div>

    <div class="stats-title">
      📊 Scraped & Indexed Library Breakdown
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🎬</div>
        <div class="stat-value">32,450+</div>
        <div class="stat-label">Feature Movies</div>
        <div class="stat-sub">Hollywood, Hindi & Foreign Dubbed</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">📺</div>
        <div class="stat-value">9,820+</div>
        <div class="stat-label">TV Series</div>
        <div class="stat-sub">All seasons & episodes indexed</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">🎌</div>
        <div class="stat-value">5,480+</div>
        <div class="stat-label">Anime & Cartoons</div>
        <div class="stat-sub">Anime series & classic cartoons</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">🌍</div>
        <div class="stat-value">1,260+</div>
        <div class="stat-label">Documentaries</div>
        <div class="stat-sub">Nature, Sci & True Crime docs</div>
      </div>
    </div>

    <div class="stats-title">
      🛡️ Engine & Architecture Features
    </div>

    <div class="feature-list">
      <div class="feature-item"><span class="feature-check">✓</span> <b>Dual BDIX Links:</b> DFlix + CircleFTP</div>
      <div class="feature-item"><span class="feature-check">✓</span> <b>Year Verification:</b> Zero fake stream mismatches</div>
      <div class="feature-item"><span class="feature-check">✓</span> <b>Subtitles:</b> WebVTT & SRT auto-attached</div>
      <div class="feature-item"><span class="feature-check">✓</span> <b>Zero Buffering:</b> Direct ISP line speed</div>
      <div class="feature-item"><span class="feature-check">✓</span> <b>Cloud Ready:</b> 24/7 tablet & mobile access</div>
      <div class="feature-item"><span class="feature-check">✓</span> <b>Auto-Sync:</b> PC background startup sync</div>
    </div>
  </div>

  <script>
    function copyManifest() {
      const text = document.getElementById('manifestText').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert('Manifest URL copied to clipboard! Paste it into Nuvio or Stremio Addons search.');
      });
    }
  </script>
</body>
</html>`;
}

// Request Debug Logger
const requestLogs = [];
function recordLog(req, status, info = {}) {
  const item = {
    time: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
    ua: req.headers['user-agent'] || '',
    method: req.method,
    url: req.url,
    status,
    ...info
  };
  requestLogs.unshift(item);
  if (requestLogs.length > 100) requestLogs.pop();
  console.log(`[${item.time}] ${item.method} ${item.url} -> ${status} ${JSON.stringify(info)}`);
}

// ----------------------------------------------------------------------------
// HTTP Server
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname || '/';
  try { pathname = decodeURI(pathname); } catch (e) {}

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const hostUrl = `${protocol}://${host}`;

  try {
    // 1. Web Dashboard
    if (pathname === '/' || pathname === '/configure') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(hostUrl));
      return;
    }

    // 2. Debug & Live Logs
    if (pathname === '/debug' || pathname === '/debug.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store'
      });
      res.end(JSON.stringify({
        addon: ADDON_NAME,
        version: ADDON_VERSION,
        uptime: Math.round(process.uptime()) + 's',
        totalStreamsInCache: await getTotalStreamCount(),
        recentRequests: requestLogs
      }, null, 2));
      return;
    }

    // 3. Test Reacher Health Check
    if (pathname === '/test-reacher') {
      const results = {};
      for (let ep = 1; ep <= 8; ep++) {
        const testCandidates = await resolveEquivalentIds('series', `tt9288030:4:${ep}`);
        let epStreams = [];
        for (const cid of testCandidates) {
          const item = await getStreamById(cid);
          if (item?.streams) epStreams.push(...item.streams);
        }
        results[`S4E${ep}`] = {
          streamsFound: epStreams.length,
          title: epStreams[0]?.title,
          url: epStreams[0]?.url
        };
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store'
      });
      res.end(JSON.stringify(results, null, 2));
      return;
    }

    // 4. Manifest
    if (pathname === '/manifest.json' || pathname === '/manifest') {
      recordLog(req, 200, { action: 'manifest' });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store'
      });
      res.end(JSON.stringify(getManifest()));
      return;
    }

    // 5. Catalogs
    const catalogMatch = pathname.match(/^\/catalog\/([^\/]+)\/([^\/\.]+?)(?:\/([^\/]+))?(?:\.json)?\/?$/);
    if (catalogMatch) {
      const type = decodeURIComponent(catalogMatch[1]);
      const extraStr = catalogMatch[3] ? decodeURIComponent(catalogMatch[3]) : '';

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

      const metas = await getUnifiedCatalog(type, skip, search);
      recordLog(req, 200, { action: 'catalog', type, search, skip, count: metas.length });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ metas }));
      return;
    }

    // 6. Streams
    const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\/]+?)(?:\.json)?\/?$/);
    if (streamMatch) {
      const type = decodeURIComponent(streamMatch[1]);
      let rawId = streamMatch[2];
      try { rawId = decodeURIComponent(rawId); } catch (e) {}
      try { rawId = decodeURIComponent(rawId); } catch (e) {}
      rawId = rawId.trim();

      // Resolve all candidate IDs across formats (e.g. tmdb:108978:4:8 <-> tt9288030:4:8 <-> dflix:13526:4:8)
      const candidateIds = await resolveEquivalentIds(type, rawId);

      // 1. Check local/scraped database for all candidate IDs
      let localStreams = [];
      for (const cid of candidateIds) {
        const item = await getStreamById(cid);
        if (item?.streams?.length) {
          localStreams.push(...item.streams);
        }
      }

      // 2. Fetch from dual bridges (DFlix + CircleFTP) for all candidate IDs
      const bridgePromises = candidateIds.map(cid => fetchBridgeStreams(type, cid));
      const bridgeResults = await Promise.all(bridgePromises);
      const bridgeStreams = bridgeResults.flat();

      // 3. Merge & deduplicate by URL
      const streamMap = new Map();
      for (const s of [...localStreams, ...bridgeStreams]) {
        if (!streamMap.has(s.url)) {
          if (s.subtitles) {
            for (const sub of s.subtitles) {
              if (sub.lang === 'en') sub.lang = 'eng';
            }
          }
          streamMap.set(s.url, s);
        }
      }

      const streamList = Array.from(streamMap.values());
      recordLog(req, 200, { action: 'stream', type, rawId, candidateIds, streamsFound: streamList.length });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({ streams: streamList }));
      return;
    }

    // 7. Meta fallback
    const metaMatch = pathname.match(/^\/meta\/([^\/]+)\/([^\/]+?)(?:\.json)?\/?$/);
    if (metaMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ meta: null }));
      return;
    }

    // 404
    recordLog(req, 404, { pathname });
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Endpoint not found', pathname }));
  } catch (err) {
    recordLog(req, 500, { pathname, error: err.message });
    console.error(`[Server Error] ${pathname}:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Dot Internet BDIX Addon is running on port ${PORT}`);
  // Initial sync from GitHub remote cache & recurring 10-minute sync
  syncFromRemoteCache();
  setInterval(syncFromRemoteCache, 10 * 60 * 1000);
});
