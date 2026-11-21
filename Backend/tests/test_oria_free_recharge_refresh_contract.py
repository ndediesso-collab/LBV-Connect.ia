"""Tests offline de l'alignement de la politique ORIA; jamais de requete SQL.
Le programme se lance dans le depot Backend avec -m unittest discover.
"""
import unittest
from datetime import date, datetime, timezone
from app.config.free_tier_policy import FreeBalance, daily_refresh

def utc(h, day=14):
    return datetime(2026, 11, day, h, 0, tzinfo=timezone.utc)

class RechargeRefreshContractTests(unittest.TestCase):
    def test_purchased_positive_suspends_regardless_of_free_balance(self):
        w = FreeBalance(200, 1000, date(2026,11,13), True)
        n, changed = daily_refresh(w, now=utc(6), paid_pack_active=False)
        self.assertFalse(changed)
        self.assertEqual(n, w)

    def test_one_paid_credit_prevents_refill(self):
        w = FreeBalance(0, 1, date(2026,11,13), True)
        n, changed = daily_refresh(w, now=utc(6), paid_pack_active=False)
        self.assertFalse(changed)
        self.assertEqual(n.purchased_credits, 1)

    def test_when_purchased_zero_old_free_remainder_no_longer_blocks_next_day(self):
        w = FreeBalance(35, 0, date(2026,11,13), True)
        n, changed = daily_refresh(w, now=utc(6), paid_pack_active=False)
        self.assertTrue(changed)
        self.assertEqual((n.free_credits, n.purchased_credits, n.recharge_frozen), (90, 0, False))

    def test_no_second_grant_on_same_gabon_day(self):
        w = FreeBalance(0, 0, date(2026,11,14), True)
        n, changed = daily_refresh(w, now=utc(6), paid_pack_active=False)
        self.assertFalse(changed)
        self.assertEqual(n, w)

    def test_pack_and_reservation_block_grant(self):
        w = FreeBalance(0, 0, date(2026,11,13), True)
        for pack, reservation in [(True, False),(False, True)]:
            n, changed = daily_refresh(w, now=utc(6), paid_pack_active=pack,
                                       has_open_reservation=reservation)
            self.assertFalse(changed)
            self.assertEqual(n, w)

    def test_midnight_libreville_rollover(self):
        w = FreeBalance(50, 0, date(2026,11,13), False)
        before, changed_before = daily_refresh(w, now=utc(22, 13), paid_pack_active=False)
        after, changed_after = daily_refresh(w, now=utc(23, 13), paid_pack_active=False)
        self.assertFalse(changed_before)
        self.assertTrue(changed_after)
        self.assertEqual(after.free_credits, 90)

if __name__ == '__main__': unittest.main()
