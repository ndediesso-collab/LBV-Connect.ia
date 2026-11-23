/* ORIA Collaboratif Phase 6A: calculs de supervision, sans écritures ni frais.
 * Les données doivent provenir des API existantes, autorisées côté serveur.
 */
export type CapacityStatus = "normal" | "warning80" | "warning90" | "full" | "invalid";
export type CreditStatus = "normal" | "low" | "empty" | "unallocated" | "invalid";

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function capacityStatus(sent: unknown, limit: unknown): CapacityStatus {
  if (!count(sent) || !count(limit) || limit === 0) return "invalid";
  if (sent >= limit) return "full";
  // Comparison sans arrondi : "80 %" signifie au moins 80 % consommés.
  const ratio = sent / limit;
  if (ratio >= 0.9) return "warning90";
  if (ratio >= 0.8) return "warning80";
  return "normal";
}
export function capacityPercent(sent: unknown, limit: unknown): number | null {
  if (!count(sent) || !count(limit) || limit === 0) return null;
  return Math.min(100, Math.round((sent / limit) * 100));
}
export function creditStatus(available: unknown, reserved: unknown, spent: unknown): CreditStatus {
  if (!count(available) || !count(reserved) || !count(spent)) return "invalid";
  const total = available + reserved + spent;
  if (!Number.isSafeInteger(total)) return "invalid";
  if (total === 0) return "unallocated";
  if (available === 0) return "empty";
  if (available / total <= 0.2) return "low";
  return "normal";
}
export function safeCount(value: unknown): number | null {
  return count(value) ? value : null;
}
export function capacityRemaining(sent: unknown, limit: unknown, reservedSlots: unknown): number | null {
  if (!count(sent) || !count(limit) || !count(reservedSlots)) return null;
  return Math.max(0, limit - sent - reservedSlots);
}
