const express = require('express');
const axios = require('axios');
const path = require('path');
const { ANIME } = require('@consumet/extensions');

const app = express();
const PORT = process.env.PORT || 3000;
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  cache.delete(key); return null;
}
function cacheSet(key, data) {
  if (cache.size > 500) cache.delete([...cache.keys()][0]);
  cache.set(key, { data, time: Date.now() });
}

const providers = [
  { name: 'hianime', instance: new ANIME.Hianime() },
  { name: 'animesaturn', instance: new ANIME.AnimeSaturn() },
  { name: 'animeunity', instance: new ANIME.AnimeUnity() },
];

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
    const d = key && cached(key);
    if (d) return resolve(d);
    jikanQueue.push({ resolve, reject, url, params, key });
    processQueue();
  });
}

app.use('/api/anime', async (req, res) => {
  try {
    const data = await jikanGet(`${JIKAN_BASE}${req.url}`, req.query, req.originalUrl);
    res.json(data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.use('/api/search', async (req, res) => {
  try {
    if (!req.query.q) return res.status(400).json({ error: 'Missing query' });
    const data = await jikanGet(`${JIKAN_BASE}/anime`, { q: req.query.q, sfw: true, limit: 25, ...req.query }, req.originalUrl);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function tryAll(action) {
  const errors = [];
  for (const p of providers) {
    try {
      const result = await action(p.instance, p.name);
      return { provider: p.name, result };
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error('All providers failed: ' + errors.join(' | '));
}

app.get('/api/stream/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const { provider, result } = await tryAll(async (inst) => {
      const r = await inst.search(q);
      return (r.results || []).filter(x => !x.title?.includes('(ITA)'));
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

    if (preferred) {
      const p = providers.find(x => x.name === preferred);
      if (p) {
        try {
          const info = await p.instance.fetchAnimeInfo(id);
          return res.json({
            episodes: (info.episodes || []).map(e => ({
              id: e.id, number: e.number,
              title: e.title || `Episode ${e.number}`,
              url: e.url
            }))
          });
        } catch (e) {}
      }
    }

    const { result } = await tryAll(async (inst) => {
      const info = await inst.fetchAnimeInfo(id);
      return {
        episodes: (info.episodes || []).map(e => ({
          id: e.id, number: e.number,
          title: e.title || `Episode ${e.number}`,
          url: e.url
        }))
      };
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
    const preferred = req.query.provider;

    if (preferred) {
      const p = providers.find(x => x.name === preferred);
      if (p) {
        try {
          const src = await p.instance.fetchEpisodeSources(id);
          return res.json(src);
        } catch (e) {}
      }
    }

    const { result } = await tryAll((inst) => inst.fetchEpisodeSources(id));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stream', detail: e.message });
  }
});

const OS = require('opensubtitles-api');
const osClient = new OS('WatashiStream v1.0');

app.get('/api/subtitles', async (req, res) => {
  try {
    const query = req.query.q;
    const episode = req.query.episode;
    const season = req.query.season || '1';
    if (!query) return res.status(400).json({ error: 'Missing query' });
    const result = await osClient.search({ sublanguageid: 'eng', query, season, episode: episode || '' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Subtitle search failed', detail: e.message });
  }
});

app.get('/api/proxy-hls', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const response = await axios.get(url, {
      responseType: 'stream', timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': req.query.referer || 'https://www.animeunity.to',
      },
      validateStatus: () => true
    });

    if (response.status !== 200) {
      return res.status(502).json({ error: 'Upstream ' + response.status });
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');

    let data = '';
    response.data.on('data', chunk => data += chunk.toString());
    response.data.on('end', () => {
      const base = url.substring(0, url.lastIndexOf('/') + 1);
      const segments = data.split('\n').map(line => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith('#')) return line;
        const segmentUrl = t.startsWith('http') ? t : new URL(t, base).href;
        return `/api/proxy-segment?referer=${encodeURIComponent(req.query.referer || '')}&url=${encodeURIComponent(segmentUrl)}`;
      }).join('\n');
      res.send(segments);
    });
  } catch (e) {
    res.status(500).json({ error: 'HLS proxy failed', detail: e.message });
  }
});

app.get('/api/proxy-segment', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const response = await axios.get(url, {
      responseType: 'stream', timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': req.query.referer || 'https://www.animeunity.to',
      },
      validateStatus: () => true
    });

    if (response.status !== 200) {
      return res.status(502).json({ error: 'Segment error ' + response.status });
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    response.data.pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'Segment proxy failed' });
  }
});

app.get('/api/embed-page', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      responseType: 'text',
      timeout: 15000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      return res.status(response.status).json({ error: 'Upstream ' + response.status });
    }

    let html = response.data;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.removeHeader('Content-Security-Policy');

    html = html.replace(/<base\s[^>]*>/gi, `<base href="${url.replace(/\/[^/]*$/, '/')}">`);
    html = html.replace(/x-frame-options/gi, 'x-frame-options-allow');
    html = html.replace(/X-Frame-Options/gi, 'X-Frame-Options-Allow');
    html = html.replace(/frame-ancestors/gi, 'frame-ancestors-allow');
    html = html.replace(/top\.location/gi, '//top.location');
    html = html.replace(/parent\.location/gi, '//parent.location');
    html = html.replace(/self\.location/gi, '//self.location');
    html = html.replace(/window\.location/gi, 'window.location_url');

    res.send(html);
  } catch (e) {
    res.status(500).json({ error: 'Embed proxy failed', detail: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`WatashiStream running at http://localhost:${PORT}`);
  console.log(`Providers: ${providers.map(p => p.name).join(', ')}`);
});
