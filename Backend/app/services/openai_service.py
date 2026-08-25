from openai import OpenAI

from app.config.openai import OPENAI_API_KEY


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

        request = {
            "model": model,
            "input": message,
        }

        if web:
            request["tools"] = [
                {
                    "type": "web_search",
                }
            ]

        response = self.client.responses.create(
            **request,
        )

        return response.output_text