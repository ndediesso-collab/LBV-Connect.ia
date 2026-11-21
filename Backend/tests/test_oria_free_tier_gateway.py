"""Offline tests, no Supabase/API traffic."""
import ast
import importlib.util
import sys
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'free_tier_gateway.py'
spec = importlib.util.spec_from_file_location('oria_free_gateway_tested',SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

UID='12121212-1212-4212-8212-121212121212'
RID='11111111-1111-4111-8111-111111111111'

class FakeRpc:
    def __init__(self, backend, name, params):
        self.backend,self.name,self.params=backend,name,params
    def execute(self):
        self.backend.calls.append((self.name,self.params))
        class Response:
            data={'status':'reserved','processed':True}
        return Response()

class FakeWalletQuery:
    def __init__(self, backend): self.backend=backend
    def select(self,columns):
        assert columns == 'free_balance,purchased_balance,purchased_expires_at,last_grant_day,recharge_frozen'
        return self
    def eq(self,field,value):
        assert field=='user_id' and value==UID
        return self
    def limit(self,n):
        assert n == 1
        return self
    def execute(self):
        class Response:
            data=[{'free_balance':160,'purchased_balance':1000,'last_grant_day':'2026-11-13','recharge_frozen':True}]
        return Response()

class FakeSupabase:
    def __init__(self): self.calls=[]
    def rpc(self,name,params):return FakeRpc(self,name,params)
    def table(self,name):
        assert name=='oria_free_credit_wallets'
        return FakeWalletQuery(self)

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.fake=FakeSupabase()
        self.g=mod.FreeTierGateway(self.fake)

    def test_grant(self):
        self.g.grant(UID)
        name,parameters=self.fake.calls[-1]
        self.assertEqual(name,'oria_free_grant_if_eligible')
        self.assertEqual(parameters,{'p_user_id':UID})

    def test_reserve_service_side_amount(self):
        self.g.reserve(UID,RID,80,'3.24')
        name,parameters=self.fake.calls[-1]
        self.assertEqual(name,'oria_free_reserve')
        self.assertEqual(parameters['p_amount'],80)
        self.assertEqual(parameters['p_api_reservation_xaf'],'3.24')
        self.assertEqual(parameters['p_action'],'chat_luna')
        self.assertEqual(parameters['p_ttl_seconds'],900)

    def test_release_is_explicit(self):
        self.g.release_if_definite_failure(UID,RID)
        self.assertEqual(self.fake.calls[-1][0],'oria_free_release')

    def test_settle_actual_cost(self):
        self.g.settle(UID,RID,27,'1.234')
        name,parameters=self.fake.calls[-1]
        self.assertEqual(name,'oria_free_settle')
        self.assertEqual(parameters['p_actual_credits'],27)
        self.assertEqual(parameters['p_actual_api_xaf'],'1.234')

    def test_negative_reserve_rejected_without_rpc(self):
        with self.assertRaises(mod.FreeTierRpcError):self.g.reserve(UID,RID,-1,'1')
        self.assertEqual(self.fake.calls,[])

    def test_unknown_action_rejected(self):
        with self.assertRaises(mod.FreeTierRpcError):self.g.reserve(UID,RID,10,'1',action='chat_sol')

    def test_nan_api_cost_rejected(self):
        with self.assertRaises(mod.FreeTierRpcError):self.g.reserve(UID,RID,10,'NaN')

    def test_bool_amount_rejected(self):
        with self.assertRaises(mod.FreeTierRpcError):self.g.settle(UID,RID,True,'1')

    def test_bad_identity_rejected(self):
        with self.assertRaises(mod.FreeTierRpcError):self.g.grant('not-uuid')

    def test_wallet_amounts(self):
        wallet=self.g.balance(UID)
        self.assertEqual(wallet['balance'],1160)
        self.assertEqual(wallet['free_credits'],160)
        self.assertEqual(wallet['purchased_credits'],1000)

    def test_installed_output_limits_are_wired_to_provider(self):
        """Validate deployed Python AST, not an installer outside the repository."""
        backend = Path(__file__).resolve().parents[1]
        openai_tree = ast.parse((backend / 'app/services/openai_service.py').read_text(encoding='utf-8'))
        openrouter_tree = ast.parse((backend / 'app/services/openrouter_chat_service.py').read_text(encoding='utf-8'))
        free_tree = ast.parse((backend / 'app/route/free_chat.py').read_text(encoding='utf-8'))

        def method(tree, cls_name, method_name):
            classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == cls_name]
            self.assertEqual(len(classes), 1, f'Classe {cls_name} introuvable')
            matches = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and n.name == method_name]
            self.assertEqual(len(matches), 1, f'Methode {cls_name}.{method_name} introuvable')
            return matches[0]

        def has_parameter(fn, parameter):
            return parameter in [a.arg for a in fn.args.args + fn.args.kwonlyargs]

        def payload_uses_parameter(fn, key, parameter):
            return any(
                isinstance(n, ast.Dict)
                and any(
                    isinstance(k, ast.Constant) and k.value == key
                    and isinstance(v, ast.Name) and v.id == parameter
                    for k, v in zip(n.keys, n.values)
                ) for n in ast.walk(fn)
            )

        openai_chat = method(openai_tree, 'OpenAIService', 'chat')
        self.assertTrue(has_parameter(openai_chat, 'max_output_tokens'))
        self.assertTrue(payload_uses_parameter(openai_chat, 'max_output_tokens', 'max_output_tokens'))

        or_build = method(openrouter_tree, 'OpenRouterChatService', 'build_request')
        or_chat = method(openrouter_tree, 'OpenRouterChatService', 'chat')
        self.assertTrue(has_parameter(or_build, 'max_completion_tokens'))
        self.assertTrue(has_parameter(or_chat, 'max_completion_tokens'))
        self.assertTrue(payload_uses_parameter(or_build, 'max_completion_tokens', 'max_completion_tokens'))
        self.assertTrue(any(
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute) and n.func.attr == 'build_request'
            and any(k.arg == 'max_completion_tokens' and isinstance(k.value, ast.Name)
                    and k.value.id == 'max_completion_tokens' for k in n.keywords)
            for n in ast.walk(or_chat)
        ))

        # The free route must actually forward its own cap to both providers.
        outgoing = set()
        for n in ast.walk(free_tree):
            if not isinstance(n, ast.Call):
                continue
            for k in n.keywords:
                if k.arg in {'max_output_tokens', 'max_completion_tokens'}:
                    if isinstance(k.value, ast.Name) and k.value.id == 'output_limit':
                        outgoing.add(k.arg)
        self.assertEqual(outgoing, {'max_output_tokens', 'max_completion_tokens'})

if __name__=='__main__':unittest.main()
