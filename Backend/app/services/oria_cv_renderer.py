"""Deterministic, side-effect-free CV template adapter for ORIA Artifact V1.

The existing ArtifactService still validates/converts/stores the resulting HTML
source as PDF/DOCX. Unrelated artifacts pass through unchanged. The model only
writes CV data, never CSS/JavaScript; the template is owned by the server.
"""
from __future__ import annotations

import copy
from html import escape
import re
from typing import Any, Mapping

_STYLE = {"classique", "moderne", "creatif"}
_KEYS = {"cv_v1", "style", "name", "title", "city", "phone", "email", "profile",
         "education", "experiences", "projects", "skills", "languages", "certifications",
         "accent"}
_ITEM_KEYS = {"title", "organization", "period", "description", "bullets"}

_BASE_CSS = """
@page { size: A4 portrait; margin: 15mm; }
* { box-sizing: border-box; }
html, body { padding: 0; margin: 0; font-family: Calibri, Arial, sans-serif;
    color: #222; font-size: 10.5pt; line-height: 1.35; }
.cv { width: 100%; }
h1 { margin: 0; font-size: 24pt; line-height: 1.12; font-weight: 700; }
h2 { font-size: 11.5pt; margin: 14px 0 7px; page-break-after: avoid;
    break-after: avoid; letter-spacing: .5px; }
h3 { font-size: 10.7pt; margin: 0 0 3px; page-break-after: avoid; }
p { margin: 0 0 6px; }
.section { margin: 0 0 8px; }
.cv-entry { margin: 0 0 9px; page-break-inside: avoid; break-inside: avoid; }
.cv-meta { color: #555; font-size: 9.7pt; margin: 0 0 3px; }
.cv-contact { font-size: 10pt; line-height: 1.45; }
ul { margin: 3px 0 7px; padding-left: 18px; }
li { margin: 2px 0; }
.cv-lead { font-size: 11pt; color: #555; margin: 5px 0 11px; }
.cv-layout { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cv-layout td { vertical-align: top; }
"""
_CLASSIC_CSS = """
@page { margin: 18mm; }
h1 { font-size: 23pt; }
h2 { border-bottom: 1px solid #555; padding: 0 0 4px; text-transform: uppercase; }
.cv-contact { padding-bottom: 7px; border-bottom: 1px solid #bbb; }
"""
_MODERN_CSS = """
@page { margin: 13mm; }
h2 { color: #17263D; }
.cv-side { width: 30%; background: #17263D; color: white;
    padding: 19px 13px; overflow-wrap: anywhere; }
.cv-main { width: 70%; padding: 18px 14px 16px 19px; }
.cv-side h2 { color: #fff; border-bottom: 1px solid #9ba7b6;
    padding-bottom: 4px; text-transform: uppercase; }
.cv-side .cv-meta, .cv-side .cv-lead { color: #eee; }
.cv-side p { color: white; }
.cv-side ul { padding-left: 16px; }
"""
_CREATIVE_CSS = """
@page { margin: 15mm; }
h1 { font-size: 28pt; }
h2 { color: var(--cv-accent); border-left: 4px solid var(--cv-accent);
    padding-left: 8px; }
.cv-hero { padding: 12px 0 9px; border-bottom: 3px solid var(--cv-accent); }
.cv-lead { color: var(--cv-accent); }
.cv-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cv-grid td { vertical-align: top; padding-right: 12px; }
"""


def _string(value:Any, name:str, maxlen:int=2000, *, allow_empty=True)->str:
    if value is None and allow_empty:return ''
    if not isinstance(value,str) or (not allow_empty and not value.strip()):
        raise ValueError(f"CV: texte invalide : {name}")
    cleaned=value.strip()
    if len(cleaned)>maxlen:raise ValueError(f"CV: texte trop long : {name}")
    return cleaned


def _items(value:Any, name:str, max_items=16):
    if value is None:return []
    if not isinstance(value,list) or len(value)>max_items:raise ValueError(f'CV: liste invalide : {name}')
    return value


def _h(value:str)->str:return escape(value,quote=True)


def _paragraph(text:str)->str:
    return '<p>'+_h(text).replace('\n','<br/>')+'</p>' if text else ''


def _section(title:str, body:str)->str:
    if not body:return ''
    return '<section class="section"><h2>'+_h(title)+'</h2>'+body+'</section>'


def _simple_list(values:list[str],limit=24)->str:
    if not values:return ''
    return '<ul>'+''.join('<li>'+_h(v)+'</li>' for v in values[:limit] if v)+'</ul>'


def _skills(value:Any, name:str)->list[str]:
    raw=_items(value,name,24);out=[]
    for v in raw:
        if isinstance(v,str):
            s=_string(v,name,180,allow_empty=False)
        else:raise ValueError('CV: compétence invalide')
        out.append(s)
    return out


def _education_or_work(value:Any,name:str)->str:
    parts=[]
    for item in _items(value,name,18):
        if not isinstance(item,dict) or set(item)-_ITEM_KEYS:
            raise ValueError(f'CV: structure invalide : {name}')
        title=_string(item.get('title'),'title',160,allow_empty=False)
        org=_string(item.get('organization'),'organization',180)
        period=_string(item.get('period'),'period',100)
        detail=_string(item.get('description'),'description',1600)
        bullets=_skills(item.get('bullets',[]),'bullets')[:8]
        heading='<h3>'+_h(title)+'</h3>'
        meta=' — '.join(_h(v) for v in (org,period) if v)
        parts.append('<div class="cv-entry">'+heading+
                     ('<p class="cv-meta">'+meta+'</p>' if meta else '')+
                     _paragraph(detail)+_simple_list(bullets)+'</div>')
    return ''.join(parts)


