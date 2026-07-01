const BETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT6GhPD4kXOQposMCsLE8i3YFxsUeFiiYWqDtoFZSlV7i1DkD5m1Xh-KhLyM3yGvFtbtVzJLFOyo7Yh/pub?gid=2076253557&single=true&output=csv';
const MATCHES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT6GhPD4kXOQposMCsLE8i3YFxsUeFiiYWqDtoFZSlV7i1DkD5m1Xh-KhLyM3yGvFtbtVzJLFOyo7Yh/pub?gid=329494115&single=true&output=csv';

// ── Module state ─────────────────────────────────────────────────────────────
let allGroups = [];
let allBets = [];
let allMatchMap = {};
let currentPeriod = '6m';

// ── CSV / formatting helpers ─────────────────────────────────────────────────

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
  return sign + 'kr ' + val;
}

function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sign(n) { return n >= 0 ? '+' : ''; }
function cls(n) { return n >= 0 ? 'pos' : 'neg'; }

// ── Data loading ─────────────────────────────────────────────────────────────

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

// ── Arb bias helper ──────────────────────────────────────────────────────────

const SELECTION_LABEL = { '1': 'Home Win', 'x': 'Draw', '2': 'Away Win' };

function arbBias(legs) {
  const payouts = legs.map(l => l.stake * l.totalOdds);
  const max = Math.max(...payouts);
  const min = Math.min(...payouts);
  if (max === 0) return '';
  if ((max - min) / max <= 0.05) return 'Neutral arb';
  const topLeg = legs[payouts.indexOf(max)];
  const label = SELECTION_LABEL[topLeg.selection.toLowerCase()] || topLeg.selection;
  return `Biased toward ${label}`;
}

// ── Arb grouping ─────────────────────────────────────────────────────────────

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
        bet: {
          ...bet,
          roi: bet.stake > 0 ? (bet.profit / bet.stake) * 100 : 0,
          matchLabel: matchLabel(bet.matchNums, matchMap)
        }
      });
    }
  }

  groups.sort((a, b) => a.bet.betId - b.bet.betId);
  return groups;
}

// ── Period helpers ────────────────────────────────────────────────────────────

