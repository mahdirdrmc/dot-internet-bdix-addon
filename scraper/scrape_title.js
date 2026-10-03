// ============================================================================
// Scraper: On-Demand Title / Show Crawler
// Scrapes all seasons, episodes, and direct stream links for any title
// ============================================================================

import { upsertStream, getStreamById, connectToDatabase } from '../lib/db.js';

const DFLIX_BASE = 'https://dflix.live';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.json();
}

// Find IMDb ID using Cinemeta
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

export async function scrapeTitle(queryOrId) {
  await connectToDatabase();
  console.log(`\n🔍 Searching for "${queryOrId}" on DFlix...`);

  let titleId = null;
  let titleInfo = null;

  if (typeof queryOrId === 'number' || /^\d+$/.test(queryOrId)) {
    titleId = parseInt(queryOrId, 10);
  } else {
    const searchData = await fetchJson(`${DFLIX_BASE}/api/search?q=${encodeURIComponent(queryOrId)}&limit=10`);
    const results = searchData?.results || [];
    if (results.length === 0) {
      console.log(`❌ No results found for "${queryOrId}" on DFlix.`);
      return 0;
    }
    titleInfo = results[0];
    titleId = titleInfo.id;
    console.log(`Found: "${titleInfo.title}" (${titleInfo.year}) [ID: ${titleId}]`);
  }

  // Fetch full title files & stream details
  const details = await fetchJson(`${DFLIX_BASE}/api/title/${titleId}`);
  const title = details.title || titleInfo?.title;
  const year = details.year || titleInfo?.year;
  const isSeries = details.kind === 'tv' || details.files?.some(f => f.season != null);
  const type = isSeries ? 'series' : 'movie';
  const files = details.files || [];

  if (files.length === 0) {
    console.log(`❌ No playable files found for "${title}".`);
    return 0;
  }

  const imdbId = await lookupImdb(title, year, type);
  const targetId = imdbId || `dflix:${titleId}`;
  console.log(`🎬 Target ID: ${targetId} (IMDb: ${imdbId || 'None'}) | Total Files: ${files.length}`);

  let added = 0;

  if (!isSeries) {
    // Movie
    const streams = files.map(f => ({
      source: 'dflix',
      name: `⚡ DFlix [BDIX]\n${f.quality || '1080p'}`,
      title: `${title} • ${f.quality || '1080p'} • ${(f.codec || 'x264').toUpperCase()}\nDot Internet Direct BDIX Stream`,
      url: f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`,
      quality: f.quality || '1080p',
      subtitles: (f.subtitles || []).map(s => ({
        id: String(s.id),
        url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
        lang: s.lang || 'eng'
      })),
      behaviorHints: { notWebReady: false }
    }));

    const existing = await getStreamById(targetId);
    const circleStreams = (existing?.streams || []).filter(s => s.source === 'circleftp');

    await upsertStream({
      _id: targetId,
      imdbId: targetId,
      type: 'movie',
      title,
      year,
      poster: details.posterPath ? `${DFLIX_BASE}/api/image/poster${details.posterPath}` : undefined,
      streams: [...streams, ...circleStreams]
    });
    added++;
  } else {
    // TV Series - Upsert each episode
    for (const f of files) {
      if (!f.season || !f.episode) continue;
      const epId = `${targetId}:${f.season}:${f.episode}`;
      const streamUrl = f.streamUrl.startsWith('http') ? f.streamUrl : `${DFLIX_BASE}${f.streamUrl}`;

      const dflixStream = {
        source: 'dflix',
        name: `⚡ DFlix [BDIX]\n${f.quality || '1080p'}`,
        title: `S${f.season}E${f.episode} - ${f.episodeTitle || 'Episode ' + f.episode}\nDot Internet Direct BDIX Stream`,
        url: streamUrl,
        quality: f.quality || '1080p',
        subtitles: (f.subtitles || []).map(s => ({
          id: String(s.id),
          url: s.url.startsWith('http') ? s.url : `${DFLIX_BASE}${s.url}`,
          lang: s.lang || 'eng'
        })),
        behaviorHints: { notWebReady: false }
      };

      const existing = await getStreamById(epId);
      const circleStreams = (existing?.streams || []).filter(s => s.source === 'circleftp');

      await upsertStream({
        _id: epId,
        imdbId: targetId,
        type: 'series',
        title,
        year,
        season: f.season,
        episode: f.episode,
        poster: details.posterPath ? `${DFLIX_BASE}/api/image/poster${details.posterPath}` : undefined,
        streams: [dflixStream, ...circleStreams]
      });
      added++;
    }
  }

  console.log(`✅ Successfully indexed ${added} streams for "${title}"!`);
  return added;
}

if (process.argv[1]?.endsWith('scrape_title.js')) {
  const query = process.argv.slice(2).join(' ') || 'Reacher';
  scrapeTitle(query).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
