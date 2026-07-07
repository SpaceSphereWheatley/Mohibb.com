"use strict";
/* ============================================================
   GET /api/race-report[?session_key=<key>|latest]
   Returns a standalone HTML race report for a completed F1 Race
   session (full analysis: classification with a race-pace column,
   fastest lap, a top-10 race-history chart, tyre strategy, and
   safety car/VSC periods). No session_key defaults to the latest
   completed Race. On-demand only — no scheduling, no email
   sending; see CLAUDE.md's "Race Report API" section.
   ============================================================ */

import {
  resolveSession, fetchDrivers, fetchLaps, fetchStints, fetchPit, fetchPosition, fetchRaceControl,
  NotFoundError, NotRaceError, NotFinishedError, UpstreamError,
} from '../_lib/openf1.js';
import {
  buildDriverMap, buildClassification, fastestLapOfRace, driverStrategies, racePaceSummary,
  buildHistoryTraces, parseSafety, mergeResultsWithPace,
} from '../_lib/analysis.js';
import { renderReport, renderErrorPage } from '../_lib/report.js';
import { parseSections } from '../_lib/sections.js';
import { buildJsonReport, buildJsonError } from '../_lib/json.js';

function htmlResponse(body, status, extraHeaders) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(extraHeaders || {}) },
  });
}

function jsonResponse(bodyObj, status, extraHeaders) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(extraHeaders || {}) },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  // no session_key at all defaults to the latest completed Race, so the
  // simplest possible URL (no query string) works for the common case
  const sessionKeyParam = url.searchParams.get('session_key') || 'latest';
  // anything other than exactly "json" (including omitted) falls back to html
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'html';
  const sections = parseSections(url.searchParams.get('sections'));

  let session, meeting, usedLatest;
  try {
    ({ session, meeting, usedLatest } = await resolveSession(sessionKeyParam));
  } catch (e) {
    const known = e instanceof NotFoundError || e instanceof NotRaceError || e instanceof NotFinishedError || e instanceof UpstreamError;
    const status = known ? e.status : 502;
    const title = known ? e.constructor.name.replace(/([A-Z])/g, ' $1').trim() : 'Unexpected error';
    const message = known ? e.message : 'Something went wrong resolving the session: ' + e.message;
    return format === 'json'
      ? jsonResponse(buildJsonError(status, title, message), status)
      : htmlResponse(renderErrorPage(status, title, message), status);
  }

  const sk = session.session_key;
  const [driversR, lapsR, stintsR, pitR, positionR, rcR] = await Promise.allSettled([
    fetchDrivers(sk), fetchLaps(sk), fetchStints(sk), fetchPit(sk), fetchPosition(sk), fetchRaceControl(sk),
  ]);

  const partialFailures = [];
  const dataOf = (result, name) => {
    if (result.status === 'fulfilled') return result.value;
    partialFailures.push(name);
    return [];
  };
  const drivers = dataOf(driversR, 'drivers');
  const laps = dataOf(lapsR, 'laps');
  const stints = dataOf(stintsR, 'stints');
  const pit = dataOf(pitR, 'pit');
  const position = dataOf(positionR, 'position');
  const raceControl = dataOf(rcR, 'race_control');

  const driverMap = buildDriverMap(drivers);
  const classification = buildClassification(position, laps, driverMap);
  const fastestLap = fastestLapOfRace(laps, driverMap);
  const safetyPeriods = parseSafety(raceControl);
  const strategy = driverStrategies(stints, laps, driverMap);
  const racePace = racePaceSummary(laps, pit, safetyPeriods, driverMap);
  const history = buildHistoryTraces(laps, pit, safetyPeriods, classification, driverMap);
  const classificationWithPace = mergeResultsWithPace(classification, racePace);

  const cacheControl = usedLatest ? 'public, max-age=300' : 'public, max-age=86400';

  if (format === 'json') {
    const payload = buildJsonReport({
      session, meeting, classification: classificationWithPace, fastestLap, history, strategy, safetyPeriods, partialFailures, sections,
    });
    return jsonResponse(payload, 200, { 'cache-control': cacheControl });
  }

  const html = renderReport({
    session, meeting, classification: classificationWithPace, fastestLap, history, strategy, safetyPeriods, partialFailures, sections,
  });
  return htmlResponse(html, 200, { 'cache-control': cacheControl });
}
