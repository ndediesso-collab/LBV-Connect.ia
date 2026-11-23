"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collabRequest } from "@/lib/collaboratif-api";

type WorkspaceResponse = { success: boolean; workspace_id: string; name: string; is_owner: boolean; pack_active: boolean };
type Group = { id: string; title: string; archived: boolean };
type Private = { id: string; title: string; member_user_id: string };
type ModelResponse = { workspace_id: string; models?: string[] };
type AiResponse = { success: boolean; workspace_id: string; message?: string; cost?: number; request_id?: string; [key: string]: unknown };

const field = "w-full rounded-xl border border-border bg-background p-3 text-sm";
const button = "rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40";

export default function WorkspaceAiPage() {
  const params = useParams();
  const space = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const base = `/collaboratif/workspaces/${encodeURIComponent(space)}`;
  const [context, setContext] = useState<WorkspaceResponse | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [privates, setPrivates] = useState<Private[]>([]);
  const [kind, setKind] = useState<"group" | "private">("group");
  const [targetId, setTargetId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState("balanced");
  const [question, setQuestion] = useState("@ORIA ");
  const [answer, setAnswer] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [ctx, g, p] = await Promise.all([
      collabRequest<WorkspaceResponse>(`${base}/scope/context`),
      collabRequest<{workspace_id: string; groups: Group[]}>(`${base}/scope/groups`),
      collabRequest<{workspace_id: string; conversations: Private[]}>(`${base}/scope/private/conversations`),
    ]);
    if (ctx.workspace_id !== space || g.workspace_id !== space || p.workspace_id !== space) {
      throw new Error("Réponse provenant d'un autre espace.");
    }
    setContext(ctx);
    setGroups((g.groups ?? []).filter(item => !item.archived));
    setPrivates(p.conversations ?? []);
  }, [base, space]);

  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "Espace inaccessible.")); }, [load]);

  useEffect(() => {
    let active = true;
    const route = `${base}/ai/models`;
    void collabRequest<ModelResponse>(route).then(data => {
      if (!active) return;
      if (data.workspace_id !== space) throw new Error("Modèles d’un autre espace interdits.");
      const next = Array.isArray(data.models) ? data.models.filter(x => typeof x === "string") : [];
      setModels(next);
      setModel(current => next.includes(current) ? current : (next[0] ?? ""));
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Modèles indisponibles."); });
    return () => { active = false; };
  }, [base, space]);

  const options = kind === "group" ? groups.map(x => ({id:x.id,title:x.title}))
    : privates.map(x => ({id:x.id,title:x.title}));

  async function ask() {
    if (busy || !targetId || !model || !question.trim()) return;
    setBusy(true); setError(""); setAnswer(""); setCost(null);
    const endpoint = kind === "group"
      ? `${base}/ai/groups/${encodeURIComponent(targetId)}/ask`
      : `${base}/ai/private/${encodeURIComponent(targetId)}/ask`;
    const input = kind === "group"
      ? { request_id: crypto.randomUUID(), model, reasoning_mode: mode, prompt: question }
      : { request_id: crypto.randomUUID(), model, reasoning_mode: mode, message: question };
    try {
      const result = await collabRequest<AiResponse>(endpoint, "POST", input);
      if (!result.success || result.workspace_id !== space) throw new Error("Réponse IA hors de cet espace.");
      setAnswer(typeof result.message === "string" ? result.message : "Réponse enregistrée dans l'historique.");
      if (typeof result.cost === "number") setCost(result.cost);
    } catch (e) {
      // Never automatically retry an uncertain provider request.
      setError(e instanceof Error ? e.message : "La demande doit être vérifiée avant toute relance.");
    } finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="flex gap-5 text-sm underline"><Link href={`/collaboratif/espaces/${encodeURIComponent(space)}`}>Retour à cet espace</Link><Link href="/collaboratif/espaces">Mes espaces</Link></nav>
      <h1 className="text-2xl font-bold">IA professionnelle — {context?.name ?? "Espace"}</h1>
      <p className="text-sm text-muted">Chaque demande est vérifiée dans cet espace. Les crédits sont réservés par les fonctions collaboratives existantes. Les réponses incertaines ne sont jamais relancées automatiquement.</p>
      {context && !context.pack_active && <p className="rounded-xl border border-border p-4 text-sm">Le pack professionnel est inactif : aucun nouvel appel IA n'est autorisé.</p>}
      <section className="space-y-4 rounded-2xl border border-border p-5">
        <label className="block text-sm">Type de conversation
          <select className={`${field} mt-2`} value={kind} onChange={e=>{ const value=e.target.value === "private" ? "private" : "group"; setKind(value);setTargetId("");setQuestion(value === "group" ? "@ORIA " : ""); }}>
            <option value="group">Salon collectif avec @ORIA</option>
            <option value="private">Conversation professionnelle privée</option>
          </select>
        </label>
        <label className="block text-sm">{kind === "group" ? "Salon" : "Conversation"}
          <select className={`${field} mt-2`} value={targetId} onChange={e=>setTargetId(e.target.value)}>
            <option value="">Sélectionnez une conversation</option>
            {options.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Modèle<select className={`${field} mt-2`} value={model} onChange={e=>setModel(e.target.value)}><option value="">Modèle indisponible</option>{models.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
          <label className="text-sm">Raisonnement<select className={`${field} mt-2`} value={mode} onChange={e=>setMode(e.target.value)}><option value="fast">Rapide</option><option value="balanced">Équilibré</option><option value="deep">Approfondi</option></select></label>
        </div>
        <label className="block text-sm">Votre demande<textarea className={`${field} mt-2 min-h-32`} maxLength={kind === "group" ? 4000 : 8000} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
        <button className={button} type="button" disabled={busy || !context?.pack_active || !model || !targetId || !question.trim()} onClick={()=>void ask()}>{busy ? "Demande en cours…" : "Envoyer à ORIA"}</button>
      </section>
      {error && <p role="alert" className="rounded-xl border border-border p-4 text-sm">{error}</p>}
      {answer && <section className="rounded-2xl border border-border p-5"><h2 className="mb-3 font-semibold">Réponse</h2><p className="whitespace-pre-wrap text-sm">{answer}</p>{cost !== null && <p className="mt-4 text-xs text-muted">Crédits débités : {cost}</p>}</section>}
      <p className="text-xs text-muted">Phase 6B2C : mode staging, mono-adhésion toujours active. Ne pas exposer publiquement avant les essais de règlement et de sécurité.</p>
    </div>
  </main>;
}
