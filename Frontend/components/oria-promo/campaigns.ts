/** P17 campaigns. All active campaigns are eligible for every authenticated ORIA user.
 * Announcements are in-app only; never sent to the Web Push devices of P16.
 * Future products (ORIA Public) must NOT be activated before release.
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

export const PROMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
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
    description: "Explorez les modèles, les créations et les fonctionnalités proposés dans les différents packs ORIA.",
    cta: "Comparer les packs",
    href: "/packs#oria-packs-tabs",
    active: true,
  },
  {
    id: "business-2026-11",
    label: "Pack Business",
    title: "Des projets plus ambitieux ?",
    description: "Découvrez les capacités du pack Business : davantage de crédits et des outils adaptés aux usages avancés.",
    cta: "Voir Business",
    href: "/packs#oria-packs-tabs",
    active: true,
  },
  {
    id: "recharge-2026-11",
    label: "Crédits ORIA",
    title: "Vos idées n'attendent pas.",
    description: "Retrouvez les recharges et les packs pour poursuivre vos recherches et vos créations selon votre utilisation.",
    cta: "Voir les offres",
    href: "/packs",
    active: true,
  },
  {
    id: "public-pending",
    label: "À venir",
    title: "Votre propre assistant, par lien.",
    description: "Bientôt : ORIA Public, pour répondre à vos visiteurs depuis un lien partageable.",
    cta: "En savoir plus",
    href: "/packs",
    active: false, // DO NOT enable until ORIA Public actually ships.
  },
];

export type CampaignMemory = { lastShownAt: number; lastCampaignId: string };

export function nextCampaign(
  previous: CampaignMemory | null,
  nowMs: number,
  campaigns: readonly Campaign[] = CAMPAIGNS,
): Campaign | null {
  const active = campaigns.filter(c => c.active);
  if (!active.length || !Number.isFinite(nowMs)) return null;
  if (previous && Number.isFinite(previous.lastShownAt) && nowMs - previous.lastShownAt < PROMO_COOLDOWN_MS) return null;
  const formerIndex = previous ? active.findIndex(c => c.id === previous.lastCampaignId) : -1;
  return active[(formerIndex + 1) % active.length];
}

export function parseCampaignMemory(value: string | null): CampaignMemory | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const item = parsed as Record<string, unknown>;
    return typeof item.lastShownAt === "number" && Number.isFinite(item.lastShownAt) &&
      typeof item.lastCampaignId === "string" && item.lastCampaignId.length < 120
      ? {lastShownAt: item.lastShownAt, lastCampaignId: item.lastCampaignId} : null;
  } catch { return null; }
}
