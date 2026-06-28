// ui.js — wires the control bar to the simulation controller (in main.js). No
// inline handlers (keeps the HTML CI-clean); everything is bound here.

const $ = (id) => document.getElementById(id);

export class Controls {
  constructor(handlers) {
    this.h = handlers;
    this.playBtn = $('playBtn');
    this.speedBtns = [...document.querySelectorAll('[data-speed]')];
    this.seedInput = $('seedInput');
    this.lapNow = $('lapNow');
    this.lapTotal = $('lapTotal');
    this.stateEl = $('raceState');

    this.playBtn.addEventListener('click', () => this.h.onToggle());
    $('restartBtn').addEventListener('click', () => this.h.onRestart());
    $('newTrackBtn').addEventListener('click', () => this.h.onNewTrack(this.seedInput.value.trim()));
    $('resetViewBtn').addEventListener('click', () => this.h.onResetView());

    this.speedBtns.forEach((b) =>
      b.addEventListener('click', () => this.h.onSpeed(Number(b.dataset.speed))));

    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.h.onNewTrack(this.seedInput.value.trim());
    });

    const file = $('loadInput');
    $('loadBtn').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files && file.files[0]) this.h.onLoadGrid(file.files[0]);
      file.value = '';
    });
  }

  setPlaying(p) {
    this.playBtn.textContent = p ? '❚❚ Pause' : '▶ Play';
    this.playBtn.setAttribute('aria-pressed', String(p));
  }

  setSpeed(mult) {
    this.speedBtns.forEach((b) =>
      b.classList.toggle('is-active', Number(b.dataset.speed) === mult));
  }

  setSeed(seed) { this.seedInput.value = String(seed); }

  setLap(now, total) {
    this.lapNow.textContent = Math.min(now, total);
    this.lapTotal.textContent = total;
  }

  setState(text, kind = '') {
    this.stateEl.textContent = text;
    this.stateEl.className = 'sim-state' + (kind ? ' sim-state--' + kind : '');
  }
}
