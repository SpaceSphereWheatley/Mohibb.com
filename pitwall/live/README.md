# Pit Wall · Live

A self-contained, client-side live F1 dashboard, served as part of the
mohibb.com Cloudflare Pages deployment at `mohibb.com/pitwall/live/`. It's
the companion to [Pit Wall](../README.md), which is the landing experience
for digging into any *completed* session.

## How it works

A single `index.html` (Chart.js from CDN is the only external dependency). It
shows what's happening in the current/most recent session plus current-season
standings, and an idle countdown to the next race when no session is live.
When idle, it can show the results of the *previous* session behind a spoiler
gate (hidden by default, with a reveal button; resets when the session
changes).

- **Live data**: [OpenF1](https://api.openf1.org) (`api.openf1.org`), polled
  every 3s (`POLL_MS`) while a session is live, dropping to 15s
  (`POLL_ENDED_MS`) once the session has ended but is still in its grace
  window, never while idle.
- **Standings + schedule**: [Jolpica](https://api.jolpi.ca) (Ergast
  successor) — the schedule is fetched once on load/manual refresh, while
  standings are re-polled every 5 min (`STANDINGS_POLL_MS`) while a session is
  live. Jolpica is volunteer-run and rate-limited, so it's polled at this slow
  cadence and never faster.
- **Liveness**: `sessions?session_key=latest` decides LIVE (now between
  `date_start`/`date_end` + 10 min grace) vs IDLE. IDLE is the common case and
  is a designed screen (next-race countdown in Europe/Oslo time), not an
  error.

## Project layout

```
pitwall/
  index.html        Pit Wall · Analyse (the landing page)
  live/
    index.html       live dashboard (this page)
```

## Design

Dark "control-room" base, F1-red (`#E10600`) reserved for the live pulse and
fastest-stop highlight only. Shares the landing page's typography (Plus
Jakarta Sans + Newsreader italic) plus IBM Plex Mono for timing numerals. All
times shown in Europe/Oslo. `:root` CSS custom properties extend the shared
landing-page tokens with `--bg-2`, `--card-2`, `--ink-4`, status colors
(`--green`/`--yellow`/`--red`/`--blue`/`--sc`), and `--mono`.

## Run locally

From the repo root (must be served over HTTP):

```
npx serve .
```

Then open `/pitwall/live/`.
