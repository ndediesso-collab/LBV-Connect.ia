"""ORIA — connecteur Google AI Studio pour images et clips courts.

Chemin : app/services/google_media_service.py
SDK    : pip install -U google-genai python-dotenv
Secret : GOOGLE_LBV_KEY (serveur uniquement)

Contrat utilisé par app/routes/ai.py :
    GoogleMediaService(enabled=True).create_image(...)
    GoogleMediaService(enabled=True).create_short_video(...)
    GoogleMediaService().check_connection()

IMPORTANT — CE SERVICE NE FACTURE JAMAIS LES UTILISATEURS :
- Le routeur authentifie l'utilisateur, vérifie son vrai pack et le devis.
- Le repository Supabase réserve les crédits AVANT tout appel payant.
- Le calculateur rapproche l'usage fournisseur et le routeur règle la réserve.
- Une panne après soumission peut être facturée ; ne jamais rembourser une
  réservation sur une simple exception réseau ou un délai dépassé.
- La protection ORIA_GOOGLE_MEDIA_ENABLED est une barrière additionnelle ;
  le routeur d'ORIA utilise également des drapeaux d'activation serveur.

Documentation :
https://ai.google.dev/gemini-api/docs/image-generation
https://ai.google.dev/gemini-api/docs/omni
https://ai.google.dev/api/interactions-api
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import os
from pathlib import Path
import re
import time
from typing import Any, Literal, Mapping, Sequence

from app.config import credit_costs as _config


IMAGE_MODELS: dict[str, str] = {
    "lite": "gemini-3.1-flash-lite-image",
    "standard": "gemini-nano-banana-2.1",
    "premium": "gemini-3-pro-image",
}
VIDEO_MODEL: str = _config.GOOGLE_VIDEO_MODEL

IMAGE_MIME_BY_EXTENSION = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_OUTPUT_BYTES = 30 * 1024 * 1024
MAX_VIDEO_OUTPUT_BYTES = 256 * 1024 * 1024
MAX_PROMPT_CHARS = 8000
SUPPORTED_IMAGE_ASPECT_RATIOS = frozenset({
    "1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9",
})
VIDEO_ASPECT_RATIOS = frozenset({"16:9", "9:16"})


class GoogleMediaConfigurationError(RuntimeError):
    """Configuration de Google absente/incompatible."""


class GoogleMediaDisabledError(PermissionError):
    """Pas de génération autorisée par la configuration serveur."""


class GoogleMediaProviderError(RuntimeError):
    """Réponse fournisseur refusée ou livrable inexploitable.

    Une telle erreur ne prouve PAS que Google n'a rien facturé.
    """

    def __init__(self, message: str, *, interaction_id: str | None = None):
        super().__init__(message)
        self.interaction_id = interaction_id


class GoogleMediaDeliveryPending(GoogleMediaProviderError):
    """Google peut avoir généré une vidéo ; livraison non encore confirmée.

    Réserver/reconcilier et NE PAS LIBÉRER sur ce seul signal.
    """


@dataclass(frozen=True)
class MediaResult:
    """Résultat que ai.py passe à MediaService puis au calculateur de crédits."""

    interaction_id: str | None
    model: str
    media_type: Literal["image", "video"]
    file_path: str
    mime_type: str
    usage: dict[str, Any] | None


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _required_nonnegative_int(value: Any, label: str) -> int:
    if type(value) is not int or value < 0:
        raise GoogleMediaProviderError(f"Statistique Google invalide : {label}.")
    return value


def _normalize_modality(value: Any) -> str:
    text = str(_field(value, "value", value) or "").lower().strip()
    return text.split(".")[-1]


def _usage_from_interaction(interaction: Any) -> dict[str, Any] | None:
    """Préserve les vrais compteurs Google, sans les inventer.

    Le calculateur de coûts de l'étape précédente exige les sorties par
    modalité ; s'ils manquent, ai.py doit conserver la réserve à rapprocher.
    """
    raw = _field(interaction, "usage")
    if raw is None:
        return None
    result: dict[str, Any] = {}
    for name in ("total_input_tokens", "total_output_tokens", "total_thought_tokens"):
        value = _field(raw, name)
        if value is not None:
            result[name] = _required_nonnegative_int(value, name)
    for name in ("input_tokens_by_modality", "output_tokens_by_modality"):
        source = _field(raw, name)
        if source is None:
            continue
        if not isinstance(source, (list, tuple)):
            raise GoogleMediaProviderError(f"Statistiques multimodales invalides : {name}.")
        entries = []
        for item in source:
            modality = _normalize_modality(_field(item, "modality"))
            tokens = _required_nonnegative_int(_field(item, "tokens"), name)
            if not modality:
                raise GoogleMediaProviderError("Modalité Google manquante.")
            entries.append({"modality": modality, "tokens": tokens})
        result[name] = entries
    return result or None


def _decode_output(value: Any, *, label: str, maximum: int) -> bytes:
    if isinstance(value, bytes):
        value = value.decode("ascii")
    if not isinstance(value, str) or not value:
        raise GoogleMediaProviderError(f"Google n'a pas transmis de contenu {label} exploitable.")
    # La taille base64 borne la mémoire AVANT décodage.
    if len(value) > (maximum * 4 // 3) + 12:
        raise GoogleMediaProviderError(f"Le fichier {label} est trop volumineux.")
    try:
        result = base64.b64decode(value, validate=True)
    except (binascii.Error, UnicodeError) as exc:
        raise GoogleMediaProviderError(f"Base64 {label} invalide.") from exc
    if not result or len(result) > maximum:
        raise GoogleMediaProviderError(f"La taille du fichier {label} est invalide.")
    return result


def _validate_reference(path: str | Path) -> tuple[str, str]:
    """Lit une référence locale interne au backend, pas une URL utilisateur."""
    file = Path(path)
    if file.is_symlink() or not file.is_file():
        raise ValueError("Référence photo inexistante ou lien symbolique interdit.")
    mime = IMAGE_MIME_BY_EXTENSION.get(file.suffix.lower())
    if not mime:
        raise ValueError("Référence photo : PNG, JPEG ou WebP exclusivement.")
    size = file.stat().st_size
    if size <= 0 or size > MAX_REFERENCE_BYTES:
        raise ValueError("Une référence doit peser au maximum 10 Mo.")
    data = file.read_bytes()
    if len(data) != size or not _valid_image_signature(data, mime):
        raise ValueError("Le contenu de la photo ne correspond pas à son extension.")
    return base64.b64encode(data).decode("ascii"), mime


def _valid_image_signature(data: bytes, mime: str) -> bool:
    return {
        "image/png": lambda: data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": lambda: data.startswith(b"\xff\xd8\xff"),
        "image/webp": lambda: data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    }.get(mime, lambda: False)()


def _valid_video_signature(data: bytes) -> bool:
    return len(data) >= 12 and data[4:8] == b"ftyp"


def _write_output(destination: str | Path, data: bytes, *, kind: str) -> str:
    file = Path(destination)
    suffix = ".png" if kind == "image" else ".mp4"
    if file.suffix.lower() != suffix:
        raise ValueError(f"Le fichier de sortie {kind} doit se terminer par {suffix}.")
    if file.is_symlink():
        raise ValueError("La destination ne peut pas être un lien symbolique.")
    if kind == "image" and not _valid_image_signature(data, "image/png"):
        raise GoogleMediaProviderError("La sortie Google n'est pas une image PNG.")
    if kind == "video" and not _valid_video_signature(data):
        raise GoogleMediaProviderError("La sortie Google n'est pas un MP4 valide.")
    # Destination contrôlée par ai.py dans un TemporaryDirectory serveur.
    file.parent.mkdir(parents=True, exist_ok=True)
    # Exclusif : ne jamais écraser le média d'une autre génération.
    with file.open("xb") as handle:
        handle.write(data)
    return str(file)


def _interaction_id(interaction: Any) -> str | None:
    value = _field(interaction, "id")
    return str(value) if value else None


class GoogleMediaService:
    """Adaptateur Google sans portefeuille et sans logique de paiement."""

    def __init__(
        self, api_key: str | None = None, *, enabled: bool | None = None,
        client: Any | None = None,
    ) -> None:
        # injection explicite utile seulement pour les tests du backend.
        self._api_key = (api_key or os.getenv("GOOGLE_LBV_KEY", "")).strip()
        self.enabled = (
            enabled if enabled is not None else
            os.getenv("ORIA_GOOGLE_MEDIA_ENABLED", "0").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self._client = client

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self._api_key:
            raise GoogleMediaConfigurationError(
                "GOOGLE_LBV_KEY absente : définissez-la dans le .env du backend."
            )
        try:
            from google import genai
        except ImportError as exc:
            raise GoogleMediaConfigurationError(
                "SDK Google manquant : pip install -U google-genai"
            ) from exc
        self._client = genai.Client(api_key=self._api_key)
        return self._client

    def _require_generation_enabled(self) -> None:
        if not self.enabled:
            raise GoogleMediaDisabledError(
                "Appels payants Google désactivés : validez d'abord les packs, "
                "la facturation et le stockage privés côté routeur."
            )

    @staticmethod
    def _validate_prompt(prompt: str) -> str:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("La description de la création est obligatoire.")
        clean = prompt.strip()
        if len(clean) > MAX_PROMPT_CHARS:
            raise ValueError("Description limitée à 8 000 caractères.")
        return clean

    def check_connection(self) -> dict[str, Any]:
        """Vérifie la liste des modèles, sans génération facturée."""
        configured = [*IMAGE_MODELS.values(), VIDEO_MODEL]
        names: list[str] = []
        for model in self._get_client().models.list():
            name = _field(model, "name")
            if isinstance(name, str):
                names.append(name)
        found = [
            identifier for identifier in configured
            if any(name == identifier or name.endswith("/" + identifier) for name in names)
        ]
        return {
            "authenticated": True,  # la liste a été récupérée sans erreur
            "model_listing_count": len(names),
            "configured_models": configured,
            "models_seen_in_list": found,
            "generations_enabled": self.enabled,
            "note": "Un modèle listé ne garantit ni quota ni facturation activée.",
        }

    def create_image(
        self, *, prompt: str, destination: str | Path,
        tier: Literal["lite", "standard", "premium"] = "standard",
        size: Literal["1K", "2K", "4K"] = "1K",
        aspect_ratio: str = "1:1",
        reference_image: str | Path | None = None,
        reference_images: Sequence[str | Path] | None = None,
    ) -> MediaResult:
        """Crée ou retouche une image PNG. Le pack est contrôlé dans ai.py.

        La fonction accepte aussi plusieurs références pour un FUTUR routeur,
        mais les routes ORIA actuelles n'en transmettent qu'une et n'offrent
        pas encore le devis multi-références.
        """
        self._require_generation_enabled()
        clean = self._validate_prompt(prompt)
        if tier not in IMAGE_MODELS:
            raise ValueError("Niveau de génération image Google inconnu.")
        model = IMAGE_MODELS[tier]
        prices = _config.GOOGLE_IMAGE_OUTPUT_USD_BY_MODEL.get(model, {})
        if size not in prices:
            raise ValueError("La résolution demandée n'est pas prévue pour ce modèle.")
        if aspect_ratio not in SUPPORTED_IMAGE_ASPECT_RATIOS:
            raise ValueError("Format d'image non pris en charge.")
        if reference_image is not None and reference_images:
            raise ValueError("Utiliser reference_image OU reference_images.")
        refs: list[str | Path] = (
            [reference_image] if reference_image is not None
            else list(reference_images or [])
        )
        cap = _config.GOOGLE_IMAGE_MAX_REFERENCE_IMAGES_BY_MODEL.get(model, 0)
        if len(refs) > cap:
            raise ValueError("Trop d'images de référence pour le modèle Google.")
        input_data: Any = clean
        if refs:
            input_data = [{"type": "text", "text": clean}]
            for item in refs:
                encoded, mime = _validate_reference(item)
                input_data.append({"type": "image", "data": encoded, "mime_type": mime})
        if Path(destination).suffix.lower() != ".png":
            raise ValueError("Le fichier image de destination doit finir par .png.")

        interaction = self._get_client().interactions.create(
            model=model,
            input=input_data,
            store=False,
            response_format={
                "type": "image", "mime_type": "image/png",
                "image_size": size, "aspect_ratio": aspect_ratio,
            },
        )
        iid = _interaction_id(interaction)
        out = _field(interaction, "output_image")
        if out is None:
            raise GoogleMediaProviderError("Google n'a retourné aucune image.", interaction_id=iid)
        data = _decode_output(_field(out, "data"), label="image", maximum=MAX_IMAGE_OUTPUT_BYTES)
        location = _write_output(destination, data, kind="image")
        return MediaResult(
            interaction_id=iid, model=model, media_type="image",
            file_path=location, mime_type="image/png",
            usage=_usage_from_interaction(interaction),
        )

    @staticmethod
    def _video_file_name(uri: str) -> str:
        # N'accepte que les liens vers l'API Files Google. Pas de GET HTTP vers
        # une URL fournie par l'utilisateur (protection SSRF).
        if not uri.startswith("https://generativelanguage.googleapis.com/"):
            raise GoogleMediaProviderError("URI vidéo Google hors domaine autorisé.")
        match = re.search(r"/files/([A-Za-z0-9_-]+)(?::download|[?/]|$)", uri)
        if not match:
            raise GoogleMediaProviderError("Identifiant fichier Google invalide.")
        return "files/" + match.group(1)

    def _download_video_uri(self, uri: str, destination: str | Path, *, iid: str | None) -> str:
        name = self._video_file_name(uri)
        client = self._get_client()
        # Moins de 15 minutes : au-delà, la réservation SQL des médias peut
        # expirer. Le routeur devra implémenter la reprise persistante plus tard.
        poll_interval = 4
        deadline = time.monotonic() + 96
        while True:
            try:
                file_info = client.files.get(name=name)
            except Exception as exc:
                raise GoogleMediaDeliveryPending(
                    "État du fichier vidéo Google inconnu : rapprochement requis.",
                    interaction_id=iid,
                ) from exc
            state = _field(_field(file_info, "state"), "name")
            if state is None:
                state = str(_field(file_info, "state", "")).split(".")[-1]
            if state == "ACTIVE":
                break
            if state == "FAILED":
                raise GoogleMediaProviderError(
                    "Le fichier vidéo Google a été signalé en échec.", interaction_id=iid,
                )
            if time.monotonic() >= deadline:
                raise GoogleMediaDeliveryPending(
                    "Vidéo encore en préparation chez Google : rapprocher l'interaction.",
                    interaction_id=iid,
                )
            time.sleep(poll_interval)
        # Télécharge uniquement via le SDK authentifié, sans appel HTTP arbitraire.
        try:
            client.files.download(file=uri, destination=str(destination))
        except Exception as exc:
            raise GoogleMediaDeliveryPending(
                "Téléchargement vidéo Google non confirmé.", interaction_id=iid,
            ) from exc
        file = Path(destination)
        if (file.is_symlink() or not file.is_file()
                or not 12 <= file.stat().st_size <= MAX_VIDEO_OUTPUT_BYTES):
            raise GoogleMediaProviderError("Fichier vidéo téléchargé invalide.", interaction_id=iid)
        with file.open("rb") as handle:
            header = handle.read(16)
        if not _valid_video_signature(header):
            raise GoogleMediaProviderError("La vidéo téléchargée n'est pas un MP4.", interaction_id=iid)
        return str(file)

    def create_short_video(
        self, *, prompt: str, destination: str | Path,
        aspect_ratio: Literal["16:9", "9:16"] = "16:9",
        reference_image: str | Path | None = None,
        requested_seconds: int | None = None,
    ) -> MediaResult:
        """Vidéo courte Google, texte->vidéo ou image->vidéo.

        `requested_seconds` est une consigne de durée au modèle, et non une
        garantie de durée ou le montant de la facturation finale.
        """
        self._require_generation_enabled()
        clean = self._validate_prompt(prompt)
        if aspect_ratio not in VIDEO_ASPECT_RATIOS:
            raise ValueError("Le format vidéo doit être 16:9 ou 9:16.")
        if requested_seconds is not None:
            if type(requested_seconds) is not int or not 3 <= requested_seconds <= 10:
                raise ValueError("Durée demandée : entre 3 et 10 secondes.")
            clean = f"Produce a clip of approximately {requested_seconds} seconds. {clean}"
        if Path(destination).suffix.lower() != ".mp4":
            raise ValueError("Le fichier vidéo de destination doit finir par .mp4.")
        input_data: Any = clean
        if reference_image is not None:
            encoded, mime = _validate_reference(reference_image)
            input_data = [
                {"type": "text", "text": clean},
                {"type": "image", "data": encoded, "mime_type": mime},
            ]
        interaction = self._get_client().interactions.create(
            model=VIDEO_MODEL,
            input=input_data,
            store=False,
            response_format={
                "type": "video", "aspect_ratio": aspect_ratio,
                "resolution": "720p", "delivery": "uri",
            },
        )
        iid = _interaction_id(interaction)
        out = _field(interaction, "output_video")
        if out is None:
            raise GoogleMediaProviderError("Google n'a pas renvoyé de vidéo.", interaction_id=iid)
        raw = _field(out, "data")
        if raw:
            data = _decode_output(raw, label="vidéo", maximum=MAX_VIDEO_OUTPUT_BYTES)
            location = _write_output(destination, data, kind="video")
        else:
            uri = _field(out, "uri")
            if not isinstance(uri, str) or not uri:
                raise GoogleMediaDeliveryPending(
                    "Vidéo Google sans sortie exploitable pour le moment.", interaction_id=iid,
                )
            location = self._download_video_uri(uri, destination, iid=iid)
        return MediaResult(
            interaction_id=iid, model=VIDEO_MODEL, media_type="video",
            file_path=location, mime_type="video/mp4",
            usage=_usage_from_interaction(interaction),
        )


__all__ = [
    "GoogleMediaService", "GoogleMediaConfigurationError",
    "GoogleMediaDisabledError", "GoogleMediaProviderError",
    "GoogleMediaDeliveryPending", "MediaResult",
    "IMAGE_MODELS", "VIDEO_MODEL",
]
