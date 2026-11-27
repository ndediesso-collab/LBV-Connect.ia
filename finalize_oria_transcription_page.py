#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Final audit + small UX fixes for the dedicated ORIA Transcription page.

Run from the repository root. Does not write to GitHub or change backend,
Supabase, billing, Render settings, or secrets. Only makes two narrow frontend
fixes when their exact old anchors are present:
  - removes the obsolete claim that long audio import is still upcoming;
  - clears the transfer busy state on two early-return TUS paths.
It then verifies the local /transcription page, four profiles, workspace/backend
contracts, TUS component, and Chat redirect before reporting success.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "Frontend"
CLIENT = FRONTEND / "components" / "oria-transcription" / "OriaTranscriptionClient.tsx"
WORKSPACE = FRONTEND / "components" / "oria-transcription" / "OriaTranscriptionWorkspace.tsx"
LONG_IMPORT = FRONTEND / "components" / "oria-transcription" / "OriaLongAudioImport.tsx"
PAGE = FRONTEND / "app" / "transcription" / "page.tsx"
CHAT = FRONTEND / "app" / "chat" / "page.tsx"

OLD_NOTE = "Enregistrement direct disponible. L’import d’un fichier unique de longue durée sera ajouté dans le chantier d’import audio."
NEW_NOTE = "Choisissez un service pour accéder à l’enregistrement au microphone et à l’import audio. L’import d’un fichier long dépend de l’activation du service côté serveur."
OLD_NOTE_EN = "Direct recording is available. Single long-file import will be added in the audio-import phase."
NEW_NOTE_EN = "Choose a service to access microphone recording and audio upload. Long-file import depends on server-side feature activation."

EARLY_RETURN_1_OLD = '''      if (created.audio_import.status !== "uploading") {
        setNotice(tr("Cet import est déjà en cours de préparation.", "This import is already being prepared."));
        return;
      }'''
EARLY_RETURN_1_NEW = '''      if (created.audio_import.status !== "uploading") {
        setNotice(tr("Cet import est déjà en cours de préparation.", "This import is already being prepared."));
        setTransferring(false);
        return;
      }'''
EARLY_RETURN_2_OLD = '''        try {
          await finalizeImport(importId);
          return;
        } catch {'''
EARLY_RETURN_2_NEW = '''        try {
          await finalizeImport(importId);
          setTransferring(false);
          return;
        } catch {'''


def fail(message: str) -> None:
    raise RuntimeError(message)


def replace_or_already(source: str, old: str, new: str, label: str) -> tuple[str, bool]:
    if new in source:
        return source, False
    count = source.count(old)
    if count != 1:
        fail(f"Ancre '{label}' attendue une fois, trouvée {count}. Aucun fichier modifié.")
    return source.replace(old, new, 1), True


def require_file(path: Path) -> str:
    if not path.is_file():
        fail(f"Fichier requis introuvable : {path.relative_to(ROOT).as_posix()}")
    return path.read_text(encoding="utf-8")


