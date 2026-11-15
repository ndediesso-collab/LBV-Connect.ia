"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");
type Balance = {balance: number; free_credits: number; purchased_credits: number};
type Status = {success: boolean; daily_credits: number; paid_pack_active: boolean; wallet: Balance};

export default function OriaFreeWalletSummary() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const {data: {session}} = await createClient().auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch(`${API_URL}/ai/free/status`, {
        headers: {authorization: `Bearer ${session.access_token}`, "user-id": session.user.id},
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = await response.json() as Status;
      if (result.success && !result.paid_pack_active && result.wallet) setStatus(result);
    } catch { /* Backend authoritative: no synthetic balance */ }
    finally {setLoading(false);}
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!status || loading) return null;
  return <section className="mx-auto mb-5 max-w-6xl rounded-2xl border border-border bg-surface p-5" aria-label="Mon portefeuille gratuit ORIA">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">ORIA · Accès sans pack</p>
        <h2 className="mt-1 text-xl font-bold">{status.wallet.balance.toLocaleString("fr-FR")} crédits disponibles</h2>
        <p className="mt-2 text-sm text-muted">Quota : {status.daily_credits} crédits gratuits par jour · {status.wallet.purchased_credits.toLocaleString("fr-FR")} crédits achetés distincts.</p>
      </div>
      <div className="flex gap-3 text-sm"><Link className="rounded-xl border border-border px-4 py-2 font-semibold" href="/chat">Utiliser ORIA</Link>
        <Link className="rounded-xl bg-foreground px-4 py-2 font-semibold text-background" href="/packs?recharge=standard">Recharger</Link></div>
    </div>
  </section>;
}
