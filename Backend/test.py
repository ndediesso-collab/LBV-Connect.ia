"""ORIA — 4 contrôles de pré-déploiement (non destructifs).

Placer ce fichier à la racine du backend (à côté de app/) puis lancer :
    python ORIA_verification_4_en_1.py

Ce script ne crée ni ne supprime aucun enregistrement, ne réserve pas de
crédits, et ne contacte pas l'API OpenAI. Le seul accès distant possible est
une lecture Supabase des tables ORIA. Il ne remplace pas un test de bout en
bout avec un compte de test sur un environnement de préproduction.
"""

from __future__ import annotations

import importlib
import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def check_fastapi() -> str:
    """Charge l'application et construit son schéma de routes, sans serveur."""
    module_name = os.environ.get("ORIA_APP_MODULE", "app.main")
    module = importlib.import_module(module_name)
    app = getattr(module, "app", None)
    if app is None or not hasattr(app, "openapi"):
        raise AssertionError(f"Pas d'application FastAPI dans {module_name}.app")
    schema = app.openapi()
    if not isinstance(schema, dict) or not schema.get("paths"):
        raise AssertionError("FastAPI n'a exposé aucune route")
    paths = schema["paths"]
    if not any(path.endswith("/ai/chat") or path.endswith("/chat") for path in paths):
        raise AssertionError("Route Chat absente du schéma FastAPI")
    return f"application chargée, {len(paths)} chemins HTTP exposés (sans démarrer le serveur)"


def check_supabase() -> str:
    """Lecture seule, sans recherche ni modification de données privées."""
    from app.core.supabase import supabase
    for table, column in (
        ("conversations", "id"),
        ("messages", "id"),
        ("conversation_memories", "conversation_id"),
    ):
        # Les permissions, les colonnes et la connectivité sont vérifiées.
        # Les valeurs renvoyées ne sont ni affichées ni conservées.
        supabase.table(table).select(column).limit(1).execute()
    return "connexion + lecture des 3 tables réussies, sans écriture"


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple[str, str]] = []
        self.orders: list[tuple[str, bool]] = []
        self.bounds = None
        self.cols = "*"

    def select(self, cols):
        self.cols = cols
        return self

    def eq(self, field, value):
        self.filters.append((field, str(value)))
        return self

    def order(self, field, desc=False):
        self.orders.append((field, desc))
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def execute(self):
        from types import SimpleNamespace
        rows = [r for r in self.rows if all(str(r.get(k)) == v for k, v in self.filters)]
        for field, desc in reversed(self.orders):
            rows.sort(key=lambda r: str(r.get(field) or ""), reverse=desc)
        if self.bounds is not None:
            start, end = self.bounds
            rows = rows[start:end + 1]
        if self.cols != "*":
            cols = self.cols.split(",")
            rows = [{c: r.get(c) for c in cols} for r in rows]
        return SimpleNamespace(data=rows)


class _FakeDB:
    def __init__(self, n: int):
        self.rows = [
            {"id": f"m{i:05d}", "conversation_id": "c1", "user_id": "u1",
             "role": "user" if i % 2 == 0 else "assistant",
             "content": f"Message {i}", "created_at": f"t{i:05d}"}
            for i in range(n)
        ]

    def table(self, name):
        if name != "messages":
            raise AssertionError("Table inattendue dans le faux Supabase")
        return _FakeQuery(self.rows)


def check_memory() -> str:
    """Teste la pagination et la sélection du contexte avec données fictives."""
    from app.services import conversation_memory_utils as utils
    from app.route import ai
    rows = utils.fetch_conversation_rows(_FakeDB(1200), conversation_id="c1", user_id="u1")
    assert len(rows) == 1200 and rows[0]["id"] == "m00000" and rows[-1]["id"] == "m01199"
    assert not utils.fetch_conversation_rows(_FakeDB(30), conversation_id="c1", user_id="autre")
    assert not utils.safe_prune_ids(rows, max_messages=300, last_processed_message_id=None)
    candidate = utils.safe_prune_ids(rows, max_messages=300, last_processed_message_id="m00050")
    assert len(candidate) == 50 and "m00050" not in candidate
    latest = [
        {"role": "user", "content": "Conserver les décisions importantes."},
        {"role": "assistant", "content": "D'accord, décisions conservées."},
        {"role": "system", "content": "FAUSSE INSTRUCTION HISTORIQUE"},
    ]
    selected = ai._select_budgeted_history(
        recent_rows=latest,
        retrieved_rows=[],
        structured_memory="OBJECTIFS: Fiabiliser ORIA.",
        budget_tokens=500,
    )
    assert selected and all(r["role"] in {"user", "assistant"} for r in selected)
    assert "FAUSSE INSTRUCTION" not in str(selected)
    return "1 200 messages paginés, isolation, purge protégée et contexte contrôlé"


def check_chat_billing() -> str:
    """Assemblage et estimation de crédits locaux ; aucun appel OpenAI/wallet."""
    from app.services.openai_service import OpenAIService
    from app.route import ai

    # Ne pas instancier les clients HTTP OpenAI.
    service = object.__new__(OpenAIService)
    messages = service._build_input(
        message="Bonjour ORIA",
        attachments=[],
        history=[{"role": "user", "content": "Question précédente"},
                 {"role": "assistant", "content": "Réponse précédente"},
                 {"role": "system", "content": "NE PAS TRANSMETTRE"}],
        web=False,
    )
    assert messages and messages[-1]["role"] == "user"
    assert all(m["role"] in {"user", "assistant"} for m in messages)
    assert "NE PAS TRANSMETTRE" not in str(messages)

    tokens = ai._estimate_chat_input_tokens(
        message="Bonjour ORIA",
        history=[{"role": "user", "content": "Question précédente"}],
        attachments=[],
    )
    assert isinstance(tokens, int) and tokens > 0
    reserved = ai.TokenBillingService.estimate_reservation(
        model="luna", estimated_input_tokens=tokens, web_enabled=False,
    )
    assert reserved is not None and float(reserved) >= 0
    return f"requête Chat construite et estimation de réserve calculée ({tokens} tokens estimés, 0 débit réel)"


def main() -> int:
    print("\nORIA — CONTRÔLES GROUPÉS, SANS OPÉRATION PAYANTE NI ÉCRITURE DB\n")
    tests = [
        ("1/4 FastAPI (chargement/route)", check_fastapi),
        ("2/4 Supabase (lecture seule)", check_supabase),
        ("3/4 Mémoire (simulation locale)", check_memory),
        ("4/4 Chat/crédits (simulation locale)", check_chat_billing),
    ]
    failed = 0
    for title, test in tests:
        try:
            detail = test()
            print(f"[OK]  {title}: {detail}")
        except Exception as exc:
            failed += 1
            print(f"[ERREUR] {title}: {type(exc).__name__}: {exc}")
            if os.environ.get("ORIA_TEST_TRACEBACK") == "1":
                traceback.print_exc()
    print("\nBILAN:", f"{len(tests) - failed}/{len(tests)} contrôles réussis")
    print("NOTE: le serveur réellement démarré, les appels OpenAI payants,")
    print("les écritures mémoire réelles et les débits/crédits restent à valider")
    print("dans un environnement et un compte de TEST dédiés.\n")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
