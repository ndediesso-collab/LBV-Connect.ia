"""Aperçu DOCX ORIA : projection JSON privée, bornée et **en lecture seule**.

Conçu pour les clients Web/Expo déjà déployés :
  {"blocks": [{"type": ..., "level": ..., "runs": [...]}, ...],
   "truncated": bool, "read_only": True, "image_count": int}

Les nouveaux champs (align, list_level, superscript, subscript, math, etc.)
sont optionnels et ne rendent pas les anciens lecteurs incompatibles.

N'exécute aucune macro, instruction de champ, formule, URL ou HTML du DOCX.
N'émet jamais de lien cliquable ni de HTML piloté par le document.
Le document original reste privé et téléchargeable par son API autorisée.
"""
from __future__ import annotations

import base64
import io
import re
import zipfile
from typing import Any

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 45 * 1024 * 1024
MAX_BLOCKS = 360
MAX_TOTAL_TEXT = 120_000
MAX_IMAGE_BYTES = 1 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024
MAX_IMAGES = 16
MAX_ROWS = 70
MAX_COLUMNS = 9
MAX_RUN_TEXT = 3000
MAX_XML_DEPTH = 40
MAX_MATH_NODES = 600
MAX_IMAGE_PIXELS = 12_000_000


class DocumentPreviewError(ValueError):
    """Malformed, unsupported or oversized DOCX preview input."""


