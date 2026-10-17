from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import re
import sqlite3
import zipfile

from dataclasses import dataclass, field
from html import escape as html_escape
from pathlib import PurePosixPath
from typing import Any, Iterable
from uuid import uuid4


class ArtifactError(RuntimeError):
    """Erreur générale de génération de fichier Oria."""


class ArtifactDependencyError(ArtifactError):
    """Une dépendance optionnelle nécessaire à un format est absente."""


class UnsupportedArtifactTypeError(ArtifactError):
    """Le format demandé n'est pas générable nativement."""


@dataclass(slots=True)
class ArtifactResult:
    """
    Résultat binaire produit par ArtifactService.

    `data` reste en mémoire. La persistance (Supabase Storage / autre stockage)
    sera gérée par une couche dédiée afin que ce service reste centré sur
    la fabrication du fichier.
    """

    artifact_id: str
    filename: str
    extension: str
    mime_type: str
    category: str
    data: bytes
    size_bytes: int
    sha256: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(
        self,
        *,
        include_data: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "artifact_id": self.artifact_id,
            "filename": self.filename,
            "extension": self.extension,
            "mime_type": self.mime_type,
            "category": self.category,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
            "metadata": dict(self.metadata),
        }

        if include_data:
            payload["data"] = self.data

        return payload


