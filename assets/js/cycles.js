// Cycles tab: every halving cycle aligned on its halving day — price multiple,
// valuation and drawdown at the same point of the cycle.
import * as C from './core.js';
import { $, $$, GRID, BORDER, TIP, fitAxis, store, logTicks } from './ui.js';

let ctx, top = null, bottom = null;
const COLORS = ['#5a6a8a', '#448aff', '#b2ff59', '#f5a623'];
const MODES = {
  z: { name: 'BVI Z-score', get: c => c.sig.bvi.z, fmt: v => v.toFixed(2) },
  sdca: { name: 'SDCA model risk', get: c => c.sig.sdca.risk, fmt: v => v.toFixed(0) + '%' },
  dd: { name: 'Drawdown from cycle high', get: null, fmt: v => v.toFixed(0) + '%' },
};

export default {
  init(c) { ctx = c; $$('#cyMode button').forEach(b => b.onclick = () => { store.set('cyMode', b.dataset.m); bottomChart(); }); build(); },
  update(c) { ctx = c; build(); },
  show() { top && top.resize(); bottom && bottom.resize(); },
};

function cycles() {
  const D = ctx.D;
  return C.HALVINGS.map((h, k) => {
    const i0 = D.dates.indexOf(h);
    const price = C.cycleSlice(D.dates, D.price, h);
    let hi = 0;
    const dd = price.map(p => { hi = Math.max(hi, p); return (p / hi - 1) * 100; });
    return { h, k, i0, price, mult: price.map(p => p / price[0]), dd, color: COLORS[k], current: k === C.HALVINGS.length - 1 };
  }).filter(c => c.i0 >= 0);
}

function build() {
  const cy = cycles(), now = cy.at(-1), day = now.price.length - 1;
  top && top.destroy();
  top = new Chart($('#cyPrice'), { type: 'line',
    data: { datasets: cy.map(c => ({ label: c.h.slice(0, 4) + ' cycle', data: c.mult.map((y, x) => ({ x, y })), borderColor: c.color, borderWidth: c.current ? 2.4 : 1.3, pointRadius: 0, tension: 0 })) },
    ...config(v => '×' + (v >= 10 ? v.toFixed(0) : v.toFixed(1)), true, i => `  ${i.dataset.label}: ×${i.raw.y.toFixed(2)}`, day) });
  $('#cyLegend').innerHTML = cy.map(c => `<div class="li"><div class="ld" style="background:${c.color}"></div>${c.h} halving${c.current ? ' (current)' : ''}</div>`).join('');
  bottomChart();
  table(cy, day);
}

function bottomChart() {
  const mode = store.get('cyMode', 'z'), M = MODES[mode], cy = cycles(), day = cy.at(-1).price.length - 1;
  $$('#cyMode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  const series = c => mode === 'dd' ? c.dd : C.cycleSlice(ctx.D.dates, M.get(ctx), c.h);
  bottom && bottom.destroy();
  bottom = new Chart($('#cyBottom'), { type: 'line',
    data: { datasets: cy.map(c => ({ label: c.h.slice(0, 4) + ' cycle', data: series(c).map((y, x) => ({ x, y })).filter(p => p.y != null), borderColor: c.color, borderWidth: c.current ? 2.4 : 1.3, pointRadius: 0, tension: 0 })) },
    ...config(v => M.fmt(v), false, i => `  ${i.dataset.label}: ${M.fmt(i.raw.y)}`, day) });
  $('#cyBottomTitle').textContent = M.name.toUpperCase() + ' · BY DAY SINCE THE HALVING';
}

function config(tick, log, label, day) {
  const today = { id: 'today', afterDatasetsDraw(ch) {
    const { ctx: g, chartArea: { top: t, bottom: b }, scales: { x } } = ch, px = x.getPixelForValue(day);
    g.save(); g.strokeStyle = 'rgba(245,166,35,.6)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(px, t); g.lineTo(px, b); g.stroke();
    g.setLineDash([]); g.fillStyle = '#f5a623'; g.font = "8px 'Space Mono',monospace"; g.fillText('TODAY · DAY ' + day, px + 5, t + 10); g.restore();
  } };
  return { plugins: [today], options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'x', intersect: false },
    plugins: { legend: { display: false }, tooltip: { ...TIP, callbacks: { title: i => 'Day ' + i[0].raw.x + ' after the halving', label } } },
    scales: { x: { type: 'linear', min: 0, max: 1460, grid: GRID, border: BORDER, ticks: { color: '#2a3a58', stepSize: 182.5, callback: v => (v / 365).toFixed(1).replace('.0', '') + 'y' } },
      y: { type: log ? 'logarithmic' : 'linear', grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#4a5a78', callback: log ? logTicks(tick) : tick } } } } };
}

function table(cy, day) {
  const Z = ctx.sig.bvi.z, R = ctx.sig.sdca.risk;
  const rows = cy.map(c => {
    const at = Math.min(day, c.price.length - 1), i = c.i0 + at;
    let peak = 0, pd = 0; c.mult.forEach((m, x) => { if (m > peak) { peak = m; pd = x; } });
    return `<tr${c.current ? ' class="hl"' : ''}><td><span class="dot" style="background:${c.color}"></span>${c.h}</td><td>${C.fmtUsd(c.price[0])}</td>
      <td>×${c.mult[at].toFixed(2)}</td><td>${c.dd[at].toFixed(0)}%</td><td style="color:${C.zColor(Z[i])}">${Z[i] == null ? '—' : Z[i].toFixed(2)}</td>
      <td style="color:${C.riskColor(R[i])}">${R[i] == null ? '—' : R[i].toFixed(0) + '%'}</td><td>×${peak.toFixed(2)} (day ${pd})</td></tr>`;
  }).join('');
  $('#cyTable').innerHTML = `<tr><th>Halving</th><th>Price at halving</th><th>Multiple, day ${day}</th><th>From cycle high, day ${day}</th><th>BVI Z, day ${day}</th><th>SDCA risk, day ${day}</th><th>Cycle peak (first 4 years)</th></tr>${rows}`;
}
