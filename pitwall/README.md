# Pit Wall · Analyse

The Pit Wall landing page — dig into any *completed* F1 session. Served at
`mohibb.com/pitwall/` as part of the Cloudflare Pages deployment. A "Live"
button links to the companion [live dashboard](live/README.md) at
`mohibb.com/pitwall/live/`.

## How it works

A single `index.html` (Chart.js from CDN is the only external dependency).
Pick a season, Grand Prix and session from the sticky picker; the page fetches
[OpenF1](https://api.openf1.org)'s historical endpoints (`laps`, `stints`,
`pit`, `position`, `drivers`, `race_control`, `car_data`) for that
`session_key` and renders the relevant analysis below. Completed sessions
never change, so every response is cached in `sessionStorage` — switching
back and forth between sessions doesn't re-fetch. The current selection is
encoded in the URL hash so it can be bookmarked/shared (Copy link).

OpenF1's historical data starts in 2023 (`FIRST_YEAR`). Sessions that
haven't finished yet show a "not finished" notice instead — head to the
[live dashboard](/pitwall/live/) for those.

## Sections, by session type

**Practice**
- **Theoretical Best Lap** — each driver's quickest sector 1/2/3 summed, vs
  their actual best lap ("left on table").
- **Long-Run Pace** — best race-sim stint (5+ laps on one compound, median of
  laps within 107% of the stint's quickest), a directional race-pace guide.

**Qualifying**
- **Qualifying Pace** — best lap per driver, ranked, gap to pole.
- **Quali vs Practice Potential** — quali best vs theoretical best across all
  of practice; who found time / left it on the table.
- **Race Pace Indicator** — blends qualifying rank with long-run pace rank
  from practice (informational, not a prediction).
- **Car Performance** — see below.

**Race**
- **Race History** — cumulative gap to a reference car (default: the winner),
  lap by lap, with Safety Car/VSC shading and pit markers.
- **Tyre Strategy & Pit Stops** — stint bars by compound, pit stops ranked by
  time.
- **Position Changes** — track position over elapsed time.
- **Car Performance** — see below.
- **Lap Times** — lap time per lap per driver, pit laps ringed.

**Practice + Qualifying**
- **Estimated Pit Loss** — weekend-level estimate (median of clean practice
  in/out-lap pairs vs green-lap pace).

A shared **Top-N** preset (Top 3/6/8/All) and **pit-stop marker** toggle apply
to every race chart at once. Top-N just sets which drivers start
shown/hidden — every driver stays in the legend, so any driver can be added
or hidden on top of the preset.

## Car Performance

Acceleration, top speed, and slow/medium/fast cornering speed, plus a
qualifying/race "strength" ranking — all **0–100 and relative to this
session's field**, not absolute or cross-circuit numbers.

- **Traits** (acceleration, top speed, cornering) come from one representative
  lap per driver — their fastest clean lap of the session — via OpenF1's
  `car_data` telemetry (~3.7Hz speed trace), fetched only for that lap's time
  window to keep requests small. The speed trace is smoothed, corners are
  detected as local minima that drop at least `CORNER_DROP_KMH` from the
  preceding peak, and bucketed by exit speed: under `CORNER_SLOW_MAX` (120
  km/h) = slow, up to `CORNER_FAST_MIN` (200 km/h) = medium, above = fast.
  Acceleration is the average speed gained in the `ACCEL_WINDOW_S` (2s) after
  each corner exit.
- **Strength** is Qualifying Strength (best lap vs pole) in the qualifying
  view, or Race Strength (best race-sim stint, i.e. long-run pace) in the race
  view.
- **Driver / Team toggle** — Team mode averages each driver's raw values
  across their team before scaling.
- **Top-N toggle** (Top 5/10/All) — radar charts get unreadable past a
  handful of overlapping polygons, so it defaults to the top 5 by strength.
- **Race / Quali trim toggle** (race view only) — if you've visited
  qualifying for the same weekend earlier in the browser session, its
  car-trait traits are cached (`sessionStorage`, keyed by `meeting_key`) so
  the race view can toggle between "race trim" and "quali trim" telemetry.

## Run locally

From the repo root (must be served over HTTP):

```
npx serve .
```

Then open `/pitwall/`.
