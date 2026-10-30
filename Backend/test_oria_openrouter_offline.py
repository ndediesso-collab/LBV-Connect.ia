#!/usr/bin/env python3
"""Tests hors ligne de la livraison OpenRouter ORIA.

Usage (depuis le dossier qui contient ai.py):
    python test_oria_openrouter_offline.py --backend ai.py

Ou avec son chemin dans le projet:
    python test_oria_openrouter_offline.py --backend app/routers/ai.py

Aucun import d'ORIA, aucune connexion HTTP/Supabase/OpenRouter, aucune facturation.
Les fonctions du backend sont extraites de l'AST et executées avec des doubles locaux.
"""
from __future__ import annotations

import argparse
import ast
from decimal import Decimal
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock


class StubMedia:
    def __init__(self):
        self.images = []
        self.videos = []
        self.fail = False
        self.result = {"id": "media-001", "media_url": "https://example.invalid/image.png"}

    def save_google_image(self, **kwargs):
        self.images.append(kwargs)
        if self.fail:
            raise OSError("Stockage indisponible (simulation)")
        return self.result.copy()

    def save_google_video(self, **kwargs):
        self.videos.append(kwargs)
        raise AssertionError("Le test ne doit jamais lancer de video")


class StubCredits:
    def __init__(self):
        self.calls = []
        self.fail = False

    def settle_credit_reservation(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise ConnectionError("Confirmation de paiement incertaine (simulation)")


class Harness:
    def __init__(self, finish, actual, *, credits_return=202):
        self.media = StubMedia()
        self.credits = StubCredits()
        self.job = {
            "request_id": "test-request-001", "reservation_id": "test-reservation-001",
            "reserved_credits": 3600, "status": "generated", "action": "image_pro",
            "prompt": "Un paysage de test", "media_type": "image",
            "media_id": None, "media_url": None, "usage_cost_usd": None,
            "settled_credits": None,
        }
        self.changes = []
        self.reject_store_link = False
        self.reject_completion = False
        self.credits_return = credits_return
        self.env = {
            "Any": Any, "Decimal": Decimal, "logging": logging,
            "credit_costs_config": SimpleNamespace(ACCOUNTING_USD_XAF=600),
            "_or_credits": lambda _: self.credits_return,
            "MediaService": lambda: self.media,
            "SupabaseCreditRepository": lambda _client: self.credits,
            "supabase": object(),
            "_or_job_update": self.update,
            "_or_job_get": lambda uid, rid: self.job.copy(),
            "_or_public_job": lambda data: data.copy(),
        }
        exec(actual, self.env)
        exec(finish, self.env)

    def update(self, uid, request_id, changes, old_status=None):
        if old_status is not None and old_status != self.job["status"]:
            return False
        if changes.get("status") == "media_stored" and self.reject_store_link:
            return False
        if changes.get("status") == "completed" and self.reject_completion:
            return False
        self.job.update(changes)
        self.changes.append(changes.copy())
        return True

    def finish(self, cost, *, mime="image/png"):
        generated = Mock(
            mime_type=mime,
            usage={"cost": cost} if cost is not Ellipsis else {},
            file_path="/does/not/exist/never-opened.png",
        )
        return self.env["_or_finish"]("user-test", self.job.copy(), generated, "image")


def source_functions(backend: Path):
    tree = ast.parse(backend.read_text(encoding="utf-8"), filename=str(backend))
    output = {}
    for name in ("_or_actual", "_or_finish"):
        nodes = [n for n in tree.body
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name]
        if len(nodes) != 1:
            raise RuntimeError(f"Impossible de trouver la fonction {name} dans {backend}")
        output[name] = compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])),
                               str(backend), "exec")
    return output


def run_case(title, check, results):
    try:
        check()
    except Exception as err:
        results.append((title, False, str(err)))
        print(f"ECHEC  {title}: {type(err).__name__}: {err}")
    else:
        results.append((title, True, ""))
        print(f"OK     {title}")


