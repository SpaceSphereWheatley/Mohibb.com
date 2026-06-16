/**
 * AggregatePenalties.gs
 *
 * Weekly Google Apps Script job that pulls penalty data from multiple free
 * sources, normalizes them to Spotkick's flat penalty schema, merges +
 * dedupes against the existing spotkick/data/penalties.json, and pushes the
 * result back to GitHub via the Contents API.
 *
 * Output schema (one object per penalty), matches spotkick/data/penalties.json:
 *   {
 *     matchId, date, competition, season, taker, takerId, keeper, team,
 *     opponent, minute, placement, outcome, isShootout, pressureIndex,
 *     confidence   -- "full" | "partial" | "minimal" (see deriveConfidence_)
 *   }
 *
 * ADDING A NEW SOURCE
 * --------------------
 * 1. Write a function `fetchFromYourSource_()` that returns an array of
 *    "raw" penalty records in whatever shape that source provides.
 * 2. Write a `normalizeYourSource_(raw)` function that maps one raw record
 *    to the schema above. Set fields you can't determine to null.
 *    Always set `confidence` using deriveConfidence_(p) at the end.
 * 3. Register both in the SOURCES array below.
 *
 * SETUP (Script Properties)
 * --------------------------
 *   GITHUB_TOKEN  - PAT with repo write access (contents: read/write)
 *   GITHUB_REPO   - e.g. "SpaceSphereWheatley/Mohibb.com"
 *   GITHUB_BRANCH - e.g. "main" (defaults to "main" if unset)
 *
 * Trigger: Triggers -> Add Trigger -> run() -> Time-driven -> Weekly.
 *
 * Laget av Mohibb Malik, 2025
 */

const DATA_PATH = 'spotkick/data/penalties.json';

// -- SOURCE REGISTRY --------------------------------------------------------
// Each source: { name, fetch, normalize }
// - fetch(): returns an array of raw records (any shape)
// - normalize(raw): maps one raw record -> the common penalty schema
const SOURCES = [
  {
    name: 'understat',
    fetch: fetchFromUnderstat_,
    normalize: normalizeUnderstat_,
  },
  // Add more sources here, e.g.:
  // {
  //   name: 'api-football',
  //   fetch: fetchFromApiFootball_,
  //   normalize: normalizeApiFootball_,
  // },
];

// -- ENTRY POINT --------------------------------------------------------------
function run() {
  const { penalties: existing, dirty } = fetchExistingPenalties_();
  Logger.log('Existing penalties: %s', existing.length);

  let incoming = [];
  for (const source of SOURCES) {
    try {
      const raw = source.fetch();
      const normalized = raw
        .map(source.normalize)
        .filter(Boolean)
        .map(p => withPressureIndex_(p));
      Logger.log('%s: fetched %s penalties', source.name, normalized.length);
      incoming = incoming.concat(normalized);
    } catch (err) {
      // One bad source shouldn't kill the whole run.
      Logger.log('Source "%s" failed: %s', source.name, err);
    }
  }

  const merged = mergePenalties_(existing, incoming);
  const hasNew = merged.length > existing.length;
  Logger.log('Merged total: %s (added %s)', merged.length, merged.length - existing.length);

  if (!hasNew && !dirty) {
    Logger.log('Nothing changed, skipping commit.');
    return;
  }

  merged.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  writePenaltiesToGithub_(merged);
}

// -- CONFIDENCE ---------------------------------------------------------------
// Derives a data-quality tier from whichever fields are populated.
//   "full"    – placement known (StatsBomb rows and any source with zone data)
//   "partial" – outcome known but no placement (Understat and similar)
//   "minimal" – everything fell back to defaults
function deriveConfidence_(p) {
  if (p.placement != null) return 'full';
  if (p.outcome != null) return 'partial';
  return 'minimal';
}

// -- MERGE / DEDUPE -----------------------------------------------------------

// Two penalties are the "same" if they share the same date + taker + minute.
// (Good enough across sources that don't share matchIds.)
function penaltyKey_(p) {
  return [p.date, normalizeName_(p.taker), p.minute].join('|');
}

