const express = require('express');
const axios = require('axios');
const path = require('path');
const { ANIME } = require('@consumet/extensions');

const app = express();
const PORT = process.env.PORT || 3000;
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    cache.delete(oldest[0]);
  }
  cache.set(key, { data, time: Date.now() });
}

const unity = new ANIME.AnimeUnity();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

let lastJikanCall = 0;

app.use('/api/anime', async (req, res) => {
  const cacheKey = req.originalUrl;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const now = Date.now();
    const wait = Math.max(0, 400 - (now - lastJikanCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    const targetUrl = `${JIKAN_BASE}${req.url}`;
    const response = await axios.get(targetUrl, {
      params: req.query,
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });
    lastJikanCall = Date.now();
    setCache(cacheKey, response.data);
    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 429) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.use('/api/search', async (req, res) => {
  const cacheKey = req.originalUrl;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    const now = Date.now();
    const wait = Math.max(0, 400 - (now - lastJikanCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    const response = await axios.get(`${JIKAN_BASE}/anime`, {
      params: { q, sfw: true, limit: 25, ...req.query },
      timeout: 10000
    });
    lastJikanCall = Date.now();
    setCache(cacheKey, response.data);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const results = await unity.search(q);
    const filtered = (results.results || []).filter(r => !r.title?.includes('(ITA)'));
    res.json({ results: filtered });
  } catch (err) {
    res.status(500).json({ error: 'Stream search failed', detail: err.message });
  }
});

app.get('/api/stream/info', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const info = await unity.fetchAnimeInfo(id);
    const episodes = (info.episodes || []).map(ep => ({
      id: ep.id,
      number: ep.number,
      title: ep.title || `Episode ${ep.number}`,
      url: ep.url
    }));
    res.json({ ...info, episodes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch anime info', detail: err.message });
  }
});

app.get('/api/stream/watch', async (req, res) => {
  try {
    const { episodeId } = req.query;
    if (!episodeId) return res.status(400).json({ error: 'Missing episodeId' });
    const sources = await unity.fetchEpisodeSources(episodeId);
    res.json(sources);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stream', detail: err.message });
  }
});

app.get('/api/proxy-video', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'Referer': 'https://www.animeunity.to/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Proxy failed' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AnimeStream running at http://localhost:${PORT}`);
});
