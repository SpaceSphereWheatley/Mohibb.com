# AggregatePenalties — Google Apps Script setup

Weekly job that appends new penalties from live sources into
`spotkick/data/penalties.json` and pushes the result directly to GitHub.

## How it works

1. Reads the current `spotkick/data/penalties.json` from GitHub (Contents API).
2. Backfills any records missing a `confidence` field (one-time migration on first run).
3. For each registered source, fetches recent matches and normalizes to the shared schema.
4. Merges incoming records into the existing dataset (dedupes by `date|taker|minute`).
5. If anything changed, writes the updated file back to GitHub with a dated commit message.
6. Cloudflare Pages picks up the commit and rebuilds automatically.

## Initial setup

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Rename the project (e.g. "Spotkick data").
3. Replace the default `Code.gs` content with the full contents of `AggregatePenalties.gs`.
4. **Script Properties** (Project Settings → Script properties → Add):
   | Property | Value |
   |----------|-------|
   | `GITHUB_TOKEN` | A GitHub Personal Access Token with `repo` scope (Contents read/write) |
   | `GITHUB_REPO` | `SpaceSphereWheatley/Mohibb.com` |
   | `GITHUB_BRANCH` | `main` |
5. **Test the script**: click the function dropdown → select `run` → click **Run**.
   Check the execution log (View → Logs). You should see existing penalty count,
   source fetch counts, and either a commit or "Nothing changed, skipping commit."
6. **Set the trigger**: Triggers (⏱ icon) → Add Trigger → `run` → Time-driven →
   Week timer → day and time of your choice → Save.

## Data quality: the `confidence` field

Each penalty record carries a `confidence` tier derived from available data:

| Tier | Meaning | Typical source |
|------|---------|----------------|
| `"full"` | Placement zone + real scoreline context known | StatsBomb historical data |
| `"partial"` | Outcome known; no placement, scoreline approximated | Understat current-season |
| `"minimal"` | Everything fell back to defaults | Future minimal-data sources |

The UI "Include estimated penalties" toggle lets users include or exclude
`partial`/`minimal` rows. Charts that rely on placement (heatmap) skip null-placement
rows automatically.

## Adding a new source

1. Write `fetchFromYourSource_()` — returns an array of raw records in whatever
   shape the API/page provides.
2. Write `normalizeYourSource_(raw)` — maps one raw record to the common schema.
   Set unknown fields to `null`. Always end with `p.confidence = deriveConfidence_(p)`.
3. Add an entry to the `SOURCES` array at the top of the script:
   ```javascript
   { name: 'your-source', fetch: fetchFromYourSource_, normalize: normalizeYourSource_ }
   ```
   Nothing else changes — the merge, dedupe, and write logic handles the rest.

## Historical baseline

The 855-record StatsBomb backbone (`spotkick/data/penalties.json`) was generated
by running `scripts/build-data.mjs` (Node 18+) or `scripts/build_data_colab.py`
(Google Colab). Those scripts remain in the repo for historical rebuilds.
This GAS job only appends new records — it never overwrites records that already exist.
