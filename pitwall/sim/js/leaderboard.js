// leaderboard.js — the live timing tower, rendered as real DOM (not canvas) so
// it stays accessible. Rebuilds a compact table each refresh from the race
// order: position, driver, interval, compound, tyre life and pit status.

import { tyreLifePct } from './tyres.js';
import { config } from './config.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function compoundHex(c) {
  return '#' + config.tyres[c].color.toString(16).padStart(6, '0');
}

function intervalText(car) {
  if (car.position === 1) return 'Leader';
  if (car.lapsDown >= 1) return `+${car.lapsDown} lap${car.lapsDown > 1 ? 's' : ''}`;
  return `+${car.interval.toFixed(3)}`;
}

function pitText(car) {
  if (car.pit) return car.pit.served ? 'OUT LAP' : 'IN PIT';
  return car.stops > 0 ? `${car.stops} stop${car.stops > 1 ? 's' : ''}` : '—';
}

export class Leaderboard {
  constructor(mount) {
    this.mount = mount;
    this.mount.innerHTML = `<table class="lb"><thead><tr>
      <th class="lb-pos">P</th><th>Driver</th><th class="lb-int">Interval</th>
      <th class="lb-tyre">Tyre</th><th class="lb-life">Life</th><th class="lb-pit">Pit</th>
    </tr></thead><tbody></tbody></table>`;
    this.body = this.mount.querySelector('tbody');
  }

  update(race) {
    const rows = race.order().map((car) => {
      const life = tyreLifePct(car.wear);
      const lifeClass = life < 20 ? 'crit' : life < 40 ? 'warn' : '';
      const pit = car.pit ? ' lb-row--pit' : '';
      return `<tr class="lb-row${pit}">
        <td class="lb-pos">${car.position}</td>
        <td class="lb-drv"><span class="lb-chip" style="background:${esc(car.color)}"></span>${esc(car.code)}</td>
        <td class="lb-int num">${esc(intervalText(car))}</td>
        <td class="lb-tyre"><span class="lb-cmp" style="border-color:${compoundHex(car.compound)};color:${compoundHex(car.compound)}">${config.tyres[car.compound].label}</span></td>
        <td class="lb-life"><span class="lb-bar"><span class="lb-bar-fill ${lifeClass}" style="width:${life}%"></span></span><span class="lb-life-n num">${life}</span></td>
        <td class="lb-pit num">${esc(pitText(car))}</td>
      </tr>`;
    });
    this.body.innerHTML = rows.join('');
  }
}
