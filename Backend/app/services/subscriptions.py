from datetime import datetime, timedelta

from app.config.packs import PACKS
from app.models.wallet import Wallet


def create_wallet(
    user_id: str,
    pack_id: str,
) -> Wallet:

    pack = PACKS.get(pack_id)

    if pack is None:
        raise ValueError("Pack introuvable.")

    expires_at = datetime.utcnow() + timedelta(
        days=pack.duration_days
    )

    return Wallet(
        user_id=user_id,
        pack_id=pack.id,
        balance=pack.credits,
        reserved=0,
        expires_at=expires_at,
    )