"""Pure unit tests. Do not access user's DB, accounts or external providers."""
import sys
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
import unittest

PKG_ROOT = Path(__file__).resolve().parent.parent
if (PKG_ROOT/'source'/'Backend').is_dir():
    sys.path.insert(0, str(PKG_ROOT/'source'/'Backend'))
else:
    sys.path.insert(0, str(PKG_ROOT.parent/'Backend'))

from app.config.free_tier_policy import (
    FreeBalance, FreeTierPolicyError, daily_refresh, apply_purchased_addon,
    charge_credits, restore_unused_reservation, luna_free_reservation_credits,
    free_action_permitted,
)


def d(day, hour=1):
    return datetime(2026, 11, day, hour, 0, tzinfo=timezone.utc)


class DailyFreePolicyTests(unittest.TestCase):
    def test_initial_grant_only_once_per_day(self):
        s, ok = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=False)
        self.assertTrue(ok)
        self.assertEqual(s.balance, 90)
        s2, ok2 = daily_refresh(s, now=d(13, 20), paid_pack_active=False)
        self.assertFalse(ok2)
        self.assertEqual(s2.balance, 90)

    def test_minuit_libreville_resets_not_accumulates(self):
        s, _ = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=False)
        s, _ = charge_credits(s, 45)
        self.assertEqual(s.balance, 45)
        s, ok = daily_refresh(s, now=d(14), paid_pack_active=False)
        self.assertTrue(ok)
        self.assertEqual(s.balance, 90)

    def test_timezone_rollover_at_libreville_midnight(self):
        # 22:59 UTC on Nov 13 -> 23:59 Gabon, 23:00 UTC -> 00:00 Gabon
        before = datetime(2026, 11, 13, 22, 59, tzinfo=timezone.utc)
        after = datetime(2026, 11, 13, 23, 0, tzinfo=timezone.utc)
        s, ok = daily_refresh(FreeBalance(), now=before, paid_pack_active=False)
        self.assertTrue(ok)
        s, ok = daily_refresh(s, now=after, paid_pack_active=False)
        self.assertTrue(ok)

    def test_purchased_addon_and_free_credit_freeze(self):
        s, _ = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=False)
        s = apply_purchased_addon(s, credits=1000, paid_pack_active=False)
        self.assertEqual(s.balance, 1090)
        s, ok = daily_refresh(s, now=d(14), paid_pack_active=False)
        self.assertFalse(ok)
        self.assertEqual(s.balance, 1090)
        s, charged = charge_credits(s, 1040)
        self.assertEqual((charged.charged_free, charged.charged_purchased), (90, 950))
        self.assertEqual(s.balance, 50)
        s, ok = daily_refresh(s, now=d(15), paid_pack_active=False)
        self.assertFalse(ok)
        s, _ = charge_credits(s, 50)
        s, ok = daily_refresh(s, now=d(15), paid_pack_active=False)
        self.assertTrue(ok)
        self.assertEqual(s.balance, 90)
        s, ok = daily_refresh(s, now=d(15), paid_pack_active=False)
        self.assertFalse(ok)

    def test_does_not_grant_when_paid_pack_active(self):
        s, ok = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=True)
        self.assertFalse(ok)
        self.assertEqual(s.balance, 0)

    def test_pending_reservation_blocks_daily_reset(self):
        s, _ = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=False)
        s2, changed = daily_refresh(s, now=d(14), paid_pack_active=False,
                                    has_open_reservation=True)
        self.assertFalse(changed)
        self.assertEqual(s2, s)

    def test_paid_addon_is_not_erased_by_daily_reset(self):
        s, _ = daily_refresh(FreeBalance(), now=d(13), paid_pack_active=False)
        s = apply_purchased_addon(s, credits=2000, paid_pack_active=False)
        s, _ = charge_credits(s, 50)
        s2, changed = daily_refresh(s, now=d(20), paid_pack_active=False)
        self.assertFalse(changed)
        self.assertEqual(s2.purchased_credits, 2000)

    def test_consumption_fails_closed(self):
        with self.assertRaises(FreeTierPolicyError):
            charge_credits(FreeBalance(free_credits=100), 101)

    def test_release_to_original_buckets(self):
        s = FreeBalance(free_credits=50,purchased_credits=150,
                        last_daily_grant=date(2026,11,13),recharge_frozen=True)
        reserved_state, bucket = charge_credits(s,100)
        self.assertEqual((bucket.charged_free,bucket.charged_purchased),(50,50))
        settled = restore_unused_reservation(reserved_state, reserved=bucket, actual_credits=30)
        self.assertEqual((settled.free_credits,settled.purchased_credits),(20,150))
        with self.assertRaises(FreeTierPolicyError):
            restore_unused_reservation(reserved_state,reserved=bucket,actual_credits=120)

    def test_luna_reservations_under_quota_with_real_output_cap(self):
        for provider in ("openai", "openrouter"):
            quote = luna_free_reservation_credits(input_tokens=6000,
                output_limit=4096,provider=provider)
            self.assertGreater(quote, 0)
            self.assertLessEqual(quote, 200)
        self.assertGreater(luna_free_reservation_credits(
            input_tokens=6000,output_limit=4096,provider="openrouter"),
            luna_free_reservation_credits(
            input_tokens=6000,output_limit=4096,provider="openai"))
        with self.assertRaises(FreeTierPolicyError):
            luna_free_reservation_credits(input_tokens=6000,output_limit=32000,provider="openai")

    def test_capabilities(self):
        self.assertTrue(free_action_permitted(model="luna",web=False,document_format="pdf"))
        self.assertFalse(free_action_permitted(model="luna",web=True))
        self.assertFalse(free_action_permitted(model="gpt-5.6-terra",web=False))
        self.assertFalse(free_action_permitted(model="luna",web=False,image=True))
        self.assertFalse(free_action_permitted(model="luna",web=False,video=True))


if __name__ == '__main__':
    unittest.main()
