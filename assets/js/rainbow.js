// Quantile Rainbow tab: the RAQQR quantile bands of the SDCA app, over the whole
// history and extended to the end of 2030 (an extrapolation of the fitted curves).
import * as C from './core.js';
import { $, $$, TOUCH, GRID, BORDER, TIP, fitAxis, logTick, xTicks } from './ui.js';

let ctx, chart = null, labels = [], levels = [], hist = 0, total = 0;
const END = '2030-12-31';
const YEAR_ENDS = ['2026-12-31', '2027-12-31', '2028-12-31', '2029-12-31', '2030-12-31'];
const LEVEL_NAMES = ['Q1 rail', 'Q10', 'Q25', 'Median (Q50)', 'Q75', 'Q95', 'Q99 rail'];

export default {
  init(c) { ctx = c; wire(); build(); },
  update(c) { ctx = c; },               // the rainbow only depends on price
  show() { chart && chart.resize(); },
  live(price) {
    live = price;
    if (!chart) return;                  // not opened yet: picked up by build()
    chart.data.datasets.at(-1).data = livePoint(); chart.update('none'); stats();
  },
};
let live = null;

function wire() {
  $$('#rbRange button').forEach(b => b.addEventListener('click', () => {
    $$('#rbRange button').forEach(x => x.classList.toggle('on', x === b));
    const r = b.dataset.r, x = chart.options.scales.x;
    const at = d => Math.max(0, labels.indexOf(d));
    if (r === 'all') { x.min = undefined; x.max = undefined; }
    else if (r === 'hist') { x.min = 0; x.max = hist - 1; }
    else if (r === 'now') { x.min = Math.max(0, hist - 1 - 730); x.max = Math.min(total - 1, hist - 1 + 730); }
    else { x.min = at(r + '-01-01'); x.max = undefined; }
    chart.update('none');
  }));
}

function livePoint() {
  const out = new Array(total).fill(null);
  if (live) {
    const i = labels.indexOf(C.isoOf(Date.now() - Date.now() % 86400000));
    if (i >= 0) out[i] = live;
  }
  return out;
}

