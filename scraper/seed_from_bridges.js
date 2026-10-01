// ============================================================================
// Scraper: Seed baseline streams from existing bridges (DFlix + CircleFTP)
// ============================================================================

import { upsertStream, connectToDatabase } from '../lib/db.js';

const DFLIX_BRIDGE = 'https://dstremio.mehedihtanvir.me';
const CIRCLE_BRIDGE = 'https://cstremio.mehedihtanvir.me';
const MAX_PAGES = 10; // 50 items per page = 500 movies + 500 series

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function seedCatalog(bridgeHost, catalogId, type) {
  console.log(`\nFetching catalog items from ${bridgeHost} (${catalogId})...`);
  const items = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * 50;
    const url = `${bridgeHost}/catalog/${type}/${catalogId}/skip=${skip}.json`;
    const data = await fetchJson(url);
    const metas = data?.metas || [];
    if (metas.length === 0) break;
    items.push(...metas);
    process.stdout.write(`  Fetched page ${page + 1}: ${items.length} titles...\r`);
  }

  console.log(`\nFound ${items.length} titles in ${catalogId}. Extracting streams...`);
  return items;
}

export async function runSeeder() {
  await connectToDatabase();
  console.log('--- Starting Baseline Seeder (DFlix & CircleFTP) ---');

  // 1. Get DFlix items
  const dflixMovies = await seedCatalog(DFLIX_BRIDGE, 'dflix_movies_catalog', 'movie');
  const dflixSeries = await seedCatalog(DFLIX_BRIDGE, 'dflix_series_catalog', 'series');

  // 2. Get CircleFTP items
  const circleMovies = await seedCatalog(CIRCLE_BRIDGE, 'circleftp_movies_catalog', 'movie');
  const circleSeries = await seedCatalog(CIRCLE_BRIDGE, 'circleftp_series_catalog', 'series');

  const allMovies = [...new Map([...dflixMovies, ...circleMovies].map(item => [item.id, item])).values()];
  const allSeries = [...new Map([...dflixSeries, ...circleSeries].map(item => [item.id, item])).values()];

  console.log(`\nTotal unique movies to process: ${allMovies.length}`);
  console.log(`Total unique series to process: ${allSeries.length}`);

  let processed = 0;

  // Process movies with concurrency of 15
  const CONCURRENCY = 15;
  for (let i = 0; i < allMovies.length; i += CONCURRENCY) {
    const batch = allMovies.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (m) => {
      const id = m.id;
      const streams = [];

      // DFlix stream
      const dData = await fetchJson(`${DFLIX_BRIDGE}/stream/movie/${id}.json`);
      if (dData?.streams) {
        for (const s of dData.streams) {
          streams.push({
            source: 'dflix',
            name: '⚡ DFlix [BDIX]',
            title: s.title || 'DFlix Direct Stream',
            url: s.url,
            quality: '1080p'
          });
        }
      }

      // CircleFTP stream
      const cData = await fetchJson(`${CIRCLE_BRIDGE}/stream/movie/${id}.json`);
      if (cData?.streams) {
        for (const s of cData.streams) {
          streams.push({
            source: 'circleftp',
            name: '⚡ CircleFTP [BDIX]',
            title: s.title || 'CircleFTP Direct Stream',
            url: s.url,
            quality: '1080p'
          });
        }
      }

      if (streams.length > 0) {
        await upsertStream({
          _id: id,
          imdbId: id,
          type: 'movie',
          title: m.name,
          year: m.releaseInfo ? parseInt(m.releaseInfo, 10) : null,
          poster: m.poster,
          streams
        });
      }
      processed++;
    }));
    process.stdout.write(`Processed ${processed} / ${allMovies.length} movies...\r`);
  }

  console.log(`\n[SUCCESS] Seeding complete! Database is now loaded with active BDIX streams.`);
}

// Allow direct execution
if (process.argv[1]?.endsWith('seed_from_bridges.js')) {
  runSeeder().then(() => process.exit(0)).catch(e => {
    console.error('Seeder error:', e);
    process.exit(1);
  });
}
