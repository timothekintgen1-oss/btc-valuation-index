#!/usr/bin/env python3
"""Build the Bitcoin Valuation Index composite and write data.json.

Indicators follow my SDCA sheet (fundamental / technical /
sentiment). Sources, all free:
  - Coin Metrics Community API: price, market cap, MVRV, miner issuance
  - BGeometrics (bitcoin-data.com): AVIV, RHODL, STH-SOPR, CVDD, Terminal Price
    (free tier: ~4 years of history, 7-day delay, 10 requests/hour)
  - alternative.me: Fear & Greed index (since 2018)
  - SDCA signal app (Investing Campus, public page): ChartInspect on-chain
    series it embeds, already smoothed and z-scored (+ = cheap): cost-basis
    profit/loss ratio, on-chain risk composite, realized P/L Sharpe

External series are cached in data/cache/ so their history keeps growing
even though the free tiers only return a limited window, and so one failed
request does not break the daily build.

Method (BVI composite):
  1. Each indicator is oriented so that higher = more expensive, then turned
     into a rolling z-score (6-year window, only past data). The power-law
     fit is also refitted each day on past data only.
  2. The composite is the equal-weight average of the available indicator
     z-scores (as in the SDCA sheet), re-standardised the same way.
     Indicators in OPTIONAL are published but left out of the composite.
  3. Category z-scores (average of their indicators) are kept for display.

Two more models are published next to it (data.json "models"):
  - sdca: the SDCA app's composite, reproduced exactly: mean of three pillars
    (price position in the RAQQR quantile model, cost-basis P/L, on-chain
    risk composite), clamped to ±3. The RAQQR coefficients were fitted on the
    whole 2010-2026 history, so this model sees the future in a backtest.
  - sdca_causal: the same model with the price pillar replaced by the
    past-only power-law residual, to measure how much that hindsight is worth.

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
from datetime import date, datetime, timedelta, timezone

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
MIN_FIT = 2 * 365     # history the power-law fit needs before it is used

# BGeometrics endpoint -> field in its response
BG_SERIES = {
    "aviv": "aviv",
    "rhodl-ratio": "rhodlRatio",
    "sth-sopr": "sthSopr",
    "cvdd": "cvdd",
    "terminal-price": "terminalPrice",
}

# SDCA signal app: public page embedding ChartInspect series as
# `const NAME = {"start": <utc ms>, "values": [...]}` (+ = cheap, - = expensive)
SDCA_URL = "https://sdca-signals-automation-production-bdd2.up.railway.app/"
SDCA_SERIES = {"sdca_cbpl": "CBPL_Z", "sdca_onchain": "ONCHAIN_Z", "sdca_sharpe": "SHARPE_Z"}

# RAQQR price model (Cowen 2026, published full-sample coefficients, as used by
# the SDCA app): Q_tau(log10 price) = c + a·x + b·x², x = ln(days since
# 2009-01-01) − MU. Rows: quantile, c, a, b.
RAQQR_MU = 7.9914
RAQQR_GENESIS = date(2009, 1, 1)
RAQQR_COEF = [
    (0.01, 2.837, 2.578, -0.0241),
    (0.10, 2.933, 2.552, -0.0241),
    (0.25, 3.004, 2.554, -0.0241),
    (0.50, 3.214, 2.482, -0.1126),
    (0.75, 3.562, 2.283, -0.3259),
    (0.95, 3.897, 1.964, -0.3259),
    (0.99, 4.028, 1.904, -0.3259),
]

INDICATORS = [
    # key, label, category, source
    ("mvrv_z", "MVRV Z-Score", "fundamental", "Coin Metrics"),
    ("aviv", "AVIV Ratio", "fundamental", "BGeometrics"),
    ("thermocap", "Thermocap Multiple", "fundamental", "Coin Metrics"),
    ("nupl", "NUPL", "fundamental", "Coin Metrics"),
    ("rhodl", "RHODL Ratio", "fundamental", "BGeometrics"),
    ("price_tools", "CVDD → Terminal Price", "fundamental", "BGeometrics"),
    ("sth_sopr", "STH-SOPR", "fundamental", "BGeometrics"),
    ("cbpl", "Cost Basis P/L Ratio", "fundamental", "ChartInspect (SDCA app)"),
    ("onchain_risk", "On-chain Risk Composite", "fundamental", "ChartInspect (SDCA app)"),
    ("rpl_sharpe", "Realized P/L Sharpe", "fundamental", "ChartInspect (SDCA app)"),
    ("power_law", "Power Law Oscillator", "technical", "Coin Metrics"),
    ("sharpe_52w", "Rolling 52W Sharpe", "technical", "Coin Metrics"),
    ("rsi_monthly", "Monthly RSI (14)", "technical", "Coin Metrics"),
    ("days_higher", "Days Higher Than Price", "technical", "Coin Metrics"),
    ("beam", "BEAM (price / 200W MA)", "technical", "Coin Metrics"),
    ("rainbow", "Rainbow Chart", "technical", "Coin Metrics"),
    ("raqqr", "Quantile Rainbow (RAQQR)", "technical", "Cowen 2026 coefficients"),
    ("fear_greed", "Fear & Greed (7d avg)", "sentiment", "alternative.me"),
]
CATEGORIES = ["fundamental", "technical", "sentiment"]
# Published and selectable on the page, but not in the default composite:
# both are rescaled with the whole history (see HINDSIGHT).
OPTIONAL = {"raqqr", "rpl_sharpe"}
DEFAULT_KEYS = [k for k, *_ in INDICATORS if k not in OPTIONAL]
# Inputs whose construction uses data after the day they describe
# (coefficients fitted on the full history, or full-history percentile ranks).
HINDSIGHT = {"rainbow", "raqqr", "rpl_sharpe", "onchain_risk"}


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


def get_text(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "btc-valuation-index"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"retry {i + 1} {url}: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))


def parse_sdca_series(html, name):
    """Extract `const NAME = {"start": ms, "values": [...]}` from the SDCA app page
    as {iso date: value}; null values (days without data) are skipped."""
    marker = f"const {name}"
    pos = html.find(marker)
    if pos < 0:
        raise ValueError(f"{name} not found in the SDCA page")
    obj, _ = json.JSONDecoder().raw_decode(html[html.index("{", pos):])
    start = datetime.fromtimestamp(obj["start"] / 1000, tz=timezone.utc).date()
    return {(start + timedelta(days=i)).isoformat(): float(v)
            for i, v in enumerate(obj["values"]) if v is not None}


def fetch_sdca():
    """The three on-chain series of the SDCA app, each merged into its own cache."""
    page = {}

    def series(name):
        def fetcher():
            if "html" not in page:
                if "error" in page:          # one failed download is enough for all three
                    raise page["error"]
                try:
                    page["html"] = get_text(SDCA_URL)
                except Exception as e:
                    page["error"] = e
                    raise
            return parse_sdca_series(page["html"], name)
        return fetcher

    return {key: cached(key, series(name)) for key, name in SDCA_SERIES.items()}


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


def expanding_power_law(days, log_price, min_points=MIN_FIT):
    """Residual of log(price) against a power law in time, fitted only on past data.

    Each day, log(price) is regressed on log(days since genesis) using that day
    and the days before it (running OLS sums), so no future price leaks into
    the residual.
    """
    out, n, sx, sy, sxx, sxy = [], 0, 0.0, 0.0, 0.0, 0.0
    for d, y in zip(days, log_price):
        if y is None:
            out.append(None)
            continue
        x = math.log((date.fromisoformat(d) - GENESIS).days)
        n += 1
        sx += x
        sy += y
        sxx += x * x
        sxy += x * y
        den = n * sxx - sx * sx
        if n < min_points or den <= 0:
            out.append(None)
            continue
        b = (n * sxy - sx * sy) / den
        a = (sy - b * sx) / n
        out.append(y - (a + b * x))
    return out


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


def expanding_z(xs, min_periods=365, clip=3.0):
    """z-score against every valid point up to and including this one, clipped."""
    out, n, s, s2 = [], 0, 0.0, 0.0
    for x in xs:
        if x is None:
            out.append(None)
            continue
        n += 1
        s += x
        s2 += x * x
        if n < min_periods:
            out.append(None)
            continue
        mu = s / n
        sd = math.sqrt(max(s2 / n - mu * mu, 0.0)) or 1.0
        out.append(max(-clip, min(clip, (x - mu) / sd)))
    return out


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ── RAQQR quantile model ─────────────────────────────────────────────────
def raqqr_levels(day):
    """Prices of the 1/10/25/50/75/95/99 % quantiles on `day`, ascending
    (sorting is the 'rearrangement' that keeps quantiles from crossing)."""
    t = max(1, (date.fromisoformat(day) - RAQQR_GENESIS).days)
    x = math.log(t) - RAQQR_MU
    return sorted(10 ** (c + a * x + b * x * x) for _, c, a, b in RAQQR_COEF)


def raqqr_position(day, price):
    """Where the price sits in the quantile model, higher = more expensive:
    0 at the median, +3 at the 99 % rail, -3 at the 1 % rail (log-linear in
    between, clipped). This is the SDCA app's EQM z-score with the sign flipped."""
    lv = raqqr_levels(day)
    lo, mid, hi = math.log(lv[0]), math.log(lv[3]), math.log(lv[-1])
    lp = math.log(price)
    if lp <= mid:
        return -clamp(3 * (mid - lp) / (mid - lo), 0.0, 3.0)
    return clamp(3 * (lp - mid) / (hi - mid), 0.0, 3.0)


