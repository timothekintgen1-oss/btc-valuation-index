// Pure computations shared by every view (no DOM). Unit-tested in tests/js/core.test.mjs.
//
// Sign convention everywhere on the page: higher = more expensive.
// Risk is on a 0-100 scale: low = cheap / buyable, high = expensive.

// ── Formatting ───────────────────────────────────────────────────────────
export function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return s + '$' + a.toFixed(2);
}
export const fmtSigned = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d);
export const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d) + '%';
export const fmtBtc = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(v < 1 ? 6 : 4) + ' BTC';
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── Valuation zones (Z-score) ────────────────────────────────────────────
export const ZONES = [
  { lo: -Infinity, label: 'EXTREME BUY', name: 'Extreme Buy', range: 'Z < −2', color: '#00f5ff' },
  { lo: -2, label: 'UNDERVALUED', name: 'Undervalued', range: '−2 ≤ Z < −1', color: '#448aff' },
  { lo: -1, label: 'FAIR VALUE', name: 'Fair Value', range: '−1 ≤ Z < 1', color: '#69f0ae' },
  { lo: 1, label: 'ELEVATED', name: 'Elevated', range: '1 ≤ Z < 2', color: '#ffeb3b' },
  { lo: 2, label: 'OVERVALUED', name: 'Overvalued', range: '2 ≤ Z < 3', color: '#ff6d00' },
  { lo: 3, label: 'EXTREME SELL', name: 'Extreme Sell', range: 'Z ≥ 3', color: '#f44336' },
];
export function signal(z) {
  let zone = ZONES[0];
  for (const s of ZONES) if (z >= s.lo) zone = s;
  return zone;
}
export function zColor(z, a = 1) {
  const s = [[-3, 0, 245, 255], [-1.5, 68, 138, 255], [0, 105, 240, 174], [1.5, 255, 235, 59], [2.5, 255, 109, 0], [4, 244, 67, 54]];
  if (z == null || !isFinite(z)) return `rgba(90,106,138,${a})`;
  if (z <= s[0][0]) return `rgba(${s[0][1]},${s[0][2]},${s[0][3]},${a})`;
  for (let i = 0; i < s.length - 1; i++) {
    if (z <= s[i + 1][0]) {
      const t = (z - s[i][0]) / (s[i + 1][0] - s[i][0]);
      const c = [1, 2, 3].map(k => Math.round(s[i][k] + t * (s[i + 1][k] - s[i][k])));
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    }
  }
  const l = s[s.length - 1];
  return `rgba(${l[1]},${l[2]},${l[3]},${a})`;
}
// Labels of the SDCA sheet, on the sheet's convention (score = −Z, positive = value)
export function sdcaLabel(s) {
  if (s <= -1.5) return 'No Value';
  if (s < 0) return 'Low Value';
  if (s === 0) return 'Neutral';
  if (s < 1.5) return 'Value';
  return 'High Value';
}

// ── Risk (0-100) ─────────────────────────────────────────────────────────
function erf(x) {  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  if (x === 0) return 0;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
}
// BVI: normal CDF of the composite Z-score
export const riskOfZ = z => (z == null || !isFinite(z)) ? null : 50 * (1 + erf(z / Math.SQRT2));
// SDCA app: linear map of its ±3 composite (here in this page's sign)
export const riskOfModelZ = z => (z == null || !isFinite(z)) ? null : clamp(50 + z / 3 * 50, 0, 100);
export const RISK_ZONES = [
  { lo: 0, label: 'BUY ZONE', color: '#1de9b6' },
  { lo: 25, label: 'ACCUMULATE', color: '#b2ff59' },
  { lo: 50, label: 'TRIM', color: '#ffc400' },
  { lo: 75, label: 'SELL ZONE', color: '#ff5252' },
];
export function riskZone(r) {
  let zone = RISK_ZONES[0];
  for (const s of RISK_ZONES) if (r >= s.lo) zone = s;
  return zone;
}
export function riskColor(r, a = 1) {
  const s = [[0, 0, 230, 160], [30, 120, 230, 60], [50, 200, 230, 40], [62, 255, 196, 0], [75, 255, 120, 0], [90, 255, 40, 60]];
  if (r == null || !isFinite(r)) return `rgba(90,106,138,${a})`;
  r = Math.max(0, r);
  for (let i = 0; i < s.length - 1; i++) {
    if (r <= s[i + 1][0]) {
      const t = (r - s[i][0]) / (s[i + 1][0] - s[i][0]);
      const c = [1, 2, 3].map(k => Math.round(s[i][k] + t * (s[i + 1][k] - s[i][k])));
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    }
  }
  const l = s[s.length - 1];
  return `rgba(${l[1]},${l[2]},${l[3]},${a})`;
}

