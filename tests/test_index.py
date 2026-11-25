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


class TestSdcaFeed(unittest.TestCase):
    PAGE = ('<script>const A=1;\n'
            'const CBPL_Z = {"start":1609459200000,"values":[0.5,null,-1.25]};\n'
            'const OTHER = {"start":0,"values":[9]};</script>')

    def test_parse_dates_and_values(self):
        s = bi.parse_sdca_series(self.PAGE, "CBPL_Z")
        self.assertEqual(s, {"2021-01-01": 0.5, "2021-01-03": -1.25})   # null day skipped

    def test_missing_series_raises(self):
        with self.assertRaises(ValueError):
            bi.parse_sdca_series(self.PAGE, "ONCHAIN_Z")


class TestRaqqr(unittest.TestCase):
    def test_levels_match_the_sdca_app(self):
        # rails and median shown by the app on 2026-11-24: $73.8K / $130K / $216K
        lv = bi.raqqr_levels("2026-11-24")
        self.assertEqual(lv, sorted(lv))
        for got, want in ((lv[0], 73778), (lv[3], 129714), (lv[-1], 215712)):
            self.assertAlmostEqual(got / want, 1, places=3)

    def test_position_scale(self):
        lv = bi.raqqr_levels("2024-01-01")
        self.assertAlmostEqual(bi.raqqr_position("2024-01-01", lv[3]), 0.0, places=9)
        self.assertAlmostEqual(bi.raqqr_position("2024-01-01", lv[0]), -3.0, places=9)
        self.assertAlmostEqual(bi.raqqr_position("2024-01-01", lv[-1]), 3.0, places=9)
        self.assertEqual(bi.raqqr_position("2024-01-01", lv[0] / 10), -3.0)    # clipped

    def test_position_matches_app_checkpoint(self):
        # the app's EQM z-score on 2021-11-10 (close 66 954) was -2.916, sign flipped here
        self.assertAlmostEqual(bi.raqqr_position("2021-11-10", 66954), 2.916, places=2)


class TestModels(unittest.TestCase):
    def test_sdca_model_reproduces_the_app(self):
        # 2021-11-10 pillars (this file's sign): price 2.916, CBPL 2.71, on-chain 2.03 -> app showed -2.55
        z = bi.sdca_model([[2.916], [2.71], [2.03]])[0]
        self.assertAlmostEqual(z, 2.552, places=3)

    def test_sdca_model_needs_every_pillar_and_clamps(self):
        self.assertEqual(bi.sdca_model([[1.0, 4.0, 1.0], [None, 4.0, 1.0]]), [None, 3.0, 1.0])

    def test_expanding_z_ignores_future_and_clips(self):
        xs = [math.cos(i / 9) for i in range(500)]
        a = bi.expanding_z(xs, min_periods=50)
        b = bi.expanding_z(xs[:499] + [1e9], min_periods=50)    # one huge outlier at the end
        self.assertEqual(a[:499], b[:499])
        self.assertEqual(b[-1], 3.0)

    def test_default_composite_excludes_optional(self):
        self.assertTrue(set(bi.OPTIONAL).isdisjoint(bi.DEFAULT_KEYS))
        self.assertEqual(len(bi.DEFAULT_KEYS) + len(bi.OPTIONAL), len(bi.INDICATORS))


class TestZones(unittest.TestCase):
    def test_zone_boundaries(self):
        names = [za.ZONES[za.zone_index(z)][1] for z in (-2.5, -1.5, 0, 1.5, 2.5, 3.5)]
        self.assertEqual(names, ["Extreme Buy", "Undervalued", "Fair Value",
                                 "Elevated", "Overvalued", "Extreme Sell"])

    def test_boundary_belongs_to_upper_zone(self):
        self.assertEqual(za.ZONES[za.zone_index(-1.0)][1], "Fair Value")


if __name__ == "__main__":
    unittest.main()
