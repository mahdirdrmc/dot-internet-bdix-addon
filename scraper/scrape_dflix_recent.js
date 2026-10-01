// ============================================================================
// Scraper: Incremental Live DFLIX Crawler (Recent & New Uploads)
// ============================================================================

import { upsertStream, getStreamById } from '../lib/db.js';

const DFLIX_BASE = 'https://dflix.live';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Find IMDb ID using Cinemeta search
async function lookupImdb(title, year, type) {
  try {
    const q = encodeURIComponent(title);
    const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${q}.json`;
    const data = await fetchJson(url);
    const metas = data.metas || [];

    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const m of metas) {
      const mTitle = (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const mYear = parseInt(String(m.year || m.releaseInfo || '').slice(0, 4), 10);
      if (mTitle === cleanTitle) {
        if (!year || !mYear || Math.abs(mYear - year) <= 1) {
          return m.id;
        }
      }
    }
    return metas[0]?.id || null;
  } catch (e) {
    return null;
  }
}

export async function scrapeDflixRecent(pages = 3) {
  console.log(`\n[DFlix Scraper] Checking latest ${pages} pages of uploads...`);

  const cardRegex = /<a\s+aria-label="Play\s+([^,]+),\s*(\d{4})?,\s*(movie|series|tv)[^"]*"\s+class="[^"]*"\s+href="\/watch\/(\d+)"[\s\S]*?<img[\s\S]*?src="([^"]+)"/gi;

  const titlesToProcess = [];

  for (let p = 1; p <= pages; p++) {
    // Movies
    try {
      const html = await fetchText(`${DFLIX_BASE}/movies?page=${p}`);
      let match;
      while ((match = cardRegex.exec(html)) !== null) {
        titlesToProcess.push({
          title: match[1].trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
          year: match[2] ? parseInt(match[2], 10) : null,
          type: 'movie',
          dflixId: parseInt(match[4], 10),
          poster: match[5]
        });
      }
    } catch (e) {
      console.log(`  Failed fetching movie page ${p}:`, e.message);
    }

    // TV Series
    try {
      const html = await fetchText(`${DFLIX_BASE}/tv?page=${p}`);
      let match;
      while ((match = cardRegex.exec(html)) !== null) {
        titlesToProcess.push({
          title: match[1].trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
          year: match[2] ? parseInt(match[2], 10) : null,
          type: 'series',
          dflixId: parseInt(match[4], 10),
          poster: match[5]
        });
      }
    } catch (e) {
      console.log(`  Failed fetching tv page ${p}:`, e.message);
    }
  }

  console.log(`[DFlix Scraper] Found ${titlesToProcess.length} recent titles. Extracting details & streams...`);

  let synced = 0;

  for (const item of titlesToProcess) {
    try {
      // 1. Fetch title files details
      const titleData = await fetchJson(`${DFLIX_BASE}/api/title/${item.dflixId}`);
      const files = titleData?.files || [];
      if (files.length === 0) continue;

      // 2. Lookup IMDb ID
      const imdbId = await lookupImdb(item.title, item.year, item.type);
      const targetId = imdbId || `dflix:${item.dflixId}`;

      if (item.type === 'movie') {
        const dflixStreams = files.map(f => ({
          source: 'dflix',
          name: '⚡ DFlix [BDIX]',
          title: `DFlix • ${f.quality || '1080p'} • ${(f.codec || 'x264').toUpperCase()}\nDot Internet Direct Stream`,
          url: f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`,
          quality: f.quality || '1080p',
          subtitles: (f.subtitles || []).map(s => ({
            id: String(s.id),
            url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
            lang: s.lang || 'eng'
          }))
        }));

        // Preserve any existing CircleFTP streams for this title!
        const existing = await getStreamById(targetId);
        const circleStreams = (existing?.streams || []).filter(s => s.source === 'circleftp');

        await upsertStream({
          _id: targetId,
          imdbId: targetId,
          type: 'movie',
          title: item.title,
          year: item.year,
          poster: item.poster.startsWith('http') ? item.poster : `${DFLIX_BASE}${item.poster}`,
          streams: [...dflixStreams, ...circleStreams]
        });
        synced++;
      } else if (item.type === 'series') {
        // Upsert each episode
        for (const f of files) {
          if (!f.season || !f.episode) continue;
          const epId = `${targetId}:${f.season}:${f.episode}`;
          const streamUrl = f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`;

          const dflixStream = {
            source: 'dflix',
            name: '⚡ DFlix [BDIX]',
            title: `DFlix • S${f.season}E${f.episode} • ${f.quality || '1080p'}\n${f.episodeTitle || ''}\nDot Internet Direct Stream`,
            url: streamUrl,
            quality: f.quality || '1080p',
            subtitles: (f.subtitles || []).map(s => ({
              id: String(s.id),
              url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
              lang: s.lang || 'eng'
            }))
          };

          const existing = await getStreamById(epId);
          const circleStreams = (existing?.streams || []).filter(s => s.source === 'circleftp');

          await upsertStream({
            _id: epId,
            imdbId: targetId,
            type: 'series',
            title: item.title,
            year: item.year,
            season: f.season,
            episode: f.episode,
            poster: item.poster.startsWith('http') ? item.poster : `${DFLIX_BASE}${item.poster}`,
            streams: [dflixStream, ...circleStreams]
          });
        }
        synced++;
      }
    } catch (e) {
      // Continue to next
    }
  }

  console.log(`[DFlix Scraper] Synced ${synced} recent titles with latest direct streams!`);
}

if (process.argv[1]?.endsWith('scrape_dflix_recent.js')) {
  scrapeDflixRecent().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
