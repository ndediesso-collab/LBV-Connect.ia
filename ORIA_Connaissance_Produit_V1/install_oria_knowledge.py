"""Correctif ciblé ORIA : contexte de connaissances produit dans le Chat.

Ne touche ni aux tarifs, ni à Supabase, ni au frontend, ni à la facturation.
Le message produit est injecté au rôle `developer` par OpenAI et OpenRouter,
en plus de l'identité ORIA déjà transmise via build_output_prompt().
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

SOURCE = Path(__file__).parent / "oria_product_knowledge.py"
REL_MODULE = Path("Backend/app/services/oria_product_knowledge.py")
REL_OPENAI = Path("Backend/app/services/openai_service.py")
REL_OPENROUTER = Path("Backend/app/services/openrouter_chat_service.py")
IMPORT = "from app.services.oria_product_knowledge import oria_product_context_for_message"

# Remplacements exacts, contrôlés et idempotents. Toute divergence entraîne un arrêt.
OPENAI_NEEDLE = "        input_data: list[dict[str, Any]] = []\n        document_types = self._document_types(artifact_types)"
OPENAI_REPLACE = """        input_data: list[dict[str, Any]] = []
        # ORIA KNOWLEDGE V1 : seules les demandes portant sur ORIA reçoivent
        # un référentiel produit, à autorité supérieure aux textes externes.
        from app.services.oria_product_knowledge import oria_product_context_for_message
        product_context = oria_product_context_for_message(message, web_enabled=web)
        if product_context:
            input_data.append({"role": "developer", "content": product_context})
        document_types = self._document_types(artifact_types)"""

OPENROUTER_NEEDLE = "        msgs: list[dict[str, Any]] = []\n        if artifact_types:"
OPENROUTER_REPLACE = """        msgs: list[dict[str, Any]] = []
        # ORIA KNOWLEDGE V1 : même référentiel produit que le fournisseur OpenAI.
        from app.services.oria_product_knowledge import oria_product_context_for_message
        product_context = oria_product_context_for_message(message, web_enabled=web)
        if product_context:
            msgs.append({"role": "developer", "content": product_context})
        if artifact_types:"""


def find_repo(path: Path) -> Path:
    path = path.resolve()
    candidates = [path, *path.parents]
    for root in candidates:
        if (root / REL_OPENAI).is_file() and (root / REL_OPENROUTER).is_file():
            return root
    raise RuntimeError(
        "Dépôt ORIA introuvable. Lance la commande depuis le répertoire "
        "qui contient Backend et Frontend, ou passe --repo CHEMIN."
    )


def apply_patch(path: Path, old: str, new: str, *, dry_run: bool) -> bool:
    raw = path.read_bytes()
    utf8_bom = raw.startswith(b"\xef\xbb\xbf")
    original = raw.decode("utf-8-sig")
    is_crlf = b"\r\n" in raw
    normalized = original.replace("\r\n", "\n")
    if new in normalized:
        print(f"Déjà intégré : {path}")
        return False
    if normalized.count(old) != 1:
        raise RuntimeError(f"Version non reconnue dans {path}. Aucune modification ne sera faite.")
    # Écriture préparée (vérification finale sans changer la base ni les autres fonctionnalités).
    if not dry_run:
        backup = Path(__file__).parent / "backups" / path.name
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(path, backup)
        updated = normalized.replace(old, new)
        if is_crlf:
            updated = updated.replace("\n", "\r\n")
        path.write_bytes((b"\xef\xbb\xbf" if utf8_bom else b"") + updated.encode("utf-8"))
    print(f"{'À modifier' if dry_run else 'Mis à jour'} : {path}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Installer les connaissances produit ORIA")
    parser.add_argument("--repo", default=".", help="Racine du dépôt (Backend et Frontend)")
    parser.add_argument("--dry-run", action="store_true", help="Vérifier sans écrire")
    args = parser.parse_args()
    try:
        root = find_repo(Path(args.repo))
        openai = root / REL_OPENAI
        openrouter = root / REL_OPENROUTER
        # Valider les deux cibles AVANT toute écriture.
        for target, old, new in (
            (openai, OPENAI_NEEDLE, OPENAI_REPLACE),
            (openrouter, OPENROUTER_NEEDLE, OPENROUTER_REPLACE),
        ):
            current = target.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
            if new not in current and current.count(old) != 1:
                raise RuntimeError(f"Incompatibilité avec {target}. Rien n'a été modifié.")
        module = root / REL_MODULE
        expected = SOURCE.read_bytes()
        if module.exists() and module.read_bytes() != expected:
            raise RuntimeError(f"{module} existe avec un contenu différent : pas de remplacement automatique.")
        if not args.dry_run:
            module.parent.mkdir(parents=True, exist_ok=True)
            if not module.exists():
                shutil.copy2(SOURCE, module)
        print(f"{'À copier' if args.dry_run else 'Présent'} : {module}")
        # Appliquer les deux modules fournisseur : aucune modification des routes/credits.
        apply_patch(openai, OPENAI_NEEDLE, OPENAI_REPLACE, dry_run=args.dry_run)
        apply_patch(openrouter, OPENROUTER_NEEDLE, OPENROUTER_REPLACE, dry_run=args.dry_run)
        print("OK. Vérifier avec les tests locaux, puis pousser les trois fichiers vers GitHub.")
        return 0
    except (OSError, RuntimeError) as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