// ── Series helpers (null = missing), same rules as scripts/build_index.py ──
export function rollingZ(xs, window = 6 * 365, minPeriods = 90) {
  const out = new Array(xs.length).fill(null), hist = [];
  let s = 0, s2 = 0, head = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x == null) continue;
    hist.push(x); s += x; s2 += x * x;
    if (hist.length - head > window) { const o = hist[head++]; s -= o; s2 -= o * o; }
    const n = hist.length - head;
    if (n < minPeriods) continue;
    const mu = s / n, sd = Math.sqrt(Math.max(s2 / n - mu * mu, 0)) || 1;
    out[i] = (x - mu) / sd;
  }
  return out;
}
export function meanAvailable(cols) {
  const n = cols.length ? cols[0].length : 0, out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    let s = 0, k = 0;
    for (const c of cols) { const v = c[i]; if (v != null) { s += v; k++; } }
    if (k) out[i] = s / k;
  }
  return out;
}
export const round2 = v => v == null ? null : Math.round(v * 100) / 100;

// ── Models ───────────────────────────────────────────────────────────────
export const defaultKeys = D => D.indicators.filter(x => x.default).map(x => x.key);
export function sameKeys(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(k => s.has(k));
}
// BVI composite for a set of indicators: the published series when the set is the
// default one, otherwise recomputed exactly like the pipeline (mean, then rolling z).
export function compositeZ(D, keys) {
  if (sameKeys(keys, defaultKeys(D))) return D.z;
  if (!keys.length) return new Array(D.dates.length).fill(null);
  return rollingZ(meanAvailable(keys.map(k => D.indicator_z[k]))).map(round2);
}
export function categoryZ(D, keys) {
  if (sameKeys(keys, defaultKeys(D))) return D.category_z;
  const out = {};
  for (const c of Object.keys(D.category_z)) {
    const ks = D.indicators.filter(x => x.category === c && keys.includes(x.key)).map(x => x.key);
    out[c] = ks.length ? rollingZ(meanAvailable(ks.map(k => D.indicator_z[k]))).map(round2) : new Array(D.dates.length).fill(null);
  }
  return out;
}
// Every signal the page can use, on the same index as D.dates
export function buildSignals(D, keys) {
  const z = compositeZ(D, keys);
  const bvi = { z, risk: z.map(riskOfZ) };
  const sdca = { z: D.models.sdca, risk: D.models.sdca.map(riskOfModelZ) };
  const causal = { z: D.models.sdca_causal, risk: D.models.sdca_causal.map(riskOfModelZ) };
  const consensus = { risk: bvi.risk.map((r, i) => r != null && sdca.risk[i] != null ? (r + sdca.risk[i]) / 2 : (r ?? sdca.risk[i])) };
  return { bvi, sdca, causal, consensus };
}
export const SIGNALS = {
  sdca: { name: 'SDCA model', short: 'SDCA', color: '#c084fc', hindsight: true,
    about: "Your teacher's model, reproduced exactly: price position in the RAQQR quantile model + cost-basis P/L + on-chain risk composite. Its price coefficients were fitted on 2010-2026, so its backtests see the future." },
  causal: { name: 'SDCA causal twin', short: 'Causal', color: '#f472b6', hindsight: false,
    about: 'Same model with the price pillar replaced by the past-only power-law residual: an honest backtest of the idea.' },
  bvi: { name: 'BVI composite', short: 'BVI', color: '#00d4ff', hindsight: false,
    about: 'This index: equal-weight composite of the selected indicators, rolling 6-year z-scores, no future data.' },
  consensus: { name: 'Consensus (BVI + SDCA)', short: 'Consensus', color: '#facc15', hindsight: true,
    about: 'Average of the BVI risk and the SDCA model risk.' },
};

