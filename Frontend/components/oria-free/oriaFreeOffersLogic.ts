/** Notifications commerciales pour l'accès gratuit. Aucun appel API et aucun paiement. */
export type OfferThreshold = 90 | 50 | 0;
export type OfferNotice =
  | {kind: "threshold"; threshold: OfferThreshold}
  | {kind: "reminder"; slot: "matin" | "apres-midi" | "soir"};
export type OfferMemory = {
  seenThresholds: OfferThreshold[];
  seenSlots: string[];
  lastShownAt: number;
};
export type LibrevilleClock = {day: string; minute: number};

export const OFFER_SLOTS = [
  {id: "matin", start: 9 * 60},
  {id: "apres-midi", start: 14 * 60},
  {id: "soir", start: 19 * 60},
] as const;

export function librevilleClock(date: Date): LibrevilleClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Libreville", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const item = (name: string) => parts.find((p) => p.type === name)?.value ?? "00";
  return {
    day: `${item("year")}-${item("month")}-${item("day")}`,
    minute: Number(item("hour")) * 60 + Number(item("minute")),
  };
}

export function initialOfferMemory(): OfferMemory {
  return {seenThresholds: [], seenSlots: [], lastShownAt: 0};
}

export function parseOfferMemory(raw: string | null): OfferMemory {
  if (!raw) return initialOfferMemory();
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      seenThresholds: Array.isArray(data.seenThresholds)
        ? data.seenThresholds.filter((v): v is OfferThreshold => v === 90 || v === 50 || v === 0)
        : [],
      seenSlots: Array.isArray(data.seenSlots)
        ? data.seenSlots.filter((v): v is string => typeof v === "string" && OFFER_SLOTS.some((s) => s.id === v))
        : [],
      lastShownAt: typeof data.lastShownAt === "number" && Number.isFinite(data.lastShownAt) ? data.lastShownAt : 0,
    };
  } catch {
    return initialOfferMemory();
  }
}

/**
 * Une seule notification par évaluation ; si une action consomme plusieurs
 * seuils en un coup, on notifie seulement le plus bas sans cascade de popups.
 * Les rappels sont au plus trois par jour si le chat reste ouvert ; un
 * utilisateur qui ouvre l'app tard ne reçoit pas les créneaux passés.
 */
export function decideFreeOffer(input: {
  memory: OfferMemory;
  freeCredits: number;
  dailyCredits: number;
  nowMs: number;
  clock: LibrevilleClock;
  hasPurchasedCredits: boolean;
  enabled: boolean;
}): {memory: OfferMemory; notice: OfferNotice | null} {
  const {memory, freeCredits, nowMs, clock, hasPurchasedCredits, enabled} = input;
  if (!enabled || hasPurchasedCredits || !Number.isFinite(freeCredits) || freeCredits < 0 || input.dailyCredits <= 0) {
    return {memory, notice: null};
  }
  const next: OfferMemory = {
    seenThresholds: [...memory.seenThresholds],
    seenSlots: [...memory.seenSlots],
    lastShownAt: memory.lastShownAt,
  };
  for (const threshold of [0, 50, 90] as const) {
    if (freeCredits <= threshold && !next.seenThresholds.includes(threshold)) {
      // Ne jamais afficher 90 et 50 juste après un saut directement vers 0.
      next.seenThresholds = [...new Set([...next.seenThresholds, ...([90, 50, 0] as const).filter((n) => freeCredits <= n)])];
      next.lastShownAt = nowMs;
      return {memory: next, notice: {kind: "threshold", threshold}};
    }
  }
  const passed = OFFER_SLOTS.filter((s) => clock.minute >= s.start);
  if (passed.length === 0) return {memory: next, notice: null};
  const latest = passed[passed.length - 1];
  // Les créneaux antérieurs manqués ne doivent pas s'empiler à la connexion.
  next.seenSlots = [...new Set([...next.seenSlots, ...passed.slice(0, -1).map((s) => s.id)])];
  if (next.seenSlots.includes(latest.id)) return {memory: next, notice: null};
  // Pas d'offre commerciale immédiatement après une alerte de solde.
  if (nowMs - next.lastShownAt < 45 * 60 * 1000) return {memory: next, notice: null};
  next.seenSlots.push(latest.id);
  next.lastShownAt = nowMs;
  return {memory: next, notice: {kind: "reminder", slot: latest.id}};
}
