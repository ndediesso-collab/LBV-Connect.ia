"""Validation locale des fournisseurs figés dans un plan ORIA Cours.

Ne remplace JAMAIS les RPC PostgreSQL. Les plans OpenRouter ne peuvent pas
etre exécutes tant que les gardes SQL de la phase 6B.2 n'ont pas été migrées.
Les plans anciens (sans champ provider) conservent leur sens OpenAI direct.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re
from typing import Any, Mapping

# Contrat fermé, partagé avec la phase 6A. A confirmer sur le catalogue
# OpenRouter AVANT l'activation des appels payants.
OPENROUTER_COURSE_WRITERS = frozenset({
    "openai/gpt-6-luna",
})
OPENROUTER_COURSE_TRANSCRIBERS = frozenset({
    "openai/gpt-4o-mini-transcribe", "openai/whisper-1",
    "openai/whisper-large-v3", "openai/whisper-large-v3-turbo",
})


class CoursePlanProviderError(ValueError):
    """Plan non autorisé ou incomplet ; aucune opération payante."""


@dataclass(frozen=True)
class CoursePinnedProvider:
    provider: str
    writing_model: str
    transcription_model: str
    pricing_version: str


def validate_pinned_course_provider(plan: Mapping[str, Any]) -> CoursePinnedProvider:
    """Le fournisseur est déterminé par le plan persistant, pas par Render.

    Ancien plan sans « provider » : seulement Luna / OpenAI direct.
    Nouveau plan OpenRouter : fournisseur, modèles et version de tarif exigés.
    """
    if not isinstance(plan, Mapping) or plan.get("writing_model") != "luna":
        raise CoursePlanProviderError("Plan pédagogique ORIA Cours invalide.")

    provider = plan.get("provider")
    if provider is None or provider == "openai":
        if (plan.get("provider_model") != "gpt-6-luna"
                or plan.get("transcription_model", "gpt-4o-mini-transcribe") != "gpt-4o-mini-transcribe"):
            raise CoursePlanProviderError("Plan OpenAI historique incompatible.")
        version = plan.get("pricing_version", "openai-direct-v1")
        if version != "openai-direct-v1":
            raise CoursePlanProviderError("Tarification OpenAI inconnue.")
        return CoursePinnedProvider("openai", "gpt-6-luna", "gpt-4o-mini-transcribe", version)

    if provider != "openrouter":
        raise CoursePlanProviderError("Fournisseur ORIA Cours non autorisé.")
    writer = plan.get("provider_model")
    transcriber = plan.get("transcription_model")
    version = plan.get("pricing_version")
    if (writer not in OPENROUTER_COURSE_WRITERS
            or transcriber not in OPENROUTER_COURSE_TRANSCRIBERS
            or version != "openrouter-v1"):
        raise CoursePlanProviderError("Modèles ou grille OpenRouter non validés.")
    # La provision audio doit être bornée AVANT de signer le devis ; on ne
    # convertit pas ce champ en tarif fournisseur constaté.
    ceiling = plan.get("transcription_quote_usd_per_minute_ceiling")
    try:
        if not isinstance(ceiling, str) or re.fullmatch(r"[0-9]{1,2}(?:\.[0-9]{1,8})?", ceiling) is None:
            raise TypeError("decimal in SQL-supported format required")
        rate = Decimal(ceiling)
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise CoursePlanProviderError("Plafond audio OpenRouter absent.") from exc
    if not rate.is_finite() or not Decimal("0") < rate <= Decimal("10"):
        raise CoursePlanProviderError("Plafond audio OpenRouter invalide.")
    return CoursePinnedProvider("openrouter", str(writer), str(transcriber), str(version))


__all__ = ["CoursePlanProviderError", "CoursePinnedProvider", "validate_pinned_course_provider",
           "OPENROUTER_COURSE_WRITERS", "OPENROUTER_COURSE_TRANSCRIBERS"]
