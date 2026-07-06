"use strict";
/* ============================================================
   OpenF1 fetch helpers + session resolution/validation for the
   Race Report API. Workers-runtime safe: no window/document/
   sessionStorage (unlike pitwall/script.js, which this ports the
   relevant fetch/validation logic from — see pitwall/script.js's
   getJSON/fetchLaps/etc. and loadSession's session-kind/finished
   guards).
   ============================================================ */

export const OPENF1 = 'https://api.openf1.org/v1/';
const FETCH_TIMEOUT_MS = 15000;

export class NotFoundError extends Error {
  constructor(message) { super(message); this.status = 404; }
}
export class NotRaceError extends Error {
  constructor(message) { super(message); this.status = 422; }
}
export class NotFinishedError extends Error {
  constructor(message) { super(message); this.status = 409; }
}
export class UpstreamError extends Error {
  constructor(message) { super(message); this.status = 502; }
}

async function getJSON(url, retries = 1, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    const transient = e.name === 'AbortError' || e.status === 429 || (e.status >= 500 && e.status < 600);
    if (retries > 0 && transient) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      return getJSON(url, retries - 1, attempt + 1);
    }
    throw new UpstreamError('Could not reach OpenF1 (' + url + '): ' + e.message);
  } finally {
    clearTimeout(timer);
  }
}

export const fetchSessions = (qs) => getJSON(`${OPENF1}sessions?${qs}`);
export const fetchMeetings = (meetingKey) => getJSON(`${OPENF1}meetings?meeting_key=${encodeURIComponent(meetingKey)}`);
export const fetchDrivers = (sk) => getJSON(`${OPENF1}drivers?session_key=${encodeURIComponent(sk)}`);
export const fetchLaps = (sk) => getJSON(`${OPENF1}laps?session_key=${encodeURIComponent(sk)}`);
export const fetchStints = (sk) => getJSON(`${OPENF1}stints?session_key=${encodeURIComponent(sk)}`);
export const fetchPit = (sk) => getJSON(`${OPENF1}pit?session_key=${encodeURIComponent(sk)}`);
export const fetchPosition = (sk) => getJSON(`${OPENF1}position?session_key=${encodeURIComponent(sk)}`);
export const fetchRaceControl = (sk) => getJSON(`${OPENF1}race_control?session_key=${encodeURIComponent(sk)}`);

// ported verbatim from pitwall/script.js's sessionKind()
export function sessionKind(s) {
  const t = (s?.session_type || '').toLowerCase();
  if (t === 'practice') return 'practice';
  if (t === 'qualifying') return 'qualifying';
  if (t === 'race') return 'race';
  const n = (s?.session_name || '').toLowerCase();
  if (n.includes('practice')) return 'practice';
  if (n.includes('qualifying') || n.includes('shootout')) return 'qualifying';
  return 'race';
}

/* Resolve a `session_key` query param (an explicit OpenF1 key, or the literal
   string 'latest') to a validated, finished Race session + its meeting.
   Throws NotFoundError / NotRaceError / NotFinishedError / UpstreamError. */
export async function resolveSession(sessionKeyParam) {
  let session;
  let usedLatest = false;

  if (sessionKeyParam === 'latest') {
    usedLatest = true;
    // session_key=latest returns every session of the latest meeting (FP1..Race),
    // same convention already used in pitwall/live/script.js's of1('sessions').
    const list = await fetchSessions('session_key=latest');
    const arr = Array.isArray(list) ? list : [];
    const races = arr.filter(s => sessionKind(s) === 'race');
    const now = Date.now();
    const finishedRaces = races
      .filter(s => new Date(s.date_end).getTime() < now)
      .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
    if (finishedRaces.length) {
      session = finishedRaces[0];
    } else if (races.length) {
      throw new NotFinishedError('This weekend’s Race hasn’t finished yet — check back once it has, or use the live dashboard at /pitwall/live/ for a session in progress.');
    } else {
      throw new NotFoundError('No Race session found in the latest meeting yet.');
    }
  } else {
    const list = await fetchSessions('session_key=' + encodeURIComponent(sessionKeyParam));
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) throw new NotFoundError(`No session found for session_key=${sessionKeyParam}.`);
    session = arr[0];
    const kind = sessionKind(session);
    if (kind !== 'race') {
      throw new NotRaceError(`"${session.session_name || sessionKeyParam}" is a ${kind} session, not a Race — this report only covers completed Race sessions.`);
    }
    if (new Date(session.date_end).getTime() >= Date.now()) {
      throw new NotFinishedError(`"${session.session_name}" hasn’t run yet. OpenF1’s historical data becomes available once it has finished; for a session in progress, use the live dashboard at /pitwall/live/.`);
    }
  }

  let meeting = null;
  try {
    const m = await fetchMeetings(session.meeting_key);
    meeting = Array.isArray(m) ? (m[0] || null) : null;
  } catch {
    // best-effort — the report falls back to session.location if this fails
  }

  return { session, meeting, usedLatest };
}
