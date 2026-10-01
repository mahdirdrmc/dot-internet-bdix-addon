// ============================================================================
// High-Speed Deep Archive Scraper for DFLIX & CircleFTP
// Built for 64GB RAM & High-Concurrency BDIX Connection
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { upsertStream, connectToDatabase, getTotalStreamCount } from '../lib/db.js';

const DFLIX_BASE = 'https://dflix.live';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const CHECKPOINT_PATH = path.resolve('data/crawler_checkpoint.json');
const CONCURRENCY = 25; // High-speed parallel requests

let checkpoint = { moviePage: 1, tvPage: 1, totalCrawled: 0 };
if (fs.existsSync(CHECKPOINT_PATH)) {
  try {
    checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8'));
  } catch (e) {}
}

function saveCheckpoint() {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch (e) {}
}

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

export async function runDeepArchive(maxPagesToCrawl = 50) {
  await connectToDatabase();
  console.log('============================================================');
  console.log('⚡ Starting High-Speed BDIX Deep Archive Scraper');
  console.log('============================================================');
  console.log(`Starting Movie Page: ${checkpoint.moviePage}`);
  console.log(`Starting TV Page:    ${checkpoint.tvPage}`);
  console.log(`Total Indexed so far: ${await getTotalStreamCount()}`);
  console.log('============================================================\n');

  const cardRegex = /<a\s+aria-label="Play\s+([^,]+),\s*(\d{4})?,\s*(movie|series|tv)[^"]*"\s+class="[^"]*"\s+href="\/watch\/(\d+)"[\s\S]*?<img[\s\S]*?src="([^"]+)"/gi;

  const endMoviePage = checkpoint.moviePage + maxPagesToCrawl;

  for (let page = checkpoint.moviePage; page < endMoviePage; page++) {
    console.log(`\n[Crawling Movie Page ${page}]...`);
    let html = '';
    try {
      html = await fetchText(`${DFLIX_BASE}/movies?page=${page}`);
    } catch (e) {
      console.log(`Error fetching page ${page}:`, e.message);
      continue;
    }

    const titles = [];
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      titles.push({
        title: match[1].trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'"),
        year: match[2] ? parseInt(match[2], 10) : null,
        type: 'movie',
        dflixId: parseInt(match[4], 10),
        poster: match[5]
      });
    }

    if (titles.length === 0) {
      console.log('No more movies found on this page.');
      break;
    }

    // Process titles in batches with CONCURRENCY
    for (let i = 0; i < titles.length; i += CONCURRENCY) {
      const batch = titles.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (item) => {
        try {
          const titleData = await fetchJson(`${DFLIX_BASE}/api/title/${item.dflixId}`);
          const files = titleData?.files || [];
          if (files.length === 0) return;

          const imdbId = await lookupImdb(item.title, item.year, item.type);
          const targetId = imdbId || `dflix:${item.dflixId}`;

          const streams = files.map(f => ({
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

          await upsertStream({
            _id: targetId,
            imdbId: targetId,
            type: 'movie',
            title: item.title,
            year: item.year,
            poster: item.poster.startsWith('http') ? item.poster : `${DFLIX_BASE}${item.poster}`,
            streams
          });
          checkpoint.totalCrawled++;
        } catch (err) {}
      }));
      process.stdout.write(`  Indexed ${i + batch.length} / ${titles.length} movies on page ${page}...\r`);
    }

    checkpoint.moviePage = page + 1;
    saveCheckpoint();
  }

  console.log(`\n\n[SUCCESS] Crawl batch complete! Total titles indexed: ${await getTotalStreamCount()}`);
}

if (process.argv[1]?.endsWith('scrape_deep_archive.js')) {
  const pages = parseInt(process.argv[2] || '30', 10);
  runDeepArchive(pages).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
