# Spotkick — Google Apps Script data pipeline

Two `.gs` files live in the same GAS project and share all helper functions:

| File | Purpose |
|------|---------|
| `AggregatePenalties.gs` | **Weekly job** — fetches recent penalties from live sources (Understat, …), merges into `penalties.json`, pushes to GitHub |
| `StatsBombRebuild.gs` | **One-shot rebuild** — rebuilds the full StatsBomb historical baseline from scratch using a multi-run continuation pattern |

---

## Initial GAS project setup

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Rename the project (e.g. "Spotkick data").
3. Create two script files:
   - Rename the default `Code.gs` to `AggregatePenalties.gs` and paste the contents.
   - Click **+** → New script file, name it `StatsBombRebuild.gs`, paste the contents.
4. **Script Properties** (⚙ Project Settings → Script properties → Add):

   | Property | Value |
   |----------|-------|
   | `GITHUB_TOKEN` | GitHub PAT with `repo` scope (Contents read/write) |
   | `GITHUB_REPO` | `SpaceSphereWheatley/Mohibb.com` |
   | `GITHUB_BRANCH` | `main` |

---

## Weekly job (`AggregatePenalties.gs`)

Sets up a recurring trigger that fetches the last 9 days from each registered
source, dedupes against existing data, and pushes any new penalties to GitHub.

**Set the trigger once:**
Triggers (⏱) → Add Trigger → Function: `run` → Time-driven → Week timer →
choose day/time → Save.

**Test it manually:**
Select `run` in the function dropdown → click **Run**. Check the execution log:
- `Existing penalties: 855` (or however many are in the file)
- Source fetch counts
- `Nothing changed, skipping commit.` (if no new data) or a GitHub write

---

## Historical StatsBomb rebuild (`StatsBombRebuild.gs`)

Rebuilds the full StatsBomb dataset from `raw.githubusercontent.com`. Because
GAS has a 6-minute execution limit and the rebuild requires ~2000–4000 HTTP
requests, it uses a **continuation pattern**: each run processes a parallel
batch of 5 event files, saves progress to `PropertiesService`, then
auto-schedules itself to continue every minute via a time-driven trigger.

**Estimated time:** 20–60 minutes depending on network latency.

### State storage

GAS `PropertiesService` has a 9 KB per-property limit and 500 KB total —
far too small for the match index (~600 KB) and accumulated penalties (~1.5 MB).
Instead, large data is written to temporary GitHub files during the rebuild:

| Data | Storage |
|------|---------|
| Match index | `spotkick/data/_sb_rebuild_index.json` (deleted at finalize) |
| Accumulated penalties | `spotkick/data/_sb_rebuild_wip.json` (deleted at finalize) |
| Status, trigger ID | `PropertiesService` (`SB_STATUS`, `SB_TRIGGER_ID`) |
| Pending match IDs | `PropertiesService`, chunked at 7 KB each (`SB_IDS_0`, `SB_IDS_1`, …) |

### Steps

1. Select `startStatsBombRebuild` in the function dropdown → click **Run**.
   - The execution log shows the competition count, match count, and
     `"Phase 1 done. Starting first batch..."`.
   - `_sb_rebuild_index.json` and `_sb_rebuild_wip.json` appear in the repo.
   - A 1-minute recurring trigger is created automatically.
2. Check progress at any time by running `rebuildStatus()`.
3. When all matches are processed, the script:
   - Merges rebuilt StatsBomb records with any existing data (Understat rows
     added by the weekly job are preserved; StatsBomb wins on conflict).
   - Writes the result to `spotkick/data/penalties.json` on GitHub.
   - Deletes the two temporary `_sb_rebuild_*.json` files from GitHub.
   - Deletes the trigger and clears all `SB_` properties.
4. The log says `Done. penalties.json updated on GitHub.` and Cloudflare Pages
   picks up the commit automatically.

### Stopping early

Run `cancelStatsBombRebuild()` — removes the trigger, clears PropertiesService
state, and deletes the temporary GitHub files.

### When to run a rebuild

- When StatsBomb releases new open-data seasons
- When adding new competitions to `STATSBOMB_COMPETITION_ALLOWLIST`
- After a fresh repo setup (no `penalties.json` yet — the script creates it)

---

## Data quality: the `confidence` field

Each penalty record carries a `confidence` tier derived from available data:

| Tier | Meaning | Typical source |
|------|---------|----------------|
| `"full"` | Placement zone + real scoreline context known | StatsBomb |
| `"partial"` | Outcome known; no placement, scoreline approximated | Understat / partial sources |
| `"minimal"` | Everything fell back to defaults | Future minimal-data sources |

The UI "Include estimated penalties" toggle lets users exclude `partial`/`minimal`
rows. The heatmap already skips null-placement rows automatically.

---

## Adding a new source to the weekly job

1. Write `fetchFromYourSource_()` — returns an array of raw records.
2. Write `normalizeYourSource_(raw)` — maps one raw record to the common schema.
   Set unknown fields to `null`. Always end with `p.confidence = deriveConfidence_(p)`.
3. Add to `SOURCES` in `AggregatePenalties.gs`:
   ```javascript
   { name: 'your-source', fetch: fetchFromYourSource_, normalize: normalizeYourSource_ }
   ```
   Nothing else changes — the merge, dedupe, and write logic handles the rest.
