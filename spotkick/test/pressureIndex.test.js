import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressureIndex, pressureBreakdown } from '../src/js/pressureIndex.js';

test('pressureIndex stays within 0-100 for typical in-play inputs', () => {
  const idx = pressureIndex({
    minute: 88, scoreSituation: 'losing1', stage: 'semi_final',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok(idx >= 0 && idx <= 100);
});

test('losing by 1 in a major final at full time is high pressure', () => {
  const idx = pressureIndex({
    minute: 90, scoreSituation: 'losing1', stage: 'major_final',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok(idx > 70, `expected high pressure, got ${idx}`);
});

test('winning by 2+ early in a group game is low pressure', () => {
  const idx = pressureIndex({
    minute: 10, scoreSituation: 'winning2+', stage: 'group',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok(idx < 30, `expected low pressure, got ${idx}`);
});

test('shootout sudden death (kick 6+) is high pressure regardless of delta', () => {
  const idx = pressureIndex({
    minute: 120, scoreSituation: 'level', stage: 'major_final',
    isShootout: true, shootoutKick: 6, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok(idx > 80, `expected very high pressure, got ${idx}`);
});

test('shootout term is excluded from weighting for non-shootout penalties', () => {
  // isShootout=false should ignore shootoutKick/shootoutDelta entirely.
  const a = pressureIndex({
    minute: 50, scoreSituation: 'level', stage: 'group',
    isShootout: false, shootoutKick: 3, shootoutDelta: 2, leagueContext: 'na',
  });
  const b = pressureIndex({
    minute: 50, scoreSituation: 'level', stage: 'group',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.equal(a, b);
});

test('league term only applies when leagueContext is set and not "na"', () => {
  const withLeague = pressureIndex({
    minute: 80, scoreSituation: 'level', stage: 'league_run_in',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'finalday',
  });
  const withoutLeague = pressureIndex({
    minute: 80, scoreSituation: 'level', stage: 'league_run_in',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok(withLeague > withoutLeague, 'finalday context should raise pressure vs na');
});

test('pressureBreakdown exposes each component alongside the final index', () => {
  const b = pressureBreakdown({
    minute: 75, scoreSituation: 'level', stage: 'cup_final',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'na',
  });
  assert.ok('scoreline' in b && 'minute' in b && 'competition' in b && 'shootout' in b && 'league' in b);
  assert.equal(typeof b.index, 'number');
});

test('unknown scoreSituation/stage/leagueContext fall back to neutral defaults, not NaN', () => {
  const idx = pressureIndex({
    minute: 60, scoreSituation: 'bogus', stage: 'bogus',
    isShootout: false, shootoutKick: 0, shootoutDelta: 0, leagueContext: 'bogus',
  });
  assert.ok(Number.isFinite(idx));
});
