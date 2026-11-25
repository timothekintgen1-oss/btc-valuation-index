// DCA tab: today's action from your accumulation / distribution curve, the curve
// editor, a daily backtest, a walk-forward optimizer and the weekly strategies.
import * as C from './core.js';
import { $, $$, GRID, BORDER, TIP, fitAxis, logTick, xTicks, store, lastValid, downloadCSV, NARROW } from './ui.js';

let ctx, curveChart = null, weeklyChart = null, editor = null, timer = 0, lastRun = null;

// ── settings (per viewer, remembered) ──
const S = {
  get signal() { return store.get('dcaSignal', 'sdca'); }, set signal(v) { store.set('dcaSignal', v); },
  get vals() { return store.get('curve', C.CURVE_PRESETS.sdca.vals.slice()); }, set vals(v) { store.set('curve', v); },
  get preset() { return store.get('curvePreset', 'sdca'); }, set preset(v) { store.set('curvePreset', v); },
  get cash() { return store.get('cash', 10000); }, set cash(v) { store.set('cash', v); },
  get btc() { return store.get('btc', 0); }, set btc(v) { store.set('btc', v); },
  get start() { return store.get('btStart', '2018-01-01'); }, set start(v) { store.set('btStart', v); },
  get cash0() { return store.get('btCash', 10000); }, set cash0(v) { store.set('btCash', v); },
  get log() { return store.get('btLog', true); }, set log(v) { store.set('btLog', v); },
  get split() { return store.get('optSplit', '2021-01-01'); }, set split(v) { store.set('optSplit', v); },
  get optimized() { return store.get('optimized', null); }, set optimized(v) { store.set('optimized', v); },
};

// Today's instruction for a signal and curve — also used by the header card.
export function todayPlan(c) {
  const sig = c.sig[S.signal] ? S.signal : 'sdca', risk = c.sig[sig].risk, i = lastValid(risk);
  const r = risk[i], rate = C.curveRate(S.vals, r), price = c.D.price[i];
  let kind = 'hold', text = 'HOLD — no trade', amount = 'The curve is at 0 %/day for this risk.';
  if (rate > 1e-6) {
    const usd = S.cash * rate / 100;
    kind = 'buy'; text = `BUY ${rate.toFixed(2)}% of your cash`;
    amount = S.cash > 0 ? `Spend ${C.fmtUsd(usd)} ≈ ${C.fmtBtc(usd / price)} at the ${c.D.dates[i]} close` : 'Enter your cash reserve to get the amount.';
  } else if (rate < -1e-6) {
    const q = S.btc * (-rate) / 100;
    kind = 'sell'; text = `SELL ${(-rate).toFixed(2)}% of your BTC`;
    amount = S.btc > 0 ? `Sell ${C.fmtBtc(q)} ≈ ${C.fmtUsd(q * price)}` : 'Enter your BTC holdings to get the amount.';
  }
  return { sig, i, date: c.D.dates[i], risk: r, rate, kind, text, amount, price };
}

export default {
  init(c) { ctx = c; wire(); editor = curveEditor(); refresh(); weekly(store.get('weeklyYear', 2019)); },
  update(c) { ctx = c; refresh(); weekly(store.get('weeklyYear', 2019)); },
  show() { curveChart && curveChart.resize(); weeklyChart && weeklyChart.resize(); },
};

