# mohibb-home

Personal landing page for mohibb.com. Static, data-driven, no build step.

## Structure

```
mohibb-home/
  index.html      page shell + render logic
  projects.json   the project list (edit this to update the page)
  pdf/            PDF Merger tool, served at mohibb.com/pdf/
  pitwall/        Pit Wall · Analyse: completed-session analysis, at mohibb.com/pitwall/
  pitwall/live/   Live F1 dashboard, served at mohibb.com/pitwall/live/
  spotkick/       Spotkick penalty analytics, served at mohibb.com/spotkick/
  functions/      Race Report API (Cloudflare Pages Function), at mohibb.com/api/race-report
  README.md
```

The page reads `projects.json` at load and renders the cards. To change
anything about the projects shown, you edit the JSON, not the HTML.

## Editing projects

Each item in `projects.json`:

```json
{
  "name": "Spotkick",
  "category": "Football",
  "description": "Short one-line description.",
  "url": "https://spotkick.mohibb.com",
  "status": "soon"
}
```

`status` accepts:
- `soon` — dimmed, non-clickable, "Under development" tag
- `wip`  — dimmed, non-clickable, "In progress" tag
- `live` — clickable link to `url`, hover arrow, green "Live" tag

To launch a project: change its `status` to `live`, commit, push. That's it.
Cards are numbered automatically per group in the order they appear in the JSON.

## Run locally

Must be served over HTTP (fetch won't work from file://):

```
npx serve .
```

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub.
2. Cloudflare -> Workers & Pages -> Create -> Pages -> Connect to Git.
3. Pick this repo. Build command: empty. Output directory: `/`.
4. Deploy, then Custom domains -> add `mohibb.com` and `www.mohibb.com`.

## Projects

### PDF Merger (mohibb.com/pdf)

Lives in `pdf/` in this repo and is served at `mohibb.com/pdf/` as part of
this same Pages deployment — no separate project or domain needed.

It's a static, client-side PDF merge/reorder tool built on `pdf-lib`
(`pdf/pdf-lib.min.js`, bundled). Nothing is uploaded — all merging happens in
the browser.

### Pit Wall (mohibb.com/pitwall)

Lives in `pitwall/` and is served at `mohibb.com/pitwall/` as part of this
same Pages deployment — no separate project or domain needed.

A self-contained, client-side session-analysis tool (Chart.js from CDN is the
only external dependency) for digging into any completed F1 session —
theoretical best laps, qualifying potential, race lap charts, tyre strategy
and long-run race pace. A companion live dashboard (`pitwall/live/`) shows the
current/most recent session plus season standings, with an idle next-race
countdown when no session is live. Data comes from OpenF1 (live session data
and historical session data) and Jolpica (standings + schedule).

### Race Report API (mohibb.com/api/race-report)

Lives in `functions/` and is deployed automatically as part of this same
Pages project — Cloudflare auto-detects the `functions/` directory on push,
no separate Workers project or `wrangler.toml` needed.

The only server-side code in this repo: `GET /api/race-report` returns a
full-analysis F1 race report (classification, fastest lap, a race-history
chart, tyre strategy, Safety Car/VSC periods) as a standalone, self-contained
HTML document — on-demand only, no scheduling, no email-sending. See
[`functions/README.md`](functions/README.md) for the full API reference
(endpoints, status codes, examples, architecture).

### Spotkick (mohibb.com/spotkick)

Lives in `spotkick/` and is served at `mohibb.com/spotkick/` as part of this
same Pages deployment — no separate project or domain needed.

A self-contained, client-side penalty analytics dashboard built on StatsBomb
open data. A local build script downloads StatsBomb's open data and writes a
flat `spotkick/data/penalties.json` with a computed "Pressure Index" per
penalty. The page loads that file and does all filtering and aggregation in
the browser — nothing is uploaded, no backend.

## Notes

- Other projects in projects.json each live in their own repo / Pages project
  on their own subdomain.
- Subdomains assumed in projects.json: spotkick, f1, panello, pulsar
  (all under mohibb.com). Adjust the urls if you use different ones.
