// analysis.js — post-race charts via Chart.js (loaded as the global `Chart`
// from the vendored UMD build, mirroring how pitwall/ uses it). Reads the
// per-lap history the race logged: lap-time evolution and position changes.

const FONT = "'IBM Plex Mono', monospace";
const INK = '#5C554A', GRID = 'rgba(33,29,23,0.08)';

export class Analysis {
  constructor(mount) {
    this.mount = mount;
    this.charts = [];
  }

  destroy() {
    this.charts.forEach((c) => c.destroy());
    this.charts = [];
    this.mount.innerHTML = '';
  }

  render(race) {
    const Chart = window.Chart;
    this.destroy();
    if (!Chart) { this.mount.innerHTML = '<p class="sim-note">Charts unavailable.</p>'; return; }

    const order = race.order();
    this.mount.innerHTML = `
      <div class="sim-chart"><h3>Lap-time evolution</h3><canvas id="chLap"></canvas></div>
      <div class="sim-chart"><h3>Position changes</h3><canvas id="chPos"></canvas></div>`;

    const top = order.slice(0, 8);
    const median = medianLap(top);

    // lap-time chart (exclude lap 1 and pit-affected outliers from the view)
    this.charts.push(new Chart(this.mount.querySelector('#chLap'), {
      type: 'line',
      data: {
        datasets: top.map((car) => ({
          label: car.code,
          borderColor: car.color,
          backgroundColor: car.color,
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0.25,
          data: car.history
            .filter((h) => h.lap > 1 && h.time < median * 1.25)
            .map((h) => ({ x: h.lap, y: h.time })),
        })),
      },
      options: baseOpts('Lap', 'Lap time (s)'),
    }));

    // position chart (y reversed: P1 on top)
    const posOpts = baseOpts('Lap', 'Position');
    posOpts.scales.y.reverse = true;
    posOpts.scales.y.ticks.stepSize = 1;
    this.charts.push(new Chart(this.mount.querySelector('#chPos'), {
      type: 'line',
      data: {
        datasets: order.slice(0, 10).map((car) => ({
          label: car.code,
          borderColor: car.color,
          backgroundColor: car.color,
          borderWidth: 1.6,
          pointRadius: 0,
          stepped: true,
          data: car.history.map((h) => ({ x: h.lap, y: h.pos })),
        })),
      },
      options: posOpts,
    }));
  }
}

function medianLap(cars) {
  const times = [];
  for (const c of cars) for (const h of c.history) if (h.lap > 1) times.push(h.time);
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] || 80;
}

function baseOpts(xLabel, yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { labels: { font: { family: FONT, size: 10 }, color: INK, boxWidth: 10 } },
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel, color: INK, font: { family: FONT, size: 10 } },
        ticks: { font: { family: FONT, size: 10 }, color: INK },
        grid: { color: GRID },
      },
      y: {
        title: { display: true, text: yLabel, color: INK, font: { family: FONT, size: 10 } },
        ticks: { font: { family: FONT, size: 10 }, color: INK },
        grid: { color: GRID },
      },
    },
  };
}
