# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal landing page for mohibb.com. Static, data-driven, no build step, no
dependencies, no framework.

## Structure

```
index.html      page shell, styles, and render logic
projects.json   the project list (edit this to update the page)
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

## Deployment

Deployed via Cloudflare Pages:
- Connect repo to Cloudflare Pages with an empty build command and output
  directory `/`.
- Custom domains `mohibb.com` and `www.mohibb.com` point at this Pages
  project.
- Each project listed in `projects.json` lives in its own repo / Pages
  project on its own subdomain (e.g. `spotkick.mohibb.com`, `f1.mohibb.com`).
