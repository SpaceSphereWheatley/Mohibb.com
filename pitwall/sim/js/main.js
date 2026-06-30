// main.js — entry point. Loads the grid, builds a race, wires the renderer,
// leaderboard, controls and (under ?debug) the tuning panel, then runs the
// fixed-step loop decoupled from rAF via a speed multiplier.

import { config } from './config.js';
import { Race } from './race.js';
import { Renderer } from './render.js';
import { Leaderboard } from './leaderboard.js';
import { Analysis } from './analysis.js';
import { Controls } from './ui.js';
import { hashSeed } from './rng.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_STEPS = 240;            // cap sim-steps per frame so high speeds stay safe

const state = {
  race: null,
  grid: null,
  playing: false,
  speed: 1,
  acc: 0,
  lastT: 0,
  lbAcc: 0,
  raf: 0,
};

let renderer, leaderboard, analysis, controls;
const stage = document.getElementById('stage');
const lbMount = document.getElementById('leaderboard');
const analysisMount = document.getElementById('analysis');
const analysisSection = document.getElementById('sec-analysis');

async function loadDefaultGrid() {
  const res = await fetch('./data.json');
  if (!res.ok) throw new Error('Could not load data.json');
  return res.json();
}

// minimal validation + colour fallback so user-supplied grids still render
function prepareGrid(grid) {
  if (!grid || !Array.isArray(grid.teams) || !Array.isArray(grid.drivers)) {
    throw new Error('Grid needs "teams" and "drivers" arrays.');
  }
  const palette = ['#E10600', '#27F4D2', '#3671C6', '#FF8000', '#229971',
    '#64C4FF', '#B6BABD', '#6692FF', '#52E252', '#900000', '#005AFF'];
  const byName = new Map(grid.teams.map((t) => [t.name, t]));
  grid.teams.forEach((t, i) => { if (!t.colour && !t.color) t.colour = palette[i % palette.length]; });
  grid.drivers.forEach((d) => {
    if (!byName.has(d.team)) throw new Error(`Driver "${d.name}" references unknown team "${d.team}".`);
    d.stats = d.stats || {};
  });
  return grid;
}

function newRace(seed) {
  stopLoop();
  state.race = new Race(state.grid, seed);
  renderer.loadTrack(state.race.track);
  renderer.buildCars(state.race.cars);
  renderer.frame(state.race);              // draw the grid on the line, once
  leaderboard.update(state.race);
  analysisSection.hidden = true;
  analysis.destroy();
  state.acc = 0;
  state.lbAcc = 0;
  controls.setSeed(state.race.seed);
  controls.setLap(0, state.race.raceLaps);
  controls.setState('Ready — press play', 'ready');
  // Start paused: this keeps the page (and the render loop) quiet on load so
  // it settles for crawlers/headless checks; the user presses Play to run.
  setPlaying(false);
}

function setPlaying(p) {
  state.playing = p && state.race && !state.race.over;
  controls.setPlaying(state.playing);
  if (state.playing) { startLoop(); }
  else { stopLoop(); renderer.frame(state.race); }
}

// the rAF loop runs ONLY while playing — no perpetual spinning when idle
function startLoop() {
  if (state.raf) return;
  state.lastT = performance.now();
  state.raf = requestAnimationFrame(frame);
}

function stopLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function setSpeed(mult) {
  state.speed = mult;
  controls.setSpeed(mult);
}

function frame(now) {
  const race = state.race;
  if (state.playing && !race.over) {
    const elapsed = Math.min(0.25, (now - state.lastT) / 1000);
    state.lastT = now;
    state.acc += elapsed * state.speed;
    let steps = 0;
    while (state.acc >= config.dt && steps < MAX_STEPS) {
      race.step();
      state.acc -= config.dt;
      steps++;
      if (race.over) break;
    }
    controls.setLap(race.order()[0].lap, race.raceLaps);
    state.lbAcc += elapsed;
    if (state.lbAcc >= 1 / config.view.leaderboardHz) {
      leaderboard.update(race);
      state.lbAcc = 0;
    }
  }

  renderer.frame(race);

  if (race.over) { onFinish(); return; }
  if (state.playing) state.raf = requestAnimationFrame(frame);
  else state.raf = 0;
}

function onFinish() {
  setPlaying(false);
  leaderboard.update(state.race);
  controls.setState('Chequered flag', 'done');
  analysisSection.hidden = false;
  analysis.render(state.race);
}

async function loadGridFile(file) {
  try {
    const text = await file.text();
    const grid = prepareGrid(JSON.parse(text));
    state.grid = grid;
    newRace(state.race ? state.race.seed : (Math.random() * 1e9) >>> 0);
    controls.setState('Loaded custom grid', 'ready');
  } catch (e) {
    controls.setState('Grid error: ' + e.message, 'error');
  }
}

function resolveSeed(input) {
  if (!input) return (Math.random() * 1e9) >>> 0;
  const n = Number(input);
  return Number.isFinite(n) && input !== '' ? (n >>> 0) : hashSeed(input);
}

async function boot() {
  try {
    state.grid = prepareGrid(await loadDefaultGrid());
  } catch (e) {
    document.getElementById('stage').innerHTML =
      `<p class="sim-note">Failed to start: ${e.message}</p>`;
    return;
  }

  // optional race length override (?laps=N), handy for quick runs
  const params = new URLSearchParams(location.search);
  const lapsParam = Number(params.get('laps'));
  if (Number.isFinite(lapsParam) && lapsParam >= 1) {
    config.raceLaps = Math.min(99, Math.round(lapsParam));
  }

  renderer = await new Renderer().init(stage);
  leaderboard = new Leaderboard(lbMount);
  analysis = new Analysis(analysisMount);

  controls = new Controls({
    onToggle: () => setPlaying(!state.playing),
    onSpeed: setSpeed,
    onRestart: () => newRace(state.race.seed),
    onRandomTrack: () => newRace((Math.random() * 1e9) >>> 0),
    onNewTrack: (seedStr) => newRace(resolveSeed(seedStr)),
    onLoadGrid: loadGridFile,
    onResetView: () => renderer.resetView(),
  });
  setSpeed(1);

  if (new URLSearchParams(location.search).has('debug')) {
    import('./tuning.js').then((m) => m.initTuning(config)).catch(() => {});
  }

  newRace((Math.random() * 1e9) >>> 0);
}

boot();
