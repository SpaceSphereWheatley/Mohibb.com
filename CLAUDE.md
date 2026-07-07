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
pitwall/                 Pit Wall · Analyse: completed-session analysis, served at mohibb.com/pitwall/
pitwall/live/            Pit Wall companion: live F1 dashboard, at mohibb.com/pitwall/live/
spotkick/                Spotkick penalty analytics, served at mohibb.com/spotkick/
functions/               Cloudflare Pages Functions — currently just the Race Report API (see below)
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

`pitwall/` is a self-contained, client-side F1 session-analysis page:
`index.html` (markup) plus sibling `style.css`/`script.js` (Chart.js is the
only external dependency, loaded from CDN). It's the landing experience for
digging into any *completed* session: theoretical best laps, qualifying
potential, race lap charts (with an optional toggle to mark pit stops), tyre
strategy, and long-run race pace, all built on OpenF1's historical data.
Sections shown depend on the picked session's type (practice / qualifying /
race) via `showView()`; a qualifying session further splits into a
**Qualifying** tab (raw one-lap analysis) and a **Pre-Race** tab (the
forward-looking predictors: race pace indicator, tyre degradation, strategy
projection, estimated pit loss), toggled by `#viewTabs`.

- Served at `mohibb.com/pitwall/` as part of this same Pages deployment
  (output directory `/` includes `pitwall/`) — no separate project needed.
- A "Live" button in the top nav links to `pitwall/live/`, a companion page
  (own `index.html` + `style.css`/`script.js`, shares the same design tokens
  and fonts) for the live F1 control-room dashboard. It shows what's
  happening in the current/most recent F1 session plus current-season
  standings, and an idle countdown to the next race when no session is live.
  When IDLE, it can show the results of the *previous* session behind a
  spoiler gate (hidden by default, with a reveal button; resets automatically
  when the session changes).
  - Data: **OpenF1** (`api.openf1.org`) for live session data — polled every
    3s (`POLL_MS`) only while a session is LIVE, dropping to 15s
    (`POLL_ENDED_MS`) once the session has ended but is still in its grace
    window, never while IDLE. **Jolpica** (`api.jolpi.ca`, Ergast successor)
    for championship standings + schedule: the schedule is fetched once on
    load / manual refresh, while standings are re-polled every 5 min
    (`STANDINGS_POLL_MS`) while a session is live. Jolpica is volunteer-run
    and rate-limited, so it's polled at this slow cadence (not the live 3s
    cadence) and never faster.
  - Liveness: `sessions?session_key=latest` decides LIVE (now between
    `date_start`/`date_end` + 10 min grace) vs IDLE. IDLE is the common case
    and is a designed screen (next-race countdown in Europe/Oslo time), not
    an error.
  - Design: dark "control-room" base, F1-red (`#E10600`) reserved for the
    live pulse and fastest-stop highlight only. Shares the landing page's
    typography (Plus Jakarta Sans + Newsreader italic) plus IBM Plex Mono for
    timing numerals. All times shown in Europe/Oslo.
  - Served at `mohibb.com/pitwall/live/` as part of this same Pages
    deployment — no separate project needed. The old `/pitwall/analyse/` URL
    is kept as a redirect stub to `/pitwall/` for old bookmarks/SEO.

## Race Simulator (mohibb.com/pitwall/sim)

`pitwall/sim/` is a self-contained, client-side **2D top-down F1 race
simulator** under the Pit Wall umbrella: `index.html` (markup + an import map)
plus `style.css` and a set of native **ES modules** in `js/`. A seeded
generator builds a procedural circuit; a *segment-time* model then runs a full
grand prix and renders team-coloured dots with a live timing tower.

- **Timing core (not force-based):** each metre of track has a base speed from
  curvature, and a car's per-tick speed is
  `segment.baseSpeed × carPerf × tyrePace × fuelFactor × traffic`. The realism
  lives in the multipliers — tyre-deg curves per compound (scaled by driver
  `tyre_management`), fuel burn (`~0.03 s/lap/kg`), dirty-air/DRS deltas,
  racecraft-weighted overtaking, and the pit-strategy AI (undercut/overcut +
  the two-compound rule). Everything tunable lives in `js/config.js`.
