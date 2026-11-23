/** ORIA_FREE_NOTICES_90_V2 -- notifications gratuites et seuils proportionnels au quota.
 * Aucun appel API ni paiement. Le quota vient du serveur, et vaut 90/jour actuellement.
 */
export type OfferThreshold = number;
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
        ? data.seenThresholds.filter((v): v is OfferThreshold => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10000)
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
  // 90 credits/jour => alertes a 45, 15 puis 0; pas d'alerte a 90.
  // Le calcul reste valable si l'administrateur change le quota plus tard.
  const quota = Math.max(1, Math.floor(input.dailyCredits));
  const half = Math.max(1, Math.floor(quota / 2));
  const critical = Math.max(1, Math.floor(quota / 6));
  const thresholds = [...new Set([0, critical, half])].sort((a, b) => a - b);
  for (const threshold of thresholds) {
    if (freeCredits <= threshold && !next.seenThresholds.includes(threshold)) {
      // Si le solde saute plusieurs seuils, une seule alerte (la plus urgente).
      next.seenThresholds = [...new Set([...next.seenThresholds,
        ...thresholds.filter((n) => freeCredits <= n)])];
      next.lastShownAt = nowMs;
      return {memory: next, notice: {kind: "threshold", threshold}};
    }
  }
  // Le message d'epuisement contient deja les offres : pas de rappel supplementaire a zero.
  if (freeCredits === 0) return {memory: next, notice: null};
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
