// Entry point: loads data.json (rebuilt by .github/workflows/update-data.yml),
// builds the signals, drives the tabs, the header cards and the live price.
import * as C from './core.js';
import { $, $$, setupCharts, store, lastValid } from './ui.js';
import overview from './overview.js';
import rainbow from './rainbow.js';
import dca, { todayPlan } from './dca.js';
import indicators from './indicators.js';
import cycles from './cycles.js';

const MODULES = { overview, rainbow, dca, indicators, cycles };
const inited = {}, dirty = {};
let active = null;
const ctx = { D: null, N: 0, sel: [], sig: null, setSelection, refreshHeader };

function banner(msg) { const b = $('#UB'); b.textContent = '⚠ ' + msg; b.style.display = 'block'; }

async function boot() {
  setupCharts();
  let D;
  try {
    const r = await fetch('data.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    D = await r.json();
  } catch (e) { banner('Données indisponibles (' + e.message + ')'); return; }
  if (!D.models) { banner('data.json is in an older format; wait for the next automatic update.'); return; }
  ctx.D = D; ctx.N = D.dates.length;
  const known = new Set(D.indicators.map(x => x.key)), saved = (store.get('sel', null) || []).filter(k => known.has(k));
  ctx.sel = saved.length ? saved : C.defaultKeys(D);
  ctx.sig = C.buildSignals(D, ctx.sel);

  const age = Math.floor((Date.now() - C.msOf(D.dates.at(-1))) / 864e5);
  if (age > 3) banner('Données au ' + D.dates.at(-1) + ' — la mise à jour automatique a ' + age + ' jours de retard');
  $('#hdate').innerHTML = 'LAST UPDATE: ' + D.dates.at(-1) + '<br>' + D.indicators.length + ' INDICATORS · 3 MODELS';
  $('#ftr').textContent = D.dates[0] + ' → ' + D.dates.at(-1) + ' · ' + ctx.N.toLocaleString() + ' DAILY OBSERVATIONS';
  header();
  refreshHeader();

  $$('#tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#planCard').addEventListener('click', () => show('dca'));
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (MODULES[h] && h !== active) show(h); });
  const first = location.hash.slice(1);
  show(MODULES[first] ? first : store.get('tab', 'overview'));
  live();
}

function show(name) {
  if (!MODULES[name]) name = 'overview';
  active = name;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
  store.set('tab', name);
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  const m = MODULES[name];
  if (!inited[name]) { m.init(ctx); inited[name] = true; dirty[name] = false; }
  else if (dirty[name]) { m.update(ctx); dirty[name] = false; }
  requestAnimationFrame(() => m.show(ctx));
}

function setSelection(keys) {
  ctx.sel = keys;
  store.set('sel', keys);
  ctx.sig = C.buildSignals(ctx.D, keys);
  header(); refreshHeader();
  for (const name in MODULES) {
    if (!inited[name]) continue;
    if (name === active) MODULES[name].update(ctx); else dirty[name] = true;
  }
}

// ── header cards ──
function header() {
  const { D } = ctx, S = ctx.sig, i = lastValid(S.bvi.z), z = S.bvi.z[i], sg = C.signal(z), r = S.bvi.risk[i];
  const set = (id, txt, color) => { const e = $(id); e.textContent = txt; if (color) e.style.color = color; };
  set('#sZ', z.toFixed(2), C.zColor(z)); set('#sSig', sg.label, sg.color);
  set('#sP', C.fmtUsd(D.price.at(-1)));
  $('#sPsub').textContent = D.dates.at(-1) + ' close · range ' + C.fmtUsd(Math.min(...D.price)) + ' – ' + C.fmtUsd(Math.max(...D.price));
  set('#sPct', Math.round(r) + '%', C.riskColor(r)); set('#sRisk', C.riskZone(r).label, C.riskColor(r));
  const j = lastValid(S.sdca.risk), rs = S.sdca.risk[j];
  set('#sSdca', rs.toFixed(1) + '%', C.riskColor(rs));
  set('#sSdcaSub', C.riskZone(rs).label + ' · causal twin ' + S.causal.risk[lastValid(S.causal.risk)].toFixed(0) + '%', C.riskColor(rs));
}
function refreshHeader() {
  const p = todayPlan(ctx), el = $('#sPlan');
  el.textContent = p.text;
  el.style.color = p.kind === 'buy' ? '#69f0ae' : p.kind === 'sell' ? '#ff6b6b' : '#8a9ab8';
  $('#sPlanSub').textContent = `${C.SIGNALS[p.sig].short} risk ${C.fmtPct(p.risk)} · ${C.fmtSigned(p.rate)}%/day · open the plan →`;
}

// ── live price (Coinbase spot, every minute while the page is visible) ──
async function live() {
  const box = $('#live');
  const tick = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { cache: 'no-store' });
      const p = +(await r.json()).data.amount;
      if (!(p > 0)) throw new Error('bad price');
      const D = ctx.D, close = D.price.at(-1), ch = (p / close - 1) * 100, now = Date.now(), band = C.rainbowBand(now, p), lv = C.raqqrLevels(now);
      box.innerHTML = `<span><i class="dot"></i>LIVE <b>${C.fmtUsd(p)}</b></span>`
        + `<span class="${ch >= 0 ? 'pos' : 'neg'}">${C.fmtSigned(ch)}% vs ${D.dates.at(-1)} close</span>`
        + `<span>Quantile band: <b style="font-size:10px;color:${band.solid || '#5fb8ff'}">${band.name}</b> · EQM risk ${C.raqqrRisk(now, p).toFixed(1)}% · median ${C.fmtUsd(lv[3])}</span>`
        + `<span style="color:#3a4a68">composites update daily · ${new Date().toLocaleTimeString()}</span>`;
      rainbow.live(p);
    } catch (e) {
      box.innerHTML = `<span><i class="dot off"></i>LIVE PRICE UNAVAILABLE</span><span>Daily close ${C.fmtUsd(ctx.D.price.at(-1))} (${ctx.D.dates.at(-1)})</span>`;
    }
  };
  await tick();
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

boot();