- **Determinism:** `js/rng.js` (mulberry32) seeds both track and race, so a
  seed reproduces a circuit and result. The seed is shown/editable in the UI.
- **Modules:** `config`, `rng`, `geometry` (Catmull-Rom + arc-length),
  `track`, `tyres`, `car`, `overtake`, `strategy`, `race` (the tick loop),
  `render`, `leaderboard`, `analysis`, `tuning`, `ui`, `main`. `render.js` is
  the **only** renderer-aware file (eases a future three.js swap).
- **Data:** `data.json` is a hand-authored, *illustrative* 2026 grid (11
  teams / 22 drivers) in the documented `teams[]` / `drivers[]` shape; a "Load
  grid…" file picker overrides it at runtime (`colour`/`code` optional).
- **Track generation** is a **rounded-polygon** generator (`track.js`): a
  convex hull of seeded random points gets concave pockets (midpoint
  displacement), is tuned to a target corner count (14–20, avg ~17), then each
  vertex becomes a fillet arc whose radius is set by how sharply it turns
  (sharp = hairpin, shallow = sweeper) — leaving genuine straights between
  corners. One long edge is forced to be the start-finish straight; a tight
  chicane is dropped onto another. `geometry.js#closedPolyline` turns the
  filleted point ring into the arc-length `Polyline` without re-smoothing it.
- **Dependencies** are **vendored** into `pitwall/sim/vendor/` (no runtime
  CDN, like `pdf/pdf-lib.min.js`) and pinned via the import map: **PixiJS**
  (`pixi.min.mjs`, rendering), **Tweakpane** (`tweakpane.min.js`, the `?debug`
  tuning panel), **Chart.js** (`chart.umd.min.js`, post-race analysis as the
  global `Chart`).
- **CI notes:** load the entry module via `<script type="module" src=…>` —
  never inline a module with `import`, because validate.yml's inline-script
  check runs `new Function()` on `type="module"` blocks and rejects `import`.
  Vendored libs are named `*.min.js`/`*.min.mjs` so the JS syntax-check glob
  skips them.
- Served at `mohibb.com/pitwall/sim/` as part of this same Pages deployment —
  no separate project needed. Linked from the Pit Wall top nav.

### Race Report API (mohibb.com/api/race-report)

`functions/api/race-report.js` is a **Cloudflare Pages Function** — the
site's only server-side code — that returns a full-analysis F1 race report
as a standalone HTML document: `GET /api/race-report` (defaults to the most
recently completed Race, resolved the same way `pitwall/live` does; pass
`?session_key=<key>` for a specific past session, or the explicit
`?session_key=latest`). The report covers classification (with a race-pace
column), fastest lap, a race-history (gap-to-winner) chart capped to the top
10 classified drivers, tyre strategy, and Safety Car/VSC periods — the same
OpenF1 data and analysis approach as `pitwall/`'s race view, ported into
Workers-runtime-safe pure functions (no `window`/`document`/`sessionStorage`)
in `functions/_lib/openf1.js` and `functions/_lib/analysis.js`.
`functions/_lib/report.js` renders the page: inline `<style>`, no external
stylesheet/CDN/`<script>`, and the race-history chart is a static inline
`<svg>` (no Chart.js) so the whole response is one self-contained HTML
string that can be forwarded or pasted elsewhere (e.g. as an email body).

- **On-demand only** — there's no scheduled job and no email-sending code
  anywhere in this repo. Call the endpoint whenever you want a report;
  sending it wherever it needs to go is a separate, manual step.
- Non-Race sessions, sessions that haven't finished, and missing/unknown
  `session_key`s get an HTML error page with the matching status code
  (400/404/409/422); an OpenF1 fetch failure returns 502. A successful
  response is always `200` with `content-type: text/html`, even when some
  sections had to degrade because one of the underlying OpenF1 endpoints
  didn't respond (each panel fails independently, same resilience approach
  as `pitwall/script.js`'s per-panel retry).
- Deployed automatically as part of this same Pages project — Cloudflare
  auto-detects the `functions/` directory on push, no `wrangler.toml` or
  extra config needed.

## Spotkick (mohibb.com/spotkick)

