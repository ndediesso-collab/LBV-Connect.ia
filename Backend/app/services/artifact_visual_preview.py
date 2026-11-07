"""Aperçu exact (miniatures) des présentations ORIA Code-First image-based.

Appelé uniquement après authentification, contrôle propriétaire et chargement
borné par la route universelle déjà en place dans ORIA.
"""
from __future__ import annotations

import base64
import io
import zipfile
from xml.etree import ElementTree as ET

MAX_THUMBNAILS = 18
MAX_PREVIEW_ZIP_MEMBERS = 1000
MAX_DECOMPRESSED = 90 * 1024 * 1024


def _thumbnail(image_bytes: bytes) -> str:
    from PIL import Image
    with Image.open(io.BytesIO(image_bytes)) as im:
        if im.width * im.height > 9_000_000:
            raise ValueError("Image de diapositive trop grande pour l'aperçu.")
        rgb = im.convert("RGB")
        rgb.thumbnail((960, 540), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        rgb.save(out, format="JPEG", quality=83, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def _zip_safe(binary: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(binary)) as z:
        info = z.infolist()
        if len(info) > MAX_PREVIEW_ZIP_MEMBERS or sum(e.file_size for e in info) > MAX_DECOMPRESSED:
            raise ValueError("Archive de présentation trop volumineuse pour l'aperçu.")
        if any(e.file_size > 12 * 1024 * 1024 for e in info):
            raise ValueError("Élément de présentation trop volumineux.")


def preview_visual_deck(extension: str, binary: bytes) -> dict | None:
    """Retourne None pour les présentations natives existantes (aucun changement)."""
    if extension not in {"pptx", "odp"} or not zipfile.is_zipfile(io.BytesIO(binary)):
        return None
    _zip_safe(binary)
    slides: list[dict] = []
    if extension == "pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(binary))
        for slide in prs.slides:
            if (len(slide.shapes) != 1 or
                slide.shapes[0].name != "ORIA_VISUAL_SLIDE" or
                not hasattr(slide.shapes[0], "image")):
                return None
        for i, slide in enumerate(prs.slides, 1):
            if i > MAX_THUMBNAILS:
                break
            slides.append({"title": f"Diapositive {i}", "texts": [],
                           "image_data": _thumbnail(slide.shapes[0].image.blob)})
        count = len(prs.slides)
    else:
        with zipfile.ZipFile(io.BytesIO(binary)) as z:
            doc = ET.fromstring(z.read("content.xml"))
            pages = list(doc.iter("{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}page"))
            draw_ns = "{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}"
            link_ns = "{http://www.w3.org/1999/xlink}"
            if not pages or not all((pg.get(draw_ns + "name") or "").startswith("ORIA_VISUAL_") for pg in pages):
                return None
            for i, page in enumerate(pages[:MAX_THUMBNAILS], 1):
                imgs = list(page.iter(draw_ns + "image"))
                if len(imgs) != 1:
                    return None
                href = imgs[0].get(link_ns + "href", "")
                if not href.startswith("Pictures/") or ".." in href:
                    return None
                slides.append({"title": f"Diapositive {i}", "texts": [],
                               "image_data": _thumbnail(z.read(href))})
            count = len(pages)
    return {"kind": "slides", "slides": slides, "truncated": count > MAX_THUMBNAILS,
            "note": "Aperçu visuel fidèle en lecture seule. Les éléments graphiques de ce fichier ne sont pas modifiables séparément."}
