/**
 * StatsBombRebuild.gs
 *
 * One-shot Google Apps Script for rebuilding the full StatsBomb historical
 * penalty baseline. Runs across multiple executions using a continuation
 * pattern (PropertiesService + time-driven trigger) to work around GAS's
 * 6-minute execution limit.
 *
 * USAGE
 * -----
 * 1. Run startStatsBombRebuild() once manually from the GAS editor.
 *    It fetches the competition/match index, saves state to PropertiesService,
 *    starts the first batch, and schedules itself to continue every minute.
 * 2. Check progress at any point with rebuildStatus().
 * 3. Wait ~20–60 minutes. The script processes matches in parallel batches of
 *    5 and reschedules automatically until all event files are processed.
 * 4. When complete, penalties.json is updated on GitHub and the trigger is
 *    removed automatically.
 * 5. Use cancelStatsBombRebuild() to stop early.
 *
 * Shares functions from AggregatePenalties.gs (same GAS project):
 *   computePressureIndex_, deriveConfidence_, mergePenalties_,
 *   writePenaltiesToGithub_, fetchExistingPenalties_, githubConfig_,
 *   penaltyKey_, normalizeName_, and all pi*_ pressure-index components.
 *
 * Laget av Mohibb Malik, 2025
 */

const SB_RAW_BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const SB_BATCH_SIZE = 5;              // event files fetched in parallel per iteration
const SB_TIME_BUDGET_MS = 5.5 * 60 * 1000; // leave 30 s for cleanup before GAS kills us
const SB_CHUNK_SIZE = 380 * 1024;    // bytes per Properties chunk (limit is 500 KB)

// StatsBomb competition_ids to include in the rebuild.
const STATSBOMB_COMPETITION_ALLOWLIST = [
  43,  // FIFA World Cup
  55,  // UEFA Euro
  11,  // La Liga
  2,   // Premier League
  9,   // 1. Bundesliga
  12,  // Serie A
  7,   // Ligue 1
  16,  // Champions League
];

// -- PUBLIC ENTRY POINTS -------------------------------------------------------

/**
 * Phase 1. Run once manually to start a rebuild.
 * Fetches competitions.json + all match index files, stores state, then
 * immediately starts Phase 2 for the first batch.
 */
function startStatsBombRebuild() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SB_STATUS') === 'running') {
    Logger.log('A rebuild is already running. Use cancelStatsBombRebuild() to stop it first.');
    return;
  }

  Logger.log('Phase 1: fetching competition list...');
  const competitions = sbFetch_('competitions.json');
  if (!competitions) throw new Error('Failed to fetch competitions.json from StatsBomb.');

  const inScope = competitions.filter(c => STATSBOMB_COMPETITION_ALLOWLIST.includes(c.competition_id));
  Logger.log('%s competitions in scope (out of %s total)', inScope.length, competitions.length);

  // Fetch all match index files and build matchId -> meta map.
  const matchIndex = {};
  for (const comp of inScope) {
    const path = 'matches/' + comp.competition_id + '/' + comp.season_id + '.json';
    const matches = sbFetch_(path);
    if (!matches) {
      Logger.log('  Warning: could not fetch %s — skipping', path);
      continue;
    }
    for (const m of matches) {
      matchIndex[m.match_id] = {
        competitionName: comp.competition_name,
        seasonName:      comp.season_name,
        date:            m.match_date,
        homeTeam:        (m.home_team || {}).home_team_name || '',
        awayTeam:        (m.away_team || {}).away_team_name || '',
        stage:           sbMapStage_(comp.competition_name, m),
        leagueContext:   sbMapLeagueContext_(comp.competition_name),
      };
    }
  }

  const matchIds = Object.keys(matchIndex).map(Number);
  Logger.log('%s matches in scope', matchIds.length);

  // Persist Phase 1 state.
  sbWriteChunked_('SB_MATCH_INDEX', matchIndex);
  sbWriteChunked_('SB_PENALTIES', []);
  props.setProperty('SB_PENDING_IDS', JSON.stringify(matchIds));
  props.setProperty('SB_STATUS', 'running');
  props.deleteProperty('SB_TRIGGER_ID');

  Logger.log('Phase 1 done. Starting first batch...');
  continueStatsBombRebuild();
}

