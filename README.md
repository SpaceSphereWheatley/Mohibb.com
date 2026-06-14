# mohibb-home

Personal landing page for mohibb.com. Static, data-driven, no build step.

## Structure

```
mohibb-home/
  index.html      page shell + render logic
  projects.json   the project list (edit this to update the page)
  pdf/            PDF Merger tool (its own Pages project, see below)
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
- `soon` — dimmed, non-clickable, "Coming soon" tag
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

## PDF Merger (mohibb.com/pdf)

Lives in `pdf/` in this repo and is served at `mohibb.com/pdf/` as part of
this same Pages deployment — no separate project or domain needed.

It's a static, client-side PDF merge/reorder tool built on `pdf-lib`
(`pdf/pdf-lib.min.js`, bundled). Nothing is uploaded — all merging happens in
the browser.

## Notes

- Other projects in projects.json each live in their own repo / Pages project
  on their own subdomain.
- Subdomains assumed in projects.json: spotkick, f1, panello, pulsar
  (all under mohibb.com). Adjust the urls if you use different ones.