function normalizeName_(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function mergePenalties_(existing, incoming) {
  const byKey = new Map();
  for (const p of existing) byKey.set(penaltyKey_(p), p);

  for (const p of incoming) {
    const key = penaltyKey_(p);
    if (!byKey.has(key)) {
      byKey.set(key, p);
    }
    // Already present (e.g. from StatsBomb's richer dataset) -> keep existing.
  }
  return Array.from(byKey.values());
}

// -- PRESSURE INDEX -----------------------------------------------------------
// Ported from src/js/pressureIndex.js. Keep in sync if that file changes.
const PI_WEIGHTS = {
  scoreline: 0.20,
  minute: 0.12,
  competition: 0.16,
  shootout: 0.18,
  interaction: 0.16,
  league: 0.18,
};

function withPressureIndex_(p) {
  if (p.pressureIndex != null) return p;
  return Object.assign({}, p, { pressureIndex: computePressureIndex_(p) });
}

function computePressureIndex_(p) {
  const S = piScoreline_(p.scoreSituation);
  const M = piMinute_(p.minute);
  const C = piCompetition_(p.stage);
  const P = piShootout_(p.isShootout, p.shootoutKick, p.shootoutDelta);
  const L = piLeague_(p.leagueContext);

  const isShootout = !!p.isShootout;
  const leagueApplies = p.leagueContext != null && p.leagueContext !== 'na';

  const terms = [
    { w: PI_WEIGHTS.scoreline, v: S },
    { w: PI_WEIGHTS.minute, v: M },
    { w: PI_WEIGHTS.competition, v: C },
    { w: PI_WEIGHTS.interaction, v: S * M },
  ];
  if (isShootout) terms.push({ w: PI_WEIGHTS.shootout, v: P });
  if (leagueApplies) terms.push({ w: PI_WEIGHTS.league, v: L });

  const activeWeight = terms.reduce((sum, t) => sum + t.w, 0);
  const raw = terms.reduce((sum, t) => sum + (t.w / activeWeight) * t.v, 0);

  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

function piScoreline_(situation) {
  const map = { 'winning2+': 0.10, winning1: 0.30, level: 0.70, losing1: 0.90, 'losing2+': 0.40 };
  return map[situation] != null ? map[situation] : 0.50;
}
function piMinute_(t) {
  return 1 / (1 + Math.exp(-0.08 * (t - 75)));
}
function piCompetition_(stage) {
  const map = {
    group: 0.30, cup_early: 0.35, league_run_in: 0.55, round_of_16: 0.55,
    quarter_final: 0.70, semi_final: 0.80, cup_final: 0.85, major_final: 1.00,
  };
  return map[stage] != null ? map[stage] : 0.30;
}
function piShootout_(isShootout, kickNumber, delta) {
  if (!isShootout) return 0;
  if (kickNumber > 5) return 0.90;
  const base = kickNumber / 5;
  const pressure = Math.max(0, 1 - Math.abs(delta) * 0.2);
  return Math.min(1, base * pressure);
}
function piLeague_(context) {
  const map = { early: 0.20, title: 0.75, promotion: 0.75, relegation: 0.80, finalday: 1.00, na: 0.00 };
  return map[context] != null ? map[context] : 0.20;
}

// -- SOURCE: UNDERSTAT --------------------------------------------------------
// Understat embeds a JSON blob of shot data per match in a <script> tag.
// We pull recent fixtures for the "big 5" leagues from the league pages,
// then fetch each match's shot data and filter to situation === "Penalty".
const UNDERSTAT_LEAGUES = ['EPL', 'La_Liga', 'Bundesliga', 'Serie_A', 'Ligue_1'];

function fetchFromUnderstat_() {
  const season = currentUnderstatSeason_();
  const penalties = [];

  for (const league of UNDERSTAT_LEAGUES) {
    const url = 'https://understat.com/league/' + league + '/' + season;
    const html = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
    const datesJson = extractJsonVar_(html, 'datesData');
    if (!datesJson) continue;

    const matches = JSON.parse(datesJson);
    // Only matches in the last 9 days (weekly run with a couple days' overlap).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 9);

    for (const match of matches) {
      if (match.isResult !== true) continue;
      const matchDate = new Date(match.datetime);
      if (matchDate < cutoff) continue;

      penalties.push.apply(penalties, fetchUnderstatMatchPenalties_(match, league, season));
    }
  }
  return penalties;
}

function fetchUnderstatMatchPenalties_(match, league, season) {
  const url = 'https://understat.com/match/' + match.id;
  const html = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
  const shotsJson = extractJsonVar_(html, 'shotsData');
  if (!shotsJson) return [];

  const shots = JSON.parse(shotsJson); // { h: [...], a: [...] }
  const allShots = (shots.h || []).concat(shots.a || []);

  return allShots
    .filter(s => s.situation === 'Penalty')
    .map(s => ({ shot: s, match, league, season }));
}

// Understat's "season" param is the start year, e.g. 2025 for 2025/2026.
function currentUnderstatSeason_() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return month >= 7 ? year : year - 1;
}

const UNDERSTAT_LEAGUE_NAMES = {
  EPL: 'Premier League',
  La_Liga: 'La Liga',
  Bundesliga: '1. Bundesliga',
  Serie_A: 'Serie A',
  Ligue_1: 'Ligue 1',
};

function normalizeUnderstat_(raw) {
  const { shot, match, league, season } = raw;
  if (!shot) return null;

  const minute = Number(shot.minute);
  const isHome = shot.h_a === 'h';
  const team = isHome ? match.h.title : match.a.title;
  const opponent = isHome ? match.a.title : match.h.title;

  // Understat's match-page shot data doesn't expose per-minute scorelines,
  // so scoreSituation defaults to 'level'. This is a known limitation — the
  // pressureIndex for Understat rows is less precise than StatsBomb's.
  const scoreSituation = 'level';

  let outcome = 'missed';
  if (shot.result === 'Goal') outcome = 'goal';
  else if (shot.result === 'SavedShot') outcome = 'saved';

  const p = {
    matchId: 'understat-' + match.id,
    date: (match.datetime || '').slice(0, 10),
    competition: UNDERSTAT_LEAGUE_NAMES[league] || league,
    season: season + '/' + (Number(season) + 1),
    taker: shot.player,
    takerId: shot.player_id != null ? 'understat-' + shot.player_id : null,
    keeper: null,       // Understat shot data doesn't identify the keeper
    team,
    opponent,
    minute,
    placement: null,   // Understat doesn't give shot placement within the goal
    outcome,
    isShootout: false,
    scoreSituation,
    stage: 'league_run_in',
    leagueContext: 'na',
  };

  p.confidence = deriveConfidence_(p);
  return p;
}

// -- GITHUB I/O ----------------------------------------------------------------

function githubConfig_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const repo = props.getProperty('GITHUB_REPO');
  const branch = props.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) {
    throw new Error('Set GITHUB_TOKEN and GITHUB_REPO in Script Properties.');
  }
  return { token, repo, branch };
}

