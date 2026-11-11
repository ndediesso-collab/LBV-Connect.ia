ORIA — MES CRÉATIONS / APERÇUS UNIVERSels (V2)

OBJET
  Mise à jour frontend uniquement de Frontend/app/mes_creations/page.tsx.
  Réutilise la route existante GET /ai/artifacts/{id}/universal-preview.
  Ne modifie pas le backend, les générateurs, les crédits, les paiements,
  les quatre packs classiques ou le Pack Découverte.

CE QUI CHANGE
  - PPTX/ODP : diapositives, y compris images fidèles si disponibles.
  - ODT/RTF/EPUB : extrait du contenu en lecture seule.
  - ODS/CSV/TSV/SQLite : aperçu de tableaux.
  - ZIP : inventaire des fichiers sans exécuter l'archive.
  - Autres formats : aperçu texte si pris en charge par le backend.
  - Filtres de fichiers : Documents, Tableurs, Présentations, Code/Web,
    Données, Archives, Autres. Les images et vidéos existantes sont conservées.
  - PDF/DOCX/XLSX : lecteurs existants inchangés.
  - Téléchargement et protection des documents de cours inchangés.

INSTALLATION DANS POWERSHELL
  cd C:\Users\LENOVO\Desktop\LBV-Connect.ia
  Expand-Archive "$env:USERPROFILE\Downloads\ORIA_Mes_Creations_Formats_V2.zip" -DestinationPath . -Force
  python .\ORIA_Mes_Creations_Formats_V2\appliquer_correctif.py --check
  python .\ORIA_Mes_Creations_Formats_V2\appliquer_correctif.py --apply
  git diff --check
  git diff --stat
  cd Frontend
  npx tsc --noEmit

DÉPLOIEMENT
  Commit + push uniquement après vérification de la compilation ;
  déployer le frontend Vercel. La route d'aperçu universel doit déjà être
  déployée sur Render (elle existe dans le code backend lu le 10/11/2026).

TESTS MANUELS
  - Ouvrir Mes créations et le filtre Fichiers.
  - Vérifier PPTX visuel (miniatures) et PPTX classique (texte).
  - Vérifier un CSV ou ODS : tableau et scrolling.
  - Vérifier un ZIP : simple liste de noms.
  - Vérifier PDF, DOCX, XLSX : aperçu historique inchangé.
  - Vérifier téléchargement, suppression, créations cours protégées.

LIMITES
  La qualité d'aperçu dépend du backend : certains formats ne donnent que
  le contenu en texte, et les gros fichiers peuvent dépasser sa limite 8 Mo.
  L'aperçu ne crée pas les fichiers ; ceux-ci doivent déjà être persistés
  en tant qu'artifacts dans Supabase.
