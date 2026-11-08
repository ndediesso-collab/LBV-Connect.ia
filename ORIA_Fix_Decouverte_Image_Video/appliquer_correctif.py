#!/usr/bin/env python3
"""Correctif ciblé ORIA Mini-Studio (Web & Expo).

Routage Découverte > OpenRouter, offres Recraft 1K & Grok 480p 4s,
Projets vidéo réservés aux packs supérieurs. Les autres packs ne changent pas.

Usage depuis la racine LBV-Connect.ia:
  python ORIA_Fix_Decouverte_Image_Video/appliquer_correctif.py --check
  python ORIA_Fix_Decouverte_Image_Video/appliquer_correctif.py --apply
"""
from __future__ import annotations
import argparse
import datetime
import difflib
import pathlib
import sys

WEB = pathlib.Path("Frontend/components/oria-mini-studio/OriaMiniStudio.tsx")
MOBILE = pathlib.Path("mobile/src/components/oria-mini-studio/OriaMiniStudio.tsx")


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise ValueError(f"{label}: attendu une occurrence, trouvé {count}; fichier probablement différent du dépôt analysé")
    return text.replace(old, new, 1)


def split_component(text: str) -> tuple[str, str]:
    marker = "export default function OriaMiniStudio"
    if text.count(marker) != 1:
        raise ValueError("Composant Mini-Studio introuvable ou dupliqué")
    p = text.index(marker)
    return text[:p], text[p:]


