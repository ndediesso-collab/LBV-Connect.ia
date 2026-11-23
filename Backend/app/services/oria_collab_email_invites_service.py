"""6B2A: invitations email, anti-spoofing et persistence du lien de membre.

RPC backend uniquement. Le token n'est pas journalise ni renvoye au navigateur.
Les nouveaux membres restent mono-espace jusqu'a la migration contextuelle 6B2B.
"""
from __future__ import annotations

import hashlib
import html
import os
import re
import secrets
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import requests
from fastapi import HTTPException

EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
TOKEN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
AVATARS = {"ink", "stone", "paper", "slate", "silver", "carbon"}


def email_enabled() -> bool:
    return os.getenv("ORIA_COLLAB_EMAIL_INVITES_ENABLED", "0").strip() == "1" and os.getenv("ORIA_COLLAB_SHARE_INVITES_ENABLED", "0").strip() != "1"


def require_email_feature() -> None:
    if not email_enabled():
        raise HTTPException(503, "Invitations e-mail ORIA Collaboratif inactives.")


def uuid_str(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "Identifiant invalide.") from exc


def normalized_email(value: str) -> str:
    result = str(value or "").strip().lower()
    if len(result) not in range(5, 255) or not EMAIL.fullmatch(result) or "\x00" in result:
        raise HTTPException(422, "Adresse e-mail invalide.")
    return result


def valid_token(value: str) -> str:
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise HTTPException(422, "Lien d'invitation invalide.")
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def validated_profile(first: str, last: str, avatar: str, consent: bool) -> tuple[str, str, str]:
    one, two = (str(first or "").strip(), str(last or "").strip())
    if not consent:
        raise HTTPException(422, "L'accord de supervision professionnelle est requis.")
    if not all(1 <= len(x) <= 60 and not any(ord(c) < 32 for c in x) for x in (one, two)):
        raise HTTPException(422, "Prénom et nom invalides.")
    if avatar not in AVATARS:
        raise HTTPException(422, "Avatar invalide.")
    return one, two, avatar


def _config() -> tuple[str, str, str]:
    key = (os.getenv("ORIA_COLLAB_BREVO_API_KEY") or "").strip()
    raw_sender = (os.getenv("ORIA_COLLAB_EMAIL_FROM") or "").strip()
    if not key or not raw_sender:
        raise HTTPException(503, "Configuration d’envoi d’e-mail incomplète.")
    sender = normalized_email(raw_sender)
    origin = (os.getenv("ORIA_COLLAB_PUBLIC_URL") or "").strip().rstrip("/")
    parts = urlsplit(origin)
    if not key or len(key) > 1000 or not origin or parts.scheme != "https" or not parts.hostname \
       or parts.username or parts.password or parts.path not in ("", "/") or parts.query or parts.fragment:
        raise HTTPException(503, "Configuration d'envoi d'e-mail incomplète.")
    return key, sender, origin


def _rpc(db: Any, name: str, arguments: dict[str, Any]) -> dict:
    try:
        data = getattr(db.rpc(name, arguments).execute(), "data", None)
        if isinstance(data, list) and len(data) == 1:
            data = data[0]
        if not isinstance(data, dict) or data.get("success") is not True:
            raise RuntimeError("collab_email_rpc_invalid")
        return data
    except HTTPException:
        raise
    except Exception as exc:
        cause = str(exc).lower()
        rules = (
            ("collab_email_owner_only", 403, "Action réservée au propriétaire de cet espace."),
            ("collab_email_pack_not_eligible", 403, "Pack Pro ou Business actif requis."),
            ("collab_email_seat_limit", 409, "Toutes les places de cette équipe sont occupées ou réservées."),
            ("collab_email_resend_too_soon", 429, "Veuillez attendre une minute avant de renvoyer un lien."),
            ("collab_email_resend_limit", 429, "Limite de renvois atteinte : révoquez puis recréez l'invitation."),
            ("collab_email_not_verified", 403, "Connectez-vous avec l'adresse invitée et confirmez votre e-mail."),
            ("collab_email_already_member", 409, "Ce compte appartient déjà à cet espace."),
            ("collab_email_multi_cutover_pending", 409, "Ce compte appartient déjà à une équipe. L'accès multi-espaces sera activé après la migration de sécurité."),
            ("collab_email_invitation_invalid", 404, "Invitation introuvable."),
            ("collab_email_invitation_unavailable", 410, "Ce lien est expiré, révoqué ou remplacé. Demandez un nouvel envoi."),
            ("collab_email_member_inactive", 403, "Votre profil d'équipe n'est plus actif."),
            ("collab_email_accept_invalid", 422, "Profil professionnel incomplet."),
            ("collab_email_invite_invalid", 422, "Invitation invalide."),
        )
        for code, status, message in rules:
            if code in cause:
                raise HTTPException(status, message) from exc
        raise HTTPException(503, "Service d'invitations momentanément indisponible.") from exc


