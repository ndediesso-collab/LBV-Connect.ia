"""ORIA CV: conservative conversation-aware preflight for ordinary chat.

No DB queries, side effects, external calls, generated biography or client price.
The normal ORIA artifact service renders and stores the resulting PDF/DOCX.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Mapping, Sequence

_CV_REQUEST = re.compile(
    r"\b(?:cv|curriculum\s+vitae)\b", re.I
)
_CREATE = re.compile(
    r"\b(?:fais|faites|faire|cr[ée]e?|cr[ée]ez|g[ée]n[èe]re?|"
    r"pr[ée]pare|r[ée]dige|refais|reprends|r[ée]actualise|mets\s+[àa]\s+jour|"
    r"con[çc]ois|je\s+veux|je\s+voudrais|j['’]aimerais|"
    r"j['’]ai\s+besoin|am[ée]liore|modifie|corrige|retouche|"
    r"convertis|exporte|envoie|donne)\b", re.I
)
_EXPLAIN = re.compile(
    r"^\s*(?:comment|pourquoi|qu['’]est[- ]?ce|c['’]est\s+quoi|"
    r"quelle\s+diff[ée]rence|explique[- ]?moi|d[ée]finis)\b", re.I
)
_EMAIL = re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.I)
_PHONE = re.compile(r"(?<!\w)(?:\+?241[\s.-]?)?(?:0[1267][\s.-]?)?(?:\d[\s.-]?){7,9}(?!\w)")
_ASK_FIRST = "Bien sûr ! Je peux te préparer un CV professionnel adapté à ton profil."
_ASK_MORE = "Pour finaliser ton CV, il me manque encore quelques renseignements :"
_ASK_PARTS = (
    ("nom", "Identité et contact : ton nom complet"),
    ("ville", "Ville : ta ville de résidence"),
    ("contact", "Contact : ton téléphone ou ton adresse email (au moins un des deux)"),
    ("formation", "Formation : tes diplômes, établissements et années"),
    ("experience", "Expériences : emplois, stages ou projets réalisés (ou indique « aucune »)"),
    ("competences", "Compétences : tes logiciels, connaissances et savoir-faire"),
    ("langues", "Langues : celles que tu maîtrises et leur niveau"),
    ("objectif", "Objectif professionnel : le poste ou le type de stage recherché"),
)
_MISSING_CRITICAL = frozenset({"nom", "contact", "formation", "objectif"})


@dataclass(frozen=True)
class CVDecision:
    style: str  # classique | moderne | creatif
    fmt: str  # pdf | docx
    ready: bool
    question: str | None
    missing: tuple[str, ...]
    profile_text: str  # raw user-provided text, not invented biography


def _user_entries(history: Sequence[Mapping[str, object]] | None) -> list[str]:
    return [str(row.get("content") or "").strip() for row in (history or [])[-22:]
            if row.get("role") == "user" and isinstance(row.get("content"), str)
            and str(row.get("content")).strip()]


def _cv_request(text: str) -> bool:
    cv=_CV_REQUEST.search(text)
    if not cv or _EXPLAIN.search(text):
        return False
    if re.fullmatch(r"\s*(?:un|mon|le)?\s*cv\s*(?:stp|svp|s['’]il te plaît)?[.!?]*\s*", text, re.I):
        return True
    # A document ABOUT CVs is not a request to create the user's CV.
    if re.search(r"\b(?:pdf|word|docx|guide|article|expos[ée])\s+"
                 r"(?:sur|concernant|qui explique)\b.{0,100}\bcv\b",text,re.I):
        return False
    for match in _CREATE.finditer(text):
        gap=text[match.end():cv.start()] if match.end()<=cv.start() else text[cv.end():match.start()]
        if len(gap) <= 95 and not re.search(r"\b(?:sur|pour expliquer|qui explique)\b",gap,re.I):
            return True
    return False


def _looks_like_cv_update(text: str) -> bool:
    s = text.casefold()
    return bool(re.search(r"\b(?:nom\s*(?:complet)?|pr[ée]nom|ville|t[ée]l[ée]phone|"
                          r"email|mail|formation|dipl[oô]me|exp[ée]rience|stage|"
                          r"comp[ée]tence|langue|objectif|adresse)\s*[:=\-]", s)
                or re.search(r"\b(?:je\s+m['’]appelle|j['’]habite|je\s+cherche|"
                             r"je\s+recherche|je\s+ma[iî]trise|je\s+parle|"
                             r"aucune\s+exp[ée]rience|sans\s+exp[ée]rience)\b", s)
                or _EMAIL.search(s))


def _label(text: str, label: str) -> bool:
    return bool(re.search(rf"(?im)(?:^|[.,;\n])\s*(?:[-*]\s*)?{label}\s*[:=\-]\s*\S+", text))


def _known_fields(raw_user_text: str) -> set[str]:
    """Conservative evidentiary recognition; never create imaginary data."""
    text = raw_user_text
    low = text.casefold()
    found: set[str] = set()
    if (_label(text, r"(?:nom(?:\s+complet)?|identit[ée]|nom\s+et\s+pr[ée]nom)")
            or re.search(r"\bje\s+m['’]appelle\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'-]+", text, re.I)):
        found.add("nom")
    if (_label(text, r"(?:ville|r[ée]sidence|localisation)")
            or re.search(r"\b(?:j['’]habite|je\s+vis)\s+[àa]\s+\w+",low)):
        found.add("ville")
    if (_EMAIL.search(text) or _label(text, r"(?:t[ée]l[ée]phone|tel|portable|contact)")):
        found.add("contact")
    else:
        phones = _PHONE.findall(text)
        if any(len(re.sub(r"\D", "", p)) in (8, 9, 11, 12) for p in phones):
            found.add("contact")
    if (_label(text, r"(?:formation(?:s)?|[ée]tudes?|dipl[oô]mes?|parcours\s+scolaire)")
            or re.search(r"\b(?:licence|bac(?:calaur[ée]at)?|bts|master|doctorat|"
                         r"cap|bep|universit[ée]|[ée]tudiant(?:e)?|[ée]cole)\b",low)):
        found.add("formation")
    if (_label(text, r"(?:exp[ée]riences?(?:\s+professionnelles?)?|stages?|projets?)")
            or re.search(r"\b(?:sans\s+exp[ée]rience|aucune\s+exp[ée]rience|"
                         r"pas\s+d['’]exp[ée]rience|j['’]ai\s+travaill[ée]|"
                         r"j['’]ai\s+fait\s+un\s+stage|j['’]ai\s+r[ée]alis[ée])\b",low)):
        found.add("experience")
    if (_label(text, r"(?:comp[ée]tences?|savoir[- ]faire|logiciels?)")
            or re.search(r"\b(?:je\s+ma[iî]trise|je\s+sais\s+(?:utiliser|faire)|"
                         r"je\s+connais\s+(?:bien|les))\b",low)):
        found.add("competences")
    if (_label(text, r"(?:langues?|niveau\s+de\s+langues?)")
            or re.search(r"\bje\s+parle\s+(?:fran[çc]ais|anglais|espagnol|arabe)",low)):
        found.add("langues")
    if (_label(text, r"(?:objectif(?:\s+professionnel)?|poste(?:\s+recherch[ée])?|"
                     r"stage\s+recherch[ée]|domaine(?:\s+vis[ée])?)")
            or re.search(r"\b(?:je\s+(?:cherche|recherche)\s+(?:un|une|des)\s+"
                         r"(?:stage|poste|emploi)|je\s+postule\s+(?:pour|[àa])|"
                         r"candidat(?:e)?\s+(?:pour|[àa])\s+(?:un|une)|"
                         r"pour\s+(?:un|une)\s+(?:stage|poste))\b",low)):
        found.add("objectif")
    return found


def _style(entries: list[str]) -> str:
    # Current request wins, then recent user preferences.
    for text in reversed(entries):
        low=text.casefold()
        if re.search(r"\bats\b|\bclassique\b|\bsobre\b|\btraditionnel\b",low):return "classique"
        if re.search(r"\bcr[ée]atif\b|\boriginal\b|\bartistique\b",low):return "creatif"
        if re.search(r"\bmoderne\b|\bcontemporain\b",low):return "moderne"
    return "moderne"


def _format(entries: list[str], explicit_type: str | None) -> str:
    explicit=(explicit_type or "").strip().casefold().lstrip(".")
    if explicit in {"docx", "word"}:return "docx"
    if explicit == "pdf":return "pdf"
    # An explicit Word export in a user message, not merely familiarity with Word.
    for text in reversed(entries):
        if re.search(r"(?:\b(?:cv|curriculum vitae)\b[^.!?\n]{0,100}?\b(?:(?:en|format|version)\s+)?(?:word|docx)\b)|"
                     r"(?:\b(?:en|au\s+format|version)\s+(?:word|docx)\b)", text, re.I):return "docx"
        if re.search(r"\b(?:en|au\s+format|version)\s+pdf\b",text,re.I):return "pdf"
    return "pdf"


def analyze_cv_turn(message: str, history: Sequence[Mapping[str, object]] | None = None,
                    explicit_type: str | None = None) -> CVDecision | None:
    """Plan one CV turn from existing conversation, no new storage or form.

    If a user asks for an unrelated subject after a CV, this returns None.
    """
    current=str(message or "").strip()
    if not current:return None
    prior=_user_entries(history)
    direct=_cv_request(current)
    recent_cv=any(_cv_request(v) for v in prior[-7:])
    recent_assistant_cv=any(
        str(row.get("content") or "").startswith((_ASK_FIRST,_ASK_MORE))
        for row in (history or [])[-8:] if row.get("role")=="assistant"
    )
    anaphoric=bool(re.search(r"^\s*(?:et\s+)?(?:en|au\s+format)\s+(?:pdf|word|docx)\b",current,re.I))
    editing=bool(re.search(r"\b(?:modifie|corrige|change|ajoute|supprime|reprends|refais|"
                          r"remplace|mets\s+[àa]\s+jour)\b",current,re.I))
    tiny_reply=bool(re.fullmatch(r"\s*(?:aucune?|non|pas\s+d['’]exp[ée]rience)\s*[.!]?",current,re.I))
    if not (direct or (recent_cv and (_looks_like_cv_update(current)
                                   or anaphoric or editing
                                   or (recent_assistant_cv and tiny_reply)))):
        return None
    if explicit_type and explicit_type.strip().lower().lstrip('.') not in {'pdf','docx','word'}:
        raise ValueError("Un CV ORIA s'exporte uniquement en PDF ou en Word (DOCX).")
    entries=prior+[current]
    # In an ongoing conversation all user facts matter, but never assistant claims.
    combined="\n".join(entries)
    known=_known_fields(combined)
    missing=tuple(key for key,_ in _ASK_PARTS if key not in known)
    core_ok=not (set(missing) & _MISSING_CRITICAL)
    # One relevant experience or skills section makes the profile useful.
    enough=core_ok and ('competences' in known or 'experience' in known)
    if enough:
        return CVDecision(_style(entries), _format(entries,explicit_type), True,None,missing,combined)
    prior_questions=sum(1 for row in (history or []) if row.get("role")=="assistant"
                        and str(row.get("content") or "").startswith((_ASK_FIRST,_ASK_MORE)))
    labels=[name for key,name in _ASK_PARTS if key in missing]
    if prior_questions == 0:
        header=_ASK_FIRST+"\n\nPour le réaliser, j'ai besoin des informations suivantes :"
    elif prior_questions == 1:
        header=_ASK_MORE
    else:
        header=("Je n'ai pas encore les informations indispensables pour établir "
                "un CV fiable. Je ne vais pas inventer tes coordonnées ou ton parcours.")
        labels=[name for key,name in _ASK_PARTS if key in missing and key in _MISSING_CRITICAL]
        if not labels and not enough:
            labels=["Compétences ou expériences : indique au moins une réalisation, "
                    "un savoir-faire ou précise que tu débutes"]
    reply=header+"\n\n"+"\n".join("• "+l+"." for l in labels)
    if prior_questions <= 1:
        reply+=("\n\nRéponds en un seul message, même dans le désordre. "
                "Si tu n'as pas d'expérience professionnelle, précise « aucune » : "
                "je valoriserai ta formation, tes projets et tes compétences. "
                "Je générerai le CV dès que les informations seront suffisantes.")
    return CVDecision(_style(entries),_format(entries,explicit_type),False,reply,missing,combined)
