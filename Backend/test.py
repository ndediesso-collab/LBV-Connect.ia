from app.services.openai_service import OpenAIService


service = OpenAIService()

response = service.chat(
    model="gpt-5",
    message="Réponds simplement : connexion OpenAI réussie.",
)

print(response)