def _send_via_brevo(key: str, sender: str, origin: str, recipient: str,
                    token: str, workspace_name: str) -> None:
    # Secret placé dans le fragment : absent des logs HTTP des serveurs web.
    url = origin + "/collaboratif/rejoindre-email#invitation=" + token
    label = html.escape(workspace_name, quote=True)
    anchor = html.escape(url, quote=True)
    body = (
        '<div style="font-family:Arial,sans-serif;max-width:620px">'
        '<h2>Invitation ORIA Collaboratif</h2>'
        f'<p>Vous avez été invité à rejoindre <strong>{label}</strong>.</p>'
        f'<p><a href="{anchor}">Rejoindre mon espace professionnel</a></p>'
        '<p>Si vous n’avez pas de compte ORIA, vous pourrez le créer gratuitement. '
        'Votre adresse e-mail doit être vérifiée avant l’adhésion.</p>'
        '<p>Ce lien expire après 72 heures. Votre invitation reste en attente et '
        'le propriétaire peut vous renvoyer un lien.</p>'
        '<p>Dans cet espace, l’administrateur peut superviser vos conversations '
        'professionnelles. Les conversations personnelles hors espace restent privées.</p>'
        '</div>'
    )
    try:
        response = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            json={"sender": {"email": sender, "name": "ORIA Collaboratif"},
                  "to": [{"email": recipient}],
                  "subject": "Votre invitation ORIA Collaboratif",
                  "htmlContent": body},
            headers={"api-key": key, "accept": "application/json",
                     "content-type": "application/json"},
            timeout=12, allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise HTTPException(502, "Envoi e-mail indisponible. Réessayez depuis vos invitations.") from exc
    if response.status_code not in (200, 201, 202):
        raise HTTPException(502, "Brevo n'a pas accepté cet envoi. Réessayez plus tard.")


class EmailInvitationsService:
    def __init__(self, db: Any):
        self.db = db

    def list(self, actor: str, workspace: str) -> dict:
        result = _rpc(self.db, "oria_collab_email_list_v1", {
            "p_workspace_id": uuid_str(workspace), "p_actor_user_id": uuid_str(actor),
        })
        if not isinstance(result.get("invitations"), list):
            raise HTTPException(503, "Liste d'invitations invalide.")
        return result

    def issue(self, actor: str, workspace: str, email: str) -> dict:
        key, sender, origin = _config()  # Verifier configuration AVANT creation DB.
        actor_id = uuid_str(actor)
        space_id = uuid_str(workspace)
        recipient = normalized_email(email)
        # Le nom d'espace est lu dans une RPC d'autorisation propriétaire avant l'envoi.
        # La liste RPC vérifie le rôle propriétaire côté SQL.
        self.list(actor_id, space_id)
        workspace_name = next((r.get("name", "ORIA Collaboratif") for r in
            self._owner_workspace_rows(actor_id, space_id)), "ORIA Collaboratif")
        secret = secrets.token_urlsafe(32)
        digest = valid_token(secret)
        issued = _rpc(self.db,
            "oria_collab_email_issue_v2" if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1"
            else "oria_collab_email_issue_v1", {
            "p_workspace_id": space_id, "p_actor_user_id": actor_id,
            "p_email_normalized": recipient, "p_secret_sha256": digest,
        })
        # Un fournisseur peut echouer APRES la creation de la ligne pending.
        # La ligne n'est PAS revoquee; un renvoi remplacera le token.
        _send_via_brevo(key, sender, origin, recipient, secret, workspace_name)
        status = _rpc(self.db, "oria_collab_email_mark_sent_v1", {
            "p_workspace_id": space_id, "p_actor_user_id": actor_id,
            "p_invite_id": issued["invite_id"], "p_secret_sha256": digest,
        })
        if not status.get("marked"):
            raise HTTPException(409, "L'invitation a changé durant l'envoi. Vérifiez son statut.")
        return {"success": True, "invite_id": issued["invite_id"],
                "email": recipient, "token_expires_at": issued["token_expires_at"], "email_sent": True}

    def _owner_workspace_rows(self, actor: str, workspace: str) -> list[dict]:
        entries = _rpc(self.db, "oria_collab_workspace_directory_v2", {
            "p_actor_user_id": actor,
        }).get("workspaces") or []
        return [entry for entry in entries if entry.get("id") == workspace and entry.get("role") == "owner"]

    def resend(self, actor: str, workspace: str, invitation: str) -> dict:
        invitation_id = uuid_str(invitation)
        rows = self.list(actor, workspace)["invitations"]
        selected = next((row for row in rows if row.get("id") == invitation_id
                         and row.get("status") == "pending"), None)
        if selected is None:
            raise HTTPException(404, "Invitation en attente introuvable.")
        return self.issue(actor, workspace, selected["email"])

    def revoke(self, actor: str, workspace: str, invitation: str) -> dict:
        return _rpc(self.db, "oria_collab_email_revoke_v1", {
            "p_workspace_id": uuid_str(workspace), "p_actor_user_id": uuid_str(actor),
            "p_invite_id": uuid_str(invitation),
        })

    def preview(self, token: str) -> dict:
        return _rpc(self.db, "oria_collab_email_preview_v1", {
            "p_secret_sha256": valid_token(token),
        })

    def accept(self, actor: str, token: str, first: str, last: str, avatar: str,
               consent: bool) -> dict:
        first, last, avatar = validated_profile(first, last, avatar, consent)
        return _rpc(self.db,
            "oria_collab_email_accept_v2" if os.getenv("ORIA_COLLAB_MULTI_ACTIVE", "0") == "1"
            else "oria_collab_email_accept_v1", {
            "p_actor_user_id": uuid_str(actor),
            "p_secret_sha256": valid_token(token),
            "p_first_name": first, "p_last_name": last, "p_avatar_key": avatar,
            "p_supervision_accepted": consent,
        })
