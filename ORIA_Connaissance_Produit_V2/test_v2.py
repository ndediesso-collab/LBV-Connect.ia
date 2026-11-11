from __future__ import annotations
import sys, tempfile, subprocess
from pathlib import Path
import types
# Isoler les tests du backend sans prétendre exécuter une requête payante.
app=types.ModuleType('app');app.__path__=[]
config=types.ModuleType('app.config');config.__path__=[]
credit=types.ModuleType('app.config.credit_costs')
for key, count, price in [('LIGHT',15000,4000),('INTERMEDIATE',27000,8000),('PRO',36000,12000),('BUSINESS',120000,45000)]:
    setattr(credit,key+'_PACK_CREDITS',count)
    setattr(credit,key+'_PACK_PRICE_XAF',price)
    setattr(credit,key+'_PACK_DURATION_DAYS',35)
credit.DISCOVERY_PACK_CREDITS=8000
credit.DISCOVERY_PACK_PRICE_XAF=1000
credit.DISCOVERY_PACK_DURATION_DAYS=None
credit.COMPLEMENTARY_CREDIT_PACKS={'a':{'credits':1000,'price_xaf':600},'b':{'credits':2000,'price_xaf':1000}}
sys.modules.update({'app':app,'app.config':config,'app.config.credit_costs':credit})
config.credit_costs=credit
from oria_product_knowledge import oria_product_context_for_message, _is_oria_subject
from install_oria_knowledge_v2 import FOLDER

history = [{'role':'user','content':'Comment fonctionnent les crédits ORIA ?'}, {'role':'assistant','content':'Les crédits sont consommés à chaque action payante.'}]
assert _is_oria_subject('Nan je parle plus de ton système de crédits et de pack')
assert _is_oria_subject('Et les tarifs ?', history)
assert _is_oria_subject('Combien ça coûte ?', history)
assert not _is_oria_subject('Explique la photosynthèse')
assert not _is_oria_subject('Quel est le taux du crédit immobilier ?', None)
prompt = oria_product_context_for_message('Nan je parle plus de ton système de crédits et de pack')
assert '15 000 crédits' in prompt and '4 000 XAF' in prompt and '35 jours' in prompt
assert '36 000 crédits' in prompt and '120 000 crédits' in prompt
assert 'ne connais pas les tarifs' in prompt  # directive négative
with tempfile.TemporaryDirectory() as t:
    root=Path(t); services=root/'Backend'/'app'/'services';services.mkdir(parents=True)
    import importlib.util
    # Charger la V1 en faux dépôt simulé
    (services/'oria_product_knowledge.py').write_bytes((FOLDER/'oria_product_knowledge_v1_reference.py').read_bytes())
    for name in ('openai_service.py','openrouter_chat_service.py'):
        (services/name).write_text('from app.services.oria_product_knowledge import oria_product_context_for_message\n'
                                    'def test(message, web, history):\n    x = oria_product_context_for_message(message, web_enabled=web)\n',encoding='utf-8')
    c=[sys.executable,str(FOLDER/'install_oria_knowledge_v2.py'),'--repo',str(root)]
    assert subprocess.run(c+['--dry-run'],capture_output=True).returncode==0
    assert subprocess.run(c,capture_output=True).returncode==0
    assert subprocess.run(c,capture_output=True).returncode==0
    for name in ('openai_service.py','openrouter_chat_service.py'):
        assert 'history=history' in (services/name).read_text()
    assert 'CATALOGUE COMMERCIAL' in (services/'oria_product_knowledge.py').read_text()
print('OK tests V2 : déclencheurs, produits, prix standards, installation idempotente.')
