// ============================================================================
// DFLIX BDIX Addon for Stremio & Nuvio (v1.3.0)
// High-Speed Direct Streaming Addon for DFLIX ISP Server
// Enhanced Search & Catalog Engine
// ============================================================================

import http from 'node:http';
import url from 'node:url';

const PORT = process.env.PORT || 7000;
const DFLIX_BASE = process.env.DFLIX_BASE_URL || 'https://dflix.live';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ----------------------------------------------------------------------------
// Simple In-Memory TTL Cache
// ----------------------------------------------------------------------------
class MemoryCache {
  constructor(ttlMs = 3600 * 1000, maxSize = 2000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, customTtl) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expires: Date.now() + (customTtl || this.ttlMs)
    });
  }
}

const cinemetaCache = new MemoryCache(24 * 3600 * 1000); // 24 hours
const dflixSearchCache = new MemoryCache(2 * 3600 * 1000); // 2 hours
const dflixTitleCache = new MemoryCache(4 * 3600 * 1000);  // 4 hours
const catalogCache = new MemoryCache(30 * 60 * 1000);     // 30 mins

// ----------------------------------------------------------------------------
// Helpers & HTTP Client
// ----------------------------------------------------------------------------
async function fetchJson(targetUrl, headers = {}) {
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': USER_AGENT, ...headers }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${targetUrl}`);
  }
  return await res.json();
}

async function fetchText(targetUrl, headers = {}) {
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': USER_AGENT, ...headers }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${targetUrl}`);
  }
  return await res.text();
}

function cleanHtmlText(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeTitle(str) {
  if (!str) return '';
  return cleanHtmlText(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingThe(str) {
  return str.replace(/^the\s+/, '');
}

// Smart similarity scoring
function scoreMatch(candidateTitle, candidateYear, targetTitle, targetYear) {
  const normCand = normalizeTitle(candidateTitle);
  const normTarget = normalizeTitle(targetTitle);
  if (!normCand || !normTarget) return 0;

  let score = 0;

  // 1. Exact title match
  if (normCand === normTarget) {
    score += 80;
  }
  // 2. Exact match ignoring leading "the"
  else if (stripLeadingThe(normCand) === stripLeadingThe(normTarget)) {
    score += 70;
  }
  // 3. Substring / Prefix match
  else if (normCand.startsWith(normTarget) || normTarget.startsWith(normCand)) {
    score += 50;
  } else if (normCand.includes(normTarget) || normTarget.includes(normCand)) {
    score += 40;
  } else {
    // Check word overlap
    const candWords = normCand.split(' ');
    const targetWords = normTarget.split(' ');
    const common = candWords.filter(w => targetWords.includes(w));
    if (common.length >= 2) {
      score += (common.length / Math.max(candWords.length, targetWords.length)) * 35;
    }
  }

  // Year weighting
  if (score > 0 && targetYear && candidateYear) {
    const diff = Math.abs(candidateYear - targetYear);
    if (diff === 0) {
      score += 20;
    } else if (diff === 1) {
      score += 15;
    } else if (diff > 3) {
      score -= 25; // Penalize wrong year heavily
    }
  }

  return score;
}

// ----------------------------------------------------------------------------
// Cinemeta Metadata Fetcher (IMDb ID -> Title & Year)
// ----------------------------------------------------------------------------
async function getCinemetaMeta(type, imdbId) {
  const cacheKey = `${type}:${imdbId}`;
  const cached = cinemetaCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
  try {
    const data = await fetchJson(url);
    if (data && data.meta) {
      const meta = {
        name: data.meta.name,
        year: parseInt(String(data.meta.year || data.meta.releaseInfo || '').slice(0, 4), 10) || null,
        type: data.meta.type
      };
      cinemetaCache.set(cacheKey, meta);
      return meta;
    }
  } catch (err) {
    console.error(`[Cinemeta] Failed lookup for ${type} ${imdbId}:`, err.message);
  }
  return null;
}

// ----------------------------------------------------------------------------
// Enhanced DFLIX Search Engine (Combines Full HTML Search + Fast API)
// ----------------------------------------------------------------------------
async function searchDflixAll(query) {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const cacheKey = `search:${cleanQ.toLowerCase()}`;
  const cached = dflixSearchCache.get(cacheKey);
  if (cached) return cached;

  const resultsMap = new Map();

  // Method 1: Search HTML page (returns full library results, up to hundreds of items)
  try {
    const htmlUrl = `${DFLIX_BASE}/search?q=${encodeURIComponent(cleanQ)}`;
    const html = await fetchText(htmlUrl);

    // Regex for search result cards with kind (movie/series/tv)
    const cardRegex = /<a\s+aria-label="Play\s+([^,]+),\s*(\d{4})?,\s*(movie|series|tv)[^"]*"\s+class="[^"]*"\s+href="\/watch\/(\d+)"[\s\S]*?<img[\s\S]*?src="([^"]+)"/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const id = parseInt(match[4], 10);
      const rawTitle = cleanHtmlText(match[1]);
      const year = match[2] ? parseInt(match[2], 10) : null;
      const kindRaw = match[3].toLowerCase();
      const kind = (kindRaw === 'series' || kindRaw === 'tv') ? 'tv' : 'movie';
      const poster = match[5];

      resultsMap.set(id, {
        id,
        title: rawTitle,
        year,
        kind,
        posterPath: poster
      });
    }
  } catch (err) {
    console.error(`[Search HTML] Error for "${cleanQ}":`, err.message);
  }

  // Method 2: Search API fallback / supplement
  try {
    const apiUrl = `${DFLIX_BASE}/api/search?q=${encodeURIComponent(cleanQ)}&limit=50`;
    const data = await fetchJson(apiUrl);
    const apiResults = data.results || [];

    for (const r of apiResults) {
      if (!resultsMap.has(r.id)) {
        resultsMap.set(r.id, {
          id: r.id,
          title: cleanHtmlText(r.title),
          year: r.year || null,
          kind: r.kind === 'tv' ? 'tv' : 'movie',
          posterPath: r.posterPath
        });
      }
    }
  } catch (err) {
    console.error(`[Search API] Error for "${cleanQ}":`, err.message);
  }

  const results = Array.from(resultsMap.values());
  dflixSearchCache.set(cacheKey, results);
  return results;
}