function wire() {
  const sel = $('#dcaSignal');
  sel.innerHTML = Object.entries(C.SIGNALS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  sel.value = S.signal;
  sel.onchange = () => { S.signal = sel.value; refresh(); ctx.refreshHeader(); };
  const num = (id, key) => { const el = $(id); el.value = S[key]; el.oninput = () => { S[key] = Math.max(0, +el.value || 0); today(); ctx.refreshHeader(); }; };
  num('#cashIn', 'cash'); num('#btcIn', 'btc');
  $('#curvePresets').innerHTML = Object.entries(C.CURVE_PRESETS).map(([k, p]) => `<button data-p="${k}">${p.name}</button>`).join('')
    + '<button data-p="optimized">Optimized</button>';
  $$('#curvePresets button').forEach(b => b.onclick = () => {
    const p = b.dataset.p, vals = p === 'optimized' ? S.optimized && S.optimized.vals : C.CURVE_PRESETS[p].vals;
    if (!vals) { $('#optOut').scrollIntoView({ behavior: 'smooth' }); return; }
    S.vals = vals.slice(); S.preset = p; editor.redraw(); changed();
  });
  const st = $('#btStartIn'); st.value = S.start; st.min = ctx.D.dates[0]; st.max = ctx.D.dates.at(-2);
  st.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(st.value)) { S.start = st.value; markQuick(); backtest(); } };
  const cash0 = $('#btCashIn'); cash0.value = S.cash0; cash0.oninput = () => { S.cash0 = Math.max(1, +cash0.value || 10000); backtest(); };
  const lg = $('#btLog'); lg.checked = S.log; lg.onchange = () => { S.log = lg.checked; backtest(); };
  $$('#btQuick button').forEach(b => b.onclick = () => { S.start = b.dataset.y + '-01-01'; st.value = S.start; markQuick(); backtest(); });
  markQuick();
  $('#btCsv').onclick = exportCsv;
  const sp = $('#optSplitIn'); sp.value = S.split; sp.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(sp.value)) S.split = sp.value; };
  $('#optRun').onclick = () => { $('#optOut').innerHTML = '<div class="lead">Searching…</div>'; setTimeout(optimize, 30); };
  $$('#weeklyStart button').forEach(b => b.onclick = () => weekly(+b.dataset.y));
}
const markQuick = () => $$('#btQuick button').forEach(b => b.classList.toggle('on', S.start === b.dataset.y + '-01-01'));
const changed = () => { $$('#curvePresets button').forEach(b => b.classList.toggle('on', b.dataset.p === S.preset)); today(); ctx.refreshHeader(); clearTimeout(timer); timer = setTimeout(backtest, 120); };

function refresh() {
  const s = C.SIGNALS[S.signal] || C.SIGNALS.sdca;
  $('#dcaSignalAbout').innerHTML = `<b style="color:${s.color}">${s.name}.</b> ${s.about}`;
  $$('#curvePresets button').forEach(b => b.classList.toggle('on', b.dataset.p === S.preset));
  today(); editor && editor.redraw(); backtest();
}

// ── today ──
function today() {
  const p = todayPlan(ctx), el = $('#todayAction'), z = C.riskZone(p.risk);
  $('#todayLabel').textContent = `Today's action · ${C.SIGNALS[p.sig].name} · ${p.date} close`;
  el.textContent = p.text; el.className = 'action ' + p.kind;
  $('#todayAmount').textContent = p.amount;
  const vals = S.vals;
  let buyStop = null, sellStart = null;
  for (let r = 0; r <= 100; r += 0.5) {
    const v = C.curveRate(vals, r);
    if (buyStop == null && v <= 1e-9) buyStop = r;
    if (sellStart == null && v < -1e-9) sellStart = r;
  }
  const half = p.rate > 0 ? Math.log(0.5) / Math.log(1 - p.rate / 100) : null;
  const tile = (l, v, s, color) => `<div class="tile"><div class="tl">${l}</div><div class="tv" style="${color ? 'color:' + color : ''}">${v}</div><div class="ts">${s}</div></div>`;
  $('#todayTiles').innerHTML = tile('Risk today', C.fmtPct(p.risk), z.label, C.riskColor(p.risk))
    + tile('Curve rate', C.fmtSigned(p.rate) + '%/day', p.rate > 0 ? 'of the cash reserve' : p.rate < 0 ? 'of the BTC held' : 'no trade')
    + tile('Cash half-life', half ? Math.round(half) + ' days' : '—', half ? 'to deploy half the reserve at this rate' : 'not buying')
    + tile('Buying stops', buyStop == null ? 'never' : 'above ' + buyStop + '%', 'risk level on your curve')
    + tile('Selling starts', sellStart == null ? 'never' : 'above ' + sellStart + '%', 'risk level on your curve');
}

