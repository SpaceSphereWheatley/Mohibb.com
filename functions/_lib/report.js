"use strict";
/* ============================================================
   Self-contained HTML rendering for the Race Report API. No
   external stylesheet/CDN, no <script> at all — the report must
   survive being forwarded/pasted elsewhere as a standalone file
   or email body. Design tokens copied from pitwall/style.css /
   CLAUDE.md's "Design tokens" section.

   Deliberately email-safe, Outlook included:
   - colors are literal hex values, not CSS custom properties
     (most email clients, Gmail included, drop `var(--x)` silently)
   - no flexbox/inline-block-with-swatch layout (Outlook's Word
     rendering engine doesn't support flexbox, and largely ignores
     width/height/padding on non-table inline elements)
   - structural markup is plain <div>, not <header>/<section>/
     <footer> (Outlook's Word engine doesn't reliably style HTML5
     sectioning elements)
   - data tables use fixed <colgroup> widths + cellpadding/
     cellspacing/border attributes, since Outlook's table layout
     can otherwise drift the header row out of alignment with the
     body rows
   - the race-history chart is a rasterized <img>, not inline
     <svg> — Gmail and Outlook both strip <svg> from HTML email
     bodies outright
   ============================================================ */

import { escapeHtml, num } from './analysis.js';
import { SECTION_KEYS } from './sections.js';
import { Raster, encodePng, bytesToBase64, downsample } from './png.js';

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
  p{margin:0;}
  .eyebrow{font-family:'Newsreader',serif;font-style:italic;color:${C.ink2};font-size:15px;margin:0 0 4px;}
  .banner{border-bottom:2px solid ${C.line};padding-bottom:16px;margin-bottom:32px;}
  .banner h1{font-size:26px;}
  .meta{color:${C.ink2};font-size:13px;margin-top:6px;font-family:${MONO};}
  .pitwall-link{display:inline-block;color:${C.accentInk};font-size:13px;font-weight:600;text-decoration:none;margin-top:10px;}
  .pitwall-link:hover{text-decoration:underline;}
  .section{margin:0 0 48px;}
  .section h2{font-size:15px;text-transform:uppercase;letter-spacing:0.06em;color:${C.accentInk};border-bottom:1.5px solid ${C.line};padding-bottom:8px;margin-bottom:16px;}
  table.tbl{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13.5px;}
  table.tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${C.ink3};padding:6px 8px;border-bottom:1.5px solid ${C.line};}
  table.tbl td{padding:7px 8px;border-bottom:1px solid ${C.lineSoft};}
  table.tbl tr.podium{font-weight:700;}
  table.tbl td.num,table.tbl th.num{text-align:right;font-family:${MONO};}
  .accent-cell{border-left:3px solid ${C.ink4};}
  .code{font-family:${MONO};font-weight:700;}
  .muted{color:${C.ink2};}
  .note{font-size:12.5px;color:${C.ink3};margin-top:10px;}
  .state{font-size:13px;}
  .state b{font-family:${MONO};text-transform:uppercase;font-size:11px;color:${C.accentInk};}
  .chart-img{max-width:100%;height:auto;display:block;border:1px solid ${C.lineSoft};}
  .legend{margin-top:10px;font-family:${MONO};font-size:12px;color:${C.ink2};}
  .footer{border-top:1.5px solid ${C.lineSoft};padding-top:14px;margin-top:6px;color:${C.ink3};font-size:12px;}
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

function colgroup(widths) {
  return `<colgroup>${widths.map(w => `<col width="${w}%" style="width:${w}%">`).join('')}</colgroup>`;
}

const TABLE_ATTRS = 'cellpadding="0" cellspacing="0" border="0"';

function sectionClassification(classification) {
  if (!classification.length) {
    return `<div class="section"><h2>Classification</h2><p class="state"><b>No data.</b> No position data recorded for this session.</p></div>`;
  }
  const rows = classification.map(r => `<tr class="${r.position <= 3 ? 'podium' : ''}">
      <td class="num">${escapeHtml(String(r.position))}</td>
      ${driverCell(r.driver)}
      <td class="muted">${escapeHtml(r.driver.team)}</td>
      <td class="num">${escapeHtml(String(r.laps))}</td>
      <td class="num code">${escapeHtml(fmtLap(r.pace?.median))}</td>
      <td class="num code">${escapeHtml(fmtGap(r.pace?.gap))}</td>
    </tr>`).join('');
  return `<div class="section"><h2>Classification</h2>
    <table class="tbl" ${TABLE_ATTRS}>
    ${colgroup([8, 30, 24, 10, 16, 12])}
    <thead><tr><th class="num">Pos</th><th>Driver</th><th>Team</th><th class="num">Laps</th><th class="num">Median lap</th><th class="num">Gap</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="note">Position is OpenF1's last recorded running order for each driver; laps completed distinguish finishers from retired/lapped cars, since OpenF1's free historical data doesn't include a sourced finish-time gap or classification status. Median lap / gap are the median clean-lap pace (green-flag laps only, excluding pit in/out laps and Safety Car/VSC) — a directional pace guide, not a fuel- or tyre-corrected model.</div>
  </div>`;
}

