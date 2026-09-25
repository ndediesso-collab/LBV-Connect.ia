import os


import base64


from dotenv import load_dotenv


from fastapi import HTTPException


from app.config.credit_costs import (

    CreditAction,

    IMAGE_ACTION_QUALITY,

    IMAGE_MODEL_BY_PACK,

    VIDEO_MODEL_BY_PACK,

    VIDEO_PROVIDER_BY_PACK,

)


load_dotenv()


# Compatibilité :


# - OPENAI_API_KEY = nom standard recommandé


# - OPENAI_KEY = ancien nom actuellement utilisé par Oria


OPENAI_API_KEY = (


    os.getenv("OPENAI_KEY")


    or os.getenv("OPENAI_API_KEY")


)


if not OPENAI_API_KEY:


    raise RuntimeError(


        "La variable d'environnement OPENAI_API_KEY "


        "(ou OPENAI_KEY) est introuvable."


    )


# ============================================================


# MODÈLES ORIA


# ============================================================


MODEL_OPENAI_IDS = {
    # Alias frontend historique conservé :
    # "luna" utilise désormais GPT-6 Luna.
    "luna": "gpt-6-luna",

    "gpt-5": "gpt-5",

    # Terra 5.6 reste volontairement dans la gamme Oria.
    "gpt-5.6-terra": "gpt-5.6-terra",

    "gpt-6-sol": "gpt-6-sol",

    "gpt-6-astra": "gpt-6-astra",
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
        "gpt-5.6-terra",
        "gpt-6-sol",
    },

    "business_pack": {
        "gpt-5.6-terra",
        "gpt-6-sol",
        "gpt-6-astra",
    },
}


# ============================================================


# Ce plafond limite l'ensemble des tokens générés par la réponse,


# y compris les tokens de raisonnement non visibles.


MAX_OUTPUT_TOKENS = 32_000


# ============================================================


# HELPERS — USAGE OPENAI


# ============================================================


def _safe_int(value) -> int:


    """


    Convertit proprement une valeur en entier positif ou nul.


    L'usage OpenAI peut être absent sur certains cas d'erreur ou


    certaines réponses incomplètes : dans ce cas on retourne 0.


    """


    try:


        return max(0, int(value or 0))


    except (TypeError, ValueError):


        return 0


def _extract_usage(response) -> dict:


    """


    Extrait les compteurs de consommation renvoyés par la Responses API.


    Important :


    - cached_tokens est déjà inclus dans input_tokens ;


    - reasoning_tokens est déjà inclus dans output_tokens ;


    - ils sont néanmoins conservés séparément afin que le futur


      token_billing_service.py puisse appliquer les bons tarifs.


    """


    usage = getattr(response, "usage", None)


    if usage is None:


        return {


            "input_tokens": 0,


            "cached_input_tokens": 0,


            "cache_write_tokens": 0,


            "output_tokens": 0,


            "reasoning_tokens": 0,


            "total_tokens": 0,


        }


    input_details = getattr(


        usage,


        "input_tokens_details",


        None,


    )


    output_details = getattr(


        usage,


        "output_tokens_details",


        None,


    )


    input_tokens = _safe_int(


        getattr(usage, "input_tokens", 0)


    )


    cached_input_tokens = _safe_int(


        getattr(input_details, "cached_tokens", 0)


        if input_details is not None


        else 0


    )


    cache_write_tokens = _safe_int(


        getattr(input_details, "cache_write_tokens", 0)


        if input_details is not None


        else 0


    )


    output_tokens = _safe_int(


        getattr(usage, "output_tokens", 0)


    )


    reasoning_tokens = _safe_int(


        getattr(output_details, "reasoning_tokens", 0)


        if output_details is not None


        else 0


    )


    total_tokens = _safe_int(


        getattr(usage, "total_tokens", 0)


    )


    # Filet de sécurité si total_tokens n'est pas fourni.


    if total_tokens == 0:


        total_tokens = input_tokens + output_tokens


    return {


        "input_tokens": input_tokens,


        "cached_input_tokens": cached_input_tokens,


        "cache_write_tokens": cache_write_tokens,


        "output_tokens": output_tokens,


        "reasoning_tokens": reasoning_tokens,


        "total_tokens": total_tokens,


    }


