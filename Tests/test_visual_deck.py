"""Exemples de rendu documentaire strictement statique (pas de réseau ni JS)."""
from pathlib import Path
import importlib.util, io, sys, zipfile
from weasyprint import HTML
from weasyprint.urls import URLFetcher
from pptx import Presentation
from odf.opendocument import load

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('artifact_visual_deck', ROOT/'Backend/app/services/artifact_visual_deck.py')
v=importlib.util.module_from_spec(spec);sys.modules[spec.name]=v;spec.loader.exec_module(v)

HTML_SOURCE='''<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
:root {--ink:#18243a;--terra:#b44f3a;--gold:#c99d4b;}
*{box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#f9f6ef;color:#18243a;}
.oria-slide{padding:60px 68px;background:#faf7f0;}
.oria-slide.cover{background:#18243a;color:white;}
.eyebrow{color:#b44f3a;text-transform:uppercase;font-weight:700;letter-spacing:3px;}
.cover .eyebrow{color:#c99d4b;}
h1{font-size:70px;line-height:1.05;letter-spacing:-2px;margin:36px 0 30px;}
h2{font-size:52px;line-height:1.08;letter-spacing:-1.3px;margin:34px 0;}
p{font-size:24px;line-height:1.4;max-width:900px;}
.cards{display:flex;gap:24px;margin-top:52px;}
.card{padding:28px 24px;width:33%;min-height:290px;background:#fff;border-top:8px solid #b44f3a;}
.card h3{font-size:29px;margin:0 0 20px;}.card p{font-size:20px;}
.kpis{display:flex;gap:25px;margin-top:60px;}.kpi{width:48%;background:#20344d;color:#fff;padding:42px;}
.kpi:nth-child(2){background:#b44f3a;}.kpi strong{display:block;font-size:64px;}
.bottom{position:absolute;bottom:35px;color:#96a1ae;font-size:15px;}
</style></head><body><main class="oria-deck">
<section class="oria-slide cover"><div class="eyebrow">Histoire · mémoires · résistances</div><h1>La traite<br>transatlantique</h1><p>Déportation forcée, esclavage et résistances dans le monde atlantique.</p><div class="bottom">01 — Présentation historique</div></section>
<section class="oria-slide"><div class="eyebrow">Comprendre</div><h2>Un système de déportation</h2><div class="cards"><div class="card"><h3>Europe</h3><p>Ports, armateurs et financement.</p></div><div class="card"><h3>Afrique</h3><p>Captures, ventes et départs forcés.</p></div><div class="card"><h3>Amériques</h3><p>Débarquement et travail imposé.</p></div></div><div class="bottom">02 — Organisation</div></section>
<section class="oria-slide"><div class="eyebrow">Mesurer</div><h2>Une déportation de masse</h2><div class="kpis"><div class="kpi"><strong>12,5 M</strong><p>Personnes embarquées</p></div><div class="kpi"><strong>10,7 M</strong><p>Personnes arrivées vivantes</p></div></div><div class="bottom">03 — Estimations historiques</div></section>
</main></body></html>'''

# Pas de ressources externes : URLFetcher configuré data: seulement.
class DataOnlyFetcher(URLFetcher):
 def __init__(self):super().__init__(allowed_protocols=('data',),fail_on_errors=True)

def pdf_renderer(fragment):
 return HTML(string=fragment,url_fetcher=DataOnlyFetcher()).write_pdf()

for fmt in ('pptx','odp'):
 data=v.compile_visual_deck(HTML_SOURCE,fmt=fmt,pdf_renderer=pdf_renderer)
 assert len(data)>10000, (fmt,len(data))
 (ROOT/f'ORIA_DEMO_QUALITE.{fmt}').write_bytes(data)
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  bad=z.testzip();assert bad is None,bad
  print(fmt, len(data), 'archive entries',len(z.namelist()))
 if fmt=='pptx':
  p=Presentation(io.BytesIO(data));assert len(p.slides)==3,len(p.slides)
  assert all(len(s.shapes)==1 for s in p.slides)
 else:
  d=load(io.BytesIO(data));assert len(d.presentation.childNodes)==3, len(d.presentation.childNodes)

# Les sources sans sections et les diapositives vides ne sont pas acceptées.
for invalid in ('<html><body><h1>Bonjour</h1></body></html>',
                '<html><body><section class="oria-slide"></section></body></html>'):
 try:v.compile_visual_deck(invalid,fmt='pptx',pdf_renderer=pdf_renderer)
 except v.VisualDeckError:pass
 else:raise AssertionError('Source invalide acceptee')
print('Tests OK')
