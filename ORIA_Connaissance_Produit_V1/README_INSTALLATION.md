# ORIA — Connaissance produit V1

## But
Permettre à ORIA de répondre correctement aux questions sur son propre fonctionnement, que la recherche Web soit active ou non.

## Fichiers concernés
- **Ajout** : `Backend/app/services/oria_product_knowledge.py` — fiche produit interne, contexte envoyé uniquement si une question porte sur ORIA.
- **Modification ciblée** : `Backend/app/services/openai_service.py` — ajout du bloc en message `developer` dans le flux OpenAI.
- **Modification ciblée** : `Backend/app/services/openrouter_chat_service.py` — même mécanisme en OpenRouter.

Ne modifie pas : `prompt_service.py` (l'identité actuelle reste intacte), le frontend, la base Supabase, les prix, les packs, les crédits, les méthodes de paiement, la recherche Web ou la génération média.

## Installation depuis PowerShell (VS Code)
1. Extraire le ZIP téléchargé.
2. Placer le dossier extrait `ORIA_Connaissance_Produit_V1` à la racine du dépôt `LBV-Connect.ia`, à côté de `Backend` et `Frontend`.
3. Depuis la racine du dépôt :

```powershell
py .\ORIA_Connaissance_Produit_V1\install_oria_knowledge.py --repo . --dry-run
py .\ORIA_Connaissance_Produit_V1\install_oria_knowledge.py --repo .
```

> L'installateur peut aussi découvrir automatiquement la racine du dépôt lorsqu'il est appelé depuis un sous-dossier du projet. En cas de divergence des fichiers sources, il s'arrête plutôt que d'écraser du code inconnu.

## Contrôles avant publication

```powershell
py -m compileall -q .\Backend\app\services\oria_product_knowledge.py .\Backend\app\services\openai_service.py .\Backend\app\services\openrouter_chat_service.py
git diff --check
git diff -- Backend/app/services/openai_service.py Backend/app/services/openrouter_chat_service.py
```

Tester depuis un compte ORIA non privilégié, avec recherche Web **désactivée** puis **activée** :
- « Qu'est-ce qu'ORIA ? »
- « Comment fonctionnent les crédits ORIA ? »
- « Combien me reste-t-il de crédits ? » — ne doit **pas inventer** un solde.
- « ORIA peut-elle créer des vidéos ? » — réponse conditionnelle selon le pack et le studio.
- « Quels modèles sont accessibles dans mon pack ? » — ne doit **pas inventer** la disponibilité.
- « Explique la photosynthèse » — doit répondre normalement, sans parler d'ORIA.

## Pousser sur GitHub
Après validation :

```powershell
git add Backend/app/services/oria_product_knowledge.py Backend/app/services/openai_service.py Backend/app/services/openrouter_chat_service.py
git commit -m "feat: teach ORIA verified product knowledge"
git push origin main
```

Vérifier le déploiement de **Render**. Ce correctif touche seulement le backend ; Vercel n'a pas besoin d'un changement frontend.

## Limites
- La connaissance de la plateforme n'accorde aucun accès aux informations du compte utilisateur et ne remplace pas les calculs réels de crédits, de pack et de facturation.
- Les pages `https://www.myoriaai.com/legal?tab=about`, `?tab=working`, `?tab=credits` servent de références publiques ; aucune requête Web n'est déclenchée automatiquement.
- Un prix ou une disponibilité publiés sur une page ancienne ne doivent pas être considérés comme valeurs à jour. Le backend et l'interface de paiement font foi.
- L'ajout d'un contexte via `developer` augmente le nombre de tokens des réponses **concernant ORIA** ; les autres demandes ne reçoivent pas ce bloc.
