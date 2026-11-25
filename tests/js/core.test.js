// Unit tests for assets/js/core.js — run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../../assets/js/core.js';

const D = JSON.parse(readFileSync(new URL('../../data.json', import.meta.url)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('rollingZ follows the pipeline definition and ignores the future', () => {
  near(C.rollingZ([1, 2, 3], 10, 3)[2], 1 / Math.sqrt(2 / 3), 1e-12);
  const xs = Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) + i / 100);
  const a = C.rollingZ(xs, 200, 50), b = C.rollingZ([...xs.slice(0, 300), ...Array(100).fill(1e6)], 200, 50);
  assert.deepEqual(a.slice(0, 300), b.slice(0, 300));
  assert.deepEqual(C.rollingZ([1, null, 2, 3], 10, 3).slice(0, 2), [null, null]);
});

test('default composite is the published one; a recomputed default matches it', () => {
  const keys = C.defaultKeys(D);
  assert.equal(C.compositeZ(D, keys), D.z);
  const re = C.rollingZ(C.meanAvailable(keys.map(k => D.indicator_z[k]))).map(C.round2);
  const from = D.dates.indexOf('2018-01-01');
  for (let i = from; i < D.dates.length; i++) near(re[i], D.z[i], 0.03, D.dates[i]);
});

test('risk mappings', () => {
  assert.equal(C.riskOfZ(0), 50);
  near(C.riskOfZ(1), 84.134, 0.001);
  near(C.riskOfModelZ(-1.9607), 17.32, 0.01);           // the SDCA app showed 17.3 % on 2026-11-23
  assert.equal(C.riskOfModelZ(5), 100);
  assert.equal(C.riskZone(24.9).label, 'BUY ZONE');
  assert.equal(C.riskZone(75).label, 'SELL ZONE');
  assert.equal(C.signal(-1).label, 'FAIR VALUE');
  assert.equal(C.signal(-1.01).label, 'UNDERVALUED');
});

test('RAQQR matches the SDCA app and the Python pipeline', () => {
  const lv = C.raqqrLevels(C.msOf('2026-11-24'));
  near(lv[0] / 73778, 1, 1e-3); near(lv[3] / 129714, 1, 1e-3); near(lv[6] / 215712, 1, 1e-3);
  near(C.raqqrPosition(C.msOf('2021-11-10'), 66954), 2.916, 0.01);
  assert.equal(C.raqqrRisk(C.msOf('2026-11-24'), 50000), 1);
  let worst = 0;
  D.dates.forEach((d, i) => { worst = Math.max(worst, Math.abs(C.round2(C.raqqrPosition(C.msOf(d), D.price[i])) - D.models.pillars.price[i])); });
  assert.ok(worst <= 0.011, `max diff with Python ${worst}`);
});

test('signals: SDCA risk today matches the app', () => {
  const S = C.buildSignals(D, C.defaultKeys(D));
  const i = D.dates.indexOf('2026-11-23');
  if (i >= 0) near(S.sdca.risk[i], 17.33, 0.05);
  assert.equal(S.bvi.z, D.z);
  assert.equal(S.consensus.risk.length, D.dates.length);
});

test('curve rate and the parametric curve', () => {
  near(C.curveRate(C.CURVE_PRESETS.sdca.vals, 17.32), 7.68, 0.01);   // app: BUY 7.68 % of cash
  assert.equal(C.curveRate(C.CURVE_PRESETS.sdca.vals, 100), -10);
  assert.equal(C.curveRate(C.CURVE_PRESETS.sdca.vals, null), 0);
  const v = C.paramCurve({ buy: 10, buyEnd: 20, sellStart: 85, sellMax: 9 });
  assert.equal(v.length, 21);
  assert.deepEqual(v.slice(0, 5), [10, 10, 10, 5, 0]);
  assert.deepEqual(v.slice(-3), [-3, -6, -9]);
  assert.ok(C.paramCurve({ buy: 5, buyEnd: 30, sellStart: 100, sellMax: 0 }).every(x => x >= 0));
});

test('simulations conserve value at a constant price', () => {
  const price = Array(200).fill(100), risk = Array(200).fill(0);
  const r = C.simulateCurve({ price, risk, vals: C.CURVE_PRESETS.sdca.vals, start: 0, cash0: 1000 });
  near(r.final, 1000, 1e-9);
  assert.ok(r.btc > 9.9 && r.cashLeft < 1);              // 10 %/day for 200 days ≈ fully deployed
  near(C.simulatePlainDca(price, 0, 199, 1000).final, 1000, 1e-9);
  near(C.simulateBuyHold(price, 0, 199, 1000).final, 1000, 1e-9);
});

test('simulation sells into high risk and tracks drawdown', () => {
  const price = [100, 100, 200, 200, 100], risk = [0, 0, 100, 100, 50];
  const r = C.simulateCurve({ price, risk, vals: C.CURVE_PRESETS.sdca.vals, start: 0, cash0: 100 });
  assert.equal(r.buyDays, 2); assert.equal(r.sellDays, 2);
  assert.ok(r.mdd > 0 && r.mdd < 0.5);
});

test('optimizer picks the best training curve and reports it out of sample', () => {
  const n = 1200, price = Array.from({ length: n }, (_, i) => 100 * Math.exp(Math.sin(i / 90))), risk = price.map((_, i) => 50 + 50 * Math.sin(i / 90));
  const best = C.optimizeCurve({ price, risk, start: 0, split: 800, cash0: 1000 });
  assert.ok(best.tested > 100);
  for (const p of [{ buy: 1, buyEnd: 10, sellStart: 100, sellMax: 0 }, { buy: 10, buyEnd: 40, sellStart: 65, sellMax: 10 }]) {
    const r = C.simulateCurve({ price, risk, vals: C.paramCurve(p), start: 0, end: 799, cash0: 1000, keep: false });
    assert.ok(best.train.final >= r.final);
  }
  assert.equal(best.test.days, n - 800);
});

test('weekly backtest: plain DCA at a constant price returns ×1', () => {
  const n = 70, dates = Array.from({ length: n }, (_, i) => C.isoOf(Date.UTC(2020, 0, 1 + i)));
  const { res } = C.weeklyBacktest(dates, Array(n).fill(50), Array(n).fill(0), 0);
  near(res[0].vals.at(-1), 1, 1e-12);
});

test('correlation and cycles', () => {
  const a = Array.from({ length: 100 }, (_, i) => i);
  near(C.corr(a, a), 1, 1e-12);
  near(C.corr(a, a.map(x => -2 * x)), -1, 1e-12);
  assert.equal(C.corr(a.slice(0, 10), a.slice(0, 10)), null);   // too few points
  const s = C.cycleSlice(D.dates, D.price, '2016-07-09', 10);
  assert.equal(s.length, 11);
  assert.equal(s[0], D.price[D.dates.indexOf('2016-07-09')]);
});