function build() {
  const D = ctx.D;
  hist = D.dates.length;
  labels = D.dates.slice();
  for (let ms = C.msOf(D.dates[hist - 1]) + 86400000; ms <= C.msOf(END); ms += 86400000) labels.push(C.isoOf(ms));
  total = labels.length;
  levels = Array.from({ length: 7 }, () => new Array(total));
  labels.forEach((d, i) => C.raqqrLevels(C.msOf(d)).forEach((v, k) => { levels[k][i] = v; }));
  const price = labels.map((_, i) => i < hist ? D.price[i] : null);

  const ds = [{ label: 'Q1 rail', data: levels[0], borderColor: '#5fb8ff', borderWidth: 1.2, pointRadius: 0, fill: false }];
  for (let k = 1; k < 7; k++) {
    ds.push({ label: LEVEL_NAMES[k], data: levels[k], backgroundColor: C.RAINBOW_BANDS[k - 1].color, fill: '-1', pointRadius: 0,
      borderColor: k === 6 ? '#ff5c61' : 'transparent', borderWidth: k === 6 ? 1.2 : 0 });
  }
  // Chart.js paints higher `order` first: bands at the bottom, then the median, then the price on top
  ds.forEach(d => { d.order = 10; });
  ds.push({ label: 'Median', data: levels[3], borderColor: '#ffffff', borderWidth: 2, pointRadius: 0, fill: false, order: 3 });
  ds.push({ label: 'outline', data: price, borderColor: '#000000', borderWidth: 4.5, pointRadius: 0, fill: false, order: 2 });
  ds.push({ label: 'BTC price', data: price, borderColor: '#ffffff', borderWidth: 2.2, pointRadius: 0, fill: false, order: 1 });
  ds.push({ label: 'Live', data: livePoint(), borderColor: '#facc15', backgroundColor: '#facc15', pointRadius: 5, pointHoverRadius: 6, showLine: false, order: 0 });

  const projection = { id: 'proj', beforeDatasetsDraw(ch) {
    const { ctx: g, chartArea: { top, bottom, right }, scales: { x } } = ch;
    const x0 = x.getPixelForValue(hist - 1);
    if (x0 >= right) return;
    g.save(); g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(Math.max(x0, ch.chartArea.left), top, right - Math.max(x0, ch.chartArea.left), bottom - top);
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x0, top); g.lineTo(x0, bottom); g.stroke();
    g.setLineDash([]); g.fillStyle = 'rgba(220,228,245,0.55)'; g.font = "8px 'Space Mono',monospace"; g.fillText('MODEL PROJECTION →', x0 + 6, top + 12);
    g.restore();
  } };

  chart && chart.destroy();
  chart = new Chart($('#rbChart'), { type: 'line', plugins: [projection], data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        zoom: { limits: { x: { min: 0, max: total - 1, minRange: 30 } },
          zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, drag: { enabled: !TOUCH, backgroundColor: 'rgba(0,212,255,0.08)' }, mode: 'x',
            onZoomComplete: () => $$('#rbRange button').forEach(b => b.classList.remove('on')) },
          pan: { enabled: true, mode: 'x', modifierKey: TOUCH ? null : 'shift' } },
        tooltip: { ...TIP, filter: i => i.datasetIndex === 7, callbacks: {
          title: i => i[0].label + (i[0].dataIndex >= hist ? '  (projection)' : ''),
          label: i => {
            const k = i.dataIndex, p = price[k] ?? (i.chart.data.datasets.at(-1).data[k]), lv = levels.map(l => l[k]);
            const out = [];
            if (p) {
              const ms = C.msOf(labels[k]), band = C.rainbowBand(ms, p);
              out.push('  BTC:      ' + C.fmtUsd(p), '  Band:     ' + band.name, '  EQM risk: ' + C.raqqrRisk(ms, p).toFixed(1) + '%');
            }
            out.push('  Q99 rail: ' + C.fmtUsd(lv[6]), '  Median:   ' + C.fmtUsd(lv[3]), '  Q1 rail:  ' + C.fmtUsd(lv[0]));
            return out;
          },
          labelColor: () => ({ borderColor: 'transparent', backgroundColor: '#ffffff' }) } } },
      scales: { x: { grid: GRID, border: BORDER, ticks: xTicks(labels) },
        y: { type: 'logarithmic', position: 'right', grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#4a5a78', callback: logTick } } } } });
  chart.canvas.style.touchAction = 'pan-y';
  chart.canvas.ondblclick = () => $('#rbRange button[data-r="all"]').click();
  $('#rbLegend').innerHTML = C.RAINBOW_BANDS.map(b => `<div class="li"><div class="ld" style="background:${b.solid}"></div>${b.range} · ${b.name}</div>`).join('')
    + '<div class="li"><div class="ld" style="background:#fff"></div>Median</div><div class="li"><div class="ld" style="background:#facc15"></div>Live price</div>';
  table();
  stats();
}

function stats() {
  const D = ctx.D, i = hist - 1, d = D.dates[i], ms = C.msOf(d), p = D.price[i], lv = C.raqqrLevels(ms);
  const band = C.rainbowBand(ms, p), pos = C.raqqrPosition(ms, p), risk = C.raqqrRisk(ms, p);
  const tile = (l, v, s, color) => `<div class="tile"><div class="tl">${l}</div><div class="tv" style="${color ? 'color:' + color : ''}">${v}</div><div class="ts">${s}</div></div>`;
  let liveTile = '';
  if (live) {
    const lms = Date.now(), lb = C.rainbowBand(lms, live);
    liveTile = tile('Live price', C.fmtUsd(live), `${lb.name} · EQM risk ${C.raqqrRisk(lms, live).toFixed(1)}%`, '#facc15');
  }
  $('#rbStats').innerHTML = tile(`Close ${d}`, C.fmtUsd(p), band.name, band.solid || (band.idx < 0 ? '#5fb8ff' : '#ff5c61'))
    + tile('EQM risk (app scale)', risk.toFixed(1) + '%', 'Log-position between the quantiles, 1–99')
    + tile('Price pillar Z', C.fmtSigned(pos), `SDCA app shows ${C.fmtSigned(-pos)} (+ = cheap)`, C.zColor(pos))
    + tile('vs median', C.fmtSigned((p / lv[3] - 1) * 100, 1) + '%', 'Median today ' + C.fmtUsd(lv[3]))
    + tile('Q1 rail', C.fmtUsd(lv[0]), (p < lv[0] ? 'Price is ' + ((1 - p / lv[0]) * 100).toFixed(1) + '% below it' : 'Floor of the model'), '#5fb8ff')
    + liveTile;
}

function table() {
  const D = ctx.D, cols = [D.dates[hist - 1], ...YEAR_ENDS];
  const lv = cols.map(d => C.raqqrLevels(C.msOf(d)));
  const head = `<tr><th>Level</th>${cols.map((d, j) => `<th>${j ? d.slice(0, 4) + ' end' : 'Today (' + d + ')'}</th>`).join('')}</tr>`;
  const rows = LEVEL_NAMES.map((n, k) => `<tr${k === 3 ? ' class="hl"' : ''}><td>${n}${k < 6 ? `<span class="badge" style="color:${C.RAINBOW_BANDS[k].solid};border-color:${C.RAINBOW_BANDS[k].solid}">→ ${C.RAINBOW_BANDS[k].name}</span>` : ''}</td>${lv.map(l => `<td>${C.fmtUsd(l[k])}</td>`).join('')}</tr>`).join('');
  $('#rbTable').innerHTML = head + rows;
}