async function getDflixTitle(titleId) {
  const cacheKey = `title:${titleId}`;
  const cached = dflixTitleCache.get(cacheKey);
  if (cached) return cached;

  const url = `${DFLIX_BASE}/api/title/${titleId}`;
  try {
    const data = await fetchJson(url);
    dflixTitleCache.set(cacheKey, data);
    return data;
  } catch (err) {
    console.error(`[DFLIX Title] Error fetching title ${titleId}:`, err.message);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Catalog Engine (Browse & Accurate Search)
// ----------------------------------------------------------------------------
async function getDflixCatalog(type, skip = 0, search = '') {
  const targetKind = type === 'series' ? 'tv' : 'movie';

  // 1. If searching: query our comprehensive search engine!
  if (search && search.trim()) {
    const cleanSearch = search.trim();
    const cacheKey = `cat-search:${type}:${cleanSearch.toLowerCase()}`;
    const cached = catalogCache.get(cacheKey);
    if (cached) return cached;

    console.log(`[Catalog Search] User searched for "${cleanSearch}" in ${type}`);
    const allResults = await searchDflixAll(cleanSearch);

    // Filter by catalog kind (movie vs tv)
    const filtered = allResults.filter(item => item.kind === targetKind);

    const metas = filtered.map(item => {
      const posterUrl = item.posterPath.startsWith('http')
        ? item.posterPath
        : `${DFLIX_BASE}${item.posterPath}`;

      return {
        id: `dflix:${item.id}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.title,
        poster: posterUrl,
        releaseInfo: item.year ? String(item.year) : undefined,
        description: `Watch ${item.title} on DFLIX ISP Server (${item.year || 'N/A'})`
      };
    });

    catalogCache.set(cacheKey, metas, 10 * 60 * 1000); // 10 min cache
    return metas;
  }

  // 2. If browsing default catalog: fetch paginated rows
  const page = Math.floor(skip / 60) + 1;
  const cacheKey = `cat-browse:${type}:p${page}`;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;

  const fetchUrl = `${DFLIX_BASE}/${type === 'series' ? 'tv' : 'movies'}?page=${page}`;

  try {
    const html = await fetchText(fetchUrl);
    const regex = /href="\/watch\/(\d+)"[^>]*>.*?src="([^"]+)".*?<p[^>]*>([^<]+)<\/p>.*?<span>(\d{4})<\/span>/gis;
    const metas = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const posterPath = match[2];
      const rawTitle = cleanHtmlText(match[3]);
      const year = match[4];

      metas.push({
        id: `dflix:${id}`,
        type: type === 'series' ? 'series' : 'movie',
        name: rawTitle,
        poster: posterPath.startsWith('http') ? posterPath : `${DFLIX_BASE}${posterPath}`,
        releaseInfo: year,
        description: `Stream directly from DFLIX ISP Library Server (${year})`
      });
    }

    catalogCache.set(cacheKey, metas);
    return metas;
  } catch (err) {
    console.error(`[DFLIX Catalog] Error fetching ${type} catalog:`, err.message);
    return [];
  }
}

// ----------------------------------------------------------------------------
// Stream Resolver Logic
// ----------------------------------------------------------------------------
async function resolveStreams(itemType, id) {
  let targetSeason = null;
  let targetEpisode = null;
  let dflixTitleId = null;

  // Case 1: DFLIX ID (dflix:1234 or dflix:1234:1:1)
  if (id.startsWith('dflix:')) {
    const parts = id.replace('dflix:', '').split(':');
    dflixTitleId = parseInt(parts[0], 10);
    if (parts.length >= 3) {
      targetSeason = parseInt(parts[1], 10);
      targetEpisode = parseInt(parts[2], 10);
    }
  }
  // Case 2: IMDb ID (tt1234567 or tt1234567:1:1)
  else if (id.startsWith('tt')) {
    const parts = id.split(':');
    const imdbId = parts[0];
    if (parts.length >= 3) {
      targetSeason = parseInt(parts[1], 10);
      targetEpisode = parseInt(parts[2], 10);
    }

    const meta = await getCinemetaMeta(itemType, imdbId);
    if (!meta || !meta.name) {
      return [];
    }

    const query = meta.name;
    const year = meta.year;
    const targetKind = itemType === 'series' ? 'tv' : 'movie';

    console.log(`[Stream Resolver] Querying DFLIX for "${query}" (${year || 'any'}) [${targetKind}]`);
    const results = await searchDflixAll(query);

    // Filter by kind
    const kindResults = results.filter(r => r.kind === targetKind);

    // Score and rank candidates
    let bestScore = -1;
    let bestCandidate = null;

    for (const cand of kindResults) {
      const score = scoreMatch(cand.title, cand.year, query, year);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate || bestScore < 40) {
      console.log(`[Stream Resolver] No confident match for "${query}" (best score: ${bestScore})`);
      return [];
    }

    console.log(`[Stream Resolver] Matched "${query}" -> "${bestCandidate.title}" (${bestCandidate.year}) with score ${bestScore}`);
    dflixTitleId = bestCandidate.id;
  } else {
    return [];
  }

  if (!dflixTitleId) return [];

  // Fetch title details from DFLIX
  const titleData = await getDflixTitle(dflixTitleId);
  if (!titleData || !titleData.files || titleData.files.length === 0) {
    return [];
  }

  const streams = [];

  if (itemType === 'movie') {
    for (const f of titleData.files) {
      const streamUrl = f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`;
      const quality = f.quality || '1080p';
      const codec = f.codec ? ` • ${f.codec.toUpperCase()}` : '';
      const container = f.container ? ` • ${f.container.toUpperCase()}` : '';

      const subtitles = (f.subtitles || []).map(s => ({
        id: String(s.id),
        url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
        lang: s.lang || 'eng'
      }));

      streams.push({
        name: '⚡ DFLIX [BDIX]',
        title: `DFLIX Server • ${quality}${codec}${container}\nHigh-Speed Direct ISP Stream`,
        url: streamUrl,
        behaviorHints: {
          notWebReady: false
        },
        subtitles: subtitles.length > 0 ? subtitles : undefined
      });
    }
  } else if (itemType === 'series') {
    for (const f of titleData.files) {
      if (f.season === targetSeason && f.episode === targetEpisode) {
        const streamUrl = f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`;
        const quality = f.quality || '1080p';
        const codec = f.codec ? ` • ${f.codec.toUpperCase()}` : '';
        const container = f.container ? ` • ${f.container.toUpperCase()}` : '';
        const epTitle = f.episodeTitle ? `${f.episodeTitle}\n` : '';

        const subtitles = (f.subtitles || []).map(s => ({
          id: String(s.id),
          url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
          lang: s.lang || 'eng'
        }));

        streams.push({
          name: '⚡ DFLIX [BDIX]',
          title: `DFLIX • S${f.season}E${f.episode} • ${quality}${codec}${container}\n${epTitle}High-Speed Direct ISP Stream`,
          url: streamUrl,
          behaviorHints: {
            notWebReady: false
          },
          subtitles: subtitles.length > 0 ? subtitles : undefined
        });
      }
    }
  }

  return streams;
}

// ----------------------------------------------------------------------------
// Stremio Addon Manifest
// ----------------------------------------------------------------------------
function getManifest(hostUrl) {
  return {
    id: 'community.dflix.addon',
    version: '1.3.0',
    name: 'DFLIX BDIX Server',
    description: 'High-speed local ISP direct streaming for Movies & TV Shows from DFLIX / BDIX server with subtitles support.',
    logo: 'https://dflix.live/api/branding/logo',
    background: 'https://dflix.live/api/image/backdrop/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'dflix-movies',
        name: 'DFLIX Movies',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      },
      {
        type: 'series',
        id: 'dflix-series',
        name: 'DFLIX TV Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      }
    ],
    idPrefixes: ['tt', 'dflix:']
  };
}

// ----------------------------------------------------------------------------
// HTML Web Dashboard & Installation UI
// ----------------------------------------------------------------------------
function getDashboardHtml(hostUrl) {
  const manifestUrl = `${hostUrl}/manifest.json`;
  const stremioInstallUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DFLIX Stremio & Nuvio Addon</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090b10;
      --card-bg: rgba(22, 27, 34, 0.7);
      --card-border: rgba(255, 255, 255, 0.1);
      --brand: #e50914;
      --brand-hover: #b80710;
      --accent: #3b82f6;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(229, 9, 20, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(59, 130, 246, 0.12) 0px, transparent 50%);
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
      gap: 6px;
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
      background: linear-gradient(135deg, #ffffff 40%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 16px;
      max-width: 600px;
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
      margin-top: 10px;
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
      box-shadow: 0 8px 24px rgba(229, 9, 20, 0.35);
    }
    .btn-primary:hover {
      background: var(--brand-hover);
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(229, 9, 20, 0.45);
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
      color: #93c5fd;
      font-size: 13px;
      overflow-x: auto;
      white-space: nowrap;
      flex: 1;
    }
    .copy-btn {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: 0.2s;
    }
    .copy-btn:hover {
      background: rgba(59, 130, 246, 0.35);
    }
    .steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 14px;
    }
    .step-item {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      color: #fff;
      flex-shrink: 0;
    }
    .step-text h4 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .step-text p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .tester {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }
    .tester input {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px 16px;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    .tester input:focus {
      border-color: var(--accent);
    }
    #testResults {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .stream-pill {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stream-title {
      font-weight: 600;
      font-size: 14px;
    }
    .stream-meta {
      font-size: 12px;
      color: var(--text-muted);
    }
    footer {
      margin-top: 40px;
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge"><div class="dot"></div> DFLIX Server Connected</div>
      <h1>DFLIX BDIX Addon</h1>
      <p class="subtitle">Direct, lightning-fast streaming for Stremio and Nuvio straight from your ISP's DFLIX library server.</p>
    </div>

    <!-- Installation Card -->
    <div class="card">
      <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 6px;">Install to Your Media Player</h2>
      <p style="font-size: 14px; color: var(--text-muted);">Compatible with Stremio (Desktop, Mobile, Android TV, FireStick, Web) and Nuvio.</p>

      <div class="cta-group">
        <a href="${stremioInstallUrl}" class="btn btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
          Install on Stremio
        </a>
        <button onclick="copyManifest()" class="btn btn-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Copy for Nuvio / Web
        </button>
      </div>

      <div class="manifest-box">
        <span class="manifest-url" id="manifestUrlText">${manifestUrl}</span>
        <button class="copy-btn" onclick="copyManifest()">Copy URL</button>
      </div>
    </div>

    <!-- Setup Guide Card -->
    <div class="card">
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 12px;">Quick Setup Instructions</h3>
      <div class="steps">
        <div class="step-item">
          <div class="step-num">1</div>
          <div class="step-text">
            <h4>For Stremio (Desktop / Android / Android TV)</h4>
            <p>Click the <b>"Install on Stremio"</b> button above. Stremio will open and prompt you to install. Alternatively, paste the Manifest URL into the Addons search bar in Stremio.</p>
          </div>
        </div>
        <div class="step-item">
          <div class="step-num">2</div>
          <div class="step-text">
            <h4>For Nuvio App</h4>
            <p>Click <b>"Copy for Nuvio"</b>. Open Nuvio, go to <b>Settings / Addons</b>, paste the Manifest URL and confirm.</p>
          </div>
        </div>
        <div class="step-item">
          <div class="step-num">3</div>
          <div class="step-text">
            <h4>Accurate Search & Playback</h4>
            <p>Search any movie or show in Stremio and press <b>Enter</b> or click. Both your search results and auto-suggestions will show instant <b>⚡ DFLIX [BDIX]</b> streams.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Live Stream Tester -->
    <div class="card">
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">Live Search & Stream Tester</h3>
      <p style="font-size: 13px; color: var(--text-muted);">Verify that your DFLIX ISP server is resolving movies and shows.</p>
      
      <div class="tester">
        <input type="text" id="queryInput" placeholder="Enter title (e.g. Breaking Bad, Avengers, Spider-Man)..." value="Breaking Bad" onkeydown="if(event.key==='Enter') testSearch()">
        <button class="btn btn-secondary" style="flex:0 0 auto;" onclick="testSearch()">Search</button>
      </div>
      <div id="testResults"></div>
    </div>

    <footer>
      DFLIX BDIX Streaming Addon • Powered by Node.js & Stremio Addon Protocol v3
    </footer>
  </div>

  <script>
    function copyManifest() {
      const text = document.getElementById('manifestUrlText').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert('Manifest URL copied to clipboard! Paste it into Nuvio or Stremio Addons.');
      });
    }

    async function testSearch() {
      const q = document.getElementById('queryInput').value.trim();
      const resContainer = document.getElementById('testResults');
      if (!q) return;

      resContainer.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Searching DFLIX server...</div>';

      try {
        const resp = await fetch('/api/test?q=' + encodeURIComponent(q));
        const data = await resp.json();
        if (!data.results || data.results.length === 0) {
          resContainer.innerHTML = '<div style="color:#f87171; font-size:13px;">No titles found on DFLIX for "' + q + '".</div>';
          return;
        }

        let html = '';
        for (const item of data.results) {
          html += '<div class="stream-pill">';
          html += '  <div>';
          html += '    <div class="stream-title">' + item.title + ' (' + (item.year || 'N/A') + ') - ' + item.kind.toUpperCase() + '</div>';
          html += '    <div class="stream-meta">Streams available: ' + item.streamCount + ' • Direct Play Ready</div>';
          html += '  </div>';
          if (item.firstStream) {
            html += '  <a href="' + item.firstStream + '" target="_blank" class="copy-btn" style="text-decoration:none;">Play Direct</a>';
          }
          html += '</div>';
        }
        resContainer.innerHTML = html;
      } catch (err) {
        resContainer.innerHTML = '<div style="color:#f87171; font-size:13px;">Error: ' + err.message + '</div>';
      }
    }
  </script>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// HTTP Server & Router
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS Headers for Stremio Web and Nuvio
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
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const hostUrl = `${protocol}://${host}`;

  try {
    // 1. Dashboard / Homepage
    if (pathname === '/' || pathname === '/configure') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml(hostUrl));
      return;
    }

    // 2. Addon Manifest
    if (pathname === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getManifest(hostUrl)));
      return;
    }

    // 3. Catalogs: /catalog/:type/:id.json or /catalog/:type/:id/:extra.json
    const catalogMatch = pathname.match(/^\/catalog\/([^\/]+)\/([^\/\.]+)(?:\/([^\/]+))?\.json$/);
    if (catalogMatch) {
      const type = catalogMatch[1];
      const catalogId = catalogMatch[2];
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

      const metas = await getDflixCatalog(type, skip, search);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ metas }));
      return;
    }

    // 4. Meta: /meta/:type/:id.json
    const metaMatch = pathname.match(/^\/meta\/([^\/]+)\/([^\/]+)\.json$/);
    if (metaMatch) {
      const type = metaMatch[1];
      const id = metaMatch[2];

      if (id.startsWith('dflix:')) {
        const titleId = parseInt(id.replace('dflix:', '').split(':')[0], 10);
        const titleData = await getDflixTitle(titleId);

        if (titleData) {
          const meta = {
            id: `dflix:${titleData.id}`,
            type: titleData.kind === 'tv' ? 'series' : 'movie',
            name: titleData.title,
            genres: titleData.genres || [],
            poster: titleData.posterUrl ? `${DFLIX_BASE}${titleData.posterUrl}` : undefined,
            background: titleData.backdropUrl ? `${DFLIX_BASE}${titleData.backdropUrl}` : undefined,
            description: titleData.overview || '',
            releaseInfo: String(titleData.year || ''),
            imdbRating: titleData.rating ? String(titleData.rating) : undefined
          };

          // If TV show, populate episode list
          if (titleData.kind === 'tv' && titleData.files) {
            meta.videos = titleData.files.map(f => ({
              id: `dflix:${titleData.id}:${f.season}:${f.episode}`,
              title: f.episodeTitle || `Episode ${f.episode}`,
              season: f.season,
              number: f.episode,
              released: f.airDate ? new Date(f.airDate).toISOString() : undefined,
              thumbnail: f.stillUrl ? `${DFLIX_BASE}${f.stillUrl}` : undefined
            }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ meta }));
          return;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ meta: null }));
      return;
    }

    // 5. Streams: /stream/:type/:id.json
    const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\/]+)\.json$/);
    if (streamMatch) {
      const type = streamMatch[1];
      const id = streamMatch[2];

      const streams = await resolveStreams(type, id);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ streams }));
      return;
    }

    // 6. Test Endpoint for Web Dashboard
    if (pathname === '/api/test') {
      const q = parsedUrl.query.q || '';
      const results = await searchDflixAll(q);
      const testResults = [];

      for (const item of results.slice(0, 5)) {
        const details = await getDflixTitle(item.id);
        const files = details?.files || [];
        const firstFile = files[0];
        const streamUrl = firstFile?.streamUrl ? `${DFLIX_BASE}${firstFile.streamUrl}` : null;

        testResults.push({
          id: item.id,
          title: item.title,
          year: item.year,
          kind: item.kind,
          streamCount: files.length,
          firstStream: streamUrl
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ results: testResults }));
      return;
    }

    // 7. Health / Status check
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', server: 'DFLIX BDIX Addon v1.3.0', dflixBase: DFLIX_BASE }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  } catch (err) {
    console.error(`[Server Error] on ${pathname}:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n============================================================`);
  console.log(`⚡ DFLIX BDIX Addon Server v1.3.0 Running!`);
  console.log(`============================================================`);
  console.log(`• Web Dashboard:  http://localhost:${PORT}`);
  console.log(`• Manifest URL:   http://localhost:${PORT}/manifest.json`);
  console.log(`• Stremio Link:   stremio://localhost:${PORT}/manifest.json`);
  console.log(`• Target Server:  ${DFLIX_BASE}`);
  console.log(`============================================================\n`);
});