def _check_archive(content: bytes) -> None:
    """Limites AVANT que python-docx décompresse / interprète les parties OOXML."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            names = [m.filename for m in members]
            if (
                len(members) > 550
                or not members
                or len(names) != len(set(names))
                or "word/document.xml" not in names
                or "[Content_Types].xml" not in names
                or any(m.flag_bits & 0x1 for m in members)
                or any(
                    m.filename.startswith("/")
                    or "\\" in m.filename
                    or ".." in m.filename.split("/")
                    for m in members
                )
                or sum(m.file_size for m in members) > MAX_ARCHIVE_BYTES
                or any(m.file_size > 20 * 1024 * 1024 for m in members)
            ):
                raise DocumentPreviewError(
                    "Archive Word non prise en charge pour l'aperçu."
                )
    except (zipfile.BadZipFile, OSError, OverflowError) as exc:
        raise DocumentPreviewError("Le fichier Word n'est pas lisible.") from exc


def _math_linear(node: Any, qn: Any, *, depth: int = 0, budget: list[int] | None = None) -> str:
    """Projection **textuelle** bornée de formules Office Math (OMML).

    Ne prétend pas produire du LaTeX ni un rendu de mise en page fidèle.
    Les opérateurs restent lisibles même si le frontend ne connaît pas OMML.
    """
    if budget is None:
        budget = [MAX_MATH_NODES]
    if budget[0] <= 0 or depth > MAX_XML_DEPTH:
        return "…"
    budget[0] -= 1

    def part(parent: Any, tag: str) -> str:
        child = parent.find(qn(f"m:{tag}"))
        return _math_linear(child, qn, depth=depth + 1, budget=budget) if child is not None else ""

    tag = node.tag if node is not None else ""
    if tag == qn("m:t"):
        return node.text or ""
    if tag == qn("m:f"):
        numerator, denominator = part(node, "num"), part(node, "den")
        return f"({numerator})/({denominator})" if denominator else numerator
    if tag == qn("m:sSup"):
        return f"{part(node, 'e')}^({part(node, 'sup')})"
    if tag == qn("m:sSub"):
        return f"{part(node, 'e')}_({part(node, 'sub')})"
    if tag == qn("m:sSubSup"):
        return f"{part(node, 'e')}_({part(node, 'sub')})^({part(node, 'sup')})"
    if tag == qn("m:rad"):
        deg, expr = part(node, "deg"), part(node, "e")
        return f"{deg}√({expr})" if deg else f"√({expr})"
    if tag == qn("m:nary"):
        props = node.find(qn("m:naryPr"))
        op = "∑"
        if props is not None:
            char = props.find(qn("m:chr"))
            if char is not None:
                op = char.get(qn("m:val"), op)[:2]
        lower, upper, expr = part(node, "sub"), part(node, "sup"), part(node, "e")
        return op + (f"_({lower})" if lower else "") + (f"^({upper})" if upper else "") + expr
    if tag == qn("m:d"):
        expr = part(node, "e")
        return f"({expr})"
    if tag == qn("m:limLow"):
        return f"{part(node, 'e')}_({part(node, 'lim')})"
    if tag == qn("m:limUpp"):
        return f"{part(node, 'e')}^({part(node, 'lim')})"
    if tag == qn("m:func"):
        return f"{part(node, 'fName')}{part(node, 'e')}"
    if tag == qn("m:acc"):
        return part(node, "e")  # Accent omis plutôt que d'inventer un glyphe.
    if tag == qn("m:bar"):
        return f"¯({part(node, 'e')})"
    if tag == qn("m:box") or tag == qn("m:borderBox"):
        return part(node, "e")
    if tag == qn("m:m"):
        rows = [
            _math_linear(child, qn, depth=depth + 1, budget=budget)
            for child in node if child.tag == qn("m:mr")
        ]
        return "[" + "; ".join(rows) + "]"
    if tag == qn("m:mr"):
        return ", ".join(
            _math_linear(child, qn, depth=depth + 1, budget=budget)
            for child in node if child.tag == qn("m:e")
        )
    if tag == qn("m:eqArr"):
        return "; ".join(
            _math_linear(child, qn, depth=depth + 1, budget=budget)
            for child in node if child.tag == qn("m:e")
        )
    # Fallback borné : seules les valeurs textuelles m:t sont exposées.
    return "".join(
        _math_linear(child, qn, depth=depth + 1, budget=budget)
        for child in node
        if child.tag != qn("m:ctrlPr")
    )


def _raster_looks_safe(blob: bytes, mime: str) -> bool:
    """Refuse les images malformées / dimensions démesurées quand Pillow existe.

    Pillow n'est pas une dépendance imposée à ce module : la validation des
    signatures et des tailles byte reste active même sans Pillow.
    """
    try:
        from PIL import Image
    except ImportError:
        return True
    try:
        with Image.open(io.BytesIO(blob)) as img:
            expected = {
                "image/png": "PNG", "image/jpeg": "JPEG",
                "image/gif": "GIF", "image/webp": "WEBP",
            }[mime]
            width, height = img.size
            return (
                img.format == expected
                and 0 < width <= 12_000
                and 0 < height <= 12_000
                and width * height <= MAX_IMAGE_PIXELS
                and int(getattr(img, "n_frames", 1)) <= 120
            )
    except (ValueError, OSError, TypeError, KeyError, OverflowError):
        return False


def preview_docx_bytes(content: bytes) -> dict[str, Any]:
    """Retourne uniquement des données JSON sûres pour rendu texte/éléments natifs.

    Le contrôleur HTTP doit vérifier la propriété du fichier avant cet appel,
    plafonner taille de réponse et désactiver le cache partagé. Ce parseur
    n'effectue lui-même aucun accès Storage, réseau ni authentification.
    """
    if not isinstance(content, bytes) or not content or len(content) > MAX_FILE_BYTES:
        raise DocumentPreviewError("Fichier Word trop volumineux ou vide.")
    _check_archive(content)

    from docx import Document
    from docx.table import Table, _Row
    from docx.text.paragraph import Paragraph
    from docx.text.run import Run
    from docx.oxml.ns import qn

    try:
        document = Document(io.BytesIO(content))
    except Exception as exc:
        raise DocumentPreviewError("Le document Word ne peut pas être ouvert.") from exc

    blocks: list[dict[str, Any]] = []
    truncated = False
    image_count = 0
    total_images = 0
    total_chars = 0
    images: dict[str, str] = {}

    def image_for_relation(rel_id: str) -> str | None:
        nonlocal image_count, total_images, truncated
        if rel_id in images:
            return images[rel_id]
        if image_count >= MAX_IMAGES:
            truncated = True
            return None
        try:
            relationship = document.part.rels.get(rel_id)
            if relationship is None or relationship.is_external or not relationship.reltype.endswith("/image"):
                return None
            part = document.part.related_parts.get(rel_id)
            blob = bytes(getattr(part, "blob", b""))
        except (KeyError, ValueError, TypeError):
            truncated = True
            return None

        mime = None
        if blob.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif blob.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif blob[:6] in (b"GIF87a", b"GIF89a"):
            mime = "image/gif"
        elif blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
            mime = "image/webp"
        # Jamais de SVG, EMF/WMF, images externes ou contenu contrôlant le DOM.
        if (
            not mime or not blob or len(blob) > MAX_IMAGE_BYTES
            or total_images + len(blob) > MAX_TOTAL_IMAGE_BYTES
            or not _raster_looks_safe(blob, mime)
        ):
            truncated = True
            return None
        image_count += 1
        total_images += len(blob)
        encoded = f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"
        images[rel_id] = encoded
        return encoded

    def append_text(out: list[dict[str, Any]], text: str, **formatting: Any) -> None:
        nonlocal total_chars, truncated
        if not text:
            return
        remaining = MAX_TOTAL_TEXT - total_chars
        if remaining <= 0:
            truncated = True
            return
        clipped = text[:min(MAX_RUN_TEXT, remaining)]
        if len(clipped) != len(text):
            truncated = True
        if not clipped:
            return
        total_chars += len(clipped)
        out.append({
            "type": "text", "text": clipped,
            "bold": bool(formatting.get("bold")),
            "italic": bool(formatting.get("italic")),
            "underline": bool(formatting.get("underline")),
            **({"superscript": True} if formatting.get("superscript") else {}),
            **({"subscript": True} if formatting.get("subscript") else {}),
            **({"strike": True} if formatting.get("strike") else {}),
            **({"math": True} if formatting.get("math") else {}),
        })

    def inline_for_paragraph(paragraph: Paragraph) -> list[dict[str, Any]]:
        """Parcourt w:r / w:hyperlink / m:oMath dans leur ordre réel.

        paragraph.runs seul perd les hyperliens et les équations OMML.
        Les cibles des liens, le HTML et les instructions de champ sont ignorés.
        """
        nonlocal truncated
        out: list[dict[str, Any]] = []
        element_count = [0]

        def descend(node: Any, depth: int = 0) -> None:
            nonlocal truncated
            if total_chars >= MAX_TOTAL_TEXT:
                truncated = True
                return
            if depth > MAX_XML_DEPTH or element_count[0] > 10_000:
                truncated = True
                return
            element_count[0] += 1
            tag = node.tag
            if tag == qn("w:r"):
                run = Run(node, paragraph)
                fmt = {
                    "bold": run.bold,
                    "italic": run.italic,
                    "underline": run.underline,
                    "superscript": run.font.superscript,
                    "subscript": run.font.subscript,
                    "strike": run.font.strike,
                }
                for child in node:
                    if child.tag == qn("w:t"):
                        append_text(out, child.text or "", **fmt)
                    elif child.tag == qn("w:tab"):
                        append_text(out, "\t", **fmt)
                    elif child.tag in {qn("w:br"), qn("w:cr")}:
                        append_text(out, "\n", **fmt)
                    elif child.tag == qn("w:noBreakHyphen"):
                        append_text(out, "‑", **fmt)
                    elif child.tag == qn("w:drawing") or child.tag == qn("w:pict"):
                        for blip in child.xpath(".//a:blip"):
                            rel_id = blip.get(qn("r:embed"))
                            if rel_id:
                                source = image_for_relation(rel_id)
                                if source:
                                    out.append({"type": "image", "src": source})
                    elif child.tag in {qn("m:oMath"), qn("m:oMathPara")}:
                        append_text(out, _math_linear(child, qn), math=True)
                return
            if tag in {qn("m:oMath"), qn("m:oMathPara")}:
                append_text(out, _math_linear(node, qn), math=True)
                return
            # Seuls les conteneurs visibles autorisés sont parcourus.
            # w:del / w:instrText / champs actifs / commentaires ignorés.
            if tag in {
                qn("w:p"), qn("w:hyperlink"), qn("w:ins"),
                qn("w:sdt"), qn("w:sdtContent"), qn("w:smartTag"),
                qn("w:fldSimple"),
            }:
                for child in node:
                    descend(child, depth + 1)

        descend(paragraph._element)
        # paragraph.text fallback volontairement absent : pourrait réintroduire
        # des contenus de champ ou des mots déjà comptabilisés autrement.
        return out

    def numbered_list_kind(num_id: int, level: int) -> str:
        """Résout bullet/decimal pour w:numPr sans exécuter de champs."""
        try:
            root = document.part.numbering_part.element
            abstract_id = None
            for element in root:
                if element.tag == qn("w:num") and element.get(qn("w:numId")) == str(num_id):
                    pointer = element.find(qn("w:abstractNumId"))
                    abstract_id = pointer.get(qn("w:val")) if pointer is not None else None
                    break
            if abstract_id is None:
                return "number"
            for element in root:
                if element.tag == qn("w:abstractNum") and element.get(qn("w:abstractNumId")) == abstract_id:
                    for lvl in element:
                        if lvl.tag == qn("w:lvl") and lvl.get(qn("w:ilvl")) == str(level):
                            fmt = lvl.find(qn("w:numFmt"))
                            return "bullet" if fmt is not None and fmt.get(qn("w:val")) == "bullet" else "number"
        except (AttributeError, ValueError, TypeError):
            pass
        return "number"

    def paragraph_kind(para: Paragraph) -> tuple[str, int, dict[str, Any]]:
        style = (para.style.name if para.style is not None else "") or ""
        lower = style.lower()
        extra: dict[str, Any] = {}
        alignment = para.alignment
        if alignment is not None:
            # 0 gauche / 1 centre / 2 droite / 3 justifié.
            extra["align"] = {0: "left", 1: "center", 2: "right", 3: "justify"}.get(int(alignment), "left")
        if lower in {"title", "titre"}:
            return "title", 1, extra
        if lower in {"subtitle", "sous-titre"}:
            return "subtitle", 2, extra
        if lower.startswith(("heading", "titre ")):
            found = re.search(r"(\d+)", lower)
            level = max(1, min(6, int(found.group(1)) if found else 2))
            return "heading", level, extra
        if "list bullet" in lower or "liste à puces" in lower:
            return "bullet", 0, extra
        if "list number" in lower or "liste numérotée" in lower:
            return "number", 0, extra
        # Les listes Word peuvent utiliser une numérotation directe sans style.
        props = para._p.pPr
        numpr = props.numPr if props is not None else None
        if numpr is not None and numpr.numId is not None:
            level = numpr.ilvl.val if numpr.ilvl is not None else 0
            extra["list_level"] = max(0, min(8, int(level)))
            return numbered_list_kind(numpr.numId.val, level), 0, extra
        return "paragraph", 0, extra

    def cell_text(cell: Any) -> str:
        nonlocal truncated
        lines: list[str] = []
        for para in cell.paragraphs:
            if total_chars >= MAX_TOTAL_TEXT:
                truncated = True
                break
            elements = inline_for_paragraph(para)
            text = "".join(el.get("text", "") for el in elements if el.get("type") == "text")
            if text:
                lines.append(text)
            if sum(len(line) for line in lines) > 1200:
                truncated = True
                break
        return "\n".join(lines)

    for element in document.element.body.iterchildren():
        if len(blocks) >= MAX_BLOCKS or total_chars >= MAX_TOTAL_TEXT:
            truncated = True
            break
        if element.tag == qn("w:p"):
            para = Paragraph(element, document)
            inline = inline_for_paragraph(para)
            if not inline:
                continue
            kind, level, extra = paragraph_kind(para)
            blocks.append({"type": kind, "level": level, "runs": inline, **extra})
        elif element.tag == qn("w:tbl"):
            table = Table(element, document)
            rows: list[list[str]] = []
            # Les tableaux imbriqués ne sont pas interprétés comme HTML.
            row_index = 0
            for tr in element.iterchildren():
                if tr.tag != qn("w:tr"):
                    continue
                if row_index >= MAX_ROWS:
                    truncated = True
                    break
                row_index += 1
                row = _Row(tr, table)
                record: list[str] = []
                for col_index, cell in enumerate(row.cells):
                    if col_index >= MAX_COLUMNS:
                        truncated = True
                        break
                    text = cell_text(cell)
                    if len(text) > 1200:
                        truncated = True
                    record.append(text[:1200])
                rows.append(record)
            blocks.append({"type": "table", "rows": rows})
        # w:sectPr, altChunk, fields et objets OLE ne sont jamais interprétés.

    return {
        "blocks": blocks, "truncated": truncated,
        "read_only": True, "image_count": image_count,
    }


__all__ = ["preview_docx_bytes", "DocumentPreviewError"]
