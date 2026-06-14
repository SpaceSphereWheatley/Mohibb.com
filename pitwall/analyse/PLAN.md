# Pit Wall — "Analyse" tab plan

A new self-contained page, `pitwall/analyse/index.html`, following the same
pattern as `pdf/` and `pitwall/` (own `<style>`/`<script>`, shared design
tokens from the landing page, no build step). Linked from the pitwall
toprule. All data comes from OpenF1's **free historical** endpoints
(`/meetings`, `/sessions`, `/laps`, `/stints`, `/pit`, `/drivers`,
`/position`) — no live-lock issues since these are completed sessions.

## 1. Session picker
Year → Meeting (race weekend) → Session (FP1/FP2/FP3/Quali/Sprint/Race)
dropdowns. Populate via `/meetings?year=` and `/sessions?meeting_key=`.
Cache each session's raw data in `sessionStorage` keyed by `session_key` —
it never changes once a session ends.

## 2. Practice: theoretical best lap
Per driver, pull `/laps?session_key=`, take
`min(duration_sector_1/2/3)` across all non-pit/non-deleted laps and sum →
"theoretical best". Show alongside actual fastest lap, with the delta.
Table: driver | actual best | theoretical best | time left on table.

## 3. Qualifying: actual vs theoretical
Same theoretical-best calc, but computed from **practice** sessions (FP1-3
combined) for that driver, compared against their actual Qualifying best
lap. Table: driver | quali best | practice theoretical best | gap — shows
who "left time on the table" vs who maximized it.

## 4. Race: lap chart + strategy
- **Lap chart**: line chart of lap time per lap per driver (from `/laps`),
  with pit-in/out laps marked — reveals pace, traffic, fuel-correction
  trends.
- **Strategy**: stint/compound bars per driver across the full race
  (generalize the existing tyre-strategy renderer from the live dashboard
  to work on any completed session), plus pit stop timing/duration from
  `/pit`.
- Optional stretch: position-over-time chart from `/position`.

## 5. Between quali and race — useful free data
- **Long-run pace** (from FP2, sometimes FP3): filter for stints of ≥5
  consecutive clean laps on one compound, take median lap time per driver
  per compound — a proxy for race pace, since teams typically run race-sim
  stints in FP2.
- **Quali pace**: ranked best lap times.
- **Tyre allocation context**: `/stints` across all practice sessions shows
  which compounds each driver has used/saved — hints at strategy
  flexibility.

A "Race Pace Indicator" panel combining long-run pace rank + quali pace rank
gives a directional view of who looks strong — framed explicitly as
**informational, not a prediction** (fuel loads, track evolution, and
qualifying-sim vs race-sim differences mean it's a rough signal, not a
forecast).

## Build order
1. Page scaffold + session picker + data caching (foundation everything else
   needs)
2. Practice theoretical-best + Qualifying comparison (most novel, smallest
   data needs)
3. Race lap chart + strategy (reuses existing chart/stint code)
4. Long-run pace / race-pace-indicator panel (most exploratory, do last)

## Status

Stages 1–4 are all shipped (`analyse/index.html`):
- Practice: theoretical best lap + long-run pace.
- Qualifying: pace ranking, quali-vs-practice-potential, race-pace indicator.
- Race: lap chart, tyre strategy + pit stops, position-over-time.
The page is linked from the live Pit Wall toprule.

## Next stages (post-plan)
- **Shareable deep links** *(done)*: the selected year/meeting/session is
  encoded in the URL hash (`#y=…&m=…&s=…`), restored on load and on
  back/forward, with a "Copy link" button on the session banner — so any
  analysis can be bookmarked or shared.
- **Race-history chart** *(done)*: a "gap to a reference car" trace. Each
  car's cumulative race time is differenced against a reference driver
  (default: the winner, selectable), so the bold zero line is the
  reference's race and a trace above it was ahead at that lap, below was
  behind. Reveals overtakes, undercuts, SC bunching and lapping at a glance.
- **Graph/Table toggle on the qualifying panels** *(done)*: Qualifying Pace
  (gap-to-pole bars) and Quali vs Practice Potential (signed delta bars,
  green = found more / accent = left on the table) each get a segmented
  Graph⇄Table switch, showing one view at a time.
- Ideas for later: driver head-to-head (sector deltas), in-stint tyre
  degradation trend, extend the graph/table toggle to the practice panels.
