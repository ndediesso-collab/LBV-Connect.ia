"""ORIA / Render : lance FastAPI et, sur option, le consommateur Cours.

Pas de worker payant distinct. Ce lanceur est destiné aux essais sur une seule
instance, pas aux traitements longs garantis sur Render Free.

Désactivé par défaut : ORIA_COURSE_SAME_SERVICE_ENABLED=1 et
ORIA_COURSE_CONSUMER_ENABLED=1 sont tous les deux nécessaires.

Ne relance JAMAIS automatiquement un consommateur arrêté : un appel fournisseur
peut avoir commencé. La file PostgreSQL conserve les états pour examen.
"""
from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from typing import Mapping


WEB_MODULE = "app.main:app"
CONSUMER_MODULE = "app.services.course_queue_consumer"


def build_environment(source: Mapping[str, str]) -> tuple[dict[str, str], bool]:
    env = dict(source)
    env["PYTHONUNBUFFERED"] = "1"
    enabled = (
        env.get("ORIA_COURSE_SAME_SERVICE_ENABLED", "0") == "1"
        and env.get("ORIA_COURSE_CONSUMER_ENABLED", "0") == "1"
    )
    if not enabled:
        # Empêche une nouvelle réservation sans consommateur dans CETTE instance.
        env["ORIA_COURSE_DISPATCH_ENABLED"] = "0"
        return env, False

    # Le backend FastAPI lit NEXT_PUBLIC_SUPABASE_URL ; le consommateur, SUPABASE_URL.
    env["SUPABASE_URL"] = env.get("SUPABASE_URL", "").strip() or env.get(
        "NEXT_PUBLIC_SUPABASE_URL", ""
    ).strip()
    missing = []
    if not env["SUPABASE_URL"] or not env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip():
        missing.append("client Supabase serveur incomplet (URL ou service_role)")
    if env.get("ORIA_ENFORCE_PACK_API_BUDGET", "0") != "0":
        missing.append("ORIA_ENFORCE_PACK_API_BUDGET doit valoir 0")
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
        missing.append("FFmpeg/ffprobe manquants")
    if missing:
        # Un défaut de Cours ne doit JAMAIS empêcher le Chat de démarrer.
        # Empêche les nouvelles confirmations tant que le consommateur est indisponible.
        env["ORIA_COURSE_DISPATCH_ENABLED"] = "0"
        log("Consommateur desactive par securite : " + "; ".join(missing))
        return env, False
    return env, True


def log(message: str) -> None:
    print(f"[ORIA START] {message}", flush=True)


def listening_on(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def terminate(proc: subprocess.Popen[bytes] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass


def main() -> int:
    try:
        env, with_consumer = build_environment(os.environ)
        port = int(env.get("PORT", "10000"))
        if not 1 <= port <= 65535:
            raise ValueError("Port invalide")
    except (RuntimeError, ValueError) as exc:
        log(f"Configuration invalide : {exc}")
        return 2

    if "--check" in sys.argv[1:]:
        log("Variables et dépendances de démarrage : OK ; aucune RPC SQL testée.")
        log("Mode : API + Cours" if with_consumer else "Mode : API uniquement")
        return 0

    stopping = False

    def handle_stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        log(f"Signal {signum} recu : arret propre demande.")

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)
    web: subprocess.Popen[bytes] | None = None
    consumer: subprocess.Popen[bytes] | None = None
    try:
        # Un seul worker Uvicorn pour ménager la RAM de l'offre gratuite.
        web = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", WEB_MODULE,
             "--host", "0.0.0.0", "--port", str(port), "--workers", "1"],
            env=env,
            start_new_session=(os.name == "posix"),
        )
        log(f"FastAPI demarre sur PORT={port}.")

        # Render doit d'abord détecter son port HTTP. N'ouvrir la file qu'après.
        deadline = time.monotonic() + 55
        while not stopping and not listening_on(port) and time.monotonic() < deadline:
            if web.poll() is not None:
                log(f"FastAPI termine prematurement (code {web.returncode}).")
                return web.returncode or 1
            time.sleep(0.5)
        if stopping:
            return 0
        if not listening_on(port):
            log("FastAPI n'a pas ouvert son port HTTP dans les 55 secondes.")
            return 1

        if with_consumer:
            consumer = subprocess.Popen(
                [sys.executable, "-u", "-m", CONSUMER_MODULE],
                env=env,
                start_new_session=(os.name == "posix"),
            )
            log("Consommateur ORIA Cours lance (un seul processus).")
        else:
            log("Consommateur inactif ; nouvelles confirmations Cours bloquees.")

        while not stopping:
            if web.poll() is not None:
                log(f"FastAPI arrete (code {web.returncode}) ; arret du consommateur.")
                return web.returncode or 1
            if consumer is not None and consumer.poll() is not None:
                log("ALERTE : consommateur arrete ; aucun redemarrage automatique pour eviter les doubles appels.")
                log("FastAPI reste en service. Desactiver les nouvelles confirmations et inspecter les logs.")
                consumer = None
            time.sleep(1)
        return 0
    finally:
        terminate(consumer)
        terminate(web)
        log("Processus supervises arretes.")


if __name__ == "__main__":
    raise SystemExit(main())
