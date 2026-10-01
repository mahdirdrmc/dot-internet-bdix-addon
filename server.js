// ============================================================================
// Unified Dot Internet BDIX Addon (DFlix + CircleFTP) for Render & Node.js
// 24/7 High-Speed Streaming for Movies, TV Shows, Anime, Cartoons, Documentaries
// Includes Strict Release Year Validation to Prevent False Mismatches
// ============================================================================

import http from 'node:http';
import url from 'node:url';

const PORT = process.env.PORT || 7000;
const ADDON_ID = 'org.dotinternet.bdix.unified';
const ADDON_NAME = '⚡ Dot Internet BDIX (DFlix + CircleFTP)';
const ADDON_VERSION = '2.1.0';

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
    idPrefixes: ['tt', 'tmdb:', 'dflix:', 'circleftp:']
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
  for (const m of bridgeMetas) {
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
<html>
<head>
  <meta charset="utf-8">
  <title>Dot Internet BDIX Pack</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    body { background:#070b14; color:#f8fafc; font-family:'Plus Jakarta Sans',sans-serif; display:flex; justify-content:center; padding:40px 20px; margin:0; }
    .card { background:rgba(15,23,42,0.85); border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:32px; max-width:680px; width:100%; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.5); }
    h1 { font-size:30px; font-weight:800; background:linear-gradient(135deg,#fff,#38bdf8); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:8px; }
    p { color:#94a3b8; font-size:15px; margin-bottom:24px; line-height:1.6; }
    .btn { display:inline-flex; align-items:center; gap:8px; font-weight:700; padding:14px 28px; border-radius:12px; text-decoration:none; color:#fff; background:#0284c7; box-shadow:0 8px 24px rgba(2,132,199,0.4); margin:8px; cursor:pointer; border:none; font-size:15px; }
    .btn:hover { background:#0369a1; }
    .btn-sec { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.15); box-shadow:none; }
    .btn-sec:hover { background:rgba(255,255,255,0.18); }
    .url { background:rgba(0,0,0,0.4); padding:12px; border-radius:8px; font-family:monospace; color:#7dd3fc; margin-top:20px; word-break:break-all; font-size:13px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:24px; }
    .stat { background:rgba(0,0,0,0.3); padding:14px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); }
    .stat-val { font-size:20px; font-weight:800; color:#38bdf8; }
    .stat-lbl { font-size:12px; color:#94a3b8; margin-top:2px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Dot Internet BDIX Pack</h1>
    <p>Unified 24/7 Addon for <b>Movies & TV Series</b> from <b>DFlix</b> and <b>CircleFTP</b>. Stream at full local ISP speeds with zero PC server required.</p>
    <div>
      <a href="${stremioInstallUrl}" class="btn">Install on Stremio</a>
      <button onclick="navigator.clipboard.writeText('${manifestUrl}').then(()=>alert('Copied!'))" class="btn btn-sec">Copy for Nuvio</button>
    </div>
    <div class="url">${manifestUrl}</div>
    <div class="grid">
      <div class="stat"><div class="stat-val">55,000+</div><div class="stat-lbl">Movies & Shows</div></div>
      <div class="stat"><div class="stat-val">DFlix</div><div class="stat-lbl">BDIX Server 1</div></div>
      <div class="stat"><div class="stat-val">CircleFTP</div><div class="stat-lbl">BDIX Server 2</div></div>
    </div>
  </div>
</body>
</html>`;
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
  const pathname = parsedUrl.pathname || '/';
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

    // 2. Manifest
    if (pathname === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getManifest()));
      return;
    }

    // 3. Catalogs
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

      const metas = await getUnifiedCatalog(type, skip, search);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ metas }));
      return;
    }

    // 4. Streams
    const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\/]+)\.json$/);
    if (streamMatch) {
      const type = streamMatch[1];
      const id = streamMatch[2];

      const bridgeStreams = await fetchBridgeStreams(type, id);

      const streamMap = new Map();
      for (const s of bridgeStreams) {
        if (!streamMap.has(s.url)) {
          streamMap.set(s.url, s);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ streams: Array.from(streamMap.values()) }));
      return;
    }

    // 5. Meta
    const metaMatch = pathname.match(/^\/meta\/([^\/]+)\/([^\/]+)\.json$/);
    if (metaMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ meta: null }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Endpoint not found', pathname }));
  } catch (err) {
    console.error(`[Server Error] ${pathname}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Dot Internet BDIX Addon is running on port ${PORT}`);
});