/**
 * Phase 2. Processes the next batch of event files and either reschedules
 * itself via a 1-minute trigger or finalises once all matches are done.
 * Safe to call manually at any point to advance the rebuild.
 */
function continueStatsBombRebuild() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SB_STATUS') !== 'running') {
    Logger.log('Status is "%s" — nothing to do.', props.getProperty('SB_STATUS') || 'idle');
    return;
  }

  let pendingIds = JSON.parse(props.getProperty('SB_PENDING_IDS') || '[]');
  if (!pendingIds.length) { sbFinalize_(); return; }

  const matchIndex = sbReadChunked_('SB_MATCH_INDEX') || {};
  let penalties   = sbReadChunked_('SB_PENALTIES')   || [];

  Logger.log('%s matches remaining, %s penalties so far', pendingIds.length, penalties.length);

  const start = Date.now();
  let batchCount = 0;

  while (pendingIds.length && (Date.now() - start) < SB_TIME_BUDGET_MS) {
    const batch = pendingIds.splice(0, SB_BATCH_SIZE);

    const responses = UrlFetchApp.fetchAll(
      batch.map(id => ({ url: SB_RAW_BASE + '/events/' + id + '.json', muteHttpExceptions: true }))
    );

    for (let i = 0; i < batch.length; i++) {
      const res = responses[i];
      if (res.getResponseCode() !== 200) {
        Logger.log('  Skip event %s (HTTP %s)', batch[i], res.getResponseCode());
        continue;
      }
      let events;
      try { events = JSON.parse(res.getContentText()); }
      catch (_) { Logger.log('  Skip event %s (parse error)', batch[i]); continue; }

      const meta = matchIndex[batch[i]];
      if (!meta) continue;
      const extracted = sbExtractPenalties_(events, batch[i], meta);
      penalties = penalties.concat(extracted);
    }

    batchCount++;
    // Save after each parallel batch so a crash only loses one batch.
    props.setProperty('SB_PENDING_IDS', JSON.stringify(pendingIds));
    sbWriteChunked_('SB_PENALTIES', penalties);
  }

  Logger.log('Ran %s batches; %s remaining, %s penalties total', batchCount, pendingIds.length, penalties.length);

  if (!pendingIds.length) {
    sbFinalize_();
    return;
  }

  // Schedule the next continuation if not already scheduled.
  if (!props.getProperty('SB_TRIGGER_ID')) {
    const trigger = ScriptApp.newTrigger('continueStatsBombRebuild')
      .timeBased().everyMinutes(1).create();
    props.setProperty('SB_TRIGGER_ID', trigger.getUniqueId());
    Logger.log('Trigger set — will auto-continue every minute.');
  }
}

/** Stops an in-progress rebuild and clears all saved state. */
function cancelStatsBombRebuild() {
  const props = PropertiesService.getScriptProperties();
  sbDeleteTrigger_(props.getProperty('SB_TRIGGER_ID'));
  sbClearRebuildState_();
  Logger.log('Rebuild cancelled. All SB_ state cleared.');
}

/** Logs current rebuild progress to the execution log. */
function rebuildStatus() {
  const props = PropertiesService.getScriptProperties();
  const status   = props.getProperty('SB_STATUS') || 'idle';
  const pending  = JSON.parse(props.getProperty('SB_PENDING_IDS') || '[]');
  const penalties = sbReadChunked_('SB_PENALTIES') || [];
  Logger.log('Status: %s | Remaining matches: %s | Penalties accumulated: %s',
    status, pending.length, penalties.length);
}

// -- FINALIZE -----------------------------------------------------------------