def patch_web(original: str) -> str:
    s = original
    s = one(s,
        '  "openai/gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",',
        '  "openai/gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",\n'
        '  "recraft/recraft-v4.1-flash": "Recraft Flash 1K",\n'
        '  "x-ai/grok-imagine-video-1.5-lite": "Grok Lite 480p",',
        'noms des modèles Découverte')
    s = one(s,
        'const IMAGE_OFFERS: Record<string, { action: string; label: string; maxResolution: string }[]> = {',
        'const IMAGE_OFFERS: Record<string, { action: string; label: string; maxResolution: string }[]> = {\n'
        '  discovery_pack: [{ action: "image_480", label: "Image Découverte", maxResolution: "1K" }],',
        'offre image Découverte Web')
    s = one(s,
        'const VIDEO_OFFERS: Record<string, { action: string; label: string; seconds: number }[]> = {',
        'const VIDEO_OFFERS: Record<string, { action: string; label: string; seconds: number }[]> = {\n'
        '  discovery_pack: [{ action: "video_4s", label: "Clip Découverte 4 s", seconds: 4 }],',
        'offre vidéo Découverte Web')
    s = one(s,
        'const MEDIA_API = `/ai/${MEDIA_PROVIDER}-media`;',
        '// Résolu au chargement du portefeuille pour chaque utilisateur.',
        'retirer route API globale')
    s = one(s,
        '  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",',
        '  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",\n'
        '  discovery_pack: "Découverte",',
        'libellé Découverte Web')
    s = one(s,
        '  if (MEDIA_PROVIDER === "openrouter") {\n    return (caps.video.models || []).filter',
        '  if (caps.provider === "openrouter") {\n    return (caps.video.models || []).filter',
        'filtre modèles vidéo Web')
    s = one(s,
        '  if (!model || !model.billable_resolutions.includes("720p")) return [];',
        '  const expectedResolution = capabilities?.pack_id === "discovery_pack" ? "480p" : "720p";\n'
        '  if (!model || !model.billable_resolutions.includes(expectedResolution)) return [];',
        'vérification résolution vidéo Web')
    prefix, component = split_component(s)
    # La sélection globale reste inchangée pour les packs classiques.
    component = component.replace("MEDIA_PROVIDER", "mediaProvider").replace("MEDIA_API", "mediaApi")
    component = one(component,
        '  const tr = (fr: string, en: string) => isFrench ? fr : en;',
        '  const tr = (fr: string, en: string) => isFrench ? fr : en;\n'
        '  // Le Pack Découverte utilise OpenRouter, indépendamment du fournisseur global.\n'
        '  const mediaProvider: "google" | "openrouter" =\n'
        '    wallet?.pack_id === "discovery_pack" ? "openrouter" : MEDIA_PROVIDER;\n'
        '  const mediaApi = `/ai/${mediaProvider}-media`;',
        'fournisseur dynamique Web')
    component = one(component,
        '      const remote = await api<Capabilities>(`${mediaApi}/capabilities`);',
        '      // La lecture du portefeuille vient de réussir : ne pas utiliser le provider\n'
        '      // calculé avant le setWallet(), qui serait encore celui du pack précédent.\n'
        '      const providerForWallet: "google" | "openrouter" =\n'
        '        current.pack_id === "discovery_pack" ? "openrouter" : MEDIA_PROVIDER;\n'
        '      const remote = await api<Capabilities>(`/ai/${providerForWallet}-media/capabilities`);',
        'chargement des capacités Web')
    component = one(component,
        'remote.provider !== mediaProvider || remote.pack_id',
        'remote.provider !== providerForWallet || remote.pack_id',
        'vérification du fournisseur Web')
    # Ajustement local : setWallet est asynchrone. Les conditions du chargement
    # doivent toutes lire providerForWallet (pas le state précédent).
    begin = component.index('  async function loadCapabilities() {')
    end = component.index('  async function loadGallery() {', begin)
    chunk = component[begin:end]
    if chunk.count('if (mediaProvider === "openrouter")') != 2:
        raise ValueError('Nombre inattendu de contrôles du fournisseur dans loadCapabilities Web')
    chunk = chunk.replace('if (mediaProvider === "openrouter")', 'if (providerForWallet === "openrouter")')
    component = component[:begin] + chunk + component[end:]
    component = one(component,
        'resolution: "720p", count: 1, final_duration_seconds: selectedVideoOffer!.seconds,',
        'resolution: wallet?.pack_id === "discovery_pack" ? "480p" : "720p",\n'
        '        count: 1, final_duration_seconds: selectedVideoOffer!.seconds,',
        'devis vidéo 480p Web')
    component = one(component,
        '{selectedVideoOffer?.seconds ?? "—"} s · 720p',
        '{selectedVideoOffer?.seconds ?? "—"} s · {wallet?.pack_id === "discovery_pack" ? "480p" : "720p"}',
        'affichage durée/résolution Web')
    component = one(component,
        'disabled={busy || quoting}\n                className={`inline-flex',
        'disabled={busy || quoting || (wallet?.pack_id === "discovery_pack" && item.id === "projects")}\n'
        '                className={`inline-flex',
        'onglet Projets Web')
    component = one(component,
        '<item.icon size={16}/>{item.label}',
        '<item.icon size={16}/>{item.id === "projects" && wallet?.pack_id === "discovery_pack"\n'
        '                  ? tr("Projets vidéo · pack supérieur", "Video projects · higher tier") : item.label}',
        'libellé explicite Projets Web')
    component = one(component,
        '    if (screen !== "projects") return;\n    let cancelled = false;',
        '    if (screen !== "projects") return;\n'
        '    // Découverte : clips de 4 s autorisés, films multi-scènes non autorisés.\n'
        '    if (wallet?.pack_id === "discovery_pack") {\n'
        '      setProjectCaps(null);\n'
        '      setProjectChecking(false);\n'
        '      setProjectError(tr("Les Projets vidéo sont réservés aux packs supérieurs.",\n'
        '        "Video projects require a higher-tier plan."));\n'
        '      return;\n'
        '    }\n'
        '    let cancelled = false;',
        'verrou Projets Web')
    component = one(component,
        'Ce modèle ne propose actuellement aucune durée compatible avec ton pack en 720p. Aucun appel payant ne sera lancé.',
        'Ce modèle ne propose actuellement aucune durée compatible avec ton pack. Aucun appel payant ne sera lancé.',
        'message vidéo Web')
    component = one(component,
        'This model currently offers no duration compatible with your plan at 720p. No paid request will be sent.',
        'This model currently offers no duration compatible with your plan. No paid request will be sent.',
        'message vidéo anglais Web')
    return prefix + component


