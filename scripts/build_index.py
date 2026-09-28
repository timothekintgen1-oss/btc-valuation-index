#!/usr/bin/env python3
"""Build the Bitcoin Valuation Index composite and write data.json.

Indicators follow the Montaigne SDCA sheet (fundamental / technical /
sentiment). Sources, all free:
  - Coin Metrics Community API: price, market cap, MVRV, miner issuance
  - BGeometrics (bitcoin-data.com): AVIV, RHODL, STH-SOPR, CVDD, Terminal Price
    (free tier: ~4 years of history, 7-day delay, 10 requests/hour)
  - alternative.me: Fear & Greed index (since 2018)

External series are cached in data/cache/ so their history keeps growing
even though the free tiers only return a limited window, and so one failed
request does not break the daily build.

Method:
  1. Each indicator is oriented so that higher = more expensive, then turned
     into a rolling z-score (6-year window, only past data).
  2. The composite is the equal-weight average of the available indicator
     z-scores (as in the SDCA sheet), re-standardised the same way.
  3. Category z-scores (average of their indicators) are kept for display.

Standard library only, so the GitHub Action needs no dependencies.
"""
import bisect
import json
import math
import os
import sys
import time
import urllib.request
from collections import deque
from datetime import date

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data.json")
CACHE = os.path.join(ROOT, "data", "cache")

CM_API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
CM_METRICS = ["PriceUSD", "CapMrktCurUSD", "CapMVRVCur", "IssTotUSD"]
FETCH_START = "2010-07-18"
GENESIS = date(2009, 1, 3)

WINDOW = 6 * 365      # rolling standardisation window (days)
MIN_METRIC = 180      # history an indicator needs before it gets a z-score
MIN_AGG = 90          # same, for category and composite layers
MAX_FFILL = 10        # days a delayed external series may be carried forward

# BGeometrics endpoint -> field in its response
BG_SERIES = {
    "aviv": "aviv",
    "rhodl-ratio": "rhodlRatio",
    "sth-sopr": "sthSopr",
    "cvdd": "cvdd",
    "terminal-price": "terminalPrice",
}

INDICATORS = [
    # key, label, category, source
    ("mvrv_z", "MVRV Z-Score", "fundamental", "Coin Metrics"),
    ("aviv", "AVIV Ratio", "fundamental", "BGeometrics"),
    ("thermocap", "Thermocap Multiple", "fundamental", "Coin Metrics"),
    ("nupl", "NUPL", "fundamental", "Coin Metrics"),
    ("rhodl", "RHODL Ratio", "fundamental", "BGeometrics"),
    ("price_tools", "CVDD → Terminal Price", "fundamental", "BGeometrics"),
    ("sth_sopr", "STH-SOPR", "fundamental", "BGeometrics"),
    ("power_law", "Power Law Oscillator", "technical", "Coin Metrics"),
    ("sharpe_52w", "Rolling 52W Sharpe", "technical", "Coin Metrics"),
    ("rsi_monthly", "Monthly RSI (14)", "technical", "Coin Metrics"),
    ("days_higher", "Days Higher Than Price", "technical", "Coin Metrics"),
    ("beam", "BEAM (price / 200W MA)", "technical", "Coin Metrics"),
    ("rainbow", "Rainbow Chart", "technical", "Coin Metrics"),
    ("fear_greed", "Fear & Greed (7d avg)", "sentiment", "alternative.me"),
]
CATEGORIES = ["fundamental", "technical", "sentiment"]


