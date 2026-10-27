"""Private, bounded, read-only DOCX projection for ORIA chat previews.

Never render document-controlled HTML or execute fields, macros, links, or code.
The actual DOCX stays private and downloadable; this is an intentionally
limited, DOM-safe JSON projection for Web and Expo clients.
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


class DocumentPreviewError(ValueError):
    """Malformed, unsupported or oversized DOCX preview input."""


def preview_docx_bytes(content: bytes) -> dict[str, Any]:
    if not isinstance(content, bytes) or not content or len(content) > MAX_FILE_BYTES:
        raise DocumentPreviewError("Fichier Word trop volumineux ou vide.")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            if (len(members) > 550 or
                sum(member.file_size for member in members) > MAX_ARCHIVE_BYTES or
                any(member.file_size > 20 * 1024 * 1024 for member in members) or
                "word/document.xml" not in archive.namelist()):
                raise DocumentPreviewError("Archive Word non prise en charge pour l'aperçu.")
    except (zipfile.BadZipFile, OSError) as exc:
        raise DocumentPreviewError("Le fichier Word n'est pas lisible.") from exc

    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
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
        part = document.part.related_parts.get(rel_id)
        if part is None:
            return None
        blob = bytes(getattr(part, "blob", b""))
        mime = None
        if blob.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif blob.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif blob[:6] in (b"GIF87a", b"GIF89a"):
            mime = "image/gif"
        elif blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
            mime = "image/webp"
        # SVG, EMF, WMF and external images are never embedded in the preview.
        if not mime or not blob or len(blob) > MAX_IMAGE_BYTES or total_images + len(blob) > MAX_TOTAL_IMAGE_BYTES:
            truncated = True
            return None
        image_count += 1
        total_images += len(blob)
        encoded = f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"
        images[rel_id] = encoded
        return encoded

    def inline_for_paragraph(paragraph: Paragraph) -> list[dict[str, Any]]:
        nonlocal total_chars, truncated
        elements: list[dict[str, Any]] = []
        for run in paragraph.runs:
            value = run.text or ""
            if value:
                budget = min(3000, MAX_TOTAL_TEXT - total_chars)
                if budget <= 0:
                    truncated = True
                    break
                if len(value) > budget:
                    truncated = True
                value = value[:budget]
                total_chars += len(value)
                elements.append({
                    "type": "text", "text": value,
                    "bold": bool(run.bold), "italic": bool(run.italic),
                    "underline": bool(run.underline),
                })
            for blip in run._element.xpath(".//a:blip"):
                rel_id = blip.get(qn("r:embed"))
                if rel_id:
                    src = image_for_relation(rel_id)
                    if src:
                        elements.append({"type": "image", "src": src})
        # Paragraph.text sometimes contains words represented as hyperlinks.
        # The fallback provides readable text without exposing a clickable URL.
        if not elements and paragraph.text:
            value = paragraph.text[: min(3000, MAX_TOTAL_TEXT - total_chars)]
            total_chars += len(value)
            elements.append({"type": "text", "text": value,
                             "bold": False, "italic": False, "underline": False})
        return elements

    for element in document.element.body.iterchildren():
        if len(blocks) >= MAX_BLOCKS or total_chars >= MAX_TOTAL_TEXT:
            truncated = True
            break
        if element.tag == qn("w:p"):
            para = Paragraph(element, document)
            inline = inline_for_paragraph(para)
            if not inline:
                # Blank paragraphs are often deliberate spacing: reduce noise.
                continue
            style = (para.style.name if para.style is not None else "") or ""
            lower = style.lower()
            if lower in {"title", "titre"}:
                kind, level = "title", 1
            elif lower in {"subtitle", "sous-titre"}:
                kind, level = "subtitle", 2
            elif lower.startswith("heading") or lower.startswith("titre "):
                found = re.search(r"(\d+)", lower)
                kind, level = "heading", min(6, max(1, int(found.group(1)) if found else 2))
            elif "list bullet" in lower or "liste à puces" in lower:
                kind, level = "bullet", 0
            elif "list number" in lower or "liste numérotée" in lower:
                kind, level = "number", 0
            else:
                kind, level = "paragraph", 0
            blocks.append({"type": kind, "level": level, "runs": inline})
        elif element.tag == qn("w:tbl"):
            table = Table(element, document)
            cells: list[list[str]] = []
            for row in table.rows[:MAX_ROWS]:
                record = []
                for cell in row.cells[:MAX_COLUMNS]:
                    remaining = max(0, MAX_TOTAL_TEXT - total_chars)
                    value = cell.text[: min(1200, remaining)]
                    record.append(value)
                    total_chars += len(value)
                cells.append(record)
            if len(table.rows) > MAX_ROWS or any(len(row.cells) > MAX_COLUMNS for row in table.rows):
                truncated = True
            blocks.append({"type": "table", "rows": cells})
    return {"blocks": blocks, "truncated": truncated, "read_only": True,
            "image_count": image_count}
