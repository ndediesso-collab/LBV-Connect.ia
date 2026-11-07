ORIA — Code-First Qualite V5 — correctif incremental APRES la V4

OBJECTIF
Le modele ORIA peut composer du HTML/CSS structure et professionnel ;
ArtifactService le valide puis le compile vers un vrai fichier.
Ce correctif cree une route OPT-IN pour conserver le rendu visuel
pour PPTX et ODP, et une route HTML semantique pour EPUB.
Il conserve les moteurs natifs historiques et le protocole oria.artifact.v1.

NE PAS confondre cet ajout avec une refonte de tous les formats.
PDF, DOCX, XLSX, ODS, RTF, ODT, CSV, JSON, SQLite, ZIP, code, chat,
credits et paiements restent strictement sur leurs chemins actuels.

CHANGEMENTS DANS LE PATCH
- Backend/app/services/artifact_service.py : deux branches opt-in,
  detectees par <section class="oria-slide"> (PPTX/ODP) ou
  <section class="oria-chapter"> (EPUB), avant les branches historiques.
- Backend/app/services/artifact_visual_deck.py : nouveau, genere 1 image
  par diapositive via le moteur PDF deja utilise par ORIA, puis un
  vrai fichier PPTX ou ODP. Source HTML verifiee, aucune URL chargee.
- Backend/app/services/artifact_visual_book.py : nouveau, genere un
  EPUB avec les styles HTML, les chapitres XHTML et images integrees.
- Backend/app/services/artifact_visual_preview.py : nouveau, fabrique
  des miniatures pour PPTX/ODP de ce mode precis (18 maximum).
- Backend/app/services/artifact_universal_preview.py : conserve les lecteurs
  actuels mais detecte le mode Code-First et affiche les miniatures.
- Frontend/app/chat/page.tsx : affiche les miniatures dans l'apercu ORIA,
  sans perturber les autres lectures (PDF, Word, Excel, code, etc.).
- Backend/app/services/prompt_service.py : instructions Code-First pour
  PPTX/ODP et EPUB ; autres formats et consignes historiques conserves.

CONDITIONS ET LIMITES
1. La presentation web fournie en reference n'est PAS un document
   autorise tel quel. Elle contient du JS et des images distantes.
   Le modele doit generer une version documentaire statique conforme,
   sans scripts, sans boutons interactifs, sans sources externes.
2. En mode qualite visuelle, les diapositives PPTX/ODP sont des
   images hautes resolutions. La forme graphique est preservee, mais
   les zones de texte et figures ne sont PAS editables individuellement.
   Le mode historique native_data.slides reste disponible pour un
   PowerPoint editable, avec une mise en page plus limitee.
3. Qualite et exactitude dependent aussi du code HTML/CSS produit par
   le modele. Le compilateur n'invente ni photos ni chiffres et ne
   declenche PAS de seconde tentative IA.
4. Les apercus sont prives, en lecture seule, et bornes a 8 Mo dans la
   route universelle V4. Fichiers plus grands : telechargement.
5. La pagination 16:9 et les grandes pertes de texte sont controlees,
   mais aucun moteur automatique ne remplace la validation visuelle.
6. La conversion en ligne sur Render et la creation via le modele
   ne sont pas testees ici : essais seulement locaux et sans facturation.

INSTALLATION — IMPORTANT
- Ce patch doit etre applique APRES V4, une seule fois.
- Extraire ORIA_CODE_FIRST_QUALITE_V5.patch dans la racine
  C:\Users\LENOVO\Desktop\LBV-Connect.ia
- Dans PowerShell :
  git apply --check --ignore-whitespace .\ORIA_CODE_FIRST_QUALITE_V5.patch
  git apply --ignore-whitespace .\ORIA_CODE_FIRST_QUALITE_V5.patch
  git diff --check
  git status --short
- VERIFIER et AJOUTER aussi les nouveaux fichiers non suivis :
  git add Backend/app/services/artifact_service.py Backend/app/services/prompt_service.py Backend/app/services/artifact_universal_preview.py Backend/app/services/artifact_visual_deck.py Backend/app/services/artifact_visual_book.py Backend/app/services/artifact_visual_preview.py Frontend/app/chat/page.tsx
  git diff --cached --stat
- Commit/push seulement apres controle des changements.
- Render backend d'abord, puis Vercel.
- Ne pas appliquer le patch V4 une seconde fois.

TESTS EFFECTUES
- Composition de 3 diapositives HTML/CSS en PPTX et en ODP : archives
  valides, fichiers ouverts en lecture via python-pptx et odfpy.
- Miniatures reelles 3/3 pour PPTX et ODP.
- Ancien PPTX natif : lecteur existant conserve.
- EPUB Code-First : zip, mimetype, chapitres XHTML et image embarquee.
- Refus des sources vides ou sans sections attendues.
- Syntaxe Python et git apply --check dans un arbre de simulation.

PROCHAINES ETAPES QUALITE, NON INCLUSES
- ODT/RTF : styles natifs (pagination, typographies, figures).
- ODS : styles et calculs natifs, sans convertir le tableur en image.
- PPTX/ODP editables a haute fidelite : moteur d'objets vectoriels
  dedie, distinct du mode image visuellement fidele.
- Apercus pagines pour les fichiers au-dela du seuil universal-preview.
