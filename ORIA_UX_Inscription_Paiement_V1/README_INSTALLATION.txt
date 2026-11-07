ORIA — STABILISATION INSCRIPTION / PAIEMENT DÉCOUVERTE / CHAT
Version: UX 2026-11-07

PRIORITÉ 1 : INSCRIPTION
- Évite les clics multiples qui déclenchent signUp deux fois.
- Si une session authentifiée avec le même e-mail existe déjà, ouvre directement /chat.
- Si l'ancien essai a créé un compte mais n'a pas redirigé, essaye signInWithPassword
  avec l'adresse et le mot de passe saisis : en cas de session valide, ouvre /chat.
- Pour un nouveau compte, ouvre /chat dès que signUp retourne une session.
- Le PUT /profile/phone devient non bloquant ; le numéro et le pays restent dans
  user_metadata, déjà exploité par /payments/checkout quand auth.users.phone n'est pas prêt.
- Ne désactive pas la sécurité de Supabase. Si la confirmation e-mail est activée et
  qu'aucune session ne revient, une validation e-mail est toujours requise.
- Versions corrigées : Web (Next.js) ET mobile (Expo).

PRIORITÉ 2 : PAIEMENT DÉCOUVERTE
- Les paiements ne sont PAS annulés automatiquement au bout d'une minute.
- Les nouveaux liens de checkout Chariow sont sauvegardés dans metadata de
  payment_transactions pour LE MEME ordre de paiement.
- GET /payments/discovery/status indique à partir de 60 secondes si la même URL
  de checkout est récupérable, sans générer une deuxième commande.
- Sur la page Packs web, le bouton devient « Reprendre le paiement » lorsque
  le délai est écoulé. Idem pour la recharge unique Découverte.
- Le contrôle serveur can_buy, l'unicité et l'activation par webhook ne changent pas.
- Si /payments/checkout reste sans réponse pendant 60 secondes sur le Web,
  l'attente s'arrête, l'interface affiche une explication et relit le statut.
- Les QUATRE autres packs, leurs prix, leurs recharges, leurs paiements et
  toutes les fonctions de facturation sont inchangés.

ATTENTION — ancienne commande déjà bloquée :
- Le correctif ne peut pas récupérer le lien d'une ancienne transaction si
  sa metadata ne contient pas checkout_url.
- Si le statut est encore pending après une minute sans URL, il faut vérifier
  la vente dans le tableau de bord Chariow AVANT d'autoriser une autre commande.
- Une minute sans réponse ne prouve pas qu'un paiement a échoué.
- NE changez PAS le statut SQL en failed/cancelled sans confirmation fournisseur.
- Ne testez pas avec de nouveaux paiements si un débit précédent est possible.

PRIORITÉ 3 : CHAT
- Un compte sans portefeuille (réponse /credits/me 404) est un nouvel utilisateur
  légitime : le mobile n'affiche plus cette absence comme une erreur technique.
- Les pages Chat Web et mobile demandent « Acheter un pack pour discuter »
  sans débloquer les requêtes IA payantes.

FICHIERS MODIFIÉS UNIQUEMENT :
  mobile/src/app/register/index.tsx
  Frontend/app/register/page.tsx
  mobile/src/app/chat/index.tsx
  Frontend/app/chat/page.tsx
  Frontend/app/packs/page.tsx
  Backend/app/routes.py

INSTALLATION WINDOWS (PowerShell)
1. Placez le ZIP dans Téléchargements puis :
   cd C:\Users\LENOVO\Desktop\LBV-Connect.ia
   Expand-Archive "$env:USERPROFILE\Downloads\ORIA_UX_Inscription_Paiement_V1.zip" -DestinationPath . -Force

2. VALIDATION SANS CHANGEMENT :
   python .\ORIA_UX_Inscription_Paiement_V1\appliquer_correctif.py --check
   (S'il y a une erreur, ne forcez rien : le dépôt local diffère.)

3. APPLICATION :
   python .\ORIA_UX_Inscription_Paiement_V1\appliquer_correctif.py --apply

   Le script crée une sauvegarde des 6 fichiers + un DIFF dans un dossier
   FRÈRE du dépôt, nommé ORIA_UX_BACKUP_<date>.

4. VÉRIFICATIONS :
   git diff --check
   git diff --stat
   python -m py_compile Backend\app\routes.py
   cd Frontend
   npx tsc --noEmit
   cd ..\mobile
   npx tsc --noEmit
   cd ..

5. NE DÉPLOYEZ QUE SI les vérifications sont cohérentes.
   Déployez d'abord Backend sur Render, puis Frontend sur Vercel.
   Pour l'application Expo native, publier une mise à jour compatible
   ou une nouvelle build selon vos canaux de distribution.

6. TESTS FONCTIONNELS À FAIRE (sans dépenser d'argent tant que nécessaire) :
   a) Nouvelle adresse : création une fois, session, arrivée directe sur /chat.
   b) Même adresse après essai interrompu : connexion si mot de passe valide.
   c) Adresse déjà existante + mauvais mot de passe : aucune session créée.
   d) /credits/me = 404 : un bouton « Acheter un pack pour discuter » visible.
   e) Paiement Découverte commencé puis quitté : avant 60s, état en attente ;
      après 60s et lien conservé, « Reprendre le paiement » renvoie vers
      la MEME transaction, pas un nouveau POST /payments/checkout.
   f) Validation de l'achat UNIQUEMENT après webhook Chariow confirmé.
   g) Pack classique déjà actif : chat et crédits inchangés.

DIAGNOSTIC ANCIENNES TRANSACTIONS (SUPABASE SQL EDITOR, LECTURE SEULE) :
SELECT reference, status, created_at,
       metadata->>'checkout_url' AS lien_reprise_enregistre
FROM public.payment_transactions
WHERE pack_id = 'discovery_pack'
  AND status IN ('pending', 'processing')
ORDER BY created_at DESC
LIMIT 20;

Ne diffusez pas les références individuelles ni les URL de paiement en public.

LIMITES DE VALIDATION :
- Les tests hors ligne du transformateur et de ses ancres ont été exécutés.
- Les motifs du code source de la branche main ont été vérifiés un par un.
- Aucun vrai compte n'a été créé et aucun paiement n'a été tenté.
- Le build et les scénarios de bout en bout doivent être exécutés sur le PC,
  puis validés en environnement de test avant publication.
