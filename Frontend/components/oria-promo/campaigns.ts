/** ORIA P17 R3 — promotions internes, toujours facultatives a consulter.
 * Tout compte ORIA authentifie, gratuit ou payant, est eligible.
 * Pas de Web Push commercial, ni d'annonce pour une fonction non lancee.
 */
export type Campaign = {
  id: string;
  label: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  active: boolean;
};

// Au maximum 3 annonces par jour (jour Libreville), separees par 3 heures.
// Une annonce fermee ne revient pas aussitot; aucune option d'opt-out global.
export const PROMO_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const PROMO_MAX_PER_DAY = 3;
export const PROMO_INITIAL_DELAY_MS = 25_000;
export const PROMO_RECHECK_MS = 60_000;

export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: "collab-launch-2026-11",
    label: "Espace de travail",
    title: "L'IA entre dans votre équipe.",
    description: "Créez des groupes, partagez vos idées et faites intervenir @ORIA dans vos projets. Disponible avec Pro et Business.",
    cta: "Découvrir Collaboratif",
    href: "/packs#oria-collab-vitrine",
    active: true,
  },
  {
    id: "all-packs-2026-11",
    label: "Les packs ORIA",
    title: "Et si votre pack pouvait faire plus ?",
    description: "Explorez les modèles, les créations et les fonctionnalités proposés dans les differents packs ORIA.",
    cta: "Comparer les packs",
    href: "/packs#oria-packs-tabs",
    active: true,
  },
  {
    id: "business-2026-11",
    label: "Pack Business",
    title: "Des projets plus ambitieux ?",
    description: "Découvrez les capacités du pack Business : davantage de crédits et des outils adaptés aux usages avances.",
    cta: "Voir Business",
    href: "/packs#oria-packs-tabs",
    active: true,
  },
  {
    id: "recharge-2026-11",
    label: "Crédits ORIA",
    title: "Vos idées n'attendent pas.",
    description: "Retrouvez les recharges et les packs pour poursuivre vos recherches et vos creations selon votre utilisation.",
    cta: "Voir les offres",
    href: "/packs",
    active: true,
  },
  {
    id: "assistant-public-launch-2026-11",
    label: "Assistant IA · Pro & Business",
    title: "Votre assistant IA, au service de vos visiteurs.",
    description: "Créez un assistant spécialisé dans votre activité, personnalisez ses consignes et partagez un lien public. Vos visiteurs posent leurs questions sans compte ORIA. Disponible avec un pack Pro ou Business actif.",
    cta: "Découvrir Assistant ORIA",
    href: "/packs#oria-assistant-vitrine",
    active: true,
  },
];

export type CampaignMemory = {
  lastShownAt: number;
  lastCampaignId: string;
  day: string;
  shownToday: number;
};

/** Les credits gratuits sont deja calcules sur le fuseau de Libreville. */
export function librevillePromoDay(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Libreville", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function nextCampaign(
  previous: CampaignMemory | null,
  nowMs: number,
  campaigns: readonly Campaign[] = CAMPAIGNS,
): Campaign | null {
  const active = campaigns.filter(c => c.active);
  if (!active.length || !Number.isFinite(nowMs)) return null;
  const today = librevillePromoDay(nowMs);
  if (previous) {
    if (previous.day === today && previous.shownToday >= PROMO_MAX_PER_DAY) return null;
    // Le delai s'applique meme lorsque le jour change, pour eviter 2 pubs a minuit.
    if (Number.isFinite(previous.lastShownAt) && nowMs - previous.lastShownAt < PROMO_COOLDOWN_MS) return null;
  }
  const formerIndex = previous ? active.findIndex(c => c.id === previous.lastCampaignId) : -1;
  return active[(formerIndex + 1) % active.length];
}

/** Appeler uniquement lorsqu'une vraie annonce devient visible. */
export function recordCampaign(
  previous: CampaignMemory | null, selected: Campaign, nowMs: number,
): CampaignMemory {
  const day = librevillePromoDay(nowMs);
  return {
    lastShownAt: nowMs,
    lastCampaignId: selected.id,
    day,
    shownToday: (previous?.day === day ? previous.shownToday : 0) + 1,
  };
}

export function parseCampaignMemory(value: string | null): CampaignMemory | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Record<string, unknown>;
    if (typeof item.lastShownAt !== "number" || !Number.isFinite(item.lastShownAt) || item.lastShownAt < 0 ||
        typeof item.lastCampaignId !== "string" || item.lastCampaignId.length > 120) return null;
    // Compatibilite avec la memoire de la P17 d'origine, qui ne comptait pas la journee.
    const day = typeof item.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.day)
      ? item.day : librevillePromoDay(item.lastShownAt);
    const shownToday = typeof item.shownToday === "number" && Number.isSafeInteger(item.shownToday)
      ? Math.max(0, Math.min(PROMO_MAX_PER_DAY, item.shownToday)) : 1;
    return {lastShownAt: item.lastShownAt, lastCampaignId: item.lastCampaignId, day, shownToday};
  } catch { return null; }
}
