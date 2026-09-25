from collections.abc import Iterator



from typing import Any



from openai import OpenAI



from app.config.openai import OPENAI_API_KEY



from app.config.credit_costs import (

    CreditAction,

    IMAGE_ACTION_QUALITY,

    IMAGE_MODEL_BY_PACK,

    MAX_CHAT_OUTPUT_TOKENS,

    VIDEO_ACTION_DURATION_SECONDS,

    VIDEO_MODEL_BY_PACK,

    VIDEO_PROVIDER_BY_PACK,

)



from app.services.prompt_service import build_output_prompt



class OpenAIService:



    """Service central de communication avec OpenAI."""



    MAX_ATTACHMENTS = 3



    MAX_HISTORY_MESSAGES = 40



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



        # L'historique est déjà sélectionné et limité par la route IA.



        # OpenAIService transmet donc l'historique reçu sans le tronquer



        # afin de préserver les messages anciens pertinents ajoutés



        # à la mémoire conversationnelle.



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



        # PROMPT ORIA



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



        Seules les actions \`search\` correspondent ici à un appel



        de recherche facturable par notre moteur de crédits.



        Si une ancienne version du SDK ne fournit pas \`action\`,



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



    def _build_chat_result(



        cls,



        *,



        response: Any,



        requested_model: str,



        web: bool,



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



            "usage": usage,



        }



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



    ) -> dict[str, Any]:



        """



        Mode classique texte + multimodal + recherche Web.



        Retourne désormais le texte ET l'usage réel nécessaire



        à la facturation dynamique Oria.



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



            "max_output_tokens": (



                MAX_CHAT_OUTPUT_TOKENS



            ),



        }



        tools = self._build_tools(web)



        if tools:



            request["tools"] = tools



        try:



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



    ) -> Iterator[dict[str, Any]]:



        """



        Streaming texte + images + fichiers + Web.



        Le protocole interne vers le routeur Oria devient :



            {"type": "delta", "content": "..."}



            ...



            {



                "type": "usage",



                "usage": {...},



                "web_search_calls": N,



                "model": "...",



            }



        L'événement \`usage\` final est obligatoire pour permettre



        la facturation réelle après génération.



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



            "max_output_tokens": (



                MAX_CHAT_OUTPUT_TOKENS



            ),



        }



        tools = self._build_tools(web)



        if tools:



            request["tools"] = tools



        try:



            stream = self.client.responses.create(



                **request,



            )



            completed_response = None



            for event in stream:



                event_type = self._value(



                    event,



                    "type",



                    "",



                )



                # --------------------------------------------



                # TEXTE PROGRESSIF



                # --------------------------------------------



                if (



                    event_type



                    == "response.output_text.delta"



                ):



                    delta = self._value(



                        event,



                        "delta",



                    )



                    if delta:



                        yield {



                            "type": "delta",



                            "content": str(delta),



                        }



                    continue



                # --------------------------------------------



                # RÉPONSE TERMINÉE



                # --------------------------------------------



                if event_type == "response.completed":



                    completed_response = self._value(



                        event,



                        "response",



                    )



                    continue



                # --------------------------------------------



                # ÉCHECS EXPLICITES



                # --------------------------------------------



                if event_type in {



                    "response.failed",



                    "response.incomplete",



                    "error",



                }:



                    response = self._value(



                        event,



                        "response",



                    )



                    error = (



                        self._value(



                            event,



                            "error",



                        )



                        or self._value(



                            response,



                            "error",



                        )



                        or self._value(



                            event,



                            "message",



                        )



                    )



                    raise RuntimeError(



                        "Le streaming OpenAI s'est terminé "



                        f"avec l'événement '{event_type}'"



                        + (



                            f" : {error}"



                            if error



                            else "."



                        )



                    )



            if completed_response is None:



                raise RuntimeError(



                    "Le streaming OpenAI s'est terminé sans "



                    "événement response.completed."



                )



            usage = self._extract_usage(



                completed_response



            )



            web_search_calls = (



                self._count_web_search_calls(



                    completed_response



                )



                if web



                else 0



            )



            actual_model = str(



                self._value(



                    completed_response,



                    "model",



                    model,



                )



                or model



            )



            yield {



                "type": "usage",



                "usage": usage,



                "web_search_calls": (



                    web_search_calls



                ),



                "model": actual_model,



            }



        except RuntimeError:



            raise



        except Exception as error:



            raise RuntimeError(



                "Erreur API OpenAI pendant "



                f"le streaming : {str(error)}"



            ) from error



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

        return {

            "success": True,

            "provider": "openai",

            "media_type": "video",

            "action": config["action"].value,

            "pack_id": config["pack_id"],

            "model": config["model"],

            "video_id": video_id,

            "seconds": config["seconds"],

            "size": config["size"],

            "mime_type": "video/mp4",

            "data": video_bytes,

        }

