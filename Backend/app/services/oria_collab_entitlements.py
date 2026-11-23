"""ORIA Collaboratif — Phase 1.

Lecture de droits à partir du pack réel, sans toucher aux crédits existants.
Les collaborateurs ont des identités Supabase Auth séparées ; leur pack
professionnel reste celui du propriétaire de l'espace.
"""
from dataclasses import dataclass
from typing import Any


PACK_SEAT_LIMITS: dict[str, int] = {
    "pro_pack": 3,
    "business_pack": 6,
}


@dataclass(frozen=True)
class CollaboratifEntitlement:
    pack_id: str | None
    pack_active: bool
    eligible: bool
    seat_limit: int


def entitlement_for_wallet(wallet: Any | None) -> CollaboratifEntitlement:
    """Le crédit restant n'est PAS une condition d'accès à la messagerie.

    La propriété `is_pack_active` est fournie par l'actuel CreditWallet ;
    ainsi, changement/expiration de pack révoquent l'accès sans effacer les données.
    """
    pack_id = str(getattr(wallet, "pack_id", "") or "") or None
    pack_active = bool(getattr(wallet, "is_pack_active", False)) if wallet is not None else False
    seats = PACK_SEAT_LIMITS.get(pack_id or "", 0) if pack_active else 0
    return CollaboratifEntitlement(
        pack_id=pack_id,
        pack_active=pack_active,
        eligible=seats > 0,
        seat_limit=seats,
    )
