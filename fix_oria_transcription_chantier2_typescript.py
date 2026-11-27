#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrige les deux erreurs TypeScript du chantier 2 ORIA Transcription.

1. Sépare le sélecteur quatre cartes (export default) de l'espace de travail.
2. Corrige la clé de brouillon lors de la suppression d'un brouillon.

Le contenu du sélecteur est récupéré depuis le script du chantier 2 déjà appliqué,
ce qui évite de recopier ou de réinventer sa logique.
"""
from __future__ import annotations

import ast
from datetime import datetime
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
PATCHER_PATH = ROOT / "apply_oria_transcription_ui_chantier2.py"
COMPONENT_DIR = ROOT / "Frontend" / "components" / "oria-transcription"
CLIENT_PATH = COMPONENT_DIR / "OriaTranscriptionClient.tsx"
WORKSPACE_PATH = COMPONENT_DIR / "OriaTranscriptionWorkspace.tsx"
ROUTE_PATH = ROOT / "Frontend" / "app" / "transcription" / "page.tsx"


def fail(message: str) -> None:
    raise RuntimeError(message)


def extract_page_content() -> str:
    if not PATCHER_PATH.is_file():
        fail(
            "Script source introuvable : apply_oria_transcription_ui_chantier2.py. "
            "Place ce correctif à la racine du dépôt, à côté du script du chantier 2."
        )
    tree = ast.parse(PATCHER_PATH.read_text(encoding="utf-8"), filename=str(PATCHER_PATH))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "page_content"
            for target in node.targets
        ):
            value = ast.literal_eval(node.value)
            if isinstance(value, str) and "export default function OriaTranscriptionClient()" in value:
                return value
    fail("Impossible de retrouver le composant de sélection des quatre services dans le script du chantier 2.")


def main() -> int:
    for path in (CLIENT_PATH, ROUTE_PATH):
        if not path.is_file():
            fail(f"Fichier attendu introuvable : {path.relative_to(ROOT)}")
    if WORKSPACE_PATH.exists():
        fail(
            "OriaTranscriptionWorkspace.tsx existe déjà. Arrêt sans écrasement ; "
            "vérifie l'état du précédent correctif avant de continuer."
        )

    workspace = CLIENT_PATH.read_text(encoding="utf-8")
    route = ROUTE_PATH.read_text(encoding="utf-8")

    if "export function OriaTranscriptionWorkspace(" not in workspace:
        fail("Le composant actuel ne contient pas l'espace de travail attendu.")
    if 'import OriaTranscriptionClient from "@/components/oria-transcription/OriaTranscriptionClient";' not in route:
        fail("La page /transcription n'utilise pas l'import par défaut attendu.")

    old_key_call = "window.localStorage.removeItem(courseStorageKey(userId));"
    count = workspace.count(old_key_call)
    if count != 1:
        fail(f"Appel de suppression du brouillon attendu une fois, trouvé {count}. Aucun fichier modifié.")
    workspace = workspace.replace(
        old_key_call,
        "window.localStorage.removeItem(courseStorageKey(userId, documentType));",
        1,
    )
    if "courseStorageKey(userId)" in workspace:
        fail("Il reste un appel de courseStorageKey sans type de service.")

    client = extract_page_content()
    old_import = 'import { OriaTranscriptionWorkspace } from "@/components/oria-transcription/OriaTranscriptionClient";'
    new_import = 'import { OriaTranscriptionWorkspace } from "@/components/oria-transcription/OriaTranscriptionWorkspace";'
    if client.count(old_import) != 1:
        fail("Import interne du workspace inattendu dans le composant de sélection.")
    client = client.replace(old_import, new_import, 1)

    if "export default function OriaTranscriptionClient()" not in client:
        fail("Le composant de sélection n'a pas d'export par défaut.")
    if "export function OriaTranscriptionWorkspace(" not in workspace:
        fail("L'export nommé de l'espace de travail a été perdu.")
    if "document_type: documentType" not in workspace or "const SERVICES:" not in client:
        fail("Vérification de cohérence du type de document et des quatre services échouée.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = CLIENT_PATH.with_name(f"OriaTranscriptionClient.tsx.bak-typescript-{stamp}")
    shutil.copy2(CLIENT_PATH, backup)

    WORKSPACE_PATH.write_text(workspace, encoding="utf-8", newline="\n")
    CLIENT_PATH.write_text(client, encoding="utf-8", newline="\n")

    print("OK : erreurs TypeScript du chantier 2 corrigées.")
    print("Fichiers créés :")
    print(" - Frontend/components/oria-transcription/OriaTranscriptionWorkspace.tsx")
    print("Fichier remplacé par le composant de sélection (export default) :")
    print(" - Frontend/components/oria-transcription/OriaTranscriptionClient.tsx")
    print("Correction appliquée : courseStorageKey(userId, documentType) lors de la suppression du brouillon.")
    print("Sauvegarde créée :")
    print(f" - {backup.relative_to(ROOT)}")
    print("La page /transcription et le backend restent inchangés.")
    print("Prochaine vérification : cd Frontend ; npm run build")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
