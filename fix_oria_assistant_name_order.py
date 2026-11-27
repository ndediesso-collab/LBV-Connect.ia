from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent
PROTOCOL = ROOT / "Backend" / "app" / "services" / "oria_assistant_request_protocol.py"
TESTS = ROOT / "Backend" / "tests" / "test_oria_assistant_request_protocol.py"

OLD = '''    if _normalized(customer_name) not in normalized_context or digits not in context_digits:
        return visible, None
'''
NEW = '''    # Le visiteur peut écrire le nom dans l'ordre « NOM, prénom » alors que
    # l'assistant le reformule dans l'ordre « prénom NOM ». Vérifier chaque
    # élément séparément permet ce réordonnancement sans accepter un élément
    # de nom que le visiteur n'a jamais fourni.
    name_tokens = re.findall(r"[a-z0-9]+", _normalized(customer_name))
    name_was_provided = bool(name_tokens) and all(
        re.search(
            rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])",
            normalized_context,
        )
        is not None
        for token in name_tokens
    )
    if not name_was_provided or digits not in context_digits:
        return visible, None
'''

TEST = '''\n\ndef test_request_draft_accepts_name_components_when_visitor_uses_surname_first():
    message = (
        "Merci, voici le récapitulatif. Acceptez-vous que ces informations "
        "soient communiquées à Gabon Drive Location pour étudier votre demande ?\\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.",'
        '"customer_name":"Orel Joel ESSO NDEDI",'
        '"customer_phone":"+241 74732219","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Nom : ESSO NDEDI, prénom : Orel Joel. "
            "Téléphone : +241 74732219. Je souhaite louer un Toyota Hilux."
        )}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Orel Joel ESSO NDEDI"


def test_request_draft_still_rejects_a_name_with_an_invented_component():
    message = (
        "Récapitulatif. Acceptez-vous que je transmette ces informations à l'entreprise ?\\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Demande",'
        '"summary":"Demande de contact client.",'
        '"customer_name":"Orel Joel ESSO NDEDI Junior",'
        '"customer_phone":"+241 74732219","details":{}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Nom : ESSO NDEDI, prénom : Orel Joel. "
            "Téléphone : +241 74732219."
        )}
    ])
    assert draft is None
'''


def backup(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = path.with_name(path.name + f".bak-name-order-{stamp}")
    shutil.copy2(path, target)
    return target


def main() -> int:
    for path in (PROTOCOL, TESTS):
        if not path.is_file():
            print(f"ERREUR : fichier introuvable : {path}")
            print("Place ce script à la racine du dépôt LBV-Connect.ia avant de l'exécuter.")
            return 1

    protocol_text = PROTOCOL.read_text(encoding="utf-8")
    if NEW not in protocol_text:
        if OLD not in protocol_text:
            print("ERREUR : le bloc attendu n'a pas été trouvé. Aucun fichier n'a été modifié.")
            return 1

    test_text = TESTS.read_text(encoding="utf-8")
    has_test = "test_request_draft_accepts_name_components_when_visitor_uses_surname_first" in test_text

    changed: list[Path] = []
    backups: list[Path] = []

    if OLD in protocol_text:
        backups.append(backup(PROTOCOL))
        PROTOCOL.write_text(protocol_text.replace(OLD, NEW, 1), encoding="utf-8", newline="")
        changed.append(PROTOCOL)

    if not has_test:
        backups.append(backup(TESTS))
        TESTS.write_text(test_text.rstrip() + TEST + "\n", encoding="utf-8", newline="")
        changed.append(TESTS)

    print("Correction appliquée : vérification du nom indépendante de l'ordre prénom/nom.")
    print("Fichiers modifiés :")
    for path in changed:
        print(f"  - {path.relative_to(ROOT)}")
    if backups:
        print("Sauvegardes créées :")
        for path in backups:
            print(f"  - {path.name}")
    else:
        print("Le correctif était déjà présent ; aucun changement supplémentaire.")
    print("Aucun déploiement ni accès à Supabase n'a été effectué.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
