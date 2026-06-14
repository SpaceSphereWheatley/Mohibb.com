# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal landing page for mohibb.com. Static, data-driven, no build step, no
dependencies, no framework.

## Structure

```
index.html      page shell, styles, and render logic
projects.json   the project list (edit this to update the page)
pdf/            PDF Merger tool, served at mohibb.com/pdf/
pitwall/        Pit Wall live F1 dashboard, served at mohibb.com/pitwall/
README.md
```

## Architecture

- `index.html` contains all CSS (inline `<style>`) and JS (inline `<script>`)
  for the page shell, plus a `#groups` mount point.
- On load, the script fetches `projects.json` and renders project "groups"
  (e.g. "Projects", "Tools") into cards via `groupHtml`/`cardHtml`.
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
its own `<style>`/`<script>`. All merging happens in-browser; nothing is
uploaded.

It's served at `mohibb.com/pdf/` automatically as part of this same Pages
deployment (output directory `/` includes `pdf/`) — no separate project or
domain needed.

## Pit Wall (mohibb.com/pitwall)

`pitwall/` is a self-contained, client-side live F1 dashboard. A single
`index.html` (Chart.js is the only external dependency, loaded from CDN). It
shows what's happening in the current/most recent F1 session plus current-season
standings, and an idle countdown to the next race when no session is live.

- Data: **OpenF1** (`api.openf1.org`) for live session data — polled every 5s
  only while a session is LIVE, never while IDLE. **Jolpica** (`api.jolpi.ca`,
  Ergast successor) for championship standings + schedule — fetched once on
  load / manual refresh only, never polled (volunteer-run, rate-limited).
- Liveness: `sessions?session_key=latest` decides LIVE (now between
  `date_start`/`date_end` + 10 min grace) vs IDLE. IDLE is the common case and
  is a designed screen (next-race countdown in Europe/Oslo time), not an error.
- Design: dark "control-room" base, F1-red (`#E10600`) reserved for the live
  pulse and fastest-stop highlight only. Shares the landing page's typography
  (Plus Jakarta Sans + Newsreader italic) plus IBM Plex Mono for timing
  numerals. All times shown in Europe/Oslo.
- Served at `mohibb.com/pitwall/` as part of this same Pages deployment
  (output directory `/` includes `pitwall/`) — no separate project needed.

## Deployment

Deployed via Cloudflare Pages:
- Connect repo to Cloudflare Pages with an empty build command and output
  directory `/`.
- Custom domains `mohibb.com` and `www.mohibb.com` point at this Pages
  project.
- Each other project listed in `projects.json` lives in its own repo / Pages
  project on its own subdomain (e.g. `spotkick.mohibb.com`, `f1.mohibb.com`).
