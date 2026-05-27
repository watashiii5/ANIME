const axios = require('axios');

const GOGO_BASE = 'https://gogoanime.cl';

async function search(query) {
  const { data } = await axios.get(`${GOGO_BASE}/search.html`, {
    params: { keyword: query },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const regex = /<a href="\/category\/([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*>\s*<p[^>]*class="name"[^>]*>\s*([^<]+)/gi;
  const results = [];
  let m;
  while ((m = regex.exec(data)) !== null) {
    results.push({ id: m[1], title: m[3].trim(), image: m[2], url: `${GOGO_BASE}/category/${m[1]}` });
  }
  return results.slice(0, 25);
}

async function getEpisodes(animeId) {
  const epStart = 0;
  const { data } = await axios.get(`${GOGO_BASE}/ajax/load-list-episode`, {
    params: { ep_start: epStart, ep_end: 99999, id: animeId },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'X-Requested-With': 'XMLHttpRequest' }
  });
  const regex = /<a href="(?:[^"]*\/|)([^"]+?)" class="[^"]*css-[^"]*"[^>]*>\s*(\d+)\s*</gi;
  const episodes = [];
  let m;
  while ((m = regex.exec(data)) !== null) {
    const epId = m[1].replace(/^\/+/, '');
    episodes.push({
      id: epId,
      number: parseInt(m[2]),
      title: `Episode ${parseInt(m[2])}`,
      url: `${GOGO_BASE}/${epId}`,
      embedUrl: `${GOGO_BASE}/embed/${epId.replace(/^\//, '')}`
    });
  }
  return episodes.sort((a, b) => a.number - b.number);
}

module.exports = { search, getEpisodes };
