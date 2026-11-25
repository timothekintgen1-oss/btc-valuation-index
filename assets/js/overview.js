// Overview tab: gauge, zones, model comparison, composite risk chart + navigator,
// price and Z charts, indicator heatmap — all synced to one visible range.
import * as C from './core.js';
import { $, $$, TOUCH, GRID, BORDER, TIP, fitAxis, logTick, xTicks, lastValid, store } from './ui.js';

let ctx, charts = [], riskChart = null, VIEW = null, heat = null, nav = null;

const SHORT = { mvrv_z: 'MVRV Z', aviv: 'AVIV', thermocap: 'Thermocap', nupl: 'NUPL', rhodl: 'RHODL', price_tools: 'CVDD/TP',
  sth_sopr: 'STH-SOPR', cbpl: 'CBPL', onchain_risk: 'On-chain', rpl_sharpe: 'RPL Sharpe', power_law: 'Power Law',
  sharpe_52w: 'Sharpe 52W', rsi_monthly: 'RSI 1M', days_higher: 'Days High', beam: 'BEAM', rainbow: 'Rainbow',
  raqqr: 'RAQQR', fear_greed: 'F&G' };
const KEY_DATES = [['2017-12-17', 'Top Dec 2017'], ['2018-12-15', 'Low Dec 2018'], ['2020-03-12', 'Covid crash'],
  ['2021-11-10', 'Top Nov 2021'], ['2022-11-21', 'Low Nov 2022'], ['2024-03-14', 'High Mar 2024'], ['2025-10-06', 'Top Oct 2025']];

export default {
  init(c) { ctx = c; wire(); build(); },
  update(c) { ctx = c; build(); },
  show() { charts.forEach(ch => ch.resize()); heat && heat.draw(); nav && nav.draw(); },
};

// ── static wiring (once) ──
function wire() {
  $$('#zbtns button').forEach(b => b.addEventListener('click', () => {
    const d = +b.dataset.d, N = ctx.N;
    $$('#zbtns button').forEach(x => x.classList.toggle('on', x === b));
    if (!d) applyRange(null, null, null); else applyRange(Math.max(0, N - d), N - 1, null);
  }));
  $('#zhint').textContent = TOUCH ? 'Pinch to zoom · drag to pan · tap a preset to jump'
    : 'Drag to zoom · Shift+drag to pan · Ctrl/pinch+scroll to zoom · double-click to reset';
  const ov = store.get('overlays', { sdca: true, causal: false, z: false });
  for (const [id, key, ds] of [['ovSdca', 'sdca', 3], ['ovCausal', 'causal', 4], ['showZ', 'z', 2]]) {
    const el = $('#' + id);
    el.checked = !!ov[key];
    el.addEventListener('change', () => {
      ov[key] = el.checked; store.set('overlays', ov);
      if (riskChart) { riskChart.setDatasetVisibility(ds, el.checked); riskChart.update('none'); }
    });
  }
  addEventListener('resize', () => setTimeout(() => { heat && heat.draw(); nav && nav.draw(); }, 150));
}
const resetView = () => $('#zbtns button[data-d="0"]').click();

// ── range sync ──
function applyRange(min, max, src) {
  const N = ctx.N, full = min == null;
  charts.forEach(c => { if (c === src) return; c.options.scales.x.min = full ? undefined : min; c.options.scales.x.max = full ? undefined : max; c.update('none'); });
  const a = full ? 0 : Math.max(0, Math.round(min)), b = full ? N - 1 : Math.min(N - 1, Math.round(max));
  VIEW = { a, b };
  heat && heat.draw(); nav && nav.draw();
  $('#zrange').textContent = ctx.D.dates[a] + ' → ' + ctx.D.dates[b] + ' · ' + (b - a + 1).toLocaleString() + ' days';
}
function syncFrom(chart) {
  const { min, max } = chart.scales.x;
  chart.options.scales.x.min = min; chart.options.scales.x.max = max;
  applyRange(min, max, chart);
  $$('#zbtns button').forEach(b => b.classList.remove('on'));
}

