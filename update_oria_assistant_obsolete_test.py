from pathlib import Path
import re

path = Path('Backend/tests/test_oria_assistant_request_protocol.py')
if not path.is_file():
    raise SystemExit(f"Fichier introuvable : {path}. Lance ce script depuis la racine du dépôt LBV-Connect.ia.")

source = path.read_text(encoding='utf-8')
old_name = 'test_request_draft_is_not_accepted_without_explicit_consent_question'
new_name = 'test_valid_request_draft_does_not_require_consent_phrase_in_ai_text'

if new_name in source:
    print('Le test obsolète a déjà été mis à jour. Aucun changement nécessaire.')
    raise SystemExit(0)

pattern = re.compile(
    r'def ' + re.escape(old_name) + r'\(\):\n.*?(?=\ndef |\Z)',
    re.DOTALL,
)
match = pattern.search(source)
if not match:
    raise SystemExit(f"Le test attendu '{old_name}' est introuvable. Aucun fichier modifié.")

replacement = '''def test_valid_request_draft_does_not_require_consent_phrase_in_ai_text():
    # La carte de transmission est présentée dès qu'un brouillon valide existe.
    # Le consentement est recueilli ensuite par le bouton explicite de l'interface.
    message = (
        "Votre récapitulatif est prêt.\\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une carte."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"
    assert draft["customer_phone"] == "+241 06 12 34 56"
'''

updated = source[:match.start()] + replacement + source[match.end():]
updated = updated.rstrip('\r\n') + '\n'
path.write_text(updated, encoding='utf-8', newline='')
print('OK : le test obsolète vérifie maintenant qu’un brouillon valide suffit, sans phrase de consentement.')
print(f'Fichier modifié : {path}')
