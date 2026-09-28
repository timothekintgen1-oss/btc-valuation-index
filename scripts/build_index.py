#!/usr/bin/env python3
"""Build the Bitcoin Valuation Index composite and write data.json.

Source: Coin Metrics Community API (free, no key, daily history since 2010).

Method — "aggregate of aggregates", three layers of z-scores:
  1. Each metric is transformed so that higher = more expensive, then turned
     into a rolling z-score (6-year window, only past data).
  2. Metric z-scores are averaged within their group; each group average is
     re-standardised the same way.
  3. Group z-scores are averaged and re-standardised -> composite Z.

Rolling windows use only data available on each day, so past readings are
not revised when new data arrives (the one exception is the power-law fit
behind `log_regression`, which uses the full history).

Standard library only, so the GitHub Action needs no dependencies.
"""
import json
import math
import os
import sys
import time
import urllib.request
from collections import deque
from datetime import date

API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
METRICS = ["PriceUSD", "CapMVRVCur", "IssTotUSD"]
FETCH_START = "2010-07-18"
GENESIS = date(2009, 1, 3)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data.json")

WINDOW = 6 * 365      # rolling standardisation window (days)
MIN_METRIC = 180      # history a metric needs before it gets a z-score
MIN_AGG = 90          # same, for group and composite layers

GROUPS = {
    "onchain": ["mvrv", "puell"],
    "cycle": ["mayer", "wma200", "pi_cycle", "log_regression"],
}


# ── Fetch ────────────────────────────────────────────────────────────────
def get_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "btc-valuation-index"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network hiccup or rate limit: back off and retry
            if i == tries - 1:
                raise
            print(f"retry {i + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))


def fetch():
    url = (f"{API}?assets=btc&metrics={','.join(METRICS)}&frequency=1d"
           f"&start_time={FETCH_START}&page_size=10000&paging_from=start")
    rows = []
    while url:
        d = get_json(url)
        rows += d.get("data", [])
        url = d.get("next_page_url")
    out = {}
    for r in rows:
        vals = {m: float(r[m]) if r.get(m) not in (None, "") else None for m in METRICS}
        if vals["PriceUSD"] and vals["PriceUSD"] > 0:
            out[r["time"][:10]] = vals
    days = sorted(out)
    return days, {m: [out[d][m] for d in days] for m in METRICS}


# ── Series helpers (None = missing) ──────────────────────────────────────
def sma(xs, n):
    out = []
    for i in range(len(xs)):
        w = xs[i - n + 1:i + 1] if i >= n - 1 else None
        out.append(sum(w) / n if w and None not in w else None)
    return out


def safe_log(x):
    return math.log(x) if x is not None and x > 0 else None


def ols(xs, ys):
    pts = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    b = sum((x - mx) * (y - my) for x, y in pts) / sum((x - mx) ** 2 for x, _ in pts)
    return my - b * mx, b


def rolling_z(xs, window=WINDOW, min_periods=MIN_METRIC):
    """z-score of each point against the trailing `window` valid points."""
    out, hist, s, s2 = [], deque(), 0.0, 0.0
    for x in xs:
        if x is None:
            out.append(None)
            continue
        hist.append(x)
        s += x
        s2 += x * x
        if len(hist) > window:
            old = hist.popleft()
            s -= old
            s2 -= old * old
        n = len(hist)
        if n < min_periods:
            out.append(None)
            continue
        mu = s / n
        sd = math.sqrt(max(s2 / n - mu * mu, 0.0)) or 1.0
        out.append((x - mu) / sd)
    return out


def mean_available(cols):
    out = []
    for row in zip(*cols):
        v = [x for x in row if x is not None]
        out.append(sum(v) / len(v) if v else None)
    return out


# ── Metrics (higher = more expensive) ────────────────────────────────────
def compute_metrics(days, s):
    price, mvrv, iss = s["PriceUSD"], s["CapMVRVCur"], s["IssTotUSD"]

    # Market value / realised value
    mvrv_log = [safe_log(x) for x in mvrv]

    # Puell multiple: daily miner issuance (USD) vs its 365-day average
    iss_ma = sma(iss, 365)
    puell = [safe_log(i / a) if i and a else None for i, a in zip(iss, iss_ma)]

    # Mayer multiple: price vs 200-day moving average
    p200 = sma(price, 200)
    mayer = [safe_log(p / a) if a else None for p, a in zip(price, p200)]

    # Price vs 200-week moving average
    p1400 = sma(price, 1400)
    wma200 = [safe_log(p / a) if a else None for p, a in zip(price, p1400)]

    # Pi cycle: 111-day MA vs 2 × 350-day MA
    p111, p350 = sma(price, 111), sma(price, 350)
    pi_cycle = [safe_log(a / (2 * b)) if a and b else None for a, b in zip(p111, p350)]

    # Power-law residual: log(price) vs log(days since genesis)
    t = [math.log((date.fromisoformat(d) - GENESIS).days) for d in days]
    lp = [safe_log(p) for p in price]
    a, b = ols(t, lp)
    log_regression = [y - (a + b * x) if y is not None else None for x, y in zip(t, lp)]

    return {
        "mvrv": mvrv_log, "puell": puell,
        "mayer": mayer, "wma200": wma200, "pi_cycle": pi_cycle,
        "log_regression": log_regression,
    }


def build():
    days, s = fetch()
    metrics = compute_metrics(days, s)

    zm = {k: rolling_z(v) for k, v in metrics.items()}
    groups = {g: rolling_z(mean_available([zm[k] for k in ks]), min_periods=MIN_AGG)
              for g, ks in GROUPS.items()}
    composite = rolling_z(mean_available(list(groups.values())), min_periods=MIN_AGG)

    idx = [i for i, z in enumerate(composite) if z is not None]
    r2 = lambda x: round(x, 2) if x is not None else None
    data = {
        "source": "Coin Metrics Community API",
        "groups": GROUPS,
        "dates": [days[i] for i in idx],
        "price": [round(s["PriceUSD"][i], 2) for i in idx],
        "z": [r2(composite[i]) for i in idx],
        "group_z": {g: [r2(v[i]) for i in idx] for g, v in groups.items()},
        "metric_z": {k: [r2(v[i]) for i in idx] for k, v in zm.items()},
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    last = len(idx) - 1
    print(f"{data['dates'][0]} -> {data['dates'][last]}: {len(idx)} days, "
          f"Z={data['z'][last]}, price={data['price'][last]}")


if __name__ == "__main__":
    build()