function sbFinalize_() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('All matches processed. Finalizing...');

  let sbPenalties = sbReadChunked_('SB_PENALTIES') || [];
  sbPenalties.sort((a, b) => (a.date < b.date ? 1 : -1));

  // Merge with current GitHub file so Understat rows added since the last
  // rebuild are preserved. StatsBomb records win on conflict (richer data).
  const { penalties: existing } = fetchExistingPenalties_();
  // Pass sbPenalties as "existing" so they win; existing GitHub data fills gaps.
  const merged = mergePenalties_(sbPenalties, existing);

  Logger.log('StatsBomb: %s | GitHub existing: %s | Merged: %s',
    sbPenalties.length, existing.length, merged.length);

  merged.sort((a, b) => (a.date < b.date ? 1 : -1));
  writePenaltiesToGithub_(merged);

  props.setProperty('SB_STATUS', 'complete');
  sbDeleteTrigger_(props.getProperty('SB_TRIGGER_ID'));
  sbClearRebuildState_();
  Logger.log('Done. penalties.json updated on GitHub.');
}

// -- PENALTY EXTRACTION -------------------------------------------------------

function sbExtractPenalties_(events, matchId, meta) {
  const out = [];
  let homeGoals = 0, awayGoals = 0;
  const shootoutKicks = {}; // team name -> kick count

  for (const e of events) {
    const shot       = e.shot || {};
    const isShot     = (e.type || {}).name === 'Shot';
    const isPenShot  = isShot && (shot.type || {}).name === 'Penalty';
    const isPeriod5  = e.period === 5;
    const isPenalty  = isPenShot || (isPeriod5 && isShot);

    // Track in-play goals to compute scoreline context at penalty time.
    if (isShot && (shot.outcome || {}).name === 'Goal' && !isPeriod5) {
      if ((e.team || {}).name === meta.homeTeam) homeGoals++;
      else awayGoals++;
    }

    if (!isPenalty) continue;

    const takerTeam  = (e.team || {}).name;
    const isHome     = takerTeam === meta.homeTeam;
    const minute     = e.minute || 0;
    const isShootout = isPeriod5;

    let shootoutKick = 0, shootoutDelta = 0;
    if (isShootout) {
      shootoutKicks[takerTeam] = (shootoutKicks[takerTeam] || 0) + 1;
      shootoutKick = shootoutKicks[takerTeam];
      const otherTeam = isHome ? meta.awayTeam : meta.homeTeam;
      shootoutDelta   = (shootoutKicks[takerTeam] || 0) - (shootoutKicks[otherTeam] || 0);
    }

    const scoreSituation = sbScoreSituation_(isHome, homeGoals, awayGoals);
    const placement      = sbPlacement_(shot);
    const outcome        = sbOutcome_((shot.outcome || {}).name);

    const pressureIndex = computePressureIndex_({
      minute:        isShootout ? 120 : minute,
      scoreSituation,
      stage:         meta.stage,
      isShootout,
      shootoutKick,
      shootoutDelta,
      leagueContext: meta.leagueContext,
    });

    out.push({
      matchId,
      date:        meta.date,
      competition: meta.competitionName,
      season:      meta.seasonName,
      taker:       (e.player || {}).name || 'Unknown',
      takerId:     (e.player || {}).id   || null,
      keeper:      sbKeeper_(shot),
      team:        takerTeam,
      opponent:    isHome ? meta.awayTeam : meta.homeTeam,
      minute,
      placement,
      outcome,
      isShootout,
      pressureIndex,
      confidence:  placement != null ? 'full' : 'partial',
    });
  }
  return out;
}

function sbOutcome_(name) {
  if (name === 'Goal') return 'goal';
  if (name === 'Saved' || name === 'Saved To Post') return 'saved';
  return 'missed';
}

function sbScoreSituation_(isHome, homeGoals, awayGoals) {
  const diff = isHome ? homeGoals - awayGoals : awayGoals - homeGoals;
  if (diff >= 2)  return 'winning2+';
  if (diff === 1) return 'winning1';
  if (diff === 0) return 'level';
  if (diff === -1) return 'losing1';
  return 'losing2+';
}

