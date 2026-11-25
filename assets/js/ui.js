// DOM and Chart.js helpers shared by the views.
import { fmtUsd } from './core.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const TOUCH = matchMedia('(pointer:coarse)').matches;
export const NARROW = () => innerWidth < 600;

export function setupCharts() {
  const C = window.Chart;
  C.defaults.color = '#4a5a78';
  C.defaults.font.family = 'Space Mono,monospace';
  C.defaults.font.size = 8;
  if (window.ChartZoom) C.register(window.ChartZoom);
}
export const GRID = { color: 'rgba(26,42,74,0.5)', lineWidth: 0.5 };
export const BORDER = { color: '#1a2a4a' };
export const TIP = {
  backgroundColor: '#0a1220', borderColor: '#1a2a4a', borderWidth: 1,
  titleFont: { family: 'Space Mono,monospace', size: 9 }, bodyFont: { family: 'Rajdhani,sans-serif', size: 13 },
  padding: 12, cornerRadius: 0, displayColors: true, boxPadding: 4,
};
export const AXIS_W = 68;
export const fitAxis = s => { s.width = AXIS_W; };

// Log-axis labels: powers of ten over >3 decades, 1-2-5 over >1 decade, otherwise
// every tick unless the next one is too close.
export function logTicks(fmt) {
  return function (v, i, ts) {
    const d = Math.log10(this.max / this.min), m = Math.round(v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9)) * 1000) / 1000;
    if (d > 3) return m === 1 ? fmt(v) : '';
    if (d > 1) return [1, 2, 5].includes(m) ? fmt(v) : '';
    const nx = ts[i + 1];
    return nx && Math.log10(nx.value / v) < d / 16 ? '' : fmt(v);
  };
}
export const logTick = logTicks(fmtUsd);
// Date labels adapted to the visible span (year, month, then day)
export function dateTick(labels) {
  return function (v) {
    const s = this.max - this.min, l = labels[v];
    return !l ? null : s > 1460 ? l.slice(0, 4) : s > 120 ? l.slice(0, 7) : l;
  };
}
export const xTicks = labels => ({ maxTicksLimit: NARROW() ? 4 : 12, autoSkipPadding: 16, maxRotation: 0, color: '#2a3a58', callback: dateTick(labels) });

// Per-viewer settings (remembered tab, selection, DCA inputs). Never required.
const KEY = 'bvi-v3';
let cache = null;
function readAll() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cache = {}; }
  return cache;
}
export const store = {
  get(k, d) { const v = readAll()[k]; return v === undefined ? d : v; },
  set(k, v) { readAll()[k] = v; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* private mode */ } },
};

export function downloadCSV(name, header, rows) {
  const url = URL.createObjectURL(new Blob([header.join(',') + '\n' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const lastValid = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };
