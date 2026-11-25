// Indicators tab: current readings, the composite builder (which indicators enter
// the BVI), CSV export and the correlation matrix.
import * as C from './core.js';
import { $, $$, store, downloadCSV, esc, TOUCH } from './ui.js';

let ctx, matrix = null;
const PRESETS = {
  default: { name: 'BVI default', keys: D => C.defaultKeys(D) },
  all: { name: 'All', keys: D => D.indicators.map(x => x.key) },
  causal: { name: 'No hindsight', keys: D => D.indicators.filter(x => !x.hindsight).map(x => x.key) },
  onchain: { name: 'Fundamental only', keys: D => D.indicators.filter(x => x.category === 'fundamental' && x.default).map(x => x.key) },
  price: { name: 'Technical only', keys: D => D.indicators.filter(x => x.category === 'technical' && x.default).map(x => x.key) },
  sdca: { name: 'SDCA pillars', keys: () => ['cbpl', 'onchain_risk', 'raqqr'] },
};
const SHORT = { mvrv_z: 'MVRV Z', aviv: 'AVIV', thermocap: 'Thermocap', nupl: 'NUPL', rhodl: 'RHODL', price_tools: 'CVDD/TP',
  sth_sopr: 'STH-SOPR', cbpl: 'CBPL', onchain_risk: 'On-chain', rpl_sharpe: 'RPL Sharpe', power_law: 'Power Law',
  sharpe_52w: 'Sharpe 52W', rsi_monthly: 'RSI 1M', days_higher: 'Days High', beam: 'BEAM', rainbow: 'Rainbow',
  raqqr: 'RAQQR', fear_greed: 'F&G' };

export default {
  init(c) { ctx = c; wire(); render(); correlations(); },
  update(c) { ctx = c; render(); matrix && matrix.draw(); },
  show() { matrix && matrix.draw(); },
};