function getPeriodRange(value) {
  if (value === 'all') return null;
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  function monthsBack(d, n) {
    const r = new Date(d);
    r.setMonth(r.getMonth() - n);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  switch (value) {
    case 'ytd': {
      const start = new Date(end.getFullYear(), 0, 1);
      const prevStart = new Date(end.getFullYear() - 1, 0, 1);
      return { start, end, prevStart, prevEnd: new Date(start) };
    }
    case '6m': {
      const start = monthsBack(end, 6);
      return { start, end, prevStart: monthsBack(start, 6), prevEnd: new Date(start) };
    }
    case '3m': {
      const start = monthsBack(end, 3);
      return { start, end, prevStart: monthsBack(start, 3), prevEnd: new Date(start) };
    }
    case '1m': {
      const start = monthsBack(end, 1);
      return { start, end, prevStart: monthsBack(start, 1), prevEnd: new Date(start) };
    }
    default: return null;
  }
}

function filterByRange(groups, start, end) {
  return groups.filter(g => {
    const d = g.bet.concludingTime || g.bet.betDate;
    return d && d >= start && d <= end;
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function calcStats(settled) {
  const won = settled.filter(g => g.bet.win === true);
  const totalProfit = settled.reduce((s, g) => s + g.bet.profit, 0);
  const totalStake = settled.reduce((s, g) => s + g.bet.stake, 0);
  const totalExpected = settled.reduce((s, g) => s + g.bet.expectedProfit, 0);

  const best = settled.length
    ? settled.reduce((m, g) => g.bet.profit > m.bet.profit ? g : m)
    : null;
  const worst = settled.length
    ? settled.reduce((m, g) => g.bet.profit < m.bet.profit ? g : m)
    : null;

  const sortedByTime = [...settled].sort((a, b) => {
    const da = a.bet.concludingTime || a.bet.betDate;
    const db = b.bet.concludingTime || b.bet.betDate;
    return da - db;
  });
  let streakCount = 0, streakType = null;
  if (sortedByTime.length) {
    const lastWin = sortedByTime[sortedByTime.length - 1].bet.win;
    streakType = lastWin ? 'W' : 'L';
    for (let i = sortedByTime.length - 1; i >= 0; i--) {
      if (sortedByTime[i].bet.win === lastWin) streakCount++;
      else break;
    }
  }

  const byCountry = {};
  for (const g of settled) {
    const countries = [...new Set(g.bet.countries)];
    if (!countries.length) continue;
    for (const c of countries) {
      byCountry[c] = (byCountry[c] || 0) + g.bet.profit / countries.length;
    }
  }

  return {
    totalProfit,
    totalStake,
    totalExpected,
    winRate: settled.length ? (won.length / settled.length) * 100 : 0,
    wonCount: won.length,
    totalBets: settled.length,
    roi: totalStake ? (totalProfit / totalStake) * 100 : 0,
    edge: totalProfit - totalExpected,
    best,
    worst,
    streakCount,
    streakType,
    countryRanked: Object.entries(byCountry).sort((a, b) => b[1] - a[1])
  };
}

// ── Bankroll series (arb-aware, period-aware) ────────────────────────────────

function buildBankrollSeries(allSettled, periodSettled) {
  if (!allSettled.length) return { labels: [], data: [], expectedData: [] };

  // Compute running actual and expected bankroll (one event per group)
  const initial = allSettled[0].bet.funds - allSettled[0].bet.profit;
  let running = initial, expectedRunning = initial;
  const bankrollById = new Map();
  const expectedById = new Map();
  for (const g of allSettled) {
    running += g.bet.profit;
    expectedRunning += g.bet.expectedProfit;
    bankrollById.set(g.bet.betId, running);
    expectedById.set(g.bet.betId, expectedRunning);
  }

  const isAllTime = periodSettled.length === allSettled.length;

  if (isAllTime) {
    return {
      labels: allSettled.map(g => fmtDate(g.bet.concludingTime || g.bet.betDate)),
      data: allSettled.map(g => bankrollById.get(g.bet.betId)),
      expectedData: allSettled.map(g => expectedById.get(g.bet.betId))
    };
  }

  if (!periodSettled.length) return { labels: [], data: [], expectedData: [] };

  const firstId = periodSettled[0].bet.betId;
  const before = allSettled.filter(g => g.bet.betId < firstId);
  const startBankroll = before.length ? bankrollById.get(before[before.length - 1].bet.betId) : initial;
  const startExpected = before.length ? expectedById.get(before[before.length - 1].bet.betId) : initial;

  const periodIds = new Set(periodSettled.map(g => g.bet.betId));
  const inOrder = allSettled.filter(g => periodIds.has(g.bet.betId));

  return {
    labels: ['Start', ...inOrder.map(g => fmtDate(g.bet.concludingTime || g.bet.betDate))],
    data: [startBankroll, ...inOrder.map(g => bankrollById.get(g.bet.betId))],
    expectedData: [startExpected, ...inOrder.map(g => expectedById.get(g.bet.betId))]
  };
}

// ── Render: KPIs ──────────────────────────────────────────────────────────────

function cmpHtml(curr, prev, fmt) {
  if (prev === null || prev === undefined) return '';
  const delta = curr - prev;
  const arrow = delta >= 0 ? '&#8593;' : '&#8595;';
  return `<span class="kpi-compare ${cls(delta)}">${arrow} ${sign(delta)}${fmt(Math.abs(delta))} vs prev</span>`;
}

function renderKPIs(stats, prevStats, bankroll) {
  const prev = prevStats;

  document.getElementById('kpi-bankroll').innerHTML =
    `<span class="kpi-label">Current Bankroll</span>
     <span class="kpi-value">${fmtKr(bankroll)}</span>`;

  document.getElementById('kpi-pl').innerHTML =
    `<span class="kpi-label">Total P/L</span>
     <span class="kpi-value ${cls(stats.totalProfit)}">${sign(stats.totalProfit)}${fmtKr(stats.totalProfit)}</span>
     ${cmpHtml(stats.totalProfit, prev && prev.totalProfit, fmtKr)}`;

  document.getElementById('kpi-winrate').innerHTML =
    `<span class="kpi-label">Win Rate</span>
     <span class="kpi-value">${stats.winRate.toFixed(1)}%</span>
     <span class="kpi-sub">${stats.wonCount} / ${stats.totalBets} bets</span>
     ${cmpHtml(stats.winRate, prev && prev.winRate, n => n.toFixed(1) + 'pp')}`;

  document.getElementById('kpi-total').innerHTML =
    `<span class="kpi-label">Bets Placed</span>
     <span class="kpi-value">${stats.totalBets}</span>
     ${prev ? cmpHtml(stats.totalBets, prev.totalBets, n => Math.round(n).toString()) : ''}`;

  document.getElementById('kpi-roi').innerHTML =
    `<span class="kpi-label">Overall ROI</span>
     <span class="kpi-value ${cls(stats.roi)}">${sign(stats.roi)}${stats.roi.toFixed(1)}%</span>
     ${cmpHtml(stats.roi, prev && prev.roi, n => n.toFixed(1) + 'pp')}`;

  const best = stats.best;
  let bestDetail = '';
  if (best) {
    const b = best.bet;
    const oddsStr = b.totalOdds ? `@ ${b.totalOdds.toFixed(2)}` : '';
    const biasLine = best.type === 'arb' ? `<br>${arbBias(best.legs)}` : '';
    const placedLine = `Placed ${fmtDate(b.betDate)}`;
    const settledLine = b.concludingTime && fmtDate(b.concludingTime) !== fmtDate(b.betDate)
      ? `<br>Settled ${fmtDate(b.concludingTime)}` : '';
    bestDetail = `<div class="kpi-best-detail">
      ${b.betType}${oddsStr ? ' ' + oddsStr : ''} &middot; Stake ${fmtKr(b.stake)}<br>
      ${b.matchLabel || ''}${biasLine}<br>
      ${placedLine}${settledLine}
    </div>`;
  }
  document.getElementById('kpi-best').innerHTML =
    `<span class="kpi-label">Best Bet</span>
     <span class="kpi-value pos">${best ? '+' + fmtKr(best.bet.profit) : '—'}</span>
     ${bestDetail}`;

  const worst = stats.worst;
  let worstDetail = '';
  if (worst) {
    const b = worst.bet;
    const oddsStr = b.totalOdds ? `@ ${b.totalOdds.toFixed(2)}` : '';
    const placedLine = `Placed ${fmtDate(b.betDate)}`;
    const settledLine = b.concludingTime && fmtDate(b.concludingTime) !== fmtDate(b.betDate)
      ? `<br>Settled ${fmtDate(b.concludingTime)}` : '';
    worstDetail = `<div class="kpi-best-detail">
      ${b.betType}${oddsStr ? ' ' + oddsStr : ''} &middot; Stake ${fmtKr(b.stake)}<br>
      ${b.matchLabel || ''}
      <br>${placedLine}${settledLine}
    </div>`;
  }
  document.getElementById('kpi-worst').innerHTML =
    `<span class="kpi-label">Worst Bet</span>
     <span class="kpi-value neg">${worst ? fmtKr(worst.bet.profit) : '—'}</span>
     ${worstDetail}`;

  const streakCls = stats.streakType === 'W' ? 'pos' : 'neg';
  const streakLabel = stats.streakType === 'W' ? 'Win streak' : 'Losing streak';
  document.getElementById('kpi-streak').innerHTML = stats.streakCount
    ? `<span class="kpi-label">Current Streak</span>
       <span class="kpi-value ${streakCls}">${stats.streakCount}${stats.streakType}</span>
       <span class="kpi-sub">${streakLabel}</span>`
    : `<span class="kpi-label">Current Streak</span><span class="kpi-value">—</span>`;

  document.getElementById('kpi-edge').innerHTML =
    `<span class="kpi-label">Edge vs Expected</span>
     <span class="kpi-value ${cls(stats.edge)}">${sign(stats.edge)}${fmtKr(stats.edge)}</span>
     <span class="kpi-sub">Expected: ${fmtKr(stats.totalExpected)}</span>
     ${cmpHtml(stats.edge, prev && prev.edge, fmtKr)}`;

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

// ── Render: Country table ─────────────────────────────────────────────────────

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

// ── Render: Charts ────────────────────────────────────────────────────────────

let bankrollChart, monthlyChart;

const CHART_FONT = { family: 'Plus Jakarta Sans, system-ui, sans-serif', size: 11 };
const GRID_COLOR = 'rgba(107,101,96,0.15)';
const TICK_COLOR = '#6B6560';

function renderBankrollChart(labels, data, expectedData) {
  const ctx = document.getElementById('bankroll-chart').getContext('2d');
  if (bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual',
          data,
          borderColor: '#B4471F',
          backgroundColor: 'rgba(180,71,31,0.07)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#B4471F',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Expected',
          data: expectedData,
          borderColor: '#6B6560',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: TICK_COLOR, font: CHART_FONT, boxWidth: 24, padding: 12 }
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtKr(ctx.raw)}` } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: TICK_COLOR, font: CHART_FONT, maxRotation: 0 }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TICK_COLOR, font: CHART_FONT, callback: v => fmtKr(v) }, grid: { color: GRID_COLOR } }
      }
    }
  });
}

function renderMonthlyChart(groups) {
  const monthly = {};
  const monthlyCounts = {};
  for (const g of groups) {
    const d = g.bet.concludingTime || g.bet.betDate;
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] || 0) + g.bet.profit;
    monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
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
        callbacks: {
          label: ctx => ' ' + fmtKr(ctx.raw),
          afterLabel: ctx => ` ${monthlyCounts[keys[ctx.dataIndex]]} bet${monthlyCounts[keys[ctx.dataIndex]] !== 1 ? 's' : ''}`
        }
      }},
      scales: {
        x: { ticks: { color: TICK_COLOR, font: CHART_FONT, maxRotation: 0 }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TICK_COLOR, font: CHART_FONT, callback: v => fmtKr(v) }, grid: { color: GRID_COLOR } }
      }
    }
  });
}

// ── Render: Open / Pending bets ───────────────────────────────────────────────

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
        <span>Placed <strong>${fmtDate(b.betDate)}</strong></span>
        <span>Stake <strong>${fmtKr(b.stake)}</strong></span>
        <span>Potential <strong>${fmtKr(b.potentialPayout)}</strong></span>
        ${b.countries.length ? `<span>${b.countries.join(', ')}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Render: Bets table ────────────────────────────────────────────────────────

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

    const isMultiMatch = g.type === 'single' && b.matchNums.length > 1;
    const isExpandable = g.type === 'arb' || isMultiMatch;
    const expandId = g.type === 'arb' ? `arb-${g.arbId}` : `multi-${b.betId}`;

    let matchCell = '';
    let subRows = '';

    if (g.type === 'arb') {
      matchCell = `<td class="match-cell"><span class="expand-indicator">&#9658;</span> ${g.legs.length} legs</td>`;
      subRows = g.legs.map(leg => {
        const m = leg.matchNums.map(n => allMatchMap[n]).filter(Boolean);
        const matchName = m.length ? m.map(x => `${x.home} vs ${x.away}`).join(', ') : leg.matchNums.join(', ');
        const country = m.length ? m.map(x => x.country).filter(Boolean).join(', ') : leg.countries.join(', ');
        const legResult = leg.win === true ? '<span class="tag tag-win">Win</span>' : leg.win === false ? '<span class="tag tag-loss">Loss</span>' : '<span class="tag tag-open">—</span>';
        return `<tr class="sub-row" data-expand-leg="${expandId}" style="display:none">
          <td>${fmtDate(leg.betDate)}</td>
          <td>${fmtDate(leg.concludingTime) || '—'}</td>
          <td class="sub-row-indent" colspan="2">&#8627; ${matchName} &middot; <em>${leg.selection}</em></td>
          <td>${country}</td>
          <td>${fmtKr(leg.stake)}</td>
          <td>${leg.totalOdds.toFixed(2)}</td>
          <td><span class="${cls(leg.profit)}">${sign(leg.profit)}${fmtKr(leg.profit)}</span></td>
          <td></td>
          <td>${legResult}</td>
        </tr>`;
      }).join('');
    } else if (isMultiMatch) {
      matchCell = `<td class="match-cell"><span class="expand-indicator">&#9658;</span> ${b.matchNums.length} matches</td>`;
      subRows = b.matchNums.map(n => {
        const m = allMatchMap[n];
        const matchName = m ? `${m.home} vs ${m.away}` : `Match ${n}`;
        const league = m ? m.league || '' : '';
        const country = m ? m.country || '' : '';
        return `<tr class="sub-row" data-expand-leg="${expandId}" style="display:none">
          <td colspan="2"></td>
          <td class="sub-row-indent" colspan="2">&#8627; ${matchName}${league ? ` &middot; <em>${league}</em>` : ''}</td>
          <td>${country}</td>
          <td colspan="5"></td>
        </tr>`;
      }).join('');
    } else {
      matchCell = `<td class="match-cell">${b.matchLabel || '—'}</td>`;
    }

    const rowCls = ['bet-row', g.type === 'arb' ? 'arb-row' : '', isExpandable ? 'expandable-row' : ''].filter(Boolean).join(' ');

    return `<tr class="${rowCls}"${isExpandable ? ` data-expand-id="${expandId}" aria-expanded="false"` : ''}>
      <td>${fmtDate(b.betDate)}</td>
      <td>${b.concludingTime ? fmtDate(b.concludingTime) : '—'}</td>
      <td><span class="type-tag">${b.betType}</span></td>
      ${matchCell}
      <td>${b.countries.slice(0, 2).join(', ') || '—'}</td>
      <td>${fmtKr(b.stake)}</td>
      <td>${oddsCell}</td>
      <td>${profitCell}</td>
      <td>${roiCell}</td>
      <td>${resultHtml}</td>
    </tr>${subRows}`;
  }).join('');

  document.querySelectorAll('.expandable-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.expandId;
      const legs = document.querySelectorAll(`[data-expand-leg="${id}"]`);
      const expanded = row.getAttribute('aria-expanded') === 'true';
      legs.forEach(l => { l.style.display = expanded ? 'none' : ''; });
      row.setAttribute('aria-expanded', String(!expanded));
      const indicator = row.querySelector('.expand-indicator');
      if (indicator) indicator.innerHTML = expanded ? '&#9658;' : '&#9660;';
    });
  });
}

