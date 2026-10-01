// ============================================================================
// Database Client (MongoDB Atlas with fallback to local JSON cache)
// ============================================================================

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'dot_internet_bdix';
const LOCAL_CACHE_PATH = path.resolve('data/bdix_cache.json');

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

  return inMemoryStore.streams.get(id) || null;
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
    const obj = {
      streams: Object.fromEntries(inMemoryStore.streams),
      catalogs: inMemoryStore.catalogs,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    // Ignore write errors in serverless
  }
}
