// gasContracts.test.js
// AggregatePenalties.gs and StatsBombRebuild.gs run inside Google Apps Script,
// not Node, so they can't be executed or imported here. These tests instead
// inspect the source text for structural contracts we rely on — the same
// approach used in encoding.test.js for the charset fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sbSrc = readFileSync(join(__dirname, '../scripts/apps-script/StatsBombRebuild.gs'), 'utf8');
const aggSrc = readFileSync(join(__dirname, '../scripts/apps-script/AggregatePenalties.gs'), 'utf8');

test('startStatsBombRebuild clears stale state before starting a fresh run', () => {
  const fnBody = sbSrc.match(/function startStatsBombRebuild\(\)\s*\{([\s\S]*?)\n\}/)[1];
  const runningCheckIdx = fnBody.indexOf("'running'");
  const cleanupIdx = fnBody.indexOf('sbClearRebuildState_()');
  const fetchCompetitionsIdx = fnBody.indexOf("sbFetch_('competitions.json')");
  assert.ok(runningCheckIdx !== -1, 'expected a running-status guard');
  assert.ok(cleanupIdx !== -1, 'expected a call to sbClearRebuildState_() to clear stale state');
  assert.ok(cleanupIdx > runningCheckIdx, 'cleanup must happen after the running-guard (so it never cancels an active run)');
  assert.ok(cleanupIdx < fetchCompetitionsIdx, 'cleanup must happen before fetching fresh data');
});

test('sbExtractPenalties_ persists the raw pressure-index inputs alongside the computed index', () => {
  const fnBody = sbSrc.match(/function sbExtractPenalties_\([\s\S]*?\n\}/)[0];
  for (const field of ['scoreSituation', 'stage:', 'leagueContext:', 'shootoutKick', 'shootoutDelta']) {
    assert.ok(fnBody.includes(field), `expected pushed penalty object to retain ${field}`);
  }
});

test('StatsBombRebuild fetches use the shared retry/backoff helper', () => {
  assert.ok(sbSrc.includes('function sbFetchWithRetry_'), 'expected a sbFetchWithRetry_ helper');
  assert.ok(sbSrc.includes('sbFetchWithRetry_('), 'expected sbFetchWithRetry_ to actually be called');
});

test('AggregatePenalties GitHub + Understat fetches use the shared retry/backoff helper', () => {
  assert.ok(aggSrc.includes('function fetchWithRetry_'), 'expected a fetchWithRetry_ helper');
  assert.ok(aggSrc.includes('fetchWithRetry_('), 'expected fetchWithRetry_ to actually be called');
});

test('mergePenalties_ in AggregatePenalties.gs mirrors the confidence-rank strategy ported from mergePenalties.js', () => {
  const fnBody = aggSrc.match(/function mergePenalties_\([\s\S]*?\n\}/)[0];
  assert.ok(fnBody.includes('confidenceRank_'), 'expected mergePenalties_ to rank by confidence, not just "first write wins"');
});