// ── Main render pass ──────────────────────────────────────────────────────────

function renderAll(period) {
  const range = getPeriodRange(period);
  const allSettled = allGroups.filter(g => g.bet.win !== null).sort((a, b) => a.bet.betId - b.bet.betId);

  const periodSettled = range ? filterByRange(allSettled, range.start, range.end) : allSettled;
  const prevSettled = range ? filterByRange(allSettled, range.prevStart, range.prevEnd) : [];

  const stats = calcStats(periodSettled);
  const prevStats = prevSettled.length ? calcStats(prevSettled) : null;

  // Bankroll is always the current all-time value regardless of period
  const lastBet = [...allBets].sort((a, b) => a.betId - b.betId).filter(b => b.win !== null).pop();
  const bankroll = lastBet ? lastBet.funds : 0;

  renderKPIs(stats, prevStats, bankroll);
  renderCountryTable(stats.countryRanked);

  const { labels, data, expectedData } = buildBankrollSeries(allSettled, periodSettled);
  renderBankrollChart(labels, data, expectedData);
  renderMonthlyChart(periodSettled);

  // Bets table: settled within period + all open/pending, most recent first
  const openPending = allGroups.filter(g => g.bet.win === null);
  const openPendingInPeriod = range
    ? openPending.filter(g => { const d = g.bet.betDate; return d && d >= range.start && d <= range.end; })
    : openPending;
  const tableGroups = [...periodSettled, ...openPendingInPeriod].reverse();
  renderBetsTable(tableGroups);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  const errorEl = document.getElementById('error-state');

  try {
    const { bets, matchMap } = await loadData();
    allBets = bets;
    allMatchMap = matchMap;
    allGroups = groupBets(bets, matchMap);

    const open = allGroups.filter(g => !g.bet.isFinished && g.bet.win === null);
    const pending = allGroups.filter(g => g.bet.isFinished && g.bet.win === null);

    renderOpenBets(open, pending);
    renderAll('6m');

    document.getElementById('last-updated').textContent =
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    // Period filter buttons
    document.getElementById('period-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.period-btn');
      if (!btn) return;
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      renderAll(currentPeriod);
    });

  } catch (err) {
    console.error(err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.querySelector('.error-msg').textContent = err.message;
  }
}

document.addEventListener('DOMContentLoaded', init);
