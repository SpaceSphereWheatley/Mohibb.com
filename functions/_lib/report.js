"use strict";
/* ============================================================
   Self-contained HTML rendering for the Race Report API. No
   external stylesheet/CDN, no <script> at all — the report must
   survive being forwarded/pasted elsewhere as a standalone file
   or email body. Design tokens copied from pitwall/style.css /
   CLAUDE.md's "Design tokens" section.

   Deliberately email-safe: colors are baked in as literal hex
   values rather than CSS custom properties (most email clients,
   Gmail included, drop `var(--x)` silently), layout avoids
   flexbox (Outlook has no support), and the race-history chart is
   a rasterized <img> (see _lib/png.js) rather than inline <svg> —
   Gmail and Outlook both strip <svg> from HTML email bodies
   outright, so a chart that only exists as SVG never survives
   being forwarded as an email.
   ============================================================ */

import { escapeHtml, num } from './analysis.js';
import { SECTION_KEYS } from './sections.js';
import { Raster, encodePng, bytesToBase64 } from './png.js';

const TZ = 'Europe/Oslo';
const fmtDateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function osloDateTime(iso) { try { return fmtDateTime.format(new Date(iso)); } catch { return '—'; } }

export function pitwallUrl(session) {
  return `https://mohibb.com/pitwall/#y=${encodeURIComponent(session.year)}&m=${encodeURIComponent(session.meeting_key)}&s=${encodeURIComponent(session.session_key)}`;
}

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

const C = {
  bg: '#EDE8DD', card: '#F7F3EA', ink: '#211D17', ink2: '#5C554A', ink3: '#8C8475', ink4: '#B8AE9C',
  line: '#211D17', lineSoft: '#C9C0AE',
  accent: '#B4471F', accentInk: '#8F371A', yellow: '#B07A12', sc: '#7A5BB0',
};
const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace";

