# ORIA · Simulateurs interactifs V1

**Objet :** intégrer dans les réponses du Chat ORIA cinq formats de simulations *réellement interactives*, sans page HTML séparée et sans exécuter du code généré par un modèle.

Développé pour la structure du dépôt **ndediesso-collab/LBV-Connect.ia**, branche `main`, telle qu'inspectée le **11 novembre 2026**.

## Fonctionnement

1. Le Chat Web d'ORIA transmet déjà `visual_mode=true`. Ses prompts connaissent aujourd'hui neuf formats, mais pas de simulateur recalculable.
2. Le correctif ajoute les instructions de décision et le langage structuré `oria-sim` dans `Backend/app/services/prompt_service.py`. ORIA doit choisir ce visuel **de sa propre initiative** quand l'explication gagne à explorer des valeurs et des scénarios ; jamais systématiquement.
3. Le backend continue de stocker et de diffuser le contenu des réponses normalement. Aucun changement de facturation, de Supabase, de SSE, de routes API ou d'authentification.
4. Dans le Chat, le rendu Markdown reconnaît les blocs ```oria-sim. Il charge le composant React **à la demande**.
5. Le composant valide le JSON, crée des curseurs/sélecteurs/champs, recalcule localement les formules et produit les graphiques avec ECharts (bibliothèque déjà présente). Les manipulations ne font **aucun nouvel appel API**.

### Cinq formes disponibles

- `calculator` : simulateur à indicateurs instantanés et graphique comparatif facultatif.
- `comparison` : comparaison des scénarios bas/central/haut, valeurs modifiables et graphique.
- `projection` : courbe de progression sur 2 à 120 périodes ; variable spéciale `period`.
- `sensitivity` : courbe de sensibilité lorsqu'un paramètre varie de son minimum à son maximum.
- `allocation` : répartition avec diagramme annulaire et indicateurs (un total peut être exclu du graphique avec `"chart":false`).

### Installation sur Windows (VS Code)

1. Télécharge le ZIP, décompresse le dossier `ORIA_Simulateurs_V1` **à la racine du dépôt** (au même niveau que `Frontend` et `Backend`).
2. Ouvre un terminal dans le dépôt et lance d'abord :

   ```powershell
   py .\ORIA_Simulateurs_V1\install_oria_sim.py --repo . --dry-run
   ```

3. Si le contrôle est valide, applique les modifications :

   ```powershell
   py .\ORIA_Simulateurs_V1\install_oria_sim.py --repo .
   cd Frontend
   npm run build
   ```

4. Teste le chat en local et cinq demandes décrites ci-dessous, puis examine les changements avant de faire `git add`, `git commit` et `git push`. Render et Vercel seront mis à jour via votre procédure habituelle de déploiement.

**Sécurité :** l'installeur sauvegarde les deux fichiers existants modifiés avec le suffixe `.oria-sim-v1.bak` (une fois). Il n'altère ni les anciennes visualisations ni la facturation. Il est idempotent. **Ne déploie pas en production avant test.**

## Tests manuels indispensables

**Calculateur.** Écris dans le Chat : *« Estime le coût d'une IA selon le nombre d'utilisateurs actifs, de requêtes par jour et du coût par requête. »* Attendu : le modèle explique sa méthode, puis peut insérer un `oria-sim` automatique. Modifie un curseur : les résultats doivent changer instantanément.

**Comparaison.** *« Compare des scénarios prudent, central et ambitieux pour des ventes mensuelles. »* Attendu : boutons scénarios, résultats et barres ; changer la marge modifie les calculs.

**Projection.** *« Aide-moi à projeter une dépense mensuelle fixe sur 12 mois. »* Attendu : courbe temporelle mise à jour.

**Sensibilité.** *« Quelle influence a le nombre d'utilisateurs sur la consommation API ? »* Attendu : courbe calculée sur différentes hypothèses.

**Répartition.** *« Comment répartir mon budget marketing entre réseaux sociaux, événements et création de contenus ? »* Attendu : diagramme annulaire ; les montants modifiables actualisent immédiatement les parts.

**Contrôle négatif.** *« Quelle est la capitale du Gabon ? »* Attendu : réponse concise **sans** simulateur.

**Contrôle de robustesse.** Force un bloc `oria-sim` avec JSON mal formé : ORIA doit montrer son bloc de code de secours, sans planter la page. Teste aussi division par zéro, grands nombres, rechargement de la conversation, thème sombre, mobile et navigation.

## Essayer un exemple exact

Chaque fichier de `exemples/` contient le JSON du simulateur. Pour vérifier le moteur sans dépendre de la décision du modèle, poste un message demandant :

> Réponds avec un unique bloc de code Markdown de langage `oria-sim`, contenant exactement le JSON ci-dessous, sans le modifier : [coller le contenu de 01_calculateur.json]

L'affichage automatique restera probabiliste, puisqu'il dépend du modèle ; la présence du composant est **déterministe** dès qu'un bloc valide est reçu.

## Limites et décisions de V1

- **Web Chat uniquement** dans ce correctif. `visual_mode` reste désactivé par défaut pour les anciens clients Expo, qui n'ont pas forcément de renderer `oria-sim`.
- Les curseurs et le contenu sont affichés dans la conversation. Les valeurs modifiées sont **temporaires** : à la réouverture, le scénario repart des valeurs contenues dans le message sauvegardé. La persistance des états est un chantier V2.
- Le modèle n'envoie que du JSON et des expressions sous forme d'AST bornés. **Aucun `eval`, `Function`, iframe, script, HTML distant ni URL arbitraire** n'est exécuté dans ce composant.
- Le code vérifie les entrées, limite le nombre de champs, la profondeur des expressions et la taille du JSON. Il ne remplace pas des contrôles serveur pour un futur éditeur partagé.
- Les générateurs utilisent des **hypothèses explicites** lorsque les tarifs et chiffres réels ne sont pas fournis.
- L'instruction supplémentaire augmente légèrement la taille du prompt d'ORIA. Suivre le coût moyen des tokens d'entrée et le taux de réussite du modèle. Pour une future version à grande échelle, séparer un petit routeur de présentation et un schéma complet fourni uniquement aux requêtes pertinentes.
- Le `npm run build` complet n'a pas pu être exécuté ici : le dépôt connecté est en lecture seule et les dépendances du projet ne sont pas installées dans ce conteneur. Le moteur TypeScript, le parseur TSX et l'installeur ont en revanche passé des contrôles locaux de base.

## Fichiers concernés

```text
Frontend/components/oria-simulator/OriaSimulator.tsx           (nouveau)
Frontend/components/oria-simulator/OriaSimulator.module.css    (nouveau)
Frontend/components/oria-simulator/simulator-engine.ts         (nouveau)
Frontend/app/chat/page.tsx                                     (3 petites insertions)
Backend/app/services/prompt_service.py                         (instruction/contrat ajoutés)
```

## À surveiller pendant les tests utilisateurs

- Taux de simulateurs générés quand une demande le justifie.
- Taux de JSON invalide / repli en bloc de code.
- Nombre de simulateurs inutiles sur les questions simples.
- Temps de chargement du composant ECharts, surtout en PWA mobile.
- Coût d'entrée en tokens du prompt enrichi.

**Prochaine étape possible :** proposer une sauvegarde/export du scénario personnalisé et un format `oria-sim` adapté à l'application mobile Expo. Ces éléments ne font pas partie de la V1.