def patch_mobile(original: str) -> str:
    s = original
    s = one(s,
        'const IMAGE_OFFERS: Record<string, Offer[]> = {',
        'const IMAGE_OFFERS: Record<string, Offer[]> = {\n'
        '  discovery_pack: [{ action: "image_480", label: "Image Découverte", resolution: "1K" }],',
        'offre image Découverte Expo')
    s = one(s,
        'const VIDEO_OFFERS: Record<string, Offer[]> = {',
        'const VIDEO_OFFERS: Record<string, Offer[]> = {\n'
        '  discovery_pack: [{ action: "video_4s", label: "Clip Découverte 4 s", seconds: 4 }],',
        'offre vidéo Découverte Expo')
    s = one(s,
        'const MEDIA_API = `/ai/${MEDIA_PROVIDER}-media`;',
        '// Résolu au chargement du portefeuille pour chaque utilisateur.',
        'retirer route API globale')
    s = one(s,
        '  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",',
        '  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",\n'
        '  discovery_pack: "Découverte",',
        'libellé Découverte Expo')
    prefix, component = split_component(s)
    component = component.replace('MEDIA_PROVIDER', 'mediaProvider').replace('MEDIA_API', 'mediaApi')
    component = one(component,
        '  const tr = (fr: string, en: string) => language === "fr" ? fr : en;',
        '  const tr = (fr: string, en: string) => language === "fr" ? fr : en;\n'
        '  // Sélection par wallet : Découverte -> OpenRouter ; les autres -> configuration existante.\n'
        '  const mediaProvider: "google" | "openrouter" =\n'
        '    wallet?.pack_id === "discovery_pack" ? "openrouter" : MEDIA_PROVIDER;\n'
        '  const mediaApi = `/ai/${mediaProvider}-media`;',
        'fournisseur dynamique Expo')
    component = one(component,
        '      const rights = await api<Capabilities>(`${mediaApi}/capabilities`);',
        '      const providerForWallet: "google" | "openrouter" =\n'
        '        current.pack_id === "discovery_pack" ? "openrouter" : MEDIA_PROVIDER;\n'
        '      const rights = await api<Capabilities>(`/ai/${providerForWallet}-media/capabilities`);',
        'chargement des capacités Expo')
    component = one(component,
        'rights.provider !== mediaProvider || !rights.pack_active',
        'rights.provider !== providerForWallet || !rights.pack_active',
        'vérification du fournisseur Expo')
    begin = component.index('  async function loadCapabilities() {')
    end = component.index('  async function loadGallery() {', begin)
    chunk = component[begin:end]
    if chunk.count('if (mediaProvider === "openrouter")') != 1:
        raise ValueError('Nombre inattendu de contrôles du fournisseur dans loadCapabilities Expo')
    chunk = chunk.replace('if (mediaProvider === "openrouter")', 'if (providerForWallet === "openrouter")')
    component = component[:begin] + chunk + component[end:]
    component = one(component,
        'resolution: "720p", count: 1, final_duration_seconds: offerVideo.seconds,',
        'resolution: wallet?.pack_id === "discovery_pack" ? "480p" : "720p",\n'
        '        ...(mediaProvider === "openrouter" ? { model: caps?.video.model } : {}),\n'
        '        count: 1, final_duration_seconds: offerVideo.seconds,',
        'devis vidéo Expo')
    component = one(component,
        '        ...shared, mode: videoMode, requested_seconds: offerVideo.seconds, aspect_ratio: videoRatio,',
        '        ...shared, mode: videoMode, requested_seconds: offerVideo.seconds, aspect_ratio: videoRatio,\n'
        '        ...(mediaProvider === "openrouter" ? { model: caps?.video.model } : {}),',
        'envoi du modèle vidéo Expo')
    component = one(component,
        '<Pressable key={tab} disabled={busy} onPress={() => changeSection(tab)}',
        '<Pressable key={tab} disabled={busy || (wallet?.pack_id === "discovery_pack" && tab === "projects")}\n'
        '                    onPress={() => changeSection(tab)}',
        'verrou onglet Projets Expo')
    component = one(component,
        'tab === "projects" ? tr("Projets", "Projects")',
        'tab === "projects" ? (wallet?.pack_id === "discovery_pack"\n'
        '                        ? tr("Projets · verrouillé", "Projects · locked") : tr("Projets", "Projects"))',
        'libellé explicite Projets Expo')
    component = one(component,
        '    if (!visible || section !== "projects") return;\n    let cancelled = false;',
        '    if (!visible || section !== "projects") return;\n'
        '    if (wallet?.pack_id === "discovery_pack") {\n'
        '      setOpenrouterFilmCaps(null);\n'
        '      setFilmError(tr("Les Projets vidéo sont réservés aux packs supérieurs.",\n'
        '        "Video projects require a higher-tier plan."));\n'
        '      return;\n'
        '    }\n'
        '    let cancelled = false;',
        'verrou Projets Expo')
    component = one(component,
        '  }, [visible, section, filmRetry]);',
        '  }, [visible, section, filmRetry, wallet?.pack_id]);',
        'mise à jour dépendances effets Expo')
    return prefix + component


