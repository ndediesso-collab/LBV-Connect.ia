from collections.abc import Iterator

from openai import OpenAI

from app.config.openai import OPENAI_API_KEY
from app.services.prompt_service import build_output_prompt


class OpenAIService:
    """Service central de communication avec OpenAI."""

    def __init__(self):
        self.client = OpenAI(
            api_key=OPENAI_API_KEY,
        )

    def chat(
        self,
        model: str,
        message: str,
        web: bool = False,
    ) -> str:
        """
        Mode classique.

        Conservé pour les autres fonctionnalités qui ont besoin
        d'une réponse complète.

        Le message utilisateur passe d'abord par le système
        de formatage LBV-Connect afin d'obtenir une réponse
        structurée et lisible.
        """

        # ========================================================
        # PROMPT LBV-CONNECT
        # ========================================================

        formatted_message = build_output_prompt(
            message=message,
            web=web,
        )

        # ========================================================
        # REQUÊTE OPENAI
        # ========================================================

        request = {
            "model": model,
            "input": formatted_message,
        }

        # ========================================================
        # RECHERCHE WEB
        # ========================================================

        if web:
            request["tools"] = [
                {
                    "type": "web_search",
                }
            ]

        # ========================================================
        # APPEL OPENAI
        # ========================================================

        response = self.client.responses.create(
            **request,
        )

        return response.output_text

    def chat_stream(
        self,
        model: str,
        message: str,
        web: bool = False,
    ) -> Iterator[str]:
        """
        Mode streaming.

        Le prompt LBV-Connect est appliqué avant l'appel OpenAI,
        puis les fragments de réponse sont transmis immédiatement
        dès qu'ils sont disponibles.

        Aucun paramètre de raisonnement n'est imposé ici :
        chaque modèle conserve donc son comportement actuel.
        """

        # ========================================================
        # PROMPT LBV-CONNECT
        # ========================================================

        formatted_message = build_output_prompt(
            message=message,
            web=web,
        )

        # ========================================================
        # REQUÊTE OPENAI STREAMING
        # ========================================================

        request = {
            "model": model,
            "input": formatted_message,
            "stream": True,
        }

        # ========================================================
        # RECHERCHE WEB
        # ========================================================

        if web:
            request["tools"] = [
                {
                    "type": "web_search",
                }
            ]

        # ========================================================
        # APPEL OPENAI
        # ========================================================

        stream = self.client.responses.create(
            **request,
        )

        # ========================================================
        # TRANSMISSION DES FRAGMENTS
        # ========================================================

        for event in stream:
            event_type = getattr(
                event,
                "type",
                "",
            )

            if (
                event_type
                == "response.output_text.delta"
            ):
                delta = getattr(
                    event,
                    "delta",
                    None,
                )

                if delta:
                    yield delta