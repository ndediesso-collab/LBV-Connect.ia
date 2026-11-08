ORIA — CORRECTIF CIBLÉ MINI-STUDIO DÉCOUVERTE
============================================

CAUSE CONFIRMÉE DANS LE DÉPÔT (8 novembre 2026)
Le Mini-Studio choisissait Google ou OpenRouter d'après une variable globale.
Or le backend accorde les créations Découverte exclusivement sur OpenRouter.
De plus, aucune offre Découverte n'existait dans les sélecteurs Image/Vidéo,
et le Web exigeait 720p pour un clip alors que Découverte autorise 480p.

COMPORTEMENT PRÉVU APRÈS CORRECTION
- Découverte : Recraft (images 1K, mode texte-vers-image)
- Découverte : Grok Lite (clip de 4 s, 480p)
- Projets vidéo multi-scènes : interdits avec Découverte
- Pas de quota de générations autre que les crédits et contrôles du backend
- Prix, crédits, achats uniques, webhooks, packs classiques : inchangés
- Les quatre packs classiques gardent le fournisseur qui était déjà configuré
- Aucune création payante n'est lancée automatiquement

INSTALLATION — POWERSHELL
1. Ouvrir PowerShell à la racine de LBV-Connect.ia :
   cd C:\Users\LENOVO\Desktop\LBV-Connect.ia

2. Extraire l'archive téléchargée à la racine :
   Expand-Archive "$env:USERPROFILE\Downloads\ORIA_Fix_Decouverte_Image_Video.zip" -DestinationPath . -Force

3. Valider toutes les correspondances avant tout changement :
   python .\ORIA_Fix_Decouverte_Image_Video\appliquer_correctif.py --check

4. Appliquer si --check affiche OK :
   python .\ORIA_Fix_Decouverte_Image_Video\appliquer_correctif.py --apply

5. Vérifier les modifications :
   git diff --check
   git diff --stat
   cd Frontend
   npx tsc --noEmit
   cd ..

6. Déployer le Frontend sur Vercel. Le composant Expo est également corrigé,
   mais une nouvelle compilation Expo est nécessaire pour l'application native.
   Une PWA basée sur le Frontend bénéficie du déploiement Vercel.

SAUVEGARDES
Le script crée des fichiers *.tsx.bak-decouverte-YYYYMMDD-HHMMSS dans
les mêmes dossiers avant modification. Il refuse les fichiers non reconnus.

SI LE STUDIO AFFICHE ENCORE "CRÉATIONS DÉSACTIVÉES"
Le serveur n'autorise des créations OpenRouter payantes que si
ORIA_OPENROUTER_PAID_CREATIONS_ENABLED=1,
ORIA_OPENROUTER_STORAGE_REVIEWED=1,
OPENROUTER_API_KEY est configurée,
ORIA_OPENROUTER_IMAGE_MAX_USD et ORIA_OPENROUTER_VIDEO_MAX_USD sont positifs.
Il faut également ORIA_DISCOVERY_ENABLED=1 pour Découverte.
Ne pas activer ces paramètres sans avoir vérifié les réservations, la grille
et les mécanismes de conservation des créations sur Render/Supabase.
Le correctif UI n'outrepasse JAMAIS les contrôles du backend.

VALIDATION
- Contrôles d'ancrage vérifiés sur les deux fichiers GitHub actuels.
- Script Python : compilation OK.
- AUCUNE génération facturable ni test bout en bout contre Render effectué.
- Tester 1 image, puis 1 devis vidéo SANS lancer la génération au départ.

FICHIERS UNIQUEMENT :
Frontend/components/oria-mini-studio/OriaMiniStudio.tsx
mobile/src/components/oria-mini-studio/OriaMiniStudio.tsx
