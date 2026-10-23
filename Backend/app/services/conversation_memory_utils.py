"""Outils de mémoire conversationnelle ORIA.

Sans dépendance externe ni appels IA. Compatible avec la chaîne de requêtes
Supabase/PostgREST existante ; toutes les lectures sont bornées et paginées.
"""

from __future__ import annotations

from typing import Any


HISTORY_PAGE_SIZE = 250  # sous le plafond PostgREST usuel (1 000 lignes)
MAX_STORED_MESSAGES_TO_SCAN = 10000  # garde-fou, pas une politique de rétention


class ConversationHistoryOverflow(RuntimeError):
    """Le scan dépasse le seuil de sécurité : ne surtout pas élaguer."""


def fetch_conversation_rows(
    client: Any,
    *,
    conversation_id: str,
    user_id: str,
    columns: str = "id,role,content,created_at",
    page_size: int = HISTORY_PAGE_SIZE,
    max_rows: int = MAX_STORED_MESSAGES_TO_SCAN,
) -> list[dict[str, Any]]:
    """Lit toutes les lignes autorisées, dans un ordre déterministe.

    Attention : .execute() seul peut renvoyer au maximum 1 000 lignes.
    Un dépassement de max_rows produit une erreur explicite, jamais une
    lecture tronquée qui conduirait à supprimer les mauvaises lignes.
    """
    if not conversation_id or not user_id:
        raise ValueError("Identité de conversation manquante")
    if page_size <= 0 or page_size > 500 or max_rows < page_size:
        raise ValueError("Paramètres de pagination invalides")

    result: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = (
            client.table("messages")
            .select(columns)
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .order("id", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = response.data or []
        result.extend(page)
        if len(page) < page_size:
            return result
        offset += len(page)
        if len(result) >= max_rows:
            # Un dernier appel est nécessaire pour distinguer exactement
            # max_rows lignes d'un dépassement : le seuil reste strict.
            if len(result) > max_rows:
                raise ConversationHistoryOverflow("Historique trop volumineux")
            check = (
                client.table("messages")
                .select("id")
                .eq("conversation_id", conversation_id)
                .eq("user_id", user_id)
                .order("created_at", desc=False)
                .order("id", desc=False)
                .range(offset, offset)
                .execute()
            )
            if check.data:
                raise ConversationHistoryOverflow("Historique trop volumineux")
            return result


def estimate_text_tokens(content: str) -> int:
    """Estimation conservatrice pour *sélectionner*, pas facturer.

    Le nombre exact est retourné par le fournisseur après exécution.
    Unicode, code et contenu multimodal peuvent diverger de cette estimation.
    """
    text = str(content or "")
    if not text:
        return 0
    # L'UTF-8 évite de sous-estimer massivement les textes non latins.
    # L'ASCII/code peut, lui aussi, se tokeniser plus finement que 3 char/token.
    char_based = (len(text) + 1) // 2
    byte_based = (len(text.encode("utf-8")) + 2) // 3
    return max(1, char_based, byte_based) + 12


def pack_history_limit(pack_id: str | None) -> int:
    return {
        "light_pack": 300,
        "intermediate_pack": 500,
        "pro_pack": 1000,
        "business_pack": 2000,
    }.get(pack_id or "", 300)


def safe_prune_ids(
    rows: list[dict[str, Any]],
    *,
    max_messages: int,
    last_processed_message_id: str | None,
) -> list[str]:
    """Retourne seulement les messages *déjà résumés* et excédentaires.

    Si la mémoire manque ou si son curseur a disparu, aucune suppression.
    """
    overflow = len(rows) - max_messages
    if overflow <= 0 or not last_processed_message_id:
        return []
    cursor_index = next(
        (i for i, r in enumerate(rows)
         if str(r.get("id")) == str(last_processed_message_id)),
        None,
    )
    if cursor_index is None:
        return []
    # Conserver le message curseur : l’actualisation suivante doit
    # pouvoir retrouver sa position sans ambiguïté.
    return [
        str(r["id"]) for r in rows[:min(overflow, cursor_index)]
        if r.get("id")
    ]
