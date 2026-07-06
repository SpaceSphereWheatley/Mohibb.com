"use strict";
/* ============================================================
   GET /api/race-report?session_key=<key>|latest
   Returns a standalone HTML race report for a completed F1 Race
   session (full analysis: classification, fastest lap, race
   history, tyre strategy + pit stops, safety car/VSC periods,
   race pace). On-demand only — no scheduling, no email sending;
   see CLAUDE.md's "Race Report API" section.
   ============================================================ */

import {
  resolveSession, fetchDrivers, fetchLaps, fetchStints, fetchPit, fetchPosition, fetchRaceControl,
  NotFoundError, NotRaceError, NotFinishedError, UpstreamError,
} from '../_lib/openf1.js';
import {
  buildDriverMap, buildClassification, fastestLapOfRace, driverStrategies, racePaceSummary,
  buildHistoryTraces, parseSafety,
} from '../_lib/analysis.js';
import { renderReport, renderErrorPage } from '../_lib/report.js';

function htmlResponse(body, status, extraHeaders) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(extraHeaders || {}) },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sessionKeyParam = url.searchParams.get('session_key');

  if (!sessionKeyParam) {
    return htmlResponse(renderErrorPage(400, 'Missing session_key', 'Add ?session_key=latest or a specific OpenF1 session key, e.g. /api/race-report?session_key=9158.'), 400);
  }

  let session, meeting, usedLatest;
  try {
    ({ session, meeting, usedLatest } = await resolveSession(sessionKeyParam));
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof NotRaceError || e instanceof NotFinishedError || e instanceof UpstreamError) {
      return htmlResponse(renderErrorPage(e.status, e.constructor.name.replace(/([A-Z])/g, ' $1').trim(), e.message), e.status);
    }
    return htmlResponse(renderErrorPage(502, 'Unexpected error', 'Something went wrong resolving the session: ' + e.message), 502);
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
  const strategy = driverStrategies(stints, pit, laps, driverMap);
  const racePace = racePaceSummary(laps, pit, safetyPeriods, driverMap);
  const history = buildHistoryTraces(laps, pit, safetyPeriods, classification, driverMap);

  const html = renderReport({
    session, meeting, classification, fastestLap, history, strategy, safetyPeriods, racePace, partialFailures,
  });

  const cacheControl = usedLatest ? 'public, max-age=300' : 'public, max-age=86400';
  return htmlResponse(html, 200, { 'cache-control': cacheControl });
}
