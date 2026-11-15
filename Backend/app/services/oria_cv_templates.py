"""Three ORIA CV layout specifications for the existing code-first artifact engine.

No renderer is added here. The LLM authors a single safe oria.artifact.v1
HTML source; ArtifactService alone validates, converts and stores PDF/DOCX.
"""
from __future__ import annotations

STYLE_LABELS = {"classique": "Classique", "moderne": "Moderne", "creatif": "Créatif"}
DEFAULT_STYLE = "moderne"

_BASE = """MODE CV ORIA — contrat documentaire de données, pas de design libre.
Tu es chargé UNIQUEMENT de rédiger/structurer les informations du candidat.
Le backend applique le gabarit code-first et fabrique PDF/DOCX ensuite.
Retourne EXACTEMENT UN objet JSON oria.artifact.v1 avec sources=[] et un
seul artifact de format demandé. source_id=null. native_data est un objet
structuré CV de cette forme (adapter au contenu réel):
{"cv_v1":true,"style":"__STYLE__","name":"Nom complet", "title":"Stage en ...",
 "city":"Libreville","phone":"...","email":"...",
 "profile":"Résumé professionnel rédigé",
 "education":[{"title":"Diplôme","organization":"Établissement",
                "period":"2025","description":"","bullets":[]}],
 "experiences":[{"title":"Intitulé","organization":"Structure",
                "period":"Période","description":"Missions","bullets":["Action"]}],
 "projects":[], "skills":["Excel"],
 "languages":[{"name":"Français","level":"Courant"}],
 "certifications":[]}
L'objet racine complet doit rester STRICTEMENT
{"schema_version":"oria.artifact.v1","sources":[],
 "artifacts":[{"format":"__FORMAT__","filename":"cv.__FORMAT__",
               "source_id":null,"native_data":{...}}]}.
Le vrai format et le style sont imposés plus bas. Ne crée PAS toi-même
HTML, CSS, JS, base64, images, URLs ni faux documents. Le backend fera la
mise en page A4 et le rendu final. Tu dois uniquement remplir native_data.
N'invente jamais de nom, coordonnées, diplôme, employeur, date, réalisation,
certification, résultat ni niveau linguistique. Une section inapplicable est
une liste vide, jamais un contenu factice. Expériences absentes => [] ;
valorise les projets, études et compétences déjà fournis.
Si une ville/téléphone/email n'a pas été communiqué, mets une chaîne vide,
mais ne modifie JAMAIS une information personnelle déjà donnée.
Les exemples du schéma ci-dessus sont des indications de structure,
JAMAIS des données à recopier. Remplace leurs valeurs par les véritables
informations de la conversation. Toutes les chaînes et listes doivent
respecter le JSON, sans commentaire, ni Markdown ni texte d'introduction.
Reformule de manière professionnelle, claire, adaptée à l'objectif, sans
inventer un parcours. Le profil débutant tient normalement sur une page ;
le moteur adapte la pagination si le contenu exige deux pages.
Photo : aucune image ne doit être inventée ou ajoutée automatiquement.
Le serveur a déjà vérifié que les informations essentielles suffisent :
ne demande pas de nouvelle confirmation.
"""

_CLASSIQUE = """MODELE CV_CLASSIQUE (privilégie ce style pour ATS)
Une colonne sur feuille blanche A4, marges 15–20 mm. Couleurs noir / gris
foncé; nom 20–24pt gras; rubriques 11–12pt majuscules avec trait de 1px;
texte 10–11pt. Débute par nom, fonction recherchée, ville et contacts,
puis PROFIL, EXPERIENCES/PROJETS si applicables, FORMATION, COMPETENCES,
LANGUES. Aucun tableau de mise en page à plusieurs colonnes, pas de barre
latérale, pas d'icônes décoratives. Texte facilement extractible/ATS.
"""

_MODERNE = """MODELE CV_MODERNE (PAR DEFAUT)
A4 portrait avec deux colonnes asymétriques ; utiliser un tableau HTML
STATIQUE de mise en page, largeur 100%, avec une seule ligne et deux cellules
vertical-align:top (plus compatible avec PDF/DOCX que CSS grid).
Colonne gauche 30%, fond bleu nuit #17263D (ou anthracite #252525), texte
blanc : CONTACT, COMPETENCES, LANGUES, et CERTIFICATIONS si connues.
Colonne droite 70%, fond blanc, texte #222222 : NOM 22–26pt en haut,
TITRE PROFESSIONNEL, PROFIL, EXPERIENCES/PROJETS, FORMATION.
Marges extérieures 12–16 mm, séparation nette, titres 11–12pt,
corps 10–11pt, accents sobres. Si le contenu dépasse une page, privilégie
une pagination lisible plutôt que des caractères trop petits.
"""

_CREATIF = """MODELE CV_CREATIF
A4 portrait, fond principalement blanc, anthracite #252525, couleur
terracotta #B65E42 par défaut (ou autre accent explicitement demandé).
Nom 24–30pt, titres 11–13pt, texte 10–11pt. Composition asymétrique
mais fluide, blocs de réalisations et projets valorisés. Utilise des lignes,
encadrés et séparateurs simples, pas d'illustrations inventées.
Garde une forte lisibilité, sans ressembler à une affiche publicitaire.
"""

_STYLES = {"classique": _CLASSIQUE, "moderne": _MODERNE, "creatif": _CREATIF}


def cv_generation_message(message: str, *, style: str, fmt: str) -> str:
    """Provider-bound message; include before quote to reserve sufficient tokens."""
    if style not in _STYLES:
        raise ValueError("Modèle CV inconnu")
    if fmt not in {"pdf", "docx"}:
        raise ValueError("Export CV non autorisé")
    original=str(message or "").strip()
    if not original:
        raise ValueError("Demande CV vide")
    required=_BASE.replace('__STYLE__',style).replace('__FORMAT__',fmt)
    return (required + "\n" + _STYLES[style] +
            f"\nFORMAT FINAL STRICT : {fmt.upper()} ; exactement un fichier.\nSTYLE NATIVE_DATA STRICT : {style}.\n"
            "S'il s'agit d'une suite de conversation, récupère les données factuelles "
            "dans les messages UTILISATEUR précédents, jamais dans des suppositions.\n"
            "DERNIER MESSAGE UTILISATEUR :\n" + original)
