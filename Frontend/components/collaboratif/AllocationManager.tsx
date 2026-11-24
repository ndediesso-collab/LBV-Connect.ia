"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, ShieldCheck, Users, Wallet } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

export type AllocationProfile = {
  user_id: string; name: string; role: "owner" | "member";
  status: "active" | "suspended" | "banned";
  available: number; reserved: number; spent: number;
  suggested_equal: number | null;
};
export type AllocationPreview = {
  success: boolean; workspace_id: string; eligible: boolean;
  needs_prompt: boolean; equal_allowed: boolean;
  has_consumption_or_reservation: boolean; requires_reconciliation: boolean;
  pack_id?: string; pack_activated_at: string; members_fingerprint: string;
  active_count: number; shared_pack_budget: number; active_available: number;
  owner_balance: number; last_choice?: string | null;
  profiles: AllocationProfile[];
};
type Mode = "equal" | "manual" | "later";
const fmt = (n: number) => new Intl.NumberFormat("fr-GA").format(n);
const field = "w-full rounded-xl border border-border bg-background px-3 py-3 text-base sm:text-sm text-foreground";

export default function AllocationManager({ workspaceId, onApplied }: { workspaceId: string; onApplied?: () => void }) {
  const base = `/collaboratif/workspaces/${encodeURIComponent(workspaceId)}/allocation`;
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [mode, setMode] = useState<Mode>("later");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Garder le MEME UUID après une erreur réseau ambiguë: aucun double transfert.
  const decisionRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await collabRequest<AllocationPreview>(`${base}/preview`);
    if (!result.success || result.workspace_id !== workspaceId) throw new Error("Proposition d'un autre espace refusée.");
    setPreview(result);
    const active = (result.profiles || []).filter(p => p.status === "active");
    setAmounts(Object.fromEntries(active.map(p => [p.user_id, String(p.available)])));
    setMode(result.equal_allowed ? "equal" : "manual");
    decisionRef.current = null;
  }, [base, workspaceId]);

  useEffect(() => {
    let mounted = true;
    void refresh().catch(e => { if (mounted) setError(e instanceof Error ? e.message : "Proposition indisponible."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refresh]);

  const active = useMemo(() => (preview?.profiles ?? []).filter(p => p.status === "active"), [preview]);
  const values = active.map(p => amounts[p.user_id] ?? "");
  const validManual = values.every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= 0);
  const totalManual = validManual ? values.reduce((n,v) => n + Number(v),0) : -1;
  const totalAvailable = preview?.active_available ?? 0;

  async function decide() {
    if (!preview || busy || !preview.eligible || preview.requires_reconciliation) return;
    if (mode === "equal" && !preview.equal_allowed) return;
    if (mode === "manual" && (!validManual || totalManual !== totalAvailable)) {
      setError("La somme des nouveaux quotas doit correspondre exactement au total disponible."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      decisionRef.current ||= crypto.randomUUID();
      const allocations = mode === "manual"
        ? active.map(p => ({ user_id: p.user_id, available: Number(amounts[p.user_id]) })) : [];
      const r = await collabRequest<{success:boolean;workspace_id:string;mode:string;changed_profiles:number}>(
        `${base}/apply`, "POST", {
          decision_id:decisionRef.current, mode, allocations,
          members_fingerprint:preview.members_fingerprint,
          pack_activated_at:preview.pack_activated_at,
        });
      if (!r.success || r.workspace_id !== workspaceId) throw new Error("Confirmation de répartition incohérente.");
      setNotice(mode === "later" ? "Décision enregistrée. Aucun crédit déplacé."
        : `Répartition confirmée. ${r.changed_profiles} quota(s) mis à jour.`);
      decisionRef.current = null;
      await refresh();
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aucun transfert confirmé.");
      // Ne pas réutiliser l'UUID sur des champs modifiés: chaque action est explicite.
    } finally { setBusy(false); }
  }

  return <section id="repartition" className="scroll-mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-label="Répartition assistée des crédits">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Users size={19}/> Répartition des crédits du pack</h2>
      <button type="button" disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50"
        onClick={() => {setLoading(true);setError("");void refresh().catch(e=>setError(String(e))).finally(()=>setLoading(false));}}>
        <RefreshCcw size={14}/> Actualiser
      </button>
    </div>
    <p className="mt-2 text-sm text-muted">Aucun partage n'est effectué à l'adhésion ou au renouvellement sans votre confirmation. Les recharges personnelles restent privées.</p>
    {loading && <p role="status" className="mt-4 text-sm">Vérification du nouveau cycle de pack et des quotas…</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-border p-3 text-sm">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl border border-border p-3 text-sm">{notice}</p>}
    {preview?.eligible && <>
      {preview.needs_prompt && <p className="mt-4 rounded-xl border border-border bg-surface-secondary p-3 text-sm font-medium">Nouvelle adhésion ou nouveau cycle détecté. Choisissez ce que vous souhaitez faire des crédits de votre pack.</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted">Quota actuellement répartissable</p><strong className="mt-1 block text-xl tabular-nums">{fmt(totalAvailable)}</strong></div>
        <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted">Participants actifs</p><strong className="mt-1 block text-xl">{preview.active_count}</strong></div>
      </div>
      {preview.requires_reconciliation && <p className="mt-4 text-sm">Les quotas nécessitent une régularisation : répartition temporairement verrouillée.</p>}
      {!preview.equal_allowed && <p className="mt-4 text-sm text-muted">Le partage équitable n'est pas disponible : crédits de pack déjà consommés, réservés, ou quotas gelés. Vous pouvez redistribuer manuellement les seuls quotas encore disponibles.</p>}
      <fieldset className="mt-5 space-y-3" disabled={busy || preview.requires_reconciliation}>
        <legend className="mb-3 text-sm font-semibold">Votre décision</legend>
        {([{key:"equal",name:"Répartition équitable",desc:"Rééquilibrer les crédits disponibles entre tous les membres actifs."},
          {key:"manual",name:"Répartition personnalisée",desc:"Conserver ou ajuster individuellement les quotas encore disponibles."},
          {key:"later",name:"Décider plus tard",desc:"Ne déplacer aucun crédit."}] as const).map(choice =>
          <label key={choice.key} className={`flex gap-3 rounded-xl border p-3 text-sm ${mode===choice.key ? "border-foreground" : "border-border"} ${choice.key==="equal"&&!preview.equal_allowed ? "opacity-45" : ""}`}>
            <input type="radio" name={`allocation-mode-${workspaceId}`} checked={mode===choice.key}
              disabled={choice.key==="equal" && !preview.equal_allowed}
              onChange={() => {setMode(choice.key);decisionRef.current=null;setError("");}} />
            <span><strong className="block">{choice.name}</strong><span className="mt-1 block text-xs text-muted">{choice.desc}</span></span>
          </label>)}
      </fieldset>
      {mode === "equal" && preview.equal_allowed && <div className="mt-5 space-y-2 rounded-xl border border-border p-4 text-sm">
        <strong>Prévisualisation, avant validation</strong>
        {active.map(p=><div key={p.user_id} className="flex justify-between gap-2"><span>{p.name}</span><strong className="tabular-nums">{fmt(p.suggested_equal ?? 0)}</strong></div>)}
      </div>}
      {mode === "manual" && <div className="mt-5 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold">Quotas à attribuer (crédits disponibles)</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {active.map(p=><label key={p.user_id} className="text-xs"><span className="mb-1 block font-medium">{p.name} {p.role==="owner"?"(propriétaire)":""}</span>
            <input className={field} type="number" min="0" max="1200000000" step="1"
              value={amounts[p.user_id] ?? ""}
              onChange={e=>{setAmounts(old=>({...old,[p.user_id]:e.target.value}));decisionRef.current=null;}} />
            <span className="mt-1 block text-muted">Actuel : {fmt(p.available)} · Réservé : {fmt(p.reserved)} · Dépensé : {fmt(p.spent)}</span>
          </label>)}
        </div>
        <p className={`mt-4 text-sm ${totalManual!==totalAvailable ? "font-semibold" : "text-muted"}`}>
          Total prévu : {totalManual<0 ? "invalide" : fmt(totalManual)} / {fmt(totalAvailable)} crédits disponibles
        </p>
      </div>}
      <button type="button" className="mt-5 w-full rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-40"
        disabled={busy || preview.requires_reconciliation || (mode==="equal"&&!preview.equal_allowed) || (mode==="manual"&&(!validManual||totalManual!==totalAvailable))}
        onClick={()=>void decide()}>{busy?"Vérification transactionnelle…":mode==="later"?"Enregistrer : décider plus tard":"Confirmer la répartition"}</button>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted"><ShieldCheck size={17} className="shrink-0"/> Le serveur vérifie à nouveau les crédits, les membres, le pack et les réservations avant toute écriture. Aucun nouveau crédit n'est créé.</p>
    </>}
    {preview && !preview.eligible && <p className="mt-4 text-sm text-muted">Un pack Pro ou Business actif est nécessaire pour répartir les crédits de cet espace.</p>}
  </section>;
}
