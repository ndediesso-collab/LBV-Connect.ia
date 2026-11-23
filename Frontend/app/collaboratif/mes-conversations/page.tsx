"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Coins, Loader2, MessageSquare, Plus, RefreshCcw, Send, Shield } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type Conversation = { id: string; member_user_id: string; title: string; updated_at: string };
type Message = { id: string; request_id: string; role: "user" | "assistant"; content: string; created_at: string };
type Listing = { success: boolean; conversations: Conversation[]; is_owner: boolean; notice: string };
type Thread = { success: boolean; conversation: Conversation; messages: Message[]; read_only: boolean; notice: string };
type Models = { success: boolean; models: string[]; note: string };
type Answer = { success: boolean; request_id: string; message: string; cost: number; balance?: number; replayed: boolean; pack_charged?: number | null; personal_charged?: number | null };
type Job = { state: "reserved" | "settled" | "uncertain"; message: string | null; cost: number | null };

const field = "rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-foreground/20";
const button = "rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-50";

export default function MesConversationsProfessionnelles() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"fast" | "balanced" | "deep">("balanced");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastRequest, setLastRequest] = useState("");

  const refreshList = useCallback(async () => {
    try {
      const result = await collabRequest<Listing>("/collaboratif/private/conversations");
      setListing(result);
      if (!result.is_owner) {
        const catalog = await collabRequest<Models>("/collaboratif/private/models");
        setModels(catalog.models);
        setModel((old) => catalog.models.includes(old) ? old : (catalog.models[0] ?? ""));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le chat professionnel est indisponible.");
    }
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const openConversation = useCallback(async (id: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await collabRequest<Thread>(`/collaboratif/private/conversations/${id}/messages`);
      setThread(response);
      setLastRequest(""); setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Conversation inaccessible.");
    } finally { setBusy(false); }
  }, []);

  async function createConversation() {
    setBusy(true); setError("");
    try {
      const response = await collabRequest<{ conversation: Conversation }>(
        "/collaboratif/private/conversations", "POST", { title: "Nouvelle conversation" });
      await refreshList();
      await openConversation(response.conversation.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setBusy(false); }
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !thread || thread.read_only || !model || !draft.trim()) return;
    const stableId = lastRequest || crypto.randomUUID();
    setLastRequest(stableId); setBusy(true); setError(""); setNotice("");
    try {
      const result = await collabRequest<Answer>(
        `/collaboratif/private/conversations/${thread.conversation.id}/chat`, "POST",
        { request_id: stableId, model, message: draft.trim(), reasoning_mode: mode });
      setNotice(`Réponse enregistrée : ${result.cost} crédit(s) consommé(s)${result.pack_charged != null ? ` (quota : ${result.pack_charged}, recharge : ${result.personal_charged ?? 0})` : ""}${result.replayed ? " (déjà facturée)" : ""}.`);
      setDraft(""); setLastRequest("");
      const current = await collabRequest<Thread>(
        `/collaboratif/private/conversations/${thread.conversation.id}/messages`);
      setThread(current); await refreshList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Échec de la génération.");
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!lastRequest) return;
    setBusy(true); setError("");
    try {
      const job = await collabRequest<Job>(`/collaboratif/private/jobs/${lastRequest}`);
      setNotice(job.state === "settled"
        ? `Réponse confirmée : ${job.cost} crédit(s) facturé(s).`
        : "Demande en attente de vérification : aucune relance payante automatique.");
      if (job.state === "settled" && thread) {
        setLastRequest(""); setDraft("");
        const updated = await collabRequest<Thread>(`/collaboratif/private/conversations/${thread.conversation.id}/messages`);
        setThread(updated);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Statut indisponible."); }
    finally { setBusy(false); }
  }

  const readOnly = listing?.is_owner ?? false;

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
      <Link href="/collaboratif/profils" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={16} /> Profils professionnels
      </Link>
      <header className="mt-8 mb-7">
        <p className="text-xs uppercase tracking-[0.25em] text-muted">ORIA • COLLABORATIF</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{readOnly ? "Conversations de l’équipe" : "Mes conversations privées"}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">Chaque historique est isolé par collaborateur. L’administrateur peut le consulter en lecture seule ; cette supervision est annoncée lors de l’inscription.</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-2"><Shield size={15} /> Accès authentifié</span>
        <span className="inline-flex items-center gap-2"><Coins size={15} /> Quota professionnel prioritaire, puis recharges personnelles (selon activation serveur)</span>
        <Link href="/collaboratif/quotas" className="underline">Voir mes quotas</Link>
        {!readOnly && <Link href="/collaboratif/recharges" className="underline">Acheter des crédits</Link>}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl border border-border p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-border p-3 text-sm">{notice}</p>}
      <div className="grid min-h-[550px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Historiques</h2>
            <button type="button" onClick={() => void refreshList()} aria-label="Actualiser les conversations"><RefreshCcw size={16} /></button>
          </div>
          {!readOnly && <button type="button" disabled={busy} onClick={() => void createConversation()}
            className={`${button} mb-4 flex w-full items-center justify-center gap-2`}><Plus size={15} /> Nouvelle conversation</button>}
          <div className="space-y-2">
            {listing?.conversations.map((c) => <button key={c.id} type="button"
              onClick={() => void openConversation(c.id)}
              className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left text-sm ${thread?.conversation.id === c.id ? "border-foreground" : "border-border"}`}>
              <MessageSquare size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="block truncate font-medium">{c.title}</span>
                {readOnly && <span className="block truncate text-xs text-muted">Profil : {c.member_user_id.slice(0,8)}</span>}
                <span className="block text-xs text-muted">{new Date(c.updated_at).toLocaleDateString("fr-GA")}</span>
              </span>
            </button>)}
            {listing?.conversations.length === 0 && <p className="text-sm text-muted">Aucune conversation pour l’instant.</p>}
          </div>
        </aside>

        <section className="flex min-h-[550px] flex-col rounded-2xl border border-border bg-surface">
          {!thread ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted">
            <BookOpen size={32} /> Choisissez une conversation ou créez-en une.
          </div> : <>
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold">{thread.conversation.title}</h2>
              <p className="text-xs text-muted">{thread.read_only ? "Supervision administrative : lecture seule" : "Discussion privée professionnelle"}</p>
            </div>
            <div className="max-h-[65vh] min-h-[260px] flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
              {thread.messages.map((m) => <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl border border-border px-4 py-3 text-sm leading-6 ${m.role === "user" ? "bg-foreground text-background" : "bg-background text-foreground"}`}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-65">{m.role === "user" ? "Vous" : "ORIA"}</p>
                  {m.content}
                </div>
              </div>)}
              {thread.messages.length === 0 && <p className="text-center text-sm text-muted">Votre prochain message démarrera la conversation.</p>}
            </div>
            {!thread.read_only && <form onSubmit={(e) => void send(e)} className="space-y-3 border-t border-border p-4">
              <div className="flex flex-wrap gap-2">
                <select className={`${field} flex-1`} aria-label="Modèle ORIA" value={model}
                  onChange={(e)=>{setModel(e.target.value);setLastRequest("");}}>
                  {models.map((m)=><option key={m} value={m}>{m}</option>)}
                </select>
                <select className={field} aria-label="Raisonnement" value={mode}
                  onChange={(e)=>{setMode(e.target.value as typeof mode);setLastRequest("");}}>
                  <option value="fast">Rapide</option><option value="balanced">Équilibré</option><option value="deep">Approfondi</option>
                </select>
              </div>
              <textarea className={`${field} w-full resize-y`} rows={3} maxLength={8000}
                placeholder="Écrivez votre message…" value={draft}
                onChange={(e)=>{setDraft(e.target.value);setLastRequest("");}} />
              <div className="flex flex-wrap items-center gap-3">
                <button className={`${button} inline-flex items-center gap-2`} disabled={busy || !model || !draft.trim()}>
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Envoyer
                </button>
                {lastRequest && <button type="button" disabled={busy} className="text-xs underline"
                  onClick={() => void verify()}>Vérifier la demande en attente</button>}
                <p className="text-xs text-muted">Texte uniquement · Débit après coût confirmé · Pas de streaming</p>
              </div>
            </form>}
          </>}
        </section>
      </div>
    </div>
  </main>;
}
