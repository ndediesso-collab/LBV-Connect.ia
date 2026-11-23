"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, BarChart3, Clock, RefreshCcw, ShieldCheck, Wallet } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";
import { capacityPercent, capacityRemaining, capacityStatus, creditStatus, safeCount } from "@/lib/collab-alerts";

type MemberQuota = {
  user_id: string; name: string; role: "owner" | "member";
  status: "active" | "suspended" | "banned";
  available: number; reserved: number; spent: number;
};
type QuotaSnapshot = {
  success: boolean; is_owner: boolean; eligible: boolean; pack_id: string | null;
  profiles: MemberQuota[]; my_personal_balance: number;
  requires_reconciliation: boolean; missing_credits: number;
  manual_mode: boolean; recovered_personal_available: number | null;
  owner_balance: number | null; shared_pack_budget: number | null;
};
type Group = {
  id: string; title: string; message_count: number; message_limit: number;
  pending_ai_slots: number; archived: boolean;
};
type GroupList = { success: boolean; is_owner: boolean; groups: Group[] };
type Movement = {
  id: number; kind: string; credits: number; created_at: string;
  source_user_id: string | null; target_user_id: string | null;
};
type MovementList = { success: boolean; events: Movement[] };

const format = (v: number | null | undefined) => new Intl.NumberFormat("fr-GA").format(v ?? 0);
const time = (s: string) => {
  const stamp = Date.parse(s);
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString("fr-GA") : "Date non disponible";
};
const card = "rounded-2xl border border-border bg-surface p-5";
const cLabel: Record<string, string> = {
  normal: "Capacité disponible", warning80: "Seuil 80 % atteint",
  warning90: "Seuil 90 % atteint", full: "Limite atteinte", invalid: "Compteur indisponible",
};
const pLabel: Record<string, string> = {
  normal: "Quota disponible", low: "Quota faible (20 % ou moins)",
  empty: "Aucun crédit disponible", unallocated: "Quota non attribué", invalid: "Solde indisponible",
};

