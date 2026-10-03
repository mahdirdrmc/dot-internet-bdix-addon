// ============================================================================
// Database Client (MongoDB Atlas with fallback to local JSON cache)
// ============================================================================

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'dot_internet_bdix';
const LOCAL_CACHE_PATH = path.resolve(__dirname, '../data/bdix_cache.json');

let cachedClient = null;
let cachedDb = null;

// In-memory fallback if no MongoDB URI is provided
let inMemoryStore = {
  streams: new Map(),
  catalogs: { movie: [], series: [] }
};

// Load local cache file if exists
if (fs.existsSync(LOCAL_CACHE_PATH)) {
  try {
    const raw = fs.readFileSync(LOCAL_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.streams) {
      for (const [k, v] of Object.entries(parsed.streams)) {
        inMemoryStore.streams.set(k, v);
      }
    }
    if (parsed.catalogs) {
      inMemoryStore.catalogs = parsed.catalogs;
    }
  } catch (e) {
    console.error('[DB] Error loading local cache:', e.message);
  }
}

export async function syncFromRemoteCache() {
  try {
    const remoteUrl = 'https://raw.githubusercontent.com/mahdirdrmc/dot-internet-bdix-addon/main/data/bdix_cache.json';
    const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const remoteData = await res.json();
    if (remoteData?.streams) {
      let count = 0;
      for (const [k, v] of Object.entries(remoteData.streams)) {
        if (!inMemoryStore.streams.has(k) || remoteData.updatedAt > inMemoryStore.streams.get(k)?.updatedAt) {
          inMemoryStore.streams.set(k, v);
          count++;
        }
      }
      if (count > 0) {
        console.log(`[DB] Synced ${count} streams from GitHub remote cache! Total now: ${inMemoryStore.streams.size}`);
      }
    }
  } catch (e) {
    // Ignore remote fetch errors
  }
}

export async function connectToDatabase() {
  if (!MONGODB_URI) {
    return { client: null, db: null, isFallback: true };
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb, isFallback: false };
  }

  try {
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    await client.connect();
    const db = client.db(DB_NAME);

    // Ensure indexes for fast lookups
    await db.collection('streams').createIndex({ imdbId: 1 });
    await db.collection('streams').createIndex({ type: 1 });
    await db.collection('streams').createIndex({ title: 'text' });

    cachedClient = client;
    cachedDb = db;
    return { client, db, isFallback: false };
  } catch (err) {
    console.error('[DB] MongoDB connection failed, falling back to in-memory:', err.message);
    return { client: null, db: null, isFallback: true };
  }
}

// ----------------------------------------------------------------------------
// High-level Database Operations
// ----------------------------------------------------------------------------

export async function getStreamById(id) {
  const { db, isFallback } = await connectToDatabase();

  if (!isFallback && db) {
    return await db.collection('streams').findOne({ _id: id });
  }

  if (inMemoryStore.streams.has(id)) {
    return inMemoryStore.streams.get(id);
  }

  // Check disk cache in case it was updated by another process
  if (fs.existsSync(LOCAL_CACHE_PATH)) {
    try {
      const diskData = JSON.parse(fs.readFileSync(LOCAL_CACHE_PATH, 'utf-8'));
      if (diskData.streams && diskData.streams[id]) {
        inMemoryStore.streams.set(id, diskData.streams[id]);
        return diskData.streams[id];
      }
    } catch (e) {}
  }

  return null;
}

export async function upsertStream(item) {
  const { db, isFallback } = await connectToDatabase();

  if (!isFallback && db) {
    await db.collection('streams').updateOne(
      { _id: item._id },
      {
        $set: {
          ...item,
          updatedAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    return;
  }

  inMemoryStore.streams.set(item._id, {
    ...item,
    updatedAt: new Date().toISOString()
  });

  // Periodically save local JSON cache
  saveLocalCache();
}

export async function getCatalogItems(type, skip = 0, limit = 50, search = '') {
  const { db, isFallback } = await connectToDatabase();

  if (!isFallback && db) {
    const query = { type };
    if (search) {
      query.$text = { $search: search };
    }
    const items = await db.collection('streams')
      .find(query)
      .skip(skip)
      .limit(limit)
      .sort({ updatedAt: -1 })
      .toArray();

    return items;
  }

  // Fallback memory search
  let all = Array.from(inMemoryStore.streams.values()).filter(x => x.type === type);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(x => x.title && x.title.toLowerCase().includes(q));
  }
  return all.slice(skip, skip + limit);
}

export async function getTotalStreamCount() {
  const { db, isFallback } = await connectToDatabase();
  if (!isFallback && db) {
    return await db.collection('streams').countDocuments();
  }
  return inMemoryStore.streams.size;
}

function saveLocalCache() {
  try {
    const dir = path.dirname(LOCAL_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let onDiskStreams = {};
    let onDiskCatalogs = inMemoryStore.catalogs;
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      try {
        const currentRaw = JSON.parse(fs.readFileSync(LOCAL_CACHE_PATH, 'utf-8'));
        onDiskStreams = currentRaw.streams || {};
        if (currentRaw.catalogs) onDiskCatalogs = currentRaw.catalogs;
      } catch (e) {}
    }

    const mergedStreams = {
      ...onDiskStreams,
      ...Object.fromEntries(inMemoryStore.streams)
    };

    const obj = {
      streams: mergedStreams,
      catalogs: onDiskCatalogs,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    console.error('[DB] Failed to save local cache to', LOCAL_CACHE_PATH, e.message);
  }
}
