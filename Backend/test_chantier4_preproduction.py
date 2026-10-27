#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ORIA / Chantier 4 - preproduction OFFLINE, sans aucun appel payant.

Installation : copier CE FICHIER dans Backend/test_chantier4_preproduction.py
Execution   : cd Backend && python test_chantier4_preproduction.py
Options     : python test_chantier4_preproduction.py --verbose
              python test_chantier4_preproduction.py --root /chemin/vers/Backend

Utilise la bibliotheque standard uniquement. N'importe pas le Backend complet :
les modules fournis sont analyses par AST, puis seulement leurs classes/metiers
pertinents sont testes avec de faux repositories/fournisseurs. Il n'y a PAS de
reseau, paiement, ecriture SQL, activation de flags, upload ou creation audio.
Ces tests ne prouvent PAS que les RPC SQL/deploiements Render fonctionnent.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import unittest
from uuid import uuid4


FILES = {
    "audio": "app/services/audio_service.py",
    "course": "app/services/course_service.py",
    "worker": "app/services/course_worker.py",
    "routes": "app/route/courses.py",
}
OPTIONAL = {
    "consumer": "app/services/course_queue_consumer.py",
    "queue": "app/repositories/supabase_course_queue_repository.py",
    "jobs": "app/repositories/supabase_course_job_repository.py",
    "credits": "app/repositories/supabase_credit_repository.py",
}


def find_backend(explicit: str | None) -> Path:
    here = Path(__file__).resolve().parent
    candidates = [Path(explicit).expanduser().resolve()] if explicit else [here, here / "Backend", here.parent / "Backend"]
    for candidate in candidates:
        if all((candidate / relative).is_file() for relative in FILES.values()):
            return candidate
    checked = ", ".join(str(p) for p in candidates)
    raise FileNotFoundError(
        "Les 4 fichiers ORIA ne sont pas presents dans le Backend detecte. "
        "Place le test dans Backend/ ou indique --root. Emplacements verifies : " + checked
    )


def get_ast(backend: Path, key: str) -> ast.Module:
    path = backend / FILES[key]
    return ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))


def selected_nodes(source: ast.Module, *, classes: set[str] | None = None,
                   functions: set[str] | None = None) -> list[ast.stmt]:
    classes = classes or set()
    functions = functions or set()
    return [node for node in source.body
            if ((isinstance(node, ast.ClassDef) and node.name in classes)
                or (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in functions))]


def compile_selected(backend: Path, key: str, nodes: list[ast.stmt], extra: dict | None = None) -> dict:
    path = backend / FILES[key]
    mod = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)] + nodes, type_ignores=[])
    ast.fix_missing_locations(mod)
    ns = {"__name__": "oria_chantier4_test_isole", "uuid4": uuid4, "PurePosixPath": PurePosixPath,
          "math": math, "hashlib": hashlib, "json": json, "os": os, "shutil": shutil}
    ns.update(extra or {})
    exec(compile(mod, str(path), "exec"), ns)
    return ns


def build_namespace(backend: Path) -> dict:
    audio_tree = get_ast(backend, "audio")
    audio_classes = {"AudioError", "AudioUnavailable", "AudioConflict",
                     "AudioInsufficientCredits", "AudioPackInactive", "AudioNotFound",
                     "AudioInvalid", "AudioService", "CourseAudioPolicy"}
    audio = compile_selected(backend, "audio", selected_nodes(audio_tree, classes=audio_classes))
    missing = audio_classes - audio.keys()
    if missing:
        raise AssertionError("Classes audio manquantes : " + ", ".join(sorted(missing)))
    audio["AudioService"]._billing_parameters = classmethod(lambda cls: ("fake_audio_action", 1))
    audio["AudioService"]._reservation_ttl_seconds = staticmethod(lambda: 3600)

    course_tree = get_ast(backend, "course")
    course = compile_selected(backend, "course", selected_nodes(course_tree, functions={"_split_sections"}),
                              extra={"SECTION_MAX_CHARS": 12500})

    worker_tree = get_ast(backend, "worker")
    exceptions = {"CourseWorkerError", "CourseWorkerNotReady", "CourseWorkerNeedsReconciliation"}
    worker = compile_selected(backend, "worker", selected_nodes(worker_tree, classes=exceptions | {"_GuardedJobStore"}))
    check_ready = next((m for n in worker_tree.body if isinstance(n, ast.ClassDef) and n.name == "CourseWorker"
                        for m in n.body if isinstance(m, ast.FunctionDef) and m.name == "_check_ready"), None)
    if check_ready is None:
        raise AssertionError("CourseWorker._check_ready est absent")
    # Executer LA VRAIE methode _check_ready, sans instancier le worker de production.
    wrapper = ast.ClassDef(name="_ReadyPolicy", bases=[], keywords=[], body=[check_ready], decorator_list=[])
    ast.fix_missing_locations(wrapper)
    ns = compile_selected(backend, "worker", [wrapper], extra=worker)
    worker.update(ns)

    return {"audio": audio, "course": course, "worker": worker}