// Fetches existing penalties.json from GitHub and backfills any records
// missing a `confidence` field. Returns { penalties, dirty } where dirty
// is true if any records were patched (so the caller knows to write even
// if no new penalties arrived).
function fetchExistingPenalties_() {
  const { token, repo, branch } = githubConfig_();
  const url = 'https://api.github.com/repos/' + repo + '/contents/' + DATA_PATH + '?ref=' + branch;
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Failed to fetch ' + DATA_PATH + ': ' + res.getResponseCode() + ' ' + res.getContentText());
  }
  const body = JSON.parse(res.getContentText());
  const content = Utilities.newBlob(Utilities.base64Decode(body.content)).getDataAsString();
  const penalties = JSON.parse(content);

  let dirty = false;
  for (const p of penalties) {
    if (!p.confidence) {
      p.confidence = deriveConfidence_(p);
      dirty = true;
    }
  }
  if (dirty) Logger.log('Backfilled confidence on existing records.');

  return { penalties, dirty };
}

function writePenaltiesToGithub_(penalties) {
  const { token, repo, branch } = githubConfig_();
  const getUrl = 'https://api.github.com/repos/' + repo + '/contents/' + DATA_PATH + '?ref=' + branch;
  const getRes = UrlFetchApp.fetch(getUrl, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  if (getRes.getResponseCode() !== 200) {
    throw new Error('Failed to fetch sha for ' + DATA_PATH + ': ' + getRes.getResponseCode());
  }
  const sha = JSON.parse(getRes.getContentText()).sha;

  const content = Utilities.base64Encode(JSON.stringify(penalties, null, 0));
  const putUrl = 'https://api.github.com/repos/' + repo + '/contents/' + DATA_PATH;
  const payload = {
    message: 'Weekly penalty data update (' + new Date().toISOString().slice(0, 10) + ')',
    content,
    sha,
    branch,
  };
  const putRes = UrlFetchApp.fetch(putUrl, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (putRes.getResponseCode() >= 300) {
    throw new Error('Failed to write ' + DATA_PATH + ': ' + putRes.getResponseCode() + ' ' + putRes.getContentText());
  }
  Logger.log('Pushed updated %s (%s penalties).', DATA_PATH, penalties.length);
}

// Extracts `var <name> = JSON.parse('...')` payloads embedded in Understat pages.
function extractJsonVar_(html, varName) {
  const re = new RegExp(varName + "\\s*=\\s*JSON\\.parse\\('([^']*)'\\)");
  const match = html.match(re);
  if (!match) return null;
  // Understat escapes the JSON string for single-quoted JS.
  return match[1]
    .replace(/\\x([0-9A-Fa-f]{2})/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}
