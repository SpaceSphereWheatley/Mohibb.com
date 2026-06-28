// render.js — the ONLY renderer-aware module. Builds a PixiJS scene graph once
// (static track + pit lane drawn to a container, one persistent sprite per car)
// and, each frame, mutates only car sprite x/y/tint from race state. Swapping
// to a three.js view later means replacing just this file.

import { Application, Container, Graphics, Text } from 'pixi.js';
import { config } from './config.js';
import { SEG } from './track.js';

const COL = {
  asphalt: 0x35312b,
  edge: 0x211d17,
  pit: 0x4f4a43,
  curbA: 0xc0392b,
  curbB: 0xf2ead9,
  sf: 0x211d17,
  carEdge: 0x14110d,
};

function hexToInt(hex) {
  if (typeof hex === 'number') return hex;
  return parseInt(String(hex).replace('#', ''), 16) || 0x888888;
}

export class Renderer {
  constructor() {
    this.app = null;
    this.world = new Container();
    this.carLayer = new Container();
    this.sprites = new Map();
    this._drag = null;
  }

  async init(parent) {
    this.parent = parent;
    this.app = new Application();
    await this.app.init({
      background: 0xede8dd,
      antialias: true,
      resizeTo: parent,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.app.canvas.setAttribute('role', 'img');
    this.app.canvas.setAttribute('aria-label',
      'Top-down view of the race: each coloured dot is a car running on the procedurally generated circuit.');
    parent.appendChild(this.app.canvas);

    this.app.stage.addChild(this.world);
    this.trackGfx = new Container();
    this.world.addChild(this.trackGfx, this.carLayer);
    this._wireControls(parent);
    this.app.renderer.on('resize', () => this._fit());
    return this;
  }

  // (re)build the static track layer for a (new) track, then frame it
  loadTrack(track) {
    this.track = track;
    this.trackGfx.removeChildren();
    this._drawTrack(track);
    this._fit();
  }

  buildCars(cars) {
    this.carLayer.removeChildren();
    this.sprites.clear();
    for (const car of cars) {
      const g = new Graphics();
      g.circle(0, 0, config.view.carRadius)
        .fill(hexToInt(car.color))
        .stroke({ width: 1.4, color: COL.carEdge });
      this.carLayer.addChild(g);
      this.sprites.set(car, g);
    }
  }

  frame(race) {
    for (const car of race.cars) {
      const g = this.sprites.get(car);
      if (!g) continue;
      let p;
      if (car.pit) p = this.track.pitAt(car.pit.u);
      else p = this.track.line.offsetAt(car.dist, car.lateral);
      g.x = p.x;
      g.y = p.y;
      g.alpha = car.finished ? 0.55 : car.dirtyAir ? 0.85 : 1;
    }
  }

  _drawTrack(track) {
    const line = track.line;
    const W = config.track.width;

    // asphalt ribbon: a fat stroke of the closed racing line, edged in ink
    const ribbon = new Graphics();
    this._path(ribbon, line.pts);
    ribbon.stroke({ width: W + 4, color: COL.edge, cap: 'round', join: 'round' });
    const surf = new Graphics();
    this._path(surf, line.pts);
    surf.stroke({ width: W, color: COL.asphalt, cap: 'round', join: 'round' });
    this.trackGfx.addChild(ribbon, surf);

    // curbs on the apex / braking edges
    const curbs = new Graphics();
    const half = W / 2;
    track.segMeta.forEach((m, i) => {
      if (m.type !== SEG.APEX && m.type !== SEG.BRAKING) return;
      const inner = line.offsetAt(m.dist, half);
      const outer = line.offsetAt(m.dist, -half);
      const c = (i % 2 === 0) ? COL.curbA : COL.curbB;
      curbs.circle(inner.x, inner.y, 1.4).fill(c);
      curbs.circle(outer.x, outer.y, 1.4).fill(c);
    });
    this.trackGfx.addChild(curbs);

    // pit lane
    const pit = new Graphics();
    this._path(pit, track.pit.samples, false);
    pit.stroke({ width: 6, color: COL.pit, cap: 'round', join: 'round' });
    this.trackGfx.addChild(pit);

    // start-finish tick across the racing line
    const sf = new Graphics();
    const a = line.offsetAt(track.sfDist, half);
    const b = line.offsetAt(track.sfDist, -half);
    sf.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.5, color: COL.sf });
    this.trackGfx.addChild(sf);
  }

  _path(g, pts, close = true) {
    if (!pts.length) return;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    if (close) g.lineTo(pts[0].x, pts[0].y);
  }

  _fit() {
    const b = this.track.line.bounds();
    const pad = 60;
    const w = (b.maxX - b.minX) + pad * 2;
    const h = (b.maxY - b.minY) + pad * 2;
    const cw = this.app.renderer.width / this.app.renderer.resolution;
    const ch = this.app.renderer.height / this.app.renderer.resolution;
    const scale = Math.min(cw / w, ch / h);
    this.world.scale.set(scale);
    this.world.position.set(
      cw / 2 - ((b.minX + b.maxX) / 2) * scale,
      ch / 2 - ((b.minY + b.maxY) / 2) * scale,
    );
    this._baseScale = scale;
  }

  _wireControls(parent) {
    parent.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = parent.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const wx = (mx - this.world.x) / this.world.scale.x;
      const wy = (my - this.world.y) / this.world.scale.y;
      const ns = Math.max(this._baseScale * 0.6, Math.min(this._baseScale * 8, this.world.scale.x * factor));
      this.world.scale.set(ns);
      this.world.position.set(mx - wx * ns, my - wy * ns);
    }, { passive: false });

    parent.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, wx: this.world.x, wy: this.world.y };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      this.world.position.set(this._drag.wx + (e.clientX - this._drag.x), this._drag.wy + (e.clientY - this._drag.y));
    });
    window.addEventListener('pointerup', () => { this._drag = null; });
  }

  resetView() { this._fit(); }
}

export { Text };