def _count_web_search_calls(response) -> int:


    """


    Compte les appels Web réellement présents dans la sortie OpenAI.


    Le frontend peut demander web=True sans que cela doive être utilisé


    comme preuve de consommation. Pour la facturation future, on veut


    compter les appels effectivement exécutés dans response.output.


    """


    output_items = getattr(response, "output", None) or []


    count = 0


    for item in output_items:


        item_type = getattr(item, "type", None)


        if item_type in {


            "web_search_call",


            "web_search",


        }:


            count += 1


    return count


# ============================================================


# EXÉCUTION IA ORIA


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


    Exécute une requête IA Oria.


    Le modèle réellement utilisé dépend :


        1. du modèle demandé par le frontend ;


        2. du pack de l'utilisateur.


    La recherche Web est optionnelle.


    L'image est optionnelle.


    L'API OpenAI reste entièrement côté backend.


    Cette fonction NE calcule PAS encore les crédits Oria.


    Elle retourne désormais la consommation OpenAI réelle afin que


    token_billing_service.py puisse, dans l'étape suivante, convertir :


        usage OpenAI


            -> coût USD


            -> coût XAF


            -> crédits Oria


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


            f"Tu es un assistant IA Oria utilisant "


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


            max_output_tokens=MAX_OUTPUT_TOKENS,


        )


        response_text = response.output_text


        # ====================================================


        # 10. CONSOMMATION RÉELLE OPENAI


        # ====================================================


        usage = _extract_usage(response)


        web_search_calls = (


            _count_web_search_calls(response)


            if web


            else 0


        )


        # ====================================================


        # 11. RETOUR ORIA


        # ====================================================


        return {


            "success": True,


            "model": model,


            "openai_model": openai_model,


            "web": web,


            "web_search_calls": web_search_calls,


            "has_image": image_bytes is not None,


            "message": response_text,


            "usage": usage,


        }


    except HTTPException:


        raise


    except Exception as error:


        raise HTTPException(


            status_code=502,


            detail=f"Erreur OpenAI : {str(error)}",


        )


# ============================================================

# MÉDIAS ORIA — HELPERS

# ============================================================


def _extract_image_usage(response) -> dict:

    """

    Extrait l'usage tokenisé d'une réponse Image API.


    Le schéma peut évoluer selon le modèle. Les champs absents sont

    volontairement ramenés à 0 afin que media_billing_service.py puisse

    décider s'il facture sur l'usage réel ou sur une estimation de secours.

    """

    usage = getattr(response, "usage", None)


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


    input_details = getattr(usage, "input_tokens_details", None)

    output_details = getattr(usage, "output_tokens_details", None)


    input_tokens = _safe_int(getattr(usage, "input_tokens", 0))

    output_tokens = _safe_int(getattr(usage, "output_tokens", 0))

    total_tokens = _safe_int(getattr(usage, "total_tokens", 0))


    text_input_tokens = _safe_int(

        getattr(input_details, "text_tokens", 0)

        if input_details is not None

        else 0

    )

    image_input_tokens = _safe_int(

        getattr(input_details, "image_tokens", 0)

        if input_details is not None

        else 0

    )


    # Compatibilité défensive avec plusieurs formes possibles de détail cache.

    cached_input_tokens = _safe_int(

        getattr(input_details, "cached_tokens", 0)

        if input_details is not None

        else 0

    )

    cached_text_input_tokens = _safe_int(

        getattr(input_details, "cached_text_tokens", 0)

        if input_details is not None

        else 0

    )

    cached_image_input_tokens = _safe_int(

        getattr(input_details, "cached_image_tokens", 0)

        if input_details is not None

        else 0

    )


    image_output_tokens = _safe_int(

        getattr(output_details, "image_tokens", 0)

        if output_details is not None

        else 0

    )


    if image_output_tokens == 0:

        # Les modèles image facturent leur sortie en tokens image.

        # Si le détail n'est pas séparé, output_tokens est le meilleur

        # compteur disponible.

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


def _resolve_image_model(pack_id: str) -> str:

    model = IMAGE_MODEL_BY_PACK.get(pack_id)


    if not model:

        raise HTTPException(

            status_code=403,

            detail=(

                "Aucun modèle de génération d'image n'est "

                f"configuré pour le pack '{pack_id}'."

            ),

        )


    return model