`spotkick/` is a self-contained, client-side penalty analytics dashboard
built on open football data. The page (`spotkick/src/js/app.js` + `data.js`)
loads `spotkick/data/penalties.json` (falling back to `penalties.sample.json`
if absent) and does all filtering and aggregation in the browser — nothing is
uploaded, no backend.

**Data pipeline — fully GAS-based:**
- **StatsBomb historical backbone** — `spotkick/scripts/apps-script/StatsBombRebuild.gs`
  fetches StatsBomb open data directly from `raw.githubusercontent.com` and rebuilds
  `penalties.json` in the repo via the GitHub Contents API. Uses a continuation
  pattern (PropertiesService + 1-minute trigger) to work around GAS's 6-minute
  execution limit. Run `startStatsBombRebuild()` manually when a historical rebuild
  is needed (e.g. new StatsBomb data releases).
- **Weekly Google Apps Script job** — `spotkick/scripts/apps-script/AggregatePenalties.gs`
  runs on a weekly time-driven trigger, fetches recent penalties from Understat
  (current season, big-5 leagues), merges/dedupes against the existing file, and
  pushes any new records directly to `main`.

**GAS project setup** (one-time):
1. [script.google.com](https://script.google.com) → New project
2. Create two script files: `AggregatePenalties.gs` and `StatsBombRebuild.gs`
   (paste content from `spotkick/scripts/apps-script/`)
3. ⚙ Project Settings → Script properties → Add:
   - `GITHUB_TOKEN` — PAT with `repo` scope (Contents read/write)
   - `GITHUB_REPO` — `SpaceSphereWheatley/Mohibb.com`
   - `GITHUB_BRANCH` — `main`
4. Triggers → Add Trigger → `run` → Time-driven → Weekly (for ongoing updates)
5. For the initial historical seed: select `startStatsBombRebuild` → Run once.
   Takes ~30–60 min; auto-reschedules itself. Check with `rebuildStatus()`.

**Adding a new data source** to the weekly job:
1. Write `fetchFromYourSource_()` returning an array of raw records
2. Write `normalizeYourSource_(raw)` mapping one raw record to the penalty schema;
   set unknown fields to `null`; end with `p.confidence = deriveConfidence_(p)`
3. Add `{ name: 'your-source', fetch: fetchFromYourSource_, normalize: normalizeYourSource_ }`
   to the `SOURCES` array in `AggregatePenalties.gs` — nothing else changes

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
- `pitwall/` and `pitwall/live/` extend this with `--bg-2`, `--card-2`,
  `--ink-4`, status colors `--green`/`--yellow`/`--red`/`--blue`/`--sc`, and
  `--mono` (IBM Plex Mono).
- Fonts (Google Fonts, loaded per-page): **Plus Jakarta Sans** for body/UI,
  **Newsreader** italic for "eyebrow"/lede copy, **IBM Plex Mono** for
  timing/numeric data in Pit Wall.

When adding a new page, copy the `:root` block from the closest existing page
rather than reinventing values.

## Adding a new page

Each page (`index.html`, `pdf/index.html`, `pitwall/index.html`,
`pitwall/live/index.html`) repeats the same `<head>` boilerplate:
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
  the served site — currently `/`, `/pitwall/`, `/pitwall/live/`, `/pdf/`.

When adding a new top-level page, add its URL to `.pa11yci.json` so it's
covered by the accessibility check.

`functions/**/*.js` (the Race Report API) is covered by the same repo-wide
JS syntax check above — no workflow changes needed. Its dynamically
generated HTML response is **not** covered by html-validate/stylelint/
pa11y-ci (those only scan static `*.html`/`*.css` files), so changes to
`functions/_lib/report.js` need manual verification instead (render it and
eyeball the markup/CSS).

## Deployment

Deployed via Cloudflare Pages:
- Connect repo to Cloudflare Pages with an empty build command and output
  directory `/`.
- Custom domains `mohibb.com` and `www.mohibb.com` point at this Pages
  project.
- Each other project listed in `projects.json` lives in its own repo / Pages
  project on its own subdomain (e.g. `spotkick.mohibb.com`, `f1.mohibb.com`).
- Cloudflare Pages auto-detects the `functions/` directory on push and
  deploys the Race Report API alongside the static site — no `wrangler.toml`
  or separate Workers project needed.
