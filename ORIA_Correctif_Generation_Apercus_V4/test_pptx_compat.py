from __future__ import annotations
from pathlib import Path
import io, ast, re, os
from typing import Any
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

class ArtifactError(RuntimeError): pass
class ArtifactDependencyError(ArtifactError): pass

source_path = Path(os.getenv('ORIA_ARTIFACT_SERVICE_PATH', 'Backend/app/services/artifact_service.py'))
if not source_path.is_file():
    raise SystemExit('Executer depuis la racine du depot, apres application du patch. Fichier artifact_service.py introuvable.')
full = source_path.read_text(encoding='utf-8')
start = full.index('    @staticmethod\n    def _normalize_pptx_slide_spec(')
end = full.index('        output=io.BytesIO();prs.save(output);return output.getvalue()', start) + len('        output=io.BytesIO();prs.save(output);return output.getvalue()')
methods = full[start:end]
class_stub = '''class ArtifactService:
    def _contract_slides(self, kind, source, native):
        return native['slides']
    def _draw_contract_slide_elements(self, slide, elements):
        from pptx.util import Inches
        from pptx.dml.color import RGBColor
        from pptx.enum.shapes import MSO_SHAPE
        for el in elements:
            if el['type'] == 'text':
                shp=slide.shapes.add_textbox(Inches(el.get('x',1)),Inches(el.get('y',2)),Inches(el.get('width',5)),Inches(el.get('height',2)))
                shp.text=el['text']
            elif el['type'] == 'rectangle':
                shape=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(el['x']),Inches(el['y']), Inches(el['width']), Inches(el['height']))
                shape.fill.solid();shape.fill.fore_color.rgb=RGBColor.from_string(el['fill'])
            else:
                raise ArtifactError('Unsupported element in isolated test')
    def _normalize_rows(self,table):
        return table
'''
namespace={'io':io,'re':re,'Any':Any,'ArtifactError':ArtifactError,'ArtifactDependencyError':ArtifactDependencyError}
code=class_stub+methods+'\n'
ast.parse(code)
exec(compile(code,'<pptx-compat-test>','exec'),namespace)
S=namespace['ArtifactService']()

def render(spec):
    out=S._contract_pptx(None,None,{'slides':[spec]})
    assert out[:2]==b'PK'
    return Presentation(io.BytesIO(out))

prs=render({'title':'Titre simple','bullets':['A','B']})
assert len(prs.slides)==1
prs=render({'title':'Traite','background':'#fff','layout':'title and content','objects':[{'type':'text','text':'Texte conserve','x':1,'y':2,'width':5,'height':2}]})
assert len(prs.slides)==1
assert prs.slides[0].background.fill.fore_color.rgb==RGBColor(255,255,255)
assert any('Texte conserve' in getattr(s,'text','') for s in prs.slides[0].shapes)
prs=render({'title':'Mixte','background':{'type':'solid','color':'#112233'},'objects':[{'type':'text_box','content':'Visuel'}], 'bullets':['Bullet A','Bullet B']})
assert len(prs.slides)==2
assert any('Visuel' in getattr(s,'text','') for s in prs.slides[0].shapes)
assert any('Bullet A' in getattr(s,'text','') for s in prs.slides[1].shapes)
prs=render({'title':'Colonnes','layout':'two_columns','bullets':['A','B','C','D']})
assert len(prs.slides)==1
assert len([s for s in prs.slides[0].shapes if getattr(s,'text','').startswith('•')])==2
prs=render({'title':'Couleurs','background':'#abc', 'objects':[{'type':'shape','shape':'rectangle','fill':'#AABBCC'}]})
assert prs.slides[0].background.fill.fore_color.rgb==RGBColor(170,187,204)
try:
    render({'title':'Non autorise','objects':[{'type':'video','src':'https://example.com'}]})
except ArtifactError as e:
    assert 'non pris en charge' in str(e)
else:
    raise AssertionError('An unknown object should not be ignored')
try:
    render({'title':'Non autorise','background':{'type':'gradient','color':'#FFFFFF'}})
except ArtifactError as e:
    assert 'couleurs unies' in str(e)
else:
    raise AssertionError('Unsupported background should not silently disappear')
print('OK: presentation PowerPoint reelle : 7 cas (preservation, mixte, mise en page, couleurs, refus securises).')
