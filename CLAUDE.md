# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal landing page for mohibb.com. Static, data-driven, no build step, no
dependencies, no framework.

## Working on PRs

Whenever a PR is opened or updated in this repo, fetch the latest Cloudflare
Pages bot comment on it and surface the **Preview URL** and **Branch Preview
URL** to the user — they always need these to check the deploy. If the work
is on a subproject (e.g. `spotkick/`, `pitwall/`, `pdf/`), append that
subproject's path (e.g. `/spotkick/`) to both URLs.

## Structure

```
index.html              page shell markup, plus a #groups mount point
style.css, script.js    page shell styles and render logic
projects.json           the project list (edit this to update the page)
pdf/                     PDF Merger tool, served at mohibb.com/pdf/
pitwall/                 Pit Wall live F1 dashboard, served at mohibb.com/pitwall/
pitwall/analyse/         Pit Wall companion: completed-session analysis, at mohibb.com/pitwall/analyse/
spotkick/                Spotkick penalty analytics, served at mohibb.com/spotkick/
favicon.svg, robots.txt, sitemap.xml   shared static assets
.github/workflows/validate.yml         CI checks (see Validation below)
.stylelintrc.json, .pa11yci.json       config for the CI checks
README.md
```

## Architecture

- `index.html` is markup only, plus a `#groups` mount point. Styles live in
  the sibling `style.css`, render logic in the sibling `script.js`, linked
  via `<link rel="stylesheet">` / `<script src>`. The `application/ld+json`
  block stays inline in the HTML.
- On load, the script fetches `projects.json` and renders project "groups"
  (e.g. "F1", "Tools") into cards via `groupHtml`/`cardHtml`.
- Each project item has a `status` of `soon`, `wip`, or `live`:
  - `live` renders as a clickable link to `url` with a green "Live" tag and
    hover arrow.
  - `wip`/`soon` render as non-clickable, dimmed cards with a tag.
- Cards are numbered automatically per group, in JSON order.
- To launch a project: change its `status` to `live` in `projects.json`,
  commit, push — no HTML changes needed.

## Running locally

Must be served over HTTP, since `fetch('./projects.json')` does not work from
`file://`:

```
npx serve .
```

## PDF Merger (mohibb.com/pdf)

`pdf/` is a self-contained, client-side PDF merge/reorder tool built on
`pdf-lib` (bundled as `pdf/pdf-lib.min.js`, loaded via `<script src>`). It
shares this repo's design tokens (colors, fonts) from `index.html` but has
its own `pdf/style.css`/`pdf/script.js`. All merging happens in-browser;
nothing is uploaded.

It's served at `mohibb.com/pdf/` automatically as part of this same Pages
deployment (output directory `/` includes `pdf/`) — no separate project or
domain needed.

## Pit Wall (mohibb.com/pitwall)

`pitwall/` is a self-contained, client-side live F1 dashboard: `index.html`
(markup) plus sibling `style.css`/`script.js` (Chart.js is the only external
dependency, loaded from CDN). It shows what's happening in the current/most
recent F1 session plus current-season
standings, and an idle countdown to the next race when no session is live. When
IDLE, it can show the results of the *previous* session behind a spoiler gate
(hidden by default, with a reveal button; resets automatically when the session
changes).

- Data: **OpenF1** (`api.openf1.org`) for live session data — polled every 3s
  (`POLL_MS`) only while a session is LIVE, dropping to 15s (`POLL_ENDED_MS`)
  once the session has ended but is still in its grace window, never while
  IDLE. **Jolpica** (`api.jolpi.ca`, Ergast successor) for championship
  standings + schedule: the schedule is fetched once on load / manual refresh,
  while standings are re-polled every 5 min (`STANDINGS_POLL_MS`) while a
  session is live. Jolpica is volunteer-run and rate-limited, so it's polled
  at this slow cadence (not the live 3s cadence) and never faster.
- Liveness: `sessions?session_key=latest` decides LIVE (now between
  `date_start`/`date_end` + 10 min grace) vs IDLE. IDLE is the common case and
  is a designed screen (next-race countdown in Europe/Oslo time), not an error.
- Design: dark "control-room" base, F1-red (`#E10600`) reserved for the live
  pulse and fastest-stop highlight only. Shares the landing page's typography
  (Plus Jakarta Sans + Newsreader italic) plus IBM Plex Mono for timing
  numerals. All times shown in Europe/Oslo.
- Served at `mohibb.com/pitwall/` as part of this same Pages deployment
  (output directory `/` includes `pitwall/`) — no separate project needed.
- `pitwall/analyse/` is a companion page (own `index.html` +
  `style.css`/`script.js`, shares the same design tokens and fonts) for
  digging into any *completed* session:
  theoretical best laps, qualifying potential, race lap charts (with an
  optional toggle to mark pit stops), tyre strategy, and long-run race pace,
  all built on OpenF1's historical data. Linked from Pit Wall and served at
  `mohibb.com/pitwall/analyse/`.

## Spotkick (mohibb.com/spotkick)

