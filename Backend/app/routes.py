from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config.credit_costs import CreditAction
from app.core.supabase import supabase
from app.models.credit_transaction import (
    CreditTransaction,
    CreditTransactionType,
)
from app.repositories.supabase_credit_repository import (
    SupabaseCreditRepository,
)
from app.services.credit_service import (
    CreditService,
    InactivePackError,
    InsufficientCreditsError,
)
from app.services.wallet_service import WalletService


router = APIRouter()


class CreditConsumptionRequest(BaseModel):
    action: CreditAction
    confirmed: bool = False


def _wallet_response(wallet):
    return {
        "user_id": wallet.user_id,
        "pack_id": wallet.pack_id,
        "balance": wallet.balance,
        "initial_credits": wallet.initial_credits,
        "consumed_credits": wallet.consumed_credits,
        "consumed_percentage": wallet.consumed_percentage,
        "remaining_percentage": wallet.remaining_percentage,
        "pack_activated_at": wallet.pack_activated_at,
        "pack_expires_at": wallet.pack_expires_at,
        "is_pack_active": wallet.is_pack_active,
        "created_at": wallet.created_at,
        "updated_at": wallet.updated_at,
    }


# ============================================================
# PACK LÉGER
# ============================================================

@router.post("/credits/test/light-wallet/{user_id}")
def create_light_wallet_test(user_id: str):
    try:
        repository = SupabaseCreditRepository(supabase)
        wallet_service = WalletService(repository)

        wallet = wallet_service.create_light_wallet(user_id)

        return {
            "success": True,
            "message": "Pack Léger attribué avec succès.",
            "wallet": _wallet_response(wallet),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK INTERMÉDIAIRE
# ============================================================

@router.post(
    "/credits/test/intermediate-wallet/{user_id}"
)
def create_intermediate_wallet_test(user_id: str):
    try:
        repository = SupabaseCreditRepository(supabase)
        wallet_service = WalletService(repository)

        wallet = wallet_service.create_intermediate_wallet(
            user_id
        )

        return {
            "success": True,
            "message": (
                "Pack Intermédiaire attribué avec succès."
            ),
            "wallet": _wallet_response(wallet),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK PRO
# ============================================================

@router.post("/credits/test/pro-wallet/{user_id}")
def create_pro_wallet_test(user_id: str):
    try:
        repository = SupabaseCreditRepository(supabase)
        wallet_service = WalletService(repository)

        wallet = wallet_service.create_pro_wallet(
            user_id
        )

        return {
            "success": True,
            "message": "Pack Pro attribué avec succès.",
            "wallet": _wallet_response(wallet),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# PACK BUSINESS
# ============================================================

@router.post(
    "/credits/test/business-wallet/{user_id}"
)
def create_business_wallet_test(user_id: str):
    try:
        repository = SupabaseCreditRepository(supabase)
        wallet_service = WalletService(repository)

        wallet = wallet_service.create_business_wallet(
            user_id
        )

        return {
            "success": True,
            "message": (
                "Pack Business attribué avec succès."
            ),
            "wallet": _wallet_response(wallet),
        }

    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# CONSOMMATION DE CRÉDITS
# ============================================================

@router.post("/credits/{user_id}/consume")
def consume_credits(
    user_id: str,
    request: CreditConsumptionRequest,
):
    try:
        repository = SupabaseCreditRepository(supabase)

        wallet = repository.get_wallet(user_id)

        if wallet is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Aucun portefeuille de crédits trouvé."
                ),
            )

        service = CreditService()

        result = service.consume(
            wallet=wallet,
            action=request.action,
            confirmed=request.confirmed,
        )

        repository.update_wallet(wallet)

        transaction = CreditTransaction(
            id=str(uuid4()),
            user_id=user_id,
            transaction_type=(
                CreditTransactionType.USAGE
            ),
            amount=-result.cost,
            balance_after=result.new_balance,
            created_at=wallet.updated_at,
            action=request.action,
            reference_id=None,
        )

        repository.create_transaction(transaction)

        return {
            "success": True,
            "pack_id": wallet.pack_id,
            "action": result.action.value,
            "cost": result.cost,
            "previous_balance": (
                result.previous_balance
            ),
            "new_balance": result.new_balance,
            "consumed_credits": (
                result.consumed_credits
            ),
            "consumed_percentage": (
                result.consumed_percentage
            ),
            "remaining_percentage": (
                result.remaining_percentage
            ),
            "requires_warning": (
                result.requires_warning
            ),
            "requires_critical_warning": (
                result.requires_critical_warning
            ),
            "requires_confirmation": (
                result.requires_confirmation
            ),
        }

    except InactivePackError as error:
        raise HTTPException(
            status_code=403,
            detail=str(error),
        )

    except InsufficientCreditsError as error:
        raise HTTPException(
            status_code=402,
            detail=str(error),
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    