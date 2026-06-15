# Spotkick

Penalty intelligence built on StatsBomb open data. Static, served as part of
the mohibb.com Cloudflare Pages deployment at `mohibb.com/spotkick/`.

## How it works

A local build script downloads StatsBomb open data, extracts every penalty,
computes scoreline context and a Pressure Index (0-100), and writes a single
flat `data/penalties.json`. The site loads that file and does all filtering and
aggregation in the browser.

## Project layout

```
spotkick/
  index.html              page shell
  scripts/build-data.mjs  downloads StatsBomb data, writes penalties.json
  src/js/pressureIndex.js  pressure formula (shared by build + UI)
  src/js/data.js          loader + filtering + aggregation
  src/js/app.js           UI controller
  src/css/style.css
  data/penalties.sample.json   fallback so the site runs before first build
  data/penalties.json          generated; commit this
```

## Build the data

Requires Node 18+ and `unzip`.

```
node scripts/build-data.mjs
```

First run downloads ~1GB once into `.statsbomb-cache/` (gitignored, at the
repo root) and reads locally on subsequent runs. Edit `COMPETITION_ALLOWLIST`
in `scripts/build-data.mjs` to change scope. Empty array = all competitions.

Commit the resulting `data/penalties.json`.

## Run locally

From the repo root:

```
npx serve .
```

Then open `/spotkick/`. The page falls back to `penalties.sample.json` if the
real file is missing, so it works immediately.

## Pressure Index

See `src/js/pressureIndex.js`. Combines scoreline stakes, match minute (sigmoid),
competition stage, shootout position, and league context, with a scoreline x
minute interaction term. League context currently defaults to neutral until an
external standings source (e.g. football-data.org) is wired into the build.

## Attribution

Data: StatsBomb open data. Cite StatsBomb if you publish anything based on it.
