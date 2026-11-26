"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, Check, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Save, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");
type Assistant = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  welcome_message: string;
  slug: string;
  public_url?: string | null;
  is_public: boolean;
  created_at: string;
};
type Editor = Pick<Assistant, "name" | "description" | "instructions" | "welcome_message" | "is_public">;

const emptyEditor: Editor = {
  name: "",
  description: "",
  instructions: "Tu es un assistant utile, précis et professionnel. Tu aides les utilisateurs dans le domaine que je t'ai confié.",
  welcome_message: "Bonjour ! Comment puis-je vous aider ?",
  is_public: false,
};

export default function AssistantWorkspacePage() {
  const supabase = useMemo(() => createClient(), []);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [selected, setSelected] = useState<Assistant | null>(null);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || !session.access_token) throw new Error("Session ORIA expirée. Reconnecte-toi.");
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    headers.set("user-id", session.user.id);
    headers.set("authorization", `Bearer ${session.access_token}`);
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        cache: "no-store",
      });
    } catch {
      throw new Error(`Backend ORIA inaccessible (${API_URL}). Vérifie le déploiement Render, CORS et NEXT_PUBLIC_API_URL.`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || "Une erreur est survenue.");
    return payload;
  }, [supabase]);

  useEffect(() => {
    let active = true;

    void api("/assistant/assistants")
      .then(payload => {
        if (!active) return;
        const rows = Array.isArray(payload.assistants) ? payload.assistants as Assistant[] : [];
        setAssistants(rows);
        setSelected(current => current ? (rows.find(item => item.id === current.id) || null) : null);
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : "Impossible de charger Assistant ORIA.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api]);

  const beginCreate = () => {
    setSelected(null);
    setEditor(emptyEditor);
    setCreating(true);
    setNotice("");
    setError("");
  };

  const openAssistant = (assistant: Assistant) => {
    setSelected(assistant);
    setCreating(false);
    setEditor({
      name: assistant.name,
      description: assistant.description || "",
      instructions: assistant.instructions,
      welcome_message: assistant.welcome_message,
      is_public: assistant.is_public,
    });
    setNotice("");
    setError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = creating
        ? await api("/assistant/assistants", { method: "POST", body: JSON.stringify(editor) })
        : await api(`/assistant/assistants/${selected?.id}`, { method: "PATCH", body: JSON.stringify(editor) });
      const assistant = payload.assistant as Assistant;
      setSelected(assistant);
      setCreating(false);
      setEditor({
        name: assistant.name,
        description: assistant.description || "",
        instructions: assistant.instructions,
        welcome_message: assistant.welcome_message,
        is_public: assistant.is_public,
      });
      setNotice(creating ? "Assistant créé." : "Modifications enregistrées.");
      const latest = await api("/assistant/assistants");
      setAssistants(Array.isArray(latest.assistants) ? latest.assistants : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const getPublicUrl = (assistant: Assistant) =>
    assistant.public_url || `https://www.myoriaai.com/a/${encodeURIComponent(assistant.slug)}`;

  const copyPublicLink = async (assistant: Assistant) => {
    const url = getPublicUrl(assistant);
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Lien public copié.");
      setError("");
    } catch {
      setNotice(url);
    }
  };

  const regeneratePublicLink = async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      "Créer un nouveau lien public ? L'ancien lien cessera immédiatement de fonctionner pour tous les visiteurs."
    );
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await api(`/assistant/assistants/${selected.id}/regenerate-link`, { method: "POST" });
      const updated = payload.assistant as Assistant;
      setSelected(updated);
      setAssistants(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice("Nouveau lien généré et enregistré. L'ancien lien est désormais invalide.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renouveler le lien public.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Supprimer « ${selected.name} » et ses conversations ?`)) return;
    setSaving(true);
    try {
      await api(`/assistant/assistants/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setCreating(false);
      setAssistants(current => current.filter(item => item.id !== selected.id));
      setNotice("Assistant supprimé.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/chat" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl bg-foreground text-background"><Bot size={20} /></span>
            <span>ORIA <span className="font-normal text-muted">/ Assistant</span></span>
          </Link>
          <Link href="/chat" className="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface-secondary">Retour au Chat</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:py-10">
        <aside className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Espace de création</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Mes assistants</h1>
            <p className="mt-2 text-sm leading-6 text-muted">Crée un assistant spécialisé, définis son comportement et partage-le avec un lien public.</p>
          </div>
          <button onClick={beginCreate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-85">
            <Plus size={17} /> Créer un assistant
          </button>
          <div className="overflow-hidden rounded-2xl border border-border">
            {loading ? <div className="flex items-center gap-2 p-4 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" /> Chargement…</div> : assistants.length === 0 ? (
              <p className="p-4 text-sm leading-6 text-muted">Tu n&apos;as pas encore créé d&apos;assistant.</p>
            ) : assistants.map(assistant => (
              <button key={assistant.id} onClick={() => openAssistant(assistant)} className={`block w-full border-b border-border p-4 text-left last:border-b-0 hover:bg-surface-secondary ${selected?.id === assistant.id ? "bg-surface-secondary" : "bg-surface"}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{assistant.name}</span>
                  <span className={`size-2 shrink-0 rounded-full ${assistant.is_public ? "bg-foreground" : "bg-border-strong"}`} />
                </span>
                <span className="mt-1 block truncate text-xs text-muted">{assistant.description || "Sans description"}</span>
                <span className="mt-2 block text-[11px] text-muted">{assistant.is_public ? "Publié" : "Privé"}</span>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-surface-secondary p-4 text-xs leading-5 text-muted">
            <strong className="text-foreground">Facturation des conversations</strong>
            <p className="mt-1">Les réponses envoyées par les visiteurs sont déduites des crédits du propriétaire. Un pack Pro ou Business actif est requis.</p>
          </div>
        </aside>

        <section className="min-w-0">
          {!creating && !selected ? (
            <div className="flex min-h-[480px] flex-col items-center justify-center rounded-3xl border border-dashed border-border p-8 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-surface-secondary"><Bot size={30} /></span>
              <h2 className="mt-5 text-xl font-semibold">Un assistant à ton image</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted">Configure des instructions dédiées, teste ton assistant et partage son accès public quand tu es prêt.</p>
              <button onClick={beginCreate} className="mt-6 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background">Créer mon premier assistant</button>
            </div>
          ) : (
            <form onSubmit={save} className="rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{creating ? "Nouvelle configuration" : "Configuration"}</p>
                  <h2 className="mt-2 text-xl font-semibold">{creating ? "Créer un assistant" : selected?.name}</h2>
                </div>
                {selected && <span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted">{selected.is_public ? "Public" : "Privé"}</span>}
              </div>

              <div className="mt-7 grid gap-5">
                <label className="grid gap-2 text-sm font-medium">Nom public de la boutique ou du service
                  <input required minLength={2} maxLength={80} value={editor.name} onChange={e => setEditor(v => ({ ...v, name: e.target.value }))} placeholder="Ex. Gabon Drive Location" className="w-full rounded-xl border border-border bg-background px-4 py-3 font-normal outline-none focus:border-foreground" />
                </label>
                <label className="grid gap-2 text-sm font-medium">Description affichée aux visiteurs
                  <textarea rows={2} maxLength={300} value={editor.description} onChange={e => setEditor(v => ({ ...v, description: e.target.value }))} placeholder="Explique en une phrase ce que fait ton assistant." className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-normal outline-none focus:border-foreground" />
                </label>
                <label className="grid gap-2 text-sm font-medium">Instructions et rôle
                  <textarea required minLength={10} maxLength={12000} rows={11} value={editor.instructions} onChange={e => setEditor(v => ({ ...v, instructions: e.target.value }))} placeholder="Décris précisément sa mission, son domaine, son ton, ses limites et la manière dont il doit répondre." className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-normal leading-6 outline-none focus:border-foreground" />
                  <span className="text-xs font-normal text-muted">Ces instructions sont conservées côté serveur et appliquées à chaque conversation.</span>
                </label>
                <label className="grid gap-2 text-sm font-medium">Message d&apos;accueil
                  <textarea rows={2} maxLength={500} value={editor.welcome_message} onChange={e => setEditor(v => ({ ...v, welcome_message: e.target.value }))} className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-normal outline-none focus:border-foreground" />
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-4">
                  <input type="checkbox" checked={editor.is_public} onChange={e => setEditor(v => ({ ...v, is_public: e.target.checked }))} className="mt-1 size-4 accent-current" />
                  <span><span className="block text-sm font-semibold">Rendre cet assistant public</span><span className="mt-1 block text-xs leading-5 text-muted">Toute personne disposant du lien pourra discuter avec lui. Les réponses seront facturées sur ton portefeuille ORIA. Désactiver la publication révoque le lien actuel.</span></span>
                </label>
              </div>

              {error && <p role="alert" className="mt-5 rounded-xl border border-border-strong bg-surface-secondary px-4 py-3 text-sm text-foreground">{error}</p>}
              {notice && <p role="status" className="mt-5 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm">{notice}</p>}

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button disabled={saving} type="submit" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-50"><Save size={16} />{saving ? "Enregistrement…" : creating ? "Créer l'assistant" : "Enregistrer"}</button>
                {selected && <button type="button" disabled={saving} onClick={() => void remove()} className="ml-auto inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-muted hover:bg-surface-secondary hover:text-foreground"><Trash2 size={16} /> Supprimer</button>}
              </div>
              {selected && selected.is_public && (
                <div className="mt-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 dark:border-violet-900/60 dark:from-violet-950/30 dark:via-surface dark:to-sky-950/20 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Lien public de votre assistant</p>
                      <p className="mt-1 text-xs text-muted">Enregistré dans Supabase · Identifiant unique et durable</p>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">En ligne</span>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input readOnly value={getPublicUrl(selected)} aria-label="Lien public de l'assistant" className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white/90 px-3 py-3 text-xs text-slate-700 outline-none dark:border-border dark:bg-background dark:text-foreground" />
                    <button type="button" onClick={() => void copyPublicLink(selected)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-800"><Copy size={15}/> Copier</button>
                    <Link href={getPublicUrl(selected)} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-4 py-3 text-sm font-semibold text-violet-800 transition hover:bg-white dark:border-border dark:bg-surface dark:text-foreground"><ExternalLink size={15}/> Ouvrir</Link>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-2xl text-xs leading-5 text-muted">Le lien reste identique même après modification du nom ou des instructions. Le renouveler invalide immédiatement l'ancien lien.</p>
                    <button type="button" disabled={saving} onClick={() => void regeneratePublicLink()} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-3 py-2.5 text-xs font-semibold text-violet-800 transition hover:bg-white disabled:opacity-50 dark:border-border dark:bg-surface dark:text-foreground"><RotateCw size={14}/> Changer le lien</button>
                  </div>
                </div>
              )}
            </form>
          )}
          <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-muted"><Check size={14} /> Le modèle et le fournisseur sont sélectionnés automatiquement par ORIA. Aucun choix de modèle n&apos;est exposé aux visiteurs.</p>
        </section>
      </div>
    </main>
  );
}
