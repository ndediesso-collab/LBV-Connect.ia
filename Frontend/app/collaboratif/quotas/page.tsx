"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRightLeft, Clock3, LockKeyhole, RefreshCcw, Shield, Wallet } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type ProfileQuota = {
  user_id: string;
  name: string;
  role: "owner" | "member";
  status: "active" | "suspended" | "banned";
  available: number;
  reserved: number;
  spent: number;
};
type Snapshot = {
  success: boolean;
  workspace_id: string;
  eligible: boolean;
  is_owner: boolean;
  pack_id: string | null;
  owner_balance: number | null;
  shared_pack_budget: number | null;
  manual_mode: boolean;
  requires_reconciliation: boolean;
  missing_credits: number;
  recovered_personal_available: number | null;
  my_personal_balance: number;
  profiles: ProfileQuota[];
  note: string;
};
type Movement = {
  id: number;
  kind: string;
  credits: number;
  source_user_id: string | null;
  target_user_id: string | null;
  created_at: string;
};
type Movements = { success: boolean; events: Movement[] };

type Mode = "pack" | "personal";

const label = "mb-1 block text-xs font-medium text-muted";
const field = "w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-foreground/20";
const primary = "rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-45";
const money = (value: number | null | undefined) => new Intl.NumberFormat("fr-GA").format(value ?? 0);

