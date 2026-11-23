"""Intentions documentaires explicites; ne jamais générer un CV automatiquement.

La détection des mentions simples (sans intention) reste dans ai.py.
Ce module traite uniquement les commandes positives à forte confiance.
"""
from __future__ import annotations
import re
import unicodedata

_FORMATS = {
    'pdf': r'pdf',
    'docx': r'word|docx',
    'pptx': r'power\s*point|pptx|diaporama',
    'xlsx': r'excel|xlsx|classeur|tableur|feuille\s+de\s+calcul',
}
_BAD_START = re.compile(
    r'^\s*(?:comment|pourquoi|qu(?:e|\x27est.ce)|explique(?:-moi)?|\n?'
    r'je\s+(?:veux|voudrais)\s+comprendre|quelle?\s+est\s+la\s+diff[eé]rence)\b', re.I)
_COMMAND = re.compile(
    r'\b(?:fais|faire|cree|cr[ée]e|cr[ée]er|g[ée]n[èe]re|g[ée]n[ée]rer|'
    r'produis|r[ée]dige|pr[ée]pare|fabrique|con[çc]ois|'
    r'exporte|envoie|renvoie|donne|fournis|je\s+veux|je\s+voudrais|'
    r'j.aimerais|je\s+souhaite|il\s+me\s+faut)\b', re.I)

def _flat(text: str) -> str:
    normalized = unicodedata.normalize('NFKD', text.casefold())
    return ''.join(c for c in normalized if not unicodedata.combining(c)).replace('\u2019', "'")

def detect_document_creation(message: str) -> str | None:
    """Return unambiguous format ONLY if user explicitly commands creation/export.

    Do not infer CV output format: the CV interview workflow is deferred.
    """
    if not isinstance(message, str) or len(message) > 20000:
        return None
    text = _flat(message).strip()
    if not text or _BAD_START.match(text) or not _COMMAND.search(text):
        return None
    if re.search(r'\b(?:cv|curriculum\s+vitae)\b', text):
        return None
    found = [fmt for fmt, pattern in _FORMATS.items()
             if re.search(r'(?<![a-z0-9])(?:' + pattern + r')(?![a-z0-9])', text)]
    if len(found) != 1:
        return None
    fmt = found[0]
    if not re.search(r'\b(?:fichier|document|version|presentation|diaporama|slides?|format|'
                     r'rapport|expose|livre|memoire|tableau)\b', text):
        # "Fais moi un PDF sur ..." is still an explicit file request.
        if fmt in ('pdf', 'docx', 'pptx', 'xlsx'):
            return fmt
    return fmt

def exact_artifact_manifest(formats: tuple[str, ...]) -> str:
    """A targeted schema hint; does not bypass secure payload validation."""
    if not formats or len(formats) != len(set(formats)) or len(formats) > 5:
        raise ValueError('Formats documentaires invalides')
    if any(f not in {'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp',
                     'epub', 'rtf', 'csv', 'tsv', 'json', 'jsonl', 'sqlite'} for f in formats):
        raise ValueError('Format de manifeste non reconnu')
    return (
        '\n\nCONTRAT DE QUANTITÉ — IMPÉRATIF :\n'
        f'La demande impose EXACTEMENT {len(formats)} objet(s) dans le tableau JSON artifacts. '
        f'Formats dans l’ordre : {", ".join(formats)}. '
        'UN seul objet artifact par format demandé, sans doublon, '
        'sans fichier bonus, sans objet de brouillon, sans message explicatif. '
        'Chaque artifact doit avoir exactement format, filename, source_id et native_data. '
        'Vérifie le nombre d’objets et leur extension avant de répondre. '
        'En PPTX, choisir une seule source HTML avec sections oria-slide si le mode visuel est adapté; '
        'ne produis jamais une liste artifacts représentant les diapositives : '
        'les diapositives vivent dans une unique source et le PPTX est un seul artifact.'
    )
