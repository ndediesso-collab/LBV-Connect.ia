"""Insère les véritables images jointes dans les artefacts ORIA explicitement demandés.

N'accepte que les fichiers de la requête authentifiée (pas d'URL arbitraire,
pas de donnée d'image inventée par le modèle). Le schéma oria.artifact.v1 est
préservé. Les données sont redimensionnées et revalidées avant compilation.
"""
from __future__ import annotations

import base64
from copy import deepcopy
import io
import re
from typing import Any

_IMAGE_INTENT = re.compile(
    r"\b(?:ins[eè]re(?:r|z)?|int[eéè]gr(?:e|er|ez)|ajout(?:e|er|ez)|"
    r"inclu(?:re|s|ez)|place(?:r|z)?|illustr(?:e|er|ez)|"
    r"met(?:s|tre|tez)\s+(?:la|les|mon|mes|cette|ces)\s+(?:photo|image))\b",
    re.IGNORECASE,
)


def _field(obj: Any, name: str) -> Any:
    return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)


def _source_image_uris(attachments: list[Any]) -> list[str]:
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise ValueError("Pillow est nécessaire pour intégrer les images.") from exc
    result: list[str] = []
    for attachment in attachments:
        mime = str(_field(attachment, "mime_type") or "").lower()
        kind = str(_field(attachment, "type") or "").lower()
        if not (mime in {"image/png", "image/jpeg", "image/webp"} and
                kind in {"", "image"}):
            continue
        raw64 = _field(attachment, "data")
        if not isinstance(raw64, str) or len(raw64) > 3_000_000:
            raise ValueError("Image jointe trop volumineuse.")
        raw = base64.b64decode(raw64, validate=True)
        if not raw or len(raw) > 2_100_000:
            raise ValueError("Image jointe vide ou trop volumineuse.")
        with Image.open(io.BytesIO(raw)) as original:
            if original.width < 1 or original.height < 1 or original.width * original.height > 8_000_000:
                raise ValueError("Dimensions d'image non autorisées.")
            original.verify()
        with Image.open(io.BytesIO(raw)) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((900, 900), Image.Resampling.LANCZOS)
            for quality in (83, 72, 60, 45):
                out = io.BytesIO()
                image.save(out, format="JPEG", quality=quality, optimize=True)
                if len(out.getvalue()) <= 230_000:
                    result.append("data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii"))
                    break
            else:
                raise ValueError("Image trop lourde pour être intégrée au document.")
        if len(result) >= 2:
            break
    return result


def insert_requested_images(
    payload: dict[str, Any], attachments: list[Any] | None,
    message: str | None,
) -> dict[str, Any]:
    """Conserve les documents intacts sauf instruction explicite + vraies images.

    L'image est intégrée comme contenu réel dans le PDF, Word, Excel ou PPTX.
    Si une présentation native ne peut pas l'accepter, la conversion échoue
    au lieu de prétendre avoir inséré la photo.
    """
    instruction = str(message or "")
    explicit_image_and_document = (
        re.search(r"\b(?:images?|photos?|logos?|illustrations?|captures?)\b", instruction, re.I)
        and re.search(r"\b(?:fichier|document|pdf|word|docx|excel|xlsx|pptx|powerpoint|présentation|diapositive)\b", instruction, re.I)
    )
    if not attachments or not (_IMAGE_INTENT.search(instruction) or explicit_image_and_document):
        return payload
    images = _source_image_uris(attachments)
    if not images:
        return payload
    if not isinstance(payload, dict):
        raise ValueError("Document structuré absent.")
    result = deepcopy(payload)
    sources = result.get("sources")
    specs = result.get("artifacts")
    if not isinstance(sources, list) or not isinstance(specs, list):
        raise ValueError("Document structuré invalide.")
    source_by_id = {s.get("id"): s for s in sources if isinstance(s, dict)}
    html_modified: set[str] = set()
    for spec in specs:
        if not isinstance(spec, dict):
            raise ValueError("Spécification de document invalide.")
        fmt = spec.get("format")
        if fmt not in {"pdf", "docx", "pptx", "xlsx"}:
            continue
        sid = spec.get("source_id")
        source = source_by_id.get(sid)
        if fmt in {"pdf", "docx", "pptx"} and source is not None:
            if not isinstance(source.get("content"), str) or source.get("kind") != "html":
                raise ValueError("Cette source documentaire ne permet pas d'insérer des images.")
            if sid in html_modified:
                continue
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(source["content"], "html.parser")
            if fmt == "pptx":
                container = soup.select_one("section.oria-slide")
            else:
                container = soup.find("main") or soup.find("body")
            if container is None:
                raise ValueError("Zone d'insertion introuvable dans le document.")
            for index, uri in enumerate(images):
                figure = soup.new_tag("figure")
                figure["class"] = "oria-user-image"
                img = soup.new_tag("img", src=uri)
                img["alt"] = "Image fournie par l'utilisateur"
                if fmt == "pptx":
                    # Placement en pixels dans la diapositive 1280x720 :
                    # ne pas laisser l'image hors champ sous le dernier bloc.
                    figure["style"] = (
                        f"position:absolute;left:770px;top:{150 + index*255}px;"
                        "width:420px;height:225px;margin:0"
                    )
                    img["style"] = "display:block;max-width:100%;max-height:100%;object-fit:contain"
                else:
                    img["style"] = "display:block;max-width:85%;height:auto;margin:12px auto"
                figure.append(img)
                container.append(figure)
            source["content"] = str(soup)
            html_modified.add(sid)
            continue
        native = spec.get("native_data")
        if fmt == "docx" and isinstance(native, dict) and isinstance(native.get("blocks"), list):
            native["blocks"].extend({"type": "image", "src": uri} for uri in images)
        elif fmt == "pptx" and isinstance(native, dict) and isinstance(native.get("slides"), list) and native["slides"]:
            slide = native["slides"][0]
            if not isinstance(slide, dict):
                raise ValueError("Diapositive native invalide.")
            slide.setdefault("elements", [])
            if not isinstance(slide["elements"], list):
                raise ValueError("Objets PowerPoint invalides.")
            for i, uri in enumerate(images):
                slide["elements"].append({"type": "image", "src": uri,
                                          "x": 7.5, "y": 1.6 + i * 2.65,
                                          "width": 4.5, "height": 2.4})
        elif fmt == "xlsx":
            # Si la feuille vient d'une table HTML, le convertisseur sait lire
            # les tables, mais pour placer les images il faut une source native.
            if not isinstance(native, dict) or not isinstance(native.get("sheets"), list) or not native["sheets"]:
                raise ValueError("Excel avec images nécessite native_data.sheets.")
            sheet = native["sheets"][0]
            if not isinstance(sheet, dict):
                raise ValueError("Feuille native invalide.")
            sheet.setdefault("images", [])
            if not isinstance(sheet["images"], list):
                raise ValueError("Images de feuille invalides.")
            for i, uri in enumerate(images):
                sheet["images"].append({"src": uri, "anchor": f"H{2 + i * 16}"})
        else:
            raise ValueError(f"Insertion d'image impossible pour {fmt} dans cette structure.")
    return result