const STYLE = `
  *{box-sizing:border-box;}
  body{margin:0;background:${C.bg};color:${C.ink};font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.5;}
  .wrap{max-width:840px;margin:0 auto;padding:28px 20px 60px;}
  h1,h2{margin:0;font-weight:700;}
  .eyebrow{font-family:'Newsreader',serif;font-style:italic;color:${C.ink2};font-size:15px;margin:0 0 4px;}
  header.banner{border-bottom:2px solid ${C.line};padding-bottom:16px;margin-bottom:24px;}
  header.banner h1{font-size:26px;}
  .meta{color:${C.ink2};font-size:13px;margin-top:6px;font-family:${MONO};}
  .pitwall-link{display:inline-block;color:${C.accentInk};font-size:13px;font-weight:600;text-decoration:none;margin-top:10px;}
  .pitwall-link:hover{text-decoration:underline;}
  section{margin:0 0 30px;}
  section h2{font-size:15px;text-transform:uppercase;letter-spacing:0.06em;color:${C.accentInk};border-bottom:1.5px solid ${C.line};padding-bottom:8px;margin-bottom:14px;}
  table.tbl{width:100%;border-collapse:collapse;font-size:13.5px;}
  table.tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${C.ink3};padding:6px 8px;border-bottom:1.5px solid ${C.line};}
  table.tbl td{padding:7px 8px;border-bottom:1px solid ${C.lineSoft};}
  table.tbl tr.podium{font-weight:700;}
  table.tbl td.num,table.tbl th.num{text-align:right;font-family:${MONO};}
  .accent-cell{border-left:3px solid ${C.ink4};}
  .code{font-family:${MONO};font-weight:700;}
  .muted{color:${C.ink2};}
  .note{font-size:12.5px;color:${C.ink3};margin-top:10px;}
  .state{display:inline-block;background:${C.card};border:1px solid ${C.lineSoft};border-radius:6px;padding:8px 12px;font-size:13px;}
  .state .badge{display:inline-block;margin-right:8px;font-family:${MONO};font-size:11px;text-transform:uppercase;color:${C.accentInk};font-weight:700;}
  .cmp-tag{display:inline-block;font-family:${MONO};font-size:11.5px;white-space:nowrap;}
  .cmp-tag i{width:9px;height:9px;margin-right:5px;display:inline-block;}
  .chart-img{max-width:100%;height:auto;display:block;border:1px solid ${C.lineSoft};}
  .legend{margin-top:10px;font-family:${MONO};font-size:12px;color:${C.ink2};}
  .legend span{display:inline-block;margin:0 16px 6px 0;white-space:nowrap;}
  .legend i{width:9px;height:9px;margin-right:6px;display:inline-block;border-radius:50%;}
  footer{border-top:1.5px solid ${C.lineSoft};padding-top:14px;margin-top:6px;color:${C.ink3};font-size:12px;}
  .errbox h1{font-size:22px;margin-bottom:10px;}
  .errbox .badge{display:inline-block;font-family:${MONO};font-weight:700;color:#fff;background:${C.accent};border-radius:4px;padding:2px 8px;font-size:12px;margin-bottom:12px;}
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
  const border = escapeHtml(d.colour || C.ink4);
  return `<td class="accent-cell" style="border-left-color:${border}"><span class="code">${escapeHtml(d.acr)}</span> <span class="muted">${escapeHtml(d.name)}</span></td>`;
}

function sectionClassification(classification) {
  if (!classification.length) {
    return `<section><h2>Classification</h2><div class="state"><span class="badge">No data</span> No position data recorded for this session.</div></section>`;
  }
  const rows = classification.map(r => `<tr class="${r.position <= 3 ? 'podium' : ''}">
      <td class="num">${escapeHtml(String(r.position))}</td>
      ${driverCell(r.driver)}
      <td class="muted">${escapeHtml(r.driver.team)}</td>
      <td class="num">${escapeHtml(String(r.laps))}</td>
      <td class="num code">${escapeHtml(fmtLap(r.pace?.median))}</td>
      <td class="num code">${escapeHtml(fmtGap(r.pace?.gap))}</td>
    </tr>`).join('');
  return `<section><h2>Classification</h2>
    <table class="tbl"><thead><tr><th class="num">Pos</th><th>Driver</th><th>Team</th><th class="num">Laps</th><th class="num">Median lap</th><th class="num">Gap</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="note">Position is OpenF1's last recorded running order for each driver; laps completed distinguish finishers from retired/lapped cars, since OpenF1's free historical data doesn't include a sourced finish-time gap or classification status. Median lap / gap are the median clean-lap pace (green-flag laps only, excluding pit in/out laps and Safety Car/VSC) — a directional pace guide, not a fuel- or tyre-corrected model.</div>
  </section>`;
}

function sectionFastestLap(fl) {
  if (!fl) return `<section><h2>Fastest lap</h2><div class="state"><span class="badge">No data</span> No lap times recorded for this session.</div></section>`;
  return `<section><h2>Fastest lap</h2>
    <table class="tbl"><tbody><tr>
      ${driverCell(fl.driver)}
      <td class="muted">${escapeHtml(fl.driver.team)}</td>
      <td class="num">${fl.lap != null ? 'Lap ' + escapeHtml(String(fl.lap)) : '—'}</td>
      <td class="num code">${escapeHtml(fmtLap(fl.time))}</td>
    </tr></tbody></table>
  </section>`;
}

// Rasterizes the same gap-to-winner trace geometry the old inline-SVG chart
// used, into a PNG <img> — see _lib/png.js for why (email clients strip
// <svg>, and CSS vars used for the SVG's fill/stroke wouldn't render there
// either).
async function historyChart(history) {
  const W = 720, H = 300, padL = 44, padR = 12, padT = 12, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allGaps = history.traces.flatMap(t => t.points.map(p => p.gap));
  let maxAbs = allGaps.length ? Math.max(...allGaps.map(Math.abs)) : 0;
  if (!isFinite(maxAbs) || maxAbs <= 0) maxAbs = 5;
  maxAbs *= 1.12;
  const scaleX = (lap) => padL + (history.refLast > 1 ? (lap - 1) / (history.refLast - 1) : 0) * plotW;
  const scaleY = (gap) => padT + plotH / 2 - (gap / maxAbs) * (plotH / 2);

  const raster = new Raster(W, H, C.bg);

  const bandColour = (kind) => kind === 'VSC' ? C.sc : C.yellow;
  for (const b of history.bands) {
    const x0 = scaleX(b.x0), x1 = scaleX(b.x1 ?? b.x0);
    raster.fillRect(x0, padT, Math.max(x1 - x0, 2), plotH, bandColour(b.kind), 0.16);
  }

  const baselineY = scaleY(0);
  raster.drawLine(padL, baselineY, W - padR, baselineY, C.ink, 1);

  for (const t of history.traces) {
    const colour = t.driver.colour || '#8C8475';
    const pts = t.points;
    for (let i = 1; i < pts.length; i++) {
      raster.drawLine(scaleX(pts[i - 1].lap), scaleY(pts[i - 1].gap), scaleX(pts[i].lap), scaleY(pts[i].gap), colour, t.isRef ? 3 : 1);
    }
    const pitByLap = new Set(t.pitLaps);
    for (const p of pts) {
      if (pitByLap.has(p.lap)) raster.drawDot(scaleX(p.lap), scaleY(p.gap), 3, colour, C.bg);
    }
  }

  const png = await encodePng(raster);
  const legend = history.traces.map(t => `<span><i style="background:${escapeHtml(t.driver.colour || '#8C8475')}"></i>${escapeHtml(t.driver.acr)}</span>`).join('');
  return { dataUri: `data:image/png;base64,${bytesToBase64(png)}`, width: W, height: H, legend };
}

async function sectionHistory(history) {
  if (!history) {
    return `<section><h2>Race history</h2><div class="state"><span class="badge">No data</span> Not enough lap timing to build the race-history trace.</div></section>`;
  }
  const chart = await historyChart(history);
  return `<section><h2>Race history</h2>
    <img class="chart-img" src="${chart.dataUri}" width="${chart.width}" height="${chart.height}" alt="Gap to race winner, lap by lap">
    <div class="legend">${chart.legend}</div>
    <div class="note">Each car's running gap to the race winner, lap by lap (positive = ahead of the winner's pace at that lap), capped to the top 10 classified drivers for readability. Shaded bands mark Safety Car (yellow) / Virtual Safety Car (purple) periods; ringed dots mark pit in-laps. Laps with missing timing are estimated from that driver's median lap, so treat sharp one-lap kinks with care.</div>
  </section>`;
}

function sectionStrategy(strategy) {
  const stintsHtml = strategy.complete
    ? `<table class="tbl"><thead><tr><th>Driver</th><th>Stints (compound · laps)</th></tr></thead>
        <tbody>${strategy.strategies.map(s => `<tr>
          ${driverCell(s.driver)}
          <td>${s.stints.map(st => `<span class="cmp-tag"><i style="background:${compoundColour(st.cmp)}"></i>${escapeHtml(st.cmp)} ${st.start}-${st.end} (${st.laps})</span>`).join('&nbsp;&nbsp;')}</td>
        </tr>`).join('')}</tbody></table>`
    : `<div class="state"><span class="badge">Incomplete data</span> OpenF1's tyre-stint feed for this session is missing stints (gaps or an absent opening stint), so strategy bars would be misleading.</div>`;

  return `<section><h2>Tyre strategy</h2>
    ${stintsHtml}
    ${strategy.complete ? `<div class="note">Stint laps are the reconstructed range from OpenF1’s stint feed.</div>` : ''}
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

export async function renderReport({ session, meeting, classification, fastestLap, history, strategy, safetyPeriods, partialFailures, sections = new Set(SECTION_KEYS) }) {
  const gpName = meeting?.meeting_name || session.location || 'Grand Prix';
  const where = [session.circuit_short_name || session.location, session.country_name].filter(Boolean).join(', ');
  const bodyHtml = `
    <header class="banner">
      <p class="eyebrow">Pit Wall Race Report</p>
      <h1>${escapeHtml(gpName)}</h1>
      <div class="meta">${escapeHtml(session.session_name || 'Race')} &middot; ${escapeHtml(osloDateTime(session.date_start))} (Oslo) &middot; ${escapeHtml(where)}</div>
      <a class="pitwall-link" href="${escapeHtml(pitwallUrl(session))}">Open this race in Pit Wall &rarr;</a>
    </header>
    ${sections.has('classification') ? sectionClassification(classification) : ''}
    ${sections.has('fastest_lap') ? sectionFastestLap(fastestLap) : ''}
    ${sections.has('race_history') ? await sectionHistory(history) : ''}
    ${sections.has('tyre_strategy') ? sectionStrategy(strategy) : ''}
    ${sections.has('safety_car') ? sectionSafety(safetyPeriods) : ''}
    <footer>
      Data: OpenF1 (api.openf1.org).
      ${partialFailures.length ? `Some sections used partial data because these OpenF1 endpoints didn't respond: ${escapeHtml(partialFailures.join(', '))}.` : ''}
    </footer>
  `;
  return page({ title: `${gpName} — Race Report`, bodyHtml });
}
