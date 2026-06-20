import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, penaltyKey, mergePenalties } from '../src/js/mergePenalties.js';

test('normalizeName lowercases, strips accents, and trims', () => {
  assert.equal(normalizeName('  Mbappé '), 'mbappe');
  assert.equal(normalizeName(null), '');
});

test('penaltyKey combines matchId, normalized taker, and minute', () => {
  assert.equal(penaltyKey({ matchId: 1, taker: 'Bob', minute: 45 }), '1|bob|45');
});

test('mergePenalties keeps incoming when no existing record shares the key', () => {
  const existing = [{ matchId: 1, taker: 'Alice', minute: 10, confidence: 'full' }];
  const incoming = [{ matchId: 2, taker: 'Bob', minute: 20, confidence: 'partial' }];
  const merged = mergePenalties(existing, incoming);
  assert.equal(merged.length, 2);
});

test('mergePenalties prefers the higher-confidence record on key collision', () => {
  const existing = [{ matchId: 1, taker: 'Alice', minute: 10, confidence: 'partial', placement: null }];
  const incoming = [{ matchId: 1, taker: 'Alice', minute: 10, confidence: 'full', placement: 'TL' }];
  const merged = mergePenalties(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 'full');
  assert.equal(merged[0].placement, 'TL');
});

test('mergePenalties keeps existing when incoming has equal or lower confidence', () => {
  const existing = [{ matchId: 1, taker: 'Alice', minute: 10, confidence: 'full', placement: 'TL' }];
  const incoming = [{ matchId: 1, taker: 'Alice', minute: 10, confidence: 'partial', placement: null }];
  const merged = mergePenalties(existing, incoming);
  assert.equal(merged[0].confidence, 'full');
});

test('mergePenalties is insensitive to accent/case differences in taker name when matching keys', () => {
  const existing = [{ matchId: 1, taker: 'Mbappe', minute: 10, confidence: 'partial' }];
  const incoming = [{ matchId: 1, taker: 'Mbappé', minute: 10, confidence: 'full' }];
  const merged = mergePenalties(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 'full');
});
