const API = {
  async get(endpoint, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      const res = await fetch(endpoint);
      if (res.ok) return res.json();
      if (res.status === 429 && i < retries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      let detail = '';
      try { const j = await res.clone().json(); detail = j.detail || j.error || ''; } catch {}
      throw new Error(detail || (res.status === 429 ? 'Rate limited - try again' : `HTTP ${res.status}`));
    }
  },
  searchAnime(query, page = 1) {
    return this.get(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
  },
  topAnime(filter = 'airing', page = 1) {
    return this.get(`/api/anime/top/anime?filter=${filter}&page=${page}`);
  },
  seasonalAnime(page = 1) {
    return this.get(`/api/anime/seasons/now?page=${page}`);
  },
  upcomingAnime(page = 1) {
    return this.get(`/api/anime/seasons/upcoming?page=${page}`);
  },
  animeDetail(id) {
    return this.get(`/api/anime/anime/${id}/full`);
  },
  animeEpisodes(id, page = 1) {
    return this.get(`/api/anime/anime/${id}/episodes?page=${page}`);
  },
  topMovies(page = 1) {
    return this.get(`/api/anime/top/anime?type=movie&page=${page}`);
  },
  streamSearch(query) {
    return this.get(`/api/stream/search?q=${encodeURIComponent(query)}`);
  },
  streamInfo(id, provider) {
    let url = `/api/stream/info?id=${encodeURIComponent(id)}`;
    if (provider) url += `&provider=${provider}`;
    return this.get(url);
  },
  streamWatch(episodeId) {
    return this.get(`/api/stream/watch?episodeId=${encodeURIComponent(episodeId)}`);
  }
};

const Tracker = {
  _data: null,

  _load() {
    if (this._data) return this._data;
    try {
      this._data = JSON.parse(localStorage.getItem('animeTracker')) || { continue: [], watched: {} };
    } catch {
      this._data = { continue: [], watched: {} };
    }
    return this._data;
  },

  _save() {
    localStorage.setItem('animeTracker', JSON.stringify(this._data));
  },

  saveProgress(animeId, animeTitle, animeImage, episodeId, episodeNumber, progress, duration) {
    const data = this._load();
    const existing = data.continue.findIndex(e => e.animeId === animeId);
    const entry = {
      animeId, animeTitle, animeImage, episodeId,
      episodeNumber, progress, duration,
      updatedAt: Date.now(), completed: duration > 0 && progress / duration > 0.9
    };

    if (existing >= 0) {
      const old = data.continue[existing];
      if (episodeNumber > old.episodeNumber || (episodeNumber === old.episodeNumber && progress > old.progress)) {
        data.continue[existing] = entry;
      }
    } else {
      data.continue.push(entry);
    }

    data.continue.sort((a, b) => b.updatedAt - a.updatedAt);
    if (data.continue.length > 50) data.continue = data.continue.slice(0, 50);

    if (!data.watched[animeId]) data.watched[animeId] = [];
    if (!data.watched[animeId].includes(episodeNumber)) {
      data.watched[animeId].push(episodeNumber);
    }

    this._save();
  },

  getContinueWatching() {
    return this._load().continue.filter(e => !e.completed).slice(0, 10);
  },

  isWatched(animeId, episodeNumber) {
    const data = this._load();
    return data.watched[animeId]?.includes(episodeNumber) || false;
  },

  getProgress(animeId) {
    const data = this._load();
    return data.continue.find(e => e.animeId === animeId);
  },

  markCompleted(animeId) {
    const data = this._load();
    const entry = data.continue.find(e => e.animeId === animeId);
    if (entry) {
      entry.completed = true;
      entry.progress = entry.duration;
      this._save();
    }
  }
};

let hlsInstance = null;
let searchState = { query: '', page: 1, type: '', status: '', data: null };
let progressInterval = null;

function navigate(page, params) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  scrollTo(0, 0);
  if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
  switch (page) {
    case 'home': renderHome(); break;
    case 'detail': renderDetail(params); break;
    case 'watch': renderWatch(params); break;
    case 'search': renderSearch(params); break;
    case 'seasonal': renderSeasonal(); break;
    case 'movies': renderMovies(); break;
    case 'top': renderTop(); break;
    default: renderHome();
  }
}

function renderSection(title, items, extra) {
  if (!items || items.length === 0) return '';
  return `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">${title}</h2>
        ${extra || ''}
      </div>
      <div class="anime-grid">${items.map(a => renderCard(a)).join('')}</div>
    </div>`;
}