def main() -> int:
    p = argparse.ArgumentParser()
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true', help='Valider le patch sans écrire')
    group.add_argument('--apply', action='store_true', help='Appliquer le patch avec sauvegarde')
    args = p.parse_args()
    replacements: list[tuple[pathlib.Path, str, str, str]] = []
    for path, patcher in ((WEB, patch_web), (MOBILE, patch_mobile)):
        if not path.is_file():
            print(f'FICHIER MANQUANT : {path}', file=sys.stderr)
            return 2
        raw = path.read_bytes()
        newline = '\r\n' if b'\r\n' in raw else '\n'
        old = raw.decode('utf-8-sig').replace('\r\n','\n')
        try:
            new = patcher(old)
        except ValueError as error:
            print(f'ARRET SANS MODIFIER : {path} : {error}', file=sys.stderr)
            return 2
        replacements.append((path, old, new, newline))
        dif = list(difflib.unified_diff(old.splitlines(), new.splitlines(), fromfile=str(path), tofile=str(path), lineterm=''))
        print(f'OK {path} : {len(dif)} lignes de diff')
    if args.check:
        print('TOUS LES CONTROLES PASSENT. Rien n’a été modifié. Lancez --apply pour installer.')
        return 0
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backups = []
    try:
        for path, old, new, newline in replacements:
            raw = path.read_bytes()
            backup = path.with_name(path.name + '.bak-decouverte-' + stamp)
            backup.write_bytes(raw)
            backups.append(backup)
        for path, old, new, newline in replacements:
            path.write_bytes(new.replace('\n', newline).encode('utf-8'))
            print(f'MODIFIE : {path}')
    except Exception as error:
        for backup in backups:
            target = backup.with_name(backup.name.split('.bak-decouverte-')[0])
            try:
                target.write_bytes(backup.read_bytes())
            except OSError:
                pass
        print(f'ECHEC : {error}. Les sauvegardes ont été restaurées si possible.', file=sys.stderr)
        return 3
    print(f'Sauvegardes : {", ".join(str(p) for p in backups)}')
    print('TERMINÉ. Lancez maintenant vos vérifications TypeScript et le déploiement Frontend.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
