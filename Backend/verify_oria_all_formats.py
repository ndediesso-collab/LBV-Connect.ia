"""Pre-deployment ORIA Artifact smoke test. No OpenAI calls, no Supabase, no credits.

Run from Backend root after installing requirements:
    python verify_oria_all_formats.py

Raises on an invalid file or a missing converter dependency.
"""
import io
import sys
import zipfile

try:
    from app.services.artifact_service import ArtifactService
except ModuleNotFoundError as exc:
    if exc.name != 'app':
        raise
    # Useful when the standalone script is tested beside artifact_service.py.
    from app.services.artifact_service import ArtifactService

HTML = '''<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
body{font-family:sans-serif;color:#222}h1{color:#183767}
</style></head><body><main><h1>Contrôle documentaire ORIA</h1>
<p>Texte avec <strong>mise en forme</strong> et diagramme vectoriel.</p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 100" width="320" height="100">
<rect x="10" y="10" width="300" height="80" fill="#d9e7f7"/>
<text x="30" y="58" fill="#17356d" font-size="20">Schéma vérifié</text>
</svg></main></body></html>'''
NATIVE_WORD = {'blocks': [
    {'type': 'title', 'text': 'Rapport ORIA'},
    {'type': 'subtitle', 'text': 'Contrôle du moteur Word'},
    {'type': 'heading', 'level': 2, 'text': 'Introduction'},
    {'type': 'paragraph', 'text': 'Contenu éditable et structuré.'},
    {'type': 'numbered_list', 'items': ['Vérifier', 'Publier']},
    {'type': 'table', 'headers': ['Année', 'Résultat'], 'rows': [[2025, 10], [2026, 20]]},
]}
NATIVE_XLSX = {'sheets': [
    {'name': 'Synthèse', 'rows': [['Indicateur', 'Valeur'], ['Essais', 2], ['Succès', 2]]}
]}


def main() -> None:
    service = ArtifactService()
    payload = {
        'schema_version': 'oria.artifact.v1',
        'sources': [{'id': 'pdf-html', 'kind': 'html', 'content': HTML}],
        'artifacts': [
            {'format':'pdf', 'filename':'smoke.pdf', 'source_id':'pdf-html', 'native_data':None},
            {'format':'docx', 'filename':'smoke.docx', 'source_id':None, 'native_data':NATIVE_WORD},
            {'format':'xlsx', 'filename':'smoke.xlsx', 'source_id':None, 'native_data':NATIVE_XLSX},
        ],
    }
    results = {a.extension: a.data for a in service.create_from_payload(payload)}
    assert results['pdf'].startswith(b'%PDF-') and len(results['pdf']) > 1500
    from docx import Document
    d = Document(io.BytesIO(results['docx']))
    assert d.paragraphs[0].style.name == 'Title'
    assert any('Contenu éditable' in p.text for p in d.paragraphs)
    assert len(d.tables) == 1
    from openpyxl import load_workbook
    book = load_workbook(io.BytesIO(results['xlsx']))
    assert book['Synthèse']['B2'].value == 2
    # Extra check: the PDF engine accepts native lists and creates a valid file.
    native_pdf = service.create_from_payload({
        'schema_version':'oria.artifact.v1', 'sources':[], 'artifacts':[
            {'format':'pdf','filename':'native.pdf','source_id':None,'native_data':NATIVE_WORD},
        ],
    })[0]
    assert native_pdf.data.startswith(b'%PDF-')
    print('ORIA_PREFLIGHT_OK: HTML/SVG -> PDF, native -> PDF/DOCX/XLSX')
    print('File sizes:', {fmt: len(value) for fmt,value in results.items()})
    print('No external API or user credits used.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ORIA_PREFLIGHT_FAILED: '+f'{type(error).__name__}: {error}', file=sys.stderr)
        raise
