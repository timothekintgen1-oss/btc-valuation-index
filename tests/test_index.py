"""Unit tests for the index pipeline. Standard library only:

    python -m unittest discover -s tests -v
"""
import math
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import build_index as bi  # noqa: E402
import zone_alert as za  # noqa: E402


def daily(start, n):
    d0 = date.fromisoformat(start)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(n)]


class TestNoLookAhead(unittest.TestCase):
    """Changing the future must never change a value already computed."""

    def test_rolling_z_ignores_future(self):
        xs = [math.sin(i / 7) + i / 100 for i in range(400)]
        future = xs[:300] + [1e6] * 100
        a = bi.rolling_z(xs, window=200, min_periods=50)
        b = bi.rolling_z(future, window=200, min_periods=50)
        self.assertEqual(a[:300], b[:300])

    def test_power_law_ignores_future(self):
        days = daily("2012-01-01", 1500)
        lp = [math.log(10 + i) for i in range(1500)]
        crash = lp[:1000] + [0.0] * 500
        a = bi.expanding_power_law(days, lp, min_points=100)
        b = bi.expanding_power_law(days, crash, min_points=100)
        self.assertEqual(a[:1000], b[:1000])

    def test_power_law_recovers_exact_fit(self):
        days = daily("2012-01-01", 800)
        t = [math.log((date.fromisoformat(d) - bi.GENESIS).days) for d in days]
        lp = [1.5 + 5.8 * x for x in t]          # a perfect power law
        res = bi.expanding_power_law(days, lp, min_points=100)
        self.assertIsNone(res[98])
        for r in res[100:]:
            self.assertAlmostEqual(r, 0.0, places=6)


class TestRollingZ(unittest.TestCase):
    def test_constant_series_is_zero(self):
        z = bi.rolling_z([5.0] * 30, window=10, min_periods=5)
        self.assertEqual(z[:4], [None] * 4)
        self.assertTrue(all(v == 0.0 for v in z[4:]))

    def test_known_value(self):
        z = bi.rolling_z([1.0, 2.0, 3.0], window=10, min_periods=3)
        # mean 2, population std sqrt(2/3)
        self.assertAlmostEqual(z[2], 1 / math.sqrt(2 / 3))

    def test_missing_values_are_skipped(self):
        z = bi.rolling_z([1.0, None, 2.0, 3.0], window=10, min_periods=3)
        self.assertIsNone(z[1])
        self.assertAlmostEqual(z[3], 1 / math.sqrt(2 / 3))


class TestHelpers(unittest.TestCase):
    def test_sma(self):
        self.assertEqual(bi.sma([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_sma_restarts_after_gap(self):
        self.assertEqual(bi.sma([1, 2, None, 3, 4], 2), [None, 1.5, None, None, 3.5])

    def test_align_carries_forward_with_limit(self):
        days = daily("2024-01-01", 15)
        out = bi.align(days, {"2024-01-01": 7.0})
        self.assertEqual(out[: bi.MAX_FFILL + 1], [7.0] * (bi.MAX_FFILL + 1))
        self.assertIsNone(out[bi.MAX_FFILL + 1])

    def test_mean_available(self):
        self.assertEqual(bi.mean_available([[1, None, None], [3, 4, None]]), [2, 4, None])

    def test_monthly_rsi_bounds(self):
        days = daily("2015-01-01", 3 * 365)
        price = [100 + 50 * math.sin(i / 60) + i / 10 for i in range(len(days))]
        rsi = bi.monthly_rsi(days, price)
        values = [v for v in rsi if v is not None]
        self.assertIsNone(rsi[300])               # needs 14 monthly closes
        self.assertTrue(values)
        self.assertTrue(all(0 <= v <= 100 for v in values))


class TestZones(unittest.TestCase):
    def test_zone_boundaries(self):
        names = [za.ZONES[za.zone_index(z)][1] for z in (-2.5, -1.5, 0, 1.5, 2.5, 3.5)]
        self.assertEqual(names, ["Extreme Buy", "Undervalued", "Fair Value",
                                 "Elevated", "Overvalued", "Extreme Sell"])

    def test_boundary_belongs_to_upper_zone(self):
        self.assertEqual(za.ZONES[za.zone_index(-1.0)][1], "Fair Value")


if __name__ == "__main__":
    unittest.main()