function sectionFastestLap(fl) {
  if (!fl) return `<div class="section"><h2>Fastest lap</h2><p class="state"><b>No data.</b> No lap times recorded for this session.</p></div>`;
  return `<div class="section"><h2>Fastest lap</h2>
    <table class="tbl" ${TABLE_ATTRS}>
    ${colgroup([30, 30, 20, 20])}
    <tbody><tr>
      ${driverCell(fl.driver)}
      <td class="muted">${escapeHtml(fl.driver.team)}</td>
      <td class="num">${fl.lap != null ? 'Lap ' + escapeHtml(String(fl.lap)) : '—'}</td>
      <td class="num code">${escapeHtml(fmtLap(fl.time))}</td>
    </tr></tbody></table>
  </div>`;
}

// Rasterizes the race-history trace directly at 1x — no supersampling.
// A 2x-supersample-then-downsample pass was tried for anti-aliasing, but it
// roughly *doubled* the encoded PNG's size (smooth per-pixel gradients along
// every line/band edge compress far worse than hard two-tone edges), which
// matters a lot here: the image ships base64-inlined in the report's HTML,
// and Gmail clips messages over ~102KB, silently truncating everything past
// that point. Reliability (not being clipped) wins over slightly smoother
// lines.
async function historyChart(history) {
  const W = 720, H = 720, padL = 44, padR = 12, padT = 12, padB = 28;
  const SS = 1; // supersample factor — see note above on why this isn't 2
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Fit the y-axis to the data's actual range rather than forcing it
  // symmetric around zero. "Gap to race winner" is one-sided in practice —
  // nobody stays ahead of the winner for long — so a +-maxAbs axis wastes
  // roughly the entire top half of the chart on a range the data never
  // reaches, cramming every driver's actual trace into a thin strip at the
  // bottom (this is what looked like the chart "getting cut off"; the PNG
  // itself was never truncated).
  //
  // Each side is scaled off each driver's peak on that side, not the pooled
  // set of all lap points — a single car many laps down contributes dozens
  // of large points that can dominate a naive max. Comparing peak-to-peak
  // catches the case that matters: one trace towering over every other.
  function robustBound(extremesSortedByMagnitude) {
    const top = extremesSortedByMagnitude[0] ?? 0;
    const second = extremesSortedByMagnitude[1] ?? 0;
    if (Math.abs(top) <= 0) return { bound: 0, clipped: false };
    if (extremesSortedByMagnitude.length > 1 && Math.abs(second) > 0 && Math.abs(top) > Math.abs(second) * 1.8) {
      return { bound: second * 1.3, clipped: true };
    }
    return { bound: top, clipped: false };
  }
  const posExtremes = history.traces
    .map(t => Math.max(0, ...t.points.map(p => p.gap).filter(v => isFinite(v))))
    .sort((a, b) => b - a);
  const negExtremes = history.traces
    .map(t => Math.min(0, ...t.points.map(p => p.gap).filter(v => isFinite(v))))
    .sort((a, b) => a - b);
  const { bound: posBound, clipped: clippedPos } = robustBound(posExtremes);
  const { bound: negBound, clipped: clippedNeg } = robustBound(negExtremes);
  const clipped = clippedPos || clippedNeg;

  const span = Math.max(posBound - negBound, 1);
  const margin = span * 0.06;
  const yMax = posBound + margin, yMin = negBound - margin;

  const scaleX = (lap) => (padL + (history.refLast > 1 ? (lap - 1) / (history.refLast - 1) : 0) * plotW) * SS;
  const scaleY = (gap) => (padT + ((yMax - gap) / (yMax - yMin)) * plotH) * SS;

  const raster = new Raster(W * SS, H * SS, C.bg);

  const bandColour = (kind) => kind === 'VSC' ? C.sc : C.yellow;
  for (const b of history.bands) {
    const x0 = scaleX(b.x0), x1 = scaleX(b.x1 ?? b.x0);
    raster.fillRect(x0, padT * SS, Math.max(x1 - x0, 2 * SS), plotH * SS, bandColour(b.kind), 0.16);
  }

  const baselineY = scaleY(0);
  raster.drawLine(padL * SS, baselineY, (W - padR) * SS, baselineY, C.ink, SS);

  for (const t of history.traces) {
    const colour = t.driver.colour || '#8C8475';
    const pts = t.points;
    for (let i = 1; i < pts.length; i++) {
      raster.drawLine(scaleX(pts[i - 1].lap), scaleY(pts[i - 1].gap), scaleX(pts[i].lap), scaleY(pts[i].gap), colour, (t.isRef ? 3 : 1.5) * SS);
    }
    const pitByLap = new Set(t.pitLaps);
    for (const p of pts) {
      if (pitByLap.has(p.lap)) raster.drawDot(scaleX(p.lap), scaleY(p.gap), 3 * SS, colour, C.bg);
    }
  }

  const png = await encodePng(downsample(raster, SS));
  const legend = history.traces.map(t => `<span style="color:${escapeHtml(t.driver.colour || '#8C8475')};font-weight:700">${escapeHtml(t.driver.acr)}</span>`).join(' &middot; ');
  return { dataUri: `data:image/png;base64,${bytesToBase64(png)}`, width: W, height: H, legend, clipped };
}