class FakeAudioRepository:
    def __init__(self, *, fail_download=False, fail_save=False):
        self.record = {"id": str(uuid4()), "storage_path": "audio/private.m4a",
                       "mime_type": "audio/mp4", "credit_cost": 3,
                       "transcription_status": "queued", "billing_status": "none",
                       "delivery_mode": "draft", "duration_ms": 3000}
        self.fail_download = fail_download
        self.fail_save = fail_save
        self.transitions = []

    def get(self, *, user_id, audio_id):
        return self.record.copy()

    def update(self, *, user_id, audio_id, values, expected_status=None):
        if expected_status is not None and self.record["transcription_status"] != expected_status:
            return None
        if self.fail_save and values.get("transcription"):
            raise OSError("Simulation : ecriture SQL apres OpenAI indisponible")
        self.transitions.append(dict(values))
        self.record.update(values)
        return self.record.copy()

    def download(self, **kwargs):
        if self.fail_download:
            raise OSError("Simulation : stockage indisponible avant OpenAI")
        return b"FAKE_AUDIO_NO_NETWORK"


class FakeCredits:
    def __init__(self, *, fail_settle=False):
        self.reservations, self.settled, self.released = [], [], []
        self.fail_settle = fail_settle

    def reserve_credits(self, **kwargs):
        self.reservations.append(kwargs)

    def settle_credit_reservation(self, **kwargs):
        if self.fail_settle:
            raise OSError("Simulation : timeout de settlement")
        self.settled.append(kwargs)

    def release_credit_reservation(self, **kwargs):
        self.released.append(kwargs)


class FakeProvider:
    def __init__(self, mode="ok"):
        self.mode, self.calls = mode, 0

    def transcribe_audio(self, **kwargs):
        self.calls += 1
        if self.mode == "timeout":
            raise TimeoutError("Simulation : timeout OpenAI apres envoi")
        if self.mode == "empty":
            return {"text": ""}
        return {"text": "Transcription fictive du cours."}