function build() {
  const { D, N } = ctx, L = D.dates, P = D.price, S = ctx.sig, Z = S.bvi.z, R = S.bvi.risk;
  charts.forEach(c => c.destroy()); charts = [];
  const last = lastValid(Z), cz = Z[last], sg = C.signal(cz);

  // gauge, zones, distribution stats
  gauge(Z, last);
  const badge = $('#badge');
  badge.textContent = sg.label; badge.style.borderColor = sg.color; badge.style.color = sg.color;
  $('#ztbl').innerHTML = C.ZONES.map(z => `<div class="zrow"><i style="background:${z.color}"></i><span>${z.name}</span><span>${z.range}</span></div>`).join('');
  const allZ = Z.filter(v => v != null), mean = allZ.reduce((a, b) => a + b, 0) / allZ.length;
  const sd = Math.sqrt(allZ.reduce((a, b) => a + (b - mean) ** 2, 0) / allZ.length);
  const maxZ = Math.max(...allZ), minZ = Math.min(...allZ);
  const pctAbove = Math.round(allZ.filter(v => v > cz).length / allZ.length * 100);
  $('#stbl').innerHTML = [['Mean', mean.toFixed(2)], ['Std Dev', sd.toFixed(2)], ['Min Z', `${minZ.toFixed(2)} (${L[Z.indexOf(minZ)]})`],
    ['Max Z (peak)', `${maxZ.toFixed(2)} (${L[Z.indexOf(maxZ)]})`], ['Current', cz.toFixed(2)], ['Readings above current', pctAbove + '%'],
    ['N Obs', N.toLocaleString()]].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('');

  models(last);

  // shared chart options
  const zoomOpt = {
    limits: { x: { min: 0, max: N - 1, minRange: 14 } },
    zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true },
      drag: { enabled: !TOUCH, backgroundColor: 'rgba(0,212,255,0.08)', borderColor: 'rgba(0,212,255,0.5)', borderWidth: 1 },
      mode: 'x', onZoomComplete: ({ chart }) => syncFrom(chart) },
    pan: { enabled: true, mode: 'x', modifierKey: TOUCH ? null : 'shift', onPanComplete: ({ chart }) => syncFrom(chart) },
  };
  const ptR = c => { const s = c.chart.scales.x; return s && s.max - s.min <= 120 ? 2 : 0; };
  const zC = Z.map(z => C.zColor(z ?? 0, 0.9)), rC = R.map(r => C.riskColor(r ?? 50, 1));
  const base = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false } };

  // composite risk chart (+ model overlays)
  const ov = store.get('overlays', { sdca: true, causal: false, z: false });
  const rBands = { id: 'rBands', beforeDatasetsDraw(ch) {
    const { ctx: c, chartArea: { left: l, right: r }, scales: { yr } } = ch;
    [[0, 25, 'rgba(0,150,136,0.20)'], [25, 50, 'rgba(56,142,60,0.13)'], [50, 75, 'rgba(255,160,0,0.08)'], [75, 100, 'rgba(229,57,53,0.15)']]
      .forEach(([lo, hi, col]) => { c.fillStyle = col; const top = yr.getPixelForValue(hi), bot = yr.getPixelForValue(lo); c.fillRect(l, top, r - l, bot - top); });
    c.save(); c.strokeStyle = 'rgba(200,212,232,0.25)'; c.setLineDash([4, 4]); c.lineWidth = 1;
    [25, 50, 75].forEach(v => { const y = yr.getPixelForValue(v); c.beginPath(); c.moveTo(l, y); c.lineTo(r, y); c.stroke(); });
    c.restore();
  } };
  const lr = lastValid(R), ls = lastValid(S.sdca.risk);
  $('#rnow').innerHTML = `${L[lr]}<br><b style="color:${C.riskColor(R[lr])}">${R[lr].toFixed(1)}%</b> · ${C.riskZone(R[lr]).label}`
    + (ls >= 0 ? `<br><span style="color:${C.SIGNALS.sdca.color}">SDCA model ${S.sdca.risk[ls].toFixed(1)}% · ${C.riskZone(S.sdca.risk[ls]).label}</span>` : '');
  riskChart = new Chart($('#riskChart'), { type: 'line', plugins: [rBands],
    data: { labels: L, datasets: [
      { label: 'BVI risk', data: R, yAxisID: 'yr', borderWidth: 2, pointRadius: ptR, pointHoverRadius: 4, pointBorderWidth: 0, pointBackgroundColor: c => rC[c.dataIndex], tension: 0, segment: { borderColor: c => rC[c.p0DataIndex] } },
      { label: 'Price', data: P, yAxisID: 'yp', borderColor: 'rgba(235,240,250,0.85)', borderWidth: 1.2, pointRadius: 0, tension: 0 },
      { label: 'Z', data: Z, yAxisID: 'yz', borderColor: 'rgba(68,138,255,0.55)', borderWidth: 1, pointRadius: 0, tension: 0, hidden: !ov.z },
      { label: 'SDCA model', data: S.sdca.risk, yAxisID: 'yr', borderColor: C.SIGNALS.sdca.color, borderWidth: 1.3, pointRadius: 0, tension: 0, hidden: !ov.sdca },
      { label: 'Causal twin', data: S.causal.risk, yAxisID: 'yr', borderColor: C.SIGNALS.causal.color, borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, tension: 0, hidden: !ov.causal },
    ] },
    options: { ...base,
      plugins: { legend: { display: false }, zoom: zoomOpt, tooltip: { ...TIP, filter: i => i.datasetIndex === 0, callbacks: {
        title: i => i[0].label,
        label: i => {
          const k = i.dataIndex, r = R[k], ch = i.chart, out = ['  BVI risk:   ' + (r == null ? 'n/a' : r.toFixed(1) + '% · ' + C.riskZone(r).label)];
          if (ch.isDatasetVisible(3) && S.sdca.risk[k] != null) out.push('  SDCA model: ' + S.sdca.risk[k].toFixed(1) + '% · ' + C.riskZone(S.sdca.risk[k]).label);
          if (ch.isDatasetVisible(4) && S.causal.risk[k] != null) out.push('  Causal:     ' + S.causal.risk[k].toFixed(1) + '%');
          out.push('  Price:      ' + C.fmtUsd(P[k]), '  BVI Z:      ' + (Z[k] == null ? 'n/a' : Z[k].toFixed(2)));
          return out;
        },
        labelColor: i => ({ borderColor: 'transparent', backgroundColor: rC[i.dataIndex] }) } } },
      scales: { x: { grid: GRID, border: BORDER, ticks: xTicks(L) },
        yp: { type: 'logarithmic', position: 'left', grid: { display: false }, border: BORDER, afterFit: fitAxis, ticks: { color: '#4a5a78', callback: logTick } },
        yr: { position: 'right', min: 0, max: 100, grid: { display: false }, border: BORDER, afterFit: s => { s.width = 40; }, ticks: { stepSize: 25, color: '#4a5a78', callback: v => v + '%' } },
        yz: { display: false, min: -3.5, max: 3.5 } } } });

  // price chart coloured by Z
  const priceChart = new Chart($('#priceChart'), { type: 'line',
    data: { labels: L, datasets: [{ data: P, borderWidth: 1.5, pointRadius: ptR, pointHoverRadius: 4, pointBorderWidth: 0, pointBackgroundColor: c => zC[c.dataIndex], tension: 0, segment: { borderColor: c => zC[c.p0DataIndex] } }] },
    options: { ...base, plugins: { legend: { display: false }, zoom: zoomOpt, tooltip: { ...TIP, callbacks: { title: i => i[0].label,
      label: i => { const k = i.dataIndex; return ['  Price:   ' + C.fmtUsd(P[k]), '  Z-Score: ' + (Z[k] == null ? 'n/a' : Z[k].toFixed(2)), '  Signal:  ' + (Z[k] == null ? 'n/a' : C.signal(Z[k]).label)]; },
      labelColor: i => ({ borderColor: 'transparent', backgroundColor: zC[i.dataIndex] }) } } },
    scales: { x: { grid: GRID, border: BORDER, ticks: xTicks(L) }, y: { type: 'logarithmic', grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#2a3a58', callback: logTick } } } } });

  // Z chart with zone bands
  const zBands = { id: 'zBands', beforeDraw(ch) {
    const { ctx: c, chartArea: { left: l, right: r }, scales: { y } } = ch;
    [[-10, -2, 'rgba(0,245,255,0.05)'], [-2, -1, 'rgba(68,138,255,0.06)'], [-1, 1, 'rgba(105,240,174,0.04)'], [1, 2, 'rgba(255,235,59,0.06)'], [2, 3, 'rgba(255,109,0,0.07)'], [3, 10, 'rgba(244,67,54,0.09)']]
      .forEach(([lo, hi, col]) => { if (hi <= y.min || lo >= y.max) return; c.fillStyle = col; const top = y.getPixelForValue(Math.min(hi, y.max)), bot = y.getPixelForValue(Math.max(lo, y.min)); c.fillRect(l, top, r - l, bot - top); });
    if (0 > y.min && 0 < y.max) { const y0 = y.getPixelForValue(0); c.save(); c.strokeStyle = 'rgba(105,240,174,0.18)'; c.lineWidth = 1; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(l, y0); c.lineTo(r, y0); c.stroke(); c.restore(); }
  } };
  const grad = (c, a, b) => { const g = c.chart.ctx.createLinearGradient(0, c.chart.chartArea.top, 0, c.chart.chartArea.bottom); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const zChart = new Chart($('#zChart'), { type: 'line', plugins: [zBands],
    data: { labels: L, datasets: [{ data: Z, borderWidth: 1.5, pointRadius: ptR, pointHoverRadius: 4, pointBorderWidth: 0, pointBackgroundColor: c => zC[c.dataIndex], tension: 0, spanGaps: true, segment: { borderColor: c => zC[c.p0DataIndex] },
      fill: { target: 'origin', above: c => grad(c, 'rgba(255,109,0,0.18)', 'rgba(255,109,0,0)'), below: c => grad(c, 'rgba(0,212,255,0)', 'rgba(0,212,255,0.14)') } }] },
    options: { ...base, plugins: { legend: { display: false }, zoom: zoomOpt, tooltip: { ...TIP, callbacks: { title: i => i[0].label,
      label: i => i.raw == null ? null : ['  Z-Score: ' + i.raw.toFixed(2), '  Signal:  ' + C.signal(i.raw).label],
      labelColor: i => ({ borderColor: 'transparent', backgroundColor: zC[i.dataIndex] }) } } },
    scales: { x: { grid: GRID, border: BORDER, ticks: xTicks(L) }, y: { grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#2a3a58', callback: v => v.toFixed(1) } } } } });

  charts = [priceChart, zChart, riskChart];
  charts.forEach(c => { c.canvas.style.touchAction = 'pan-y'; c.canvas.ondblclick = resetView; });
  nav = navigator(R, rC);
  heat = heatmap(Z);
  if (VIEW && (VIEW.a > 0 || VIEW.b < N - 1)) applyRange(VIEW.a, VIEW.b, null); else applyRange(null, null, null);
}

// ── model comparison ──
function models(lastBvi) {
  const { D } = ctx, S = ctx.sig, L = D.dates;
  const box = (key, risk, z, i) => {
    const s = C.SIGNALS[key], r = risk[i];
    return `<div class="model" style="--mc:${s.color}"><div class="mn">${s.name}${s.hindsight ? '<span class="badge b-hs" title="Backtests of this model use data from after each date">HINDSIGHT</span>' : ''}</div>
      <div class="mv" style="color:${C.riskColor(r)}">${r == null ? '—' : r.toFixed(1) + '%'}</div>
      <div class="mz">${r == null ? '' : C.riskZone(r).label}${z ? ' · Z ' + C.fmtSigned(z[i]) : ''} · ${L[i]}</div></div>`;
  };
  const li = k => lastValid(S[k].risk);
  $('#modelBoxes').innerHTML = box('bvi', S.bvi.risk, S.bvi.z, lastBvi) + box('sdca', S.sdca.risk, S.sdca.z, li('sdca'))
    + box('causal', S.causal.risk, S.causal.z, li('causal')) + box('consensus', S.consensus.risk, null, li('consensus'));
  const cell = r => r == null ? '<td>—</td>' : `<td style="color:${C.riskColor(r)}">${r.toFixed(0)}%</td>`;
  const rows = [...KEY_DATES, [L[li('sdca')], 'Latest']].map(([d, name]) => {
    const i = L.indexOf(d);
    if (i < 0) return '';
    return `<tr${name === 'Latest' ? ' class="hl"' : ''}><td>${name}</td><td>${d}</td><td>${C.fmtUsd(D.price[i])}</td>${cell(S.bvi.risk[i])}${cell(S.sdca.risk[i])}${cell(S.causal.risk[i])}${cell(S.consensus.risk[i])}</tr>`;
  }).join('');
  $('#modelTable').innerHTML = `<tr><th>Moment</th><th>Date</th><th>BTC</th><th>BVI</th><th>SDCA</th><th>Causal</th><th>Consensus</th></tr>${rows}`;
}

// ── gauge (same drawing as before) ──
function gauge(Z, last) {
  const L = ctx.D.dates, cz = Z[last];
  const svg = $('#gauge'), cx = 142, cy = 155, r = 108, sw = 240, sd = -210, zMin = -3, zMax = 5.5, toR = d => d * Math.PI / 180;
  const pt = (d, ra) => ({ x: cx + ra * Math.cos(toR(d)), y: cy + ra * Math.sin(toR(d)) });
  const hx = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const cs = [{ t: 0, c: '#00f5ff' }, { t: .2, c: '#448aff' }, { t: .42, c: '#69f0ae' }, { t: .58, c: '#ffeb3b' }, { t: .75, c: '#ff6d00' }, { t: 1, c: '#f44336' }];
  const lerp = t => { for (let i = 0; i < cs.length - 1; i++) if (t >= cs[i].t && t <= cs[i + 1].t) { const tt = (t - cs[i].t) / (cs[i + 1].t - cs[i].t), a = hx(cs[i].c), b = hx(cs[i + 1].c); return `rgb(${a.map((v, k) => Math.round(v + tt * (b[k] - v))).join(',')})`; } return cs[5].c; };
  const zToDeg = z => sd + Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin))) * sw;
  const bs = pt(sd, r), be = pt(sd + sw, r);
  let h = `<path d="M${bs.x},${bs.y} A${r},${r} 0 1 1 ${be.x},${be.y}" fill="none" stroke="#131e32" stroke-width="14"/>`;
  for (let i = 0; i < 100; i++) { const p1 = pt(sd + i / 100 * sw, r), p2 = pt(sd + (i + 1) / 100 * sw, r); h += `<path d="M${p1.x},${p1.y} A${r},${r} 0 0 1 ${p2.x},${p2.y}" fill="none" stroke="${lerp((i + .5) / 100)}" stroke-width="12" opacity=".88"/>`; }
  [-2, -1, 0, 1, 2, 3].forEach(v => { const d = zToDeg(v), a = pt(d, r - 20), o = pt(d, r + 4); h += `<line x1="${a.x}" y1="${a.y}" x2="${o.x}" y2="${o.y}" stroke="#243355" stroke-width="1.5"/>`; });
  let eL = cz, eD = L[last];
  for (let i = last; i >= Math.max(0, last - 365); i--) if (Z[i] != null && Z[i] < eL) { eL = Z[i]; eD = L[i]; }
  const dot = pt(zToDeg(eL), r);
  h += `<rect x="4" y="4" width="116" height="52" rx="1" fill="#060c18" stroke="#00f5ff" stroke-width=".9" opacity=".95"/><text x="10" y="18" font-family="Space Mono,monospace" font-size="7" fill="#00f5ff" letter-spacing="1">RECENT EXTREME LOW</text><text x="10" y="34" font-family="Orbitron,monospace" font-size="13" font-weight="700" fill="#00f5ff">Z = ${eL.toFixed(2)}</text><text x="10" y="48" font-family="Space Mono,monospace" font-size="7" fill="#2a4a6a">${eD}</text><line x1="44" y1="56" x2="${dot.x.toFixed(1)}" y2="${dot.y.toFixed(1)}" stroke="#00f5ff" stroke-width=".9" stroke-dasharray="3,2.5" opacity=".7"/><circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="4" fill="#00f5ff" opacity=".9"/><circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="8" fill="none" stroke="#00f5ff" stroke-width="1" opacity=".3"/>`;
  const nR = toR(zToDeg(cz)), tip = { x: cx + 90 * Math.cos(nR), y: cy + 90 * Math.sin(nR) }, pp = nR + Math.PI / 2, nc = C.zColor(cz);
  const bl = { x: cx + 4 * Math.cos(pp), y: cy + 4 * Math.sin(pp) }, br = { x: cx - 4 * Math.cos(pp), y: cy - 4 * Math.sin(pp) };
  h += `<polygon points="${tip.x},${tip.y} ${bl.x},${bl.y} ${br.x},${br.y}" fill="${nc}" opacity=".95"/><circle cx="${cx}" cy="${cy}" r="9" fill="#0b1424" stroke="${nc}" stroke-width="2.5"/><text x="${cx}" y="${cy - 22}" font-family="Orbitron,monospace" font-size="28" font-weight="700" fill="${nc}" text-anchor="middle">${cz.toFixed(2)}</text><text x="${cx}" y="${cy - 6}" font-family="Space Mono,monospace" font-size="8" fill="#4a5a78" text-anchor="middle" letter-spacing="2">Z-SCORE</text><text x="18" y="${cy + 8}" font-family="Space Mono,monospace" font-size="8" fill="#00f5ff" text-anchor="middle">−3</text><text x="266" y="${cy + 8}" font-family="Space Mono,monospace" font-size="8" fill="#f44336" text-anchor="middle">+5.5</text>`;
  svg.innerHTML = h;
}

// ── navigator: full history; drag to select, drag the window to move it, drag its edges to resize ──
function navigator(R, rC) {
  const { N } = ctx, P = ctx.D.price, cv = $('#navCanvas'), g = cv.getContext('2d'), H = 46;
  const geo = () => { const ca = riskChart.chartArea; return { l: ca.left, r: ca.right }; };
  const xOf = i => { const { l, r } = geo(); return l + i / (N - 1) * (r - l); };
  const iOf = x => { const { l, r } = geo(); return Math.round(Math.min(1, Math.max(0, (x - l) / (r - l))) * (N - 1)); };
  const lp = Math.log(Math.min(...P)), hp = Math.log(Math.max(...P));
  function draw() {
    if (!VIEW || !cv.clientWidth) return;
    const W = cv.clientWidth, dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const { l, r } = geo(); g.fillStyle = '#0d1830'; g.fillRect(l, 0, r - l, H);
    const step = Math.max(1, Math.floor(N / (r - l)));
    g.lineWidth = 1; g.strokeStyle = 'rgba(235,240,250,0.45)'; g.beginPath();
    for (let i = 0; i < N; i += step) { const x = xOf(i), y = H - 3 - (Math.log(P[i]) - lp) / (hp - lp) * (H - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    for (let i = step; i < N; i += step) { if (R[i] == null || R[i - step] == null) continue; g.strokeStyle = rC[i]; g.beginPath(); g.moveTo(xOf(i - step), H - 3 - R[i - step] / 100 * (H - 6)); g.lineTo(xOf(i), H - 3 - R[i] / 100 * (H - 6)); g.stroke(); }
    const a = xOf(VIEW.a), b = xOf(VIEW.b);
    g.fillStyle = 'rgba(6,12,24,0.6)'; g.fillRect(l, 0, a - l, H); g.fillRect(b, 0, r - b, H);
    g.strokeStyle = '#00d4ff'; g.strokeRect(a + .5, .5, b - a, H - 1);
    g.fillStyle = '#00d4ff'; g.fillRect(a - 2, H / 2 - 8, 4, 16); g.fillRect(b - 2, H / 2 - 8, 4, 16);
  }
  let drag = null, raf = 0, pending = null;
  const flush = () => { cancelAnimationFrame(raf); if (!pending) return; const [a, b] = pending; pending = null; applyRange(a, b, null); $$('#zbtns button').forEach(x => x.classList.remove('on')); };
  const push = (a, b) => { a = Math.max(0, a); b = Math.min(N - 1, b); if (b - a < 14) return; pending = [a, b]; cancelAnimationFrame(raf); raf = requestAnimationFrame(flush); };
  cv.onpointerdown = e => {
    const x = e.clientX - cv.getBoundingClientRect().left, a = xOf(VIEW.a), b = xOf(VIEW.b);
    const full = VIEW.b - VIEW.a >= (N - 1) * 0.95;   // whole history shown: a drag draws a new window
    drag = !full && Math.abs(x - a) < 8 ? { m: 'l' } : !full && Math.abs(x - b) < 8 ? { m: 'r' } : !full && x > a && x < b ? { m: 'move', x0: x, a: VIEW.a, b: VIEW.b } : { m: 'new', x0: x };
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
  };
  cv.onpointermove = e => {
    const x = e.clientX - cv.getBoundingClientRect().left, a = xOf(VIEW.a), b = xOf(VIEW.b);
    cv.style.cursor = Math.abs(x - a) < 8 || Math.abs(x - b) < 8 ? 'ew-resize' : (x > a && x < b) ? 'grab' : 'crosshair';
    if (!drag) return;
    if (drag.m === 'l') push(Math.min(iOf(x), VIEW.b - 14), VIEW.b);
    else if (drag.m === 'r') push(VIEW.a, Math.max(iOf(x), VIEW.a + 14));
    else if (drag.m === 'move') { const d = iOf(x) - iOf(drag.x0), w = drag.b - drag.a, na = Math.min(Math.max(0, drag.a + d), N - 1 - w); push(na, na + w); }
    else push(Math.min(iOf(x), iOf(drag.x0)), Math.max(iOf(x), iOf(drag.x0)));
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; flush(); };
  cv.ondblclick = resetView;
  return { draw };
}

// ── heatmap: composite, models and every indicator, one column per pixel of the visible range ──
function heatmap(Z) {
  const { D } = ctx, L = D.dates, sel = new Set(ctx.sel);
  const stale = (key, i) => { const a = D.asof && D.asof[key]; return a && L[i] > a ? a : null; };
  const RH = innerWidth < 600 ? 11 : 13, GAP = 6;
  const rows = [{ label: 'BVI', full: 'BVI composite Z-score', z: Z, bold: true },
    { label: 'SDCA MODEL', full: 'SDCA model Z (±3, sign: + = expensive)', z: ctx.sig.sdca.z, bold: true, color: C.SIGNALS.sdca.color }];
  for (const c of ['fundamental', 'technical', 'sentiment']) {
    rows.push({ gap: true });
    D.indicators.filter(x => x.category === c).forEach(x => rows.push({ key: x.key, label: SHORT[x.key] || x.label,
      full: x.label + ' · ' + c + (sel.has(x.key) ? '' : ' · not in the composite'), z: D.indicator_z[x.key], off: !sel.has(x.key) }));
  }
  let y = 0; rows.forEach(r => { r.y = y; y += r.gap ? GAP : RH; });
  const H = y, wrap = $('#heat'), cv = $('#heatCanvas'), g = cv.getContext('2d'), tip = $('#htip');
  let sel2 = null;
  const area = () => { const ca = charts[0].chartArea; return { l: ca.left, r: ca.right }; };
  const idxAt = x => { const { l, r } = area(); return VIEW.a + Math.floor((x - l) / (r - l) * (VIEW.b - VIEW.a + 1)); };
  function draw() {
    if (!VIEW || !wrap.clientWidth) return;
    const W = wrap.clientWidth, dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const { l, r } = area(), pw = Math.max(1, Math.round(r - l)), span = VIEW.b - VIEW.a + 1;
    g.font = "8px 'Space Mono',monospace"; g.textBaseline = 'middle'; g.textAlign = 'right';
    for (const row of rows) {
      if (row.gap) continue;
      g.fillStyle = row.color || (row.bold ? '#c8d4e8' : row.off ? '#3a4a68' : '#6a7a98');
      g.fillText(row.label, l - 8, row.y + RH / 2);
      g.fillStyle = '#0d1830'; g.fillRect(l, row.y, pw, RH - 1);
      const cols = Math.min(pw, span);
      for (let c = 0; c < cols; c++) {
        const i0 = VIEW.a + Math.floor(c * span / cols), i1 = VIEW.a + Math.floor((c + 1) * span / cols);
        let s = 0, n = 0;
        for (let i = i0; i < i1; i++) { const v = row.z[i]; if (v != null) { s += v; n++; } }
        if (!n) continue;
        const x0 = l + c * pw / cols, x1 = l + (c + 1) * pw / cols;
        g.fillStyle = C.zColor(s / n, row.off ? 0.3 : row.key && stale(row.key, i1 - 1) ? 0.35 : 1);
        g.fillRect(Math.floor(x0), row.y, Math.ceil(x1) - Math.floor(x0), RH - 1);
      }
    }
    if (sel2) { g.fillStyle = 'rgba(0,212,255,0.12)'; g.strokeStyle = 'rgba(0,212,255,0.6)'; const x = Math.min(sel2.x0, sel2.x1), w = Math.abs(sel2.x1 - sel2.x0); g.fillRect(x, 0, w, H); g.strokeRect(x + .5, .5, w, H - 1); }
  }
  function hover(e) {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, yy = e.clientY - b.top, { l, r } = area();
    const row = rows.find(o => !o.gap && yy >= o.y && yy < o.y + RH);
    if (!row || x < l || x > r) { tip.style.display = 'none'; return; }
    const i = Math.min(VIEW.b, Math.max(VIEW.a, idxAt(x))), v = row.z[i], old = row.key && stale(row.key, i);
    tip.innerHTML = `<b>${L[i]}</b><br>${row.full}<br>Z-Score: <b style="color:${v == null ? '#6a7a98' : C.zColor(v)}">${v == null ? 'n/a' : v.toFixed(2)}</b>`
      + (v == null ? '' : `<br>Signal: ${C.signal(v).label}<br>SDCA: ${C.fmtSigned(-v)} · ${C.sdcaLabel(-v)}`)
      + (old ? `<br><span style="color:#f5a623">Carried forward from ${old}</span>` : '');
    tip.style.display = 'block';
    const tw = tip.offsetWidth; tip.style.left = (x + 14 + tw > b.width ? x - 14 - tw : x + 14) + 'px'; tip.style.top = Math.max(0, yy - 20) + 'px';
  }
  cv.onmousemove = e => { hover(e); if (sel2) { sel2.x1 = e.clientX - cv.getBoundingClientRect().left; draw(); } };
  cv.onmouseleave = () => { tip.style.display = 'none'; };
  cv.onmousedown = e => { const x = e.clientX - cv.getBoundingClientRect().left; sel2 = { x0: x, x1: x }; };
  heatUp = () => {
    if (!sel2) return;
    const { l, r } = area(), x0 = Math.max(l, Math.min(sel2.x0, sel2.x1)), x1 = Math.min(r, Math.max(sel2.x0, sel2.x1)); sel2 = null;
    if (x1 - x0 < 4) { draw(); return; }
    const a = idxAt(x0), b = Math.min(ctx.N - 1, Math.max(a + 13, idxAt(x1)));
    applyRange(a, b, null);
    $$('#zbtns button').forEach(x => x.classList.remove('on'));
  };
  cv.ondblclick = resetView;
  cv.onclick = e => { if (TOUCH) hover(e); };
  return { draw };
}
let heatUp = null;
document.addEventListener('mouseup', () => heatUp && heatUp());
