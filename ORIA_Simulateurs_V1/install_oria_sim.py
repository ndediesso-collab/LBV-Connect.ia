#!/usr/bin/env python3
"""Installe ORIA Simulateurs V1 dans une copie locale du dépôt LBV-Connect.ia.

Exemples :
  python install_oria_sim.py --repo "C:\\chemin\\LBV-Connect.ia" --dry-run
  python install_oria_sim.py --repo "C:\\chemin\\LBV-Connect.ia"
"""
import argparse
import shutil
from pathlib import Path

MODULE = Path("Frontend/components/oria-simulator")
PAGE = Path("Frontend/app/chat/page.tsx")
PROMPT = Path("Backend/app/services/prompt_service.py")

# Sous-ensemble du schéma: le modèle transmet des DATA, pas du JS/HTML.
INSTRUCTIONS = '''
10) ```oria-sim : simulateur INTERACTIF (calcul local dans le navigateur).
   Utilise-le SPONTANÉMENT, même sans demande explicite, pour aider à explorer
   des hypothèses modifiables : consommation de crédits, budget, coûts, tarifs,
   utilisateurs, capacité, croissance, rentabilité, projection, compromis.
   Ne l'utilise PAS pour une réponse factuelle simple, une situation sans
   paramètres utiles ou pour créer un décor. Ne multiplie pas les simulateurs.
   Le simulateur complète le raisonnement, il ne remplace pas l'explication.
   Si l'utilisateur demande un "tableau interactif" avec curseurs, privilégie
   oria-sim plutôt qu'un fichier HTML, une grille AG Grid ou du code à copier.
   Choisis un des 5 modes selon l'intention, et non toujours le même :
   - calculator : paramètres -> plusieurs indicateurs instantanés.
   - comparison : scénarios prédéfinis comparés et modifiables.
   - projection : courbe sur N périodes, variable réservée "period" (1 à N).
   - sensitivity : variation d'un paramètre sur toute sa plage.
   - allocation : répartition d'un budget/composantes en diagramme annulaire.
   Donne UN objet JSON, sans scripts, CSS, HTML, JSX ni chaînes de formules.
   Schéma :
   {"title":"Coût API d'ORIA","kind":"calculator","description":"Déplace les curseurs pour estimer le coût.","inputs":[{"id":"users","label":"Utilisateurs / jour","control":"slider","min":0,"max":1000,"step":10,"value":360,"unit":""},{"id":"requests","label":"Requêtes / utilisateur","control":"slider","min":1,"max":30,"step":1,"value":10,"unit":""},{"id":"cost","label":"Coût / requête","control":"number","min":0,"max":100,"step":0.5,"value":5,"unit":"FCFA"}],"outputs":[{"id":"daily","label":"Coût / jour","expr":{"op":"mul","args":["users","requests","cost"]},"unit":"FCFA","precision":0},{"id":"monthly","label":"Coût / 30 jours","expr":{"op":"mul","args":["daily",30]},"unit":"FCFA","precision":0}],"assumptions":"Données fictives : adaptez les coûts aux tarifs réels."}
   Champs obligatoires : title, kind, inputs, outputs. Chaque input :
   id unique (lettres/chiffres/_), label, control (slider/number/select),
   min < max, step > 0, value entre min et max, unit (facultatif).
   Si control=select, options=[{"label":"Petit","value":1},...], min/max
   doivent encadrer les valeurs et value doit correspondre à une option.
   Chaque output : id unique, label, expr, unit facultatif, precision 0 à 4.
   Facultatif : "chart":false pour exclure un total du graphique sans
   l'exclure des cartes de résultats.
   Expr = nombre JSON, id d'input/OUTPUT PRÉCÉDENT, ou objet
   {"op":"mul","args":["users",3]}.
   Opérations AUTORISÉES : add, sub, mul, div, min, max, pow, abs, round.
   sub/div/pow = exactement 2 arguments ; abs/round = 1 argument.
   Aucun accès à des fonctions arbitraires, aucun symbole non déclaré,
   aucun JavaScript, aucun eval, aucune formule Excel ni chaîne mathématique.
   Limites : 8 inputs, 8 outputs, 6 scénarios, 120 périodes, 61 points.
   comparison requiert "scenarios":[{"name":"Bas","values":{"users":100}},
   {"name":"Haut","values":{"users":800}}] (au moins deux).
   projection : "periods":12,"periodUnit":"mois" ; dans expr, "period"
   vaut 1,2,...,12. Exemple cumul : {"op":"mul","args":["monthly","period"]}.
   sensitivity : "sweepVariable":"users","points":25 ; courbe de
   outputs selon la plage min/max de cet input.
   allocation : plusieurs outputs représentant chacun une part non négative.
   Indique explicitement les hypothèses/fictifs dans "assumptions".
   N'invente pas de sources, tarifs officiels ni indicateurs constatés.
   Vérifie la validité du JSON et l'absence de division par zéro.

'''

