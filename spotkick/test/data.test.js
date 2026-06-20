import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueValues, loadData, applyFilters, summary, zoneStats, bySeason,
  byPressureBucket, pressureByTaker, topTakers, takerProfile, dateBounds,
  isValidDateRange,
} from '../src/js/data.js';

const FIXTURE = [
  { matchId: 1, date: '2020-01-01', competition: 'A', season: '2019/2020', taker: 'Alice', keeper: 'Kara', team: 'X', outcome: 'goal', placement: 'TL', pressureIndex: 80, confidence: 'full' },
  { matchId: 1, date: '2020-01-01', competition: 'A', season: '2019/2020', taker: 'Alice', keeper: 'Kara', team: 'X', outcome: 'saved', placement: 'TC', pressureIndex: 40, confidence: 'full' },
  { matchId: 2, date: '2021-06-15', competition: 'B', season: '2020/2021', taker: 'Bob', keeper: 'Lina', team: 'Y', outcome: 'missed', placement: null, pressureIndex: 20, confidence: 'partial' },
];

// loadData() fetches relative paths; stub global.fetch so it resolves
// against our in-memory fixture instead of hitting the filesystem/network.
test.before(async () => {
  global.fetch = async () => ({ ok: true, json: async () => FIXTURE });
  await loadData();
});

test('uniqueValues returns sorted unique non-null values for a field', () => {
  assert.deepEqual(uniqueValues('taker'), ['Alice', 'Bob']);
});

test('applyFilters with no filters returns everything', () => {
  assert.equal(applyFilters({}).length, 3);
});

test('applyFilters filters by taker', () => {
  assert.equal(applyFilters({ taker: 'Alice' }).length, 2);
});

test('applyFilters filters by outcomes set', () => {
  const rows = applyFilters({ outcomes: new Set(['goal']) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'goal');
});

test('applyFilters ignores team/minPI/maxPI — no UI exposes them, so they are dead filter keys', () => {
  // team: 'X' would match nothing under matchId 2 if applied; minPI/maxPI would
  // exclude the pressureIndex:20 row. Confirms removing them from applyFilters
  // didn't change behavior for callers that still happen to pass these keys.
  const rows = applyFilters({ team: 'X', minPI: 50, maxPI: 60 });
  assert.equal(rows.length, 3);
});

test('applyFilters respects dateFrom/dateTo bounds', () => {
  assert.equal(applyFilters({ dateFrom: '2021-01-01' }).length, 1);
  assert.equal(applyFilters({ dateTo: '2020-12-31' }).length, 2);
});

test('dateBounds returns min/max date across the dataset', () => {
  assert.deepEqual(dateBounds(), { min: '2020-01-01', max: '2021-06-15' });
});

test('summary computes conversion/saved/missed rates', () => {
  const s = summary(FIXTURE);
  assert.equal(s.total, 3);
  assert.equal(s.goals, 1);
  assert.equal(s.saved, 1);
  assert.equal(s.missed, 1);
  assert.equal(Math.round(s.conversion), 33);
});

test('zoneStats counts only rows with a known placement zone', () => {
  const z = zoneStats(FIXTURE);
  assert.equal(z.TL.n, 1);
  assert.equal(z.TL.goals, 1);
  assert.equal(z.TC.n, 1);
});

test('bySeason groups conversion chronologically', () => {
  const seasons = bySeason(FIXTURE);
  assert.deepEqual(seasons.map(s => s.season), ['2019/2020', '2020/2021']);
});

test('byPressureBucket buckets by pressureIndex in steps of 10', () => {
  const buckets = byPressureBucket(FIXTURE, 10);
  assert.equal(buckets.length, 10);
  const bucket80 = buckets.find(b => b.lo === 80);
  assert.equal(bucket80.n, 1);
});

test('topTakers respects minSample and sorts by conversion', () => {
  assert.equal(topTakers(FIXTURE, 3).length, 0); // nobody has 3+ penalties
  const top = topTakers(FIXTURE, 1);
  assert.equal(top.length, 2);
});

test('pressureByTaker aggregates avg pressure index per taker', () => {
  const stats = pressureByTaker(FIXTURE, 1);
  const alice = stats.find(s => s.taker === 'Alice');
  assert.equal(alice.n, 2);
  assert.equal(alice.avgPI, 60);
});

test('takerProfile returns null for an unknown taker', () => {
  assert.equal(takerProfile('Nobody'), null);
});

test('takerProfile aggregates h2h per keeper, sorted by volume', () => {
  const prof = takerProfile('Alice');
  assert.equal(prof.taken, 2);
  assert.equal(prof.goals, 1);
  assert.equal(prof.h2h.length, 1);
  assert.equal(prof.h2h[0].keeper, 'Kara');
  assert.equal(prof.h2h[0].n, 2);
});

test('takerProfile picks the most frequent known placement as favoured zone', () => {
  const prof = takerProfile('Bob');
  assert.equal(prof.favoured, '–'); // Bob's only penalty has no placement
});

test('isValidDateRange allows an unset bound on either side', () => {
  assert.equal(isValidDateRange(null, '2021-01-01'), true);
  assert.equal(isValidDateRange('2021-01-01', null), true);
  assert.equal(isValidDateRange(null, null), true);
});

test('isValidDateRange allows from === to and from < to', () => {
  assert.equal(isValidDateRange('2021-01-01', '2021-01-01'), true);
  assert.equal(isValidDateRange('2021-01-01', '2021-06-01'), true);
});

test('isValidDateRange rejects a reversed range', () => {
  assert.equal(isValidDateRange('2021-06-01', '2021-01-01'), false);
});
