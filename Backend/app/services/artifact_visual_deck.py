"""ORIA Code-First : export visuel statique HTML/CSS -> PPTX / ODP.

Opt-in : uniquement les sources HTML documentaires comportant des sections
<section class="oria-slide">. La validation HTML/CSS, les images data-URI
et l'interdiction des ressources externes appartiennent à ArtifactService
avant cet appel et à son moteur PDF pendant le rendu.

Ce moteur privilégie la fidélité graphique : chaque diapositive est une image
PNG générée depuis une page PDF. Les objets ne sont pas modifiables séparément.
Le chemin natif et modifiable des PPTX/ODP existants reste inchangé.
"""
from __future__ import annotations

import io
from typing import Callable

from bs4 import BeautifulSoup

MAX_VISUAL_SLIDES = 50
PAGE_WIDTH_INCHES = 13.333
PAGE_HEIGHT_INCHES = 7.5
RASTER_DPI = 108  # 1.5 x 72, lisibilité vs taille


class VisualDeckError(ValueError):
    """Le document statique ne respecte pas la convention de diapositives."""


def _slide_pages(html: str) -> list[tuple[str, str]]:
    """Isole les diapositives : une seule page PDF est autorisée par section."""
    if not isinstance(html, str) or not html.strip():
        raise VisualDeckError("Source de presentation HTML vide.")
    soup = BeautifulSoup(html, "html.parser")
    slides = soup.select("section.oria-slide")
    if not 1 <= len(slides) <= MAX_VISUAL_SLIDES:
        raise VisualDeckError("Presentation visuelle : entre 1 et 50 sections .oria-slide attendues.")
    if any(s.find_parent("section", class_="oria-slide") for s in slides):
        raise VisualDeckError("Les diapositives .oria-slide ne peuvent pas etre imbriquees.")
    # Les sélecteurs CSS sont conservés. Le conteneur main.oria-deck est fixe
    # et le moteur réutilise exclusivement les styles déjà contrôlés.
    css = "\n".join(tag.get_text() for tag in soup.find_all("style"))
    sizing = """
@page {size: 13.333in 7.5in; margin: 0;}
html,body {margin:0 !important; padding:0 !important; width:1280px;}
main.oria-deck {margin:0 !important; padding:0 !important; display:block; width:1280px;}
section.oria-slide {box-sizing:border-box; display:block; position:relative;
  width:1280px; height:720px; max-height:720px;
  margin:0; overflow:hidden; break-inside:avoid; page-break-inside:avoid;}
"""
    result = []
    for index, slide in enumerate(slides, 1):
        if not slide.get_text(" ", strip=True) and not slide.find("img"):
            raise VisualDeckError(f"La diapositive {index} est vide.")
        title = slide.find(["h1", "h2", "h3"])
        label = title.get_text(" ", strip=True)[:180] if title else f"Diapositive {index}"
        markup = str(slide)
        # Le fragment n'hérite pas des boutons/JS/ressources non documentaires
        # éventuellement présents hors des sections.
        isolated = ('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
                    '<style>' + css + '\n' + sizing + '</style></head><body>'
                    '<main class="oria-deck">' + markup + '</main></body></html>')
        result.append((isolated, label))
    return result