# ── Fetch ────────────────────────────────────────────────────────────────
def get_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "btc-valuation-index"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network hiccup: back off and retry
            if i == tries - 1:
                raise
            print(f"retry {i + 1} {url}: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))


def fetch_coinmetrics():
    url = (f"{CM_API}?assets=btc&metrics={','.join(CM_METRICS)}&frequency=1d"
           f"&start_time={FETCH_START}&page_size=10000&paging_from=start")
    rows = []
    while url:
        d = get_json(url)
        rows += d.get("data", [])
        url = d.get("next_page_url")
    out = {}
    for r in rows:
        vals = {m: float(r[m]) if r.get(m) not in (None, "") else None for m in CM_METRICS}
        if vals["PriceUSD"] and vals["PriceUSD"] > 0:
            out[r["time"][:10]] = vals
    days = sorted(out)
    return days, {m: [out[d][m] for d in days] for m in CM_METRICS}


def cached(name, fetcher):
    """Merge freshly fetched {date: value} into the cache; fall back to cache on error."""
    path = os.path.join(CACHE, name + ".json")
    old = {}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
    try:
        new = fetcher()
        if not new:
            raise ValueError("empty response")
        old.update(new)
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "w") as f:
            json.dump(dict(sorted(old.items())), f, separators=(",", ":"))
    except Exception as e:
        print(f"WARNING {name}: {e} — using cache ({len(old)} days)", file=sys.stderr)
    return old


def fetch_bgeometrics(endpoint, field):
    def fetcher():
        rows = get_json(f"https://bitcoin-data.com/v1/{endpoint}", tries=1)  # 429s: retrying only burns quota
        if not isinstance(rows, list):
            raise ValueError(str(rows)[:200])
        return {r["d"]: float(r[field]) for r in rows if r.get(field) is not None}
    return cached("bg_" + endpoint, fetcher)


def fetch_fear_greed():
    def fetcher():
        rows = get_json("https://api.alternative.me/fng/?limit=0&format=json")["data"]
        return {date.fromtimestamp(int(r["timestamp"])).isoformat(): float(r["value"]) for r in rows}
    return cached("fear_greed", fetcher)


def align(days, series):
    """Map a {date: value} dict onto `days`, carrying values forward up to MAX_FFILL days."""
    out, last, age = [], None, 0
    for d in days:
        if d in series:
            last, age = series[d], 0
        else:
            age += 1
        out.append(last if last is not None and age <= MAX_FFILL else None)
    return out


# ── Series helpers (None = missing) ──────────────────────────────────────
def sma(xs, n):
    out, q, s = [], deque(), 0.0
    for x in xs:
        if x is None:
            q.clear()
            s = 0.0
            out.append(None)
            continue
        q.append(x)
        s += x
        if len(q) > n:
            s -= q.popleft()
        out.append(s / n if len(q) == n else None)
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


# ── Indicators (higher = more expensive) ─────────────────────────────────
def monthly_rsi(days, price, n=14):
    """Wilder RSI(14) on monthly closes; the current month's close is the day's price."""
    out, gains, avg, prev_close = [], [], None, None
    for i, (d, p) in enumerate(zip(days, price)):
        if avg is not None:
            ch = p - prev_close
            ag = (avg[0] * (n - 1) + max(ch, 0.0)) / n
            al = (avg[1] * (n - 1) + max(-ch, 0.0)) / n
            out.append(100.0 if al == 0 else 100 - 100 / (1 + ag / al))
        else:
            out.append(None)
        if i + 1 < len(days) and days[i + 1][:7] != d[:7]:  # today closes the month
            if prev_close is not None:
                ch = p - prev_close
                g, l = max(ch, 0.0), max(-ch, 0.0)
                if avg is None:
                    gains.append((g, l))
                    if len(gains) == n:
                        avg = (sum(x[0] for x in gains) / n, sum(x[1] for x in gains) / n)
                else:
                    avg = ((avg[0] * (n - 1) + g) / n, (avg[1] * (n - 1) + l) / n)
            prev_close = p
    return out


