from collections.abc import Iterator
from typing import Any

from openai import OpenAI

from app.config.openai import OPENAI_API_KEY
from app.services.prompt_service import build_output_prompt


class OpenAIService:
    """Service central de communication avec OpenAI."""

    MAX_ATTACHMENTS = 3
    MAX_HISTORY_MESSAGES = 40

    # ========================================================
    # MODÈLES DE CRÉATION — IMAGES
    # ========================================================

    IMAGE_GENERATION_CONFIG: dict[str, dict[str, Any]] = {
        # Pack léger
        "image_480": {
            "model": "gpt-image-1-mini",
            "quality": "low",
            "size": "1024x1024",
        },
        "image_720": {
            "model": "gpt-image-1-mini",
            "quality": "medium",
            "size": "1024x1024",
        },

        # Pack Pro
        "image_pro": {
            "model": "gpt-image-1.5",
            "quality": "low",
            "size": "1024x1024",
        },
        "image_pro_standard": {
            "model": "gpt-image-1.5",
            "quality": "medium",
            "size": "1024x1024",
        },
        "image_pro_ultra": {
            "model": "gpt-image-1.5",
            "quality": "high",
            "size": "1024x1536",
        },

        # Pack Business
        "image_business": {
            "model": "gpt-image-2",
            "quality": "low",
            "size": "1024x1024",
        },
        "image_business_hd": {
            "model": "gpt-image-2",
            "quality": "medium",
            "size": "1536x1024",
        },
        "image_business_ultra": {
            "model": "gpt-image-2",
            "quality": "high",
            "size": "1536x1024",
        },
    }

    # ========================================================
    # MODÈLES DE CRÉATION — VIDÉOS
    # ========================================================

    VIDEO_GENERATION_CONFIG: dict[str, dict[str, Any]] = {
        # Pack léger
        "video_4s": {
            "model": "sora-2",
            "seconds": "4",
            "size": "1280x720",
        },
        "video_8s": {
            "model": "sora-2",
            "seconds": "8",
            "size": "1280x720",
        },

        # Pack intermédiaire
        "video_lite": {
            "model": "sora-2",
            "seconds": "12",
            "size": "1280x720",
        },

        # Pack Pro
        "video_pro_fast": {
            "model": "sora-2-pro",
            "seconds": "4",
            "size": "1280x720",
        },
        "video_pro_standard": {
            "model": "sora-2-pro",
            "seconds": "8",
            "size": "1280x720",
        },
        "video_pro_extension": {
            "model": "sora-2-pro",
            "seconds": "4",
            "size": "1792x1024",
        },

        # Pack Business
        "video_business_fast": {
            "model": "sora-2-pro",
            "seconds": "4",
            "size": "1792x1024",
        },
        "video_business_standard": {
            "model": "sora-2-pro",
            "seconds": "8",
            "size": "1792x1024",
        },
        "video_business_long": {
            "model": "sora-2-pro",
            "seconds": "12",
            "size": "1792x1024",
        },
    }

    def __init__(self):
        self.client = OpenAI(
            api_key=OPENAI_API_KEY,
        )

    # ========================================================
    # CONSTRUCTION DU CONTENU MULTIMODAL
    # ========================================================

    def _build_input(
        self,
        message: str,
        attachments: list[dict[str, Any]] | None = None,
        web: bool = False,
        history: list[dict[str, Any]] | None = None,
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
        # Limite de contexte pour conserver la mémoire conversationnelle
        # tout en maîtrisant la latence et le coût des requêtes.
        history = history[-self.MAX_HISTORY_MESSAGES:]

        if len(attachments) > self.MAX_ATTACHMENTS:
            raise ValueError(
                "Maximum 3 images ou fichiers par message."
            )

        input_data: list[dict[str, Any]] = []

        # ====================================================
        # HISTORIQUE
        # ====================================================

        for item in history:
            role = item.get("role")
            content = item.get("content")

            if role not in {"user", "assistant", "system", "developer"}:
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
        # PROMPT LBV-CONNECT
        # ====================================================

        formatted_message = build_output_prompt(
            message=message,
            web=web,
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
    # OUTILS
    # ========================================================

    @staticmethod
    def _build_tools(
        web: bool,
    ) -> list[dict[str, str]]:
        """Construit les outils OpenAI utilisés par la requête."""

        if not web:
            return []

        return [
            {
                "type": "web_search",
            }
        ]

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
    ) -> str:
        """Mode classique texte + multimodal + recherche Web."""

        input_data = self._build_input(
            message=message,
            attachments=attachments,
            web=web,
            history=history,
        )

        request: dict[str, Any] = {
            "model": model,
            "input": input_data,
        }

        tools = self._build_tools(web)

        if tools:
            request["tools"] = tools

        response = self.client.responses.create(
            **request,
        )

        return response.output_text

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
    ) -> Iterator[str]:
        """
        Streaming texte + images + fichiers + Web.

        Les fragments response.output_text.delta sont transmis
        immédiatement au routeur SSE.
        """

        input_data = self._build_input(
            message=message,
            attachments=attachments,
            web=web,
            history=history,
        )

        request: dict[str, Any] = {
            "model": model,
            "input": input_data,
            "stream": True,
        }

        tools = self._build_tools(web)

        if tools:
            request["tools"] = tools

        stream = self.client.responses.create(
            **request,
        )

        for event in stream:
            event_type = getattr(
                event,
                "type",
                "",
            )

            if event_type == "response.output_text.delta":
                delta = getattr(
                    event,
                    "delta",
                    None,
                )

                if delta:
                    yield delta

    # ========================================================
    # GÉNÉRATION D'IMAGE
    # ========================================================

    def generate_image(
        self,
        action: str,
        prompt: str,
    ) -> dict[str, Any]:
        """
        Génère réellement une image via l'API Images OpenAI.

        `action` correspond à une CreditAction image, par exemple
        `image_480`, `image_pro_standard` ou `image_business_ultra`.

        Le choix du modèle et de la qualité est entièrement côté backend.
        """

        config = self.IMAGE_GENERATION_CONFIG.get(action)

        if config is None:
            raise ValueError(
                f"Action image non supportée : {action}"
            )

        prompt = prompt.strip()

        if not prompt:
            raise ValueError(
                "Le prompt de génération d'image est requis."
            )

        response = self.client.images.generate(
            model=config["model"],
            prompt=prompt,
            quality=config["quality"],
            size=config["size"],
        )

        if not response.data:
            raise RuntimeError(
                "OpenAI n'a retourné aucune image."
            )

        image = response.data[0]
        b64_json = getattr(image, "b64_json", None)

        if not b64_json:
            raise RuntimeError(
                "OpenAI n'a retourné aucune donnée image exploitable."
            )

        return {
            "action": action,
            "model": config["model"],
            "quality": config["quality"],
            "size": config["size"],
            "mime_type": "image/png",
            "b64_json": b64_json,
        }

    # ========================================================
    # GÉNÉRATION VIDÉO
    # ========================================================

    def generate_video(
        self,
        action: str,
        prompt: str,
        poll_interval_ms: int | None = None,
    ) -> dict[str, Any]:
        """
        Génère une vidéo via Sora et attend sa finalisation.

        L'API vidéo est asynchrone : le SDK OpenAI fournit
        `create_and_poll`, qui attend la fin du job avant de retourner.
        """

        config = self.VIDEO_GENERATION_CONFIG.get(action)

        if config is None:
            raise ValueError(
                f"Action vidéo non supportée : {action}"
            )

        prompt = prompt.strip()

        if not prompt:
            raise ValueError(
                "Le prompt de génération vidéo est requis."
            )

        create_kwargs: dict[str, Any] = {
            "model": config["model"],
            "prompt": prompt,
            "seconds": config["seconds"],
            "size": config["size"],
        }

        if poll_interval_ms is not None:
            create_kwargs["poll_interval_ms"] = poll_interval_ms

        video = self.client.videos.create_and_poll(
            **create_kwargs,
        )

        if getattr(video, "status", None) != "completed":
            error = getattr(video, "error", None)
            raise RuntimeError(
                "La génération vidéo OpenAI a échoué. "
                f"{error or 'Statut final inattendu.'}"
            )

        video_id = getattr(video, "id", None)

        if not video_id:
            raise RuntimeError(
                "OpenAI n'a retourné aucun identifiant vidéo."
            )

        content = self.client.videos.download_content(
            video_id,
        )

        video_bytes = content.read()

        if not video_bytes:
            raise RuntimeError(
                "OpenAI n'a retourné aucun contenu vidéo."
            )

        return {
            "action": action,
            "model": config["model"],
            "video_id": video_id,
            "seconds": config["seconds"],
            "size": config["size"],
            "mime_type": "video/mp4",
            "data": video_bytes,
        }