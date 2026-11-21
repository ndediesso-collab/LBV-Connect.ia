#!/usr/bin/env python3
"""Corrige deux erreurs TypeScript apres ORIA V3 streaming gratuit.

Ce correctif ne touche ni aux packs ni aux crédits ni au backend.
Exécution depuis la racine du dépôt avec Python (option --dry-run)
puis le même programme sans cette option.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import tempfile

FILE = Path('Frontend/app/chat/page.tsx')
REPLACEMENTS = [
    (
        '? [...current, {id: pendingAssistantId, conversationId, role: "assistant", content: "", createdAt: new Date().toISOString()}]',
        '? [...current, {id: pendingAssistantId, conversationId: userMessage.conversationId, role: "assistant", content: "", createdAt: new Date().toISOString()}]',
    ),
    (
        'finalResult = data as typeof finalResult;',
        '''finalResult = {
                success: data.success === true,
                message: typeof data.message === "string" ? data.message : "",
                server_persisted: data.server_persisted === true,
                assistant_message_id: typeof data.assistant_message_id === "string"
                  ? data.assistant_message_id : undefined,
                requires_reconciliation: data.requires_reconciliation === true,
              };''',
    ),
]


def apply(source: str) -> tuple[str, int]:
    changed = 0
    for old, new in REPLACEMENTS:
        old_count = source.count(old)
        new_count = source.count(new)
        if old_count == 1 and new_count == 0:
            source = source.replace(old, new, 1)
            changed += 1
        elif old_count == 0 and new_count == 1:
            print('Déjà corrigé :', old[:60])
        else:
            raise ValueError(
                'Bloc source absent ou ambigu; fichier non modifié : ' + repr(old[:90])
                + f' (ancien={old_count}, corrigé={new_count})'
            )
    return source, changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not FILE.is_file():
        print(f'ERREUR : {FILE} introuvable. Place-toi à la racine du dépôt ORIA.', file=sys.stderr)
        return 1
    source = FILE.read_bytes().decode('utf-8-sig')
    try:
        result, count = apply(source)
    except ValueError as exc:
        print('ERREUR :', exc, file=sys.stderr)
        return 1
    print(f'ORA V3 : {count} modification(s) TypeScript à appliquer.')
    if args.dry_run:
        print('Contrôle terminé : aucun fichier modifié.')
        return 0
    if count == 0:
        print('Les deux corrections sont déjà présentes.')
        return 0
    raw = result.encode('utf-8')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.oria_types_', suffix='.tmp',
                                         dir=FILE.parent, delete=False) as temp:
            temporary = Path(temp.name)
            temp.write(raw)
        os.replace(temporary, FILE)
        print('Corrigé :', FILE)
        return 0
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    sys.exit(main())
