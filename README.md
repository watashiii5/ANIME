# WatashiStream

Free anime streaming website with watch tracking, release schedules, and auto-rotating carousel.

**Live Demo**: [https://anime-zoo8.onrender.com/](https://anime-zoo8.onrender.com/)

## Features

- Browse trending, seasonal, and top-rated anime
- Auto-rotating hero carousel with featured anime
- Release day/time schedule on anime cards
- Pagination for trending and seasonal sections
- Watch episodes with HLS video player
- Continue watching with progress tracking
- Watched episode history (localStorage)
- Search with filters (type, status)
- Responsive dark theme design
- English subbed content

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla JS, HLS.js
- **APIs**: Jikan (MyAnimeList), AnimeUnity/AnimeSaturn (via @consumet/extensions)

## Run Locally

```bash
npm install
node server.js
```

Open http://localhost:3000

## Deploy on Render

1. Connect your GitHub repo to Render
2. Create a Web Service
3. Build Command: `npm install`
4. Start Command: `node server.js`