def main():
    parser = argparse.ArgumentParser(description="Verification sans paiement du backend ORIA")
    parser.add_argument("--backend", default="ai.py", help="Chemin du fichier ai.py a verifier")
    args = parser.parse_args()
    backend = Path(args.backend)
    if not backend.is_file():
        parser.error(f"Fichier introuvable : {backend} (utiliser --backend chemin/vers/ai.py)")
    compiled = source_functions(backend)
    print(f"Backend analyse : {backend.resolve()}")
    print("Mode : SIMULATION LOCALE, aucun appel reseau ni debit.\n")
    def h(**kwargs):
        return Harness(compiled["_or_finish"], compiled["_or_actual"], **kwargs)

    def missing_cost():
        t = h()
        data = t.finish(Ellipsis)
        assert data["status"] == "reconcile", data
        assert data["media_id"] == "media-001" and data["media_url"], data
        assert len(t.media.images) == 1
        assert t.media.images[0]["credits_cost"] == 0
        assert not t.credits.calls
        assert data["settled_credits"] is None
        assert any("facturation" in str(v).lower() or "coût" in str(v).lower()
                   for v in t.job.values() if isinstance(v, str))

    def valid_cost():
        t = h()
        data = t.finish("0.10")
        assert data["status"] == "completed", data
        assert data["media_id"] == "media-001"
        assert data["settled_credits"] == 202
        assert len(t.media.images) == 1 and len(t.credits.calls) == 1
        assert t.credits.calls[0]["actual_amount"] == 202
        assert t.changes[0]["status"] == "media_stored"
        assert t.changes[-1]["status"] == "completed"

    def beyond_quote():
        t = h(credits_return=5000)
        data = t.finish("0.90")
        assert data["status"] == "reconcile" and data["media_id"] == "media-001", data
        assert len(t.credits.calls) == 0

    def storage_error():
        t = h()
        t.media.fail = True
        try:
            t.finish("0.10")
        except OSError as e:
            assert "Stockage" in str(e)
        else:
            raise AssertionError("L'erreur de stockage aurait du etre remontee")
        assert not t.credits.calls and t.job["status"] == "generated"

    def association_error():
        t = h()
        t.reject_store_link = True
        try:
            t.finish("0.10")
        except RuntimeError:
            pass
        else:
            raise AssertionError("L'absence de lien vers le media doit arreter la facturation")
        assert not t.credits.calls

    def uncertain_settlement():
        t = h()
        t.credits.fail = True
        try:
            t.finish("0.10")
        except ConnectionError:
            pass
        else:
            raise AssertionError("Un reglement incertain doit etre signale")
        assert t.job["status"] == "media_stored"
        assert t.job["media_id"] == "media-001"
        assert len(t.credits.calls) == 1
        assert t.job["settled_credits"] is None

    def job_update_failure():
        t = h()
        t.reject_completion = True
        try:
            t.finish("0.10")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Le job ne peut pas etre declare complete sans confirmation")
        assert t.job["status"] == "media_stored"
        assert t.job["settled_credits"] is None
        assert len(t.credits.calls) == 1

    cases = [
        ("Cout OpenRouter absent : image conservee, pas de debit", missing_cost),
        ("Cout valide : sauvegarde puis reglement unique", valid_cost),
        ("Cout superieur au plafond : pas de debit", beyond_quote),
        ("Stockage en echec : pas de debit", storage_error),
        ("Lien media non confirme : pas de debit", association_error),
        ("Reglement incertain : ne pas annoncer une reussite", uncertain_settlement),
        ("Finalisation SQL incertaine : ne pas marquer termine", job_update_failure),
    ]
    results = []
    for title, fn in cases:
        run_case(title, fn, results)
    count = sum(ok for _, ok, _ in results)
    print(f"\nRESULTAT : {count}/{len(cases)} tests reussis")
    if count == len(cases):
        print("PASS : logique de traitement testee hors ligne. Integration reelle non verifiee.")
        return 0
    print("ECHEC : ne pas retenter de generation payante.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