class OriaTests(unittest.TestCase):
    # Pas de setUp dependant de modules FastAPI/Supabase installes.
    namespace: dict = {}
    backend: Path

    def service(self, repo: FakeAudioRepository, credits: FakeCredits, provider: FakeProvider):
        cls = self.namespace["audio"]["AudioService"]
        result = cls.__new__(cls)
        result.repo, result.credits, result._openai_service = repo, credits, provider
        return result

    def run_audio(self, service, repo):
        return service.process_audio(user_id=str(uuid4()), audio_id=repo.record["id"])

    def test_01_success_reserved_and_settled_once(self):
        repo, credits, provider = FakeAudioRepository(), FakeCredits(), FakeProvider()
        result = self.run_audio(self.service(repo, credits, provider), repo)
        self.assertEqual(result["transcription_status"], "complete")
        self.assertEqual(result["billing_status"], "settled")
        self.assertEqual((len(credits.reservations), len(credits.settled), len(credits.released)), (1, 1, 0))
        self.assertEqual(provider.calls, 1)

    def test_02_error_before_openai_releases_reservation(self):
        repo, credits, provider = FakeAudioRepository(fail_download=True), FakeCredits(), FakeProvider()
        service = self.service(repo, credits, provider)
        with self.assertRaises(OSError):
            self.run_audio(service, repo)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(repo.record["billing_status"], "released")
        self.assertEqual(len(credits.released), 1)
        self.assertEqual(service.queue_retry(user_id=str(uuid4()), audio_id=repo.record["id"])["transcription_status"], "queued")

    def test_03_timeout_after_openai_never_releases(self):
        repo, credits, provider = FakeAudioRepository(), FakeCredits(), FakeProvider("timeout")
        service = self.service(repo, credits, provider)
        with self.assertRaises(TimeoutError):
            self.run_audio(service, repo)
        self.assertEqual(provider.calls, 1)
        self.assertEqual(repo.record["billing_status"], "reserved")
        self.assertEqual(len(credits.released), 0)
        with self.assertRaises(self.namespace["audio"]["AudioConflict"]):
            service.queue_retry(user_id=str(uuid4()), audio_id=repo.record["id"])

    def test_04_empty_response_never_releases(self):
        repo, credits, provider = FakeAudioRepository(), FakeCredits(), FakeProvider("empty")
        with self.assertRaises(self.namespace["audio"]["AudioError"]):
            self.run_audio(self.service(repo, credits, provider), repo)
        self.assertEqual(repo.record["billing_status"], "reserved")
        self.assertEqual(len(credits.released), 0)

    def test_05_storage_error_after_provider_does_not_retry(self):
        repo, credits, provider = FakeAudioRepository(fail_save=True), FakeCredits(), FakeProvider()
        service = self.service(repo, credits, provider)
        with self.assertRaises(OSError):
            self.run_audio(service, repo)
        self.assertEqual(repo.record["billing_status"], "reserved")
        self.assertEqual(len(credits.released), 0)
        with self.assertRaises(self.namespace["audio"]["AudioConflict"]):
            service.queue_retry(user_id=str(uuid4()), audio_id=repo.record["id"])

    def test_06_settlement_timeout_does_not_release(self):
        repo, credits, provider = FakeAudioRepository(), FakeCredits(fail_settle=True), FakeProvider()
        service = self.service(repo, credits, provider)
        with self.assertRaises(OSError):
            self.run_audio(service, repo)
        self.assertEqual(repo.record["billing_status"], "settlement_pending")
        self.assertEqual(repo.record["transcription_status"], "complete")
        self.assertEqual(len(credits.released), 0)
        with self.assertRaises(self.namespace["audio"]["AudioConflict"]):
            service.queue_retry(user_id=str(uuid4()), audio_id=repo.record["id"])

    @staticmethod
    def segment(index: int, duration: int = 90_000, size: int = 10000):
        return {"index": index, "duration_ms": duration, "size_bytes": size,
                "mime_type": "audio/mp4", "extension": "m4a", "sha256": "a" * 64}

    def policy(self):
        return self.namespace["audio"]["CourseAudioPolicy"]

    def test_07_manifest_accepts_pdf_and_counts_total_minutes(self):
        result = self.policy().validate_manifest([self.segment(0), self.segment(1)], document_format="pdf")
        self.assertEqual(result["duration_ms"], 180000)
        self.assertEqual(result["billable_minutes"], 3)
        self.assertEqual(result["document_format"], "pdf")

    def test_08_manifest_accepts_docx_and_rounds_once(self):
        result = self.policy().validate_manifest([self.segment(0, 30001), self.segment(1, 30001)], document_format="DOCX")
        self.assertEqual(result["billable_minutes"], 2)
        self.assertEqual(result["document_format"], "docx")

    def test_09_manifest_rejects_duplicate_or_missing_segment(self):
        with self.assertRaises(self.namespace["audio"]["AudioInvalid"]):
            self.policy().validate_manifest([self.segment(0), self.segment(2)])
        with self.assertRaises(self.namespace["audio"]["AudioInvalid"]):
            self.policy().validate_manifest([self.segment(0), self.segment(0)])

    def test_10_manifest_rejects_oversize_segment(self):
        with self.assertRaises(self.namespace["audio"]["AudioInvalid"]):
            self.policy().validate_manifest([self.segment(0, size=21 * 1024 * 1024)])

    def test_11_manifest_rejects_more_than_four_hours(self):
        parts = [self.segment(i, duration=300000) for i in range(49)]
        with self.assertRaises(self.namespace["audio"]["AudioInvalid"]):
            self.policy().validate_manifest(parts)

    def test_12_manifest_rejects_invalid_digest(self):
        seg = self.segment(0)
        seg["sha256"] = "!" * 64
        with self.assertRaises(self.namespace["audio"]["AudioInvalid"]):
            self.policy().validate_manifest([seg])

    def test_13_voice_note_limit_5_minutes(self):
        policy = self.policy()
        audio = self.namespace["audio"]["AudioService"]
        self.assertEqual(audio.MAX_DURATION_SECONDS, 300)
        self.assertEqual(policy.MAX_SEGMENT_DURATION_SECONDS, 300)
        self.assertEqual(policy.MAX_COURSE_DURATION_MS, 14400000)

    def test_14_section_splitting_preserves_chronology_and_lengths(self):
        sections = self.namespace["course"]["_split_sections"](["mot " * 6000, "fin de cours"])
        self.assertGreaterEqual(len(sections), 2)
        self.assertTrue(all(0 < len(x) <= 12500 for x in sections))
        self.assertIn("Segment audio 1", sections[0])
        self.assertIn("Segment audio 2", sections[-1])
        self.assertIn("fin de cours", sections[-1])

    def test_15_course_ready_only_luna_and_sequential_reservations(self):
        policy = self.namespace["worker"]["_ReadyPolicy"]
        good = {"status": "queued", "plan": {
            "transcription_reservation_id": str(uuid4()),
            "document_reservation_id": str(uuid4()),
            "writing_model": "luna", "provider_model": "gpt-6-luna",
        }, "transcription_reservation_status": "reserved",
            "document_reservation_status": "pending"}
        policy._check_ready(good)
        bad = dict(good, document_reservation_status="reserved")
        with self.assertRaises(self.namespace["worker"]["CourseWorkerNotReady"]):
            policy._check_ready(bad)
        bad_model = dict(good, plan=dict(good["plan"], writing_model="other"))
        with self.assertRaises(self.namespace["worker"]["CourseWorkerNotReady"]):
            policy._check_ready(bad_model)

    def test_16_course_reconciliation_blocks_work(self):
        policy = self.namespace["worker"]["_ReadyPolicy"]
        with self.assertRaises(self.namespace["worker"]["CourseWorkerNeedsReconciliation"]):
            policy._check_ready({"status": "reconciliation_required"})

    def test_17_guarded_job_store_blocks_paid_calls_if_heartbeat_fails(self):
        guarded_cls = self.namespace["worker"]["_GuardedJobStore"]
        class Heartbeat:
            def __init__(self): self.healthy = False
            def ensure_healthy(self):
                if not self.healthy: raise RuntimeError("Bail perdu (simulation)")
        class Jobs:
            def __init__(self): self.calls = 0
            def begin_call(self, **kwargs): self.calls += 1
        hb, jobs = Heartbeat(), Jobs()
        guarded = guarded_cls(jobs, hb)
        with self.assertRaises(RuntimeError):
            guarded.begin_call(stage="transcription", index=0)
        self.assertEqual(jobs.calls, 0)
        hb.healthy = True
        guarded.begin_call(stage="transcription", index=0)
        self.assertEqual(jobs.calls, 1)

    def test_18_courses_routes_require_dispatch_before_confirm(self):
        source = (self.backend / FILES["routes"]).read_text(encoding="utf-8-sig")
        tree = ast.parse(source)
        confirm = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "confirm_course")
        body = ast.get_source_segment(source, confirm) or ""
        self.assertIn("ORIA_COURSE_DISPATCH_ENABLED", body)
        self.assertIn("_course_dispatcher", body)
        self.assertIn("confirm_and_reserve", body)
        self.assertLess(body.find("_course_dispatcher"), body.find("confirm_and_reserve"))

    def test_19_course_resume_is_not_accidentally_advertised_as_ready(self):
        source = (self.backend / FILES["routes"]).read_text(encoding="utf-8-sig")
        self.assertIn('"course_resume_supported": False', source)
        self.assertIn('"resume_available": False', source)

    def test_20_all_four_modules_compile_without_import_or_network(self):
        for key, relative in FILES.items():
            path = self.backend / relative
            compile(path.read_text(encoding="utf-8-sig"), str(path), "exec")