def sdca_model(pillars):
    """The SDCA app composite: mean of its pillars (here in this file's sign,
    higher = more expensive), clamped to ±3, only on days where every pillar
    has a value — the app never blends a partial set."""
    out = []
    for row in zip(*pillars):
        out.append(None if any(v is None for v in row) else clamp(sum(row) / len(row), -3.0, 3.0))
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

    # Power law: residual against a fit that only sees past prices
    ind["power_law"] = expanding_power_law(days, lp)

    # Rainbow chart regression (published coefficients, fitted after the fact): log10(price) = 2.66167 · ln(days since 2009-01-09) − 17.9183
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

    # SDCA app series are z-scores with + = cheap: flip to this file's orientation
    for key, src in (("cbpl", "sdca_cbpl"), ("onchain_risk", "sdca_onchain"), ("rpl_sharpe", "sdca_sharpe")):
        ind[key] = [-v if v is not None else None for v in ext[src]]

    ind["raqqr"] = [raqqr_position(d, p) for d, p in zip(days, price)]
    return ind


def load_inputs():
    """Fetch every source. Returns days, Coin Metrics columns, the raw external
    {date: value} dicts and the same series aligned on `days`."""
    days, cm = fetch_coinmetrics()
    raw = {k: fetch_bgeometrics(k, f) for k, f in BG_SERIES.items()}
    raw["fear_greed"] = fetch_fear_greed()
    raw.update(fetch_sdca())
    ext = {k: align(days, v) for k, v in raw.items()}
    return days, cm, raw, ext


