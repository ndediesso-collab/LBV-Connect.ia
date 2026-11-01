"""ORIA — routage du Chat entre OpenAI direct et OpenRouter.

Module isolé : aucun appel réseau, aucune modification du wallet ou du média.
La décision est figée UNE FOIS pour chaque génération. Pas de fallback implicite.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Collection


class ChatProviderConfigurationError(RuntimeError):
    """Interrupteurs ou catalogue administrateur invalides."""


class ChatModelNotAvailableError(ValueError):
    """Modèle inexistant ou non autorisé pour ce pack / fournisseur."""


class ChatProvider(str, Enum):
    OPENAI = "openai"
    OPENROUTER = "openrouter"


@dataclass(frozen=True)
class ChatProviderSelection:
    """Décision immuable à conserver pendant toute la génération."""
    provider: ChatProvider
    oria_model: str
    api_model: str
    pack_id: str


def _switch(name: str, env: Mapping[str, str], default: str) -> bool:
    raw = str(env.get(name, default)).strip().lower()
    if raw not in {"0", "1"}:
        raise ChatProviderConfigurationError(f"{name} doit valoir 0 ou 1.")
    return raw == "1"


def active_chat_provider(*, environ: Mapping[str, str] | None = None) -> ChatProvider:
    """Par compatibilité ascendante, OpenAI seul est le défaut en l'absence de flags.

    Ces deux flags ne pilotent QUE le Chat ; OpenRouter médias reste indépendant.
    """
    env = os.environ if environ is None else environ
    openai = _switch("ORIA_OPENAI_ENABLED", env, "1")
    router = _switch("ORIA_OPENROUTER_ENABLED", env, "0")
    if openai == router:
        raise ChatProviderConfigurationError(
            "Configuration Chat invalide : activer UN SEUL fournisseur (OpenAI ou OpenRouter)."
        )
    return ChatProvider.OPENAI if openai else ChatProvider.OPENROUTER


def select_chat_model(
    *,
    oria_model: str,
    pack_id: str,
    allowed_models_by_pack: Mapping[str, Collection[str]],
    openai_model_ids: Mapping[str, str],
    openrouter_model_ids: Mapping[str, str],
    environ: Mapping[str, str] | None = None,
    trial_model: str | None = None,
    trial_authorized: bool = False,
) -> ChatProviderSelection:
    """Vérifie les droits puis résout un modèle EXACTEMENT configuré par ORIA.

    Pour un essai, le caller DOIT avoir vérifié atomiquement l'autorisation
    d'essai et le quota ; cette fonction ne remplace pas ModelTrialService.
    Les slugs OpenRouter sont fournis séparément après vérification du catalogue.
    """
    model = str(oria_model or "").strip().lower()
    pack = str(pack_id or "").strip()
    allowed = allowed_models_by_pack.get(pack)
    if allowed is None:
        raise ChatModelNotAvailableError("Pack ORIA non reconnu.")
    trial_ok = bool(trial_authorized and trial_model == model)
    if model not in allowed and not trial_ok:
        raise ChatModelNotAvailableError("Modèle indisponible pour ce pack ORIA.")

    provider = active_chat_provider(environ=environ)
    catalog = openai_model_ids if provider is ChatProvider.OPENAI else openrouter_model_ids
    api_model = catalog.get(model)
    if not isinstance(api_model, str) or not api_model.strip():
        raise ChatModelNotAvailableError(
            "Modèle ORIA absent du catalogue du fournisseur actif."
        )
    api_model = api_model.strip()
    if provider is ChatProvider.OPENROUTER and not api_model.startswith(("openai/", "anthropic/")):
        raise ChatProviderConfigurationError("Slug OpenRouter non autorisé par la configuration Chat.")
    return ChatProviderSelection(provider=provider, oria_model=model, api_model=api_model, pack_id=pack)