def compute_indicators(days, cm, ext):
    price, mc, mvrv, iss = (cm[m] for m in CM_METRICS)
    lp = [safe_log(p) for p in price]
    ind = {}

    # MVRV — log ratio; the rolling z-score plays the role of the MVRV Z denominator
    ind["mvrv_z"] = [safe_log(x) for x in mvrv]
    ind["nupl"] = [1 - 1 / x if x else None for x in mvrv]

    # Thermocap multiple: market cap / cumulative miner issuance (fees not in free data)
    cum, therm = 0.0, []
    for m, i in zip(mc, iss):
        cum += i or 0.0
        therm.append(safe_log(m / cum) if m and cum else None)
    ind["thermocap"] = therm

    ind["aviv"] = [safe_log(x) for x in ext["aviv"]]
    ind["rhodl"] = [safe_log(x) for x in ext["rhodl-ratio"]]
    ind["sth_sopr"] = sma(ext["sth-sopr"], 7)

    # Position of price between CVDD (0) and Terminal Price (1), in log space
    tools = []
    for p, lo, hi in zip(price, ext["cvdd"], ext["terminal-price"]):
        ok = lo and hi and hi > lo
        tools.append((math.log(p) - math.log(lo)) / (math.log(hi) - math.log(lo)) if ok else None)
    ind["price_tools"] = tools

    # Power law: log(price) vs log(days since genesis), residual
    t = [math.log((date.fromisoformat(d) - GENESIS).days) for d in days]
    a, b = ols(t, lp)
    ind["power_law"] = [y - (a + b * x) if y is not None else None for x, y in zip(t, lp)]

    # Rainbow chart regression: log10(price) = 2.66167 · ln(days since 2009-01-09) − 17.9183
    r0 = date(2009, 1, 9)
    ind["rainbow"] = [math.log10(p) - (2.66167 * math.log((date.fromisoformat(d) - r0).days) - 17.9183)
                      for d, p in zip(days, price)]

    # Rolling 52-week Sharpe (annualised, risk-free rate ignored)
    rets = [None] + [math.log(price[i] / price[i - 1]) for i in range(1, len(price))]
    sharpe, win, s, s2 = [], deque(), 0.0, 0.0
    for r in rets:
        if r is not None:
            win.append(r)
            s += r
            s2 += r * r
            if len(win) > 365:
                o = win.popleft()
                s -= o
                s2 -= o * o
        n = len(win)
        sd = math.sqrt(max(s2 / n - (s / n) ** 2, 0.0)) if n else 0.0
        sharpe.append((s / n) / sd * math.sqrt(365) if n == 365 and sd else None)
    ind["sharpe_52w"] = sharpe

    ind["rsi_monthly"] = monthly_rsi(days, price)

    # Share of past days that closed above today's price (high = cheap, so negate)
    seen, dh = [], []
    for p in price:
        dh.append(-(len(seen) - bisect.bisect_right(seen, p)) / len(seen) if len(seen) >= 365 else None)
        bisect.insort(seen, p)
    ind["days_higher"] = dh

    # BEAM approximation: log(price / 200-week moving average)
    p1400 = sma(price, 1400)
    ind["beam"] = [safe_log(p / m) if m else None for p, m in zip(price, p1400)]

    ind["fear_greed"] = sma(ext["fear_greed"], 7)
    return ind


def build():
    days, cm = fetch_coinmetrics()
    ext = {k: align(days, fetch_bgeometrics(k, f)) for k, f in BG_SERIES.items()}
    ext["fear_greed"] = align(days, fetch_fear_greed())

    ind = compute_indicators(days, cm, ext)
    zi = {k: rolling_z(ind[k]) for k, *_ in INDICATORS}
    cats = {c: rolling_z(mean_available([zi[k] for k, _, cat, _ in INDICATORS if cat == c]),
                         min_periods=MIN_AGG) for c in CATEGORIES}
    composite = rolling_z(mean_available(list(zi.values())), min_periods=MIN_AGG)

    idx = [i for i, z in enumerate(composite) if z is not None]
    r2 = lambda x: round(x, 2) if x is not None else None
    data = {
        "source": "Coin Metrics, BGeometrics, alternative.me",
        "indicators": [{"key": k, "label": l, "category": c, "source": s} for k, l, c, s in INDICATORS],
        "dates": [days[i] for i in idx],
        "price": [round(cm["PriceUSD"][i], 2) for i in idx],
        "z": [r2(composite[i]) for i in idx],
        "category_z": {c: [r2(v[i]) for i in idx] for c, v in cats.items()},
        "indicator_z": {k: [r2(v[i]) for i in idx] for k, v in zi.items()},
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    last = len(idx) - 1
    print(f"{data['dates'][0]} -> {data['dates'][last]}: {len(idx)} days, "
          f"Z={data['z'][last]}, price={data['price'][last]}")
    for k, l, *_ in INDICATORS:
        print(f"  {l:28s} {data['indicator_z'][k][last]}")


if __name__ == "__main__":
    build()