def _resolve_image_quality(action: str) -> tuple[CreditAction, str]:

    try:

        credit_action = CreditAction(action)

    except ValueError as error:

        raise HTTPException(

            status_code=400,

            detail=f"Action média inconnue : {action}",

        ) from error


    quality = IMAGE_ACTION_QUALITY.get(credit_action)


    if quality is None:

        raise HTTPException(

            status_code=400,

            detail=(

                f"L'action '{action}' n'est pas une action "

                "de génération d'image configurée."

            ),

        )


    return credit_action, quality


# ============================================================

# GÉNÉRATION D'IMAGE ORIA

# ============================================================
#
# Les modèles image ne sont pas hardcodés ici : IMAGE_MODEL_BY_PACK
# dans credit_costs.py décide du modèle utilisé (GPT Image 2,
# GPT Image 2.5 Flare, GPT Image 2.5 Sunburst, etc.).
# Le changement de modèle ne modifie pas le flux de facturation dynamique.


def generate_image(

    prompt: str,

    client_openai,

    pack_id: str,

    action: str,

    *,

    size: str = "1024x1024",

    output_format: str = "png",

    n: int = 1,

) -> dict:

    """

    Génère une image avec le modèle associé au pack Oria.


    Responsabilités de cette fonction :

    - déterminer le modèle OpenAI à utiliser ;

    - déterminer la qualité liée à l'action Oria ;

    - appeler l'Image API ;

    - retourner l'image et l'usage réel lorsqu'il est disponible.


    Cette fonction ne réserve, ne débite et ne settle aucun crédit.

    La facturation appartient à media_billing_service.py + ai_route.py.

    """

    if not prompt or not prompt.strip():

        raise HTTPException(

            status_code=400,

            detail="Le prompt de génération d'image est vide.",

        )


    if n < 1 or n > 10:

        raise HTTPException(

            status_code=400,

            detail="Le nombre d'images doit être compris entre 1 et 10.",

        )


    model = _resolve_image_model(pack_id)

    credit_action, quality = _resolve_image_quality(action)


    try:

        response = client_openai.images.generate(

            model=model,

            prompt=prompt.strip(),

            size=size,

            quality=quality,

            n=n,

            output_format=output_format,

        )


        data = getattr(response, "data", None) or []

        images = []


        for item in data:

            images.append(

                {

                    "b64_json": getattr(item, "b64_json", None),

                    "url": getattr(item, "url", None),

                    "revised_prompt": getattr(item, "revised_prompt", None),

                }

            )


        if not images:

            raise RuntimeError(

                "OpenAI n'a retourné aucune image exploitable."

            )


        usage = _extract_image_usage(response)


        return {

            "success": True,

            "provider": "openai",

            "media_type": "image",

            "action": credit_action.value,

            "model": model,

            "pack_id": pack_id,

            "size": getattr(response, "size", None) or size,

            "quality": getattr(response, "quality", None) or quality,

            "output_format": (

                getattr(response, "output_format", None)

                or output_format

            ),

            "count": len(images),

            "images": images,

            "usage": usage,

        }


    except HTTPException:

        raise


    except Exception as error:

        raise HTTPException(

            status_code=502,

            detail=f"Erreur OpenAI image : {str(error)}",

        ) from error


# ============================================================

# VIDÉO ORIA — INTERFACE DE FOURNISSEUR

# ============================================================


def get_video_backend(pack_id: str) -> dict:

    """
    Retourne le backend vidéo OpenAI configuré pour un pack.

    Le choix du modèle reste centralisé dans credit_costs.py via
    VIDEO_PROVIDER_BY_PACK et VIDEO_MODEL_BY_PACK.

    Cette fonction ne réserve, ne débite et ne settle aucun crédit :
    elle résout uniquement le provider et le modèle à exécuter.
    """

    provider = VIDEO_PROVIDER_BY_PACK.get(pack_id)

    model = VIDEO_MODEL_BY_PACK.get(pack_id)


    if not provider or not model:

        raise HTTPException(

            status_code=503,

            detail=(

                "La génération vidéo est prévue pour ce pack, "

                "mais aucun modèle vidéo OpenAI n'est configuré."

            ),

        )


    return {

        "provider": provider,

        "model": model,

    }
