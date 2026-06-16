// Historical baseline only. For ongoing weekly updates, see apps-script/AggregatePenalties.gs

// build-data.mjs
// Downloads StatsBomb open data, extracts all penalties, computes scoreline
// context + pressure index, writes a single flat data/penalties.json.
//
// Run locally:  node scripts/build-data.mjs
// Requires Node 18+ (global fetch). Downloads the repo zip once, reads locally.
//
// Laget av Mohibb Malik, 2025

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { pressureIndex } from '../src/js/pressureIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORK = join(ROOT, '.statsbomb-cache');
const OUT = join(ROOT, 'data', 'penalties.json');

// -- CONFIG --
// Competitions to include on first build. Identified by competition_id.
// Leave empty to process ALL available competitions (slow, large output).
// These are men's competitions in the open data with good penalty coverage.
const COMPETITION_ALLOWLIST = [
  43,  // FIFA World Cup
  55,  // UEFA Euro
  11,  // La Liga
  2,   // Premier League
  9,   // Bundesliga (1. Bundesliga)
  12,  // Serie A
  7,   // Ligue 1
  16,  // Champions League
];

const REPO_ZIP = 'https://github.com/statsbomb/open-data/archive/refs/heads/master.zip';

// -- MAIN --
async function main() {
  await ensureData();
  const dataRoot = join(WORK, 'open-data-master', 'data');

  const competitions = JSON.parse(
    await readFile(join(dataRoot, 'competitions.json'), 'utf8')
  );

  // Map: matchId -> { competitionName, seasonName, stage, leagueContext }
  const matchIndex = await buildMatchIndex(dataRoot, competitions);

  const penalties = [];
  const eventsDir = join(dataRoot, 'events');
  const eventFiles = await readdir(eventsDir);

  let processed = 0;
  for (const file of eventFiles) {
    const matchId = Number(file.replace('.json', ''));
    const meta = matchIndex.get(matchId);
    if (!meta) continue; // not in allowlist

    const events = JSON.parse(await readFile(join(eventsDir, file), 'utf8'));
    extractPenalties(events, matchId, meta, penalties);
    processed++;
    if (processed % 50 === 0) console.log(`  ...processed ${processed} matches`);
  }

  penalties.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(penalties, null, 0));

  console.log(`\nDone. ${penalties.length} penalties from ${processed} matches.`);
  console.log(`Written to ${OUT}`);
  summarise(penalties);
}

// -- DOWNLOAD + UNZIP --
async function ensureData() {
  const extracted = join(WORK, 'open-data-master', 'data', 'competitions.json');
  if (existsSync(extracted)) {
    console.log('Using cached StatsBomb data.');
    return;
  }
  await mkdir(WORK, { recursive: true });
  const zipPath = join(WORK, 'open-data.zip');

  console.log('Downloading StatsBomb open data (~1GB, one time)...');
  const res = await fetch(REPO_ZIP);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(res.body, createWriteStream(zipPath));

  console.log('Extracting...');
  // unzip relies on system unzip; fallback message if missing.
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${WORK}"`, { stdio: 'inherit' });
  } catch {
    throw new Error('unzip not found. Install unzip, or extract the zip manually into .statsbomb-cache/');
  }
  await rm(zipPath, { force: true });
}

// -- MATCH INDEX --
async function buildMatchIndex(dataRoot, competitions) {
  const index = new Map();
  const matchesRoot = join(dataRoot, 'matches');

  for (const comp of competitions) {
    if (COMPETITION_ALLOWLIST.length && !COMPETITION_ALLOWLIST.includes(comp.competition_id)) {
      continue;
    }
    const seasonFile = join(matchesRoot, String(comp.competition_id), `${comp.season_id}.json`);
    if (!existsSync(seasonFile)) continue;

    const matches = JSON.parse(await readFile(seasonFile, 'utf8'));
    for (const m of matches) {
      index.set(m.match_id, {
        competitionName: comp.competition_name,
        seasonName: comp.season_name,
        date: m.match_date,
        homeTeam: m.home_team?.home_team_name,
        awayTeam: m.away_team?.away_team_name,
        stage: mapStage(comp.competition_name, m),
        leagueContext: mapLeagueContext(comp.competition_name, m),
      });
    }
  }
  return index;
}

// Map StatsBomb competition_stage to our pressure-index stage key.
function mapStage(compName, match) {
  const stage = (match.competition_stage?.name || '').toLowerCase();
  const isLeague = /liga|premier|bundesliga|serie|ligue/i.test(compName);

  if (stage.includes('final') && !stage.includes('semi') && !stage.includes('quarter')) {
    return /world cup|euro|champions/i.test(compName) ? 'major_final' : 'cup_final';
  }
  if (stage.includes('semi')) return 'semi_final';
  if (stage.includes('quarter')) return 'quarter_final';
  if (stage.includes('16') || stage.includes('last 16')) return 'round_of_16';
  if (stage.includes('group')) return 'group';
  if (isLeague) return 'group'; // regular league match, refined by leagueContext
  return 'group';
}

