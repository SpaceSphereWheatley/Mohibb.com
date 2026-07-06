"use strict";
/* ============================================================
   Self-contained HTML rendering for the Race Report API. No
   external stylesheet/CDN, no <script> at all — the report must
   survive being forwarded/pasted elsewhere as a standalone file
   or email body. Design tokens copied from pitwall/style.css /
   CLAUDE.md's "Design tokens" section.
   ============================================================ */

import { escapeHtml, num } from './analysis.js';

const TZ = 'Europe/Oslo';
const fmtDateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function osloDateTime(iso) { try { return fmtDateTime.format(new Date(iso)); } catch { return '—'; } }

function fmtLap(sec) {
  const n = num(sec); if (n == null || n <= 0) return '—';
  const m = Math.floor(n / 60), s = n - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
function fmtGap(sec) {
  const n = num(sec); if (n == null) return '—';
  if (Math.abs(n) < 0.0005) return '+0.000';
  return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(3);
}

const STYLE = `
  :root{
    --bg:#EDE8DD; --card:#F7F3EA; --ink:#211D17; --ink-2:#5C554A; --ink-3:#8C8475; --ink-4:#B8AE9C;
    --line:#211D17; --line-soft:#C9C0AE;
    --accent:#B4471F; --accent-ink:#8F371A; --live:#2E6F4F; --green:#2E6F4F;
    --yellow:#B07A12; --red:#C0392B; --sc:#7A5BB0;
    --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.5;}
  .wrap{max-width:840px;margin:0 auto;padding:28px 20px 60px;}
  h1,h2{margin:0;font-weight:700;}
  .eyebrow{font-family:'Newsreader',serif;font-style:italic;color:var(--ink-2);font-size:15px;margin:0 0 4px;}
  header.banner{border-bottom:2px solid var(--line);padding-bottom:16px;margin-bottom:24px;}
  header.banner h1{font-size:26px;}
  .meta{color:var(--ink-2);font-size:13px;margin-top:6px;font-family:var(--mono);}
  section{margin:0 0 30px;}
  section h2{font-size:15px;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-ink);border-bottom:1.5px solid var(--line);padding-bottom:8px;margin-bottom:14px;}
  table.tbl{width:100%;border-collapse:collapse;font-size:13.5px;}
  table.tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-3);padding:6px 8px;border-bottom:1.5px solid var(--line);}
  table.tbl td{padding:7px 8px;border-bottom:1px solid var(--line-soft);}
  table.tbl tr.podium{font-weight:700;}
  table.tbl td.num,table.tbl th.num{text-align:right;font-family:var(--mono);}
  .accent-cell{border-left:3px solid var(--team,var(--ink-4));}
  .code{font-family:var(--mono);font-weight:700;}
  .muted{color:var(--ink-2);}
  .note{font-size:12.5px;color:var(--ink-3);margin-top:10px;}
  .state{display:inline-flex;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line-soft);border-radius:6px;padding:8px 12px;font-size:13px;}
  .state .badge{font-family:var(--mono);font-size:11px;text-transform:uppercase;color:var(--accent-ink);font-weight:700;}
  .cmp-tag{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11.5px;}
  .cmp-tag i{width:9px;height:9px;border-radius:2px;display:inline-block;}
  .legend{display:flex;flex-wrap:wrap;gap:10px 16px;margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--ink-2);}
  .legend span{display:inline-flex;align-items:center;gap:6px;}
  .legend i{width:9px;height:9px;border-radius:50%;display:inline-block;}
  .svg-box{width:100%;overflow-x:auto;}
  footer{border-top:1.5px solid var(--line-soft);padding-top:14px;margin-top:6px;color:var(--ink-3);font-size:12px;}
  .errbox h1{font-size:22px;margin-bottom:10px;}
  .errbox .badge{display:inline-block;font-family:var(--mono);font-weight:700;color:#fff;background:var(--accent);border-radius:4px;padding:2px 8px;font-size:12px;margin-bottom:12px;}
`;

function page({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&family=Newsreader:ital@1&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
</body>
</html>`;
}

export function renderErrorPage(status, title, message) {
  return page({
    title: `${title} — Pit Wall Race Report`,
    bodyHtml: `<div class="errbox"><span class="badge">HTTP ${escapeHtml(String(status))}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`,
  });
}

function driverCell(d) {
  return `<td class="accent-cell" style="--team:${d.colour || 'var(--ink-4)'}"><span class="code">${escapeHtml(d.acr)}</span> <span class="muted">${escapeHtml(d.name)}</span></td>`;
}

function sectionClassification(classification) {
  if (!classification.length) {
    return `<section><h2>Classification</h2><div class="state"><span class="badge">No data</span> No position data recorded for this session.</div></section>`;
  }
  const rows = classification.map(r => `<tr class="${r.position <= 3 ? 'podium' : ''}" style="--team:${r.driver.colour || 'var(--ink-4)'}">
      <td class="num">${escapeHtml(String(r.position))}</td>
      ${driverCell(r.driver)}
      <td class="muted">${escapeHtml(r.driver.team)}</td>
      <td class="num">${escapeHtml(String(r.laps))}</td>
    </tr>`).join('');
  return `<section><h2>Classification</h2>
    <table class="tbl"><thead><tr><th class="num">Pos</th><th>Driver</th><th>Team</th><th class="num">Laps</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="note">Position is OpenF1's last recorded running order for each driver; laps completed distinguish finishers from retired/lapped cars, since OpenF1's free historical data doesn't include a sourced finish-time gap or classification status.</div>
  </section>`;
}

function sectionFastestLap(fl) {
  if (!fl) return `<section><h2>Fastest lap</h2><div class="state"><span class="badge">No data</span> No lap times recorded for this session.</div></section>`;
  return `<section><h2>Fastest lap</h2>
    <table class="tbl"><tbody><tr style="--team:${fl.driver.colour || 'var(--ink-4)'}">
      ${driverCell(fl.driver)}
      <td class="muted">${escapeHtml(fl.driver.team)}</td>
      <td class="num">${fl.lap != null ? 'Lap ' + escapeHtml(String(fl.lap)) : '—'}</td>
      <td class="num code">${escapeHtml(fmtLap(fl.time))}</td>
    </tr></tbody></table>
  </section>`;
}

// Static inline SVG line chart — the server-side equivalent of renderHistory()/
// drawHistory()'s Chart.js trace, since a Pages Function can't run Chart.js
// (no canvas) and this report has no <script> at all.
function historySvg(history) {
  const W = 720, H = 300, padL = 44, padR = 12, padT = 12, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allGaps = history.traces.flatMap(t => t.points.map(p => p.gap));
  let maxAbs = allGaps.length ? Math.max(...allGaps.map(Math.abs)) : 0;
  if (!isFinite(maxAbs) || maxAbs <= 0) maxAbs = 5;
  maxAbs *= 1.12;
  const scaleX = (lap) => padL + (history.refLast > 1 ? (lap - 1) / (history.refLast - 1) : 0) * plotW;
  const scaleY = (gap) => padT + plotH / 2 - (gap / maxAbs) * (plotH / 2);

  const bandColour = (kind) => kind === 'VSC' ? 'var(--sc)' : 'var(--yellow)';
  const bandsSvg = history.bands.map(b => {
    const x0 = scaleX(b.x0), x1 = scaleX(b.x1 ?? b.x0);
    const w = Math.max(x1 - x0, 2);
    return `<rect x="${x0.toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${plotH}" fill="${bandColour(b.kind)}" opacity="0.16"/>`;
  }).join('');

  const baselineY = scaleY(0);
  const baselineSvg = `<line x1="${padL}" y1="${baselineY.toFixed(1)}" x2="${W - padR}" y2="${baselineY.toFixed(1)}" stroke="var(--ink)" stroke-width="1.5"/>`;

  const tracesSvg = history.traces.map(t => {
    const colour = t.driver.colour || '#8C8475';
    const pts = t.points.map(p => `${scaleX(p.lap).toFixed(1)},${scaleY(p.gap).toFixed(1)}`).join(' ');
    const line = `<polyline points="${pts}" fill="none" stroke="${escapeHtml(colour)}" stroke-width="${t.isRef ? 2.5 : 1.4}" opacity="${t.isRef ? 1 : 0.85}"/>`;
    const pitByLap = new Set(t.pitLaps);
    const dots = t.points.filter(p => pitByLap.has(p.lap)).map(p =>
      `<circle cx="${scaleX(p.lap).toFixed(1)}" cy="${scaleY(p.gap).toFixed(1)}" r="3.2" fill="var(--bg)" stroke="${escapeHtml(colour)}" stroke-width="1.5"/>`
    ).join('');
    return line + dots;
  }).join('');

  // sparse x-axis lap labels
  const tickCount = Math.min(8, history.refLast);
  const ticks = [];
  for (let i = 0; i < tickCount; i++) {
    const lap = Math.round(1 + (i / Math.max(1, tickCount - 1)) * (history.refLast - 1));
    ticks.push(lap);
  }
  const ticksSvg = [...new Set(ticks)].map(lap =>
    `<text x="${scaleX(lap).toFixed(1)}" y="${H - 8}" font-size="10" font-family="IBM Plex Mono, monospace" fill="var(--ink-3)" text-anchor="middle">${lap}</text>`
  ).join('');

  const legend = history.traces.map(t => `<span><i style="background:${escapeHtml(t.driver.colour || '#8C8475')}"></i>${escapeHtml(t.driver.acr)}</span>`).join('');

  return `<div class="svg-box"><svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-label="Gap to race winner, lap by lap">
      ${bandsSvg}${baselineSvg}${tracesSvg}${ticksSvg}
    </svg></div>
    <div class="legend">${legend}</div>`;
}

function sectionHistory(history) {
  if (!history) {
    return `<section><h2>Race history</h2><div class="state"><span class="badge">No data</span> Not enough lap timing to build the race-history trace.</div></section>`;
  }
  return `<section><h2>Race history</h2>
    ${historySvg(history)}
    <div class="note">Each car's running gap to the race winner, lap by lap (positive = ahead of the winner's pace at that lap). Shaded bands mark Safety Car (yellow) / Virtual Safety Car (purple) periods; ringed dots mark pit in-laps. Laps with missing timing are estimated from that driver's median lap, so treat sharp one-lap kinks with care.</div>
  </section>`;
}

function sectionStrategy(strategy) {
  const pitHtml = strategy.pitStops.length
    ? `<table class="tbl"><thead><tr><th>Driver</th><th class="num">Lap</th><th class="num">Pit time (s)</th></tr></thead>
        <tbody>${strategy.pitStops.map((p, i) => `<tr style="--team:${(strategy.strategies.find(s => s.n === p.n)?.driver.colour) || 'var(--ink-4)'}">
          ${driverCell(strategy.strategies.find(s => s.n === p.n)?.driver || { acr: '#' + p.n, name: '—', colour: null })}
          <td class="num muted">${p.lap ?? '—'}</td>
          <td class="num code">${p.dur.toFixed(1)}${i === 0 ? ' (fastest)' : ''}</td>
        </tr>`).join('')}</tbody></table>`
    : `<div class="state"><span class="badge">No data</span> No pit stops recorded for this session.</div>`;

  const stintsHtml = strategy.complete
    ? `<table class="tbl"><thead><tr><th>Driver</th><th>Stints (compound · laps)</th></tr></thead>
        <tbody>${strategy.strategies.map(s => `<tr style="--team:${s.driver.colour || 'var(--ink-4)'}">
          ${driverCell(s.driver)}
          <td>${s.stints.map(st => `<span class="cmp-tag"><i style="background:${compoundColour(st.cmp)}"></i>${escapeHtml(st.cmp)} ${st.start}-${st.end} (${st.laps})</span>`).join('&nbsp;&nbsp;')}</td>
        </tr>`).join('')}</tbody></table>`
    : `<div class="state"><span class="badge">Incomplete data</span> OpenF1's tyre-stint feed for this session is missing stints (gaps or an absent opening stint), so strategy bars would be misleading.</div>`;

  return `<section><h2>Tyre strategy &amp; pit stops</h2>
    ${stintsHtml}
    <div class="note" style="margin-bottom:16px;">${strategy.complete ? 'Stint laps are the reconstructed range from OpenF1’s stint feed. ' : ''}Pit time is total time in the pit lane (entry to exit), not just the stationary time.</div>
    ${pitHtml}
  </section>`;
}

function compoundColour(cmp) {
  return { SOFT: '#E8443B', MEDIUM: '#D49A1E', HARD: '#8C8475', INTERMEDIATE: '#2E9E57', WET: '#3E82F7' }[cmp] || '#B8AE9C';
}

function sectionSafety(periods) {
  if (!periods.length) {
    return `<section><h2>Safety Car / VSC periods</h2><div class="state"><span class="badge">None</span> No Safety Car or Virtual Safety Car periods.</div></section>`;
  }
  const rows = periods.map(p => `<tr><td>${p.kind === 'VSC' ? 'Virtual Safety Car' : 'Safety Car'}</td>
      <td class="num">${p.startLap ?? '—'}</td>
      <td class="num">${p.endLap ?? (p.endDate ? '—' : 'unresolved')}</td>
    </tr>`).join('');
  return `<section><h2>Safety Car / VSC periods</h2>
    <table class="tbl"><thead><tr><th>Type</th><th class="num">Start lap</th><th class="num">End lap</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </section>`;
}

function sectionRacePace(pace) {
  if (!pace.length) {
    return `<section><h2>Race pace summary</h2><div class="state"><span class="badge">No data</span> Not enough clean-lap data to build a pace summary.</div></section>`;
  }
  const rows = pace.map(r => `<tr style="--team:${r.driver.colour || 'var(--ink-4)'}">
      ${driverCell(r.driver)}
      <td class="num code">${escapeHtml(fmtLap(r.median))}</td>
      <td class="num code">${escapeHtml(fmtGap(r.gap))}</td>
      <td class="num muted">${r.sampleLaps}</td>
    </tr>`).join('');
  return `<section><h2>Race pace summary</h2>
    <table class="tbl"><thead><tr><th>Driver</th><th class="num">Median clean lap</th><th class="num">Gap</th><th class="num">Sample laps</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="note">Median lap time over green-flag laps only (excludes pit in/out laps and laps under Safety Car / VSC) — a directional pace guide, not a fuel- or tyre-corrected model.</div>
  </section>`;
}

export function renderReport({ session, meeting, classification, fastestLap, history, strategy, safetyPeriods, racePace, partialFailures }) {
  const gpName = meeting?.meeting_name || session.location || 'Grand Prix';
  const where = [session.circuit_short_name || session.location, session.country_name].filter(Boolean).join(', ');
  const bodyHtml = `
    <header class="banner">
      <p class="eyebrow">Pit Wall Race Report</p>
      <h1>${escapeHtml(gpName)}</h1>
      <div class="meta">${escapeHtml(session.session_name || 'Race')} &middot; ${escapeHtml(osloDateTime(session.date_start))} (Oslo) &middot; ${escapeHtml(where)}</div>
    </header>
    ${sectionClassification(classification)}
    ${sectionFastestLap(fastestLap)}
    ${sectionHistory(history)}
    ${sectionStrategy(strategy)}
    ${sectionSafety(safetyPeriods)}
    ${sectionRacePace(racePace)}
    <footer>
      Data: OpenF1 (api.openf1.org).
      ${partialFailures.length ? `Some sections used partial data because these OpenF1 endpoints didn't respond: ${escapeHtml(partialFailures.join(', '))}.` : ''}
    </footer>
  `;
  return page({ title: `${gpName} — Race Report`, bodyHtml });
}
