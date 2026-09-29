#!/usr/bin/env python3
"""Detect a change of valuation zone and describe it for a GitHub issue.

Compares the latest composite Z in data.json with the zone recorded in
data/alert_state.json. A new zone only counts once Z is at least HYSTERESIS
inside it, so a Z hovering on a boundary does not raise an alert every day.

Writes the issue title/body to $GITHUB_OUTPUT (alert=true|false) and updates
the state file. Standard library only.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data.json")
STATE = os.path.join(ROOT, "data", "alert_state.json")
SITE = "https://timothekintgen1-oss.github.io/btc-valuation-index/"
HYSTERESIS = 0.1

# Same zones as the page: (lower bound, name)
ZONES = [(-99, "Extreme Buy"), (-2, "Undervalued"), (-1, "Fair Value"),
         (1, "Elevated"), (2, "Overvalued"), (3, "Extreme Sell")]


def zone_index(z):
    i = 0
    for k, (lo, _) in enumerate(ZONES):
        if z >= lo:
            i = k
    return i


def sdca_label(score):
    """Labels of the SDCA sheet, on the sheet's convention (score = -Z)."""
    if score <= -1.5:
        return "No Value"
    if score < 0:
        return "Low Value"
    if score == 0:
        return "Neutral"
    if score < 1.5:
        return "Value"
    return "High Value"


def main():
    with open(DATA) as f:
        d = json.load(f)
    date, z, price = d["dates"][-1], d["z"][-1], d["price"][-1]
    new = zone_index(z)

    state = {}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state = json.load(f)
    old = state.get("zone")

    alert = False
    if old is None:
        state = {"zone": new, "date": date, "z": z}          # first run: just record
    elif new != old:
        # distance inside the new zone from the boundary we crossed
        boundary = ZONES[new][0] if new > old else ZONES[new + 1][0]
        if abs(z - boundary) >= HYSTERESIS:
            alert = True
            prev = state
            state = {"zone": new, "date": date, "z": z}

    with open(STATE, "w") as f:
        json.dump(state, f, indent=2)

    out = os.environ.get("GITHUB_OUTPUT")
    lines = [f"alert={'true' if alert else 'false'}"]
    if alert:
        direction = "cheaper" if new < old else "more expensive"
        title = f"BTC valuation: {ZONES[old][1]} → {ZONES[new][1]} (Z = {z:+.2f})"
        body = "\n".join([
            f"The composite moved into **{ZONES[new][1]}** on {date} ({direction}).",
            "",
            f"| | Previous | Now |",
            f"|---|---|---|",
            f"| Zone | {ZONES[old][1]} ({prev['date']}) | {ZONES[new][1]} ({date}) |",
            f"| Z-score | {prev['z']:+.2f} | {z:+.2f} |",
            f"| SDCA score (sheet convention) | {-prev['z']:+.2f} · {sdca_label(-prev['z'])} | {-z:+.2f} · {sdca_label(-z)} |",
            f"| BTC price | | ${price:,.0f} |",
            "",
            f"Dashboard: {SITE}",
        ])
        lines += [f"title={title}", "body<<EOF", body, "EOF"]
        print(title)
    else:
        print(f"No zone change ({ZONES[new][1]}, Z = {z:+.2f})")
    if out:
        with open(out, "a") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
