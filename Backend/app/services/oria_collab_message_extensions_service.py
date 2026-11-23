"""ORIA 5C: group message extension. Signed Pulse -> single SQL grant.

Only the existing Chariow webhook can call confirm_signed_payment. Never trust
redirect, a browser-supplied paid status, message quantity or price.
"""
from __future__ import annotations

import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.oria_collab_profiles_service import CollabProfilesService

PRODUCT_CODE = 'oria_collab_messages_5000'
DEFAULT_PRODUCT_ID = 'prd_2m8g8pce'
PRICE_XAF = 3000
MESSAGES_PER_PURCHASE = 5000
EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")
PRODUCT = re.compile(r'^prd_[A-Za-z0-9_-]+$')


def enabled() -> bool:
    return (os.getenv('ORIA_COLLABORATIF_ENABLED', '0') == '1'
            and os.getenv('ORIA_COLLAB_GROUPS_ENABLED', '0') == '1'
            and os.getenv('ORIA_COLLAB_MESSAGE_EXTENSIONS_ENABLED', '0') == '1')


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(503, 'Les extensions de messages ne sont pas encore activées.')


def expected_chariow_product_id() -> str:
    val = os.getenv('CHARIOW_GROUP_MESSAGES_PRODUCT_ID', DEFAULT_PRODUCT_ID).strip()
    if not PRODUCT.fullmatch(val):
        raise HTTPException(503, 'Identifiant Chariow de messages non configuré.')
    return val


def billing_email(value: str) -> str:
    clean = str(value or '').strip()
    if len(clean) > 254 or '..' in clean or not EMAIL.fullmatch(clean):
        raise HTTPException(422, 'Adresse e-mail du reçu Chariow invalide.')
    return clean


def _rpc(db: Any, name: str, params: dict) -> dict:
    try:
        response = db.rpc(name, params).execute()
        result = getattr(response, 'data', None)
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict) or result.get('success') is not True:
            raise ValueError('invalid_rpc_payload')
        return result
    except Exception as exc:
        detail = str(exc).lower()
        for token, code, message in (
            ('collab_group_not_found',404,'Salon inexistant.'),
            ('collab_group_admin_only',403,'Action réservée à l’administrateur.'),
            ('collab_group_archived',409,'Réouvrez le salon avant de commander.'),
            ('collab_group_extension_capacity_limit',409,'Plafond de messages atteint.'),
            ('collab_group_pack_inactive',403,'Pack Pro ou Business actif nécessaire.'),
            ('collab_group_extension_bad_payment_state',409,'Paiement non admissible.'),
            ('collab_group_extension_receipt_mismatch',409,'Commande et paiement incohérents.'),
        ):
            if token in detail:
                raise HTTPException(code, message) from exc
        raise HTTPException(503, 'Extension de messages indisponible, rapprochement requis.') from exc


def create_checkout(db: Any, *, actor_id: str, group_id: UUID,
                    email: str) -> dict:
    """Persists an immutable order before contacting the EXISTING checkout API."""
    require_enabled()
    email = billing_email(email)
    expected_chariow_product_id()  # refuser une configuration vide avant l'écriture SQL
    ctx = CollabProfilesService(db)._context(actor_id, owner_required=True)
    if not ctx.get('is_owner'):
        raise HTTPException(403, 'Seul l’administrateur peut acheter des messages.')
    from app.services.payment_service import create_chariow_checkout, generate_payment_reference
    ref = str(generate_payment_reference())
    if not re.fullmatch(r'[A-Za-z0-9_-]{12,130}', ref):
        raise HTTPException(503, 'Référence de paiement invalide.')
    # DB owns target group/price/count and validates it in a locked transaction.
    prepared = _rpc(db, 'oria_collab_group_message_extension_start', {
        'p_actor_user_id': actor_id, 'p_group_id': str(group_id), 'p_reference': ref,
    })
    # Route isolée mais MEME fonction Chariow et MEME Pulse que les packs ORIA.
    checkout = create_chariow_checkout(product_id=PRODUCT_CODE, reference_id=ref,
                                       email=email)
    url = checkout.get('checkout_url') if isinstance(checkout, dict) else None
    if not isinstance(url, str) or not url.startswith('https://'):
        # DB order stays pending. No messages are credited, even on provider errors.
        raise HTTPException(502, 'Checkout Chariow indisponible, aucun message attribué.')
    return {
        'success': True, 'reference': ref, 'checkout_url': url,
        'group_id': str(group_id), 'amount_xaf': PRICE_XAF,
        'messages': MESSAGES_PER_PURCHASE, 'payment_status': 'pending',
    }


