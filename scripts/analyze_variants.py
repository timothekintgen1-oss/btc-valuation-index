#!/usr/bin/env python3
"""Robustness check: how much do the weighting choices matter?

Rebuilds the indicator z-scores exactly as build_index.py does, then compares
the published composite with three alternatives:
  - without NUPL (a direct transform of MVRV: NUPL = 1 - 1/MVRV)
  - equal weight per category (fundamental / technical / sentiment)
  - both

Prints, as Markdown: the most correlated indicator pairs, the composite at
past cycle highs and lows, and the weekly SDCA backtest of each variant.
Analysis only: data.json is not modified. Standard library only.
"""
import itertools
import math

import build_index as bi

KEY_DATES = {
    "2017-12-17": "Sommet 2017", "2018-12-15": "Creux 2018", "2021-04-14": "Haut avril 2021",
    "2021-11-10": "Sommet nov. 2021", "2022-11-21": "Creux 2022", "2024-03-14": "Haut mars 2024",
    "2025-10-06": "Sommet oct. 2025",
}


def corr(a, b):
    pts = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    n = len(pts)
    mx, my = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    sxy = sum((x - mx) * (y - my) for x, y in pts)
    sx = math.sqrt(sum((x - mx) ** 2 for x, _ in pts))
    sy = math.sqrt(sum((y - my) ** 2 for _, y in pts))
    return sxy / (sx * sy)


def sdca(days, price, z, year):
    """Weekly buys of 100 x (1 - Z), capped at 300 and floored at 0 (same rule as the page)."""
    i0 = next(i for i, d in enumerate(days) if d >= f"{year}-01-01")
    invested = btc = 0.0
    for i in range(i0, len(days), 7):
        if z[i] is None:
            continue
        amount = max(0.0, min(300.0, 100 * (1 - z[i])))
        invested += amount
        btc += amount / price[i]
    return btc * price[-1] / invested, invested / btc


def main():
    days, cm = bi.fetch_coinmetrics()
    raw = {k: bi.fetch_bgeometrics(k, f) for k, f in bi.BG_SERIES.items()}
    raw["fear_greed"] = bi.fetch_fear_greed()
    ext = {k: bi.align(days, v) for k, v in raw.items()}
    ind = bi.compute_indicators(days, cm, ext)
    zi = {k: bi.rolling_z(ind[k]) for k, *_ in bi.INDICATORS}
    label = {k: l for k, l, *_ in bi.INDICATORS}
    category = {k: c for k, _, c, _ in bi.INDICATORS}
    keys = list(zi)
    price = cm["PriceUSD"]

    def composite(ks, by_category=False):
        if by_category:
            groups = [[zi[k] for k in ks if category[k] == c] for c in bi.CATEGORIES]
            layer = bi.mean_available([bi.mean_available(g) for g in groups if g])
        else:
            layer = bi.mean_available([zi[k] for k in ks])
        return bi.rolling_z(layer, min_periods=bi.MIN_AGG)

    no_nupl = [k for k in keys if k != "nupl"]
    variants = {
        "Publié (14, poids égaux)": composite(keys),
        "Sans NUPL": composite(no_nupl),
        "Par catégorie": composite(keys, by_category=True),
        "Par catégorie, sans NUPL": composite(no_nupl, by_category=True),
    }

    print("### Indicateurs très corrélés (corrélation des z-scores > 0,85)\n")
    print("| Paire | Corrélation |\n|---|---|")
    pairs = sorted(((corr(zi[a], zi[b]), a, b) for a, b in itertools.combinations(keys, 2)), reverse=True)
    for r, a, b in pairs:
        if r > 0.85:
            print(f"| {label[a]} / {label[b]} | {r:.2f} |")

    names = list(variants)
    print("\n### Composite aux sommets et creux de cycle\n")
    print("| Date | " + " | ".join(names) + " |\n" + "|---" * (len(names) + 1) + "|")
    for d, name in KEY_DATES.items():
        i = days.index(d)
        print(f"| {name} | " + " | ".join(f"{variants[n][i]:+.2f}" for n in names) + " |")

    print("\n### Backtest SDCA : valeur / montant investi (prix moyen d'achat)\n")
    print("| Départ | " + " | ".join(names) + " |\n" + "|---" * (len(names) + 1) + "|")
    for year in (2017, 2019, 2021, 2023):
        cells = []
        for n in names:
            x, avg = sdca(days, price, variants[n], year)
            cells.append(f"×{x:.2f} ({avg:,.0f} $)".replace(",", " "))
        print(f"| {year} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
