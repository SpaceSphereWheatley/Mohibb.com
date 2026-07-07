"use strict";
/* ============================================================
   OpenF1 fetch helpers + session resolution/validation for the
   Race Report API. Workers-runtime safe: no window/document/
   sessionStorage (unlike pitwall/script.js, which this ports the
   relevant fetch/validation logic from — see pitwall/script.js's
   getJSON/fetchLaps/etc. and loadSession's session-kind/finished
   guards).

   Successful OpenF1 responses are cached at Cloudflare's edge via
   the Cache API (caches.default). Every report request is a fresh,
   stateless Function invocation that fires ~6-8 concurrent OpenF1
   calls, unlike pitwall/script.js's browser-side sessionStorage
   caching (fetch once per session per browser) — without an
   equivalent here, rapid refreshes just repeat the same burst and
   are more likely to get rate-limited by OpenF1. Historical
   per-session data (laps/stints/pit/position/race_control/drivers/
   meetings) is immutable once a session has finished — the same
   "completed sessions never change" premise pitwall/script.js's own
   hard caching relies on — so it's cached for an hour; the
   session_key=latest lookup is the only endpoint whose answer
   changes over time, so it gets a much shorter TTL.
   ============================================================ */

export const OPENF1 = 'https://api.openf1.org/v1/';
const FETCH_TIMEOUT_MS = 15000;
const RETRIES = 2;

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

// best-effort edge cache — a lookup/write failure (e.g. Cache API unavailable
// in some local dev setups) should never break the actual request
async function cacheLookup(cacheKey) {
  try {
    const hit = await caches.default.match(cacheKey);
    return hit ? await hit.json() : undefined;
  } catch {
    return undefined;
  }
}
async function cacheStore(cacheKey, text, ttlS) {
  try {
    await caches.default.put(cacheKey, new Response(text, {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlS}` },
    }));
  } catch {
    // ignore — see comment above
  }
}

async function getJSON(url, { cacheTtlS = 3600, attempt = 0 } = {}) {
  const cacheKey = new Request(url, { method: 'GET' });
  const cached = await cacheLookup(cacheKey);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    if (cacheTtlS > 0) await cacheStore(cacheKey, text, cacheTtlS);
    return JSON.parse(text);
  } catch (e) {
    const transient = e.name === 'AbortError' || e.status === 429 || (e.status >= 500 && e.status < 600);
    if (attempt < RETRIES && transient) {
      // jittered exponential backoff — spreads retries out so a burst of
      // concurrent requests doesn't all retry in lockstep and re-trigger
      // the same rate limit
      const backoff = 1000 * 2 ** attempt + Math.random() * 400;
      await new Promise(r => setTimeout(r, backoff));
      return getJSON(url, { cacheTtlS, attempt: attempt + 1 });
    }
    throw new UpstreamError('Could not reach OpenF1 (' + url + '): ' + e.message);
  } finally {
    clearTimeout(timer);
  }
}

export const fetchSessions = (qs) => getJSON(`${OPENF1}sessions?${qs}`, { cacheTtlS: qs.includes('latest') ? 30 : 3600 });
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
