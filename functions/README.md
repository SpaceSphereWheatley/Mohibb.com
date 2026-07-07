# Race Report API

A single Cloudflare Pages Function that returns a full-analysis F1 race
report as a standalone HTML document. It's the only server-side code in this
repo — everything else is static, client-side, no-build-step (see the root
[README](../README.md)).

- **On-demand only.** There's no scheduled job anywhere in this repo. Call
  the endpoint whenever you want a report.
- **No email sending.** The endpoint returns HTML; sending it wherever it
  needs to go (Gmail, forwarding, some future automation) is a separate,
  manual step outside this repo.
- **Deployed automatically** as part of the same Cloudflare Pages project —
  Cloudflare auto-detects the `functions/` directory on push. No
  `wrangler.toml` or separate Workers project needed.

## Endpoint

```
GET /api/race-report
GET /api/race-report?session_key=<key>
GET /api/race-report?session_key=latest
```

| Query param   | Required | Description |
|---------------|----------|-------------|
| `session_key` | No       | An [OpenF1](https://api.openf1.org) session key, or the literal string `latest`. **Omitting it entirely defaults to `latest`** — the simplest URL, `/api/race-report`, just works. |

Only `GET` is supported.

The endpoint only ever reports on **Race** sessions. `session_key=latest`
resolves to the most recently *completed* Race of the current F1 weekend
(same liveness convention as `pitwall/live/`): it looks at every session of
the latest meeting, picks the Race, and requires it to have finished.

## Response

Always `content-type: text/html; charset=utf-8` — success and error
responses alike. There is no JSON response mode.

| Status | When |
|--------|------|
| `200`  | Report rendered. May still be a *partial* report if one or more OpenF1 endpoints failed to respond after retries — see [Resilience](#resilience--caching) below; a footer note lists which endpoints degraded. |
| `404`  | `session_key` doesn't resolve to any session (or `latest`'s meeting has no Race session at all yet). |
| `409`  | The resolved session is a Race, but it hasn't finished yet. |
| `422`  | The resolved session exists and has finished, but isn't a Race (e.g. Qualifying, Practice). |
| `502`  | The initial OpenF1 `sessions` lookup itself failed (network/upstream error), so no session could be resolved at all. |

`cache-control` on a `200` response: `public, max-age=86400` for an explicit
`session_key` (a finished session's data is immutable), `public,
max-age=300` for `session_key=latest` (a moving target — a new session can
start at any time).

## Report contents

The rendered page is a single self-contained HTML document — inline
`<style>`, no external stylesheet/CDN, **no `<script>` at all** — so it's
safe to forward, paste elsewhere, or use as an email body.

1. **Header** — event name, circuit, session date (Europe/Oslo).
2. **Classification** — final position, driver, team, laps completed, plus
   each driver's median clean-lap pace and gap to the fastest. Sorted by
   position (not re-sorted by pace). Laps completed (rather than a
   finish-time gap) is what distinguishes finishers from retirees/lapped
   cars, since OpenF1's free historical data doesn't expose a sourced
   classification/results field.
3. **Fastest lap** — driver, team, lap number, time.
4. **Race history** — an inline SVG chart of each driver's running gap to
   the race winner, lap by lap, **capped to the top 10 classified drivers**
   for readability. Safety Car/VSC periods are shaded; pit in-laps are
   marked with ringed dots.
5. **Tyre strategy** — each driver's reconstructed stints (compound + lap
   range). Falls back to a plain notice if OpenF1's stint feed for that
   session is incomplete (missing an opening stint or has gaps), rather than
   render misleading bars.
6. **Safety Car / VSC periods** — a table of every period (or "None").
7. **Footer** — data-source credit, plus which OpenF1 endpoints (if any)
   failed and were degraded.

## Resilience & caching

- **Edge caching.** Every OpenF1 call in `_lib/openf1.js` is cached via
  Cloudflare's Cache API (`caches.default`): an hour for historical
  per-session endpoints (`laps`, `stints`, `pit`, `position`,
  `race_control`, `drivers`, `meetings` — immutable once a session's
  finished), 30 seconds for the `session_key=latest` lookup itself. Without
  this, every request/refresh is a fresh, stateless Function invocation
  firing 6–8 concurrent OpenF1 calls with no browser-side cache to fall back
  on — which OpenF1 intermittently rate-limits (visible as missing
  driver/team data, or a full `502`).
- **Retries.** A failed fetch retries up to twice with jittered exponential
  backoff before giving up.
- **Per-section degradation.** The six data-fetching calls (`drivers`,
  `laps`, `stints`, `pit`, `position`, `race_control`) run in parallel via
  `Promise.allSettled`, not `Promise.all`. Any one of them can fail
  independently — the report still returns `200` with whatever sections it
  could build, and lists the rest in the footer. This mirrors
  `pitwall/script.js`'s own per-panel retry/fallback philosophy.

## Examples

```bash
# the latest completed race, simplest form
curl https://mohibb.com/api/race-report

# same, explicit
curl "https://mohibb.com/api/race-report?session_key=latest"

# a specific past session
curl "https://mohibb.com/api/race-report?session_key=9158"
```

## Architecture

```
functions/
  api/
    race-report.js   route: GET /api/race-report -> onRequestGet
  _lib/
    openf1.js         OpenF1 fetch helpers, edge caching, session resolution/validation
    analysis.js        pure computation: classification, fastest lap, tyre strategy,
                        safety-car parsing, race pace, race-history traces
    report.js          HTML rendering (page shell + section templates + inline SVG chart)
```

`_lib/` is excluded from Cloudflare Pages' automatic routing (any
`_`-prefixed directory is never treated as a route) — it's purely an import
target for `api/race-report.js`.

The analysis logic is **ported**, not imported, from `pitwall/script.js`'s
pure functions (`theoretical`, `bestLap`, `reconstructStints`,
`parseSafety`, etc.). `pitwall/script.js` can't be imported directly into a
Pages Function: it references `window`/`document`/`sessionStorage` at
module scope, none of which exist in the Workers runtime. Ported functions
keep the same algorithms; anything not needed by this report (quali pace,
car-performance ratings, tyre-degradation slope modelling, the strategy
simulator, undercut calc) was deliberately left out.

## Running locally

There's no `package.json`/`wrangler.toml` in this repo — pull the tooling
on demand, same as everything else here:

```bash
npx wrangler@latest pages dev .
```

This serves the static site *and* the Functions (unlike `npx serve .`,
which is static-only and won't execute `functions/`). Then:

```bash
curl -i "http://127.0.0.1:8788/api/race-report?session_key=<a known finished Race session_key>"
```

## Testing changes

Because the response is generated dynamically, it isn't covered by this
repo's `html-validate`/`stylelint`/`pa11y-ci` CI checks (those only scan
static `*.html`/`*.css` files) — only `functions/**/*.js`'s syntax is
checked automatically. Changes to `_lib/report.js` need manual verification:
render a report and eyeball the markup/CSS, e.g. by saving the response body
to a file and opening it in a browser.