export default function SupervisionCollaboratif() {
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [groups, setGroups] = useState<GroupList | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadError, setLoadError] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    // Chaque lecture applique les permissions déjà imposées par le backend.
    // Ne pas exposer de liste globale de tous les membres à un simple profil.
    const results = await Promise.allSettled([
      collabRequest<QuotaSnapshot>("/collaboratif/quotas"),
      collabRequest<GroupList>("/collaboratif/groups"),
    ]);
    const issues: string[] = [];
    const quotaResult = results[0];
    const groupResult = results[1];
    if (quotaResult.status === "fulfilled" && quotaResult.value.success && Array.isArray(quotaResult.value.profiles)) {
      setQuota(quotaResult.value);
      if (quotaResult.value.is_owner) {
        try {
          const history = await collabRequest<MovementList>("/collaboratif/quotas/movements");
          setMovements(Array.isArray(history.events) ? history.events : []);
        } catch { setMovements([]); issues.push("Historique des mouvements temporairement indisponible."); }
      } else setMovements([]);
    } else {
      setQuota(null); setMovements([]);
      issues.push("Quotas indisponibles. Vérifiez l'activation de la gestion des quotas.");
    }
    if (groupResult.status === "fulfilled" && groupResult.value.success && Array.isArray(groupResult.value.groups)) {
      setGroups(groupResult.value);
    } else {
      setGroups(null);
      issues.push("Salons indisponibles. Vérifiez l'activation des groupes.");
    }
    setLoadError(issues);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh().catch(() => { setLoadError(["Actualisation temporairement impossible."]); });
    }, 30000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const myProfiles = quota?.profiles ?? [];
  const myQuota = quota?.is_owner
    ? myProfiles.find((p) => p.role === "owner")
    : myProfiles[0];
  const activeProfiles = useMemo(() => myProfiles.filter((p) => p.status === "active"), [myProfiles]);
  const totals = useMemo(() => myProfiles.reduce((a, p) => ({
    available: a.available + (safeCount(p.available) ?? 0),
    reserved: a.reserved + (safeCount(p.reserved) ?? 0),
    spent: a.spent + (safeCount(p.spent) ?? 0),
  }), { available: 0, reserved: 0, spent: 0 }), [myProfiles]);
  const alertGroups = useMemo(() => (groups?.groups ?? []).filter(
    (g) => capacityStatus(g.message_count, g.message_limit) !== "normal"), [groups]);
  const alertProfiles = useMemo(() => activeProfiles.filter((p) =>
    creditStatus(p.available, p.reserved, p.spent) !== "normal"), [activeProfiles]);

  async function manualRefresh() {
    if (updating) return;
    setUpdating(true);
    try { await refresh(); }
    catch { setLoadError(["Actualisation temporairement impossible."]); }
    finally { setUpdating(false); }
  }

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-8">
      <Link href="/collaboratif/espaces" className="mb-3 inline-flex items-center rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-surface">Mes espaces collaboratifs</Link>
      <Link href="/collaboratif/profils" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={16} /> Espace professionnel
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supervision collaboratif</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Crédits professionnels, recharges personnelles et capacité des salons. Des informations lues sur ton compte, sans effectuer de paiement ni de transfert.</p>
        </div>
        <button type="button" onClick={() => void manualRefresh()} disabled={updating} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">
          <RefreshCcw size={16} /> Actualiser
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <Clock size={14} /> {lastRefresh ? `Dernière lecture : ${time(lastRefresh.toISOString())}` : "Chargement…"} · Rafraîchissement lorsque la page est visible, toutes les 30 secondes
      </div>
      {loading && <p className="mt-6 text-sm text-muted">Chargement des informations financières…</p>}
      {loadError.map((issue) => <p key={issue} role="status" className="mt-4 rounded-xl border border-border p-3 text-sm">{issue}</p>)}
      {!loading && <>
        {quota && <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className={card}><p className="text-xs text-muted">Mon quota disponible</p><p className="mt-2 text-2xl font-bold">{format(safeCount(myQuota?.available))}</p><p className="mt-1 text-xs text-muted">crédits professionnels</p></div>
            <div className={card}><p className="text-xs text-muted">Ma recharge personnelle</p><p className="mt-2 text-2xl font-bold">{format(safeCount(quota.my_personal_balance))}</p><p className="mt-1 text-xs text-muted">crédits distincts du pack</p></div>
            <div className={card}><p className="text-xs text-muted">Mes crédits réservés</p><p className="mt-2 text-2xl font-bold">{format(safeCount(myQuota?.reserved))}</p><p className="mt-1 text-xs text-muted">en attente de règlement</p></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <Link href="/collaboratif/quotas" className="underline underline-offset-4">Ouvrir les quotas et transferts</Link>
            <Link href="/collaboratif/recharges" className="underline underline-offset-4">Mes recharges personnelles</Link>
          </div>
          {!quota.eligible && <div role="alert" className="mt-5 rounded-xl border border-border p-4 text-sm"><AlertTriangle className="mr-2 inline" size={17} /> Pack professionnel inactif : consultation possible, nouvelles opérations restreintes.</div>}
          {quota.requires_reconciliation && <div role="alert" className="mt-4 rounded-xl border border-border p-4 text-sm">
            <AlertTriangle className="mr-2 inline" size={18} /> Quotas à régulariser : {format(safeCount(quota.missing_credits))} crédits. Les transferts sont bloqués jusqu'à correction par l'administrateur.
          </div>}
          <section className="mt-7">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={19} /> Alertes de crédits</h2>
            <p className="mt-1 text-xs text-muted">L'alerte faible apparaît lorsque le disponible représente 20 % ou moins du quota attribué, réservé et consommé inclus.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {alertProfiles.length === 0 && <p className="text-sm text-muted">Aucune alerte sur les quotas visibles.</p>}
              {alertProfiles.map((p) => {
                const status = creditStatus(p.available, p.reserved, p.spent);
                return <div key={p.user_id} className={card}>
                  <div className="flex items-center gap-2"><AlertTriangle size={16} /><p className="text-sm font-semibold">{p.name}</p></div>
                  <p className="mt-2 text-sm">{pLabel[status]}</p>
                  <p className="mt-1 text-xs text-muted">{format(safeCount(p.available))} disponibles · {format(safeCount(p.reserved))} réservés · {format(safeCount(p.spent))} consommés</p>
                </div>;
              })}
            </div>
          </section>
          {quota.is_owner && <section className="mt-7 rounded-2xl border border-border p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 size={18} /> Vue financière de l'équipe</h2>
            <p className="mt-2 text-xs text-muted">Instantané des compteurs de quotas. Le portefeuille principal est une source unique, les montants ci-dessous ne constituent pas un second solde.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted">Disponible attribué</p><p className="text-xl font-semibold">{format(totals.available)}</p></div>
              <div><p className="text-xs text-muted">Réservé</p><p className="text-xl font-semibold">{format(totals.reserved)}</p></div>
              <div><p className="text-xs text-muted">Consommé (période)</p><p className="text-xl font-semibold">{format(totals.spent)}</p></div>
            </div>
            <p className="mt-3 text-xs text-muted">Solde du portefeuille principal : {format(safeCount(quota.owner_balance))} crédits. Mode de répartition : {quota.manual_mode ? "manuel" : "équitable"}.</p>
            <h3 className="mt-5 text-sm font-semibold">Derniers mouvements de quotas</h3>
            {movements.length === 0 ? <p className="mt-2 text-xs text-muted">Aucun mouvement visible ou historique indisponible.</p> : <div className="mt-2 max-h-60 overflow-y-auto">
              {movements.slice(0, 12).map((m) => <div key={m.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-xs">
                <span>{m.kind.replace(/_/g, " ")}</span><span>{format(safeCount(m.credits))} crédits · {time(m.created_at)}</span>
              </div>)}
            </div>}
          </section>}
        </>}
        {groups && <section className="mt-8">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={19} /> Capacité des salons</h2>
              <p className="mt-1 text-xs text-muted">Alertes visibles à 80 %, 90 % et 100 % de la capacité effectivement consommée. Les emplacements réservés aux réponses IA réduisent aussi la capacité immédiatement disponible.</p></div>
            <Link href="/collaboratif/groupes" className="text-sm underline underline-offset-4">Gérer les salons</Link>
          </div>
          {alertGroups.length > 0 && <p role="alert" className="mt-3 rounded-xl border border-border p-3 text-sm"><AlertTriangle className="mr-2 inline" size={16} /> {alertGroups.length} salon(s) avec un seuil atteint ou un compteur invalide.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.groups.length === 0 && <p className="text-sm text-muted">Aucun salon accessible.</p>}
            {groups.groups.map((g) => {
              const status = capacityStatus(g.message_count, g.message_limit);
              const pct = capacityPercent(g.message_count, g.message_limit);
              const remaining = capacityRemaining(g.message_count, g.message_limit, g.pending_ai_slots);
              return <article key={g.id} className={card}>
                <div className="flex items-start justify-between gap-2"><p className="font-semibold">{g.title}</p><span className="text-xs text-muted">{g.archived ? "Archivé" : cLabel[status]}</span></div>
                <p className="mt-2 text-sm">{pct === null ? "Compteur indisponible" : `${pct} %`}</p>
                <div role="progressbar" aria-label={`Messages du salon ${g.title}`} aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full bg-foreground" style={{ width: `${pct ?? 0}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{format(safeCount(g.message_count))} / {format(safeCount(g.message_limit))} messages · {remaining === null ? "Disponible inconnu" : `${format(remaining)} envois disponibles`} {safeCount(g.pending_ai_slots) ? `· ${format(g.pending_ai_slots)} place(s) réservée(s)` : ""}</p>
                {(status === "full" || status === "warning80" || status === "warning90") && <p className="mt-2 text-xs">{status === "full" ? "Envoi bloqué jusqu'à une extension confirmée." : "Préparez une extension si le salon approche de la limite."}</p>}
              </article>;
            })}
          </div>
        </section>}
        <div className="mt-8 rounded-xl border border-border p-4 text-xs text-muted">
          <strong>Nature de ces alertes :</strong> elles sont calculées à la consultation ou lors de l'actualisation de cette page. Il ne s'agit pas encore de notifications push, d'e-mails ni de rappels persistants. Aucun crédit ni message n'est créé ou débité ici.
        </div>
      </>}
    </div>
  </main>;
}
