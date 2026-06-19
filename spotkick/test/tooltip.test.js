import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampTooltipPos } from '../src/js/tooltip.js';

const VIEW = { w: 320, h: 200 };
const TIP = { w: 140, h: 28 };

test('places tooltip above a point with room on all sides', () => {
  const { left, top } = clampTooltipPos(160, 100, 4, TIP.w, TIP.h, VIEW.w, VIEW.h);
  assert.equal(left, 160 - TIP.w / 2);
  assert.ok(top < 100); // above the point
});

test('flips below the point when there is no room above', () => {
  const { top } = clampTooltipPos(160, 5, 4, TIP.w, TIP.h, VIEW.w, VIEW.h);
  assert.ok(top > 5); // flipped to below the point instead of going negative
  assert.ok(top >= 0);
});

test('clamps left edge so the tooltip never goes off-screen left', () => {
  const { left } = clampTooltipPos(5, 100, 4, TIP.w, TIP.h, VIEW.w, VIEW.h);
  assert.equal(left, 0);
});

test('clamps right edge so the tooltip never goes off-screen right', () => {
  const { left } = clampTooltipPos(VIEW.w - 5, 100, 4, TIP.w, TIP.h, VIEW.w, VIEW.h);
  assert.equal(left, VIEW.w - TIP.w);
});

test('clamps bottom edge so the tooltip never goes off-screen bottom', () => {
  // Near the top edge, the tooltip flips below the point; in a viewport
  // too short for that flip to fully fit, it must clamp to the bottom.
  const shortView = { w: 320, h: 30 };
  const { top } = clampTooltipPos(160, 2, 4, TIP.w, TIP.h, shortView.w, shortView.h);
  assert.equal(top, shortView.h - TIP.h);
});

test('never returns negative coordinates for a tiny viewport', () => {
  const { left, top } = clampTooltipPos(2, 2, 4, TIP.w, TIP.h, 50, 30);
  assert.ok(left >= 0);
  assert.ok(top >= 0);
});
