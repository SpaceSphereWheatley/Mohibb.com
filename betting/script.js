const BETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT6GhPD4kXOQposMCsLE8i3YFxsUeFiiYWqDtoFZSlV7i1DkD5m1Xh-KhLyM3yGvFtbtVzJLFOyo7Yh/pub?gid=2076253557&single=true&output=csv';
const MATCHES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT6GhPD4kXOQposMCsLE8i3YFxsUeFiiYWqDtoFZSlV7i1DkD5m1Xh-KhLyM3yGvFtbtVzJLFOyo7Yh/pub?gid=329494115&single=true&output=csv';

// ── CSV / formatting helpers ────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { row.push(cur.trim()); cur = ''; continue; }
    if ((c === '\n' || c === '\r') && !inQ) {
      row.push(cur.trim()); cur = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  row.push(cur.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseKr(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/kr\s*/i, '').replace(/\s/g, '').replace(/,/g, '')) || 0;
}

function parseDate(s) {
  if (!s) return null;
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}`) : null;
}

function fmtKr(n) {
  const sign = n < 0 ? '-' : '';
  const val = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sign + 'kr ' + val;
}

function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sign(n) { return n >= 0 ? '+' : ''; }
function cls(n) { return n >= 0 ? 'pos' : 'neg'; }

// ── Data loading ────────────────────────────────────────────────────────────

async function loadData() {
  const [betsText, matchesText] = await Promise.all([
    fetch(BETS_URL).then(r => { if (!r.ok) throw new Error(`Bets HTTP ${r.status}`); return r.text(); }),
    fetch(MATCHES_URL).then(r => { if (!r.ok) throw new Error(`Matches HTTP ${r.status}`); return r.text(); })
  ]);

  const matchMap = {};
  parseCSV(matchesText).slice(1).filter(r => r[0]).forEach(r => {
    matchMap[r[0].trim()] = { home: r[6], away: r[7], league: r[4], country: r[14] };
  });

  const bets = parseCSV(betsText).slice(1).filter(r => r[18]).map(r => ({
    betDate: parseDate(r[0]),
    betType: r[1],
    stake: parseKr(r[2]),
    matchNums: r[3].split(',').map(s => s.trim()).filter(Boolean),
    selection: r[4],
    totalOdds: parseFloat(r[5]) || 0,
    potentialPayout: parseKr(r[6]),
    isFinished: r[7] === 'TRUE',
    concludingTime: parseDate(r[8]),
    win: r[9] === 'TRUE' ? true : r[9] === 'FALSE' ? false : null,
    profit: parseKr(r[10]),
    funds: parseKr(r[11]),
    expectedProfit: parseKr(r[13]),
    countries: r[15] ? r[15].split(',').map(s => s.trim()).filter(Boolean) : [],
    arbId: r[17] || null,
    betId: parseInt(r[18]) || 0
  }));

  return { bets, matchMap };
}

// ── Arb grouping ────────────────────────────────────────────────────────────

function matchLabel(nums, matchMap) {
  return nums.map(n => {
    const m = matchMap[n];
    return m ? `${m.home} vs ${m.away}` : `Match ${n}`;
  }).join(', ');
}

function groupBets(bets, matchMap) {
  const groups = [];
  const seenArb = new Set();

  for (const bet of bets) {
    if (bet.arbId) {
      if (seenArb.has(bet.arbId)) continue;
      seenArb.add(bet.arbId);

      const legs = bets.filter(b => b.arbId === bet.arbId);
      const totalProfit = legs.reduce((s, b) => s + b.profit, 0);
      const totalStake = legs.reduce((s, b) => s + b.stake, 0);
      const allNums = [...new Set(legs.flatMap(b => b.matchNums))];
      const allCountries = [...new Set(legs.flatMap(b => b.countries))];
      const allSettled = legs.every(b => b.win !== null);

      groups.push({
        type: 'arb',
        arbId: bet.arbId,
        legs,
        bet: {
          betDate: bet.betDate,
          betType: 'Arbitrage',
          stake: totalStake,
          matchNums: allNums,
          matchLabel: matchLabel(allNums, matchMap),
          countries: allCountries,
          totalOdds: null,
          potentialPayout: legs[0].potentialPayout,
          profit: totalProfit,
          funds: legs[legs.length - 1].funds,
          roi: totalStake > 0 ? (totalProfit / totalStake) * 100 : 0,
          expectedProfit: legs.reduce((s, b) => s + b.expectedProfit, 0),
          isFinished: legs.every(b => b.isFinished),
          win: allSettled ? totalProfit > 0 : null,
          concludingTime: bet.concludingTime,
          betId: bet.betId
        }
      });
    } else {
      groups.push({
        type: 'single',
        bet: { ...bet, matchLabel: matchLabel(bet.matchNums, matchMap) }
      });
    }
  }

  groups.sort((a, b) => a.bet.betId - b.bet.betId);
  return groups;
}

// ── Stats ───────────────────────────────────────────────────────────────────

function calcStats(groups, bets) {
  const settled = groups.filter(g => g.bet.win !== null);
  const won = settled.filter(g => g.bet.win === true);
  const totalProfit = settled.reduce((s, g) => s + g.bet.profit, 0);
  const totalStake = settled.reduce((s, g) => s + g.bet.stake, 0);
  const totalExpected = settled.reduce((s, g) => s + g.bet.expectedProfit, 0);

  const lastBet = [...bets].sort((a, b) => a.betId - b.betId).filter(b => b.win !== null).pop();
  const bankroll = lastBet ? lastBet.funds : 0;

  const best = settled.length
    ? settled.reduce((m, g) => g.bet.profit > m.bet.profit ? g : m)
    : null;

  const byCountry = {};
  for (const g of settled) {
    const countries = [...new Set(g.bet.countries)];
    if (!countries.length) continue;
    for (const c of countries) {
      byCountry[c] = (byCountry[c] || 0) + g.bet.profit / countries.length;
    }
  }
  const countryRanked = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);

  return {
    bankroll,
    totalProfit,
    totalStake,
    totalExpected,
    winRate: settled.length ? (won.length / settled.length) * 100 : 0,
    wonCount: won.length,
    totalBets: settled.length,
    roi: totalStake ? (totalProfit / totalStake) * 100 : 0,
    edge: totalProfit - totalExpected,
    best,
    countryRanked
  };
}

// ── Render: KPIs ────────────────────────────────────────────────────────────

function renderKPIs(stats) {
  document.getElementById('kpi-bankroll').innerHTML =
    `<span class="kpi-label">Bankroll</span>
     <span class="kpi-value">${fmtKr(stats.bankroll)}</span>`;

  document.getElementById('kpi-pl').innerHTML =
    `<span class="kpi-label">Total P/L</span>
     <span class="kpi-value ${cls(stats.totalProfit)}">${sign(stats.totalProfit)}${fmtKr(stats.totalProfit)}</span>`;

  document.getElementById('kpi-winrate').innerHTML =
    `<span class="kpi-label">Win Rate</span>
     <span class="kpi-value">${stats.winRate.toFixed(1)}%</span>
     <span class="kpi-sub">${stats.wonCount} / ${stats.totalBets} bets</span>`;

  document.getElementById('kpi-total').innerHTML =
    `<span class="kpi-label">Bets Placed</span>
     <span class="kpi-value">${stats.totalBets}</span>`;

  document.getElementById('kpi-roi').innerHTML =
    `<span class="kpi-label">Overall ROI</span>
     <span class="kpi-value ${cls(stats.roi)}">${sign(stats.roi)}${stats.roi.toFixed(1)}%</span>`;

  const best = stats.best;
  document.getElementById('kpi-best').innerHTML =
    `<span class="kpi-label">Best Bet</span>
     <span class="kpi-value pos">${best ? '+' + fmtKr(best.bet.profit) : '—'}</span>
     ${best ? `<span class="kpi-sub">${best.bet.matchLabel || best.bet.betType} &middot; ${fmtDate(best.bet.concludingTime)}</span>` : ''}`;

  document.getElementById('kpi-edge').innerHTML =
    `<span class="kpi-label">Edge vs Expected</span>
     <span class="kpi-value ${cls(stats.edge)}">${sign(stats.edge)}${fmtKr(stats.edge)}</span>
     <span class="kpi-sub">Expected total: ${fmtKr(stats.totalExpected)}</span>`;

  document.getElementById('kpi-pvse').innerHTML =
    `<span class="kpi-label">Profit vs Expected</span>
     <div class="pvse-row">
       <span class="pvse-item">
         <span class="pvse-lbl">Actual</span>
         <span class="pvse-val ${cls(stats.totalProfit)}">${fmtKr(stats.totalProfit)}</span>
       </span>
       <span class="pvse-sep">vs</span>
       <span class="pvse-item">
         <span class="pvse-lbl">Expected</span>
         <span class="pvse-val">${fmtKr(stats.totalExpected)}</span>
       </span>
     </div>`;
}

// ── Render: Country table ───────────────────────────────────────────────────

function renderCountryTable(countryRanked) {
  if (!countryRanked.length) {
    document.getElementById('country-table').innerHTML = '<p class="kpi-sub" style="margin-top:0.5rem">No data</p>';
    return;
  }
  const rows = countryRanked.slice(0, 7).map(([c, p]) =>
    `<tr>
       <td>${c}</td>
       <td class="${cls(p)}">${sign(p)}${fmtKr(p)}</td>
     </tr>`
  ).join('');
  document.getElementById('country-table').innerHTML =
    `<table class="country-tbl">
       <thead><tr><th>Country</th><th>P/L</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`;
}

// ── Render: Charts ──────────────────────────────────────────────────────────

let bankrollChart, monthlyChart;

const CHART_FONT = { family: 'Plus Jakarta Sans, system-ui, sans-serif', size: 11 };
const GRID_COLOR = 'rgba(107,101,96,0.15)';
const TICK_COLOR = '#6B6560';

function renderBankrollChart(bets) {
  const settled = [...bets].filter(b => b.win !== null).sort((a, b) => a.betId - b.betId);
  const ctx = document.getElementById('bankroll-chart').getContext('2d');
  if (bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: settled.map(b => fmtDate(b.concludingTime || b.betDate)),
      datasets: [{
        data: settled.map(b => b.funds),
        borderColor: '#B4471F',
        backgroundColor: 'rgba(180,71,31,0.07)',
        borderWidth: 2,
        pointRadius: 2.5,
        pointBackgroundColor: '#B4471F',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ' ' + fmtKr(ctx.raw) }
      }},
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: TICK_COLOR, font: CHART_FONT, maxRotation: 0 }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TICK_COLOR, font: CHART_FONT, callback: v => fmtKr(v) }, grid: { color: GRID_COLOR } }
      }
    }
  });
}

function renderMonthlyChart(groups) {
  const monthly = {};
  for (const g of groups.filter(g2 => g2.bet.win !== null)) {
    const d = g.bet.concludingTime || g.bet.betDate;
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] || 0) + g.bet.profit;
  }
  const keys = Object.keys(monthly).sort();
  const data = keys.map(k => monthly[k]);
  const ctx = document.getElementById('monthly-chart').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: keys.map(k => {
        const [y, m] = k.split('-');
        return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      }),
      datasets: [{
        data,
        backgroundColor: data.map(v => v >= 0 ? 'rgba(46,111,79,0.65)' : 'rgba(180,71,31,0.65)'),
        borderColor: data.map(v => v >= 0 ? '#2E6F4F' : '#B4471F'),
        borderWidth: 1.5,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ' ' + fmtKr(ctx.raw) }
      }},
      scales: {
        x: { ticks: { color: TICK_COLOR, font: CHART_FONT, maxRotation: 0 }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TICK_COLOR, font: CHART_FONT, callback: v => fmtKr(v) }, grid: { color: GRID_COLOR } }
      }
    }
  });
}

// ── Render: Open / Pending bets ─────────────────────────────────────────────

function renderOpenBets(openGroups, pendingGroups) {
  const all = [...pendingGroups, ...openGroups];
  const section = document.getElementById('open-section');
  if (!all.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  document.getElementById('open-bets').innerHTML = all.map(g => {
    const b = g.bet;
    const isPending = b.isFinished && b.win === null;
    const badge = isPending
      ? '<span class="badge badge-pending">Awaiting result</span>'
      : '<span class="badge badge-open">Open</span>';
    return `<div class="open-card">
      <div class="open-card-top">${badge}<span class="open-type">${b.betType}</span></div>
      <div class="open-match">${b.matchLabel || '—'}</div>
      <div class="open-card-nums">
        <span>Stake <strong>${fmtKr(b.stake)}</strong></span>
        <span>Potential <strong>${fmtKr(b.potentialPayout)}</strong></span>
        ${b.countries.length ? `<span>${b.countries.join(', ')}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Render: Bets table ──────────────────────────────────────────────────────

function renderBetsTable(groups) {
  document.getElementById('bets-tbody').innerHTML = groups.map(g => {
    const b = g.bet;
    const isOpen = !b.isFinished && b.win === null;
    const isPending = b.isFinished && b.win === null;
    const isSettled = b.win !== null;

    const resultHtml = isOpen
      ? '<span class="tag tag-open">Open</span>'
      : isPending
        ? '<span class="tag tag-pending">Pending</span>'
        : b.win
          ? '<span class="tag tag-win">Win</span>'
          : '<span class="tag tag-loss">Loss</span>';

    const profitCell = isSettled
      ? `<span class="${cls(b.profit)}">${sign(b.profit)}${fmtKr(b.profit)}</span>`
      : '—';

    const roi = typeof b.roi === 'number' ? b.roi : (b.stake > 0 ? (b.profit / b.stake) * 100 : 0);
    const roiCell = isSettled
      ? `<span class="${cls(roi)}">${sign(roi)}${roi.toFixed(1)}%</span>`
      : '—';

    const oddsCell = b.totalOdds ? b.totalOdds.toFixed(2) : '—';

    let expandBtn = '';
    let legRows = '';
    if (g.type === 'arb') {
      expandBtn = `<button class="arb-toggle" data-arb="${g.arbId}" aria-expanded="false">&#9658; ${g.legs.length} legs</button>`;
      legRows = g.legs.map(leg => `<tr class="arb-leg" data-arb-leg="${g.arbId}" style="display:none">
        <td>${fmtDate(leg.betDate)}</td>
        <td colspan="2">&#8627; Selection: ${leg.selection}</td>
        <td>${leg.countries.join(', ')}</td>
        <td>${fmtKr(leg.stake)}</td>
        <td>${leg.totalOdds.toFixed(2)}</td>
        <td><span class="${cls(leg.profit)}">${sign(leg.profit)}${fmtKr(leg.profit)}</span></td>
        <td></td>
        <td>${leg.win === true ? '<span class="tag tag-win">Win</span>' : leg.win === false ? '<span class="tag tag-loss">Loss</span>' : '<span class="tag tag-open">—</span>'}</td>
      </tr>`).join('');
    }

    return `<tr class="bet-row${g.type === 'arb' ? ' arb-row' : ''}">
      <td>${fmtDate(b.betDate)}</td>
      <td><span class="type-tag">${b.betType}</span>${expandBtn}</td>
      <td class="match-cell" title="${b.matchLabel || ''}">${b.matchLabel || '—'}</td>
      <td>${b.countries.slice(0, 2).join(', ') || '—'}</td>
      <td>${fmtKr(b.stake)}</td>
      <td>${oddsCell}</td>
      <td>${profitCell}</td>
      <td>${roiCell}</td>
      <td>${resultHtml}</td>
    </tr>${legRows}`;
  }).join('');

  document.querySelectorAll('.arb-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.arb;
      const legs = document.querySelectorAll(`[data-arb-leg="${id}"]`);
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      legs.forEach(l => { l.style.display = expanded ? 'none' : ''; });
      btn.setAttribute('aria-expanded', String(!expanded));
      btn.innerHTML = (expanded ? '&#9658;' : '&#9660;') + btn.innerHTML.slice(btn.innerHTML.indexOf(' '));
    });
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  const errorEl = document.getElementById('error-state');

  try {
    const { bets, matchMap } = await loadData();
    const groups = groupBets(bets, matchMap);

    const open = groups.filter(g => !g.bet.isFinished && g.bet.win === null);
    const pending = groups.filter(g => g.bet.isFinished && g.bet.win === null);

    const stats = calcStats(groups, bets);

    renderKPIs(stats);
    renderCountryTable(stats.countryRanked);
    renderBankrollChart(bets);
    renderMonthlyChart(groups);
    renderOpenBets(open, pending);
    renderBetsTable([...groups].reverse());

    document.getElementById('last-updated').textContent =
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.querySelector('.error-msg').textContent = err.message;
  }
}

document.addEventListener('DOMContentLoaded', init);