function renderCard(anime) {
  const img = anime.images?.jpg?.image_url || anime.images?.jpg?.large_image_url || '';
  const title = anime.title || 'Unknown';
  const score = anime.score ? `⭐ ${anime.score}` : '';
  const ep = anime.episodes ? `📺 ${anime.episodes} eps` : '';
  const type = anime.type || '';
  const isAiring = anime.airing;
  const id = anime.mal_id;

  return `
    <div class="anime-card" onclick="navigate('detail', ${id})">
      <img class="anime-card-img" src="${img}" alt="${title}" loading="lazy">
      ${!isAiring && ep ? '<span class="anime-card-badge">Complete</span>' : ''}
      ${score ? `<span class="anime-card-score">${score}</span>` : ''}
      <div class="anime-card-body">
        <div class="anime-card-title">${title}</div>
        <div class="anime-card-sub">${[type, ep].filter(Boolean).join(' • ')}</div>
      </div>
    </div>`;
}

function renderContinueCard(entry) {
  const pct = entry.duration > 0 ? Math.round((entry.progress / entry.duration) * 100) : 0;
  return `
    <div class="anime-card" onclick="navigate('watch', {animeId:${entry.animeId}, episode:${entry.episodeNumber}, title:'${entry.animeTitle.replace(/'/g, "\\'")}'})">
      <img class="anime-card-img" src="${entry.animeImage || ''}" alt="${entry.animeTitle}" loading="lazy">
      <span class="anime-card-score" style="color:var(--success)">▶ ${pct}%</span>
      <span class="anime-card-ep">EP ${entry.episodeNumber}</span>
      <div class="anime-card-body">
        <div class="anime-card-title">${entry.animeTitle}</div>
        <div class="anime-card-sub">Continue watching</div>
        <div style="height:3px;background:var(--bg3);border-radius:2px;margin-top:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--gradient);border-radius:2px;transition:width 0.3s"></div>
        </div>
      </div>
    </div>`;
}

async function renderHome() {
  const app = document.getElementById('app');
  document.querySelector('.nav-link[onclick*="home"]')?.classList.add('active');

  try {
    const [trending, seasonal] = await Promise.all([
      API.topAnime('airing', 1),
      API.seasonalAnime(1)
    ]);

    const trendingAnime = trending.data?.slice(0, 18) || [];
    const seasonalAnime = seasonal.data?.slice(0, 18) || [];
    const featured = trendingAnime[0] || seasonalAnime[0];
    const continueWatching = Tracker.getContinueWatching();

    let html = '';

    if (continueWatching.length > 0) {
      html += `
        <div class="section">
          <div class="section-header">
            <h2 class="section-title">▶ Continue Watching</h2>
          </div>
          <div class="anime-grid">${continueWatching.map(e => renderContinueCard(e)).join('')}</div>
        </div>`;
    }

    if (featured) {
      const synopsis = featured.synopsis || '';
      const genres = featured.genres?.map(g => g.name).join(', ') || '';
      html += `
        <div class="hero">
          <div class="hero-bg" style="background-image: url('${featured.images?.jpg?.large_image_url || ''}')"></div>
          <div class="hero-content">
            <img class="hero-poster" src="${featured.images?.jpg?.large_image_url || ''}" alt="${featured.title}" loading="lazy">
            <div class="hero-info">
              <div class="hero-title">${featured.title}</div>
              <div class="hero-meta">
                <span>⭐ ${featured.score || 'N/A'}</span>
                <span>📺 ${featured.type || 'TV'}</span>
                <span>📅 ${featured.year || 'N/A'}</span>
                <span>🎬 ${featured.episodes || '?'} eps</span>
                <span>${genres}</span>
              </div>
              <div class="hero-desc">${synopsis.substring(0, 300)}${synopsis.length > 300 ? '...' : ''}</div>
              <div class="hero-actions">
                <button class="btn btn-primary" onclick="navigate('detail', ${featured.mal_id})">📋 Details</button>
                <button class="btn btn-secondary" onclick="navigate('watch', {animeId:${featured.mal_id},title:'${featured.title.replace(/'/g, "\\'")}'})">▶ Watch Now</button>
              </div>
            </div>
          </div>
        </div>`;
    }

    html += renderSection('Trending Now', trendingAnime);
    html += renderSection('Current Season', seasonalAnime);

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = `<div class="no-results"><p>⚠️ Failed to load</p><p>${err.message}. Try refreshing.</p></div>`;
  }
}

