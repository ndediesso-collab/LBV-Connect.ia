"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { collabRequest, collabSupabase } from "@/lib/collaboratif-api";

type Purchase = {
  reference: string; status: string; addon_id: string; amount: number;
  credits: number; created_at: string; paid_at: string | null;
};
type PersonalWallet = {
  wallet_type: "collab_personal";
  balance: number;
  credited_total: number;
  purchases: Purchase[];
};
type Checkout = { success: boolean; checkout_url: string };

// Memes identifiants et prix que Backend/app/config/payments.py.
const ADDONS = [
  { id: "credits_1000_563", credits: 1000, price: 600 },
  { id: "credits_2000", credits: 2000, price: 1000 },
  { id: "credits_4000", credits: 4000, price: 2000 },
  { id: "credits_10000", credits: 10000, price: 5000 },
] as const;
const field = "mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm";
const fmt = (n: number) => new Intl.NumberFormat("fr-GA").format(n);

export default function RechargesCollaboratifPage() {
  const [data, setData] = useState<PersonalWallet | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const wallet = await collabRequest<PersonalWallet>("/collaboratif/personal-wallet");
      setData(wallet);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portefeuille indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void collabSupabase.auth.getUser().then(({ data: result }) => {
      if (result.user?.email) setEmail(result.user.email);
    });
  }, [load]);

  async function buy(productId: string) {
    if (!email.trim()) { setError("Renseignez une adresse e-mail pour recevoir le reçu Chariow."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await collabRequest<Checkout>("/payments/checkout", "POST", {
        payment_type: "addon", product_id: productId,
        provider: "chariow", billing_email: email.trim(),
      });
      if (!result.checkout_url?.startsWith("https://")) {
        throw new Error("Lien sécurisé de paiement indisponible.");
      }
      // Ne jamais annoncer une recharge reussie avant le webhook signe.
      window.location.assign(result.checkout_url);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Paiement indisponible.");
    }
  }

  async function recover() {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await collabRequest<{ activated_now: number }>("/collaboratif/personal-wallet/reconcile", "POST");
      setNotice(r.activated_now > 0
        ? `${r.activated_now} recharge(s) confirmée(s) rapprochée(s).`
        : "Aucun paiement confirmé en attente de crédit.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rapprochement indisponible.");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <Link href="/collaboratif/profils" className="inline-flex items-center gap-2 text-sm text-muted">
          <ArrowLeft size={16} /> Profils professionnels
        </Link>
        <header className="mt-9 mb-8">
          <p className="text-xs font-medium uppercase tracking-[.2em] text-muted">ORIA COLLABORATIF</p>
          <h1 className="mt-3 text-3xl font-bold">Mes recharges personnelles</h1>
          <p className="mt-2 text-sm text-muted">Achetez vos crédits via le Chariow actuel d’ORIA. Votre recharge n’augmente pas les crédits des autres profils.</p>
        </header>
        {error && <p role="alert" className="mb-5 rounded-xl border border-border p-4 text-sm">{error}</p>}
        {notice && <p role="status" className="mb-5 rounded-xl border border-border p-4 text-sm">{notice}</p>}
        {loading ? <p className="text-sm text-muted">Chargement du portefeuille…</p> : data ? <>
          <section className="rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-3 text-sm text-muted"><Wallet size={19} /> Solde personnel confirmé</div>
            <div className="mt-3 text-4xl font-bold tabular-nums">{fmt(data.balance)} <span className="text-lg font-medium text-muted">crédits</span></div>
            <p className="mt-3 text-xs text-muted">Total des recharges confirmées : {fmt(data.credited_total)} crédits. Les dépenses IA personnelles seront activées dans la phase de raccordement du chat.</p>
          </section>
          <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
            <h2 className="font-semibold">Adresse e-mail de réception</h2>
            <p className="mt-2 text-xs text-muted">Chariow exige une adresse e-mail pour le checkout ; elle ne remplace pas votre connexion par téléphone.</p>
            <label className="mt-4 block text-sm">E-mail pour votre reçu
              <input className={field} type="email" autoComplete="email" required maxLength={254}
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
            </label>
          </section>
          <section className="mt-6">
            <h2 className="mb-4 text-lg font-semibold">Choisir une recharge</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {ADDONS.map((addon) => <article key={addon.id} className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-2xl font-semibold tabular-nums">{fmt(addon.credits)} crédits</p>
                <p className="mt-2 text-sm text-muted">{fmt(addon.price)} XAF</p>
                <button type="button" onClick={() => void buy(addon.id)} disabled={busy}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50">
                  <CreditCard size={16} /> Acheter sur Chariow
                </button>
              </article>)}
            </div>
          </section>
          <section className="mt-7 rounded-2xl border border-border p-5">
            <div className="flex items-center gap-2"><ShieldCheck size={18} /><h2 className="font-semibold">Paiements récents</h2></div>
            <p className="mt-2 text-xs text-muted">Une commande en attente n’accorde aucun crédit. Seul un paiement confirmé par Chariow est crédité.</p>
            <div className="mt-4 space-y-2">
              {data.purchases.length ? data.purchases.map((p) =>
                <div key={p.reference} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
                  <span>{fmt(p.credits)} crédits <span className="text-muted">· {fmt(p.amount)} XAF</span></span>
                  <span className="text-xs text-muted">{p.status === "paid" ? "Payé" : p.status === "pending" ? "En attente" : "Non confirmé"}</span>
                </div>) : <p className="text-sm text-muted">Aucune recharge pour le moment.</p>}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => void recover()}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} /> Rapprocher les paiements confirmés</button>
              <button type="button" disabled={busy} onClick={() => void load()} className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">Actualiser le solde</button>
            </div>
          </section>
        </> : <p className="rounded-xl border border-border p-5 text-sm">Portefeuille professionnel indisponible. Vérifiez votre profil et votre abonnement.</p>}
      </div>
    </main>
  );
}
