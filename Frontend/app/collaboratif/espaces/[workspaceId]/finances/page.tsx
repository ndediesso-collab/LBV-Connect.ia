"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Wallet, ReceiptText, ShieldCheck } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type WalletData = {
  success: boolean; workspace_id: string; member_user_id: string;
  personal_balance: number; personal_credited_total: number;
  pack_quota: { available?: number; reserved?: number; spent?: number };
};
type Purchase = { reference: string; addon_id: string; credits: number; paid_xaf: number; created_at: string };
type EventsData = { success: boolean; workspace_id: string; events: Purchase[] };

export default function FinancesEspace() {
  const params = useParams();
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const base = `/collaboratif/workspaces/${encodeURIComponent(workspaceId)}/finance`;
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [events, setEvents] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [w, p] = await Promise.all([
        collabRequest<WalletData>(`${base}/wallet`),
        collabRequest<EventsData>(`${base}/events`),
      ]);
      if (!w.success || !p.success || w.workspace_id !== workspaceId || p.workspace_id !== workspaceId) {
        throw new Error("La réponse ne correspond pas à l'espace sélectionné.");
      }
      setWallet(w);
      setEvents(Array.isArray(p.events) ? p.events : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Données indisponibles.");
    } finally { setLoading(false); }
  }, [base, workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);
  const format = (value: number | undefined) => Number(value ?? 0).toLocaleString("fr-FR");
  return <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
    <div className="mx-auto max-w-4xl space-y-6">
      <Link className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"
        href={`/collaboratif/espaces/${encodeURIComponent(workspaceId)}`}><ArrowLeft size={16}/> Retour à cet espace</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Wallet size={25}/> Finances de mon profil</h1>
        <button type="button" className="rounded-xl border border-border px-4 py-2 text-sm"
          onClick={() => void refresh()}><RefreshCw className="mr-2 inline" size={14}/> Actualiser</button>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted"><ShieldCheck size={18}/>
        Vue en lecture seule, limitée à votre identité et à cet espace professionnel. Aucun achat, débit ou transfert n'est lancé ici.</p>
      {loading && <p role="status" className="text-sm">Chargement sécurisé…</p>}
      {error && <p role="alert" className="rounded-xl border border-border p-4 text-sm">{error}</p>}
      {wallet && <section className="grid gap-3 sm:grid-cols-3" aria-label="Soldes de mon profil">
        {[{label:"Quota de pack disponible",n:wallet.pack_quota?.available},
          {label:"Quota réservé",n:wallet.pack_quota?.reserved},
          {label:"Recharges de cet espace",n:wallet.personal_balance}].map(item =>
          <div key={item.label} className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted">{item.label}</p><strong className="mt-2 block text-2xl">{format(item.n)}</strong>
          </div>)}
      </section>}
      <section className="rounded-xl border border-border p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ReceiptText size={19}/> Recharges professionnelles confirmées</h2>
        {events.length === 0 && <p className="mt-4 text-sm text-muted">Aucune recharge confirmée dans cet espace.</p>}
        <div className="mt-4 space-y-3">{events.map(e => <div key={e.reference} className="flex flex-wrap justify-between gap-2 border-t border-border py-3 text-sm">
          <div><strong>{format(e.credits)} crédits</strong><p className="text-xs text-muted">{e.addon_id} · {e.created_at?.slice(0,10)}</p></div>
          <span>{format(e.paid_xaf)} FCFA</span>
        </div>)}</div>
      </section>
    </div>
  </main>;
}
