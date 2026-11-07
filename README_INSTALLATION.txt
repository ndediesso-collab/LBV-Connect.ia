ORIA — CORRECTIF GENERATION ET APERCUS V4

Cette version remplace les V1/V2/V3, qui NE DOIVENT PAS ETRE APPLIQUEES
sur la meme copie de travail. Construite pour le code source de la branche
main et le correctif V3 non encore installe.

CAUSE PPTX CONFIRMEE PAR RENDER
ORIA_ARTIFACT_FAILURE ref=c39ec8f8e0 stage=conversion
ArtifactError: Champ de diapositive non pris en charge : background, layout, objects
Le moteur python-pptx et le stockage ne sont pas en cause pour cet incident.

CORRECTIF CIBLE
- Backend/app/services/artifact_service.py : seul le chemin PPTX est adapte.
  * background : couleurs unies (hexadecimal ou quelques noms connus)
  * layout : mise en page standard ou deux colonnes pour listes
  * objects : conversion bornee en elements textes/rectangles/images/graphiques
  * objects + bullets/table/chart : conservation sur diapositives consecutives
  * type inconnu / image dangereuse : refus explicite, pas de perte silencieuse
  Les autres formats PDF/DOCX/EPUB/XLSX/ODS... restent inchanges.

V3 REPRIS DANS LE MEME PATCH
- Reconnaissance des demandes de fichiers explicites et elliptiques
- Apercu prive / passif pour les autres formats generes
- Readers PDF/DOCX/XLSX/Code conserves
- Instructions PPTX resserrees dans prompt_service.py

FICHIERS MODIFIES (ET UNIQUEMENT EUX)
  Backend/app/route/ai.py
  Backend/app/services/artifact_service.py
  Backend/app/services/prompt_service.py
  Backend/app/services/artifact_universal_preview.py [nouveau]
  Frontend/app/chat/page.tsx

APPLIQUER SUR LE DEPOT ORIGINAL NON MODIFIE
1. Dezipper le fichier ORIA_GENERATION_APERCUS_V4.patch a la racine du depot.
2. Depuis PowerShell a la racine du depot :
   git apply --check --ignore-whitespace .\ORIA_GENERATION_APERCUS_V4.patch
3. Si la verification ne produit aucune erreur :
   git apply --ignore-whitespace .\ORIA_GENERATION_APERCUS_V4.patch
4. git diff --check
5. git diff --stat
6. Deploy Render backend, puis Vercel frontend.

NE PAS appliquer V3 puis V4. Si V3 a deja ete appliquee, utiliser seulement
ORIA_PPTX_COMPAT_CIBLE.patch (fourni dans cette archive).

TESTS
- Le patch combine est applicable sur la copie de test du code source.
- Syntaxe backend ai.py et nouveau moteur d'apercu controlee.
- 7 essais PPTX locaux avec python-pptx : fond, objets, mixte, colonnes,
  compatibilite du contrat precedent et refus des elements non pris en charge.

LIMITES
- Test effectue hors production : il n'inclut pas le JSON exact du modele
  qui a echoue. Si sa structure objects est differente, le backend produira
  une erreur plus precise a partir de laquelle adapter uniquement le PPTX.
- Les previews universelles sont des apercus en lecture seule, non des
  reproductions pixel a pixel ; limite 8 Mo comme dans V3.
- Aucune modification des packs, paiements, credits ou API des fournisseurs.