// ── curve editor (SVG, drag the 21 nodes vertically) ──
function curveEditor() {
  // a narrower drawing on phones so points and labels keep a usable size once scaled to the screen
  const small = NARROW(), W = small ? 400 : 760, H = small ? 280 : 300, PL = small ? 38 : 54, PR = small ? 8 : 14, PT = 14, PB = 30;
  const PW = W - PL - PR, PH = H - PT - PB, NS = 'http://www.w3.org/2000/svg', FS = small ? 11 : 9;
  const px = r => PL + r / 100 * PW, py = v => PT + (1 - (C.clamp(v, -10, 10) + 10) / 20) * PH;
  const val = y => C.clamp(Math.round(((1 - (y - PT) / PH) * 20 - 10) * 10) / 10, -10, 10);
  const el = (t, a, parent) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; };
  const host = $('#curveEditor');
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); host.appendChild(svg);
  el('rect', { x: PL, y: PT, width: PW, height: PH / 2, fill: 'rgba(34,197,94,.06)' });
  el('rect', { x: PL, y: PT + PH / 2, width: PW, height: PH / 2, fill: 'rgba(255,68,68,.06)' });
  [[0, 25, 'rgba(0,150,136,.08)'], [75, 100, 'rgba(229,57,53,.08)']].forEach(([a, b, f]) => el('rect', { x: px(a), y: PT, width: px(b) - px(a), height: PH, fill: f }));
  for (let v = -10; v <= 10; v++) {
    const y = py(v), major = v % 5 === 0;
    el('line', { x1: PL, x2: PL + PW, y1: y, y2: y, stroke: v === 0 ? 'rgba(230,237,243,.5)' : major ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)', 'stroke-width': v === 0 ? 1.4 : 1 });
    if (major) el('text', { x: PL - 6, y: y + 3, fill: '#5a6a8a', 'font-size': FS, 'text-anchor': 'end', 'font-family': 'Space Mono,monospace' }).textContent = (v > 0 ? '+' : '') + v + '%';
  }
  for (const r of C.CURVE_NODES) {
    const x = px(r);
    el('line', { x1: x, x2: x, y1: PT, y2: PT + PH, stroke: r % 10 === 0 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)' });
    if (r % (small ? 25 : 10) === 0) el('text', { x, y: H - 10, fill: '#5a6a8a', 'font-size': FS, 'text-anchor': 'middle', 'font-family': 'Space Mono,monospace' }).textContent = r + '%';
  }
  el('text', { x: PL + PW, y: H - 1, fill: '#3a4a68', 'font-size': 8, 'text-anchor': 'end', 'font-family': 'Space Mono,monospace' }).textContent = 'RISK →';
  const marker = el('line', { y1: PT, y2: PT + PH, stroke: '#facc15', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' });
  const markerTxt = el('text', { y: PT + 11, fill: '#facc15', 'font-size': FS, 'font-family': 'Space Mono,monospace' });
  const path = el('path', { fill: 'none', stroke: '#4ea6c9', 'stroke-width': 2.4 });
  const label = el('text', { fill: '#e6edf3', 'font-size': FS + 1, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'Space Mono,monospace', opacity: 0 });
  const nodes = C.CURVE_NODES.map((r, i) => { const c = el('circle', { cx: px(r), r: small ? 6 : 5, stroke: '#0c1118', 'stroke-width': 1.5, class: 'node' }); c.dataset.i = i; return c; });
  let drag = null;
  const pt = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  nodes.forEach(c => c.addEventListener('pointerdown', e => { drag = +c.dataset.i; try { c.setPointerCapture(e.pointerId); } catch (_) { /* */ } e.preventDefault(); }));
  svg.addEventListener('pointermove', e => {
    if (drag == null) return;
    const v = S.vals; v[drag] = val(pt(e).y); S.vals = v; S.preset = 'custom'; redraw(drag);
  });
  const up = () => { if (drag == null) return; drag = null; redraw(); changed(); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
  function redraw(active) {
    const v = S.vals;
    path.setAttribute('d', C.CURVE_NODES.map((r, i) => (i ? 'L' : 'M') + px(r) + ',' + py(v[i])).join(' '));
    nodes.forEach((c, i) => { c.setAttribute('cy', py(v[i])); c.setAttribute('fill', v[i] > 0.05 ? '#24e572' : v[i] < -0.05 ? '#ff5656' : '#8ea0b3'); });
    if (active != null) {
      label.setAttribute('x', px(C.CURVE_NODES[active])); label.setAttribute('y', py(v[active]) + (v[active] >= 0 ? -12 : 20));
      label.textContent = `${C.fmtSigned(v[active], 1)}% @ ${C.CURVE_NODES[active]}%`; label.setAttribute('opacity', 1);
    } else label.setAttribute('opacity', 0);
    const p = todayPlan(ctx), x = px(C.clamp(p.risk ?? 50, 0, 100));
    marker.setAttribute('x1', x); marker.setAttribute('x2', x);
    const flip = x > W - (small ? 190 : 160);
    markerTxt.setAttribute('x', x + (flip ? -6 : 6)); markerTxt.setAttribute('text-anchor', flip ? 'end' : 'start');
    markerTxt.textContent = `today ${C.fmtPct(p.risk)} → ${C.fmtSigned(p.rate)}%/day`;
  }
  redraw();
  return { redraw };
}

// ── daily backtest ──
function windowIdx() {
  const D = ctx.D, s = Math.max(0, D.dates.findIndex(d => d >= S.start));
  return { s, e: D.dates.length - 1 };
}
function backtest() {
  if (!ctx) return;
  const D = ctx.D, risk = ctx.sig[S.signal].risk, { s, e } = windowIdx(), cash0 = S.cash0, vals = S.vals;
  const st = C.simulateCurve({ price: D.price, risk, vals, start: s, end: e, cash0 });
  const bh = C.simulateBuyHold(D.price, s, e, cash0), dca = C.simulatePlainDca(D.price, s, e, cash0);
  lastRun = { s, e, st, bh, dca, risk };
  const sig = C.SIGNALS[S.signal];
  $('#btWarn').style.display = sig.hindsight ? 'block' : 'none';
  $('#btWarn').innerHTML = `<b>${sig.name}</b>: its price pillar uses RAQQR coefficients fitted on 2010–2026, so this backtest partly knows the future. Switch the signal to <b>SDCA causal twin</b> for an honest comparison.`;
  const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const cls = v => v >= 0 ? 'pos' : 'neg';
  const tile = (l, v, s2, c) => `<div class="tile"><div class="tl">${l}</div><div class="tv ${c || ''}">${v}</div><div class="ts">${s2}</div></div>`;
  $('#btTiles').innerHTML = tile('Final value', C.fmtUsd(st.final), `${pct(st.ret)} on ${C.fmtUsd(cash0)}`, cls(st.ret))
    + tile('vs buy & hold', pct(st.final / bh.final - 1), 'B&H ' + C.fmtUsd(bh.final), cls(st.final - bh.final))
    + tile('vs plain DCA', pct(st.final / dca.final - 1), 'DCA ' + C.fmtUsd(dca.final), cls(st.final - dca.final))
    + tile('Holdings', C.fmtBtc(st.btc), 'cash left ' + C.fmtUsd(st.cashLeft))
    + tile('Avg buy price', C.fmtUsd(st.avgBuy), `bought ${C.fmtUsd(st.bought)} · sold ${C.fmtUsd(st.sold)}`)
    + tile('Max drawdown', '−' + (st.mdd * 100).toFixed(1) + '%', 'B&H −' + (bh.mdd * 100).toFixed(1) + '% · DCA −' + (dca.mdd * 100).toFixed(1) + '%', 'neg')
    + tile('Trading days', `${st.buyDays} / ${st.sellDays}`, `buy / sell over ${st.days.toLocaleString()} days`);
  const labels = D.dates.slice(s, e + 1);
  const shade = { id: 'shade', beforeDatasetsDraw(ch) {
    const { ctx: g, chartArea: { top, bottom, left, right }, scales: { x } } = ch, r = lastRun.st.rate;
    const w = (right - left) / Math.max(1, (x.max - x.min)), from = Math.max(0, Math.floor(x.min)), to = Math.min(r.length - 1, Math.ceil(x.max));
    g.save();
    for (let i = from; i <= to; i++) {
      if (Math.abs(r[i]) < 1e-9) continue;
      g.fillStyle = r[i] > 0 ? 'rgba(15,94,72,.32)' : 'rgba(137,44,58,.34)';
      g.fillRect(x.getPixelForValue(i) - w / 2, top, w + 0.5, bottom - top);
    }
    g.restore();
  } };
  const data = [
    { label: 'Your curve', data: st.value, borderColor: '#d4a756', borderWidth: 2.2, pointRadius: 0, tension: 0 },
    { label: 'Buy & hold (day 1)', data: bh.value, borderColor: 'rgba(232,238,245,.55)', borderWidth: 1.3, pointRadius: 0, tension: 0 },
    { label: 'Plain DCA', data: dca.value, borderColor: '#4ea6c9', borderWidth: 1.3, borderDash: [5, 4], pointRadius: 0, tension: 0 },
  ];
  curveChart && curveChart.destroy();   // rebuilt each run: the y scale type can change
  {
    curveChart = new Chart($('#curveChart'), { type: 'line', plugins: [shade], data: { labels, datasets: data },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { ...TIP, callbacks: { title: i => i[0].label,
          label: i => '  ' + i.dataset.label + ': ' + C.fmtUsd(i.raw),
          afterBody: i => { const k = i[0].dataIndex, r = lastRun.risk[lastRun.s + k]; return ['', '  Risk ' + C.fmtPct(r) + ' → ' + C.fmtSigned(lastRun.st.rate[k]) + '%/day', '  Cash ' + C.fmtUsd(lastRun.st.cash[k])]; } } } },
        scales: { x: { grid: GRID, border: BORDER, ticks: xTicks(labels) }, y: { type: S.log ? 'logarithmic' : 'linear', grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#4a5a78', callback: S.log ? logTick : v => C.fmtUsd(v) } } } } });
  }
  $('#curveLegend').innerHTML = data.map(d => `<div class="li"><div class="ld" style="background:${d.borderColor}"></div>${d.label}</div>`).join('')
    + '<div class="li"><div class="ld" style="background:rgba(15,94,72,.9)"></div>buying day</div><div class="li"><div class="ld" style="background:rgba(137,44,58,.9)"></div>selling day</div>';
}

function exportCsv() {
  if (!lastRun) return;
  const { s, st, bh, dca, risk } = lastRun, D = ctx.D;
  const rows = st.value.map((v, k) => [D.dates[s + k], D.price[s + k], risk[s + k] == null ? '' : risk[s + k].toFixed(2), st.rate[k].toFixed(3), v.toFixed(2), st.cash[k].toFixed(2), bh.value[k].toFixed(2), dca.value[k].toFixed(2)]);
  downloadCSV(`accum-dist-${S.signal}-${S.start}.csv`, ['date', 'btc_price', 'risk_pct', 'curve_rate_pct', 'portfolio_usd', 'cash_usd', 'buy_hold_usd', 'plain_dca_usd'], rows);
}

// ── walk-forward optimizer ──
function optimize() {
  const D = ctx.D, risk = ctx.sig[S.signal].risk, { s, e } = windowIdx(), cash0 = S.cash0;
  const split = D.dates.findIndex(d => d >= S.split);
  if (split <= s + 365 || split >= e - 180) {
    $('#optOut').innerHTML = '<div class="warn">Pick a split date at least a year after the backtest start and six months before the last data point.</div>';
    return;
  }
  const best = C.optimizeCurve({ price: D.price, risk, start: s, split, end: e, cash0 });
  const mine = { train: C.simulateCurve({ price: D.price, risk, vals: S.vals, start: s, end: split - 1, cash0, keep: false }),
    test: C.simulateCurve({ price: D.price, risk, vals: S.vals, start: split, end: e, cash0, keep: false }) };
  const bh = { train: C.simulateBuyHold(D.price, s, split - 1, cash0), test: C.simulateBuyHold(D.price, split, e, cash0) };
  const pd = { train: C.simulatePlainDca(D.price, s, split - 1, cash0), test: C.simulatePlainDca(D.price, split, e, cash0) };
  S.optimized = { vals: best.vals, params: best.params, signal: S.signal, start: S.start, split: S.split };
  const p = best.params, f = v => `${C.fmtUsd(v.final)} <span style="color:#5a6a8a">(${(v.ret >= 0 ? '+' : '') + (v.ret * 100).toFixed(0)}%)</span>`;
  const row = (n, k) => `<tr><td>${n}</td><td>${f(best[k])}</td><td>${f(mine[k])}</td><td>${f(bh[k])}</td><td>${f(pd[k])}</td></tr>`;
  const beat = best.test.final > Math.max(bh.test.final, pd.test.final);
  $('#optOut').innerHTML = `<div class="twrap"><table class="tbl"><tr><th>Window (from ${C.fmtUsd(cash0)})</th><th>Optimized curve</th><th>Your curve</th><th>Buy & hold</th><th>Plain DCA</th></tr>
      ${row(`Training ${D.dates[s]} → ${D.dates[split - 1]}`, 'train')}${row(`Test ${D.dates[split]} → ${D.dates[e]}`, 'test')}</table></div>
    <div class="lead">Best of ${best.tested} curves on the training window: buy <b>${p.buy}%/day</b> of the cash up to ${Math.max(0, p.buyEnd - 10)}% risk, tapering to 0 at ${p.buyEnd}%;
      ${p.sellStart >= 100 ? 'never sell' : `sell from ${p.sellStart}% risk, up to <b>${p.sellMax}%/day</b> of the BTC at 100%`}.
      Out of sample it ${beat ? '<b class="pos">beat</b>' : '<b class="neg">did not beat</b>'} both buy & hold and plain DCA.</div>
    <div class="row"><button class="btn primary" id="optApply">Load it into the editor</button></div>`;
  $('#optApply').onclick = () => { S.vals = best.vals.slice(); S.preset = 'optimized'; editor.redraw(); changed(); $('#curveEditor').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}

// ── weekly strategies (first backtest of the page, on the BVI composite) ──
function weekly(year) {
  store.set('weeklyYear', year);
  $$('#weeklyStart button').forEach(b => b.classList.toggle('on', +b.dataset.y === year));
  const D = ctx.D, Z = ctx.sig.bvi.z, s0 = D.dates.findIndex((d, i) => d >= year + '-01-01' && Z[i] != null);
  const { res, labels } = C.weeklyBacktest(D.dates, D.price, Z, s0), p = D.price.at(-1);
  $('#weeklyTable').innerHTML = '<tr><th>Strategy</th><th>Invested</th><th>BTC held</th><th>Cash</th><th>Value</th><th>Value / invested</th><th>Avg buy price</th></tr>'
    + res.map(r => { const v = r.btc * p + r.cash; return `<tr><td><span class="dot" style="background:${r.color}"></span>${r.name}</td><td>${C.fmtUsd(r.inv)}</td><td>${r.btc.toFixed(4)}</td><td>${C.fmtUsd(r.cash)}</td><td>${C.fmtUsd(v)}</td><td style="color:${r.color}">×${(v / r.inv).toFixed(2)}</td><td>${C.fmtUsd(r.inv / r.bought)}</td></tr>`; }).join('');
  const data = res.map(r => ({ label: r.name, data: r.vals, borderColor: r.color, borderWidth: 1.5, pointRadius: 0, tension: 0 }));
  if (!weeklyChart) {
    weeklyChart = new Chart($('#weeklyChart'), { type: 'line', data: { labels, datasets: data },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { ...TIP, callbacks: { label: i => '  ' + i.dataset.label + ': ×' + (i.raw ?? 0).toFixed(2) } } },
        scales: { x: { grid: GRID, border: BORDER, ticks: { maxTicksLimit: NARROW() ? 4 : 8, maxRotation: 0, color: '#2a3a58', callback: function (v) { return this.getLabelForValue(v).slice(0, 7); } } },
          y: { grid: GRID, border: BORDER, afterFit: fitAxis, ticks: { color: '#2a3a58', callback: v => '×' + v.toFixed(1) } } } } });
  } else { weeklyChart.data.labels = labels; weeklyChart.data.datasets = data; weeklyChart.update('none'); }
}
