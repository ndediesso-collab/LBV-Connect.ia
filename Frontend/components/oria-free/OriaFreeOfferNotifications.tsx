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
const VERSION = "oria_free_offres_v1";

/** Affichage dans l'application. Ce ne sont pas des notifications push système. */
export default function OriaFreeOfferNotifications({status, enabled, busy = false, onRefresh}: Props) {
  const [uid, setUid] = useState<string | null>(null);
  const offersEnabled = enabled && process.env.NEXT_PUBLIC_ORIA_FREE_OFFERS_ENABLED !== "0";
  const [notice, setNotice] = useState<OfferNotice | null>(null);
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
    try {memory = parseOfferMemory(window.localStorage.getItem(key));} catch {/* navigateur privé : fallback mémoire */}
    const outcome = decideFreeOffer({memory, freeCredits, dailyCredits: status.daily_credits || 90,
      nowMs: now.getTime(), clock, hasPurchasedCredits: purchasedCredits > 0, enabled: offersEnabled});
    fallback.current[key] = outcome.memory;
    try {window.localStorage.setItem(key, JSON.stringify(outcome.memory));} catch {/* repli en mémoire */}
    if (outcome.notice) setNotice(outcome.notice);
  }, [uid, status, offersEnabled, clockTick]);

  if (busy || !notice || !uid || !offersEnabled || !status || status.paid_pack_active || (status.wallet?.purchased_credits ?? 0) > 0) return null;

  const headline = notice.kind === "reminder"
    ? "Découvre tout le potentiel d'ORIA"
    : notice.threshold === 0
      ? "Tes crédits gratuits du jour sont épuisés"
      : `Plus que ${notice.threshold} crédits gratuits`;
  const description = notice.kind === "reminder"
    ? "Profite de la bêta et continue ton expérience avec une recharge ou le Pack Découverte."
    : notice.threshold === 0
      ? "Reviens lors du prochain renouvellement gratuit ou continue dès maintenant avec une offre payante."
      : "Tu approches de la fin de ton quota gratuit. Voici comment continuer sans interrompre ton expérience.";

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
