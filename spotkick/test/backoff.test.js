import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelayMs, shouldRetry } from '../src/js/backoff.js';

test('backoffDelayMs doubles each attempt starting from baseMs', () => {
  assert.equal(backoffDelayMs(1, 500), 500);
  assert.equal(backoffDelayMs(2, 500), 1000);
  assert.equal(backoffDelayMs(3, 500), 2000);
});

test('backoffDelayMs caps at maxMs', () => {
  assert.equal(backoffDelayMs(10, 500, 8000), 8000);
});

test('shouldRetry is true for 429, 403, and any 5xx', () => {
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(403), true);
  assert.equal(shouldRetry(500), true);
  assert.equal(shouldRetry(503), true);
});

test('shouldRetry is false for 200, 404, and other 4xx', () => {
  assert.equal(shouldRetry(200), false);
  assert.equal(shouldRetry(404), false);
  assert.equal(shouldRetry(400), false);
});