def _render_slides(
    html: str, *, pdf_renderer: Callable[[str], bytes],
) -> list[tuple[bytes, str]]:
    """Ne charge aucune URL : le pdf_renderer doit être le rendu isolé ORIA."""
    try:
        import fitz
    except ImportError as exc:
        raise VisualDeckError("Rendu visuel : PyMuPDF indisponible sur le serveur.") from exc
    output: list[tuple[bytes, str]] = []
    for index, (fragment, label) in enumerate(_slide_pages(html), 1):
        pdf = pdf_renderer(fragment)
        if not isinstance(pdf, bytes) or not pdf.startswith(b"%PDF"):
            raise VisualDeckError("Le convertisseur PDF a retourne une sortie invalide.")
        with fitz.open(stream=pdf, filetype="pdf") as document:
            if len(document) != 1:
                raise VisualDeckError(
                    f"Diapositive {index} : composition debordante ({len(document)} pages). "
                    "Reduire le contenu ou les tailles avant export."
                )
            page = document[0]
            if abs(page.rect.width / page.rect.height - 16 / 9) > .02:
                raise VisualDeckError("Le rendu de diapositive n'est pas au format 16:9.")
            # Une règle CSS peut masquer le contenu sans créer de 2e page.
            # Éviter de livrer silencieusement une diapositive presque vide.
            slide_text = BeautifulSoup(fragment, "html.parser").select_one("section.oria-slide")
            expected_length = len(slide_text.get_text(" ", strip=True)) if slide_text else 0
            rendered_length = len(page.get_text().strip())
            if expected_length >= 100 and rendered_length < expected_length * .55:
                raise VisualDeckError(
                    f"Diapositive {index} : une partie importante du texte n'a pas ete rendue."
                )
            pix = page.get_pixmap(matrix=fitz.Matrix(RASTER_DPI / 72, RASTER_DPI / 72), alpha=False)
            data = pix.tobytes("png")
            if len(data) > 5 * 1024 * 1024:
                raise VisualDeckError("Image de diapositive trop volumineuse.")
            output.append((data, label))
    return output


def _make_pptx(pages: list[tuple[bytes, str]]) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches
    prs = Presentation()
    prs.slide_width = Inches(PAGE_WIDTH_INCHES)
    prs.slide_height = Inches(PAGE_HEIGHT_INCHES)
    for png, title in pages:
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        picture = slide.shapes.add_picture(
            io.BytesIO(png), 0, 0, width=prs.slide_width, height=prs.slide_height
        )
        picture.name = "ORIA_VISUAL_SLIDE"
        # Notes non visuelles pour retrouver les titres lors de la relecture.
        try:
            note = slide.notes_slide.notes_text_frame
            if note is not None:
                note.text = title
        except (AttributeError, ValueError):
            pass
    result = io.BytesIO()
    prs.save(result)
    return result.getvalue()


def _make_odp(pages: list[tuple[bytes, str]]) -> bytes:
    from odf.opendocument import OpenDocumentPresentation
    from odf import draw, style
    doc = OpenDocumentPresentation()
    page_layout = style.PageLayout(name="OriaLandscape")
    page_layout.addElement(style.PageLayoutProperties(
        pagewidth="33.866cm", pageheight="19.05cm",
        printorientation="landscape", margin="0cm"))
    doc.automaticstyles.addElement(page_layout)
    doc.masterstyles.addElement(style.MasterPage(
        name="OriaMaster", pagelayoutname="OriaLandscape"))
    for index, (png, title) in enumerate(pages, 1):
        page = draw.Page(name=f"ORIA_VISUAL_{index}", masterpagename="OriaMaster")
        image_name = doc.addPictureFromString(png, mediatype="image/png")
        frame = draw.Frame(x="0cm", y="0cm", width="33.866cm", height="19.05cm")
        frame.addElement(draw.Image(href=image_name, type="simple", show="embed", actuate="onLoad"))
        page.addElement(frame)
        doc.presentation.addElement(page)
    result = io.BytesIO()
    doc.save(result)
    return result.getvalue()


def compile_visual_deck(
    html: str, *, fmt: str, pdf_renderer: Callable[[str], bytes],
) -> bytes:
    """Opt-in. Aucun repli silencieux vers des listes à puces."""
    if fmt not in {"pptx", "odp"}:
        raise VisualDeckError("Format de presentation visuelle non pris en charge.")
    pages = _render_slides(html, pdf_renderer=pdf_renderer)
    return _make_pptx(pages) if fmt == "pptx" else _make_odp(pages)