function sbMapStage_(compName, match) {
  const stage   = ((match.competition_stage || {}).name || '').toLowerCase();
  const isMajor = /world cup|euro|champions/i.test(compName);

  if (stage.includes('final') && !stage.includes('semi') && !stage.includes('quarter')) {
    return isMajor ? 'major_final' : 'cup_final';
  }
  if (stage.includes('semi'))    return 'semi_final';
  if (stage.includes('quarter')) return 'quarter_final';
  if (stage.includes('16') || stage.includes('last 16')) return 'round_of_16';
  return 'group'; // regular group stage or league match
}

function sbMapLeagueContext_(compName) {
  return /liga|premier|bundesliga|serie|ligue/i.test(compName) ? 'early' : 'na';
}

// Maps StatsBomb shot.end_location [x, y, z] to a 9-zone code.
// Goal frame (keeper's perspective): y 36–44, z 0–2.67. Low y = keeper's right.
function sbPlacement_(shot) {
  const loc = shot.end_location;
  if (!loc || loc.length < 2) return null;
  const y = loc[1];
  const z = loc.length >= 3 ? loc[2] : 0;

  const col = y < 37.5 ? 'R' : y > 42.5 ? 'L' : 'C';
  const row = z > 1.8  ? 'T' : z > 0.7  ? 'M' : 'B';

  if (row === 'M' && col === 'C') return 'MC';
  return row + (col === 'C' ? 'C' : col);
}

// Extracts the opposing goalkeeper from the shot freeze frame.
function sbKeeper_(shot) {
  const ff = shot.freeze_frame;
  if (!ff) return 'Unknown';
  const gk = ff.find(p => (p.position || {}).name === 'Goalkeeper' && !p.teammate);
  return gk ? ((gk.player || {}).name || 'Unknown') : 'Unknown';
}

// -- PROPERTIES / CHUNK HELPERS -----------------------------------------------

// PropertiesService has a 500 KB per-property limit. These helpers transparently
// split large JSON values across numbered keys: {prefix}_0, {prefix}_1, …

function sbWriteChunked_(prefix, obj) {
  const props = PropertiesService.getScriptProperties();
  const str   = JSON.stringify(obj);

  // Delete existing chunks (array may have been smaller before).
  for (let i = 0; ; i++) {
    const key = prefix + '_' + i;
    if (props.getProperty(key) == null) break;
    props.deleteProperty(key);
  }

  // Write new chunks.
  const n = Math.max(1, Math.ceil(str.length / SB_CHUNK_SIZE));
  for (let i = 0; i < n; i++) {
    props.setProperty(prefix + '_' + i, str.slice(i * SB_CHUNK_SIZE, (i + 1) * SB_CHUNK_SIZE));
  }
}

function sbReadChunked_(prefix) {
  const props = PropertiesService.getScriptProperties();
  let str = '';
  for (let i = 0; ; i++) {
    const chunk = props.getProperty(prefix + '_' + i);
    if (chunk == null) break;
    str += chunk;
  }
  if (!str) return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function sbDeleteTrigger_(triggerId) {
  if (!triggerId) return;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getUniqueId() === triggerId) ScriptApp.deleteTrigger(t);
  });
}

function sbClearRebuildState_() {
  const props = PropertiesService.getScriptProperties();
  ['SB_STATUS', 'SB_PENDING_IDS', 'SB_TRIGGER_ID'].forEach(k => props.deleteProperty(k));
  for (const prefix of ['SB_MATCH_INDEX', 'SB_PENALTIES']) {
    for (let i = 0; ; i++) {
      const key = prefix + '_' + i;
      if (props.getProperty(key) == null) break;
      props.deleteProperty(key);
    }
  }
}

// -- FETCH HELPER -------------------------------------------------------------

function sbFetch_(path) {
  const url = SB_RAW_BASE + '/' + path;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (_) {
    return null;
  }
}