// ── RAQQR quantile model (Cowen 2026 coefficients, as used by the SDCA app) ──
const DAY = 86400000;
export const RAQQR = {
  MU: 7.9914,
  GENESIS: Date.UTC(2009, 0, 1),
  COEF: [[0.01, 2.837, 2.578, -0.0241], [0.10, 2.933, 2.552, -0.0241], [0.25, 3.004, 2.554, -0.0241],
    [0.50, 3.214, 2.482, -0.1126], [0.75, 3.562, 2.283, -0.3259], [0.95, 3.897, 1.964, -0.3259], [0.99, 4.028, 1.904, -0.3259]],
  MARKS: [1, 10, 25, 50, 75, 95, 99],
};
export const msOf = iso => Date.parse(iso + 'T00:00:00Z');
export const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
export function raqqrLevels(ms) {
  const t = Math.max(1, Math.round((ms - RAQQR.GENESIS) / DAY)), x = Math.log(t) - RAQQR.MU;
  return RAQQR.COEF.map(([, c, a, b]) => Math.pow(10, c + a * x + b * x * x)).sort((p, q) => p - q);
}
// Higher = more expensive: 0 at the median, ±3 at the 1 % / 99 % rails (= SDCA app EQM z, sign flipped)
export function raqqrPosition(ms, price) {
  const lv = raqqrLevels(ms), lo = Math.log(lv[0]), mid = Math.log(lv[3]), hi = Math.log(lv[6]), lp = Math.log(price);
  if (lp <= mid) return -clamp(3 * (mid - lp) / (mid - lo), 0, 3);
  return clamp(3 * (lp - mid) / (hi - mid), 0, 3);
}
// The app's "EQM risk": log-interpolated position between the quantile levels, 1-99
export function raqqrRisk(ms, price) {
  const lv = raqqrLevels(ms), m = RAQQR.MARKS;
  if (price < lv[0]) return 1;
  if (price > lv[6]) return 99;
  for (let i = 0; i < 6; i++) {
    if (price >= lv[i] && price <= lv[i + 1]) {
      const f = (Math.log(price) - Math.log(lv[i])) / (Math.log(lv[i + 1]) - Math.log(lv[i]) || 1e-12);
      return clamp(m[i] + f * (m[i + 1] - m[i]), 1, 99);
    }
  }
  return 50;
}
export const RAINBOW_BANDS = [   // between levels[i] and levels[i+1]
  { name: 'Fire sale', range: '1–10%', color: 'rgba(23,60,112,0.62)', solid: '#3b6fb6' },
  { name: 'Accumulate', range: '10–25%', color: 'rgba(33,131,142,0.62)', solid: '#21838e' },
  { name: 'Value', range: '25–50%', color: 'rgba(56,160,75,0.62)', solid: '#38a04b' },
  { name: 'Above mid', range: '50–75%', color: 'rgba(214,196,32,0.62)', solid: '#d6c420' },
  { name: 'Hot', range: '75–95%', color: 'rgba(228,116,28,0.62)', solid: '#e4741c' },
  { name: 'Bubble', range: '95–99%', color: 'rgba(190,10,18,0.62)', solid: '#be0a12' },
];
export function rainbowBand(ms, price) {
  const lv = raqqrLevels(ms);
  if (price < lv[0]) return { name: 'Below the 1% rail', idx: -1 };
  if (price > lv[6]) return { name: 'Above the 99% rail', idx: 6 };
  for (let i = 0; i < 6; i++) if (price <= lv[i + 1]) return { ...RAINBOW_BANDS[i], idx: i };
  return { ...RAINBOW_BANDS[5], idx: 5 };
}

