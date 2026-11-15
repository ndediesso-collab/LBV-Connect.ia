"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Campaign = {
  enabled: boolean;
  capacity: number;
  claimed: number;
  remaining: number;
  credits: number;
  duration_days: number;
};
const API = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");

/** Compteur public et réclamation PRIVÉE; aucune attribution à l'inscription. */
export default function OriaGiftCampaign({ variant = "landing" }: { variant?: "landing" | "chat" | "packs" }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch(`${API}/campaign/discovery`, { cache: "no-store" });
      if (!r.ok) throw new Error("Campagne indisponible");
      const info = await r.json() as Campaign;
      setCampaign(info);
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      setAuthenticated(Boolean(session));
      if (session) {
        const mine = await fetch(`${API}/campaign/discovery/me`, {
          headers: { Authorization: `Bearer ${session.access_token}`, "user-id": session.user.id },
          cache: "no-store",
        });
        if (mine.ok) setClaimed(Boolean((await mine.json())?.claimed));
      }
    } catch {
      setMessage("Impossible de vérifier les places disponibles pour le moment.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function claim() {
    if (busy || !campaign?.enabled || campaign.remaining <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "/login?redirect=%2Fchat"; return; }
      const response = await fetch(`${API}/campaign/discovery/claim`, {
        method: "POST", headers: {
          Authorization: `Bearer ${session.access_token}`,
          "user-id": session.user.id,
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "Réclamation impossible.");
      setClaimed(true);
      setMessage("Pack Découverte offert activé : 7 000 crédits pendant 14 jours !");
      await refresh();
      window.dispatchEvent(new Event("oria:wallet-refresh"));
      if (variant === "chat") window.setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Réclamation impossible.");
      await refresh();
    } finally { setBusy(false); }
  }

  if (!campaign || (!campaign.enabled && variant !== "packs")) return null;
  return (
    <section aria-label="100 cadeaux ORIA" className="my-5 rounded-2xl border border-neutral-500/40 bg-neutral-950 p-5 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-300">Campagne découverte · 100 places</p>
      <h2 className="mt-2 text-xl font-bold">7 000 crédits offerts pendant 14 jours</h2>
      <p className="mt-2 text-sm text-neutral-300">Un seul cadeau par compte. Pack Découverte payant à 1 000 FCFA disponible ensuite ou à tout moment.</p>
      <p className="mt-3 font-semibold" aria-live="polite">
        {loading ? "Vérification des places…" : `${campaign.remaining} place${campaign.remaining > 1 ? "s" : ""} restante${campaign.remaining > 1 ? "s" : ""} sur ${campaign.capacity}`}
      </p>
      {claimed ? (
        <p className="mt-4 rounded-lg border border-neutral-500 p-3 text-sm">Ton cadeau a déjà été réclamé. Tu peux consulter tes crédits dans le chat.</p>
      ) : campaign.enabled && campaign.remaining > 0 ? (
        authenticated ? (
          <button type="button" disabled={busy} onClick={() => void claim()}
            className="mt-4 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-60">
            {busy ? "Activation…" : "Réclamer mon cadeau gratuit"}
          </button>
        ) : (
          <Link href="/login?redirect=%2Fchat" className="mt-4 inline-block rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black">
            Se connecter pour réclamer
          </Link>
        )
      ) : (
        <p className="mt-3 text-sm text-neutral-300">La campagne est terminée ou n'a pas encore commencé.</p>
      )}
      {message && <p role="status" className="mt-3 text-sm text-neutral-200">{message}</p>}
    </section>
  );
}
