# mohibb-home

Personal landing page for mohibb.com. Static, data-driven, no build step.

## Structure

```
mohibb-home/
  index.html      page shell + render logic
  projects.json   the project list (edit this to update the page)
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

## Notes

- Each project lives in its own repo / Pages project on its own subdomain.
- Subdomains assumed in projects.json: spotkick, f1, panello, pulsar, pdf
  (all under mohibb.com). Adjust the urls if you use different ones.
