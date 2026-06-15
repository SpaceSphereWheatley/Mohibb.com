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

Implemented in `src/js/pressureIndex.js` (shared by the build script and the
UI). It scores every penalty 0-100 by blending five components, each
normalised to 0-1, then taking a weighted sum and scaling to 0-100:

```
raw   = Σ (weight_i / activeWeight) * value_i
index = round(min(100, max(0, raw * 100)))
```

`activeWeight` is the sum of weights for components that apply to this kick
(see "Inactive terms" below) — this keeps the index spanning the full 0-100
range even when, say, league context doesn't apply.

| Component   | Weight | What it captures |
|-------------|-------:|------------------|
| Scoreline   | 0.20 | How much the scoreline raises the stakes of scoring/missing |
| Minute      | 0.12 | How late in the match it is |
| Competition | 0.16 | How high-stakes the round/stage is |
| Interaction | 0.16 | Scoreline × minute — a tight game late on is worse than either alone |
| Shootout    | 0.18 | Position/stakes within a penalty shootout (0 if not a shootout) |
| League      | 0.18 | Wider context: title race, relegation battle, etc. (0 if not applicable) |

### Scoreline (`S`)

Maps the scoreline situation at the time of the kick to a 0-1 stakes value:

| Situation    | Value |
|--------------|------:|
| Winning 2+   | 0.10 |
| Winning by 1 | 0.30 |
| Level        | 0.70 |
| Losing by 1  | 0.90 |
| Losing 2+    | 0.40 |

Being level or one goal down is highest-stakes (a goal/miss directly swings
the result); a 2+ goal deficit is already semi-decided, so it's lower than
"losing by 1" but still above a comfortable lead.

### Minute (`M`)

A sigmoid centred on minute 75:

```
M = 1 / (1 + e^(-0.08 * (minute - 75)))
```

Flat (low pressure) through the first hour, then accelerates toward 1 as the
match heads into its closing stages and stoppage time.

### Competition stage (`C`)

Maps the round/stage to a 0-1 value:

| Stage          | Value |
|----------------|------:|
| Group stage    | 0.30 |
| Cup, early round | 0.35 |
| League run-in / Round of 16 | 0.55 |
| Quarter-final  | 0.70 |
| Semi-final     | 0.80 |
| Cup final      | 0.85 |
| Major final (e.g. World Cup final) | 1.00 |

### Interaction (`S × M`)

The product of the scoreline and minute values above. A close game in the
89th minute compounds both factors — this term lets that compounding show up
beyond what the two components contribute individually.

### Shootout (`P`)

Only active when `isShootout` is true (weight redistributed to other
components otherwise):

```
base     = kickNumber / 5
pressure = max(0, 1 - |shootoutDelta| * 0.2)
P        = min(1, base * pressure)
```

Sudden-death kicks (kick number > 5) are fixed at 0.90. Otherwise pressure
rises with kick number (later kicks matter more) and falls as the shootout
scoreline becomes more decisive (`shootoutDelta` = goal difference within the
shootout at the time of the kick).

### League context (`L`)

Only active when `leagueContext` is set to something other than `'na'`:

| Context     | Value |
|-------------|------:|
| Early season | 0.20 |
| Title race   | 0.75 |
| Promotion race | 0.75 |
| Relegation battle | 0.80 |
| Final day    | 1.00 |

This currently defaults to neutral/inactive until an external standings
source (e.g. football-data.org) is wired into the build.

### Inactive terms

If a kick isn't part of a shootout, the `Shootout` weight (0.18) is dropped
and its share is redistributed proportionally across the remaining active
terms — likewise for `League` (0.18) when no league context applies. This is
what the `activeWeight` division above does, and it's why the index still
spans 0-100 for in-play penalties even though two of the six weights never
apply to them.

## Attribution

Data: [StatsBomb open data](https://github.com/statsbomb/open-data). Cited in
the page footer as well as here — if you publish anything built on this data,
cite StatsBomb too.