def _languages(value:Any)->str:
    out=[]
    for item in _items(value,'languages',18):
        if isinstance(item,str):name=_string(item,'langue',100,allow_empty=False);level=''
        elif isinstance(item,dict) and set(item)<={'name','level'}:
            name=_string(item.get('name'),'langue',100,allow_empty=False)
            level=_string(item.get('level'),'niveau',80)
        else:raise ValueError('CV: langue invalide')
        out.append('<p>'+_h(name)+(': '+_h(level) if level else '')+'</p>')
    return ''.join(out)


def render_cv_html(data:Mapping[str,Any])->str:
    if not isinstance(data,dict) or data.get('cv_v1') is not True or set(data)-_KEYS:
        raise ValueError('CV: structure cv_v1 non reconnue')
    style=_string(data.get('style'),'style',30,allow_empty=False)
    if style not in _STYLE:raise ValueError('CV: style inconnu')
    name=_string(data.get('name'),'name',150,allow_empty=False)
    title=_string(data.get('title'),'title',160,allow_empty=False)
    city=_string(data.get('city'),'city',140)
    phone=_string(data.get('phone'),'phone',100)
    email=_string(data.get('email'),'email',160)
    if not city and not phone and not email:raise ValueError('CV: contact absent')
    profile=_string(data.get('profile'),'profile',2000)
    contact=''.join('<p>'+_h(c)+'</p>' for c in (city,phone,email) if c)
    education=_education_or_work(data.get('education'),'education')
    work=_education_or_work(data.get('experiences'),'experiences')
    projects=_education_or_work(data.get('projects'),'projects')
    skills=_simple_list(_skills(data.get('skills'),'skills'))
    languages=_languages(data.get('languages'))
    certifications=_simple_list(_skills(data.get('certifications'),'certifications'))
    main_sections=(
        _section('Profil professionnel',_paragraph(profile))+
        _section('Expériences',work)+_section('Projets',projects)+
        _section('Formation',education)
    )
    if not education:raise ValueError('CV: formation manquante')
    if style=='classique':
        content=('<div class="cv">'
                 '<header><h1>'+_h(name)+'</h1><p class="cv-lead">'+_h(title)+'</p>'
                 '<div class="cv-contact">'+contact+'</div></header>'
                 +main_sections+_section('Compétences',skills)+
                 _section('Langues',languages)+_section('Certifications',certifications)+'</div>')
        css=_CLASSIC_CSS
    elif style=='moderne':
        left=(_section('Contact',contact)+_section('Compétences',skills)+
              _section('Langues',languages)+_section('Certifications',certifications))
        right=('<h1>'+_h(name)+'</h1>'
               '<p class="cv-lead">'+_h(title)+'</p>'+main_sections)
        # Two-cell table is more consistent than CSS grid for HTML-to-Word.
        content=('<table class="cv-layout" ><tr>'
                 '<td class="cv-side">'+left+'</td>'
                 '<td class="cv-main">'+right+'</td>'
                 '</tr></table>')
        css=_MODERN_CSS
    else:
        accent=_string(data.get('accent'),'accent',20) or '#B65E42'
        if not re.fullmatch(r'#[0-9A-Fa-f]{6}',accent):raise ValueError('CV: couleur invalide')
        content=('<div class="cv"><header class="cv-hero"><h1>'+_h(name)+'</h1>'
                 '<p class="cv-lead">'+_h(title)+'</p>'+contact+'</header>'
                 +main_sections+_section('Compétences',skills)+
                 _section('Langues',languages)+_section('Certifications',certifications)+'</div>')
        css=_CREATIVE_CSS.replace('var(--cv-accent)',accent)
    return ('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>'
            '<title>CV</title><style>'+_BASE_CSS+css+'</style></head><body>'
            +content+'</body></html>')


def adapt_cv_payload(payload:dict[str,Any], *, expected_style:str|None=None)->dict[str,Any]:
    """Transform only explicit cv_v1 artifacts, never unrelated documents."""
    if not isinstance(payload,dict):return payload
    artifacts=payload.get('artifacts')
    if not isinstance(artifacts,list):return payload
    matches=[a for a in artifacts if isinstance(a,dict) and isinstance(a.get('native_data'),dict)
             and a['native_data'].get('cv_v1') is True]
    if not matches:return payload
    if len(artifacts)!=1 or len(matches)!=1:
        raise ValueError('CV: un seul artifact autorisé')
    artifact=matches[0]
    if artifact.get('format') not in {'pdf','docx'}:
        raise ValueError('CV: format doit être PDF ou DOCX')
    if payload.get('sources')!=[] or artifact.get('source_id') is not None:
        raise ValueError('CV: la composition doit venir uniquement des données cv_v1')
    native=dict(artifact['native_data'])
    if expected_style is not None:
        if expected_style not in _STYLE:
            raise ValueError('CV: style serveur inconnu')
        native['style']=expected_style  # Server choice always wins over model.
    html=render_cv_html(native)
    new=copy.deepcopy(payload)
    new['sources']=[{'id':'oria-cv-source','kind':'html','content':html}]
    new['artifacts'][0]['source_id']='oria-cv-source'
    new['artifacts'][0]['native_data']=None
    return new
