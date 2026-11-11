"""Correctif incrémental V1 -> V2, limité à 3 fichiers du backend."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys
import shutil

FOLDER = Path(__file__).resolve().parent
REL = Path('Backend/app/services')
MODULE = 'oria_product_knowledge.py'
A = 'openai_service.py'
B = 'openrouter_chat_service.py'

OLD_A = 'oria_product_context_for_message(message, web_enabled=web)'
OLD_B = 'oria_product_context_for_message(message, web_enabled=web)'
NEW = 'oria_product_context_for_message(message, web_enabled=web, history=history)'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', default='.')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    root = Path(args.repo).resolve()
    # Aide pour le répertoire courant ou l'un de ses parents.
    roots = [root, *root.parents]
    root = next((x for x in roots if (x/REL/A).is_file() and (x/REL/B).is_file()), None)
    if root is None:
        print('ERREUR : répertoire Backend/app/services introuvable. Vérifier --repo.', file=sys.stderr)
        return 1

    # Préparer toutes les modifications avant d'écrire quoi que ce soit.
    patches = []
    for filename in (A, B):
        dest = root/REL/filename
        old = dest.read_bytes()
        current = old.decode('utf-8-sig').replace('\r\n','\n')
        if NEW in current:
            patched = current
        elif current.count(OLD_A) == 1 and 'from app.services.oria_product_knowledge import' in current:
            patched = current.replace(OLD_A, NEW)
        else:
            print(f'ERREUR : V1 absente/incompatible dans {dest}; aucune modification.', file=sys.stderr)
            return 1
        if b'\r\n' in old: patched = patched.replace('\n','\r\n')
        newbytes = (b'\xef\xbb\xbf' if old.startswith(b'\xef\xbb\xbf') else b'')+patched.encode('utf-8')
        patches.append((dest, old, newbytes))

    dest_mod = root/REL/MODULE
    if not dest_mod.is_file():
        print('ERREUR : module ORIA V1 absent. Installer d’abord V1.', file=sys.stderr)
        return 1
    old_module = dest_mod.read_bytes()
    # On remplace V1 uniquement (fichier connu ou version déjà installée V2).
    v1_file = FOLDER/'oria_product_knowledge_v1_reference.py'
    v2bytes = (FOLDER/'oria_product_knowledge.py').read_bytes()
    if old_module not in (v1_file.read_bytes(), v2bytes):
        print('ERREUR : connaissance produit modifiée depuis V1; aucune écriture.', file=sys.stderr)
        return 1
    patches.append((dest_mod, old_module, v2bytes))
    for dest, old, new in patches:
        print(('À modifier' if args.dry_run else 'Mis à jour') if old != new else 'Déjà à jour', dest)
    if not args.dry_run:
        backups = FOLDER/'backups_v1'
        backups.mkdir(parents=True, exist_ok=True)
        for dest, old, new in patches:
            if old != new:
                backup = backups/dest.name
                if not backup.exists(): backup.write_bytes(old)
                dest.write_bytes(new)
    print('OK — Correctif V2 prêt. Vérifier et pousser les 3 fichiers backend.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