function wire() {
  $$('#imode button').forEach(b => b.onclick = () => { store.set('mode', b.dataset.m); render(); });
  $('#csvbtn').onclick = csv;
  $('#ipresets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-k="${k}">${p.name}</button>`).join('');
  $$('#ipresets button').forEach(b => b.onclick = () => ctx.setSelection(PRESETS[b.dataset.k].keys(ctx.D)));
  $('#icols').addEventListener('change', e => {
    if (!e.target.matches('input[data-key]')) return;
    const keys = $$('#icols input[data-key]').filter(x => x.checked).map(x => x.dataset.key);
    if (!keys.length) { e.target.checked = true; return; }     // keep at least one
    ctx.setSelection(keys);
  });
}

function render() {
  const { D } = ctx, mode = store.get('mode', 'val'), sd = mode === 'sdca', sel = new Set(ctx.sel);
  const Z = ctx.sig.bvi.z, last = D.dates.length - 1, cats = C.categoryZ(D, ctx.sel);
  $$('#imode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  const active = Object.entries(PRESETS).find(([, p]) => C.sameKeys(p.keys(D), ctx.sel));
  $$('#ipresets button').forEach(b => b.classList.toggle('on', !!active && b.dataset.k === active[0]));
  $('#ititle').textContent = sd ? 'Indicators · SDCA score (positive = value, as in the sheet)' : 'Indicators · current Z-score (higher = more expensive)';
  $('#iselinfo').innerHTML = `<b>${sel.size}</b> of ${D.indicators.length} indicators in the composite${active ? ' · preset: ' + active[1].name : ' · custom selection'}`
    + (C.sameKeys(ctx.sel, C.defaultKeys(D)) ? '' : ' · <span style="color:#f5a623">custom composite: alerts and the published data still use the default set</span>');
  const box = $('#isdca'), cz = Z[last];
  box.style.display = sd ? 'block' : 'none';
  box.innerHTML = `SDCA SCORE (composite × −1): <b style="color:${C.zColor(cz)}">${C.fmtSigned(-cz)}</b> · ${C.sdcaLabel(-cz).toUpperCase()}`;
  const stale = (key, i) => { const a = D.asof && D.asof[key]; return a && D.dates[i] > a ? a : null; };
  $('#icols').innerHTML = ['fundamental', 'technical', 'sentiment'].map(c => {
    const z = cats[c][last];
    const head = `<div class="sec">${c}${z != null ? ` · <span style="color:${C.zColor(z)}">${C.fmtSigned(sd ? -z : z)}</span>` : ''}</div>`;
    return '<div>' + head + D.indicators.filter(x => x.category === c).map(x => {
      const v = D.indicator_z[x.key][last], old = stale(x.key, last), on = sel.has(x.key);
      const badges = (x.default ? '' : '<span class="badge b-opt" title="Not in the default composite">OPT</span>')
        + (x.hindsight ? '<span class="badge b-hs" title="Built with data after each date (fitted coefficients or full-history percentiles)">HS</span>' : '');
      const val = v == null ? '<span class="na">n/a</span>' : `<span class="v" style="color:${C.zColor(v)}">${old ? `<span class="asof" title="Latest source data: ${old}; value carried forward">as of ${old.slice(5)}</span>` : ''}${C.fmtSigned(sd ? -v : v)}${sd ? `<span class="lbl">${C.sdcaLabel(-v)}</span>` : ''}</span>`;
      return `<div class="irow${on ? '' : ' off'}" title="Source: ${esc(x.source)}"><span class="n"><label><input type="checkbox" data-key="${x.key}"${on ? ' checked' : ''}>${esc(x.label)}</label>${badges}</span>${val}</div>`;
    }).join('') + '</div>';
  }).join('');
}

function csv() {
  const { D } = ctx, S = ctx.sig, keys = D.indicators.map(x => x.key), cats = C.categoryZ(D, ctx.sel), f = v => v == null ? '' : v;
  const head = ['date', 'price_usd', 'bvi_z', 'bvi_risk', 'sdca_score', 'sdca_model_z', 'sdca_model_risk', 'causal_twin_risk',
    ...Object.keys(cats).map(c => 'z_' + c), ...keys.map(k => 'z_' + k)];
  const r2 = v => v == null ? '' : v.toFixed(2);
  const rows = D.dates.map((d, i) => [d, D.price[i], f(S.bvi.z[i]), r2(S.bvi.risk[i]), S.bvi.z[i] == null ? '' : (-S.bvi.z[i]).toFixed(2),
    f(S.sdca.z[i]), r2(S.sdca.risk[i]), r2(S.causal.risk[i]), ...Object.keys(cats).map(c => f(cats[c][i])), ...keys.map(k => f(D.indicator_z[k][i]))]);
  downloadCSV('btc-valuation-index-' + D.dates.at(-1) + '.csv', head, rows);
}

// ── correlation matrix of the indicator z-scores (pairwise, full history) ──
function correlations() {
  const { D } = ctx, keys = D.indicators.map(x => x.key), n = keys.length;
  const R = keys.map(a => keys.map(b => a === b ? 1 : C.corr(D.indicator_z[a], D.indicator_z[b])));
  const cv = $('#corrCanvas'), g = cv.getContext('2d'), tip = $('#corrTip');
  const color = r => {
    if (r == null) return '#0d1830';
    const t = Math.abs(r), c = r > 0 ? [255, 120, 60] : [60, 140, 255];
    return `rgba(${c[0]},${c[1]},${c[2]},${(0.08 + 0.92 * t * t).toFixed(3)})`;
  };
  let geo = null;
  function draw() {
    const W = Math.min(cv.parentElement.clientWidth, 620); if (!W) return;
    const L = 74, T = 74, cell = Math.floor((W - L) / n), H = T + cell * n, dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const sel = new Set(ctx.sel);
    g.font = "8px 'Space Mono',monospace";
    keys.forEach((k, i) => {
      g.fillStyle = sel.has(k) ? '#c8d4e8' : '#3a4a68';
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(SHORT[k] || k, L - 6, T + i * cell + cell / 2);
      g.save(); g.translate(L + i * cell + cell / 2, T - 6); g.rotate(-Math.PI / 3); g.textAlign = 'left'; g.fillText(SHORT[k] || k, 0, 0); g.restore();
      keys.forEach((_, j) => { g.fillStyle = color(R[i][j]); g.fillRect(L + j * cell, T + i * cell, cell - 1, cell - 1); });
    });
    geo = { L, T, cell };
    // effective number of independent indicators in the selection: N² / Σ r²
    const idx = keys.map((k, i) => sel.has(k) ? i : -1).filter(i => i >= 0);
    let s2 = 0, sum = 0, m = 0;
    for (const i of idx) for (const j of idx) { const r = R[i][j] ?? 0; s2 += r * r; if (i < j) { sum += r; m++; } }
    $('#corrStats').innerHTML = `Selected: <b>${idx.length}</b> indicators · mean pairwise correlation <b>${m ? (sum / m).toFixed(2) : '—'}</b> · `
      + `effective number of independent signals ≈ <b>${s2 ? (idx.length * idx.length / s2).toFixed(1) : '—'}</b>`;
  }
  function hover(e) {
    if (!geo) return;
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const j = Math.floor((x - geo.L) / geo.cell), i = Math.floor((y - geo.T) / geo.cell);
    if (i < 0 || j < 0 || i >= n || j >= n) { tip.style.display = 'none'; return; }
    const r = R[i][j];
    tip.innerHTML = `${esc(D.indicators[i].label)}<br>${esc(D.indicators[j].label)}<br>r = <b>${r == null ? 'n/a' : r.toFixed(2)}</b>`;
    tip.style.display = 'block'; tip.style.left = Math.min(x + 12, b.width - 200) + 'px'; tip.style.top = (y + 12) + 'px';
  }
  cv.onmousemove = hover; cv.onmouseleave = () => { tip.style.display = 'none'; };
  if (TOUCH) cv.onclick = hover;
  addEventListener('resize', () => setTimeout(draw, 150));
  matrix = { draw };
  draw();
}
