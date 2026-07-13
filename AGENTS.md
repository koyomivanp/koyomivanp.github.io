# AGENTS.md

## Cursor Cloud specific instructions

This repository is a **static, dependency-free PWA portfolio site** (HTML/CSS/vanilla JS). There is **no package manager, no build step, no automated tests, and no linter configured** — nothing to install. The pre-built `photo-pdf/` bundle is committed as compiled output; its source/build pipeline is not in this repo.

### Running the site (dev)
Serve the repository root over HTTP and open it in a browser. The site must be served from the repo root (not `file://`) because the service worker, `manifest.webmanifest`, and the `photo-pdf` bundle's absolute paths (`/photo-pdf/assets/*`) require an HTTP origin.

```
python3 -m http.server 8000   # run from repo root
```

Key pages:
- `http://localhost:8000/` — main portfolio (Japanese, PWA)
- `http://localhost:8000/artwork.html` — artwork gallery
- `http://localhost:8000/photo-pdf/` — client-side photo→PDF tool
- `http://localhost:8000/vampiresurvivors/index.html` — vanilla-JS canvas mini-game

### Gotchas
- The service worker (`sw.js`) aggressively caches the app shell (`CACHE = "touya-portfolio-v1"`). If site changes don't appear after editing, the SW is serving a stale cache — hard-reload, unregister the SW in DevTools, or bump the `CACHE` version string in `sw.js`.
- `localhost` over plain HTTP is a secure context, so the SW/PWA features work without HTTPS.
- Google Fonts are loaded from a CDN; without internet only typography degrades — the site still works.