async function sectionHistory(history) {
  if (!history) {
    return `<div class="section"><h2>Race history</h2><p class="state"><b>No data.</b> Not enough lap timing to build the race-history trace.</p></div>`;
  }
  const chart = await historyChart(history);
  return `<div class="section"><h2>Race history</h2>
    <img class="chart-img" src="${chart.dataUri}" width="${chart.width}" height="${chart.height}" alt="Gap to race winner, lap by lap">
    <div class="legend">${chart.legend}</div>
    <div class="note">Each car's running gap to the race winner, lap by lap (positive = ahead of the winner's pace at that lap), capped to the top 10 classified drivers for readability. Shaded bands mark Safety Car (yellow) / Virtual Safety Car (purple) periods; ringed dots mark pit in-laps. Laps with missing timing are estimated from that driver's median lap, so treat sharp one-lap kinks with care.${chart.clipped ? ' One or more cars fell far enough outside the pack that their line is clipped at the chart edge, to keep the shared scale readable for everyone else.' : ''}</div>
  </div>`;
}

function sectionStrategy(strategy) {
  const stintsHtml = strategy.complete
    ? `<table class="tbl" ${TABLE_ATTRS}>
        ${colgroup([28, 72])}
        <thead><tr><th>Driver</th><th>Stints (compound · laps)</th></tr></thead>
        <tbody>${strategy.strategies.map(s => `<tr>
          ${driverCell(s.driver)}
          <td>${s.stints.map(st => `<span style="color:${compoundColour(st.cmp)};font-weight:700">${escapeHtml(st.cmp)}</span> ${st.start}-${st.end} (${st.laps})`).join(' &middot; ')}</td>
        </tr>`).join('')}</tbody></table>`
    : `<p class="state"><b>Incomplete data.</b> OpenF1's tyre-stint feed for this session is missing stints (gaps or an absent opening stint), so strategy bars would be misleading.</p>`;

  return `<div class="section"><h2>Tyre strategy</h2>
    ${stintsHtml}
    ${strategy.complete ? `<div class="note">Stint laps are the reconstructed range from OpenF1’s stint feed.</div>` : ''}
  </div>`;
}

function compoundColour(cmp) {
  return { SOFT: '#E8443B', MEDIUM: '#D49A1E', HARD: '#8C8475', INTERMEDIATE: '#2E9E57', WET: '#3E82F7' }[cmp] || '#B8AE9C';
}

function sectionSafety(periods) {
  if (!periods.length) {
    return `<div class="section"><h2>Safety Car / VSC periods</h2><p class="state"><b>None.</b> No Safety Car or Virtual Safety Car periods.</p></div>`;
  }
  const rows = periods.map(p => `<tr><td>${p.kind === 'VSC' ? 'Virtual Safety Car' : 'Safety Car'}</td>
      <td class="num">${p.startLap ?? '—'}</td>
      <td class="num">${p.endLap ?? (p.endDate ? '—' : 'unresolved')}</td>
    </tr>`).join('');
  return `<div class="section"><h2>Safety Car / VSC periods</h2>
    <table class="tbl" ${TABLE_ATTRS}>
    ${colgroup([50, 25, 25])}
    <thead><tr><th>Type</th><th class="num">Start lap</th><th class="num">End lap</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

export async function renderReport({ session, meeting, classification, fastestLap, history, strategy, safetyPeriods, partialFailures, sections = new Set(SECTION_KEYS) }) {
  const gpName = meeting?.meeting_name || session.location || 'Grand Prix';
  const where = [session.circuit_short_name || session.location, session.country_name].filter(Boolean).join(', ');
  const bodyHtml = `
    <div class="banner">
      <p class="eyebrow">Pit Wall Race Report</p>
      <h1>${escapeHtml(gpName)}</h1>
      <div class="meta">${escapeHtml(session.session_name || 'Race')} &middot; ${escapeHtml(osloDateTime(session.date_start))} (Oslo) &middot; ${escapeHtml(where)}</div>
      <a class="pitwall-link" href="${escapeHtml(pitwallUrl(session))}">Open this race in Pit Wall &rarr;</a>
    </div>
    ${sections.has('classification') ? sectionClassification(classification) : ''}
    ${sections.has('fastest_lap') ? sectionFastestLap(fastestLap) : ''}
    ${sections.has('race_history') ? await sectionHistory(history) : ''}
    ${sections.has('tyre_strategy') ? sectionStrategy(strategy) : ''}
    ${sections.has('safety_car') ? sectionSafety(safetyPeriods) : ''}
    <div class="footer">
      Data: OpenF1 (api.openf1.org).
      ${partialFailures.length ? `Some sections used partial data because these OpenF1 endpoints didn't respond: ${escapeHtml(partialFailures.join(', '))}.` : ''}
    </div>
  `;
  return page({ title: `${gpName} — Race Report`, bodyHtml });
}
