from pathlib import Path
import importlib.util,sys,zipfile,io,base64
from lxml import etree
root=Path(__file__).resolve().parents[1];p=root/'Backend/app/services/artifact_visual_book.py'
s=importlib.util.spec_from_file_location('eb',p);m=importlib.util.module_from_spec(s);sys.modules['eb']=m;s.loader.exec_module(m)
source='''<!doctype html><html><head><style>.oria-chapter h1{color:#b44f3a}p{line-height:1.6}</style></head><body>
<section class="oria-chapter"><h1>Introduction</h1><p>Le contexte historique.</p></section>
<section class="oria-chapter"><h1>Déportation et résistance</h1><p>Des parcours humains.</p><ul><li>Histoire</li><li>Mémoire</li></ul></section>
</body></html>'''
out=m.compile_visual_epub(source,'Histoire.epub',image_reader=lambda url: (_ for _ in ()).throw(AssertionError('pas de photo')))
with zipfile.ZipFile(io.BytesIO(out)) as z:
 assert z.testzip() is None
 assert z.namelist()[0]=='mimetype'
 assert z.read('mimetype')==b'application/epub+zip'
 for fn in ['EPUB/content.opf','EPUB/nav.xhtml','EPUB/chapter1.xhtml','EPUB/chapter2.xhtml']:
  etree.fromstring(z.read(fn))
 assert b'color:#b44f3a' in z.read('EPUB/style.css')
 (root/'ORIA_DEMO_QUALITE.epub').write_bytes(out)
 print('EPUB okay',len(out))
# Le mode Code-First conserve aussi les images intégrées, sans URL distante.
from PIL import Image
pix=io.BytesIO();Image.new('RGB',(16,10),(181,79,58)).save(pix,format='PNG')
uri='data:image/png;base64,'+base64.b64encode(pix.getvalue()).decode('ascii')
source_img='''<html><head><style>img{max-width:100%;}</style></head><body><section class="oria-chapter"><h1>Illustration</h1><p>Repère visuel.</p><img alt="Repère" src="'''+uri+'''" /></section></body></html>'''
def read_inline(src):
 assert src.startswith('data:image/png;base64,')
 return 'png',base64.b64decode(src.split(',',1)[1])
book=m.compile_visual_epub(source_img,'Illustration.epub',image_reader=read_inline)
with zipfile.ZipFile(io.BytesIO(book)) as z:
 assert 'EPUB/image1.png' in z.namelist()
 assert b'image1.png' in z.read('EPUB/chapter1.xhtml')
print('EPUB image intégree OK')
