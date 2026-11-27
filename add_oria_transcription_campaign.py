from __future__ import annotations

"""Ajoute ORIA Transcription aux mini-annonces promotionnelles internes d'ORIA.

A exécuter depuis la racine du dépôt LBV-Connect.ia.
Ne modifie que Frontend/components/oria-promo/campaigns.ts.
Ne touche ni aux règles de fréquence, ni aux autres campagnes, ni au backend.
"""

from datetime import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
CAMPAIGNS_FILE = ROOT / "Frontend" / "components" / "oria-promo" / "campaigns.ts"
CAMPAIGN_ID = 'id: "oria-transcription-launch-2026-11"'

NEW_CAMPAIGN = '''  {
    id: "oria-transcription-launch-2026-11",
    label: "ORIA Transcription",
    title: "Vos enregistrements deviennent des documents utiles.",
    description: "Transcrivez vos cours, réunions, discours et interviews. ORIA adapte le document au type de contenu et vous permet de récupérer un résultat structuré en PDF ou Word.",
    cta: "Découvrir ORIA Transcription",
    href: "/transcription",
    active: true,
  },
'''

ANCHOR = '''  {
    id: "assistant-public-launch-2026-11",
    label: "Assistant IA · Pro & Business",
    title: "Votre assistant IA, au service de vos visiteurs.",
    description: "Créez un assistant spécialisé dans votre activité, personnalisez ses consignes et partagez un lien public. Vos visiteurs posent leurs questions sans compte ORIA. Disponible avec un pack Pro ou Business actif.",
    cta: "Découvrir Assistant ORIA",
    href: "/packs#oria-assistant-vitrine",
    active: true,
  },
'''


def main() -> int:
    if not CAMPAIGNS_FILE.is_file():
        raise RuntimeError(
            "Fichier introuvable : Frontend/components/oria-promo/campaigns.ts. "
            "Place ce script à la racine de LBV-Connect.ia."
        )

    original = CAMPAIGNS_FILE.read_text(encoding="utf-8")

    if CAMPAIGN_ID in original:
        print("INFO : la campagne ORIA Transcription est déjà présente. Aucun changement effectué.")
        return 0

    occurrences = original.count(ANCHOR)
    if occurrences != 1:
        raise RuntimeError(
            f"Ancre de campagne Assistant ORIA trouvée {occurrences} fois (1 attendue). "
            "Aucun fichier n'a été modifié. Vérifie la version locale de campaigns.ts."
        )

    updated = original.replace(ANCHOR, ANCHOR + NEW_CAMPAIGN, 1)
    if updated.count(CAMPAIGN_ID) != 1:
        raise RuntimeError("Contrôle final de la nouvelle campagne échoué. Aucun fichier modifié.")
    if 'href: "/transcription"' not in updated:
        raise RuntimeError("Lien /transcription absent après préparation. Aucun fichier modifié.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = CAMPAIGNS_FILE.with_name(CAMPAIGNS_FILE.name + f".bak-oria-transcription-promo-{stamp}")
    backup.write_text(original, encoding="utf-8", newline="\n")

    try:
        CAMPAIGNS_FILE.write_text(updated, encoding="utf-8", newline="\n")
    except Exception:
        # Restaure la source si l'écriture échoue après création de la sauvegarde.
        CAMPAIGNS_FILE.write_text(original, encoding="utf-8", newline="\n")
        raise

    print("OK : mini-annonce ORIA Transcription ajoutée.")
    print("Fichier modifié : Frontend/components/oria-promo/campaigns.ts")
    print(f"Sauvegarde : {backup.relative_to(ROOT).as_posix()}")
    print("La campagne pointe vers /transcription et respecte le mécanisme de rotation existant.")
    print("Aucune modification des délais, plafonds quotidiens, autres campagnes, backend ou GitHub.")
    print("Vérification conseillée : cd Frontend ; npm run build")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
