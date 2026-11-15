"""Phase 4C unit tests. No Chariow, SQL, Redis, Supabase or provider calls."""
import ast
import importlib.util
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

MODULE_FILE = pathlib.Path(__file__).resolve().parents[1] / 'app/services/oria_free_addon_payment.py'
spec = importlib.util.spec_from_file_location('oria_free_addon_payment', MODULE_FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeQuery:
    def __init__(self, data): self.data=data
    def select(self,*a): return self
    def eq(self,*a): return self
    def limit(self,*a): return self
    def execute(self): return SimpleNamespace(data=self.data)

class FakeRPC:
    def __init__(self, data): self.data=data
    def execute(self): return SimpleNamespace(data=self.data)

class FakeClient:
    def __init__(self, data=None, rpc_data=None):
        self.data=data
        self.rpc_data=rpc_data
        self.rpcs=[]
    def table(self, name):
        if name != 'oria_free_settings': raise AssertionError(name)
        return FakeQuery(self.data)
    def rpc(self, name, payload):
        self.rpcs.append((name,payload))
        return FakeRPC(self.rpc_data)


def tx(product='credits_1000_563', amount=600, credits=1000, marked=True):
    return {'payment_type':'addon','pack_id':None,'addon_id':product,'amount':amount,
            'credits':credits,'currency':'XAF',
            'metadata':{'oria_wallet_target':'free'} if marked else {}}

class FreeAddonPaymentTests(unittest.TestCase):
    def test_free_no_wallet(self):
        self.assertTrue(mod.is_free_addon_checkout(payment_type='addon',product_id='credits_1000_563',wallet=None))
    def test_free_expired_pack(self):
        self.assertTrue(mod.is_free_addon_checkout(payment_type='addon',product_id='credits_2000',wallet=SimpleNamespace(is_pack_active=False)))
    def test_active_paid_pack_unchanged(self):
        self.assertFalse(mod.is_free_addon_checkout(payment_type='addon',product_id='credits_1000_563',wallet=SimpleNamespace(is_pack_active=True)))
    def test_other_addons_and_packs_unchanged(self):
        self.assertFalse(mod.is_free_addon_checkout(payment_type='addon',product_id='credits_4000',wallet=None))
        self.assertFalse(mod.is_free_addon_checkout(payment_type='primary_pack',product_id='discovery_pack',wallet=None))
    def test_server_flag_disabled(self):
        with patch.dict('os.environ',{'ORIA_FREE_ADDON_CHECKOUT_STAGING_ENABLED':'0'}):
            with self.assertRaises(HTTPException) as ctx:
                mod.require_free_checkout_ready(FakeClient([{'enabled':True}]))
            self.assertEqual(ctx.exception.status_code,503)
    def test_sql_disabled(self):
        with patch.dict('os.environ',{'ORIA_FREE_ADDON_CHECKOUT_STAGING_ENABLED':'1'}):
            with self.assertRaises(HTTPException) as ctx:
                mod.require_free_checkout_ready(FakeClient([{'enabled':False}]))
            self.assertEqual(ctx.exception.status_code,503)
    def test_ready(self):
        with patch.dict('os.environ',{'ORIA_FREE_ADDON_CHECKOUT_STAGING_ENABLED':'1'}):
            mod.require_free_checkout_ready(FakeClient([{'enabled':True}]))
    def test_marked_payment_validated(self):
        mod.validate_free_target_payment(tx())
        mod.validate_free_target_payment(tx('credits_2000',1000,2000))
        for bad in [tx(marked=False),tx(amount=500),tx(credits=1999),tx('credits_4000',2000,4000),tx(amount=True)]:
            with self.assertRaises(HTTPException): mod.validate_free_target_payment(bad)
    def test_fake_server_result_rejected(self):
        for resp in [{'processed':True,'reference':'r','credited_credits':True},
                     {'processed':True,'reference':'wrong','credited_credits':1000},
                     {'processed':True,'reference':'r','credited_credits':0}]:
            with self.assertRaises(HTTPException): mod.finalize_free_addon_paid(FakeClient(rpc_data=resp),'r')
    def test_free_rpc_unique_reference(self):
        client=FakeClient(rpc_data={'processed':True,'reference':'ref-test','credited_credits':1000})
        self.assertTrue(mod.finalize_free_addon_paid(client,'ref-test')['processed'])
        self.assertEqual(client.rpcs,[('oria_free_finalize_existing_addon',{'p_reference':'ref-test'})])
    def test_replay_is_processed_false(self):
        client=FakeClient(rpc_data={'processed':False,'reference':'ref-test','credited_credits':1000,'already_credited':True})
        self.assertFalse(mod.finalize_free_addon_paid(client,'ref-test')['processed'])
    def test_installed_routes_keep_classic_chariow(self):
        source=(MODULE_FILE.parents[1]/'routes.py').read_text(encoding='utf-8')
        ast.parse(source)
        self.assertIn('async def chariow_webhook(request: Request):',source)
        self.assertIn('verify_pulse_signature(',source)
        self.assertIn('free_addon_checkout = is_free_addon_checkout(',source)
        self.assertIn('if request.payment_type == "addon" and not free_addon_checkout:',source)
        self.assertIn('transaction_payload["metadata"][FREE_WALLET_TARGET_KEY] = FREE_WALLET_TARGET',source)
        self.assertIn('finalize_free_addon_paid(supabase, str(reference_id))',source)
        self.assertIn('validate_addon_purchase(wallet)',source)

if __name__=='__main__': unittest.main()
