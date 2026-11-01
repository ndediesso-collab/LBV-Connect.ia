"""Sélection manuelle du fournisseur ORIA Cours, indépendante du Chat.

Pur choix de configuration. Aucun appel fournisseur ou RPC n'est effectué.
Le CourseService doit geler ce résultat dans un devis/plan persistant
avant tout paiement. NE PAS utiliser tel quel pour bypasser les gardes SQL.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class CourseProviderConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class CourseProviderSelection:
    provider: str
    writing_model: str
    transcription_model: str


def select_course_provider(env: Mapping[str, str] | None = None) -> CourseProviderSelection:
    variables = os.environ if env is None else env
    direct = variables.get("ORIA_COURSE_OPENAI_ENABLED", "1")
    router = variables.get("ORIA_COURSE_OPENROUTER_ENABLED", "0")
    if direct not in {"0", "1"} or router not in {"0", "1"}:
        raise CourseProviderConfigurationError("Interrupteurs ORIA Cours invalides.")
    if direct == router:
        raise CourseProviderConfigurationError("Exactement un fournisseur ORIA Cours doit être actif.")
    if direct == "1":
        return CourseProviderSelection(
            provider="openai", writing_model="gpt-6-luna",
            transcription_model="gpt-4o-mini-transcribe",
        )
    from app.services.course_openrouter_adapter import CourseOpenRouterModels
    writing = variables.get("ORIA_COURSE_OPENROUTER_WRITING_MODEL", "openai/gpt-6-luna")
    transcription = variables.get("ORIA_COURSE_OPENROUTER_TRANSCRIPTION_MODEL", "openai/gpt-4o-mini-transcribe")
    try:
        models = CourseOpenRouterModels(writing, transcription)
    except ValueError as exc:
        raise CourseProviderConfigurationError("Modèles ORIA Cours OpenRouter non autorisés.") from exc
    return CourseProviderSelection(
        provider="openrouter", writing_model=models.writing_model,
        transcription_model=models.transcription_model,
    )

__all__ = ["CourseProviderSelection", "CourseProviderConfigurationError", "select_course_provider"]