`spotkick/` is a self-contained, client-side penalty analytics dashboard
built on open football data. The page (`spotkick/src/js/app.js` + `data.js`)
loads `spotkick/data/penalties.json` (falling back to `penalties.sample.json`
if absent) and does all filtering and aggregation in the browser — nothing is
uploaded, no backend.

**Data pipeline (dual-source):**
- **StatsBomb historical backbone** — 855+ penalties from `scripts/build-data.mjs`
  (Node 18+) or `scripts/build_data_colab.py` (Colab), covering World Cup, Euro,
  UCL, and big-5 leagues with full event detail (keeper, placement zone, shootouts).
  Run manually when a historical rebuild is needed; output committed to
  `spotkick/data/penalties.json`.
- **Weekly Google Apps Script job** — `spotkick/scripts/apps-script/AggregatePenalties.gs`
  runs on a weekly time-driven trigger, fetches recent penalties from Understat
  (current season, big-5 leagues), merges/dedupes against the existing file, and
  pushes any new records directly to `main` via the GitHub Contents API. Setup
  instructions and source-registry pattern in `apps-script/README.md`.

**`confidence` field** — each penalty has `confidence: "full" | "partial" | "minimal"`:
- `"full"`: placement zone + real scoreline known (StatsBomb)
- `"partial"`: outcome known but no placement/keeper (Understat and similar)
- `"minimal"`: all fields fell back to defaults
Derived automatically by `deriveConfidence_()` in the GAS script. The UI has an
"Include estimated penalties" toggle that excludes `partial`/`minimal` rows.

**`pressureIndex`** computed per penalty by `spotkick/src/js/pressureIndex.js`
(ported to GAS as inline functions in `AggregatePenalties.gs`).

It shares this repo's design tokens (warm palette, sharp 1.5px borders, Plus
Jakarta Sans + Newsreader) via its own `spotkick/src/css/style.css`, but keeps
its own mobile-card (max 430px) dashboard layout. Served at
`mohibb.com/spotkick/` as part of this same Pages deployment — no separate
project needed.

## Design tokens

Shared `:root` CSS custom properties, defined per-page (no shared stylesheet)
but kept consistent across `index.html`, `pdf/`, and `pitwall/`:

- Core palette: `--bg` (#EDE8DD), `--card` (#F7F3EA), `--ink` (#211D17),
  `--ink-2`/`--ink-3` (muted text), `--line`/`--line-soft` (borders),
  `--accent`/`--accent-ink` (#B4471F rust, used for highlights/links),
  `--live` (#2E6F4F, "Live" status green).
- `pitwall/` and `pitwall/analyse/` extend this with `--bg-2`, `--card-2`,
  `--ink-4`, status colors `--green`/`--yellow`/`--red`/`--blue`/`--sc`, and
  `--mono` (IBM Plex Mono).
- Fonts (Google Fonts, loaded per-page): **Plus Jakarta Sans** for body/UI,
  **Newsreader** italic for "eyebrow"/lede copy, **IBM Plex Mono** for
  timing/numeric data in Pit Wall.

When adding a new page, copy the `:root` block from the closest existing page
rather than reinventing values.

## Adding a new page

Each page (`index.html`, `pdf/index.html`, `pitwall/index.html`,
`pitwall/analyse/index.html`) repeats the same `<head>` boilerplate:
canonical `<link>`, Open Graph + Twitter meta tags, `theme-color`, favicon
link, and an `application/ld+json` block. When adding a new top-level page:

- Copy and adapt this boilerplate (title, description, canonical/OG URLs,
  ld+json) from the closest existing page.
- Add the new URL to `sitemap.xml` (with appropriate `changefreq`/`priority`).
- Add the new URL to `.pa11yci.json` so it's covered by the accessibility
  check in CI.

## Validation (CI)

`.github/workflows/validate.yml` runs on every push/PR via `npx` (no
package.json/lockfile needed — the site itself stays dependency-free):

- **syntax**: every `*.json` file parses, every inline `<script>` in
  `*.html` (non-`src`, JS or `application/ld+json`) is syntactically valid,
  and every `*.js` file (excluding `*.min.js`) is syntactically valid.
- **html**: `html-validate` against all `*.html`.
- **css**: `stylelint` (config in `.stylelintrc.json`, extends
  `stylelint-config-recommended`) against inline `<style>` blocks in
  `*.html` and all `*.css` files.
- **accessibility**: `pa11y-ci` (WCAG2A, config in `.pa11yci.json`) against
  the served site — currently `/`, `/pitwall/`, `/pitwall/analyse/`, `/pdf/`.

When adding a new top-level page, add its URL to `.pa11yci.json` so it's
covered by the accessibility check.

## Deployment

Deployed via Cloudflare Pages:
- Connect repo to Cloudflare Pages with an empty build command and output
  directory `/`.
- Custom domains `mohibb.com` and `www.mohibb.com` point at this Pages
  project.
- Each other project listed in `projects.json` lives in its own repo / Pages
  project on its own subdomain (e.g. `spotkick.mohibb.com`, `f1.mohibb.com`).