export default function QuotasCollaboratifPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("pack");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reconcileFrom, setReconcileFrom] = useState("");
  const [reconcileQuantity, setReconcileQuantity] = useState("");

  const refresh = useCallback(async () => {
    const snapshot = await collabRequest<Snapshot>("/collaboratif/quotas");
    setData(snapshot);
    if (snapshot.is_owner) {
      const log = await collabRequest<Movements>("/collaboratif/quotas/movements");
      setEvents(log.events);
    } else { setEvents([]); }
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Répartition indisponible."))
      .finally(() => setLoading(false));
  }, [refresh]);

  const owner = data?.profiles.find((p) => p.role === "owner");
  const active = useMemo(() => data?.profiles.filter((p) => p.status === "active") ?? [], [data]);
  const sources = data?.profiles.filter((p) => p.status !== "banned" && p.available > 0) ?? [];
  const resolvedFrom = mode === "personal" ? owner?.user_id ?? "" : from || owner?.user_id || "";
  const resolvedTo = to || active.find((p) => p.user_id !== resolvedFrom)?.user_id || "";
  const total = data?.profiles.reduce((sum, p) => sum + p.available, 0) ?? 0;
  const nameOf = (id: string | null) => data?.profiles.find((p) => p.user_id === id)?.name || "Profil";

  async function transfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.is_owner || busy) return;
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !resolvedFrom || !resolvedTo || resolvedFrom === resolvedTo) {
      setError("Choisissez deux profils distincts et un montant entier positif."); return;
    }
    if (!window.confirm(`Transférer ${money(amount)} crédits ${mode === "pack" ? "du quota professionnel" : "de la réserve personnelle"} de ${nameOf(resolvedFrom)} à ${nameOf(resolvedTo)} ?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await collabRequest("/collaboratif/quotas/transfers", "POST", {
        from_user_id: resolvedFrom, to_user_id: resolvedTo, amount, source: mode,
      });
      setQuantity(""); setNotice("Transfert enregistré et vérifié en base de données.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transfert impossible."); }
    finally { setBusy(false); }
  }

  async function reconcile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(reconcileQuantity);
    const source = reconcileFrom || owner?.user_id;
    if (!data?.is_owner || !data.requires_reconciliation || !source || !Number.isSafeInteger(amount) || amount < 1 || amount > data.missing_credits) {
      setError("Montant invalide : le rapprochement ne peut pas dépasser le déficit constaté."); return;
    }
    if (!window.confirm(`Réduire définitivement de ${money(amount)} crédits le quota non consommé de ${nameOf(source)} pour régulariser une dépense déjà enregistrée sur le portefeuille ORIA ?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await collabRequest("/collaboratif/quotas/reconcile", "POST", { source_user_id: source, amount });
      setReconcileQuantity(""); setNotice("Rapprochement appliqué. Les crédits du portefeuille historique n'ont pas été débités à nouveau.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Rapprochement impossible."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-8">
      <Link href="/collaboratif/profils" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"><ArrowLeft size={16} /> Profils professionnels</Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quotas professionnels</h1>
          <Link href="/collaboratif/supervision" className="mt-2 inline-flex items-center gap-2 text-xs underline underline-offset-4">Tableau de supervision et alertes</Link>
          <p className="mt-2 max-w-3xl text-sm text-muted">Un seul pack, des quotas attribués par profil. Les recharges personnelles restent toujours séparées.</p>
        </div>
        <button type="button" onClick={() => { setBusy(true); setError(""); void refresh().catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")).finally(() => setBusy(false)); }}
          disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50"><RefreshCcw size={15} /> Actualiser</button>
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl border border-border p-4 text-sm">{notice}</p>}
      {loading ? <p className="mt-8 text-sm text-muted">Chargement des quotas…</p> : !data ? <p className="mt-8 text-sm">Les quotas ne sont pas encore disponibles sur cet environnement.</p> : <>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-5"><p className={label}>Mon quota disponible</p><p className="mt-3 text-2xl font-bold">{money(data.profiles.find((p) => p.user_id === (data.is_owner ? owner?.user_id : data.profiles[0]?.user_id))?.available)} <span className="text-sm font-normal text-muted">crédits</span></p></div>
          <div className="rounded-2xl border border-border bg-surface p-5"><p className={label}>Ma recharge personnelle disponible</p><p className="mt-3 text-2xl font-bold">{money(data.my_personal_balance)} <span className="text-sm font-normal text-muted">crédits</span></p></div>
          <div className="rounded-2xl border border-border bg-surface p-5"><p className={label}>{data.is_owner ? "Total des quotas attribués" : "Mode de répartition"}</p><p className="mt-3 text-2xl font-bold">{data.is_owner ? money(total) : data.manual_mode ? "Manuel" : "Équitable"}</p></div>
        </div>
        {!data.eligible && <p className="mt-5 rounded-xl border border-border p-4 text-sm">Le pack professionnel n'est pas actif. Les transferts sont indisponibles jusqu'au renouvellement.</p>}
        {data.requires_reconciliation && <div className="mt-5 rounded-xl border border-border p-5">
          <div className="flex items-start gap-3"><LockKeyhole size={20} /><div><h2 className="font-semibold">Quota à régulariser</h2><p className="mt-1 text-sm text-muted">Le portefeuille historique a consommé davantage de crédits que le quota libre de l'administrateur. Il faut réduire explicitement {money(data.missing_credits)} crédits des quotas disponibles ; aucun transfert n'est autorisé entre-temps.</p></div></div>
          {data.is_owner && <form onSubmit={(e) => void reconcile(e)} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label><span className={label}>Profil dont réduire le quota</span><select className={field} value={reconcileFrom} onChange={(e) => setReconcileFrom(e.target.value)}><option value="">Administrateur</option>{data.profiles.filter((p) => p.user_id !== owner?.user_id && p.available > 0).map((p) => <option key={p.user_id} value={p.user_id}>{p.name} — {money(p.available)}</option>)}</select></label>
            <label><span className={label}>Crédits à régulariser</span><input type="number" min="1" max={data.missing_credits} step="1" className={field} value={reconcileQuantity} onChange={(e) => setReconcileQuantity(e.target.value)} required /></label>
            <button type="submit" disabled={busy || !data.eligible} className={`${primary} self-end`}>Régulariser le déficit</button>
          </form>}
        </div>}
        <section className="mt-7 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-2"><Wallet size={19} /><h2 className="text-lg font-semibold">Répartition des profils</h2></div>
          <p className="mt-2 text-sm text-muted">{data.manual_mode ? "Répartition personnalisée : l'arrivée d'un nouveau profil ne modifie pas les quotas existants." : "Répartition équitable automatique entre profils actifs, administrateur inclus."}</p>
          <div className="mt-5 space-y-3">{data.profiles.map((p) => <div key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
            <div><p className="font-semibold">{p.name}</p><p className="mt-1 text-xs text-muted">{p.role === "owner" ? "Administrateur" : "Collaborateur"} · {p.status === "active" ? "Actif" : p.status === "suspended" ? "Suspendu, quota gelé" : "Banni"}</p></div>
            <div className="text-right"><p className="text-lg font-bold">{money(p.available)} <span className="text-xs font-normal text-muted">crédits</span></p>{p.reserved > 0 && <p className="text-xs text-muted">{money(p.reserved)} réservés</p>}</div>
          </div>)}</div>
          {data.is_owner && <p className="mt-5 text-xs text-muted">Solde total réel du compte ORIA : {money(data.owner_balance)} crédits. Plafond de quotas du pack : {money(data.shared_pack_budget)}. Les recharges propres au titulaire ne sont pas partagées automatiquement.</p>}
        </section>
        {data.is_owner && <>
          <section className="mt-6 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><ArrowRightLeft size={19} /> Redistribution par l'administrateur</h2>
            <p className="mt-2 text-sm text-muted">Les crédits déjà consommés ou réservés ne peuvent pas être transférés. L'opération sera atomique.</p>
            <form onSubmit={(e) => void transfer(e)} className="mt-5 grid gap-3 sm:grid-cols-2">
              <label><span className={label}>Source de crédits</span><select className={field} value={mode} onChange={(e) => { setMode(e.target.value as Mode); setFrom(""); setTo(""); }}><option value="pack">Quota professionnel du pack</option><option value="personal">Réserve personnelle récupérée</option></select></label>
              <label><span className={label}>De</span><select className={field} value={resolvedFrom} onChange={(e) => { setFrom(e.target.value); setTo(""); }} disabled={mode === "personal"}>
                {mode === "personal" ? <option value={owner?.user_id ?? ""}>Administrateur — {money(data.recovered_personal_available)} disponibles</option> : data.profiles.filter((p) => p.status !== "banned").map((p) => <option key={p.user_id} value={p.user_id}>{p.name} — {money(p.available)}</option>)}
              </select></label>
              <label><span className={label}>Vers</span><select className={field} value={resolvedTo} onChange={(e) => setTo(e.target.value)} required>
                {active.filter((p) => p.user_id !== resolvedFrom).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select></label>
              <label><span className={label}>Montant exact en crédits</span><input type="number" min="1" max="1200000000" step="1" className={field} value={quantity} onChange={(e) => setQuantity(e.target.value)} required placeholder="Ex. : 3000" /></label>
              <button type="submit" disabled={busy || !data.eligible || data.requires_reconciliation || !resolvedTo || sources.length === 0 && mode === "pack"} className={`${primary} sm:col-span-2`}>Confirmer le transfert</button>
            </form>
          </section>
          <section className="mt-6 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Clock3 size={19} /> Historique des mouvements</h2>
            <div className="mt-4 space-y-2">{events.length === 0 ? <p className="text-sm text-muted">Aucun mouvement enregistré.</p> : events.slice(0,40).map((m) => <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 text-xs">
              <div><p className="font-medium">{m.kind.replaceAll("_", " ")}</p><p className="text-muted">{m.source_user_id ? nameOf(m.source_user_id) : "Système"} → {m.target_user_id ? nameOf(m.target_user_id) : "Répartition"}</p></div>
              <div className="text-right"><p className="font-semibold">{money(m.credits)} crédits</p><p className="text-muted">{new Date(m.created_at).toLocaleString("fr-GA")}</p></div>
            </div>)}</div>
          </section>
        </>}
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-border p-4 text-xs text-muted"><Shield size={17} className="shrink-0" /> La phase 4B attribue les quotas sans créer de nouveaux crédits. Le chat privé continue provisoirement à débiter les recharges personnelles ; le débit du pack sera raccordé après vérification des réservations et de l'enveloppe API existantes.</p>
      </>}
    </div>
  </main>;
}
