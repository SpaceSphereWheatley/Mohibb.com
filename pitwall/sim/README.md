# Pit Wall · Race Simulator (`/pitwall/sim/`)

A self-contained, client-side **2D top-down Formula 1 race simulator**. A seeded
generator builds a procedural circuit; a segment-time model then runs a full
grand prix — car performance from team + driver ratings, tyre wear, fuel burn,
dynamic pit strategy and overtaking — rendered as team-coloured dots with a
live timing tower.

Everything runs in-browser. No build step, no backend.

## Run locally

Must be served over HTTP (the modules and `fetch('./data.json')` won't work
from `file://`):

```
npx serve .
# then open http://localhost:3000/pitwall/sim/
```

Add `?debug` to the URL for a live **Tweakpane** tuning panel over the sim
constants.

## How it works

| File | Responsibility |
| --- | --- |
| `js/config.js` | Every tunable constant (the `?debug` panel binds here). |
| `js/rng.js` | Seeded PRNG (mulberry32) — a seed reproduces the track + race. |
| `js/geometry.js` | Catmull-Rom spline maths + arc-length lookup. |
| `js/track.js` | Procedural circuit, segment classification, pit lane. |
| `js/tyres.js` | Compound definitions and the wear → pace model. |
| `js/car.js` | Per-car state + stat-derived performance. |
| `js/overtake.js` | Pass-probability resolution. |
| `js/strategy.js` | Per-car pit brain (undercut / overcut / 2-compound rule). |
| `js/race.js` | Fixed-step tick loop: movement, traffic, pits, order, gaps. |
| `js/render.js` | PixiJS scene graph (the only renderer-aware module). |
| `js/leaderboard.js` | DOM timing tower. |
| `js/analysis.js` | Post-race Chart.js charts. |
| `js/tuning.js` | Dev-only Tweakpane panel (gated by `?debug`). |
| `js/ui.js` | Control-bar wiring. |
| `js/main.js` | Entry point + animation loop. |

## The model

The timing core is a **segment-time model**, not force-based dynamics. Each
metre of track has a base speed (from curvature), and a car's speed each tick is

```
speed = segment.baseSpeed × carPerf × tyrePace × fuelFactor × traffic
```

The realism lives in the multipliers: tyre degradation curves per compound
(scaled by a driver's `tyre_management`), fuel burn (`~0.03 s/lap/kg`),
dirty-air / DRS deltas, racecraft-weighted overtaking probability, and the
strategy AI's pit-window decisions.

## Data

`data.json` is a hand-authored, **illustrative** 2026 grid (11 teams / 22
drivers) in this shape:

```json
{
  "teams":   [{ "name", "colour", "base_aero", "base_chassis", "base_engine", "pit_stop_efficiency" }],
  "drivers": [{ "name", "code", "team", "stats": { "pace", "racecraft", "tyre_management", "qualifying_pace", "consistency" } }]
}
```

Use the **Load grid…** button to drop in your own file with the same shape
(`colour`/`code` are optional — a palette and initials fill in).

## Dependencies

Vendored into `vendor/` (no runtime CDN), loaded via an import map:

- **PixiJS** — WebGL rendering
- **simplex-noise** — organic track shapes
- **Tweakpane** — `?debug` tuning panel
- **Chart.js** — post-race analysis (global UMD build)

## Future ideas

- Derive the base grid from a real OpenF1 session (synthesising the
  pace/racecraft ratings OpenF1 doesn't carry).
- A three.js 3D view (swap `render.js` only).
- A qualifying sim to set the grid; weather / safety cars / DRS zones.
