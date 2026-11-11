# ORIA — Connaissance produit V2 (correctif de la V1)

## Pourquoi cette correction ?
La V1 contient des informations trop générales et interdit au modèle de répondre précisément sur les prix standards. Son détecteur ne reconnaît pas certaines questions de suivi (« Nan je parle plus de ton système de crédits et de pack »). La V2 corrige ces deux lacunes.

La V2 conserve le rôle `developer` pour les connaissances produit sur **OpenAI** et **OpenRouter**. Elle reconnaît les questions de suivi à l'aide de l'historique de conversation transmis au modèle, et lit au moment de la requête les valeurs de crédits, prix standards et validités depuis `Backend/app/config/credit_costs.py`. Les offres promotionnelles et les données propres à un compte restent celles affichées ou validées par le backend.

**Fichiers modifiés uniquement** :
- `Backend/app/services/oria_product_knowledge.py`
- `Backend/app/services/openai_service.py`
- `Backend/app/services/openrouter_chat_service.py`

Aucune modification de facturation, Supabase, prix de packs, crédits, site, frontend ou paiement. Déploiement Render nécessaire. **Ce correctif suppose que la V1 est déjà intégrée**.

## Installation en une fois sur Windows PowerShell

Ouvrir un terminal à la racine du dépôt local et coller :

```powershell
cd "C:\Users\LENOVO\Desktop\LBV-Connect.ia"
$zip = Get-ChildItem "$env:USERPROFILE\Downloads\ORIA_Connaissance_Produit_V2*.zip" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw "ZIP V2 introuvable dans Téléchargements" }
Expand-Archive -LiteralPath $zip.FullName -DestinationPath . -Force
py .\ORIA_Connaissance_Produit_V2\install_oria_knowledge_v2.py --repo . --dry-run
```

Si le résultat indique **OK**, installer :

```powershell
py .\ORIA_Connaissance_Produit_V2\install_oria_knowledge_v2.py --repo .
py -m compileall -q .\Backend\app\services\oria_product_knowledge.py .\Backend\app\services\openai_service.py .\Backend\app\services\openrouter_chat_service.py
git diff --check
git status --short
```

Pousser les changements (après inspection) :

```powershell
git add Backend/app/services/oria_product_knowledge.py Backend/app/services/openai_service.py Backend/app/services/openrouter_chat_service.py
git commit -m "fix: ORIA connaît ses packs et crédits et comprend les suivis"
git push origin main
```

Le correctif ne sera visible sur myoriaai.com qu'après la réussite du déploiement de Render, si le service suit `main`.

## Tests après déploiement

Dans une conversation neuve, recherche Web désactivée :
1. « Explique-moi comment fonctionnent les crédits ORIA et tes packs. »
2. « Et quels sont les prix standards ? »
3. « Combien de crédits ai-je sur mon compte ? »
4. « Et si je veux acheter une recharge ? »
5. « Explique-moi la photosynthèse. » (aucune publicité sur ORIA)

Attendu : explication directe du mécanisme et des 4 packs, chiffres standards configurés dans le backend, distinction entre tarifs standards et promotions, et pas d'invention du solde du compte. Les réponses des modèles restent probabilistes ; tester plusieurs modèles et parcours.

## Limites
- La V2 ne fournit pas la **promotion active** ni le **solde d'un utilisateur** au modèle, sauf si le backend transmet ces données explicitement.
- Les prix mentionnés proviennent du fichier de configuration Python : si les prix facturés en checkout suivent une autre source, celle-ci reste prioritaire.
- Les tests fournis vérifient le détecteur et l'installateur, pas la réponse de production d'un modèle ni une facturation réelle.
