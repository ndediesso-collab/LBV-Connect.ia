"""ORIA — aperçus PASSIFS des fichiers générés, sans exécuter le contenu.

Aucun effet sur la génération, les crédits, les paiements ou les originaux.
Aperçus volontairement bornés et simplifiés ; télécharger pour fidélité complète.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from typing import Any

MAX_PREVIEW_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARS = 90_000
MAX_ZIP_ENTRIES = 350
MAX_UNCOMPRESSED_BYTES = 35 * 1024 * 1024
MAX_ENTRY_BYTES = 4 * 1024 * 1024
MAX_SLIDES = 45
MAX_ROWS = 50
MAX_COLS = 16


class UniversalPreviewError(ValueError):
    """Fichier invalide ou aperçu impossible dans les limites autorisées."""


def _clean(v: Any, limit: int = 2000) -> str:
    return str(v if v is not None else "").replace("\x00", "")[:limit]


def _text_preview(value: str, *, note: str = "") -> dict:
    return {"kind": "text", "text": value[:MAX_TEXT_CHARS],
            "truncated": len(value) > MAX_TEXT_CHARS,
            "note": note}


def _read_text(blob: bytes) -> str:
    try:
        return blob.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise UniversalPreviewError("Le fichier ne contient pas du texte UTF-8 lisible.")


def _zip_members(binary: bytes) -> tuple[zipfile.ZipFile, list[zipfile.ZipInfo]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(binary))
        infos = z.infolist()
        if len(infos) > MAX_ZIP_ENTRIES or sum(x.file_size for x in infos) > MAX_UNCOMPRESSED_BYTES:
            z.close()
            raise UniversalPreviewError("Archive trop volumineuse pour l'aperçu.")
        if any(x.file_size > MAX_ENTRY_BYTES for x in infos):
            z.close()
            raise UniversalPreviewError("L'archive contient un élément trop volumineux pour l'aperçu.")
        return z, infos
    except (OSError, zipfile.BadZipFile, OverflowError, RuntimeError) as exc:
        raise UniversalPreviewError("Archive illisible.") from exc


def _zip_xml(binary: bytes, filename: str) -> ET.Element:
    z, _ = _zip_members(binary)
    try:
        if filename not in z.namelist():
            raise UniversalPreviewError("La structure de ce fichier est incomplète.")
        content = z.read(filename)
        if len(content) > MAX_ENTRY_BYTES or b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
            raise UniversalPreviewError("XML documentaire non autorisé.")
        return ET.fromstring(content)
    except (ET.ParseError, UnicodeError) as exc:
        raise UniversalPreviewError("XML documentaire illisible.") from exc
    finally:
        z.close()


def _ods_sheet_preview(binary: bytes) -> dict:
    root = _zip_xml(binary, "content.xml")
    ns = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
    text_ns = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    sheets: list[dict] = []
    for table in root.iter(ns + "table"):
        if len(sheets) >= 12:
            break
        title = _clean(table.get(ns + "name") or f"Feuille {len(sheets)+1}", 90)
        rows: list[list[str]] = []
        for tr in table.iter(ns + "table-row"):
            if len(rows) >= MAX_ROWS:
                break
            row: list[str] = []
            for cell in tr:
                if cell.tag not in (ns + "table-cell", ns + "covered-table-cell"):
                    continue
                repeated = min(MAX_COLS - len(row), max(1, min(100, int(cell.get(ns + "number-columns-repeated", "1")))))
                content = _clean(" ".join((n.text or "") for n in cell.iter(text_ns + "p")), 250)
                row.extend([content] * repeated)
                if len(row) >= MAX_COLS:
                    break
            if any(row):
                rows.append(row)
        sheets.append({"name": title, "rows": rows})
    return {"kind": "tables", "tables": sheets, "truncated": len(sheets) >= 12,
            "note": "Aperçu tabulaire simplifié ; valeurs et formules complètes dans le fichier."}


def _odp_preview(binary: bytes) -> dict:
    root = _zip_xml(binary, "content.xml")
    page_ns = "{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}"
    text_ns = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    slides = []
    for pg in root.iter(page_ns + "page"):
        if len(slides) >= MAX_SLIDES:
            break
        texts = [_clean("".join(t.itertext()), 1200) for t in pg.iter()
                 if t.tag in (text_ns + "p", text_ns + "h")]
        texts = [t for t in texts if t.strip()][:40]
        slides.append({"title": texts[0] if texts else f"Diapositive {len(slides)+1}", "texts": texts})
    return {"kind": "slides", "slides": slides, "truncated": len(slides) >= MAX_SLIDES,
            "note": "Aperçu du contenu des diapositives ; animations et mise en page dans le téléchargement."}


def _odt_preview(binary: bytes) -> dict:
    root = _zip_xml(binary, "content.xml")
    tns = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    texts = [_clean("".join(n.itertext()), 4000) for n in root.iter()
             if n.tag in (tns + "p", tns + "h")]
    return _text_preview("\n\n".join(t for t in texts if t.strip()),
                         note="Aperçu du texte ; mise en page complète dans le fichier.")


def _pptx_preview(binary: bytes) -> dict:
    # On vérifie d'abord que le ZIP Office ne soit pas une bombe de décompression.
    z, _ = _zip_members(binary)
    z.close()
    try:
        from pptx import Presentation
        prs = Presentation(io.BytesIO(binary))
        slides = []
        for index, slide in enumerate(prs.slides):
            if index >= MAX_SLIDES:
                break
            texts: list[str] = []
            for shape in slide.shapes:
                if getattr(shape, 'has_text_frame', False):
                    texts.extend(_clean(p.text, 900) for p in shape.text_frame.paragraphs if p.text.strip())
                elif getattr(shape, 'has_table', False):
                    texts.extend(" | ".join(_clean(c.text, 120) for c in row.cells)
                                 for row in list(shape.table.rows)[:12])
                if len(texts) >= 45:
                    break
            slides.append({"title": texts[0] if texts else f"Diapositive {len(slides)+1}",
                           "texts": texts[:45]})
        return {"kind": "slides", "slides": slides, "truncated": len(prs.slides) > MAX_SLIDES,
                "note": "Aperçu textuel des diapositives, sans leurs animations ni leur rendu graphique."}
    except Exception as exc:
        raise UniversalPreviewError("Présentation PowerPoint illisible.") from exc


def _epub_preview(binary: bytes) -> dict:
    z, infos = _zip_members(binary)
    try:
        parts = []
        # Le contenu est uniquement extrait en texte : aucun HTML actif n'est rendu.
        from bs4 import BeautifulSoup
        for item in infos:
            if len(parts) >= 18:
                break
            if item.filename.lower().endswith(('.xhtml', '.html', '.htm')) and item.file_size <= 500_000:
                html = z.read(item.filename)
                soup = BeautifulSoup(html, "html.parser")
                for el in soup(("script", "style", "iframe", "object", "embed")):
                    el.decompose()
                text = soup.get_text(" ", strip=True)
                if text:
                    parts.append(f"{item.filename}\n{text[:3500]}")
        return _text_preview("\n\n".join(parts), note="Extrait du livre numérique ; mise en page complète dans l'EPUB.")
    finally:
        z.close()


def _sqlite_preview(binary: bytes) -> dict:
    if not binary.startswith(b"SQLite format 3\x00"):
        raise UniversalPreviewError("Base SQLite invalide.")
    if len(binary) > 5_000_000:
        raise UniversalPreviewError("Base trop volumineuse pour l'aperçu.")
    conn = sqlite3.connect(":memory:")
    try:
        # sqlite3.Connection.deserialize lit l'image en mémoire, sans exécuter de SQL issu du fichier.
        if not hasattr(conn, "deserialize"):
            return {"kind": "text", "text": "Fichier SQLite valide (aperçu SQL indisponible sur ce serveur).",
                    "truncated": False, "note": "Téléchargez le fichier pour explorer les tables."}
        conn.deserialize(binary)
        conn.execute("PRAGMA query_only=ON")
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 25").fetchall()
        tables = []
        for (name,) in rows:
            quoted = '"' + name.replace('"', '""') + '"'
            column_names = [x[1] for x in conn.execute(f"PRAGMA table_info({quoted})").fetchall()[:MAX_COLS]]
            cells = conn.execute(f"SELECT * FROM {quoted} LIMIT {MAX_ROWS}").fetchall()
            table_rows = [list(map(lambda v: _clean(v, 220), column_names))]
            table_rows += [[_clean(v, 220) for v in row[:MAX_COLS]] for row in cells]
            tables.append({"name": _clean(name, 90), "rows": table_rows})
        return {"kind": "tables", "tables": tables, "truncated": len(rows) >= 25,
                "note": "Extrait en lecture seule des tables SQLite ; aucun script de la base n'est exécuté."}
    except sqlite3.DatabaseError as exc:
        raise UniversalPreviewError("Base SQLite illisible pour l'aperçu.") from exc
    finally:
        conn.close()


def preview_artifact_bytes(extension: str, binary: bytes) -> dict:
    """Produit un aperçu structuré et borné sans effet sur le fichier original."""
    ext = str(extension or "").lower().lstrip(".")
    if not isinstance(binary, (bytes, bytearray)) or not binary:
        raise UniversalPreviewError("Fichier vide ou illisible.")
    if len(binary) > MAX_PREVIEW_BYTES:
        raise UniversalPreviewError("Fichier trop volumineux pour l'aperçu, téléchargement disponible.")
    binary = bytes(binary)

    # Une présentation Code-First utilise des diapositives illustrées.
    # Retourner de véritables miniatures, pas un tableau de texte vide.
    # Les présentations historiques restent traitées par les lecteurs natifs.
    if ext in {"pptx", "odp"}:
        from app.services.artifact_visual_preview import preview_visual_deck
        visual = preview_visual_deck(ext, binary)
        if visual is not None:
            return visual
    if ext == "pptx":
        return _pptx_preview(binary)
    if ext == "odp":
        return _odp_preview(binary)
    if ext == "ods":
        return _ods_sheet_preview(binary)
    if ext == "odt":
        return _odt_preview(binary)
    if ext == "epub":
        return _epub_preview(binary)
    if ext == "sqlite":
        return _sqlite_preview(binary)
    if ext == "zip":
        z, infos = _zip_members(binary)
        try:
            return {"kind": "archive", "entries": [
                {"name": _clean(x.filename, 250), "size": x.file_size}
                for x in infos[:250]
            ], "truncated": len(infos) > 250,
                    "note": "Inventaire uniquement : aucun contenu d'archive n'est exécuté."}
        finally:
            z.close()
    if ext in {"csv", "tsv"}:
        src = _read_text(binary)
        sep = "," if ext == "csv" else "\t"
        rows = []
        try:
            for row in csv.reader(io.StringIO(src), delimiter=sep):
                rows.append([_clean(v, 240) for v in row[:MAX_COLS]])
                if len(rows) >= MAX_ROWS:
                    break
        except csv.Error as exc:
            raise UniversalPreviewError("Tableau CSV/TSV invalide.") from exc
        return {"kind": "tables", "tables": [{"name": ext.upper(), "rows": rows}],
                "truncated": len(src) > MAX_TEXT_CHARS or len(rows) >= MAX_ROWS,
                "note": "Extrait des premières lignes ; données complètes dans le fichier."}
    if ext == "rtf":
        # Format texte enrichi : aperçu textuel minimal sans interpréter de commandes.
        src = _read_text(binary)
        if not src.lstrip().startswith("{\\rtf"):
            raise UniversalPreviewError("Fichier RTF invalide.")
        src = re.sub(r"\\'[0-9a-fA-F]{2}", " ", src)
        src = re.sub(r"\\[a-zA-Z]+-?\d*\s?", " ", src)
        src = re.sub(r"[{}]", "", src)
        return _text_preview(src, note="Aperçu du contenu RTF simplifié ; formatage original dans le fichier.")
    # Tout fichier généré textuel (y compris JSON, MD, HTML, SVG, etc.)
    # est montré comme TEXTE INERTE. Aucun script ni balise n'est exécuté.
    return _text_preview(_read_text(binary), note="Contenu en lecture seule ; aucun code n'est exécuté.")