def report_environment(backend: Path) -> None:
    print("\n=== ETAT DU PREVOL (AUCUNE CONNEXION RESEAU) ===")
    for label, relative in OPTIONAL.items():
        path = backend / relative
        if path.is_file():
            try:
                compile(path.read_text(encoding="utf-8-sig"), str(path), "exec")
                print(f"[PRESENT] {label} : syntaxe Python OK")
            except SyntaxError as exc:
                print(f"[ATTENTION] {label} : erreur de syntaxe ligne {exc.lineno}")
        else:
            print(f"[A VERIFIER] {label} : fichier absent de ce dossier (non teste)")
    for executable in ("ffprobe", "ffmpeg"):
        print(f"[{'PRESENT' if shutil.which(executable) else 'A INSTALLER'}] {executable}")
    for key in ("ORIA_COURSE_DISPATCH_ENABLED", "ORIA_COURSE_CONSUMER_ENABLED"):
        value = os.environ.get(key)
        print(f"[INFO] {key} = {value if value in ('0', '1') else 'non defini dans le processus'}")
    legacy = os.environ.get("ORIA_ENFORCE_PACK_API_BUDGET")
    if legacy not in (None, "0"):
        print("[ALERTE] ORIA_ENFORCE_PACK_API_BUDGET n'est pas 0 : incompatible avec ORIA Cours.")
    if len(os.environ.get("ORIA_COURSE_QUOTE_SIGNING_KEY", "").encode("utf-8")) < 32:
        print("[A VERIFIER] Signature devis ORIA_COURSE_QUOTE_SIGNING_KEY : absente ou trop courte dans ce processus.")
    else:
        print("[PRESENT] Cle de signature des devis (valeur jamais affichee)")
    if not os.environ.get("ORIA_AUDIO_CREDITS_PER_MINUTE"):
        print("[A VERIFIER] ORIA_AUDIO_CREDITS_PER_MINUTE absent de ce processus.")
    print("[NON TESTE] RPC Supabase, RLS, credit reel, service Render, appels OpenAI, exports reels.")
    print("[IMPORTANT] Les variables de production ne sont pas chargees depuis .env ni modifiees ici.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Preproduction ORIA Cours + notes vocales, totalement offline")
    parser.add_argument("--root", help="Chemin du dossier Backend contenant app/")
    parser.add_argument("--verbose", "-v", action="store_true", help="Afficher chaque test")
    args = parser.parse_args()
    try:
        backend = find_backend(args.root)
        namespaces = build_namespace(backend)
    except (OSError, SyntaxError, AssertionError, KeyError, TypeError) as exc:
        print(f"[ECHEC PREPARATION] {exc}", file=sys.stderr)
        return 2
    OriaTests.namespace = namespaces
    OriaTests.backend = backend
    print("ORIA Chantier 4 / PREPRODUCTION OFFLINE", flush=True)
    print("Backend examine :", backend, flush=True)
    print("Aucun reseau, aucun fournisseur, aucune transaction et aucun flag modifie.\n", flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(OriaTests)
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2 if args.verbose else 1).run(suite)
    report_environment(backend)
    print("\nBILAN :", result.testsRun, "tests;", len(result.failures), "echecs;", len(result.errors), "erreurs")
    if result.wasSuccessful():
        print("OK POUR POURSUIVRE L'AUDIT STAGING. PAS une autorisation de basculer la production a 1.")
        return 0
    print("ECHEC : corriger les tests avant tout essai payant.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