def apply(repo: Path, dry_run: bool) -> None:
    repo = repo.expanduser().resolve()
    page_path = repo / PAGE
    prompt_path = repo / PROMPT
    if not page_path.is_file() or not prompt_path.is_file():
        raise SystemExit("Dépôt invalide : Frontend/app/chat/page.tsx ou Backend/app/services/prompt_service.py introuvable.")
    page = page_path.read_text(encoding="utf-8-sig")
    prompt = prompt_path.read_text(encoding="utf-8-sig")

    # Patch ponctuel du Chat, sans remplacer les ~8800 lignes existantes.
    if "const OriaSimulator = dynamic(" not in page:
        anchor = "const OriaVisual3D = dynamic("
        assert page.count(anchor) == 1, "Point d'insertion import introuvable"
        page = page.replace(anchor, '''// Simulateurs déclaratifs ORIA : chargés uniquement si nécessaires.
const OriaSimulator = dynamic(
  () => import("@/components/oria-simulator/OriaSimulator"),
  { ssr: false, loading: () => <div role="status" className="my-4 rounded-xl border border-border p-4 text-xs text-muted">Chargement du simulateur…</div> },
);
''' + anchor, 1)
        anchor = '"oria-3d", "oria-map"].includes(codeLanguage)'
        assert page.count(anchor) == 1, "Validation JSON visuel introuvable"
        page = page.replace(anchor, '"oria-3d", "oria-map", "oria-sim"].includes(codeLanguage)', 1)
        anchor = '''          : codeLanguage === "oria-3d"
            ? <OriaVisual3D'''
        assert page.count(anchor) == 1, "Rendu visuel à compléter introuvable"
        page = page.replace(anchor, '''          : codeLanguage === "oria-sim"
            ? <OriaSimulator key={`sim-${blockIndex}`} raw={code} language={language} fallback={codeFallback} />
          : codeLanguage === "oria-3d"
            ? <OriaVisual3D''', 1)

    # Le Chat Web fournit déjà visual_mode=true. Les anciens clients Expo
    # continuent de fonctionner : aucun nouveau champ HTTP requis.
    if "10) ```oria-sim" not in prompt:
        anchor = "CHOIX DU BON RENDU\n"
        assert prompt.count(anchor) == 1, "Instructions visualisation introuvables"
        prompt = prompt.replace(anchor, INSTRUCTIONS + anchor, 1)
        prompt = prompt.replace("l'un des neuf identifiants", "l'un des dix identifiants", 1)
        prompt = prompt.replace("- Évolution, comparaison, distribution : oria-chart.", "- Paramètres modifiables / exploration d'hypothèses : oria-sim.\n- Évolution, comparaison, distribution de données fixes : oria-chart.", 1)

    source = Path(__file__).resolve().parent / MODULE
    dest = repo / MODULE
    if dry_run:
        print("[DRY-RUN] Prêt à modifier :", PAGE, PROMPT)
        print("[DRY-RUN] Fichiers à ajouter :", *(item.name for item in source.iterdir()))
        return
    dest.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if item.is_file():
            target = dest / item.name
            if target.exists() and target.read_bytes() != item.read_bytes():
                shutil.copy2(target, target.with_name(target.name + ".oria-sim-v1.bak"))
            shutil.copy2(item, target)
    for path, content in ((page_path, page), (prompt_path, prompt)):
        old = path.read_text(encoding="utf-8-sig")
        if old != content:
            backup = path.with_name(path.name + ".oria-sim-v1.bak")
            if not backup.exists():
                shutil.copy2(path, backup)
            path.write_text(content, encoding="utf-8")
            print("Modifié :", path.relative_to(repo))
        else:
            print("Déjà à jour :", path.relative_to(repo))
    print("Simulateurs ORIA V1 installés. Exécuter ensuite 'npm run build' dans Frontend.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Installer ORIA Simulateurs V1")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Racine du dépôt LBV-Connect.ia")
    parser.add_argument("--dry-run", action="store_true", help="Valider les points d'insertion sans modifier")
    args = parser.parse_args()
    apply(args.repo, args.dry_run)
