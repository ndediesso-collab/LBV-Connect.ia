"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  decideFreeOffer, initialOfferMemory, librevilleClock, parseOfferMemory,
  type OfferMemory, type OfferNotice,
} from "./oriaFreeOffersLogic";

type FreeStatus = {
  success: boolean;
  daily_credits: number;
  paid_pack_active: boolean;
  wallet?: {free_credits: number; purchased_credits: number; balance: number};
};

type Props = {status: FreeStatus | null; enabled: boolean; busy?: boolean; onRefresh?: () => Promise<void>};
// ORIA_FREE_NOTICES_90_V2 : nouvelle memoire quotidienne sans les anciens seuils 90/50/0.
const VERSION = "oria_free_offres_v2_90";

/** Affichage dans l'application. Ce ne sont pas des notifications push système. */
export default function OriaFreeOfferNotifications({status, enabled, busy = false, onRefresh}: Props) {
  const [uid, setUid] = useState<string | null>(null);
  const offersEnabled = enabled && process.env.NEXT_PUBLIC_ORIA_FREE_OFFERS_ENABLED !== "0";
  const [notice, setNotice] = useState<OfferNotice | null>(null);
  const [noticeDay, setNoticeDay] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const fallback = useRef<Record<string, OfferMemory>>({});
  const lastDay = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void createClient().auth.getSession().then(({data}) => {
      if (active) setUid(data.session?.user?.id ?? null);
    }).catch(() => {if (active) setUid(null);});
    return () => {active = false;};
  }, []);

  const tick = useCallback(() => setClockTick((n) => n + 1), []);
  useEffect(() => {
    const interval = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tick]);

  useEffect(() => {
    if (!onRefresh) return;
    const onFocus = () => {if (document.visibilityState === "visible") void onRefresh();};
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [onRefresh]);

  useEffect(() => {
    const today = librevilleClock(new Date()).day;
    if (lastDay.current && lastDay.current !== today && onRefresh) void onRefresh();
    lastDay.current = today;
  }, [clockTick, onRefresh]);

  useEffect(() => {
    if (!uid || !offersEnabled || !status?.success || status.paid_pack_active || !status.wallet) {
      setNotice(null);
      return;
    }
    // Le quota gratuit est différent du solde global, qui contient aussi les recharges.
    const freeCredits = status.wallet.free_credits;
    const purchasedCredits = status.wallet.purchased_credits;
    if (typeof freeCredits !== "number" || typeof purchasedCredits !== "number" || purchasedCredits > 0) {
      setNotice(null);
      return;
    }
    if (document.visibilityState !== "visible") return;
    const now = new Date();
    const clock = librevilleClock(now);
    const key = `${VERSION}:${uid}:${clock.day}`;
    let memory: OfferMemory = fallback.current[key] ?? initialOfferMemory();
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) memory = parseOfferMemory(stored);
    } catch {/* navigateur privé : fallback mémoire */}
    const outcome = decideFreeOffer({memory, freeCredits, dailyCredits: status.daily_credits || 90,
      nowMs: now.getTime(), clock, hasPurchasedCredits: purchasedCredits > 0, enabled: offersEnabled});
    fallback.current[key] = outcome.memory;
    try {window.localStorage.setItem(key, JSON.stringify(outcome.memory));} catch {/* repli en mémoire */}
    if (outcome.notice) {
      setNotice(outcome.notice);
      setNoticeDay(clock.day);
    } else {
      // Une vieille alerte de zero doit disparaitre apres renouvellement/remboursement.
      setNotice((previous) => previous?.kind === "threshold" && (
        (previous.threshold === 0 && freeCredits > 0) ||
        (previous.threshold > 0 && freeCredits > previous.threshold)
      ) ? null : previous);
    }
  }, [uid, status, offersEnabled, clockTick]);

  // Le serveur est la seule source de verite, jamais le seuil ancien memorise.
  const available = status?.wallet?.free_credits;
  const daily = typeof status?.daily_credits === "number" && status.daily_credits > 0
    ? Math.floor(status.daily_credits) : 90;
  if (busy || !notice || !uid || !offersEnabled || !status?.success ||
      status.paid_pack_active || !status.wallet ||
      (status.wallet.purchased_credits ?? 0) > 0 ||
      typeof available !== "number" || !Number.isFinite(available) ||
      noticeDay !== librevilleClock(new Date()).day) return null;

  const remaining = Math.max(0, Math.floor(available));
  if (notice.kind === "threshold" && (
    (notice.threshold === 0 && remaining !== 0) ||
    (notice.threshold > 0 && (remaining === 0 || remaining > notice.threshold))
  )) return null;

  const headline = notice.kind === "reminder"
    ? "Découvre tout le potentiel d'ORIA"
    : remaining === 0
      ? "Tes crédits gratuits du jour sont épuisés"
      : `Il te reste ${remaining} crédit${remaining > 1 ? "s" : ""} gratuit${remaining > 1 ? "s" : ""}`;
  const description = notice.kind === "reminder"
    ? `Avec tes ${daily} crédits gratuits quotidiens, tu peux essayer ORIA. Les recharges sont facultatives.`
    : remaining === 0
      ? `Ton quota gratuit est à zéro. Il se renouvelle à minuit, heure de Libreville, sous réserve d'éligibilité.`
      : remaining <= Math.max(1, Math.floor(daily / 6))
        ? `Ton solde gratuit est presque épuisé (${remaining}/${daily}). Certaines créations peuvent demander plus de crédits.`
        : `Tu as utilisé environ la moitié de ton quota quotidien (${remaining}/${daily} restants). Renouvellement à minuit, heure de Libreville.`;

  return (
    <aside role="status" aria-live="polite" aria-label="Offres ORIA" className="fixed right-3 top-20 z-[90] max-h-[calc(100dvh-6rem)] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:bottom-6 sm:p-5">
      <div className="flex items-start gap-3">
        <BellRing size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{headline}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">{description}</p>
        </div>
        <button type="button" onClick={() => setNotice(null)} aria-label="Fermer l'offre" className="rounded-lg p-2 hover:bg-surface-secondary"><X size={17} /></button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Link href="/packs" className="rounded-xl border border-border p-3 text-center hover:bg-surface-secondary" onClick={() => setNotice(null)}>
          <span className="block text-[11px] text-muted">Recharge</span>
          <strong className="block text-sm">1 000 crédits</strong>
          <span className="text-sm font-semibold">600 FCFA</span>
        </Link>
        <Link href="/packs" className="rounded-xl border border-border p-3 text-center hover:bg-surface-secondary" onClick={() => setNotice(null)}>
          <span className="block text-[11px] text-muted">Recharge</span>
          <strong className="block text-sm">2 000 crédits</strong>
          <span className="text-sm font-semibold">1 000 FCFA</span>
        </Link>
        <Link href="/packs" className="col-span-2 rounded-xl border border-foreground bg-foreground p-3 text-center text-background hover:opacity-90 sm:col-span-1" onClick={() => setNotice(null)}>
          <span className="block text-[11px] opacity-75">Pack Découverte · 35 jours</span>
          <strong className="block text-sm">7 000 crédits</strong>
          <span className="text-sm font-semibold">1 500 FCFA</span>
        </Link>
      </div>
      <Link
        href="/packs"
        onClick={() => setNotice(null)}
        className="mt-3 block rounded-xl border border-foreground bg-foreground px-4 py-3 text-center text-sm font-semibold text-background transition-opacity hover:opacity-90"
      >
        Voir tous les packs et recharges
      </Link>
      <p className="mt-3 text-center text-[11px] text-muted">Les crédits gratuits de la bêta sont renouvelés selon les conditions et ressources disponibles. Aucun achat obligatoire.</p>
    </aside>
  );
}