class ArtifactService:
    """
    Génération native de fichiers pour Oria.

    Objectif :
    ---------
    Recevoir le contenu produit par le modèle puis fabriquer un véritable
    fichier téléchargeable sans demander au frontend de reconstruire lui-même
    les formats binaires.

    Ce service couvre :
    - documents : PDF, DOCX, RTF, ODT, EPUB ;
    - tableurs / données : XLSX, ODS, CSV, TSV, JSON, JSONL, SQLite ;
    - présentations : PPTX, ODP ;
    - Web / texte / code : TXT, MD, HTML, CSS, JS, TS, TSX, JSX, PY, SQL,
      XML, YAML, YML, TOML, SVG, TEX, ICS, VCF et de nombreuses extensions
      textuelles ;
    - archives : ZIP.

    Les images, vidéos et futurs fichiers audio générés par des modèles dédiés
    restent dans leurs services média respectifs. Ils pourront néanmoins être
    placés dans une archive ZIP par ce service.

    Pour les extensions textuelles non répertoriées, Oria peut utiliser
    `allow_text_fallback=True` : le contenu est écrit tel quel en UTF-8.
    Cela permet de générer pratiquement tout fichier source/configuration
    textuel sans multiplier les générateurs spécialisés.
    """

    MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
    MAX_ARCHIVE_FILES = 100
    # Empêche qu'un petit ZIP fortement compressé contienne des centaines
    # de Mo de fichiers source en mémoire. Indépendant de la taille du ZIP.
    MAX_ARCHIVE_UNCOMPRESSED_BYTES = 4 * MAX_ARTIFACT_BYTES
    MAX_ARCHIVE_DEPTH = 2
    MAX_FILENAME_LENGTH = 140

    DEFAULT_TEXT_ENCODING = "utf-8"

    TYPE_ALIASES = {
        # Noms de langages courants acceptés en plus des extensions.
        "python": "py",
        "javascript": "js",
        "typescript": "ts",
        "bash": "sh",
        "c++": "cpp",
        "csharp": "cs",
        "golang": "go",
        "rust": "rs",
        "ruby": "rb",
        "shell": "sh",
        "powershell": "ps1",
        "text": "txt",
        "plaintext": "txt",
        "markdown": "md",
        "word": "docx",
        "doc": "docx",
        "excel": "xlsx",
        "spreadsheet": "xlsx",
        "powerpoint": "pptx",
        "slides": "pptx",
        "presentation": "pptx",
        "database": "sqlite",
        "db": "sqlite",
        "sqlite3": "sqlite",
        "archive": "zip",
        "latex": "tex",
        "calendar": "ics",
        "contact": "vcf",
        "ebook": "epub",
        "open-document-text": "odt",
        "open-document-sheet": "ods",
        "open-document-presentation": "odp",
    }

    MIME_TYPES = {
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "cjs": "text/javascript; charset=utf-8",
        "ts": "text/typescript; charset=utf-8",
        "tsx": "text/typescript; charset=utf-8",
        "jsx": "text/javascript; charset=utf-8",
        "py": "text/x-python; charset=utf-8",
        "java": "text/x-java-source; charset=utf-8",
        "c": "text/x-c; charset=utf-8",
        "h": "text/x-c; charset=utf-8",
        "cpp": "text/x-c++; charset=utf-8",
        "hpp": "text/x-c++; charset=utf-8",
        "cs": "text/plain; charset=utf-8",
        "go": "text/plain; charset=utf-8",
        "rs": "text/plain; charset=utf-8",
        "php": "application/x-httpd-php; charset=utf-8",
        "rb": "text/plain; charset=utf-8",
        "sh": "text/x-shellscript; charset=utf-8",
        "ps1": "text/plain; charset=utf-8",
        "bat": "text/plain; charset=utf-8",
        "sql": "application/sql; charset=utf-8",
        "xml": "application/xml; charset=utf-8",
        "yaml": "application/yaml; charset=utf-8",
        "yml": "application/yaml; charset=utf-8",
        "toml": "application/toml; charset=utf-8",
        "ini": "text/plain; charset=utf-8",
        "env": "text/plain; charset=utf-8",
        "log": "text/plain; charset=utf-8",
        "tex": "application/x-tex; charset=utf-8",
        "rtf": "application/rtf",
        "csv": "text/csv; charset=utf-8",
        "tsv": "text/tab-separated-values; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "jsonl": "application/x-ndjson; charset=utf-8",
        "ndjson": "application/x-ndjson; charset=utf-8",
        "svg": "image/svg+xml; charset=utf-8",
        "ics": "text/calendar; charset=utf-8",
        "vcf": "text/vcard; charset=utf-8",
        "pdf": "application/pdf",
        "docx": (
            "application/vnd.openxmlformats-officedocument."
            "wordprocessingml.document"
        ),
        "xlsx": (
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        "pptx": (
            "application/vnd.openxmlformats-officedocument."
            "presentationml.presentation"
        ),
        "odt": "application/vnd.oasis.opendocument.text",
        "ods": "application/vnd.oasis.opendocument.spreadsheet",
        "odp": "application/vnd.oasis.opendocument.presentation",
        "epub": "application/epub+zip",
        "sqlite": "application/vnd.sqlite3",
        "zip": "application/zip",
    }

    CATEGORY_BY_TYPE = {
        "pdf": "document",
        "docx": "document",
        "rtf": "document",
        "odt": "document",
        "epub": "document",
        "xlsx": "spreadsheet",
        "ods": "spreadsheet",
        "csv": "data",
        "tsv": "data",
        "json": "data",
        "jsonl": "data",
        "ndjson": "data",
        "sqlite": "database",
        "pptx": "presentation",
        "odp": "presentation",
        "zip": "archive",
        "svg": "image",
        "ics": "calendar",
        "vcf": "contact",
    }

    KNOWN_TEXT_TYPES = {
        "txt", "md", "html", "htm", "css", "js", "mjs", "cjs",
        "ts", "tsx", "jsx", "py", "java", "c", "h", "cpp", "hpp",
        "cs", "go", "rs", "php", "rb", "sh", "ps1", "bat", "sql",
        "xml", "yaml", "yml", "toml", "ini", "env", "log", "tex",
        "svg", "ics", "vcf",
    }

    # Sous-ensemble des formats textuels à traiter comme des sources. Ne
    # change pas leur catégorie publique (text), pour rester compatible avec
    # les frontends et les repositories déjà déployés.
    CODE_SOURCE_TYPES = frozenset({
        "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "htm",
        "css", "sql", "xml", "yaml", "yml", "toml", "svg", "sh",
        "ps1", "bat", "java", "c", "h", "cpp", "hpp", "cs",
        "go", "rs", "php", "rb", "ini", "env",
    })

    BINARY_TYPES = {
        "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp",
        "epub", "sqlite", "zip",
    }

    def supported_types(self) -> dict[str, list[str]]:
        """Retourne les formats natifs exposables au frontend."""
        return {
            "documents": ["pdf", "docx", "rtf", "odt", "epub"],
            "spreadsheets": ["xlsx", "ods", "csv", "tsv"],
            "presentations": ["pptx", "odp"],
            "data": ["json", "jsonl", "ndjson", "sqlite"],
            "web_and_code": sorted(self.KNOWN_TEXT_TYPES),
            "archives": ["zip"],
        }

    def create(
        self,
        *,
        file_type: str,
        content: Any,
        filename: str | None = None,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
        allow_text_fallback: bool = True,
        _archive_depth: int = 0,
    ) -> ArtifactResult:
        """
        Fabrique un fichier en mémoire.

        `content` dépend du format :
        - documents : str ou structure de blocs ;
        - tableurs : lignes, liste de dictionnaires, ou {"sheets": [...]};
        - présentations : {"slides": [{"title": ..., "bullets": [...]}]};
        - ZIP : {"files": [{"name": ..., "file_type": ..., "content": ...}]};
        - SQLite : {"tables": [{"name": ..., "rows": [...]}]}.
        """
        normalized_type = self._normalize_type(file_type, filename)
        safe_filename = self._resolve_filename(
            filename=filename,
            title=title,
            extension=normalized_type,
        )

        if normalized_type == "pdf":
            data = self._create_pdf(content, title=title)
        elif normalized_type == "docx":
            data = self._create_docx(content, title=title)
        elif normalized_type == "xlsx":
            data = self._create_xlsx(content)
        elif normalized_type == "pptx":
            data = self._create_pptx(content, title=title)
        elif normalized_type == "odt":
            data = self._create_odt(content, title=title)
        elif normalized_type == "ods":
            data = self._create_ods(content)
        elif normalized_type == "odp":
            data = self._create_odp(content, title=title)
        elif normalized_type == "epub":
            data = self._create_epub(content, title=title)
        elif normalized_type == "sqlite":
            data = self._create_sqlite(content)
        elif normalized_type == "zip":
            data = self._create_zip(
                content,
                depth=_archive_depth,
            )
        elif normalized_type == "rtf":
            data = self._create_rtf(content)
        elif normalized_type == "csv":
            data = self._create_delimited(content, delimiter=",")
        elif normalized_type == "tsv":
            data = self._create_delimited(content, delimiter="\t")
        elif normalized_type == "json":
            data = self._create_json(content)
        elif normalized_type in {"jsonl", "ndjson"}:
            data = self._create_jsonl(content)
        elif normalized_type in self.KNOWN_TEXT_TYPES:
            # ai.py fournit déjà un bloc de source extrait du Markdown.
            # Si une réponse Oria est accidentellement un dictionnaire/liste,
            # ne pas fabriquer un fichier .py/.js contenant du JSON trompeur.
            if (
                normalized_type in self.CODE_SOURCE_TYPES
                and (metadata or {}).get("source") == "oria-chat"
                and not isinstance(content, (str, bytes))
            ):
                raise ArtifactError(
                    "Un fichier source ORIA doit contenir du code texte "
                    "ou des octets, pas un objet structuré."
                )
            data = self._create_text(content)
        elif allow_text_fallback:
            if self._looks_binary_extension(normalized_type):
                raise UnsupportedArtifactTypeError(
                    f"Le format binaire '.{normalized_type}' n'a pas encore "
                    "de générateur natif Oria."
                )
            data = self._create_text(content)
        else:
            raise UnsupportedArtifactTypeError(
                f"Format de fichier non supporté : {normalized_type}"
            )

        if not isinstance(data, bytes):
            raise ArtifactError(
                "Le générateur de fichier n'a pas retourné des octets."
            )

        self._validate_size(data)

        mime_type = self._resolve_mime_type(normalized_type)
        category = self.CATEGORY_BY_TYPE.get(
            normalized_type,
            "text" if normalized_type not in self.BINARY_TYPES else "file",
        )

        artifact_id = str(uuid4())
        digest = hashlib.sha256(data).hexdigest()

        result_metadata = dict(metadata or {})
        result_metadata.setdefault("title", title or "")
        result_metadata["generator"] = "oria-native-artifact-service"
        result_metadata["format"] = normalized_type

        return ArtifactResult(
            artifact_id=artifact_id,
            filename=safe_filename,
            extension=normalized_type,
            mime_type=mime_type,
            category=category,
            data=data,
            size_bytes=len(data),
            sha256=digest,
            metadata=result_metadata,
        )

    # ============================================================
    # NORMALISATION / SÉCURITÉ
    # ============================================================

    def _normalize_type(
        self,
        file_type: str,
        filename: str | None,
    ) -> str:
        value = str(file_type or "").strip().lower()
        value = value.lstrip(".")

        if not value and filename:
            suffix = PurePosixPath(filename).suffix
            value = suffix.lower().lstrip(".")

        value = self.TYPE_ALIASES.get(value, value)

        if not value:
            raise UnsupportedArtifactTypeError(
                "Le type de fichier est requis."
            )

        if re.fullmatch(r"[a-z0-9][a-z0-9+._-]{0,31}", value) is None:
            raise UnsupportedArtifactTypeError(
                "Type de fichier invalide."
            )

        return value

    def _resolve_filename(
        self,
        *,
        filename: str | None,
        title: str | None,
        extension: str,
    ) -> str:
        base = str(filename or title or "document-oria").strip()
        base = PurePosixPath(base.replace("\\", "/")).name
        # Un fichier .env est un nom de configuration réel, pas env.env.
        if filename and base == ".env" and extension == "env":
            return base
        base = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "-", base)
        base = re.sub(r"\s+", " ", base).strip(" .-_")

        if not base:
            base = "document-oria"

        expected_suffix = f".{extension.lower()}"

        if not base.lower().endswith(expected_suffix):
            # Retirer une extension existante seulement si elle ressemble
            # réellement à une extension de fichier.
            path = PurePosixPath(base)
            if path.suffix and len(path.suffix) <= 12:
                base = path.stem
            base = f"{base}{expected_suffix}"

        if len(base) > self.MAX_FILENAME_LENGTH:
            suffix = f".{extension}"
            stem_limit = max(
                1,
                self.MAX_FILENAME_LENGTH - len(suffix),
            )
            stem = PurePosixPath(base).stem[:stem_limit].rstrip(" .-_")
            base = f"{stem or 'document-oria'}{suffix}"

        return base

    def _resolve_mime_type(
        self,
        extension: str,
    ) -> str:
        if extension in self.MIME_TYPES:
            return self.MIME_TYPES[extension]

        guessed, _ = mimetypes.guess_type(f"file.{extension}")

        if guessed:
            if guessed.startswith("text/"):
                return f"{guessed}; charset=utf-8"
            return guessed

        return "application/octet-stream"

    def _validate_size(
        self,
        data: bytes,
    ) -> None:
        if not data:
            raise ArtifactError("Le fichier généré est vide.")

        if len(data) > self.MAX_ARTIFACT_BYTES:
            raise ArtifactError(
                "Le fichier généré dépasse la taille maximale autorisée "
                f"({self.MAX_ARTIFACT_BYTES // (1024 * 1024)} Mo)."
            )

    @staticmethod
    def _looks_binary_extension(
        extension: str,
    ) -> bool:
        binary_extensions = {
            "exe", "dll", "so", "dylib", "bin", "iso", "dmg", "apk",
            "aab", "msi", "deb", "rpm", "psd", "ai", "sketch", "blend",
            "dwg", "dxf", "step", "stp", "fbx", "obj", "mp3", "wav",
            "aac", "flac", "ogg", "mp4", "mov", "avi", "mkv", "webm",
            "png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff",
        }
        return extension in binary_extensions

    # ============================================================
    # TEXTE / DONNÉES SIMPLES
    # ============================================================

    def _create_text(
        self,
        content: Any,
    ) -> bytes:
        if isinstance(content, bytes):
            return content

        if isinstance(content, str):
            text = content
        elif isinstance(content, (dict, list, tuple)):
            text = json.dumps(
                content,
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        elif content is None:
            text = ""
        else:
            text = str(content)

        return text.encode(self.DEFAULT_TEXT_ENCODING)

    def _create_json(
        self,
        content: Any,
    ) -> bytes:
        if isinstance(content, str):
            stripped = content.strip()
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                parsed = content
        else:
            parsed = content

        return (
            json.dumps(
                parsed,
                ensure_ascii=False,
                indent=2,
                default=str,
            )
            + "\n"
        ).encode(self.DEFAULT_TEXT_ENCODING)

    def _create_jsonl(
        self,
        content: Any,
    ) -> bytes:
        if isinstance(content, str):
            return content.rstrip().encode(self.DEFAULT_TEXT_ENCODING) + b"\n"

        rows = content
        if isinstance(content, dict):
            rows = content.get("rows", content.get("items", [content]))

        if not isinstance(rows, (list, tuple)):
            rows = [rows]

        output = "\n".join(
            json.dumps(
                row,
                ensure_ascii=False,
                default=str,
            )
            for row in rows
        )

        return (output + "\n").encode(self.DEFAULT_TEXT_ENCODING)

    def _create_delimited(
        self,
        content: Any,
        *,
        delimiter: str,
    ) -> bytes:
        rows = self._normalize_rows(content)

        buffer = io.StringIO(newline="")
        writer = csv.writer(
            buffer,
            delimiter=delimiter,
            lineterminator="\n",
        )

        for row in rows:
            writer.writerow(
                "" if value is None else value
                for value in row
            )

        # UTF-8 BOM améliore l'ouverture directe dans Excel sur Windows.
        return (
            "\ufeff" + buffer.getvalue()
        ).encode(self.DEFAULT_TEXT_ENCODING)

    def _create_rtf(
        self,
        content: Any,
    ) -> bytes:
        text = self._document_plain_text(content)

        def rtf_escape(value: str) -> str:
            parts: list[str] = []
            for char in value:
                code = ord(char)
                if char in "\\{}":
                    parts.append("\\" + char)
                elif char == "\n":
                    parts.append("\\par\n")
                elif code > 127:
                    signed = code if code <= 32767 else code - 65536
                    parts.append(f"\\u{signed}?")
                else:
                    parts.append(char)
            return "".join(parts)

        body = rtf_escape(text)
        rtf = (
            r"{\rtf1\ansi\deff0"
            "\n"
            r"{\fonttbl{\f0 Arial;}}"
            "\n"
            r"\fs22 "
            + body
            + "\n}"
        )
        return rtf.encode("ascii", errors="strict")

    # ============================================================
    # DOCUMENTS
    # ============================================================

    def _create_pdf(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        try:
            from reportlab.lib.enums import TA_CENTER
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
            from reportlab.lib.units import mm
            from reportlab.platypus import (
                ListFlowable,
                ListItem,
                Paragraph,
                SimpleDocTemplate,
                Spacer,
                Table,
                TableStyle,
            )
            from reportlab.lib import colors
        except ImportError as error:
            raise ArtifactDependencyError(
                "PDF natif : installez 'reportlab'."
            ) from error

        buffer = io.BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=18 * mm,
            leftMargin=18 * mm,
            topMargin=18 * mm,
            bottomMargin=18 * mm,
            title=title or "Document Oria",
            author="Oria",
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "OriaTitle",
            parent=styles["Title"],
            alignment=TA_CENTER,
            spaceAfter=14,
        )
        body_style = styles["BodyText"]
        body_style.leading = 15
        heading1 = styles["Heading1"]
        heading2 = styles["Heading2"]
        heading3 = styles["Heading3"]

        story: list[Any] = []

        if title:
            story.append(
                Paragraph(
                    html_escape(title),
                    title_style,
                )
            )

        for block in self._normalize_document_blocks(content):
            kind = block["type"]
            value = block.get("text", "")

            if kind == "h1":
                story.append(Paragraph(html_escape(value), heading1))
            elif kind == "h2":
                story.append(Paragraph(html_escape(value), heading2))
            elif kind == "h3":
                story.append(Paragraph(html_escape(value), heading3))
            elif kind == "bullet":
                story.append(
                    ListFlowable(
                        [
                            ListItem(
                                Paragraph(
                                    html_escape(item),
                                    body_style,
                                )
                            )
                            for item in block.get("items", [])
                        ],
                        bulletType="bullet",
                    )
                )
            elif kind == "table":
                rows = block.get("rows", [])
                if rows:
                    table = Table(rows, repeatRows=1)
                    table.setStyle(
                        TableStyle(
                            [
                                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
                                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                                ("TOPPADDING", (0, 0), (-1, -1), 4),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                            ]
                        )
                    )
                    story.append(table)
            elif kind == "spacer":
                story.append(Spacer(1, 8))
            else:
                safe = html_escape(value).replace("\n", "<br/>")
                story.append(Paragraph(safe or " ", body_style))

            story.append(Spacer(1, 5))

        document.build(story)
        return buffer.getvalue()

    def _create_docx(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        try:
            from docx import Document
            from docx.shared import Pt
        except ImportError as error:
            raise ArtifactDependencyError(
                "DOCX natif : installez 'python-docx'."
            ) from error

        document = Document()

        styles = document.styles
        if "Normal" in styles:
            styles["Normal"].font.name = "Arial"
            styles["Normal"].font.size = Pt(11)

        if title:
            document.add_heading(title, level=0)

        for block in self._normalize_document_blocks(content):
            kind = block["type"]

            if kind == "h1":
                document.add_heading(block.get("text", ""), level=1)
            elif kind == "h2":
                document.add_heading(block.get("text", ""), level=2)
            elif kind == "h3":
                document.add_heading(block.get("text", ""), level=3)
            elif kind == "bullet":
                for item in block.get("items", []):
                    document.add_paragraph(
                        str(item),
                        style="List Bullet",
                    )
            elif kind == "table":
                rows = block.get("rows", [])
                if rows:
                    cols = max(len(row) for row in rows)
                    table = document.add_table(
                        rows=len(rows),
                        cols=max(cols, 1),
                    )
                    table.style = "Table Grid"
                    for row_index, row in enumerate(rows):
                        for col_index, value in enumerate(row):
                            table.cell(
                                row_index,
                                col_index,
                            ).text = "" if value is None else str(value)
            elif kind == "spacer":
                document.add_paragraph("")
            else:
                document.add_paragraph(block.get("text", ""))

        buffer = io.BytesIO()
        document.save(buffer)
        return buffer.getvalue()

    def _create_odt(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        try:
            from odf.opendocument import OpenDocumentText
            from odf.text import H, P
        except ImportError as error:
            raise ArtifactDependencyError(
                "ODT natif : installez 'odfpy'."
            ) from error

        document = OpenDocumentText()

        if title:
            document.text.addElement(H(outlinelevel=1, text=title))

        for block in self._normalize_document_blocks(content):
            kind = block["type"]
            if kind in {"h1", "h2", "h3"}:
                level = int(kind[-1])
                document.text.addElement(
                    H(
                        outlinelevel=level,
                        text=block.get("text", ""),
                    )
                )
            elif kind == "bullet":
                for item in block.get("items", []):
                    document.text.addElement(P(text=f"• {item}"))
            elif kind == "table":
                for row in block.get("rows", []):
                    document.text.addElement(
                        P(
                            text=" | ".join(
                                "" if cell is None else str(cell)
                                for cell in row
                            )
                        )
                    )
            else:
                document.text.addElement(
                    P(text=block.get("text", ""))
                )

        buffer = io.BytesIO()
        document.write(buffer)
        return buffer.getvalue()

    def _create_epub(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        """
        Génère un EPUB 3 minimal sans dépendance externe.

        EPUB est un conteneur ZIP normalisé. Le générer directement permet à
        Oria d'éviter une dépendance supplémentaire uniquement pour ce format.
        """
        book_id = str(uuid4())
        book_title = title or "Document Oria"
        chapters = self._normalize_epub_chapters(content)

        container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"
 xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf"
     media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

        manifest_items = []
        spine_items = []
        nav_items = []
        chapter_files: list[tuple[str, str]] = []

        for index, chapter in enumerate(chapters, start=1):
            chapter_id = f"chapter-{index}"
            filename = f"chapter_{index}.xhtml"
            chapter_title = html_escape(chapter["title"])

            paragraphs = "\n".join(
                f"<p>{html_escape(paragraph)}</p>"
                for paragraph in chapter["paragraphs"]
            )

            chapter_xhtml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>{chapter_title}</title>
</head>
<body>
  <h1>{chapter_title}</h1>
  {paragraphs}
</body>
</html>
"""

            chapter_files.append((filename, chapter_xhtml))
            manifest_items.append(
                f'    <item id="{chapter_id}" href="{filename}" '
                'media-type="application/xhtml+xml"/>'
            )
            spine_items.append(
                f'    <itemref idref="{chapter_id}"/>'
            )
            nav_items.append(
                f'      <li><a href="{filename}">{chapter_title}</a></li>'
            )

        nav_xhtml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
 xmlns:epub="http://www.idpf.org/2007/ops" lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>Sommaire</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Sommaire</h1>
    <ol>
{chr(10).join(nav_items)}
    </ol>
  </nav>
</body>
</html>
"""

        content_opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
 version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">{book_id}</dc:identifier>
    <dc:title>{html_escape(book_title)}</dc:title>
    <dc:language>fr</dc:language>
    <dc:creator>Oria</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml"
     media-type="application/xhtml+xml" properties="nav"/>
{chr(10).join(manifest_items)}
  </manifest>
  <spine>
{chr(10).join(spine_items)}
  </spine>
</package>
"""

        buffer = io.BytesIO()

        with zipfile.ZipFile(buffer, "w") as archive:
            # EPUB exige que mimetype soit le premier fichier et non compressé.
            archive.writestr(
                "mimetype",
                "application/epub+zip",
                compress_type=zipfile.ZIP_STORED,
            )
            archive.writestr(
                "META-INF/container.xml",
                container_xml,
                compress_type=zipfile.ZIP_DEFLATED,
            )
            archive.writestr(
                "EPUB/content.opf",
                content_opf,
                compress_type=zipfile.ZIP_DEFLATED,
            )
            archive.writestr(
                "EPUB/nav.xhtml",
                nav_xhtml,
                compress_type=zipfile.ZIP_DEFLATED,
            )

            for filename, chapter_xhtml in chapter_files:
                archive.writestr(
                    f"EPUB/{filename}",
                    chapter_xhtml,
                    compress_type=zipfile.ZIP_DEFLATED,
                )

        return buffer.getvalue()

    # ============================================================
    # TABLEURS
    # ============================================================

    def _create_xlsx(
        self,
        content: Any,
    ) -> bytes:
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font
        except ImportError as error:
            raise ArtifactDependencyError(
                "XLSX natif : installez 'openpyxl'."
            ) from error

        workbook = Workbook()
        default_sheet = workbook.active
        workbook.remove(default_sheet)

        sheets = self._normalize_sheets(content)

        for sheet_index, sheet_spec in enumerate(sheets, start=1):
            sheet_name = self._safe_sheet_name(
                sheet_spec.get("name") or f"Feuille {sheet_index}"
            )
            worksheet = workbook.create_sheet(sheet_name)

            rows = sheet_spec.get("rows", [])

            for row_index, row in enumerate(rows, start=1):
                for col_index, value in enumerate(row, start=1):
                    worksheet.cell(
                        row=row_index,
                        column=col_index,
                        value=value,
                    )

            if rows:
                for cell in worksheet[1]:
                    cell.font = Font(bold=True)

            # Largeur approximative utile sans calcul coûteux.
            max_cols = max((len(row) for row in rows), default=0)
            for col_index in range(1, min(max_cols, 50) + 1):
                letter = worksheet.cell(
                    row=1,
                    column=col_index,
                ).column_letter
                width = 12
                for row in rows[:200]:
                    if col_index - 1 < len(row):
                        width = min(
                            45,
                            max(
                                width,
                                len(str(row[col_index - 1] or "")) + 2,
                            ),
                        )
                worksheet.column_dimensions[letter].width = width

        if not workbook.sheetnames:
            workbook.create_sheet("Feuille 1")

        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    def _create_ods(
        self,
        content: Any,
    ) -> bytes:
        try:
            from odf.opendocument import OpenDocumentSpreadsheet
            from odf.table import Table, TableCell, TableRow
            from odf.text import P
        except ImportError as error:
            raise ArtifactDependencyError(
                "ODS natif : installez 'odfpy'."
            ) from error

        document = OpenDocumentSpreadsheet()

        for index, sheet_spec in enumerate(
            self._normalize_sheets(content),
            start=1,
        ):
            table = Table(
                name=self._safe_sheet_name(
                    sheet_spec.get("name") or f"Feuille {index}"
                )
            )

            for row in sheet_spec.get("rows", []):
                table_row = TableRow()

                for value in row:
                    cell = TableCell(
                        valuetype="string",
                    )
                    cell.addElement(
                        P(text="" if value is None else str(value))
                    )
                    table_row.addElement(cell)

                table.addElement(table_row)

            document.spreadsheet.addElement(table)

        buffer = io.BytesIO()
        document.write(buffer)
        return buffer.getvalue()

    # ============================================================
    # PRÉSENTATIONS
    # ============================================================

    def _create_pptx(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        try:
            from pptx import Presentation
        except ImportError as error:
            raise ArtifactDependencyError(
                "PPTX natif : installez 'python-pptx'."
            ) from error

        presentation = Presentation()
        slides = self._normalize_slides(content, title=title)

        # Supprimer la présentation vide implicite n'est pas nécessaire :
        # python-pptx démarre sans slides.
        for slide_spec in slides:
            layout = presentation.slide_layouts[1]
            slide = presentation.slides.add_slide(layout)

            slide.shapes.title.text = slide_spec["title"]

            body = slide.placeholders[1]
            text_frame = body.text_frame
            text_frame.clear()

            bullets = slide_spec.get("bullets", [])

            if not bullets:
                bullets = [""]

            for index, bullet in enumerate(bullets):
                paragraph = (
                    text_frame.paragraphs[0]
                    if index == 0
                    else text_frame.add_paragraph()
                )
                paragraph.text = str(bullet)
                paragraph.level = 0

        buffer = io.BytesIO()
        presentation.save(buffer)
        return buffer.getvalue()

    def _create_odp(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> bytes:
        try:
            from odf.draw import Frame, Page, TextBox
            from odf.opendocument import OpenDocumentPresentation
            from odf.text import H, P
        except ImportError as error:
            raise ArtifactDependencyError(
                "ODP natif : installez 'odfpy'."
            ) from error

        document = OpenDocumentPresentation()
        slides = self._normalize_slides(content, title=title)

        for index, slide_spec in enumerate(slides, start=1):
            page = Page(
                name=f"slide{index}",
                masterpagename="Default",
            )

            title_frame = Frame(
                width="24cm",
                height="2cm",
                x="1cm",
                y="1cm",
            )
            title_box = TextBox()
            title_box.addElement(
                H(
                    outlinelevel=1,
                    text=slide_spec["title"],
                )
            )
            title_frame.addElement(title_box)
            page.addElement(title_frame)

            body_frame = Frame(
                width="24cm",
                height="14cm",
                x="1cm",
                y="3.5cm",
            )
            body_box = TextBox()
            for bullet in slide_spec.get("bullets", []):
                body_box.addElement(P(text=f"• {bullet}"))
            body_frame.addElement(body_box)
            page.addElement(body_frame)

            document.presentation.addElement(page)

        buffer = io.BytesIO()
        document.write(buffer)
        return buffer.getvalue()

    # ============================================================
    # SQLITE
    # ============================================================

    def _create_sqlite(
        self,
        content: Any,
    ) -> bytes:
        tables = self._normalize_database_tables(content)

        # sqlite3 n'écrit pas directement dans BytesIO. On utilise donc
        # serialize(), disponible sur les versions modernes de Python.
        connection = sqlite3.connect(":memory:")

        try:
            for table_spec in tables:
                table_name = self._safe_sql_identifier(
                    table_spec["name"]
                )
                rows = table_spec["rows"]

                if not rows:
                    connection.execute(
                        f'CREATE TABLE "{table_name}" '
                        '("_empty" TEXT)'
                    )
                    continue

                headers = list(rows[0].keys())

                safe_headers = [
                    self._safe_sql_identifier(header)
                    for header in headers
                ]

                columns_sql = ", ".join(
                    f'"{header}" TEXT'
                    for header in safe_headers
                )

                connection.execute(
                    f'CREATE TABLE "{table_name}" ({columns_sql})'
                )

                placeholders = ", ".join("?" for _ in safe_headers)
                insert_sql = (
                    f'INSERT INTO "{table_name}" VALUES '
                    f"({placeholders})"
                )

                connection.executemany(
                    insert_sql,
                    [
                        [
                            None if row.get(header) is None
                            else str(row.get(header))
                            for header in headers
                        ]
                        for row in rows
                    ],
                )

            connection.commit()

            serialize = getattr(connection, "serialize", None)
            if not callable(serialize):
                raise ArtifactError(
                    "Cette version de Python ne permet pas de sérialiser "
                    "une base SQLite en mémoire."
                )

            return bytes(serialize())

        finally:
            connection.close()

    # ============================================================
    # ZIP
    # ============================================================

    def _create_zip(
        self,
        content: Any,
        *,
        depth: int,
    ) -> bytes:
        if depth >= self.MAX_ARCHIVE_DEPTH:
            raise ArtifactError(
                "Profondeur maximale des archives ZIP atteinte."
            )

        if not isinstance(content, dict):
            raise ArtifactError(
                "Une archive ZIP attend un objet {'files': [...]}."
            )

        files = content.get("files")

        if not isinstance(files, list):
            raise ArtifactError(
                "Une archive ZIP attend une liste 'files'."
            )

        if len(files) > self.MAX_ARCHIVE_FILES:
            raise ArtifactError(
                f"Une archive Oria accepte au maximum "
                f"{self.MAX_ARCHIVE_FILES} fichiers."
            )

        buffer = io.BytesIO()

        with zipfile.ZipFile(
            buffer,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            used_names: set[str] = set()
            used_code_names_casefold: set[str] = set()
            total_uncompressed_bytes = 0

            for index, item in enumerate(files, start=1):
                if not isinstance(item, dict):
                    raise ArtifactError(
                        f"Entrée ZIP #{index} invalide."
                    )

                item_name = str(
                    item.get("name")
                    or item.get("filename")
                    or f"fichier-{index}.txt"
                )
                archive_name = self._safe_archive_name(item_name)
                item_type = str(
                    item.get("file_type")
                    or item.get("type")
                    or PurePosixPath(archive_name).suffix.lstrip(".")
                    or "txt"
                )
                normalized_type = self._normalize_type(item_type, archive_name)
                is_code_source = normalized_type in self.CODE_SOURCE_TYPES

                if is_code_source:
                    # Pour un projet exécutable, altérer silencieusement un
                    # chemin ou renommer un module peut casser les imports.
                    self._validate_project_archive_name(item_name, archive_name)
                    declared_suffix = PurePosixPath(archive_name).suffix.lstrip(".")
                    if declared_suffix and declared_suffix != normalized_type:
                        raise ArtifactError(
                            f"Extension incohérente pour '{archive_name}' : "
                            f"le contenu est déclaré '{normalized_type}'."
                        )
                    casefold_name = archive_name.casefold()
                    if (
                        archive_name in used_names
                        or casefold_name in used_code_names_casefold
                    ):
                        raise ArtifactError(
                            f"Fichier source dupliqué dans le ZIP : "
                            f"{archive_name}."
                        )
                elif archive_name in used_names:
                    # Comportement historique conservé pour les autres ZIP.
                    archive_name = self._deduplicate_filename(
                        archive_name, used_names,
                    )

                item_content = item.get("content", "")
                if is_code_source and not isinstance(item_content, (str, bytes)):
                    raise ArtifactError(
                        f"Le fichier source '{archive_name}' attend du "
                        "texte ou des octets."
                    )

                if is_code_source and item_content in ("", b""):
                    # `__init__.py` vide est parfaitement valide. Le validateur
                    # générique refuse les fichiers vides : exception ZIP ciblée.
                    generated_data = b""
                else:
                    generated = self.create(
                        file_type=item_type,
                        content=item_content,
                        filename=archive_name,
                        title=item.get("title"),
                        metadata=item.get("metadata"),
                        allow_text_fallback=True,
                        _archive_depth=depth + 1,
                    )
                    generated_data = generated.data

                total_uncompressed_bytes += len(generated_data)
                if total_uncompressed_bytes > self.MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                    raise ArtifactError(
                        "Le contenu décompressé de l'archive dépasse la "
                        "limite autorisée. Diviser le projet en plusieurs ZIP."
                    )

                archive.writestr(archive_name, generated_data)
                used_names.add(archive_name)
                if is_code_source:
                    used_code_names_casefold.add(archive_name.casefold())

        return buffer.getvalue()

    # ============================================================
    # NORMALISATEURS DE CONTENU
    # ============================================================

    def _normalize_rows(
        self,
        content: Any,
    ) -> list[list[Any]]:
        if isinstance(content, dict):
            if "rows" in content:
                content = content["rows"]
            elif "data" in content:
                content = content["data"]
            else:
                content = [content]

        if content is None:
            return []

        if isinstance(content, str):
            return [[content]]

        if not isinstance(content, (list, tuple)):
            return [[content]]

        if not content:
            return []

        if all(isinstance(item, dict) for item in content):
            headers: list[str] = []
            seen: set[str] = set()

            for row in content:
                for key in row.keys():
                    key_text = str(key)
                    if key_text not in seen:
                        seen.add(key_text)
                        headers.append(key_text)

            rows: list[list[Any]] = [headers]

            for row in content:
                rows.append(
                    [
                        row.get(header)
                        for header in headers
                    ]
                )

            return rows

        normalized: list[list[Any]] = []

        for item in content:
            if isinstance(item, (list, tuple)):
                normalized.append(list(item))
            else:
                normalized.append([item])

        return normalized

    def _normalize_sheets(
        self,
        content: Any,
    ) -> list[dict[str, Any]]:
        if isinstance(content, dict) and isinstance(
            content.get("sheets"),
            list,
        ):
            result = []

            for index, sheet in enumerate(
                content["sheets"],
                start=1,
            ):
                if isinstance(sheet, dict):
                    rows = self._normalize_rows(
                        sheet.get("rows", sheet.get("data", []))
                    )
                    result.append(
                        {
                            "name": sheet.get(
                                "name",
                                f"Feuille {index}",
                            ),
                            "rows": rows,
                        }
                    )

            return result or [
                {
                    "name": "Feuille 1",
                    "rows": [],
                }
            ]

        return [
            {
                "name": "Feuille 1",
                "rows": self._normalize_rows(content),
            }
        ]

    def _normalize_document_blocks(
        self,
        content: Any,
    ) -> list[dict[str, Any]]:
        if isinstance(content, dict) and isinstance(
            content.get("blocks"),
            list,
        ):
            normalized = []
            for block in content["blocks"]:
                if isinstance(block, dict):
                    normalized.append(
                        {
                            "type": str(
                                block.get("type") or "p"
                            ).lower(),
                            "text": str(
                                block.get("text") or ""
                            ),
                            "items": [
                                str(item)
                                for item in block.get("items", [])
                            ],
                            "rows": self._normalize_rows(
                                block.get("rows", [])
                            ),
                        }
                    )
            return normalized

        if isinstance(content, (list, tuple, dict)):
            if isinstance(content, dict):
                text = json.dumps(
                    content,
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                )
            else:
                text = "\n".join(str(item) for item in content)
        else:
            text = "" if content is None else str(content)

        blocks: list[dict[str, Any]] = []
        bullet_buffer: list[str] = []

        def flush_bullets() -> None:
            nonlocal bullet_buffer
            if bullet_buffer:
                blocks.append(
                    {
                        "type": "bullet",
                        "items": bullet_buffer,
                    }
                )
                bullet_buffer = []

        paragraph_buffer: list[str] = []

        def flush_paragraph() -> None:
            nonlocal paragraph_buffer
            if paragraph_buffer:
                blocks.append(
                    {
                        "type": "p",
                        "text": "\n".join(paragraph_buffer).strip(),
                    }
                )
                paragraph_buffer = []

        for raw_line in text.splitlines():
            line = raw_line.rstrip()

            if not line.strip():
                flush_paragraph()
                flush_bullets()
                continue

            match = re.match(r"^(#{1,3})\s+(.+)$", line)
            if match:
                flush_paragraph()
                flush_bullets()
                blocks.append(
                    {
                        "type": f"h{len(match.group(1))}",
                        "text": match.group(2).strip(),
                    }
                )
                continue

            bullet = re.match(r"^\s*[-*•]\s+(.+)$", line)
            if bullet:
                flush_paragraph()
                bullet_buffer.append(
                    bullet.group(1).strip()
                )
                continue

            flush_bullets()
            paragraph_buffer.append(line)

        flush_paragraph()
        flush_bullets()

        return blocks or [{"type": "p", "text": ""}]

    def _document_plain_text(
        self,
        content: Any,
    ) -> str:
        parts: list[str] = []

        for block in self._normalize_document_blocks(content):
            kind = block["type"]

            if kind == "bullet":
                parts.extend(
                    f"• {item}"
                    for item in block.get("items", [])
                )
            elif kind == "table":
                parts.extend(
                    " | ".join(
                        "" if value is None else str(value)
                        for value in row
                    )
                    for row in block.get("rows", [])
                )
            else:
                parts.append(block.get("text", ""))

        return "\n\n".join(parts)

    def _normalize_slides(
        self,
        content: Any,
        *,
        title: str | None,
    ) -> list[dict[str, Any]]:
        if isinstance(content, dict) and isinstance(
            content.get("slides"),
            list,
        ):
            slides = []

            for index, slide in enumerate(
                content["slides"],
                start=1,
            ):
                if isinstance(slide, dict):
                    bullets = slide.get("bullets", slide.get("content", []))

                    if isinstance(bullets, str):
                        bullets = [
                            line.strip("-• ").strip()
                            for line in bullets.splitlines()
                            if line.strip()
                        ]

                    if not isinstance(bullets, list):
                        bullets = [bullets]

                    slides.append(
                        {
                            "title": str(
                                slide.get("title")
                                or f"Diapositive {index}"
                            ),
                            "bullets": [
                                str(item)
                                for item in bullets
                                if item is not None
                            ],
                        }
                    )

            if slides:
                return slides

        blocks = self._normalize_document_blocks(content)
        slides: list[dict[str, Any]] = []
        current = {
            "title": title or "Présentation Oria",
            "bullets": [],
        }

        for block in blocks:
            if block["type"] in {"h1", "h2"}:
                if current["bullets"] or slides:
                    slides.append(current)
                current = {
                    "title": block.get("text") or "Diapositive",
                    "bullets": [],
                }
            elif block["type"] == "bullet":
                current["bullets"].extend(block.get("items", []))
            elif block["type"] == "p":
                paragraph = block.get("text", "").strip()
                if paragraph:
                    current["bullets"].append(paragraph)

        if current["title"] or current["bullets"]:
            slides.append(current)

        return slides or [
            {
                "title": title or "Présentation Oria",
                "bullets": [],
            }
        ]

    def _normalize_epub_chapters(
        self,
        content: Any,
    ) -> list[dict[str, Any]]:
        if isinstance(content, dict) and isinstance(
            content.get("chapters"),
            list,
        ):
            chapters = []

            for index, chapter in enumerate(
                content["chapters"],
                start=1,
            ):
                if isinstance(chapter, dict):
                    raw = chapter.get(
                        "content",
                        chapter.get("text", ""),
                    )
                    paragraphs = [
                        value.strip()
                        for value in str(raw).split("\n\n")
                        if value.strip()
                    ]
                    chapters.append(
                        {
                            "title": str(
                                chapter.get("title")
                                or f"Chapitre {index}"
                            ),
                            "paragraphs": paragraphs or [""],
                        }
                    )

            if chapters:
                return chapters

        return [
            {
                "title": "Document",
                "paragraphs": [
                    block.get("text", "")
                    for block in self._normalize_document_blocks(content)
                    if block.get("text", "").strip()
                ] or [""],
            }
        ]

    def _normalize_database_tables(
        self,
        content: Any,
    ) -> list[dict[str, Any]]:
        if isinstance(content, dict) and isinstance(
            content.get("tables"),
            list,
        ):
            tables = []

            for index, table in enumerate(
                content["tables"],
                start=1,
            ):
                if not isinstance(table, dict):
                    continue

                rows = table.get("rows", table.get("data", []))

                if isinstance(rows, dict):
                    rows = [rows]

                if not isinstance(rows, list):
                    rows = []

                normalized_rows = [
                    row
                    for row in rows
                    if isinstance(row, dict)
                ]

                tables.append(
                    {
                        "name": str(
                            table.get("name")
                            or f"table_{index}"
                        ),
                        "rows": normalized_rows,
                    }
                )

            return tables or [
                {
                    "name": "data",
                    "rows": [],
                }
            ]

        if isinstance(content, list) and all(
            isinstance(row, dict)
            for row in content
        ):
            return [
                {
                    "name": "data",
                    "rows": content,
                }
            ]

        if isinstance(content, dict):
            return [
                {
                    "name": "data",
                    "rows": [content],
                }
            ]

        raise ArtifactError(
            "SQLite attend une liste de dictionnaires ou "
            "{'tables': [{'name': ..., 'rows': [...]}]}."
        )

    # ============================================================
    # HELPERS
    # ============================================================

    @staticmethod
    def _safe_sheet_name(
        value: Any,
    ) -> str:
        name = str(value or "Feuille").strip()
        name = re.sub(r"[\[\]:*?/\\]+", "-", name)
        return (name[:31] or "Feuille").strip()

    @staticmethod
    def _safe_sql_identifier(
        value: Any,
    ) -> str:
        name = str(value or "data").strip()
        name = re.sub(r"[^0-9A-Za-z_ -]+", "_", name)
        name = name.replace('"', "_")
        return name[:80] or "data"

    @staticmethod
    def _safe_archive_name(
        value: str,
    ) -> str:
        # Autorise les sous-dossiers mais interdit traversée et chemins absolus.
        raw = value.replace("\\", "/").strip()
        path = PurePosixPath(raw)

        parts = [
            part
            for part in path.parts
            if part not in {"", ".", "..", "/"}
        ]

        if not parts:
            return "fichier.txt"

        cleaned = "/".join(parts)
        cleaned = re.sub(r"[\x00-\x1f<>:\"|?*]+", "-", cleaned)
        return cleaned[:240]

    @staticmethod
    def _validate_project_archive_name(
        original_name: str,
        archive_name: str,
    ) -> None:
        """Refuse les noms dangereux ou altérés pour les fichiers source ZIP."""
        raw = original_name.replace("\\", "/").strip()
        parts = raw.split("/")
        if (
            not raw
            or raw.startswith("/")
            or re.match(r"^[A-Za-z]:", raw)
            or any(part in {"", ".", ".."} for part in parts)
            or len(raw) > 240
            or raw != archive_name
        ):
            raise ArtifactError(
                f"Chemin de fichier source ZIP invalide : {original_name!r}."
            )

    @staticmethod
    def _deduplicate_filename(
        filename: str,
        used_names: set[str],
    ) -> str:
        path = PurePosixPath(filename)
        parent = "" if str(path.parent) == "." else f"{path.parent}/"
        stem = path.stem
        suffix = path.suffix

        index = 2
        candidate = filename

        while candidate in used_names:
            candidate = f"{parent}{stem}-{index}{suffix}"
            index += 1

        return candidate
