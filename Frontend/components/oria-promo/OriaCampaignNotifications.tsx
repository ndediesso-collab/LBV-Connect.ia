"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Megaphone, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { nextCampaign, parseCampaignMemory, type Campaign } from "./campaigns";

const STORE_VERSION = "oria-internal-campaigns-p17-v1";
const PRIVATE_PATH = /^\/(chat|conversations|credits|mes_creations|settings)(\/|$)/;

/** One in-app promotion per seven days and account/browser, no opt-out toggle.
 * Dismissal closes this card; it never changes P16 Web Push or credit alerts.
 */
export default function OriaCampaignNotifications() {
  const pathname = usePathname() ?? "";
  const eligiblePage = PRIVATE_PATH.test(pathname);
  const [userId, setUserId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [creditNoticeVisible, setCreditNoticeVisible] = useState(false);
  const shownThisMount = useRef(false);

  useEffect(() => {
    if (!eligiblePage) { setUserId(null); setCampaign(null); return; }
    let mounted = true;
    const client = createClient();
    void client.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.user?.id ?? null);
    }).catch(() => { if (mounted) setUserId(null); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUserId(session?.user?.id ?? null);
        if (!session?.user?.id) setCampaign(null);
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [eligiblePage]);

  useEffect(() => {
    if (!eligiblePage || !userId) return;
    let alive = true;
    const observeCredits = () => {
      if (alive) setCreditNoticeVisible(Boolean(document.querySelector('[aria-label="Offres ORIA"]')));
    };
    observeCredits();
    const observer = new MutationObserver(observeCredits);
    observer.observe(document.body, {childList: true, subtree: true});
    return () => { alive = false; observer.disconnect(); };
  }, [eligiblePage, userId]);

  useEffect(() => {
    if (!eligiblePage || !userId || shownThisMount.current || creditNoticeVisible) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || document.querySelector('[aria-label="Offres ORIA"]')) return;
      const key = `${STORE_VERSION}:${userId}`;
      let memory = null;
      try { memory = parseCampaignMemory(window.localStorage.getItem(key)); } catch { /* private browser */ }
      const selected = nextCampaign(memory, Date.now());
      if (!selected) return;
      shownThisMount.current = true;
      setCampaign(selected);
      try { window.localStorage.setItem(key, JSON.stringify({lastShownAt: Date.now(), lastCampaignId: selected.id})); }
      catch { /* fallback: once per mounted session */ }
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [eligiblePage, userId, creditNoticeVisible]);

  if (!eligiblePage || !userId || !campaign || creditNoticeVisible) return null;
  return (
    <aside role="status" aria-label="Actualité ORIA" className="fixed left-3 right-3 top-20 z-[65] mx-auto max-w-[380px] overflow-hidden rounded-[21px] border border-neutral-300 bg-white text-neutral-950 shadow-[0_15px_65px_rgba(0,0,0,0.19)] sm:bottom-5 sm:left-auto sm:right-5 sm:top-auto sm:mx-0">
      <div className="h-[3px] bg-neutral-950" />
      <div className="px-4 pb-4 pt-3.5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-neutral-950 text-white"><Megaphone size={18}/></div>
          <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[.17em] text-neutral-500">ORIA · {campaign.label}</p><h3 className="mt-1 text-base font-bold leading-snug tracking-tight">{campaign.title}</h3></div>
          <button type="button" aria-label="Fermer cette annonce" onClick={() => setCampaign(null)} className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-100"><X size={17}/></button>
        </div>
        <p className="mt-3 text-sm leading-6 text-neutral-600">{campaign.description}</p>
        <Link href={campaign.href} onClick={() => setCampaign(null)} className="mt-3.5 flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800">{campaign.cta} <ArrowUpRight size={16}/></Link>
        <p className="mt-2.5 text-center text-[10px] text-neutral-500">Une découverte de temps en temps. Fermable à tout moment.</p>
      </div>
    </aside>
  );
}
