from collections.abc import AsyncIterator, Iterator



import asyncio

from time import perf_counter
import json
import re
from html.parser import HTMLParser
from typing import Any







from openai import AsyncOpenAI, OpenAI







from app.config.openai import OPENAI_API_KEY







from app.config.credit_costs import (



    CreditAction,



    IMAGE_ACTION_QUALITY,



    IMAGE_MODEL_BY_PACK,



    MAX_CHAT_OUTPUT_TOKENS,
    COURSE_MAX_OUTPUT_TOKENS,



    VIDEO_ACTION_DURATION_SECONDS,



    VIDEO_MODEL_BY_PACK,



    VIDEO_PROVIDER_BY_PACK,



)







from app.services.prompt_service import (
    build_output_prompt,
    build_course_section_messages,
    _artifact_formats_for_prompt,
)










# Le contrat des 9 formats visuels est défini dans prompt_service.py.
# Ne pas répliquer le schéma ici : un seul contrat Web/Mobile est maintenu.
# L'option visual_mode est transmise par les routes et reste désactivée
# par défaut pour les clients qui n'annoncent pas cette capacité.

_SHARED_OPENAI_CLIENT: OpenAI | None = None
_SHARED_ASYNC_OPENAI_CLIENT: AsyncOpenAI | None = None


def _get_shared_openai_client() -> OpenAI:
    """
    Retourne un client OpenAI HTTP réutilisé pendant toute la vie du process.

    Cela permet au transport HTTP du SDK de conserver son pool de connexions
    entre les requêtes Oria.
    """
    global _SHARED_OPENAI_CLIENT

    if _SHARED_OPENAI_CLIENT is None:
        _SHARED_OPENAI_CLIENT = OpenAI(
            api_key=OPENAI_API_KEY,
        )

    return _SHARED_OPENAI_CLIENT


def _get_shared_async_openai_client() -> AsyncOpenAI:
    """
    Retourne le client asynchrone partagé utilisé par Responses WebSocket.

    Le WebSocket n'est utilisé que lorsqu'Oria a besoin d'un flux pilotable
    pendant la génération (mid-turn steering). Le client est créé une seule
    fois par process.
    """
    global _SHARED_ASYNC_OPENAI_CLIENT

    if _SHARED_ASYNC_OPENAI_CLIENT is None:
        _SHARED_ASYNC_OPENAI_CLIENT = AsyncOpenAI(
            api_key=OPENAI_API_KEY,
        )

    return _SHARED_ASYNC_OPENAI_CLIENT







