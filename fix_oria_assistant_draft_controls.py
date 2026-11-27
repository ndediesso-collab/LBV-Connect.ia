from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys

ROOT = Path.cwd()
BACKEND = ROOT / "Backend"
PROTOCOL = BACKEND / "app" / "services" / "oria_assistant_request_protocol.py"
ADAPTER = BACKEND / "app" / "services" / "oria_assistant_provider_adapter.py"
TESTS = BACKEND / "tests" / "test_oria_assistant_request_protocol.py"

required = [PROTOCOL, ADAPTER, TESTS]
missing = [str(p.relative_to(ROOT)) for p in required if not p.is_file()]
if missing:
    print("ERREUR : lance ce script depuis la racine du dépôt LBV-Connect.ia.")
    print("Fichiers introuvables : " + ", ".join(missing))
    sys.exit(1)

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")


def backup(path: Path) -> None:
    target = path.with_name(path.name + f".bak-draft-controls-{stamp}")
    target.write_bytes(path.read_bytes())
    print(f"Sauvegarde : {target.relative_to(ROOT)}")


# 1) The server should recognize a single well-formed draft marker, not a
# particular consent sentence in the model's natural-language response.
protocol_text = PROTOCOL.read_text(encoding="utf-8")
old_gate = "if not collection_enabled or len(matches) != 1 or not _assistant_asked_for_consent(visible):"
new_gate = "if not collection_enabled or len(matches) != 1:"
protocol_changed = False
if old_gate in protocol_text:
    protocol_text = protocol_text.replace(old_gate, new_gate, 1)
    protocol_changed = True
elif new_gate not in protocol_text:
    raise RuntimeError("Condition d'extraction du brouillon introuvable : aucun changement appliqué au protocole.")

# Remove the now-obsolete linguistic consent detector so it cannot be reused
# accidentally as a gate in this flow.
helper_pattern = re.compile(
    r"\ndef _assistant_asked_for_consent\(visible_message: str\) -> bool:\n.*?(?=\n+def _clean_details\()",
    re.DOTALL,
)
protocol_text, removed = helper_pattern.subn("\n", protocol_text, count=1)
if removed:
    protocol_changed = True

if protocol_changed:
    backup(PROTOCOL)
    PROTOCOL.write_text(protocol_text, encoding="utf-8", newline="\n")
    print("OK : le backend n'exige plus de formule de consentement dans le texte de l'IA.")
else:
    print("OK : le protocole applique déjà la reconnaissance par brouillon seul.")

# 2) Instruct the model to emit the invisible draft marker as soon as the
# recap is ready. The UI's two buttons are the actual consent choice.
adapter_text = ADAPTER.read_text(encoding="utf-8")
start_anchor = '            "- Une fois les informations nécessaires réunies, affiche un récapitulatif clair'
end_anchor = '            "- N\'affirme jamais que la demande est enregistrée'
start = adapter_text.find(start_anchor)
end = adapter_text.find(end_anchor, start if start >= 0 else 0)
new_prompt_block = '''            "- Une fois les informations nécessaires réunies, affiche un récapitulatif fidèle et clair de la demande.\\n"
            "- Immédiatement après ce récapitulatif, ajoute un unique commentaire HTML technique invisible au visiteur, "
            "au format exact suivant (JSON valide) : "
            "<!--ORIA_ASSISTANT_REQUEST_DRAFT:{\\\"request_type\\\":\\\"...\\\",\\\"summary\\\":\\\"...\\\","
            "\\\"customer_name\\\":\\\"...\\\",\\\"customer_phone\\\":\\\"...\\\","
            "\\\"customer_email\\\":null,\\\"details\\\":{\\\"Champ demandé\\\":\\\"Valeur\\\"}}--> .\\n"
            "- Ce commentaire contient uniquement les informations non sensibles déjà fournies par le visiteur : type de demande, "
            "résumé, nom, téléphone, e-mail facultatif et champs complémentaires configurés. Reprends les valeurs des champs "
            "complémentaires dans les mots du visiteur, sans les deviner ni les compléter. N'ajoute jamais de document, numéro "
            "de carte, PIN, mot de passe, OTP, numéro de compte ou donnée bancaire sensible.\\n"
            "- Émets ce commentaire dès que les champs nécessaires sont réunis ET que tu viens d'afficher leur récapitulatif. "
            "N'attends pas une réponse textuelle du visiteur pour le produire. ORIA affichera alors les boutons « Transmettre » "
            "et « Ne pas transmettre ». Le visiteur décide lui-même : seul son clic sur « Transmettre » autorise l'envoi. "
            "Un message comme « oui » dans le chat ne transmet jamais automatiquement les données.\\n"
'''
if start >= 0 and end > start:
    adapter_text = adapter_text[:start] + new_prompt_block + adapter_text[end:]
    backup(ADAPTER)
    ADAPTER.write_text(adapter_text, encoding="utf-8", newline="\n")
    print("OK : le modèle doit émettre le brouillon immédiatement après le récapitulatif.")
elif "Émets ce commentaire dès que les champs nécessaires sont réunis" in adapter_text:
    print("OK : les consignes du modèle appliquent déjà la règle du récapitulatif.")
else:
    raise RuntimeError("Bloc de consignes de collecte introuvable : aucun changement appliqué à l'adaptateur.")

# 3) Regression tests: no wording-specific consent detector; the marker is
# enough to show the UI card. Preserve all existing payload safety checks.
tests_text = TESTS.read_text(encoding="utf-8")
new_tests = r'''


def test_request_draft_is_extracted_from_recap_without_consent_sentence():
    message = (
        "Merci, voici le récapitulatif de votre demande : Location Toyota Hilux pendant 3 jours.\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.","customer_name":"Jules",'
        '"customer_phone":"+241 74 32 22 19","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. Je souhaite louer un Toyota Hilux pendant 3 jours."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"


def test_request_draft_is_extracted_with_communication_noun_consent_wording():
    message = (
        "Voici le récapitulatif. Autorisez-vous la communication de ces informations "
        "à Gabon Drive Location afin que l'équipe puisse étudier votre demande ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.","customer_name":"Jules",'
        '"customer_phone":"+241 74 32 22 19","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. Je souhaite louer un Toyota Hilux pendant 3 jours."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["request_type"] == "Location Toyota Hilux"
'''
if "def test_request_draft_is_extracted_from_recap_without_consent_sentence" not in tests_text:
    backup(TESTS)
    tests_text = tests_text.rstrip() + new_tests + "\n"
    TESTS.write_text(tests_text, encoding="utf-8", newline="\n")
    print("OK : deux tests de régression ajoutés.")
else:
    print("OK : tests de régression déjà présents.")

print("\nTerminé. Aucun commit, push, déploiement ni accès Supabase n'a été effectué.")
print("Fichiers modifiés :")
for path in required:
    print(f"  - {path.relative_to(ROOT)}")
