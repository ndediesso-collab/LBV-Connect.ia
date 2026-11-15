"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");

type Order = {
  reference: string;
  credits: number;
  amount_xaf: number;
  paid_confirmed: boolean;
  delivered: boolean;
  status: "credited" | "paid_pending_credit" | "awaiting_payment";
};

/** Reconciles only server-verified payments; never changes a payment status. */
export default function OriaFreeRechargeStatus() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const {data: {session}} = await createClient().auth.getSession();
    if (!session?.access_token || !session.user?.id) throw new Error("Connecte-toi pour consulter tes recharges.");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "user-id": session.user.id,
        "authorization": `Bearer ${session.access_token}`,
        ...(init?.body ? {"Content-Type": "application/json"} : {}),
      },
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
        ? data.detail : "État de recharge indisponible.";
      throw new Error(message);
    }
    return data as T;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await request<{success: boolean; items: Order[]}>("/payments/free-addon/orders");
      if (result.success && Array.isArray(result.items)) setOrders(result.items);
    } catch (error) {
      // No false "payment lost" inference if server is offline.
      setNotice(error instanceof Error ? error.message : "Historique indisponible.");
    } finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);
  // If a *verified* payment was left uncredited by a transient webhook/RPC
  // failure, try once automatically. Idempotent SQL does the only write.
  useEffect(() => {
    const pending = orders.find((o) => o.paid_confirmed && !o.delivered && !attempted.current.has(o.reference));
    if (!pending || busy !== null) return;
    attempted.current.add(pending.reference);
    void reconcile(pending.reference);
  }, [orders, busy]);

  async function reconcile(reference: string) {
    if (busy) return;
    setBusy(reference); setNotice(null);
    try {
      const result = await request<{success: boolean; order: Order; message: string}>(
        "/payments/free-addon/reconcile", {method: "POST", body: JSON.stringify({reference})},
      );
      if (!result.success) throw new Error("Rapprochement non confirmé.");
      setNotice(result.message);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rapprochement en attente.");
    } finally { setBusy(null); }
  }

  return <section className="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Suivi des recharges gratuites">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Suivre mes recharges sans pack</h3>
      <button type="button" onClick={() => void refresh()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Actualiser</button>
    </div>
    <p className="mt-2 text-xs text-muted">Un paiement confirmé reste traçable. Si le crédit n’a pas été livré, tu peux relancer son rapprochement sans repayer ni doubler les crédits.</p>
    {loading ? <p role="status" className="mt-3 text-xs">Chargement des recharges…</p> : null}
    {notice ? <p role="status" className="mt-3 text-xs">{notice}</p> : null}
    {orders.length === 0 && !loading ? <p className="mt-3 text-xs text-muted">Aucune recharge sans pack enregistrée.</p> : null}
    <div className="mt-3 space-y-3">{orders.map((order) => <div key={order.reference} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{order.credits.toLocaleString("fr-FR")} crédits · {order.amount_xaf.toLocaleString("fr-FR")} FCFA</p>
        <p className="break-all text-[11px] text-muted">Référence : {order.reference}</p>
        <p className="text-xs">{order.delivered ? "Crédits attribués" : order.paid_confirmed ? "Paiement confirmé · crédits à rapprocher" : "En attente de confirmation Chariow"}</p>
      </div>
      {order.paid_confirmed && !order.delivered ? <button type="button" disabled={busy !== null}
        onClick={() => void reconcile(order.reference)}
        className="rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
        {busy === order.reference ? "Vérification…" : "Récupérer mes crédits"}
      </button> : null}
    </div>)}</div>
  </section>;
}
