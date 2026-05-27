const express = require('express');
const axios = require('axios');
const path = require('path');
const { ANIME } = require('@consumet/extensions');

const app = express();
const PORT = process.env.PORT || 3000;
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cached(key, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}
function cacheSet(key, data) {
  if (cache.size > 500) cache.delete([...cache.keys()][0]);
  cache.set(key, { data, time: Date.now() });
}

const providers = {
  animeunity: new ANIME.AnimeUnity(),
  animesaturn: new ANIME.AnimeSaturn(),
};

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

let lastJikan = 0;
const jikanQueue = [];
let processingQueue = false;

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (jikanQueue.length > 0) {
    const { resolve, reject, url, params, key } = jikanQueue.shift();
    try {
      const wait = Math.max(0, 1200 - (Date.now() - lastJikan));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const r = await axios.get(url, { params, timeout: 15000 });
      lastJikan = Date.now();
      if (key) cacheSet(key, r.data);
      resolve(r.data);
    } catch (e) {
      if (e.response?.status === 429) {
        const stale = key && cached(key);
        if (stale) { resolve(stale); continue; }
        await new Promise(r => setTimeout(r, 3000));
        jikanQueue.unshift({ resolve, reject, url, params, key });
        continue;
      }
      reject(e);
    }
  }
  processingQueue = false;
}

function jikanGet(url, params = {}, key = null) {
  return new Promise((resolve, reject) => {
    const cachedData = key && cached(key);
    if (cachedData) return resolve(cachedData);
    jikanQueue.push({ resolve, reject, url, params, key });
    processQueue();
  });
}

app.use('/api/anime', async (req, res) => {
  try {
    const key = req.originalUrl;
    const data = await jikanGet(`${JIKAN_BASE}${req.url}`, req.query, key);
    res.json(data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.use('/api/search', async (req, res) => {
  try {
    if (!req.query.q) return res.status(400).json({ error: 'Missing query' });
    const key = req.originalUrl;
    const data = await jikanGet(`${JIKAN_BASE}/anime`, { q: req.query.q, sfw: true, limit: 25, ...req.query }, key);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function tryAll(action) {
  const names = Object.keys(providers);
  for (const name of names) {
    try {
      const result = await action(providers[name], name);
      return { provider: name, result };
    } catch (e) {
      if (name === names[names.length - 1]) throw e;
    }
  }
}

app.get('/api/stream/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const { provider, result } = await tryAll(async (p) => {
      const r = await p.search(q);
      const filtered = (r.results || []).filter(x => !x.title?.includes('(ITA)'));
      if (filtered.length === 0) throw new Error('no results');
      return filtered;
    });
    res.json({ results: result, provider });
  } catch (e) {
    res.status(500).json({ error: 'Stream search failed', detail: e.message });
  }
});

app.get('/api/stream/info', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const preferred = req.query.provider;

    if (preferred && providers[preferred]) {
      try {
        const info = await providers[preferred].fetchAnimeInfo(id);
        return res.json({ episodes: (info.episodes || []).map(e => ({ id: e.id, number: e.number, title: e.title || `Episode ${e.number}`, url: e.url })) });
      } catch (e) {}
    }

    const { result } = await tryAll(async (p) => {
      const info = await p.fetchAnimeInfo(id);
      return { episodes: (info.episodes || []).map(e => ({ id: e.id, number: e.number, title: e.title || `Episode ${e.number}`, url: e.url })) };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch anime info', detail: e.message });
  }
});

app.get('/api/stream/watch', async (req, res) => {
  try {
    const id = req.query.episodeId;
    if (!id) return res.status(400).json({ error: 'Missing episodeId' });
    const { result } = await tryAll((p) => p.fetchEpisodeSources(id));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stream', detail: e.message });
  }
});

app.get('/api/proxy-video', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    const r = await axios.get(url, {
      responseType: 'stream', timeout: 30000,
      headers: { 'Referer': 'https://www.animeunity.to/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    res.set('Content-Type', r.headers['content-type'] || 'application/octet-stream');
    res.set('Access-Control-Allow-Origin', '*');
    if (r.headers['content-length']) res.set('Content-Length', r.headers['content-length']);
    r.data.pipe(res);
  } catch (e) { res.status(500).json({ error: 'Proxy failed', detail: e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`WatashiStream running at http://localhost:${PORT}`);
});
