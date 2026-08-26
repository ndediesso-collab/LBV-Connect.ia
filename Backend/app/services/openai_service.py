from collections.abc import Iterator
from typing import Any

from openai import OpenAI

from app.config.openai import OPENAI_API_KEY
from app.services.prompt_service import build_output_prompt


class OpenAIService:
    """Service central de communication avec OpenAI."""

    MAX_ATTACHMENTS = 3

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
    ) -> list[dict[str, Any]]:
        """
        Construit l'input natif de la Responses API.

        Supporte :
        - texte
        - images
        - fichiers

        Maximum : 3 pièces jointes par requête.
        """

        attachments = attachments or []

        if len(attachments) > self.MAX_ATTACHMENTS:
            raise ValueError(
                "Maximum 3 images ou fichiers par message."
            )

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

        return [
            {
                "role": "user",
                "content": content,
            }
        ]

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
    ) -> str:
        """Mode classique texte + multimodal + recherche Web."""

        input_data = self._build_input(
            message=message,
            attachments=attachments,
            web=web,
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