def purchase_status(db: Any, *, actor_id: str, group_id: UUID) -> dict:
    require_enabled()
    CollabProfilesService(db)._context(actor_id, owner_required=True)
    return _rpc(db, 'oria_collab_group_message_extension_status', {
        'p_actor_user_id': actor_id, 'p_group_id': str(group_id),
    })


def is_group_message_payment(payment: dict) -> bool:
    metadata = payment.get('metadata') or {}
    return isinstance(metadata, dict) and (
        metadata.get('oria_collab_target') == 'group_messages'
        or payment.get('addon_id') == PRODUCT_CODE
    )


def _extract_amount_xaf(event: dict) -> Decimal:
    amount = event.get('amount')
    if isinstance(amount, dict):
        if str(amount.get('currency', '')).upper() != 'XAF':
            raise HTTPException(409, 'Devise Chariow incorrecte.')
        amount = amount.get('value')
    else:
        # L'ancienne normalisation perd parfois la devise. La rechercher dans
        # la charge brute AUTHENTIFIÉE, sans déduire XAF du prix attendu.
        raw = event.get('raw_payload') or {}
        sale = raw.get('sale') if isinstance(raw, dict) else None
        signed_currency = (event.get('currency') or
            (sale.get('currency') if isinstance(sale, dict) else None) or
            (raw.get('currency') if isinstance(raw, dict) else None))
        if str(signed_currency or '').upper() != 'XAF':
            raise HTTPException(409, 'Devise Chariow non vérifiable.')
    try:
        number = Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(409, 'Montant du paiement invalide.') from None
    if not number.is_finite() or number != Decimal(PRICE_XAF):
        raise HTTPException(409, 'Montant Chariow incorrect.')
    return number


def validate_signed_sale(event: dict, payment: dict) -> str:
    """Only called after original webhook HMAC verification and sale success."""
    metadata = payment.get('metadata') or {}
    try:
        quantity = int(payment.get('credits') or 0)
        amount = Decimal(str(payment.get('amount')))
    except (TypeError, ValueError, InvalidOperation):
        raise HTTPException(409, 'Montant ou quantité de la commande invalide.') from None
    if (not isinstance(metadata, dict)
        or metadata.get('oria_collab_target') != 'group_messages'
        or payment.get('payment_type') != 'addon'
        or payment.get('addon_id') != PRODUCT_CODE
        or not metadata.get('oria_collab_group_id')
        or str(payment.get('user_id') or '') != str(metadata.get('lbv_user_id') or '')
        or str(payment.get('reference') or '') != str(metadata.get('lbv_reference_id') or '')
        or amount != Decimal(PRICE_XAF)
        or quantity != MESSAGES_PER_PURCHASE
        or str(payment.get('currency') or '').upper() != 'XAF'):
        raise HTTPException(409, 'Commande extension incohérente.')
    if str(event.get('reference') or '') != str(payment.get('reference') or ''):
        raise HTTPException(409, 'Référence Chariow différente.')
    product = str(event.get('product_id') or '')
    if product not in {PRODUCT_CODE, expected_chariow_product_id()}:
        raise HTTPException(409, 'Produit Chariow incorrect.')
    _extract_amount_xaf(event)
    sale_id = str(event.get('provider_transaction_id') or event.get('order_id') or '').strip()
    if not sale_id or len(sale_id) > 250:
        raise HTTPException(409, 'Identifiant de vente Chariow manquant.')
    return sale_id


def confirm_signed_payment(db: Any, *, event: dict, payment: dict,
                           delivery_id: str, success: bool) -> dict:
    """Do not use any other webhook, or the legacy addon credit finalizer."""
    if not success:
        # Failed/abandoned notifications may lack a verified amount. Keep pending;
        # late successful.sales remain processable. Never grant from a redirect.
        return {'success':True,'processed':False,'status':'pending',
                'reference_id':str(payment.get('reference') or '')}
    sale_id = validate_signed_sale(event, payment)
    result = _rpc(db, 'oria_collab_group_message_extension_confirm', {
        'p_reference': str(payment['reference']),
        'p_provider_sale_id': sale_id,
        'p_pulse_delivery_id': delivery_id,
    })
    return {'success':True, 'processed':bool(result.get('processed')),
            'reference_id':str(payment['reference']),
            'group_id':result['group_id'],
            'messages_added':int(result.get('messages_added') or 0),
            'wallet_type':'group_message_capacity'}