def main() -> int:
    contents = {
        CLIENT: require_file(CLIENT),
        WORKSPACE: require_file(WORKSPACE),
        LONG_IMPORT: require_file(LONG_IMPORT),
        PAGE: require_file(PAGE),
        CHAT: require_file(CHAT),
    }
    changed: dict[Path, str] = {}

    # Correct the obsolete selector note, only if this exact older copy remains.
    client = contents[CLIENT]
    note_changed = False
    if OLD_NOTE in client:
        client = client.replace(OLD_NOTE, NEW_NOTE, 1)
        note_changed = True
    elif NEW_NOTE not in client and OLD_NOTE_EN in client:
        client = client.replace(OLD_NOTE_EN, NEW_NOTE_EN, 1)
        note_changed = True
    if note_changed:
        changed[CLIENT] = client

    # Make sure a TUS early-return cannot leave the parent workspace blocked.
    long_import = contents[LONG_IMPORT]
    long_import, changed_early_1 = replace_or_already(
        long_import, EARLY_RETURN_1_OLD, EARLY_RETURN_1_NEW,
        "état de transfert lorsque l'import existe déjà",
    )
    long_import, changed_early_2 = replace_or_already(
        long_import, EARLY_RETURN_2_OLD, EARLY_RETURN_2_NEW,
        "état de transfert lorsque le fichier est déjà téléversé",
    )
    if changed_early_1 or changed_early_2:
        changed[LONG_IMPORT] = long_import

    # Verify route and entrypoint.
    page = contents[PAGE]
    if "OriaTranscriptionClient" not in page or "@/components/oria-transcription/OriaTranscriptionClient" not in page:
        fail("/transcription/page.tsx ne pointe pas vers OriaTranscriptionClient.")

    # Verify the selector contains the four document profiles.
    client_check = changed.get(CLIENT, contents[CLIENT])
    for profile in ('id: "course"', 'id: "meeting"', 'id: "speech"', 'id: "interview"'):
        if profile not in client_check:
            fail(f"Le sélecteur /transcription ne contient pas le profil attendu : {profile}")

    # Verify profile selection reaches the shared API workflow.
    workspace = contents[WORKSPACE]
    workspace_requirements = (
        'document_type: documentType',
        '"/courses/capabilities"',
        'from "./OriaLongAudioImport"',
        'enabled={capabilities?.long_audio_import_enabled === true}',
        '/quote', '/confirm',
    )
    for marker in workspace_requirements:
        if marker not in workspace:
            fail(f"Contrat manquant dans OriaTranscriptionWorkspace.tsx : {marker}")

    # Verify TUS contract and backend route shapes used by the frontend.
    long_check = changed.get(LONG_IMPORT, contents[LONG_IMPORT])
    import_requirements = (
        'tus.Upload',
        '/audio-imports/latest',
        '/audio-imports/',
        '/complete',
        '/retry',
        'storeFingerprintForResuming: true',
        'chunkSize: created.chunk_size_bytes',
        'onProgress:',
    )
    for marker in import_requirements:
        if marker not in long_check:
            fail(f"Contrat d'import long manquant dans OriaLongAudioImport.tsx : {marker}")

    # Verify Chat no longer embeds the obsolete Cours form.
    chat = contents[CHAT]
    if "OriaCoursesPanel" in chat:
        fail("L'ancien panneau ORIA Cours est encore référencé dans /chat.")
    if 'window.location.assign("/transcription")' not in chat and 'href="/transcription"' not in chat:
        fail("Le raccourci Chat ne redirige pas vers /transcription.")

    # Write only the exact files that needed a narrow correction.
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backups: list[Path] = []
    for path, new_text in changed.items():
        backup = path.with_name(path.name + f".bak-oria-transcription-page-{stamp}")
        backup.write_text(contents[path], encoding="utf-8", newline="\n")
        backups.append(backup)
        path.write_text(new_text, encoding="utf-8", newline="\n")

    # Post-write checks from disk.
    if 'setTransferring(false);\n        return;' not in LONG_IMPORT.read_text(encoding="utf-8"):
        fail("Contrôle post-écriture du premier retour anticipé TUS échoué.")
    if 'await finalizeImport(importId);\n          setTransferring(false);\n          return;' not in LONG_IMPORT.read_text(encoding="utf-8"):
        fail("Contrôle post-écriture du second retour anticipé TUS échoué.")

    print("OK : page ORIA Transcription auditée et harmonisée.")
    print("Éléments vérifiés :")
    print(" - Route Next.js /transcription -> OriaTranscriptionClient")
    print(" - Sélecteur des 4 profils : Cours, Réunion, Discours, Interview")
    print(" - document_type transmis au backend")
    print(" - Workspace commun avec micro, devis, confirmation et Artifact partagé")
    print(" - Import TUS, reprise, progression, finalisation et retry")
    print(" - Raccourci Chat -> /transcription ; ancien panneau Cours absent")
    print("Corrections appliquées :")
    print(" - Note du sélecteur mise à jour" if CLIENT in changed else " - Note du sélecteur déjà à jour")
    print(" - États de transfert TUS réparés" if LONG_IMPORT in changed else " - États de transfert TUS déjà réparés")
    if backups:
        print("Sauvegardes :")
        for path in backups:
            print(" - " + path.relative_to(ROOT).as_posix())
    print("Aucun changement backend, Supabase, facturation, Render ou GitHub.")
    print("Étape suivante : lancer npm run build depuis Frontend.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