// ── Accumulation / distribution curve ────────────────────────────────────
// Value at each risk node = % of the cash reserve bought per day (> 0) or % of the
// BTC held sold per day (< 0), linear between nodes — same mechanics as the SDCA app.
export const CURVE_NODES = Array.from({ length: 21 }, (_, i) => i * 5);
export const CURVE_PRESETS = {
  sdca: { name: 'SDCA app default', vals: [10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.5, -2, -4, -10] },
  accumulate: { name: 'Accumulate only', vals: [10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  gentle: { name: 'Gentle', vals: [3, 3, 3, 2.5, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.25, -0.5, -1, -2] },
  aggressive: { name: 'Aggressive', vals: [10, 10, 10, 10, 10, 7.5, 5, 2.5, 0, 0, 0, 0, 0, 0, -0.5, -1, -2, -4, -6, -8, -10] },
};
export function curveRate(vals, risk) {
  if (risk == null || !isFinite(risk)) return 0;
  const r = clamp(risk, 0, 100), i = Math.min(19, Math.floor(r / 5)), t = (r - i * 5) / 5;
  return vals[i] + t * (vals[i + 1] - vals[i]);
}
// Parametric curve used by the optimizer: full buy rate up to buyEnd − 10, linear
// down to 0 at buyEnd; 0 until sellStart, linear down to −sellMax at risk 100.
export function paramCurve({ buy, buyEnd, sellStart, sellMax }) {
  return CURVE_NODES.map(r => {
    if (r <= buyEnd - 10) return buy;
    if (r < buyEnd) return Math.round(buy * (buyEnd - r) / 10 * 100) / 100;
    if (r <= sellStart || sellStart >= 100) return 0;
    return -Math.round(sellMax * (r - sellStart) / (100 - sellStart) * 100) / 100;
  });
}
// Daily simulation from index `start` to `end` (inclusive). Trades at that day's close.
export function simulateCurve({ price, risk, vals, start, end = price.length - 1, cash0 = 10000, keep = true }) {
  let cash = cash0, btc = 0, bought = 0, btcBought = 0, sold = 0, buyDays = 0, sellDays = 0, peak = 0, mdd = 0;
  const value = keep ? [] : null, cashS = keep ? [] : null, rateS = keep ? [] : null;
  for (let i = start; i <= end; i++) {
    const p = price[i], rate = curveRate(vals, risk[i]);
    if (rate > 1e-9 && cash > 0.005) {
      const usd = cash * rate / 100;
      cash -= usd; btc += usd / p; bought += usd; btcBought += usd / p; buyDays++;
    } else if (rate < -1e-9 && btc > 1e-12) {
      const q = btc * (-rate) / 100;
      btc -= q; cash += q * p; sold += q * p; sellDays++;
    }
    const v = cash + btc * p;
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak);
    if (keep) { value.push(v); cashS.push(cash); rateS.push(rate); }
  }
  const last = cash + btc * price[end];
  return { value, cash: cashS, rate: rateS, final: last, ret: last / cash0 - 1, btc, cashLeft: cash, bought, sold,
    avgBuy: btcBought > 0 ? bought / btcBought : null, buyDays, sellDays, days: end - start + 1, mdd };
}
export function simulateBuyHold(price, start, end = price.length - 1, cash0 = 10000) {
  const units = cash0 / price[start], value = [];
  let peak = 0, mdd = 0;
  for (let i = start; i <= end; i++) {
    const v = units * price[i];
    value.push(v); peak = Math.max(peak, v); mdd = Math.max(mdd, (peak - v) / peak);
  }
  return { value, final: value[value.length - 1], ret: value[value.length - 1] / cash0 - 1, mdd };
}
// Plain DCA: the same cash spread evenly over every day of the window
export function simulatePlainDca(price, start, end = price.length - 1, cash0 = 10000) {
  const n = end - start + 1, daily = cash0 / n, value = [];
  let btc = 0, cash = cash0, peak = 0, mdd = 0;
  for (let i = start; i <= end; i++) {
    cash -= daily; btc += daily / price[i];
    const v = cash + btc * price[i];
    value.push(v); peak = Math.max(peak, v); mdd = Math.max(mdd, (peak - v) / peak);
  }
  return { value, final: value[value.length - 1], ret: value[value.length - 1] / cash0 - 1, mdd };
}
export const OPT_GRID = {
  buy: [1, 2, 3, 5, 7.5, 10],
  buyEnd: [10, 15, 20, 25, 30, 35, 40],
  sellStart: [65, 70, 75, 80, 85, 90, 100],
  sellMax: [1, 2, 5, 10],
};
// Walk-forward search: pick the parametric curve with the best final value on
// [start, split), then report it on [split, end] where it was not chosen.
export function optimizeCurve({ price, risk, start, split, end = price.length - 1, cash0 = 10000 }) {
  let best = null, tested = 0;
  for (const buy of OPT_GRID.buy) for (const buyEnd of OPT_GRID.buyEnd) for (const sellStart of OPT_GRID.sellStart) {
    for (const sellMax of (sellStart >= 100 ? [0] : OPT_GRID.sellMax)) {
      const params = { buy, buyEnd, sellStart, sellMax }, vals = paramCurve(params);
      const r = simulateCurve({ price, risk, vals, start, end: split - 1, cash0, keep: false });
      tested++;
      if (!best || r.final > best.train.final) best = { params, vals, train: r };
    }
  }
  best.test = simulateCurve({ price, risk, vals: best.vals, start: split, end, cash0, keep: false });
  best.tested = tested;
  return best;
}

// ── Weekly strategies (unchanged rules from the first backtest) ───────────
export const WEEKLY = [
  { name: 'DCA', color: '#8a9ab8', buy: () => 100, sell: () => 0 },
  { name: 'SDCA', color: '#00d4ff', buy: z => 100 * clamp(1 - z, 0, 3), sell: () => 0 },
  { name: 'SDCA + take profit', color: '#f5a623', buy: z => 100 * clamp(1 - z, 0, 3), sell: z => z >= 3 ? 0.10 : z >= 2 ? 0.05 : 0 },
  { name: 'Risk zones', color: '#b2ff59', buy: z => { const r = riskOfZ(z); return r < 25 ? 200 : r < 50 ? 100 : 0; }, sell: z => riskOfZ(z) >= 75 ? 0.02 : 0 },
];
export function weeklyBacktest(dates, price, z, start) {
  const res = WEEKLY.map(s => ({ ...s, inv: 0, btc: 0, bought: 0, cash: 0, vals: [] })), labels = [];
  const N = price.length;
  for (let i = start; i < N; i++) {
    const p = price[i], zz = z[i], week = (i - start) % 7 === 0;
    for (const r of res) {
      if (week && zz != null) {
        const q = r.sell(zz) * r.btc; r.btc -= q; r.cash += q * p;
        const usd = r.buy(zz); r.inv += usd; r.btc += usd / p; r.bought += usd / p;
      }
      if (week || i === N - 1) r.vals.push(r.inv ? (r.btc * p + r.cash) / r.inv : null);
    }
    if (week || i === N - 1) labels.push(dates[i]);
  }
  return { res, labels };
}

// ── Halving cycles ───────────────────────────────────────────────────────
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];
// values[i] for each day since the halving, from day 0 to maxDays (stops at the data end)
export function cycleSlice(dates, values, halving, maxDays = 1460) {
  const i0 = dates.indexOf(halving);
  if (i0 < 0) return [];
  return values.slice(i0, Math.min(values.length, i0 + maxDays + 1));
}

// ── Correlation ──────────────────────────────────────────────────────────
export function corr(a, b, from = 0, to = a.length - 1) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = from; i <= to; i++) {
    const x = a[i], y = b[i];
    if (x == null || y == null) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < 30) return null;
  const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}
