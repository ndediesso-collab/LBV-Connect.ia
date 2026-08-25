import os

from dotenv import load_dotenv


load_dotenv()


OPENAI_API_KEY = os.getenv("OPENAI_KEY")


if not OPENAI_API_KEY:
    raise RuntimeError(
        "La variable d'environnement OPENAI_API_KEY est introuvable." 
    )#