async function renderDetail(id) {
  const app = document.getElementById('app');

  try {
    const [detailRes, epsRes] = await Promise.all([
      API.animeDetail(id),
      API.animeEpisodes(id, 1)
    ]);

    const a = detailRes.data;
    const eps = epsRes.data || [];
    const trailerUrl = a.trailer?.embed_url || a.trailer?.url;
    const progress = Tracker.getProgress(id);

    let html = `
      <div class="detail-page">
        <div class="detail-sidebar">
          <img class="detail-poster" src="${a.images?.jpg?.large_image_url || ''}" alt="${a.title}" loading="lazy">
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-primary" onclick="navigate('watch', {animeId:${id}, episode:${progress?.episodeNumber || 1}, title:'${a.title.replace(/'/g, "\\'")}'})">
              ${progress ? '▶ Resume EP ' + progress.episodeNumber : '▶ Start Watching'}
            </button>
            ${trailerUrl ? `<button class="btn btn-secondary" onclick="window.open('${trailerUrl}','_blank')">🎬 Trailer</button>` : ''}
          </div>
        </div>
        <div class="detail-info">
          <h1>${a.title}</h1>
          <div class="japanese-title">${a.title_japanese || ''}</div>
          <div class="detail-meta">
            <span class="tag">⭐ ${a.score || 'N/A'}</span>
            <span class="tag">📺 ${a.type || 'Unknown'}</span>
            <span class="tag">📅 ${a.year || a.aired?.from?.substring(0,4) || 'N/A'}</span>
            <span class="tag">🎬 ${a.episodes || '?'} eps</span>
            <span class="tag">${a.status || 'Unknown'}</span>
            ${a.rating ? `<span class="tag">${a.rating}</span>` : ''}
          </div>
          <div class="detail-meta">
            ${(a.genres || []).map(g => `<span class="tag genre">${g.name}</span>`).join('')}
          </div>
          <div class="detail-desc">${a.synopsis || 'No synopsis available.'}</div>
          <div class="detail-stats">
            <div class="stat-box"><div class="val">${a.score || 'N/A'}</div><div class="label">Score</div></div>
            <div class="stat-box"><div class="val">${a.rank ? `#${a.rank}` : 'N/A'}</div><div class="label">Rank</div></div>
            <div class="stat-box"><div class="val">${a.popularity ? `#${a.popularity}` : 'N/A'}</div><div class="label">Popularity</div></div>
            <div class="stat-box"><div class="val">${a.members?.toLocaleString() || 'N/A'}</div><div class="label">Members</div></div>
          </div>
          ${eps.length > 0 ? `
          <div class="episodes-section">
            <h2>Episodes (${a.episodes || eps.length})</h2>
            <div class="episodes-grid">
              ${eps.map(ep => {
                const watched = Tracker.isWatched(id, ep.mal_id);
                return `
                  <button class="ep-btn ${watched ? 'watched' : ''}"
                          onclick="navigate('watch', {animeId:${id}, episode:${ep.mal_id}, title:'${a.title.replace(/'/g, "\\'")}'})">
                    ${watched ? '✅ ' : ''}EP ${ep.mal_id}
                  </button>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>`;

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = `<div class="no-results"><p>⚠️ Failed to load details</p><p>${err.message}</p></div>`;
  }
}

async function renderWatch(params) {
  const app = document.getElementById('app');
  let animeTitle = params.title || '';

  try {
    if (!params.animeId) {
      app.innerHTML = `<div class="no-results"><p>Missing anime ID</p></div>`;
      return;
    }

    const detailRes = await API.animeDetail(params.animeId);
    const a = detailRes.data;
    animeTitle = a.title || animeTitle;
    const animeImage = a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || '';

    const searchRes = await API.streamSearch(a.title);
    let streamResults = searchRes.results || [];
    let currentProvider = searchRes.provider;

    if (streamResults.length === 0 && a.title_english) {
      const r2 = await API.streamSearch(a.title_english);
      streamResults = r2.results || [];
      currentProvider = r2.provider || currentProvider;
    }

    let bestMatch = streamResults.find(r => {
      const t = animeTitle.toLowerCase();
      const rt = (r.title || '').toLowerCase();
      return rt.includes(t.substring(0, 15)) || t.includes(rt.substring(0, 15));
    }) || streamResults[0];

    if (!bestMatch) {
      app.innerHTML = `
        <div class="no-results">
          <p>😕 No streaming source found for "${animeTitle}"</p>
          <div class="search-input-lg" style="margin:16px auto;max-width:400px">
            <input type="text" id="fallbackSearch" value="${animeTitle}" placeholder="Search..." onkeydown="if(event.key==='Enter') doFallbackSearch()">
            <button onclick="doFallbackSearch()">Search</button>
          </div>
          <button class="btn btn-primary" onclick="navigate('detail', ${params.animeId})">← Back to Details</button>
        </div>`;
      return;
    }

    const infoRes = await API.streamInfo(bestMatch.id, currentProvider);
    let episodes = infoRes.episodes || [];

    if (episodes.length === 0) {
      app.innerHTML = `
        <div class="no-results">
          <p>😕 No episodes available for "${animeTitle}"</p>
          <button class="btn btn-primary" onclick="navigate('detail', ${params.animeId})">← Back to Details</button>
        </div>`;
      return;
    }

    episodes.sort((a, b) => a.number - b.number);

    const savedProgress = Tracker.getProgress(params.animeId);
    let targetEpisodeNumber = 1;
    if (params.episode) {
      targetEpisodeNumber = params.episode;
    } else if (savedProgress && !savedProgress.completed) {
      targetEpisodeNumber = savedProgress.episodeNumber;
    }

    const targetEp = episodes.find(e => e.number === targetEpisodeNumber) || episodes[0];

    if (targetEp) {
      currentAnimeId = params.animeId;
      currentAnimeTitle = animeTitle;
      currentAnimeImage = animeImage;
      currentEpisodeId = targetEp.id;
      currentEpisodeNumber = targetEp.number;
    }

    let html = `
      <div class="watch-page">
        <div>
          <div class="video-container">
            <div id="videoPlayer">
              <div class="video-placeholder">
                <div style="font-size:48px">🎬</div>
                <p>Loading episode...</p>
              </div>
            </div>
          </div>
          <div class="watch-info">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <button class="btn btn-secondary" onclick="navigate('detail', ${params.animeId})" style="padding:6px 12px;font-size:12px">← Back</button>
              <h2>${animeTitle}</h2>
            </div>
            <div class="ep-label">
              Episode ${targetEp.number}
              ${savedProgress && savedProgress.episodeNumber === targetEp.number && savedProgress.progress > 0 ?
                `<span style="color:var(--text3);font-size:12px"> (resume from ${Math.floor(savedProgress.progress / 60)}:${Math.floor(savedProgress.progress % 60).toString().padStart(2, '0')})</span>` :
                ''}
            </div>
          </div>
        </div>
        <div class="watch-sidebar">
          <div>
            <h3>📋 Episodes (${episodes.length})</h3>
            <div class="progress-info" style="font-size:12px;color:var(--text3);margin-bottom:8px">
              ${Tracker._load().watched[params.animeId]?.length || 0} / ${episodes.length} watched
            </div>
            <div class="watch-episodes">
              ${episodes.map(ep => {
                const w = Tracker.isWatched(params.animeId, ep.number);
                return `
                  <button class="watch-ep-btn ${ep.id === currentEpisodeId ? 'active' : ''} ${w ? 'watched' : ''}"
                          onclick="loadEpisode('${ep.id}', ${ep.number}, ${params.animeId}, '${animeTitle.replace(/'/g, "\\'")}', '${animeImage}')">
                    ${w ? '✅ ' : ''}Episode ${ep.number}
                  </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>`;

    app.innerHTML = html;

    if (targetEp) {
      await loadVideo(targetEp.id, savedProgress?.episodeNumber === targetEp.number ? savedProgress.progress : 0);
    }
  } catch (err) {
    app.innerHTML = `
      <div class="no-results">
        <p>⚠️ Failed to load stream</p>
        <p>${err.message}</p>
        <button class="btn btn-primary" onclick="navigate('detail', ${params.animeId})">← Back to Details</button>
      </div>`;
  }
}

let currentAnimeId = null;
let currentAnimeTitle = '';
let currentAnimeImage = '';
let currentEpisodeId = null;
let currentEpisodeNumber = 1;

function doFallbackSearch() {
  const input = document.getElementById('fallbackSearch');
  const q = input.value.trim();
  if (q) navigate('search', q);
}

function loadEpisode(episodeId, number, animeId, title, image) {
  currentEpisodeId = episodeId;
  currentEpisodeNumber = number;
  currentAnimeId = animeId;
  currentAnimeTitle = title;
  currentAnimeImage = image;

  document.querySelectorAll('.watch-ep-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.watch-ep-btn[onclick*="loadEpisode('${episodeId}'"]`);
  if (btn) btn.classList.add('active');

  const label = document.querySelector('.ep-label');
  if (label) label.textContent = `Episode ${number}`;

  loadVideo(episodeId);
}

async function loadVideo(episodeId, resumeTime) {
  const container = document.getElementById('videoPlayer');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading stream...</p></div>';

  try {
    const res = await API.streamWatch(episodeId);
    const sources = res.sources || [];

    let selectedSource = sources.find(s => s.quality === '1080p')
      || sources.find(s => s.quality === '720p')
      || sources.find(s => s.quality === '480p')
      || sources.find(s => s.quality === '360p')
      || sources[0];

    if (!selectedSource) {
      container.innerHTML = `
        <div class="video-placeholder">
          <div style="font-size:48px">😕</div>
          <p>No video source available</p>
        </div>`;
      return;
    }

    const videoUrl = selectedSource.url;
    const isM3U8 = videoUrl.includes('.m3u8');

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

    container.innerHTML = `<video id="animeVideo" controls autoplay></video>`;
    const video = document.getElementById('animeVideo');

    function onVideoReady() {
      if (resumeTime > 0 && video.duration && resumeTime < video.duration - 5) {
        video.currentTime = resumeTime;
      }

      progressInterval = setInterval(() => {
        if (!video.paused && video.duration > 0 && currentAnimeId) {
          Tracker.saveProgress(
            currentAnimeId, currentAnimeTitle, currentAnimeImage,
            currentEpisodeId, currentEpisodeNumber,
            video.currentTime, video.duration
          );
        }
      }, 5000);

      video.addEventListener('pause', () => {
        if (video.duration > 0 && currentAnimeId) {
          Tracker.saveProgress(
            currentAnimeId, currentAnimeTitle, currentAnimeImage,
            currentEpisodeId, currentEpisodeNumber,
            video.currentTime, video.duration
          );
        }
      });

      video.addEventListener('ended', () => {
        if (currentAnimeId) {
          Tracker.saveProgress(
            currentAnimeId, currentAnimeTitle, currentAnimeImage,
            currentEpisodeId, currentEpisodeNumber,
            video.duration, video.duration
          );
        }
      });
    }

    if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(videoUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        onVideoReady();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
        onVideoReady();
      });
    } else {
      video.src = videoUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
        onVideoReady();
      });
    }

    video.addEventListener('error', () => {
      if (container.querySelector('video')) {
        container.innerHTML = `
          <div class="video-placeholder">
            <div style="font-size:48px">⚠️</div>
            <p>Video failed to load</p>
          </div>`;
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div class="video-placeholder">
        <div style="font-size:48px">⚠️</div>
        <p>Failed to load video</p>
      </div>`;
  }
}

async function renderSearch(query) {
  const app = document.getElementById('app');
  const q = query || '';

  let html = `
    <div class="search-page">
      <h1 class="page-title">🔍 Search Anime</h1>
      <div class="search-input-lg">
        <input type="text" id="searchPageInput" value="${q}" placeholder="Search for anime..." onkeydown="if(event.key==='Enter') doSearch()">
        <button onclick="doSearch()">Search</button>
      </div>
      <div class="search-filters">
        <select id="searchType">
          <option value="">All Types</option>
          <option value="tv">TV</option>
          <option value="movie">Movie</option>
          <option value="ova">OVA</option>
          <option value="special">Special</option>
          <option value="ona">ONA</option>
        </select>
        <select id="searchStatus">
          <option value="">Any Status</option>
          <option value="airing">Airing</option>
          <option value="complete">Complete</option>
          <option value="upcoming">Upcoming</option>
        </select>
      </div>
      <div id="searchResults"></div>
    </div>`;

  app.innerHTML = html;

  if (q) {
    searchState.query = q;
    searchState.page = 1;
    document.getElementById('searchResults').innerHTML = '<div class="loading"><div class="spinner"></div><p>Searching...</p></div>';
    performSearch();
  }
}

async function doSearch() {
  const input = document.getElementById('searchPageInput');
  const q = input.value.trim();
  if (!q) return;
  searchState.query = q;
  searchState.page = 1;
  document.getElementById('searchResults').innerHTML = '<div class="loading"><div class="spinner"></div><p>Searching...</p></div>';
  performSearch();
}

async function performSearch() {
  const resultsDiv = document.getElementById('searchResults');
  if (!resultsDiv) return;

  const type = document.getElementById('searchType')?.value || '';
  const status = document.getElementById('searchStatus')?.value || '';

  try {
    let params = `q=${encodeURIComponent(searchState.query)}&page=${searchState.page}`;
    if (type) params += `&type=${type}`;
    if (status) params += `&status=${status}`;

    const res = await API.get(`/api/search?${params}`);
    const data = res.data || [];

    if (data.length === 0) {
      resultsDiv.innerHTML = '<div class="no-results"><p>😕 No results found</p><p>Try a different search term</p></div>';
      return;
    }

    const hasMore = res.pagination?.has_next_page;
    const lastPage = res.pagination?.last_visible_page || 1;

    let html = `<div class="anime-grid">${data.map(a => renderCard(a)).join('')}</div>`;
    if (hasMore || lastPage > 1) {
      html += `<div class="pagination">
        ${searchState.page > 1 ? `<button onclick="changePage(${searchState.page - 1})">← Prev</button>` : ''}
        <span style="padding:8px 12px;color:var(--text2)">Page ${searchState.page}${lastPage > 1 ? ` / ${lastPage}` : ''}</span>
        ${hasMore ? `<button onclick="changePage(${searchState.page + 1})">Next →</button>` : ''}
      </div>`;
    }
    resultsDiv.innerHTML = html;
  } catch (err) {
    resultsDiv.innerHTML = `<div class="no-results"><p>⚠️ Search failed</p><p>${err.message}</p></div>`;
  }
}

function changePage(page) {
  searchState.page = page;
  document.getElementById('searchResults').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
  performSearch();
}

function handleSearch() {
  const input = document.getElementById('searchInput');
  const q = input.value.trim();
  if (q) navigate('search', q);
}

function handleMobileSearch() {
  const input = document.getElementById('mobileSearchInput');
  const q = input.value.trim();
  if (q) navigate('search', q);
}

function toggleMobileMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

async function renderSeasonal() {
  const app = document.getElementById('app');
  document.querySelector('.nav-link[onclick*="seasonal"]')?.classList.add('active');

  try {
    const [seasonal, upcoming] = await Promise.all([
      API.seasonalAnime(1),
      API.upcomingAnime(1)
    ]);

    const now = new Date();
    const season = ['winter', 'spring', 'summer', 'fall'][Math.floor(now.getMonth() / 3)];
    const year = now.getFullYear();

    let html = `
      <h1 class="page-title">${season.charAt(0).toUpperCase() + season.slice(1)} ${year} Anime <span>Airing Now</span></h1>
      <div class="anime-grid">${(seasonal.data || []).map(a => renderCard(a)).join('')}</div>
      <div class="section" style="margin-top:40px">
        <div class="section-header"><h2 class="section-title">Upcoming Season</h2></div>
        <div class="anime-grid">${(upcoming.data || []).slice(0, 12).map(a => renderCard(a)).join('')}</div>
      </div>`;

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = `<div class="no-results"><p>⚠️ Failed to load seasonal</p><p>${err.message}</p></div>`;
  }
}

async function renderMovies() {
  const app = document.getElementById('app');
  document.querySelector('.nav-link[onclick*="movies"]')?.classList.add('active');

  try {
    const res = await API.topMovies(1);
    app.innerHTML = `
      <h1 class="page-title">🎬 Top Anime Movies</h1>
      <div class="anime-grid">${(res.data || []).map(a => renderCard(a)).join('')}</div>`;
  } catch (err) {
    app.innerHTML = `<div class="no-results"><p>⚠️ Failed to load movies</p><p>${err.message}</p></div>`;
  }
}

async function renderTop() {
  const app = document.getElementById('app');
  document.querySelector('.nav-link[onclick*="top"]')?.classList.add('active');

  try {
    const [popular, favorite] = await Promise.all([
      API.topAnime('bypopularity', 1),
      API.topAnime('favorite', 1)
    ]);

    let html = `
      <h1 class="page-title">🏆 Top Rated Anime</h1>
      <div class="section">
        <div class="section-header"><h2 class="section-title">Most Popular</h2></div>
        <div class="anime-grid">${(popular.data || []).map(a => renderCard(a)).join('')}</div>
      </div>
      <div class="section">
        <div class="section-header"><h2 class="section-title">Most Favorited</h2></div>
        <div class="anime-grid">${(favorite.data || []).slice(0, 12).map(a => renderCard(a)).join('')}</div>
      </div>`;

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = `<div class="no-results"><p>⚠️ Failed to load top anime</p><p>${err.message}</p></div>`;
  }
}

navigate('home');