// League context requires standings data we don't have from StatsBomb alone.
// Default 'na' for cups, 'early' for league until standings source is wired in.
function mapLeagueContext(compName, match) {
  const isLeague = /liga|premier|bundesliga|serie|ligue/i.test(compName);
  if (!isLeague) return 'na';
  // TODO: join external standings (football-data.org) to set
  // title/relegation/promotion/finalday based on week + table position.
  return 'early';
}

// -- PENALTY EXTRACTION --
function extractPenalties(events, matchId, meta, out) {
  // Track running score to derive scoreline context at each penalty.
  let homeGoals = 0, awayGoals = 0;

  // Detect shootout: events in period 5.
  const shootoutKicks = new Map(); // team -> count

  for (const e of events) {
    const isShot = e.type?.name === 'Shot';
    const isPenaltyShot = isShot && e.shot?.type?.name === 'Penalty';
    const isPeriod5 = e.period === 5;
    const isPenaltyMethod = isPenaltyShot || (isPeriod5 && isShot);

    if (isShot && e.shot?.outcome?.name === 'Goal' && !isPeriod5) {
      // count in-play/regular goals for scoreline tracking
      if (e.team?.name === meta.homeTeam) homeGoals++;
      else awayGoals++;
    }

    if (!isPenaltyMethod) continue;

    const takerTeam = e.team?.name;
    const isHome = takerTeam === meta.homeTeam;
    const outcome = mapOutcome(e.shot?.outcome?.name);
    const minute = (e.minute || 0) + (e.second ? 0 : 0); // minute is enough granularity
    const isShootout = isPeriod5;

    // shootout kick numbering per team
    let shootoutKick = 0, shootoutDelta = 0;
    if (isShootout) {
      const n = (shootoutKicks.get(takerTeam) || 0) + 1;
      shootoutKicks.set(takerTeam, n);
      shootoutKick = n;
      // delta from taker perspective requires shootout score; approximate with kick balance
      const otherTeam = isHome ? meta.awayTeam : meta.homeTeam;
      shootoutDelta = (shootoutKicks.get(takerTeam) || 0) - (shootoutKicks.get(otherTeam) || 0);
    }

    const scoreSituation = mapScoreSituation(isHome, homeGoals, awayGoals);

    const pi = pressureIndex({
      minute: isShootout ? 120 : minute,
      scoreSituation,
      stage: meta.stage,
      isShootout,
      shootoutKick,
      shootoutDelta,
      leagueContext: meta.leagueContext,
    });

    out.push({
      matchId,
      date: meta.date,
      competition: meta.competitionName,
      season: meta.seasonName,
      taker: e.player?.name || 'Unknown',
      takerId: e.player?.id || null,
      keeper: findKeeper(e),
      team: takerTeam,
      opponent: isHome ? meta.awayTeam : meta.homeTeam,
      minute,
      placement: mapPlacement(e),
      outcome,
      isShootout,
      pressureIndex: pi,
    });
  }
}

function mapOutcome(name) {
  if (!name) return 'missed';
  if (name === 'Goal') return 'goal';
  if (name === 'Saved' || name === 'Saved To Post') return 'saved';
  return 'missed'; // Off T, Wayward, Post, Blocked
}

function mapScoreSituation(isHome, homeGoals, awayGoals) {
  const diff = isHome ? homeGoals - awayGoals : awayGoals - homeGoals;
  if (diff >= 2) return 'winning2+';
  if (diff === 1) return 'winning1';
  if (diff === 0) return 'level';
  if (diff === -1) return 'losing1';
  return 'losing2+';
}

// Map shot end_location to a 9-zone label. StatsBomb goal: y 36-44, z 0-2.67.
function mapPlacement(e) {
  const loc = e.shot?.end_location;
  if (!loc || loc.length < 2) return 'MC';
  const y = loc[1];
  const z = loc.length >= 3 ? loc[2] : 0;
  // horizontal thirds (keeper perspective: low y = keeper's right)
  let col;
  if (y < 37.5) col = 'R';
  else if (y > 42.5) col = 'L';
  else col = 'C';
  // vertical thirds
  let row;
  if (z > 1.8) row = 'T';
  else if (z > 0.7) row = 'M';
  else row = 'B';
  // combine into TL/TC/TR/ML/MC/MR/BL/BC/BR
  if (row === 'M' && col === 'C') return 'MC';
  return row + (col === 'C' ? 'C' : col);
}

function findKeeper(e) {
  // Goalkeeper appears in the shot freeze_frame as the opposition keeper.
  const ff = e.shot?.freeze_frame;
  if (!ff) return 'Unknown';
  const gk = ff.find(p => p.position?.name === 'Goalkeeper' && !p.teammate);
  return gk?.player?.name || 'Unknown';
}

// -- SUMMARY --
function summarise(penalties) {
  const total = penalties.length;
  if (!total) return;
  const goals = penalties.filter(p => p.outcome === 'goal').length;
  const saved = penalties.filter(p => p.outcome === 'saved').length;
  const missed = penalties.filter(p => p.outcome === 'missed').length;
  const avgPI = (penalties.reduce((s, p) => s + p.pressureIndex, 0) / total).toFixed(1);
  console.log(`\nSummary:`);
  console.log(`  Conversion: ${((goals / total) * 100).toFixed(1)}%`);
  console.log(`  Saved: ${saved}  Missed: ${missed}`);
  console.log(`  Avg pressure index: ${avgPI}`);
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
