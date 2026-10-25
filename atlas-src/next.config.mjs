/**
 * Static export configuration.
 *
 * The app is served from https://mohibb.com/atlas/ as part of the same
 * Cloudflare Pages deployment as the rest of the site, so:
 *   - `output: "export"`  emits a pure static site into ./out
 *   - `basePath`/`assetPrefix` rewrite every asset URL under /atlas
 *   - `trailingSlash`     makes /atlas/ resolve to /atlas/index.html
 *   - `images.unoptimized` is required: there is no image optimiser at runtime
 *
 * `npm run build` then copies ./out to ../atlas (see scripts/publish.mjs), and
 * Cloudflare publishes the repository root as-is.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/atlas",
  assetPrefix: "/atlas",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  // Next writes AGENTS.md / CLAUDE.md into the project on `next dev`; this repo
  // keeps its own instructions at the root, so don't generate competing ones.
  agentRules: false,
};

export default nextConfig;