def composite_of(zi, keys):
    """Equal-weight mean of the indicator z-scores in `keys`, re-standardised."""
    return rolling_z(mean_available([zi[k] for k in keys]), min_periods=MIN_AGG)


def build():
    days, cm, raw, ext = load_inputs()

    # Date of the latest real (not carried-forward) value behind each indicator
    def last_of(k):
        return max((d for d in raw[k] if d <= days[-1]), default=None)

    external = {"aviv": ["aviv"], "rhodl": ["rhodl-ratio"], "sth_sopr": ["sth-sopr"],
                "price_tools": ["cvdd", "terminal-price"], "fear_greed": ["fear_greed"],
                "cbpl": ["sdca_cbpl"], "onchain_risk": ["sdca_onchain"], "rpl_sharpe": ["sdca_sharpe"]}
    asof = {k: days[-1] for k, *_ in INDICATORS}
    for k, sources in external.items():
        dates = [last_of(s) for s in sources]
        asof[k] = min(dates) if all(dates) else None

    ind = compute_indicators(days, cm, ext)
    zi = {k: rolling_z(ind[k]) for k, *_ in INDICATORS}
    cats = {c: composite_of(zi, [k for k, _, cat, _ in INDICATORS if cat == c and k in DEFAULT_KEYS])
            for c in CATEGORIES}
    composite = composite_of(zi, DEFAULT_KEYS)

    # SDCA app model and its causal twin (pillars in this file's sign)
    price_causal = expanding_z(ind["power_law"])
    pillars = {"price": ind["raqqr"], "price_causal": price_causal,
               "cbpl": ind["cbpl"], "onchain": ind["onchain_risk"]}
    sdca = sdca_model([pillars["price"], pillars["cbpl"], pillars["onchain"]])
    sdca_causal = sdca_model([pillars["price_causal"], pillars["cbpl"], pillars["onchain"]])

    idx = [i for i, z in enumerate(composite) if z is not None]

    def col(v, nd=2):
        return [round(v[i], nd) if v[i] is not None else None for i in idx]

    data = {
        "version": 3,
        "source": "Coin Metrics, BGeometrics, alternative.me, ChartInspect via the SDCA app",
        "indicators": [{"key": k, "label": l, "category": c, "source": s,
                        "default": k not in OPTIONAL, "hindsight": k in HINDSIGHT}
                       for k, l, c, s in INDICATORS],
        "dates": [days[i] for i in idx],
        "price": [round(cm["PriceUSD"][i], 2) for i in idx],
        "z": col(composite),
        "category_z": {c: col(v) for c, v in cats.items()},
        "indicator_z": {k: col(v) for k, v in zi.items()},
        "asof": asof,
        "models": {
            "sdca": col(sdca, 4),               # 4 decimals: the app shows its risk to 0.01 %
            "sdca_causal": col(sdca_causal, 4),
            "pillars": {k: col(v) for k, v in pillars.items()},
        },
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    last = len(idx) - 1
    print(f"{data['dates'][0]} -> {data['dates'][last]}: {len(idx)} days, "
          f"Z={data['z'][last]}, price={data['price'][last]}")
    print(f"  SDCA model {data['models']['sdca'][last]}  causal twin {data['models']['sdca_causal'][last]}")
    for k, l, *_ in INDICATORS:
        flag = "" if k in DEFAULT_KEYS else "  [optional]"
        print(f"  {l:28s} {data['indicator_z'][k][last]}  (as of {asof[k]}){flag}")


if __name__ == "__main__":
    build()