class OpenAIService:







    """Service central de communication avec OpenAI."""







    MAX_ATTACHMENTS = 3







    MAX_HISTORY_MESSAGES = 40


    # ========================================================
    # ORIA ARTIFACT V1 — VALIDATION DES SORTIES STRUCTURÉES
    # ========================================================
    # Ce service NE crée PAS de fichier et ne confirme PAS sa disponibilité.
    # Il vérifie l'enveloppe produite par OpenAI avant que ai.py ne la confie
    # au moteur sécurisé ArtifactService. Les sources restent NON FIABLES.

    MAX_ARTIFACT_RESPONSE_CHARS = 1_500_000
    MAX_ARTIFACT_SOURCE_CHARS = 1_000_000

    @staticmethod
    def _document_types(artifact_types: Any) -> tuple[str, ...]:
        # Même normalisation que prompt_service : pas de liste divergente.
        return _artifact_formats_for_prompt(artifact_types)

    @classmethod
    def _parse_artifact_payload(
        cls, raw_text: str, *, expected_formats: tuple[str, ...],
        allow_fenced_json: bool = False,
    ) -> dict[str, Any]:
        """Valide strictement l'enveloppe, sans interpréter ni exécuter les sources.

        La sanitation HTML/SVG, l'isolation et la conversion sont effectuées
        ensuite par le générateur d'artefacts. Ce contrôle de forme n'est pas
        un substitut à ces protections.
        """
        if not expected_formats:
            raise ValueError("Aucun format documentaire n'a été demandé.")
        if not isinstance(raw_text, str) or not raw_text.strip():
            raise ValueError("Réponse documentaire du modèle vide.")
        if len(raw_text) > cls.MAX_ARTIFACT_RESPONSE_CHARS:
            raise ValueError("Réponse documentaire trop volumineuse.")
        if allow_fenced_json:
            # Web Search cannot enforce JSON mode. Accept only one complete
            # enclosing JSON fence, never arbitrary prose or JSON fragments.
            match = re.fullmatch(
                r"\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*",
                raw_text, flags=re.IGNORECASE,
            )
            if match:
                raw_text = match.group(1)
        def no_duplicate_fields(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            obj: dict[str, Any] = {}
            for key, value in pairs:
                if key in obj:
                    raise ValueError("Clé JSON dupliquée dans le contrat documentaire.")
                obj[key] = value
            return obj

        def reject_nonfinite(value: str) -> Any:
            raise ValueError(f"Nombre JSON non fini interdit : {value}")

        try:
            payload = json.loads(
                raw_text, object_pairs_hook=no_duplicate_fields,
                parse_constant=reject_nonfinite,
            )
        except (ValueError, TypeError) as error:
            raise ValueError(
                "Réponse documentaire invalide : JSON oria.artifact.v1 attendu, "
                "sans commentaire ni bloc Markdown."
            ) from error
        if not isinstance(payload, dict):
            raise ValueError("Le contrat documentaire doit être un objet JSON.")
        if payload.get("schema_version") != "oria.artifact.v1":
            raise ValueError("Version du contrat documentaire invalide.")
        if set(payload) != {"schema_version", "sources", "artifacts"}:
            raise ValueError("Champs inattendus ou manquants dans le contrat documentaire.")

        sources = payload["sources"]
        if not isinstance(sources, list) or len(sources) > 10:
            raise ValueError("Liste des sources documentaires invalide.")
        source_ids: set[str] = set()
        for source in sources:
            if not isinstance(source, dict) or set(source) != {"id", "kind", "content"}:
                raise ValueError("Définition de source documentaire invalide.")
            source_id = source["id"]
            kind = source["kind"]
            content = source["content"]
            if (not isinstance(source_id, str)
                    or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", source_id)
                    or source_id in source_ids):
                raise ValueError("Identifiant de source documentaire invalide ou en double.")
            if kind not in ("html", "svg"):
                raise ValueError("Langage de composition non autorisé.")
            if (not isinstance(content, str) or not content.strip()
                    or len(content) > cls.MAX_ARTIFACT_SOURCE_CHARS):
                raise ValueError("Contenu de source documentaire vide ou trop volumineux.")
            if kind == "html" and not re.search(r"<(?:(?:!doctype\s+)?html|main|body)\b", content, re.I):
                raise ValueError("Source HTML dépourvue de structure documentaire.")
            if kind == "svg" and not re.search(r"<svg\b", content, re.I):
                raise ValueError("Source SVG dépourvue de balise svg.")
            # Blocage précoce des constructions actives évidentes. Ce filtre
            # ne remplace PAS un parseur HTML/SVG sécurisé dans ArtifactService.
            if (re.search(r"<\s*/?\s*(?:script|iframe|object|embed|foreignObject)\b", content, re.I)
                    or re.search(r"\bon[a-z]+\s*=", content, re.I)
                    or re.search(r"javascript\s*:", content, re.I)
                    or re.search(r"@import\b", content, re.I)):
                raise ValueError("Source documentaire comportant du contenu actif interdit.")
            source_ids.add(source_id)

        artifacts = payload["artifacts"]
        if not isinstance(artifacts, list) or len(artifacts) != len(expected_formats):
            raise ValueError("Le nombre de fichiers diffère de la demande.")
        found_formats: set[str] = set()
        for artifact in artifacts:
            if (not isinstance(artifact, dict)
                    or set(artifact) != {"format", "filename", "source_id", "native_data"}):
                raise ValueError("Définition de fichier documentaire invalide.")
            fmt = artifact["format"]
            filename = artifact["filename"]
            source_id = artifact["source_id"]
            native_data = artifact["native_data"]
            if (not isinstance(fmt, str) or fmt not in expected_formats
                    or fmt in found_formats):
                raise ValueError("Format documentaire non demandé ou dupliqué.")
            found_formats.add(fmt)
            if (not isinstance(filename, str) or not 1 <= len(filename) <= 180
                    or '/' in filename or '\\' in filename
                    or any(ord(c) < 32 for c in filename)
                    or filename.startswith('.') or not filename.lower().endswith('.' + fmt)):
                raise ValueError("Nom de fichier invalide ou extension incorrecte.")
            if source_id is not None and (not isinstance(source_id, str)
                                          or source_id not in source_ids):
                raise ValueError("Référence à une source inexistante.")
            if native_data is not None and not isinstance(native_data, (dict, list)):
                raise ValueError("Les données natives doivent être structurées.")
            if source_id is None and native_data is None:
                raise ValueError("Fichier dépourvu de source et de données natives.")
        if found_formats != set(expected_formats):
            raise ValueError("Tous les formats demandés n'ont pas été produits.")
        return payload

    @staticmethod
    def _enforce_tool_format_compatibility(request: dict[str, Any]) -> None:
        """Do not send hosted Web Search together with constrained JSON output.

        A single guarded point, invoked at each provider boundary, protects
        against a future caller accidentally reintroducing text.format.
        The document contract is still checked locally after the response.
        """
        tools = request.get("tools") or []
        has_web_search = any(
            isinstance(tool, dict)
            and str(tool.get("type") or "").startswith("web_search")
            for tool in tools
        )
        if not has_web_search:
            return
        text_config = request.get("text")
        if not isinstance(text_config, dict):
            return
        fmt = text_config.get("format")
        if isinstance(fmt, dict) and fmt.get("type") in {"json_object", "json_schema"}:
            # Only discard the incompatible constrained-output option.
            # Never disable Web Search without the user's knowledge.
            text_config = dict(text_config)
            text_config.pop("format", None)
            if text_config:
                request["text"] = text_config
            else:
                request.pop("text", None)
        final_type = ((request.get("text") or {}).get("format") or {}).get("type")
        if final_type in {"json_object", "json_schema"}:
            raise RuntimeError("Web Search ne peut pas coexister avec un mode JSON forcé.")

    @staticmethod
    def _artifact_json_text_format() -> dict[str, Any]:
        # Responses API JSON mode : contrainte syntaxique; validation métier
        # supplémentaire dans _parse_artifact_payload. Seulement en mode doc.
        return {"format": {"type": "json_object"}}

    # ========================================================
    # MODES DE RÉFLEXION ORIA
    # ========================================================

    # Contrat interne stable pour le frontend :
    # - fast      -> priorité à la vitesse
    # - balanced  -> compromis vitesse / qualité
    # - deep      -> priorité à la qualité
    #
    # Le backend traduit ensuite ce preset vers la valeur réellement
    # comprise par chaque modèle OpenAI.
    DEFAULT_REASONING_MODE = "balanced"

    REASONING_EFFORT_BY_MODEL: dict[str, dict[str, str]] = {
        "gpt-6-luna": {
            "fast": "none",
            "balanced": "medium",
            "deep": "high",
        },
        "gpt-5": {
            "fast": "minimal",
            "balanced": "medium",
            "deep": "high",
        },
        "gpt-5.6-terra": {
            "fast": "none",
            "balanced": "medium",
            "deep": "high",
        },
        "gpt-6-sol": {
            "fast": "none",
            "balanced": "medium",
            "deep": "high",
        },
        "gpt-6-astra": {
            # Astra ne supporte pas l'effort "none".
            "fast": "low",
            "balanced": "medium",
            "deep": "high",
        },
    }







    # ========================================================



    # EXÉCUTION MÉDIA — PARAMÈTRES NON ÉCONOMIQUES



    # ========================================================



    #



    # Modèles et qualités viennent de app.config.credit_costs.



    # Ce service conserve seulement les paramètres techniques.



    #







    IMAGE_SIZE_BY_ACTION: dict[CreditAction, str] = {



        CreditAction.IMAGE_480: "1024x1024",



        CreditAction.IMAGE_720: "1024x1024",



        CreditAction.IMAGE_PRO: "1024x1024",



        CreditAction.IMAGE_PRO_STANDARD: "1024x1024",



        CreditAction.IMAGE_PRO_ULTRA: "1024x1536",



        CreditAction.IMAGE_BUSINESS: "1024x1024",



        CreditAction.IMAGE_BUSINESS_HD: "1536x1024",



        CreditAction.IMAGE_BUSINESS_ULTRA: "1536x1024",



    }







    LEGACY_IMAGE_PACK_BY_ACTION: dict[CreditAction, str] = {



        CreditAction.IMAGE_480: "light_pack",



        CreditAction.IMAGE_720: "light_pack",



        CreditAction.IMAGE_PRO: "pro_pack",



        CreditAction.IMAGE_PRO_STANDARD: "pro_pack",



        CreditAction.IMAGE_PRO_ULTRA: "pro_pack",



        CreditAction.IMAGE_BUSINESS: "business_pack",



        CreditAction.IMAGE_BUSINESS_HD: "business_pack",



        CreditAction.IMAGE_BUSINESS_ULTRA: "business_pack",



    }







    VIDEO_SIZE_BY_ACTION: dict[CreditAction, str] = {



        CreditAction.VIDEO_4S: "1280x720",



        CreditAction.VIDEO_8S: "1280x720",



        CreditAction.VIDEO_LITE: "1280x720",



        CreditAction.VIDEO_PRO_FAST: "1280x720",



        CreditAction.VIDEO_PRO_STANDARD: "1280x720",



        CreditAction.VIDEO_PRO_EXTENSION: "1792x1024",



        CreditAction.VIDEO_BUSINESS_FAST: "1792x1024",



        CreditAction.VIDEO_BUSINESS_STANDARD: "1792x1024",



        CreditAction.VIDEO_BUSINESS_LONG: "1792x1024",



    }







    LEGACY_VIDEO_PACK_BY_ACTION: dict[CreditAction, str] = {



        CreditAction.VIDEO_4S: "light_pack",



        CreditAction.VIDEO_8S: "light_pack",



        CreditAction.VIDEO_LITE: "intermediate_pack",



        CreditAction.VIDEO_PRO_FAST: "pro_pack",



        CreditAction.VIDEO_PRO_STANDARD: "pro_pack",



        CreditAction.VIDEO_PRO_EXTENSION: "pro_pack",



        CreditAction.VIDEO_BUSINESS_FAST: "business_pack",



        CreditAction.VIDEO_BUSINESS_STANDARD: "business_pack",



        CreditAction.VIDEO_BUSINESS_LONG: "business_pack",



    }







    def __init__(
        self,
        client: OpenAI | None = None,
        async_client: AsyncOpenAI | None = None,
    ):
        # Injection possible pour les tests, sinon clients partagés du process.
        self.client = client or _get_shared_openai_client()
        self.async_client = async_client or _get_shared_async_openai_client()


    # Modèles Oria de la famille GPT-6 capables du mid-turn steering.
    # GPT-5.6 et antérieurs restent sur le smart restart.
    STEERING_MODEL_KEYS = {
        "gpt-6-luna",
        "gpt-6-sol",
        "gpt-6-astra",
    }


    @classmethod
    def _reasoning_model_key(
        cls,
        model: str,
    ) -> str | None:
        """Retourne la famille de modèle utilisée pour les presets Oria."""
        normalized_model = str(model or "").strip().lower()

        # Les préfixes couvrent aussi d'éventuels snapshots datés.
        for model_key in cls.REASONING_EFFORT_BY_MODEL:
            if normalized_model == model_key or normalized_model.startswith(
                f"{model_key}-"
            ):
                return model_key

        return None


    @classmethod
    def _resolve_reasoning_effort(
        cls,
        model: str,
        reasoning_mode: str | None,
    ) -> str | None:
        """
        Traduit le preset frontend Oria vers reasoning.effort.

        Pour un modèle non encore configuré, aucun paramètre de raisonnement
        n'est envoyé : le comportement natif du modèle est conservé.
        """
        mode = str(
            reasoning_mode or cls.DEFAULT_REASONING_MODE
        ).strip().lower()

        if mode not in {"fast", "balanced", "deep"}:
            raise ValueError(
                "Mode de réflexion Oria invalide. "
                "Valeurs autorisées : fast, balanced, deep."
            )

        model_key = cls._reasoning_model_key(model)

        if model_key is None:
            return None

        return cls.REASONING_EFFORT_BY_MODEL[model_key][mode]


    @classmethod
    def _apply_reasoning_to_request(
        cls,
        request: dict[str, Any],
        *,
        model: str,
        reasoning_mode: str | None,
    ) -> str | None:
        """Ajoute reasoning.effort à une requête Responses si supporté."""
        effort = cls._resolve_reasoning_effort(
            model=model,
            reasoning_mode=reasoning_mode,
        )

        if effort is not None:
            request["reasoning"] = {
                "effort": effort,
            }

        return effort


    @classmethod
    def supports_mid_turn_steering(
        cls,
        model: str,
    ) -> bool:
        """
        Indique si le modèle peut recevoir response.steer.

        Le transport WebSocket reste une seconde condition vérifiée séparément.
        """
        model_key = cls._reasoning_model_key(model)
        return model_key in cls.STEERING_MODEL_KEYS


    def supports_responses_websocket(self) -> bool:
        """
        Vérifie la présence de Responses WebSocket dans le SDK installé.

        Cela permet à Oria de tomber proprement sur le smart restart si le
        serveur n'a pas encore reçu une version du SDK compatible WebSocket.
        """
        responses = getattr(self.async_client, "responses", None)
        return callable(getattr(responses, "connect", None))


    def resolve_modification_strategy(
        self,
        *,
        model: str,
        instruction_changed: bool,
        reasoning_changed: bool,
    ) -> str:
        """
        Choisit la stratégie du bouton « Modifier ».

        - un changement de puissance de réflexion impose un smart restart ;
        - une simple nouvelle instruction utilise le steering sur GPT-6 si
          Responses WebSocket est disponible ;
        - sinon Oria demande un smart restart.
        """
        if reasoning_changed:
            return "restart"

        if not instruction_changed:
            return "none"

        if (
            self.supports_mid_turn_steering(model)
            and self.supports_responses_websocket()
        ):
            return "steer"

        return "restart"


    @staticmethod
    def _normalize_control_command(
        command: Any,
    ) -> dict[str, Any]:
        """
        Normalise une commande envoyée au flux pilotable.

        Le futur routeur ai.py pourra pousser dans control_queue :
        {
            "type": "modify",
            "instruction": "Fais plus court",
            "reasoning_mode": "fast" | None,
        }
        """
        if isinstance(command, str):
            return {
                "type": "modify",
                "instruction": command.strip(),
                "reasoning_mode": None,
            }

        if not isinstance(command, dict):
            return {
                "type": "invalid",
                "instruction": "",
                "reasoning_mode": None,
            }

        return {
            "type": str(command.get("type") or "modify").strip().lower(),
            "instruction": str(command.get("instruction") or "").strip(),
            "reasoning_mode": (
                str(command["reasoning_mode"]).strip().lower()
                if command.get("reasoning_mode")
                else None
            ),
        }







    # ========================================================







    # CONSTRUCTION DU CONTENU MULTIMODAL







    # ========================================================







    def _build_input(







        self,







        message: str,







        attachments: list[dict[str, Any]] | None = None,







        web: bool = False,







        history: list[dict[str, Any]] | None = None,
        visual_mode: bool = False,
        artifact_types: str | list[str] | tuple[str, ...] | None = None,







    ) -> list[dict[str, Any]]:







        """







        Construit l'input natif de la Responses API.







        Supporte :







        - historique conversationnel







        - texte







        - images







        - fichiers







        Maximum : 3 pièces jointes pour le message courant.







        """







        attachments = attachments or []







        history = history or []







        # L'historique est déjà sélectionné et limité par la route IA.







        # OpenAIService transmet donc l'historique reçu sans le tronquer







        # afin de préserver les messages anciens pertinents ajoutés







        # à la mémoire conversationnelle.







        if len(attachments) > self.MAX_ATTACHMENTS:







            raise ValueError(







                "Maximum 3 images ou fichiers par message."







            )







        input_data: list[dict[str, Any]] = []
        document_types = self._document_types(artifact_types)
        if document_types:
            # Contrat de sortie à autorité supérieure au texte utilisateur.
            # Les consignes détaillées ne sont incluses qu'une fois dans le
            # prompt via build_output_prompt(..., artifact_types=...).
            input_data.append({
                "role": "developer",
                "content": (
                    "MODE ORIA DOCUMENTAIRE ACTIVÉ PAR LE SERVEUR. "
                    "La réponse doit contenir exclusivement un objet JSON "
                    "oria.artifact.v1, sans texte de Chat ni code Markdown "
                    "extérieur. Les instructions documentaires du prompt "
                    "prévalent sur la présentation conversationnelle. "
                    "Ne prétends pas que le fichier est prêt : le serveur "
                    "contrôle la conversion et la sauvegarde."
                    + (
                        " RECHERCHE WEB ACTIVE : le format JSON forcé n'est "
                        "pas compatible avec l'outil de recherche. Produis "
                        "néanmoins un JSON valide et COMPLET : exactement "
                        "l'objet oria.artifact.v1, avec toutes les chaînes "
                        "correctement échappées, sans délimitation Markdown, "
                        "citations ou commentaires ajoutés après l'objet. "
                        "Insère les références Web vérifiées uniquement "
                        "dans le contenu documentaire approprié ; n'invente "
                        "pas de sources et ne mets aucune citation hors JSON."
                        if web else ""
                    )
                ),
            })







        # ====================================================







        # HISTORIQUE







        # ====================================================







        for item in history:







            role = item.get("role")







            content = item.get("content")







            # L'historique sauvegardé est du contenu utilisateur : il ne
            # doit jamais pouvoir injecter un rôle system/developer.
            if role not in {"user", "assistant"}:







                continue







            if not content:







                continue







            input_data.append(







                {







                    "role": role,







                    "content": content,







                }







            )







        # ====================================================







        # PROMPT ORIA







        # ====================================================







        formatted_message = build_output_prompt(
            message=message,
            web=web,
            visual_mode=visual_mode and not document_types,
            artifact_types=document_types or None,
        )







        content: list[dict[str, Any]] = [







            {







                "type": "input_text",







                "text": formatted_message,







            }







        ]







        # ====================================================







        # PIÈCES JOINTES







        # ====================================================







        for attachment in attachments:







            attachment_type = attachment.get("type")







            mime_type = attachment.get(







                "mime_type",







                "application/octet-stream",







            )







            data = attachment.get("data")







            if not data:







                raise ValueError(







                    "Une pièce jointe ne contient aucune donnée."







                )







            if attachment_type == "image":







                content.append(







                    {







                        "type": "input_image",







                        "image_url": (







                            f"data:{mime_type};base64,{data}"







                        ),







                    }







                )







            elif attachment_type == "file":







                content.append(







                    {







                        "type": "input_file",







                        "filename": attachment.get(







                            "name",







                            "document",







                        ),







                        "file_data": (







                            f"data:{mime_type};base64,{data}"







                        ),







                    }







                )







            else:







                raise ValueError(







                    f"Type de pièce jointe non supporté : "







                    f"{attachment_type}"







                )







        input_data.append(







            {







                "role": "user",







                "content": content,







            }







        )







        return input_data







    # ========================================================







    # USAGE / FACTURATION







    # ========================================================







    @staticmethod







    def _value(







        source: Any,







        key: str,







        default: Any = None,







    ) -> Any:







        """







        Lit une valeur sur un objet SDK OpenAI ou un dictionnaire.







        """







        if source is None:







            return default







        if isinstance(source, dict):







            return source.get(key, default)







        return getattr(







            source,







            key,







            default,







        )







    @classmethod







    def _safe_int(







        cls,







        value: Any,







    ) -> int:







        """Normalise une valeur numérique de l'usage OpenAI."""







        try:







            return max(







                0,







                int(value or 0),







            )







        except (TypeError, ValueError):







            return 0







    @classmethod







    def _extract_usage(







        cls,







        response: Any,







    ) -> dict[str, int]:







        """







        Extrait l'usage réel retourné par la Responses API.







        OpenAI inclut :







        - cached_tokens dans input_tokens ;







        - cache_write_tokens dans input_tokens ;







        - reasoning_tokens dans output_tokens.







        Les détails restent exposés séparément pour le calculateur Oria,







        mais ne doivent jamais être additionnés une seconde fois.







        """







        usage = cls._value(







            response,







            "usage",







        )







        if usage is None:







            raise RuntimeError(







                "OpenAI n'a retourné aucune donnée d'usage "







                "pour cette réponse."







            )







        input_details = cls._value(







            usage,







            "input_tokens_details",







        )







        output_details = cls._value(







            usage,







            "output_tokens_details",







        )







        input_tokens = cls._safe_int(







            cls._value(







                usage,







                "input_tokens",







                0,







            )







        )







        cached_input_tokens = cls._safe_int(







            cls._value(







                input_details,







                "cached_tokens",







                0,







            )







        )







        cache_write_tokens = cls._safe_int(







            cls._value(







                input_details,







                "cache_write_tokens",







                0,







            )







        )







        output_tokens = cls._safe_int(







            cls._value(







                usage,







                "output_tokens",







                0,







            )







        )







        reasoning_tokens = cls._safe_int(







            cls._value(







                output_details,







                "reasoning_tokens",







                0,







            )







        )







        total_tokens = cls._safe_int(







            cls._value(







                usage,







                "total_tokens",







                0,







            )







        )







        if total_tokens == 0:







            total_tokens = (







                input_tokens







                + output_tokens







            )







        return {







            "input_tokens": input_tokens,







            "cached_input_tokens": (







                cached_input_tokens







            ),







            "cache_write_tokens": (







                cache_write_tokens







            ),







            "output_tokens": output_tokens,







            "reasoning_tokens": (







                reasoning_tokens







            ),







            "total_tokens": total_tokens,







        }







    @classmethod







    def _count_web_search_calls(







        cls,







        response: Any,







    ) -> int:







        """







        Compte les recherches Web réellement facturables.







        La Responses API peut produire un item web_search_call dont







        l'action est notamment :







            - search







            - open_page







            - find_in_page







        Seules les actions `search` correspondent ici à un appel







        de recherche facturable par notre moteur de crédits.







        Si une ancienne version du SDK ne fournit pas `action`,







        l'item web_search_call est compté par prudence.







        """







        output = cls._value(







            response,







            "output",







            [],







        ) or []







        count = 0







        for item in output:







            item_type = cls._value(







                item,







                "type",







                "",







            )







            if item_type != "web_search_call":







                continue







            action = cls._value(







                item,







                "action",







            )







            if action is None:







                # Compatibilité prudente avec un SDK qui n'exposerait







                # pas encore le détail de l'action.







                count += 1







                continue







            action_type = cls._value(







                action,







                "type",







                "",







            )







            if action_type == "search":







                count += 1







        return count







    @classmethod
    def _extract_web_images(cls, response: Any) -> list[dict[str, Any]]:
        """Images citées par le véritable outil OpenAI web_search.

        Aucune URL issue du texte libre du modèle n'est acceptée ici.
        Le routeur ai.py revalide ensuite ces URLs avant exposition publique.
        """
        from urllib.parse import urlsplit
        from ipaddress import ip_address

        def public_https(raw: Any) -> bool:
            value = str(raw or "").strip()
            try:
                parts = urlsplit(value)
                host = (parts.hostname or "").lower()
                if parts.scheme != "https" or not host or "." not in host:
                    return False
                if parts.username or parts.password or len(value) > 2048:
                    return False
                if host.endswith((".local", ".internal")) or host == "localhost":
                    return False
                try:
                    if not ip_address(host).is_global:
                        return False
                except ValueError:
                    pass
                return True
            except ValueError:
                return False

        images: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in cls._value(response, "output", []) or []:
            if cls._value(item, "type") != "web_search_call":
                continue
            for result in cls._value(item, "results", []) or []:
                if cls._value(result, "type") != "image_result":
                    continue
                image_url = str(cls._value(result, "image_url", "") or "").strip()
                source_url = str(cls._value(result, "source_website_url", "") or "").strip()
                if not (public_https(image_url) and public_https(source_url)):
                    continue
                if image_url in seen:
                    continue
                seen.add(image_url)
                caption = str(cls._value(result, "caption", "") or "").strip()[:500]
                images.append({
                    "image_url": image_url,
                    "source_url": source_url,
                    "caption": caption,
                    "alt": caption or "Illustration issue du Web",
                    "after_paragraph": 0,
                })
                if len(images) >= 3:
                    return images
        return images

    @classmethod







    def _build_chat_result(







        cls,







        *,







        response: Any,







        requested_model: str,
        web: bool,
        artifact_types: tuple[str, ...] = (),





    ) -> dict[str, Any]:







        """







        Construit le contrat consommé par le routeur Oria.







        """







        message = str(







            cls._value(







                response,







                "output_text",







                "",







            )







            or ""







        )







        artifact_payload = None
        if artifact_types:
            status = str(cls._value(response, "status", "completed") or "")
            if status != "completed":
                raise RuntimeError("Production documentaire interrompue ou incomplète.")
            artifact_payload = cls._parse_artifact_payload(
                message, expected_formats=artifact_types,
                allow_fenced_json=web,
            )
            # Ne jamais exposer la source de composition comme message Chat.
            message = ""

        usage = cls._extract_usage(





            response



        )







        web_search_calls = (







            cls._count_web_search_calls(







                response







            )







            if web







            else 0







        )







        actual_model = str(







            cls._value(







                response,







                "model",







                requested_model,







            )







            or requested_model







        )







        return {







            "success": True,







            "model": requested_model,







            "openai_model": actual_model,







            "web": web,







            "web_search_calls": (







                web_search_calls







            ),







            "message": message,
            **({"artifact_payload": artifact_payload} if artifact_types else {}),





            "usage": usage,
            "web_images": cls._extract_web_images(response) if web else [],







        }







# ========================================================







    # OUTILS







    # ========================================================







    @staticmethod
    def _build_tools(web: bool) -> list[dict[str, Any]]:
        """Recherche Web facultative. Les résultats images restent optionnels.

        `web_search_call.results` (activé dans les requêtes) fournit les URLs
        réellement retournées, sans génération ou invention de liens.
        """
        if not web:
            return []
        return [{
            "type": "web_search",
            "search_content_types": ["text", "image"],
            "image_settings": {"max_results": 3, "caption": True},
        }]







    # ========================================================







    # CHAT CLASSIQUE







    # ========================================================







    def chat(







        self,







        model: str,







        message: str,







        web: bool = False,







        attachments: list[dict[str, Any]] | None = None,







        history: list[dict[str, Any]] | None = None,







        reasoning_mode: str = "balanced",





        visual_mode: bool = False,
        artifact_types: str | list[str] | tuple[str, ...] | None = None,
    ) -> dict[str, Any]:







        """







        Mode classique texte + multimodal + recherche Web.







        Retourne désormais le texte ET l'usage réel nécessaire







        à la facturation dynamique Oria.







        """







        document_types = self._document_types(artifact_types)
        input_data = self._build_input(





            message=message,







            attachments=attachments,







            web=web,







            history=history,
            visual_mode=visual_mode,
            artifact_types=document_types,



        )







        request: dict[str, Any] = {







            "model": model,







            "input": input_data,







            "max_output_tokens": (







                MAX_CHAT_OUTPUT_TOKENS







            ),







        }







        # Limitation OpenAI Responses : web_search et JSON mode ne peuvent pas
        # être combinés dans une même requête. Conserver l'outil Web et exiger
        # le JSON via les instructions developer lorsque web=True ; le résultat
        # est ensuite validé strictement par _parse_artifact_payload().
        # Sans recherche Web, garder le mode JSON habituel.
        if document_types and not web:
            request["text"] = self._artifact_json_text_format()

        tools = self._build_tools(web)





        if tools:







            request["tools"] = tools
            request["include"] = ["web_search_call.results"]







        self._apply_reasoning_to_request(
            request,
            model=model,
            reasoning_mode=reasoning_mode,
        )







        try:







            self._enforce_tool_format_compatibility(request)
            response = self.client.responses.create(







                **request,







            )







        except Exception as error:







            raise RuntimeError(







                "Erreur API OpenAI Responses : "







                f"{str(error)}"







            ) from error







        return self._build_chat_result(







            response=response,







            requested_model=model,





            web=web,
            artifact_types=document_types,



        )







    # ========================================================







    # CHAT STREAMING







    # ========================================================







    def chat_stream(
        self,
        model: str,
        message: str,
        web: bool = False,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, Any]] | None = None,
        reasoning_mode: str = "balanced",
        generation_id: str | None = None,
        visual_mode: bool = False,
        artifact_types: str | list[str] | tuple[str, ...] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """
        Streaming HTTP classique de la Responses API.

        Le premier response.output_text.delta est retransmis immédiatement.
        Cette méthode reste le fallback universel et continue de fonctionner
        pour GPT-5 / GPT-5.6 ainsi que si WebSocket n'est pas disponible.

        `generation_id` permet au routeur/frontend d'ignorer un ancien flux
        après un smart restart sans mélanger deux réponses.
        """
        document_types = self._document_types(artifact_types)
        input_data = self._build_input(
            message=message,
            attachments=attachments,
            web=web,
            history=history,
            visual_mode=visual_mode,
            artifact_types=document_types,
        )

        request: dict[str, Any] = {
            "model": model,
            "input": input_data,
            "stream": True,
            "max_output_tokens": MAX_CHAT_OUTPUT_TOKENS,
        }
        # Limitation OpenAI Responses : web_search et JSON mode ne peuvent pas
        # être combinés dans une même requête. Conserver l'outil Web et exiger
        # le JSON via les instructions developer lorsque web=True ; le résultat
        # est ensuite validé strictement par _parse_artifact_payload().
        # Sans recherche Web, garder le mode JSON habituel.
        if document_types and not web:
            request["text"] = self._artifact_json_text_format()

        tools = self._build_tools(web)
        if tools:
            request["tools"] = tools
            request["include"] = ["web_search_call.results"]

        resolved_reasoning_effort = self._apply_reasoning_to_request(
            request,
            model=model,
            reasoning_mode=reasoning_mode,
        )

        try:
            openai_started_at = perf_counter()
            first_delta_ms: float | None = None
            response_id: str | None = None

            self._enforce_tool_format_compatibility(request)
            stream = self.client.responses.create(**request)
            completed_response = None
            document_fragments: list[str] = []
            document_chars = 0

            for event in stream:
                event_type = self._value(event, "type", "")

                if event_type == "response.created":
                    response = self._value(event, "response")
                    response_id = str(
                        self._value(response, "id", "") or ""
                    ) or response_id

                    yield {
                        "type": "response_meta",
                        "transport": "http",
                        "response_id": response_id,
                        "generation_id": generation_id,
                        "reasoning_mode": reasoning_mode,
                        "reasoning_effort": resolved_reasoning_effort,
                    }
                    continue

                if event_type == "response.output_text.delta":
                    delta = self._value(event, "delta")

                    if delta:
                        if first_delta_ms is None:
                            first_delta_ms = (
                                perf_counter() - openai_started_at
                            ) * 1000
                        if document_types:
                            # Ne jamais diffuser du JSON/HTML de composition
                            # dans le flux visible de la conversation.
                            document_chars += len(str(delta))
                            if document_chars > self.MAX_ARTIFACT_RESPONSE_CHARS:
                                raise ValueError("Réponse documentaire trop volumineuse.")
                            document_fragments.append(str(delta))
                        else:
                            yield {
                                "type": "delta",
                                "content": str(delta),
                                "response_id": response_id,
                                "generation_id": generation_id,
                            }
                    continue

                if event_type == "response.completed":
                    completed_response = self._value(event, "response")
                    response_id = str(
                        self._value(completed_response, "id", "") or ""
                    ) or response_id
                    continue

                if event_type in {
                    "response.failed",
                    "response.incomplete",
                    "error",
                }:
                    response = self._value(event, "response")
                    error = (
                        self._value(event, "error")
                        or self._value(response, "error")
                        or self._value(event, "message")
                    )

                    raise RuntimeError(
                        "Le streaming OpenAI s'est terminé "
                        f"avec l'événement '{event_type}'"
                        + (f" : {error}" if error else ".")
                    )

            if completed_response is None:
                raise RuntimeError(
                    "Le streaming OpenAI s'est terminé sans "
                    "événement response.completed."
                )

            if document_types:
                status = str(self._value(completed_response, "status", "completed") or "")
                if status != "completed":
                    raise RuntimeError("Production documentaire interrompue ou incomplète.")
                document_text = str(
                    self._value(completed_response, "output_text", "") or ""
                ) or "".join(document_fragments)
                artifact_payload = self._parse_artifact_payload(
                    document_text, expected_formats=document_types,
                    allow_fenced_json=web,
                )
                yield {
                    "type": "artifact_payload",
                    "artifact_payload": artifact_payload,
                    "response_id": response_id,
                    "generation_id": generation_id,
                }

            usage = self._extract_usage(completed_response)
            web_search_calls = (
                self._count_web_search_calls(completed_response)
                if web
                else 0
            )
            actual_model = str(
                self._value(completed_response, "model", model) or model
            )

            # Fournit séparément les résultats visuels réellement collectés.
            # Aucun résultat n'est transmis si Recherche Web est désactivée.
            web_images = self._extract_web_images(completed_response) if web else []
            if web_images:
                yield {
                    "type": "web_images",
                    "images": web_images,
                    "generation_id": generation_id,
                    "response_id": response_id,
                }

            yield {
                "type": "usage",
                "usage": usage,
                "web_search_calls": web_search_calls,
                "model": actual_model,
                "response_id": response_id,
                "generation_id": generation_id,
                "transport": "http",
                "reasoning_mode": reasoning_mode,
                "reasoning_effort": resolved_reasoning_effort,
                "timing": {
                    "openai_ttft_ms": first_delta_ms,
                    "openai_total_ms": (
                        perf_counter() - openai_started_at
                    ) * 1000,
                },
            }

        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError(
                "Erreur API OpenAI pendant "
                f"le streaming : {str(error)}"
            ) from error


    async def chat_stream_websocket(
        self,
        model: str,
        message: str,
        web: bool = False,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, Any]] | None = None,
        reasoning_mode: str = "balanced",
        generation_id: str | None = None,
        control_queue: asyncio.Queue[dict[str, Any]] | None = None,
        visual_mode: bool = False,
        artifact_types: str | list[str] | tuple[str, ...] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Streaming Responses WebSocket pilotable pendant la génération.

        Le routeur ai.py fournira une `control_queue` à la génération active.
        Le bouton « Modifier » pourra alors y déposer une commande.

        Règles :
        - nouvelle instruction + GPT-6 => response.steer ;
        - changement de reasoning => event restart_required ;
        - modèle sans steering => event restart_required ;
        - les deltas portent generation_id afin d'éviter tout mélange lors
          d'un redémarrage ;
        - l'usage de toutes les réponses OpenAI d'une chaîne de steering
          est additionné avant d'être renvoyé au routeur Oria.

        Cette méthode nécessite un SDK OpenAI avec Responses WebSocket.
        Tant que le serveur n'est pas mis à niveau, le routeur peut détecter
        `supports_responses_websocket() == False` et utiliser chat_stream().
        """
        if not self.supports_responses_websocket():
            raise RuntimeError(
                "Responses WebSocket n'est pas disponible dans le SDK OpenAI "
                "installé. Installez openai[realtime]==3.27.0 ou utilisez le "
                "fallback HTTP avec smart restart."
            )

        document_types = self._document_types(artifact_types)
        input_data = self._build_input(
            message=message,
            attachments=attachments,
            web=web,
            history=history,
            visual_mode=visual_mode,
            artifact_types=document_types,
        )

        request: dict[str, Any] = {
            "model": model,
            "input": input_data,
            "max_output_tokens": MAX_CHAT_OUTPUT_TOKENS,
            "store": False,
        }
        # Limitation OpenAI Responses : web_search et JSON mode ne peuvent pas
        # être combinés dans une même requête. Conserver l'outil Web et exiger
        # le JSON via les instructions developer lorsque web=True ; le résultat
        # est ensuite validé strictement par _parse_artifact_payload().
        # Sans recherche Web, garder le mode JSON habituel.
        if document_types and not web:
            request["text"] = self._artifact_json_text_format()

        tools = self._build_tools(web)
        if tools:
            request["tools"] = tools
            request["include"] = ["web_search_call.results"]

        resolved_reasoning_effort = self._apply_reasoning_to_request(
            request,
            model=model,
            reasoning_mode=reasoning_mode,
        )

        openai_started_at = perf_counter()
        first_delta_ms: float | None = None
        active_response_id: str | None = None
        initial_response_id: str | None = None
        pending_instruction: str | None = None
        awaiting_successor = False
        final_response = None
        document_fragments: list[str] = []
        document_chars = 0

        # Facturation d'une chaîne de steering.
        #
        # Chaque continuation créée par response.steer est une nouvelle
        # Response OpenAI avec son propre usage. Pour éviter de ne facturer
        # que la dernière continuation, Oria additionne chaque réponse
        # terminale (completed ou incomplete: steered) une seule fois.
        cumulative_usage = {
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "cache_write_tokens": 0,
            "output_tokens": 0,
            "reasoning_tokens": 0,
            "total_tokens": 0,
        }
        cumulative_web_search_calls = 0
        cumulative_web_images: dict[str, dict[str, Any]] = {}
        accounted_response_ids: set[str] = set()
        accounted_response_order: list[str] = []

        def accumulate_terminal_response_usage(response: Any) -> None:
            nonlocal cumulative_web_search_calls

            if response is None:
                return

            response_id = str(
                self._value(response, "id", "") or ""
            )

            # Les événements terminaux ne devraient apparaître qu'une fois,
            # mais ce garde-fou évite toute double facturation si le SDK
            # réémet un terminal après une reconnexion ou une anomalie.
            response_key = response_id or f"object:{id(response)}"

            if response_key in accounted_response_ids:
                return

            usage = self._extract_usage(response)

            for key in cumulative_usage:
                cumulative_usage[key] += self._safe_int(
                    usage.get(key, 0)
                )

            if web:
                cumulative_web_search_calls += (
                    self._count_web_search_calls(response)
                )
                for img in self._extract_web_images(response):
                    if len(cumulative_web_images) < 3:
                        cumulative_web_images.setdefault(img["image_url"], img)

            accounted_response_ids.add(response_key)
            accounted_response_order.append(
                response_id or response_key
            )

        # Les champs réservés au transport HTTP ne doivent pas être envoyés
        # dans response.create WebSocket.
        request.pop("stream", None)
        request.pop("background", None)

        self._enforce_tool_format_compatibility(request)
        connect = self.async_client.responses.connect

        async with connect() as connection:
            await connection.response.create(**request)

            event_iterator = connection.__aiter__()
            event_task: asyncio.Task[Any] | None = asyncio.create_task(
                event_iterator.__anext__()
            )
            control_task: asyncio.Task[Any] | None = (
                asyncio.create_task(control_queue.get())
                if control_queue is not None
                else None
            )

            try:
                while event_task is not None:
                    wait_set = {event_task}
                    if control_task is not None:
                        wait_set.add(control_task)

                    done, _ = await asyncio.wait(
                        wait_set,
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    # -------------------------------------------------
                    # Commande utilisateur pendant la génération
                    # -------------------------------------------------
                    if control_task is not None and control_task in done:
                        raw_command = control_task.result()
                        command = self._normalize_control_command(raw_command)

                        # Préparer immédiatement l'attente de la prochaine
                        # commande sans bloquer la lecture OpenAI.
                        control_task = asyncio.create_task(control_queue.get())

                        if command["type"] == "cancel":
                            yield {
                                "type": "cancel_requested",
                                "generation_id": generation_id,
                                "response_id": active_response_id,
                            }
                            return

                        if command["type"] == "invalid":
                            yield {
                                "type": "control_error",
                                "detail": "Commande de modification invalide.",
                                "generation_id": generation_id,
                                "response_id": active_response_id,
                            }
                            continue

                        requested_reasoning = command["reasoning_mode"]
                        instruction = command["instruction"]

                        reasoning_changed = bool(
                            requested_reasoning
                            and requested_reasoning != reasoning_mode
                        )
                        instruction_changed = bool(instruction)

                        strategy = self.resolve_modification_strategy(
                            model=model,
                            instruction_changed=instruction_changed,
                            reasoning_changed=reasoning_changed,
                        )

                        if strategy == "restart":
                            yield {
                                "type": "restart_required",
                                "generation_id": generation_id,
                                "response_id": active_response_id,
                                "instruction": instruction,
                                "reasoning_mode": (
                                    requested_reasoning or reasoning_mode
                                ),
                                "reason": (
                                    "reasoning_mode_changed"
                                    if reasoning_changed
                                    else "steering_unavailable"
                                ),
                            }
                            continue

                        if strategy == "none":
                            continue

                        # Si response.created n'est pas encore arrivé, conserver
                        # la consigne et l'envoyer dès que l'identifiant existe.
                        if active_response_id is None:
                            pending_instruction = instruction
                            continue

                        await connection.response.steer(
                            previous_response_id=active_response_id,
                            input=instruction,
                        )
                        awaiting_successor = True

                        yield {
                            "type": "steer_sent",
                            "generation_id": generation_id,
                            "response_id": active_response_id,
                            "instruction": instruction,
                        }

                    # -------------------------------------------------
                    # Événement OpenAI
                    # -------------------------------------------------
                    if event_task in done:
                        try:
                            event = event_task.result()
                        except StopAsyncIteration:
                            event_task = None
                            break

                        event_task = asyncio.create_task(
                            event_iterator.__anext__()
                        )
                        event_type = self._value(event, "type", "")

                        if event_type == "response.created":
                            response = self._value(event, "response")
                            new_response_id = str(
                                self._value(response, "id", "") or ""
                            )

                            if not new_response_id:
                                continue

                            if initial_response_id is None:
                                initial_response_id = new_response_id
                            elif new_response_id != active_response_id:
                                # Le successor créé après response.steer est
                                # le point où la modification est réellement
                                # engagée côté OpenAI.
                                awaiting_successor = False

                            if document_types and active_response_id != new_response_id:
                                # Un steering repart sur une réponse fraîche :
                                # seule la dernière composition est publiable.
                                document_fragments.clear()
                                document_chars = 0
                            active_response_id = new_response_id

                            yield {
                                "type": "response_meta",
                                "transport": "websocket",
                                "response_id": active_response_id,
                                "initial_response_id": initial_response_id,
                                "generation_id": generation_id,
                                "reasoning_mode": reasoning_mode,
                                "reasoning_effort": resolved_reasoning_effort,
                            }

                            if pending_instruction:
                                instruction = pending_instruction
                                pending_instruction = None

                                await connection.response.steer(
                                    previous_response_id=active_response_id,
                                    input=instruction,
                                )
                                awaiting_successor = True

                                yield {
                                    "type": "steer_sent",
                                    "generation_id": generation_id,
                                    "response_id": active_response_id,
                                    "instruction": instruction,
                                }
                            continue

                        if event_type == "response.output_text.delta":
                            delta = self._value(event, "delta")
                            if delta:
                                if first_delta_ms is None:
                                    first_delta_ms = (
                                        perf_counter() - openai_started_at
                                    ) * 1000
                                if document_types:
                                    document_chars += len(str(delta))
                                    if document_chars > self.MAX_ARTIFACT_RESPONSE_CHARS:
                                        raise ValueError("Réponse documentaire trop volumineuse.")
                                    document_fragments.append(str(delta))
                                else:
                                    yield {
                                        "type": "delta",
                                        "content": str(delta),
                                        "response_id": active_response_id,
                                        "generation_id": generation_id,
                                    }
                            continue

                        if event_type == "response.steer.accepted":
                            yield {
                                "type": "steer_accepted",
                                "generation_id": generation_id,
                                "response_id": active_response_id,
                            }
                            continue

                        if event_type == "response.steer.failed":
                            error = self._value(event, "error")
                            steer = self._value(event, "steer")
                            failed_input = self._value(steer, "input", "")

                            yield {
                                "type": "restart_required",
                                "generation_id": generation_id,
                                "response_id": active_response_id,
                                "instruction": str(failed_input or ""),
                                "reasoning_mode": reasoning_mode,
                                "reason": "steering_failed",
                                "detail": str(error or ""),
                            }
                            continue

                        if event_type == "response.incomplete":
                            response = self._value(event, "response")
                            details = self._value(
                                response,
                                "incomplete_details",
                            )
                            reason = self._value(details, "reason", "")

                            if reason == "steered":
                                # La réponse interrompue a déjà consommé des
                                # tokens. Son usage doit donc être compté avant
                                # d'attendre la continuation automatique.
                                accumulate_terminal_response_usage(response)

                                yield {
                                    "type": "steer_boundary",
                                    "generation_id": generation_id,
                                    "response_id": str(
                                        self._value(response, "id", "")
                                        or active_response_id
                                        or ""
                                    ),
                                    "usage_responses": len(
                                        accounted_response_order
                                    ),
                                }
                                continue

                            raise RuntimeError(
                                "Le streaming WebSocket OpenAI s'est terminé "
                                f"incomplet : {reason or 'raison inconnue'}."
                            )

                        if event_type in {"response.failed", "error"}:
                            response = self._value(event, "response")
                            error = (
                                self._value(event, "error")
                                or self._value(response, "error")
                                or self._value(event, "message")
                            )
                            raise RuntimeError(
                                "Le streaming WebSocket OpenAI a échoué"
                                + (f" : {error}" if error else ".")
                            )

                        if event_type == "response.completed":
                            response = self._value(event, "response")
                            completed_id = str(
                                self._value(response, "id", "") or ""
                            )

                            # Une réponse terminée est facturable même si un
                            # steering accepté doit encore produire un successor.
                            accumulate_terminal_response_usage(response)

                            # Une réponse peut terminer normalement alors qu'un
                            # steer accepté attend encore son successor.
                            if awaiting_successor:
                                continue

                            if (
                                active_response_id
                                and completed_id
                                and completed_id != active_response_id
                            ):
                                continue

                            final_response = response
                            break

                if final_response is None:
                    raise RuntimeError(
                        "La connexion Responses WebSocket s'est terminée "
                        "sans réponse finale exploitable."
                    )

                # Le terminal final vient normalement d'être comptabilisé
                # dans response.completed. Ce garde-fou rend l'agrégation
                # robuste si le flux change légèrement côté SDK.
                accumulate_terminal_response_usage(final_response)

                actual_model = str(
                    self._value(final_response, "model", model) or model
                )

                if document_types:
                    status = str(self._value(final_response, "status", "completed") or "")
                    if status != "completed":
                        raise RuntimeError("Production documentaire interrompue ou incomplète.")
                    document_text = str(
                        self._value(final_response, "output_text", "") or ""
                    ) or "".join(document_fragments)
                    artifact_payload = self._parse_artifact_payload(
                        document_text, expected_formats=document_types,
                        allow_fenced_json=web,
                    )
                    yield {
                        "type": "artifact_payload",
                        "artifact_payload": artifact_payload,
                        "response_id": active_response_id,
                        "generation_id": generation_id,
                    }

                if cumulative_web_images:
                    yield {
                        "type": "web_images",
                        "images": list(cumulative_web_images.values()),
                        "generation_id": generation_id,
                        "response_id": active_response_id,
                    }

                yield {
                    "type": "usage",
                    "usage": dict(cumulative_usage),
                    "web_search_calls": cumulative_web_search_calls,
                    "model": actual_model,
                    "response_id": active_response_id,
                    "initial_response_id": initial_response_id,
                    "response_ids": list(accounted_response_order),
                    "usage_responses": len(accounted_response_order),
                    "generation_id": generation_id,
                    "transport": "websocket",
                    "reasoning_mode": reasoning_mode,
                    "reasoning_effort": resolved_reasoning_effort,
                    "timing": {
                        "openai_ttft_ms": first_delta_ms,
                        "openai_total_ms": (
                            perf_counter() - openai_started_at
                        ) * 1000,
                    },
                }

            finally:
                for task in (event_task, control_task):
                    if task is not None and not task.done():
                        task.cancel()







    # ========================================================
    # ORIA COURS — UN SEGMENT À LA FOIS, SANS FACTURATION ICI
    # ========================================================
    # Un cours de quatre heures est segmenté par le service Cours.
    # OpenAIService ne doit ni envoyer les 4 h en une fois, ni toucher
    # au wallet, ni décider quel modèle public est autorisé par le pack.
    MAX_COURSE_SECTION_CHARS = 60_000
    MAX_COURSE_CONTEXT_CHARS = 8_000

    def transcribe_course_segment(
        self,
        *,
        data: bytes,
        filename: str,
        mime_type: str,
    ) -> dict[str, Any]:
        """Transcrit un segment avec le modèle INTERNE et fixe d'ORIA Cours.

        Les contrôles de durée cumulée (<= 4 h), le découpage, la
        réservation des crédits ORIA, le stockage et la reprise des segments
        relèvent du service Cours appelant. Ne jamais exposer le nom du
        modèle interne dans la réponse publique de l'endpoint.
        """
        result = self.transcribe_audio(
            data=data,
            filename=filename,
            mime_type=mime_type,
            model="gpt-4o-mini-transcribe",
        )
        return {
            "text": result["text"],
            "usage": result.get("usage"),
        }

    # Validation précoce d'une section Code-First. La sanitation définitive
    # et le rendu restent exclusivement confiés à ArtifactService.
    @staticmethod
    def _validate_course_html_fragment(source: str) -> str:
        """Valide un fragment de cours avant son assemblage documentaire.

        Rejette les balises non autorisées, les attributs actifs, les sections
        incomplètes et les notations Markdown/LaTeX qui apparaîtraient telles
        quelles à l'impression. Ne modifie jamais une formule silencieusement.
        """
        if not isinstance(source, str) or not source.strip():
            raise ValueError("Section Code-First vide.")
        if len(source) > 250_000:
            raise ValueError("Section Code-First trop volumineuse.")
        html = source.strip()
        if html.startswith("```") or html.endswith("```"):
            raise ValueError("Le fragment doit être du HTML sans bloc Markdown.")

        allowed = frozenset({
            "section", "h2", "h3", "h4", "p", "strong", "em",
            "sup", "sub", "ul", "ol", "li", "table", "thead", "tbody",
            "tr", "th", "td", "blockquote", "div", "span", "br",
        })
        semantic_classes = frozenset({
            "oria-course-section", "oria-course-definition",
            "oria-course-example", "oria-course-exercise",
            "oria-course-equation", "oria-course-complement",
            "oria-course-warning",
        })

        class SectionParser(HTMLParser):
            def __init__(self) -> None:
                super().__init__(convert_charrefs=True)
                self.stack: list[str] = []
                self.roots = 0
                self.nodes = 0
                self.visible: list[str] = []

            def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
                if tag not in allowed:
                    raise ValueError("Balise HTML non autorisée dans ORIA Cours.")
                self.nodes += 1
                if self.nodes > 6000:
                    raise ValueError("Section Code-First trop complexe.")
                if not self.stack:
                    if self.roots or tag != "section":
                        raise ValueError("Une seule racine section est requise.")
                    self.roots += 1
                elif tag == "section":
                    raise ValueError("Sections HTML imbriquées interdites.")
                if tag == "br":
                    if attrs:
                        raise ValueError("Attribut non autorisé sur br.")
                    return
                classes = []
                for name, value in attrs:
                    if name == "class" and isinstance(value, str):
                        classes = value.split()
                        if not classes or any(cls not in semantic_classes for cls in classes):
                            raise ValueError("Classe HTML non autorisée.")
                    elif name in {"colspan", "rowspan"} and tag in {"td", "th"}:
                        if not isinstance(value, str) or not value.isdigit() or not 1 <= int(value) <= 20:
                            raise ValueError("Dimension de cellule HTML invalide.")
                    else:
                        raise ValueError("Attribut HTML non autorisé dans ORIA Cours.")
                if self.roots == 1 and not self.stack and classes != ["oria-course-section"]:
                    raise ValueError("La racine doit avoir la classe oria-course-section.")
                self.stack.append(tag)

            def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
                if tag != "br":
                    raise ValueError("Balise autofermante non autorisée.")
                self.handle_starttag(tag, attrs)

            def handle_endtag(self, tag: str) -> None:
                if not self.stack or self.stack[-1] != tag:
                    raise ValueError("Balises HTML mal imbriquées ou non fermées.")
                self.stack.pop()

            def handle_data(self, data: str) -> None:
                if not self.stack and data.strip():
                    raise ValueError("Texte hors de la section HTML.")
                if self.stack:
                    self.visible.append(data)

            def handle_comment(self, data: str) -> None:
                raise ValueError("Commentaires HTML non autorisés.")

            def handle_decl(self, decl: str) -> None:
                raise ValueError("Document HTML complet non autorisé pour une section.")

            def unknown_decl(self, data: str) -> None:
                raise ValueError("Déclaration HTML interdite.")

            def handle_pi(self, data: str) -> None:
                raise ValueError("Instruction de traitement HTML interdite.")

        parser = SectionParser()
        try:
            parser.feed(html)
            parser.close()
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Fragment HTML de cours non analysable.") from exc
        if parser.stack or parser.roots != 1:
            raise ValueError("Section HTML incomplète.")
        visible = " ".join(parser.visible)
        if not visible.strip():
            raise ValueError("Section sans contenu pédagogique visible.")

        # Détecter les marqueurs que WeasyPrint et python-docx ne composeraient
        # pas automatiquement. Seul le contenu textuel visible est inspecté ;
        # les vraies balises de composition restent autorisées.
        raw_math = re.compile(
            r"\\(?:d?frac|sqrt|text|sum|prod|int|lim|overline|underline|"
            r"alpha|beta|gamma|delta|theta|pi|sigma|lambda|cdot|times|"
            r"left|right|begin|end|mathrm|operatorname|vec|partial)\b"
            r"|\\[\[\]()]|(?<!\$)\$\$|\$[^\$\n]+\$"
        )
        if raw_math.search(visible):
            raise ValueError("Formule LaTeX non composée dans le cours.")
        if ("```" in visible or re.search(r"(?m)^\s*#{1,6}\s+", visible)
                or re.search(r"\*\*[^*\n]+\*\*", visible)):
            raise ValueError("Balisage Markdown brut dans le cours.")
        return html

    def compose_course_section(
        self,
        *,
        model: str,
        transcript: str,
        section_index: int,
        total_sections: int,
        previous_context: str = "",
        reasoning_mode: str = "balanced",
        output_format: str = "markdown",
    ) -> dict[str, Any]:
        """Rédige UNE section pédagogique à partir d'une transcription.

        `model` est conservé pour compatibilité avec les appels existants,
        mais seul GPT-6 Luna est autorisé pour ORIA Cours, quel que soit
        le pack. Cela n'autorise PAS Luna dans le Chat général.
        La section source est plafonnée : le pipeline de quatre heures
        fournit plusieurs sections puis assemble le PDF/DOCX ailleurs.
        L'usage token réel est renvoyé pour règlement par le service Cours.
        """
        # Opt-in : l'orchestrateur Cours choisit explicitement html_fragment
        # lors de la migration. L'ancien contrat Markdown reste disponible.
        if output_format not in {"markdown", "html_fragment"}:
            raise ValueError("Format de rédaction ORIA Cours non pris en charge.")
        if not isinstance(model, str) or model.strip().lower() != "gpt-6-luna":
            raise ValueError("ORIA Cours utilise exclusivement GPT-6 Luna.")
        course_model = "gpt-6-luna"
        if not isinstance(transcript, str) or not transcript.strip():
            raise ValueError("Transcription de section vide.")
        if len(transcript) > self.MAX_COURSE_SECTION_CHARS:
            raise ValueError(
                "Section de transcription trop longue : découper le cours avant l'appel IA."
            )
        if (type(section_index) is not int or type(total_sections) is not int
                or not 1 <= section_index <= total_sections <= 500):
            raise ValueError("Numérotation des sections de cours invalide.")
        if (not isinstance(previous_context, str)
                or len(previous_context) > self.MAX_COURSE_CONTEXT_CHARS):
            raise ValueError("Contexte précédent trop long pour cette section.")

        request: dict[str, Any] = {
            "model": course_model,
            "store": False,
            "max_output_tokens": COURSE_MAX_OUTPUT_TOKENS,
            "input": build_course_section_messages(
                transcript=transcript,
                section_index=section_index,
                total_sections=total_sections,
                previous_context=previous_context,
                output_format=output_format,
            ),
        }
        self._apply_reasoning_to_request(
            request, model=course_model, reasoning_mode=reasoning_mode,
        )
        try:
            response = self.client.responses.create(**request)
        except Exception as error:
            raise RuntimeError("Échec de la rédaction de la section de cours.") from error

        # Même une réponse partielle peut avoir consommé des tokens :
        # renvoyer l'usage et le statut sans la déclarer complète.
        usage = self._extract_usage(response)
        status = str(self._value(response, "status", "completed") or "")
        message = str(self._value(response, "output_text", "") or "").strip()
        details = self._value(response, "incomplete_details")
        reason = self._value(details, "reason") if details is not None else None
        complete = status == "completed" and bool(message)
        html_fragment = ""
        validation_error = None
        if output_format == "html_fragment":
            if complete:
                try:
                    html_fragment = self._validate_course_html_fragment(message)
                except ValueError as exc:
                    complete = False
                    reason = "invalid_course_html_fragment"
                    validation_error = str(exc)
            # Le code de composition n'est pas un texte conversationnel.
            message = ""
        result = {
            "message": message,
            "usage": usage,
            "web_search_calls": 0,
            "model": course_model,
            "openai_model": str(self._value(response, "model", course_model) or course_model),
            "complete": complete,
            "status": status,
            "incomplete_reason": str(reason) if reason is not None else None,
            "section_index": section_index,
            "total_sections": total_sections,
        }
        if output_format == "html_fragment":
            result["output_format"] = "html_fragment"
            result["html_fragment"] = html_fragment
            if validation_error is not None:
                result["validation_error"] = validation_error
        return result

    @classmethod
    def _optional_transcription_usage(cls, transcript: Any) -> dict[str, Any] | None:
        """Récupère seulement l'usage déclaré par le fournisseur, sans estimation.

        L'API peut renvoyer une facturation par durée (`seconds`) ou
        par tokens. Si elle ne donne rien, le suivi de durée validée
        (ffprobe) et les tarifs du service audio restent nécessaires.
        """
        usage = cls._value(transcript, "usage")
        if usage is None:
            return None
        normalized: dict[str, Any] = {}
        usage_type = cls._value(usage, "type")
        if usage_type is not None:
            normalized["type"] = str(usage_type)
        for field in ("input_tokens", "output_tokens", "total_tokens"):
            number = cls._value(usage, field)
            if number is not None:
                if isinstance(number, bool) or isinstance(number, float) and not number.is_integer():
                    continue
                try:
                    candidate = int(number)
                except (ValueError, TypeError, OverflowError):
                    continue
                if candidate >= 0:
                    normalized[field] = candidate
        seconds = cls._value(usage, "seconds")
        if seconds is not None:
            from math import isfinite
            try:
                seconds_value = float(seconds)
            except (ValueError, TypeError, OverflowError):
                seconds_value = -1.0
            if isfinite(seconds_value) and seconds_value >= 0:
                normalized["seconds"] = seconds_value
        return normalized or None

    # ========================================================
    # AUDIO — CONVERSION DE NOTE VOCALE EN TEXTE
    # ========================================================

    def transcribe_audio(
        self,
        *,
        data: bytes,
        filename: str,
        mime_type: str,
        model: str = "gpt-4o-mini-transcribe",
    ) -> dict[str, Any]:
        """Transcrit un enregistrement déjà validé et payé par audio_service.

        Ne sauvegarde pas l'audio et ne débite aucun crédit ; ces responsabilités
        appartiennent au service audio du backend, avant cet appel payant.
        """
        from pathlib import PurePath

        allowed_models = {"gpt-4o-mini-transcribe", "gpt-4o-transcribe", "gpt-transcribe", "whisper-1"}
        allowed_mime_types = {
            "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp3",
            "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav",
            "audio/x-wav", "audio/flac",
        }
        if model not in allowed_models:
            raise ValueError("Modèle de transcription non autorisé.")
        mime = (mime_type or "").split(";", 1)[0].strip().lower()
        if mime not in allowed_mime_types:
            raise ValueError("Format audio non directement accepté pour la transcription.")
        if not data or len(data) > 20 * 1024 * 1024:
            raise ValueError("Enregistrement vide ou supérieur à 20 Mo.")

        safe_name = PurePath(str(filename or "audio").replace("\\", "/")).name
        accepted_extensions = {".webm", ".ogg", ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".mpeg", ".mpga"}
        extension = "." + safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
        if extension not in accepted_extensions:
            suffix = {
                "audio/webm": ".webm", "audio/ogg": ".ogg",
                "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
                "audio/mp4": ".mp4", "audio/x-m4a": ".m4a",
                "audio/m4a": ".m4a", "audio/wav": ".wav",
                "audio/x-wav": ".wav", "audio/flac": ".flac",
            }[mime]
            safe_name = "note-oria" + suffix

        try:
            transcript = self.client.audio.transcriptions.create(
                model=model,
                file=(safe_name, data, mime),
                response_format="json",
            )
        except Exception as error:
            raise RuntimeError("Échec de la transcription OpenAI.") from error

        text = str(self._value(transcript, "text", "") or "").strip()
        if not text:
            raise RuntimeError("OpenAI n'a retourné aucun texte transcrit.")
        return {
            "text": text,
            "model": model,
            # Pas de tarif estimé déguisé en consommation réelle.
            "usage": self._optional_transcription_usage(transcript),
        }

    # ========================================================



    # HELPERS — MÉDIAS



    # ========================================================







    @staticmethod



    def _normalize_credit_action(



        action: str | CreditAction,



    ) -> CreditAction:



        if isinstance(action, CreditAction):



            return action







        try:



            return CreditAction(str(action))



        except ValueError as error:



            raise ValueError(



                f"Action média Oria inconnue : {action}"



            ) from error







    @classmethod



    def _resolve_image_execution_config(



        cls,



        *,



        action: str | CreditAction,



        pack_id: str | None,



    ) -> dict[str, Any]:



        credit_action = cls._normalize_credit_action(action)







        quality = IMAGE_ACTION_QUALITY.get(credit_action)



        size = cls.IMAGE_SIZE_BY_ACTION.get(credit_action)







        if quality is None or size is None:



            raise ValueError(



                f"Action image non supportée : {credit_action.value}"



            )







        resolved_pack_id = (



            str(pack_id)



            if pack_id



            else cls.LEGACY_IMAGE_PACK_BY_ACTION.get(credit_action)



        )







        if not resolved_pack_id:



            raise ValueError(



                "Impossible de déterminer le pack pour cette génération image."



            )







        model = IMAGE_MODEL_BY_PACK.get(resolved_pack_id)







        if not model:



            raise ValueError(



                "Aucun modèle image n'est configuré pour "



                f"le pack '{resolved_pack_id}'."



            )







        return {



            "action": credit_action,



            "pack_id": resolved_pack_id,



            "model": str(model),



            "quality": str(quality),



            "size": str(size),



        }







    @classmethod



    def _extract_image_usage(



        cls,



        response: Any,



    ) -> dict[str, int | bool]:



        usage = cls._value(response, "usage")







        if usage is None:



            return {



                "input_tokens": 0,



                "text_input_tokens": 0,



                "image_input_tokens": 0,



                "cached_input_tokens": 0,



                "cached_text_input_tokens": 0,



                "cached_image_input_tokens": 0,



                "output_tokens": 0,



                "image_output_tokens": 0,



                "total_tokens": 0,



                "usage_available": False,



            }







        input_details = cls._value(



            usage,



            "input_tokens_details",



        )



        output_details = cls._value(



            usage,



            "output_tokens_details",



        )







        input_tokens = cls._safe_int(



            cls._value(usage, "input_tokens", 0)



        )



        output_tokens = cls._safe_int(



            cls._value(usage, "output_tokens", 0)



        )



        total_tokens = cls._safe_int(



            cls._value(usage, "total_tokens", 0)



        )







        text_input_tokens = cls._safe_int(



            cls._value(input_details, "text_tokens", 0)



        )



        image_input_tokens = cls._safe_int(



            cls._value(input_details, "image_tokens", 0)



        )







        cached_input_tokens = cls._safe_int(



            cls._value(input_details, "cached_tokens", 0)



        )



        cached_text_input_tokens = cls._safe_int(



            cls._value(input_details, "cached_text_tokens", 0)



        )



        cached_image_input_tokens = cls._safe_int(



            cls._value(input_details, "cached_image_tokens", 0)



        )







        image_output_tokens = cls._safe_int(



            cls._value(output_details, "image_tokens", 0)



        )







        if image_output_tokens == 0:



            image_output_tokens = output_tokens







        if total_tokens == 0:



            total_tokens = input_tokens + output_tokens







        return {



            "input_tokens": input_tokens,



            "text_input_tokens": text_input_tokens,



            "image_input_tokens": image_input_tokens,



            "cached_input_tokens": cached_input_tokens,



            "cached_text_input_tokens": cached_text_input_tokens,



            "cached_image_input_tokens": cached_image_input_tokens,



            "output_tokens": output_tokens,



            "image_output_tokens": image_output_tokens,



            "total_tokens": total_tokens,



            "usage_available": True,



        }







    @classmethod



    def _resolve_video_execution_config(



        cls,



        *,



        action: str | CreditAction,



        pack_id: str | None,



    ) -> dict[str, Any]:



        credit_action = cls._normalize_credit_action(action)







        if credit_action not in VIDEO_ACTION_DURATION_SECONDS:



            raise ValueError(



                f"Action vidéo non supportée : {credit_action.value}"



            )







        resolved_pack_id = (



            str(pack_id)



            if pack_id



            else cls.LEGACY_VIDEO_PACK_BY_ACTION.get(credit_action)



        )







        if not resolved_pack_id:



            raise ValueError(



                "Impossible de déterminer le pack pour cette génération vidéo."



            )







        provider = VIDEO_PROVIDER_BY_PACK.get(resolved_pack_id)



        model = VIDEO_MODEL_BY_PACK.get(resolved_pack_id)







        if not provider or not model:



            raise RuntimeError(



                "Aucun fournisseur vidéo actif n'est actuellement "



                f"configuré pour le pack '{resolved_pack_id}'."



            )







        size = cls.VIDEO_SIZE_BY_ACTION.get(credit_action)



        seconds = VIDEO_ACTION_DURATION_SECONDS.get(credit_action)







        if not size:



            raise ValueError(



                f"Aucune taille vidéo configurée pour {credit_action.value}."



            )







        if seconds is None:



            raise ValueError(



                f"Aucune durée vidéo configurée pour {credit_action.value}."



            )







        return {



            "action": credit_action,



            "pack_id": resolved_pack_id,



            "provider": str(provider),



            "model": str(model),



            "seconds": int(seconds),



            "size": str(size),



        }







    # ========================================================







    # GÉNÉRATION D'IMAGE







    # ========================================================







    def generate_image(



        self,



        action: str,



        prompt: str,



        pack_id: str | None = None,



        *,



        output_format: str = "png",



        n: int = 1,



    ) -> dict[str, Any]:



        """



        Génère une image via l'Image API OpenAI.







        Modèle : déterminé par le pack.



        Qualité : déterminée par l'action Oria.



        Facturation : calculée ailleurs par MediaBillingService.



        """



        config = self._resolve_image_execution_config(



            action=action,



            pack_id=pack_id,



        )







        prompt = prompt.strip()







        if not prompt:



            raise ValueError(



                "Le prompt de génération d'image est requis."



            )







        if n < 1 or n > 10:



            raise ValueError(



                "Le nombre d'images doit être compris entre 1 et 10."



            )







        try:



            response = self.client.images.generate(



                model=config["model"],



                prompt=prompt,



                quality=config["quality"],



                size=config["size"],



                output_format=output_format,



                n=n,



            )



        except Exception as error:



            raise RuntimeError(



                f"Erreur API OpenAI Images : {str(error)}"



            ) from error







        response_data = self._value(response, "data", []) or []







        if not response_data:



            raise RuntimeError(



                "OpenAI n'a retourné aucune image."



            )







        images: list[dict[str, Any]] = []







        for image in response_data:



            b64_json = self._value(image, "b64_json")



            url = self._value(image, "url")







            if not b64_json and not url:



                continue







            images.append(



                {



                    "b64_json": b64_json,



                    "url": url,



                    "revised_prompt": self._value(



                        image,



                        "revised_prompt",



                    ),



                }



            )







        if not images:



            raise RuntimeError(



                "OpenAI n'a retourné aucune donnée image exploitable."



            )







        usage = self._extract_image_usage(response)







        actual_quality = str(



            self._value(response, "quality", config["quality"])



            or config["quality"]



        )



        actual_size = str(



            self._value(response, "size", config["size"])



            or config["size"]



        )



        actual_output_format = str(



            self._value(response, "output_format", output_format)



            or output_format



        )







        mime_type = {



            "png": "image/png",



            "jpeg": "image/jpeg",



            "jpg": "image/jpeg",



            "webp": "image/webp",



        }.get(actual_output_format.lower(), "image/png")







        first_image = images[0]







        return {



            "success": True,



            "provider": "openai",



            "media_type": "image",



            "action": config["action"].value,



            "pack_id": config["pack_id"],



            "model": config["model"],



            "quality": actual_quality,



            "size": actual_size,



            "output_format": actual_output_format,



            "mime_type": mime_type,



            "count": len(images),



            "images": images,



            "usage": usage,







            # Compatibilité temporaire avec les anciens appelants.



            "b64_json": first_image.get("b64_json"),



            "url": first_image.get("url"),



            "revised_prompt": first_image.get("revised_prompt"),



        }







    # ========================================================







    # GÉNÉRATION VIDÉO







    # ========================================================







    def generate_video(



        self,



        action: str,



        prompt: str,



        pack_id: str | None = None,



        poll_interval_ms: int | None = None,



    ) -> dict[str, Any]:



        """



        Génère une vidéo via l'API vidéo OpenAI.



        Le provider, le modèle, la durée et les règles économiques restent

        centralisés dans credit_costs.py / MediaBillingService.



        OpenAIService exécute uniquement la génération et retourne les

        données nécessaires à la persistance et à la facturation.



        """



        prompt = prompt.strip()



        if not prompt:



            raise ValueError(



                "Le prompt de génération vidéo est requis."



            )



        config = self._resolve_video_execution_config(



            action=action,



            pack_id=pack_id,



        )



        if config["provider"].lower() != "openai":



            raise RuntimeError(



                "Le fournisseur vidéo configuré n'est pas OpenAI. "



                "La génération doit être déléguée au service "



                f"'{config['provider']}'."



            )



        videos = getattr(self.client, "videos", None)



        if videos is None:



            raise RuntimeError(



                "Le SDK OpenAI installé n'expose pas l'API vidéo."



            )



        interval_ms = max(250, int(poll_interval_ms or 1000))



        try:



            create_and_poll = getattr(videos, "create_and_poll", None)



            if callable(create_and_poll):



                video = create_and_poll(



                    model=config["model"],



                    prompt=prompt,



                    seconds=config["seconds"],



                    size=config["size"],



                    poll_interval_ms=interval_ms,



                )



            else:



                import time



                video = videos.create(



                    model=config["model"],



                    prompt=prompt,



                    seconds=config["seconds"],



                    size=config["size"],



                )



                video_id = str(self._value(video, "id", "") or "")



                if not video_id:



                    raise RuntimeError(



                        "OpenAI n'a retourné aucun identifiant vidéo."



                    )



                while True:



                    status = str(self._value(video, "status", "") or "").lower()



                    if status in {"completed", "succeeded"}:



                        break



                    if status in {"failed", "cancelled", "canceled", "expired"}:



                        error = self._value(video, "error")



                        raise RuntimeError(



                            "La génération vidéo OpenAI a échoué"



                            + (f" : {error}" if error else ".")



                        )



                    time.sleep(interval_ms / 1000)



                    video = videos.retrieve(video_id)



            video_id = str(self._value(video, "id", "") or "")



            status = str(self._value(video, "status", "") or "").lower()



            if status and status not in {"completed", "succeeded"}:



                error = self._value(video, "error")



                raise RuntimeError(



                    f"La génération vidéo OpenAI s'est terminée avec le statut '{status}'"



                    + (f" : {error}" if error else ".")



                )



            if not video_id:



                raise RuntimeError(



                    "OpenAI n'a retourné aucun identifiant vidéo."



                )



            download_content = getattr(videos, "download_content", None)



            if not callable(download_content):



                raise RuntimeError(



                    "Le SDK OpenAI installé ne permet pas de télécharger la vidéo générée."



                )



            content = download_content(video_id)



            video_bytes = getattr(content, "content", None)



            if video_bytes is None:



                read = getattr(content, "read", None)



                if callable(read):



                    video_bytes = read()



            if not video_bytes:



                raise RuntimeError(



                    "OpenAI n'a retourné aucun contenu vidéo exploitable."



                )



        except RuntimeError:



            raise



        except Exception as error:



            raise RuntimeError(



                f"Erreur API OpenAI Videos : {str(error)}"



            ) from error



        # Le coût vidéo est calculé par la route avec la durée/la résolution
        # finales lorsque le fournisseur les fournit. Ce n'est PAS un montant
        # de facture garanti renvoyé par l'API vidéo.
        actual_seconds = self._safe_int(self._value(video, "seconds"))
        actual_size = str(self._value(video, "size", "") or "").strip()
        actual_model = str(self._value(video, "model", "") or "").strip()
        return {



            "success": True,



            "provider": "openai",



            "media_type": "video",



            "action": config["action"].value,



            "pack_id": config["pack_id"],



            "model": actual_model or config["model"],



            "video_id": video_id,



            "seconds": actual_seconds or config["seconds"],



            "size": actual_size or config["size"],



            "mime_type": "video/mp4",



            "data": video_bytes,



        }


