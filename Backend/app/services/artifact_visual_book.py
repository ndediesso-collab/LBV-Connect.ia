"""EPUB Code-First sémantique : conserve la composition HTML/CSS sans JS.

Opt-in seulement pour les sections HTML <section class="oria-chapter">.
Les sources, styles et images ont déjà été validés par ArtifactService.
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime, timezone
from html import escape
from pathlib import PurePosixPath
from typing import Callable
from uuid import uuid4

from bs4 import BeautifulSoup
from lxml import etree, html as lhtml


class VisualBookError(ValueError):
    pass


def compile_visual_epub(
    source: str, filename: str, *, image_reader: Callable[[str], tuple[str, bytes]],
) -> bytes:
    soup = BeautifulSoup(source, 'html.parser')
    chapters = soup.select('section.oria-chapter')
    if not 1 <= len(chapters) <= 60:
        raise VisualBookError('EPUB Code-First : entre 1 et 60 chapitres .oria-chapter attendus.')
    if any(ch.find_parent('section', class_='oria-chapter') for ch in chapters):
        raise VisualBookError('Les chapitres EPUB ne peuvent pas être imbriqués.')
    styles = '\n'.join(x.get_text() for x in soup.find_all('style'))
    if len(styles) > 180000:
        raise VisualBookError('Styles EPUB trop volumineux.')
    base_css = (
        'body{line-height:1.55;font-family:serif;color:#18243a;margin:1em}'
        'h1,h2,h3{line-height:1.18;break-after:avoid}'
        'img{max-width:100%;height:auto}'
        'table{border-collapse:collapse;width:100%}'
        'td,th{border:1px solid #ddd;padding:.45em}'
        'blockquote{border-left:.2em solid #b44f3a;padding-left:1em}'
    )
    images: list[tuple[str, str, bytes]] = []
    files: list[tuple[str, bytes]] = []
    nav: list[str] = []
    manifest: list[str] = []
    spine: list[str] = []
    for index, chapter in enumerate(chapters, 1):
        title_tag = chapter.find(['h1','h2','h3'])
        title = title_tag.get_text(' ', strip=True)[:160] if title_tag else f'Chapitre {index}'
        if not chapter.get_text(' ', strip=True) and not chapter.find('img'):
            raise VisualBookError(f'Chapitre EPUB {index} vide.')
        frag = lhtml.fragment_fromstring(str(chapter), create_parent='div')
        # Uniquement les images inline prévalidées. Aucune URL n'est téléchargée.
        for img in frag.iter('img'):
            src = img.get('src', '')
            mime, data = image_reader(src)
            if mime == 'webp':
                from PIL import Image
                with Image.open(io.BytesIO(data)) as source_image:
                    out = io.BytesIO()
                    source_image.save(out, format='PNG')
                    data = out.getvalue()
                mime = 'png'
            suffix = 'jpg' if mime == 'jpeg' else mime
            name = f'image{len(images)+1}.{suffix}'
            images.append((name, f'image/{mime}', data))
            img.set('src', name)
        # Sérialisation XML : pas de code JS, aucune structure HTML exécutable.
        body = etree.tostring(frag, encoding='unicode', method='xml')
        xhtml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml" lang="fr">'
            '<head><meta charset="utf-8"/><title>' + escape(title) + '</title>'
            '<link rel="stylesheet" type="text/css" href="style.css"/></head>'
            '<body>' + body + '</body></html>'
        )
        try:
            etree.fromstring(xhtml.encode('utf-8'))
        except etree.XMLSyntaxError as exc:
            raise VisualBookError(f'Chapitre EPUB {index} non valide en XHTML.') from exc
        path = f'chapter{index}.xhtml'
        files.append((path, xhtml.encode('utf-8')))
        nav.append(f'<li><a href="{path}">{escape(title)}</a></li>')
        manifest.append(f'<item id="chapter{index}" href="{path}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="chapter{index}"/>')
    book_id = str(uuid4())
    modified = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    title = escape(PurePosixPath(filename).stem.replace('_', ' '))
    opf = ('<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="book-id">{book_id}</dc:identifier><dc:title>{title}</dc:title>'
        f'<dc:language>fr</dc:language><meta property="dcterms:modified">{modified}</meta>'
        '</metadata><manifest>'
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        '<item id="style" href="style.css" media-type="text/css"/>'
        + ''.join(manifest)
        + ''.join(f'<item id="img{i}" href="{escape(name)}" media-type="{mime}"/>'
                  for i,(name,mime,_) in enumerate(images,1))
        + '</manifest><spine>' + ''.join(spine) + '</spine></package>')
    toc = ('<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr">'
        '<head><title>Sommaire</title></head><body><nav epub:type="toc" id="toc">'
        '<h1>Sommaire</h1><ol>' + ''.join(nav) + '</ol></nav></body></html>')
    container = ('<?xml version="1.0" encoding="utf-8"?>'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>'
        '</rootfiles></container>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for path, content in [('META-INF/container.xml', container),
                              ('EPUB/content.opf', opf), ('EPUB/nav.xhtml', toc),
                              ('EPUB/style.css', base_css + '\n' + styles)]:
            z.writestr(path, content, compress_type=zipfile.ZIP_DEFLATED)
        for path, content in files:
            z.writestr('EPUB/' + path, content, compress_type=zipfile.ZIP_DEFLATED)
        for name, _, data in images:
            z.writestr('EPUB/' + name, data, compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()
