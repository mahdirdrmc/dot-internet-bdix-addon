// ============================================================================
// Scraper: Master Sync Daemon (Runs on PC boot or on-demand)
// ============================================================================

import { connectToDatabase, getTotalStreamCount } from '../lib/db.js';
import { runSeeder } from './seed_from_bridges.js';
import { scrapeDflixRecent } from './scrape_dflix_recent.js';
import fs from 'node:fs';
import path from 'node:path';

const LOG_FILE = path.resolve('scraper/sync.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {}
}

export async function runSync() {
  log('============================================================');
  log('🚀 Starting Dot Internet BDIX Scraper Sync...');
  log('============================================================');

  const { isFallback } = await connectToDatabase();
  log(`Database Mode: ${isFallback ? 'Local Cache (data/bdix_cache.json)' : 'MongoDB Atlas Cloud'}`);

  const initialCount = await getTotalStreamCount();
  log(`Current Indexed Titles: ${initialCount}`);

  // Step 1: If database is empty, seed from existing bridges first
  if (initialCount < 50) {
    log('Database is empty or brand new. Running baseline seeder...');
    try {
      await runSeeder();
    } catch (e) {
      log(`Seeder error: ${e.message}`);
    }
  }

  // Step 2: Incremental crawl for live recent uploads on DFlix
  log('Checking live DFlix ISP server for brand new releases...');
  try {
    await scrapeDflixRecent(5); // checks last 5 pages of movies and series (~300 titles)
  } catch (e) {
    log(`Live scrape error: ${e.message}`);
  }

  const finalCount = await getTotalStreamCount();
  log(`Sync finished successfully! Total Indexed Titles now: ${finalCount}`);

  // Step 3: Automatically push updated cache to GitHub so Render gets the newest titles
  try {
    const { execSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const status = execSync('git status --porcelain data/bdix_cache.json', { cwd: rootDir, encoding: 'utf-8' });
    if (status.trim()) {
      log('Pushing updated BDIX streams to GitHub so Render receives them...');
      execSync('git add data/bdix_cache.json', { cwd: rootDir, stdio: 'ignore' });
      execSync('git commit -m "Auto-sync BDIX streams from PC scraper"', { cwd: rootDir, stdio: 'ignore' });
      execSync('git push origin main', { cwd: rootDir, stdio: 'ignore' });
      log('✅ GitHub updated! Render will serve newest scraped releases.');
    } else {
      log('Cache is already in sync with GitHub.');
    }
  } catch (e) {
    log(`Git auto-push notice: ${e.message}`);
  }

  log('============================================================\n');
}

runSync()
  .then(() => process.exit(0))
  .catch(err => {
    log(`Fatal Error in sync: ${err.message}`);
    process.exit(1);
  });
