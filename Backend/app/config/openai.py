import os

from dotenv import load_dotenv


load_dotenv()


OPENAI_API_KEY = os.getenv("OPENAI_KEY")


if not OPENAI_API_KEY:
    raise RuntimeError(
        "La variable d'environnement OPENAI_API_KEY est introuvable." 
    )#

import base64

from fastapi import HTTPException


# ============================================================
# MODÈLES LBV-CONNECT
# ============================================================

MODEL_OPENAI_IDS = {
    "luna": "gpt-5.6-luna",
    "gpt-5": "gpt-5",
    "gpt-5.6-terra": "gpt-5.6-terra",
    "gpt-5.6-sol": "gpt-5.6-sol",
}


PACK_ALLOWED_MODELS = {
    "light_pack": {
        "luna",
    },

    "intermediate_pack": {
        "luna",
        "gpt-5",
    },

    "pro_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
    },

    "business_pack": {
        "luna",
        "gpt-5",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
    },
}


# ============================================================
# EXÉCUTION IA LBV-CONNECT
# ============================================================

def exec_ia(
    prompt: str,
    client_openai,
    pack_id: str,
    model: str,
    web: bool = False,
    image_bytes: bytes | None = None,
    role_prefix: bool = False,
):
    """
    Exécute une requête IA LBV-Connect.

    Le modèle réellement utilisé dépend :
        1. du modèle demandé par le frontend ;
        2. du pack de l'utilisateur.

    La recherche Web est optionnelle.

    L'image est optionnelle.

    L'API OpenAI reste entièrement côté backend.
    """

    # ========================================================
    # 1. VALIDATION DU MODÈLE
    # ========================================================

    if model not in MODEL_OPENAI_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Modèle inconnu : {model}",
        )

    # ========================================================
    # 2. VÉRIFICATION DU PACK
    # ========================================================

    allowed_models = PACK_ALLOWED_MODELS.get(
        pack_id,
        set(),
    )

    if model not in allowed_models:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Le modèle '{model}' n'est pas disponible "
                f"avec le pack '{pack_id}'."
            ),
        )

    # ========================================================
    # 3. IDENTIFIANT OPENAI
    # ========================================================

    openai_model = MODEL_OPENAI_IDS[model]

    # ========================================================
    # 4. PRÉAMBULE OPTIONNEL
    # ========================================================

    if role_prefix:
        prefix = (
            f"Tu es un assistant IA LBV-Connect utilisant "
            f"le modèle {model}. "
            "Réponds de manière précise, structurée et "
            "adaptée à la demande de l'utilisateur.\n\n"
        )
    else:
        prefix = ""

    # ========================================================
    # 5. CONTENU UTILISATEUR
    # ========================================================

    user_content = [
        {
            "type": "input_text",
            "text": f"{prefix}{prompt}",
        }
    ]

    # ========================================================
    # 6. IMAGE OPTIONNELLE
    # ========================================================

    if image_bytes:
        base64_image = base64.b64encode(
            image_bytes
        ).decode("utf-8")

        user_content.append(
            {
                "type": "input_image",
                "image_url": (
                    "data:image/jpeg;base64,"
                    f"{base64_image}"
                ),
            }
        )

    # ========================================================
    # 7. INPUT RESPONSES API
    # ========================================================

    input_data = [
        {
            "role": "user",
            "content": user_content,
        }
    ]

    # ========================================================
    # 8. OUTILS
    # ========================================================

    tools = []

    if web:
        tools.append(
            {
                "type": "web_search",
            }
        )

    # ========================================================
    # 9. APPEL OPENAI
    # ========================================================

    try:

        response = client_openai.responses.create(
            model=openai_model,
            tools=tools,
            input=input_data,
        )

        response_text = response.output_text

        return {
            "success": True,
            "model": model,
            "openai_model": openai_model,
            "web": web,
            "has_image": image_bytes is not None,
            "message": response_text,
        }

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail=f"Erreur OpenAI : {str(error)}",
        )