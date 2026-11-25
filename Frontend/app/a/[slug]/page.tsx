"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Bot, LoaderCircle, LockKeyhole, Sparkles } from "lucide-react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");
type PublicAssistant = { name: string; description: string; welcome_message: string; slug: string };
type Message = { id: string; role: "user" | "assistant"; content: string; created_at?: string };
type VisitorSession = { conversation_id: string; visitor_token: string };
class PublicApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export default function PublicAssistantPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug || "");
  const [assistant, setAssistant] = useState<PublicAssistant | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [visitor, setVisitor] = useState<VisitorSession | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingRequestRef = useRef<{ message: string; requestId: string } | null>(null);
  const storageKey = useMemo(() => `oria-assistant-session:${slug}`, [slug]);

  const fetchPublic = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new PublicApiError(payload.detail || "Assistant indisponible.", response.status);
    return payload;
  }, []);

  const loadMessages = useCallback(async (session: VisitorSession) => {
    const payload = await fetchPublic(
      `/assistant/public/${encodeURIComponent(slug)}/conversations/${encodeURIComponent(session.conversation_id)}/messages`,
      { headers: { "x-oria-visitor-token": session.visitor_token } },
    );
    setMessages(Array.isArray(payload.messages) ? payload.messages as Message[] : []);
  }, [fetchPublic, slug]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      setLoading(true);
      setError("");
      try {
        const publicInfo = await fetchPublic(`/assistant/public/${encodeURIComponent(slug)}`);
        if (!active) return;
        setAssistant(publicInfo.assistant as PublicAssistant);
        let session: VisitorSession | null = null;
        try {
          const stored = window.localStorage.getItem(storageKey);
          if (stored) session = JSON.parse(stored) as VisitorSession;
        } catch { session = null; }
        if (session?.conversation_id && session?.visitor_token) {
          try {
            await loadMessages(session);
          } catch { session = null; }
        }
        if (!session) {
          const started = await fetchPublic(`/assistant/public/${encodeURIComponent(slug)}/conversations`, { method: "POST" });
          session = { conversation_id: started.conversation_id, visitor_token: started.visitor_token };
          try { window.localStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* session remains in memory for this tab */ }
          if (active) setMessages([]);
        }
        if (active) setVisitor(session);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Assistant introuvable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    if (slug) void initialize();
    return () => { active = false; };
  }, [fetchPublic, loadMessages, slug, storageKey]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !visitor || sending) return;
    setSending(true);
    setError("");
    const optimisticId = `optimistic-${Date.now()}`;
    const requestId = pendingRequestRef.current?.message === text
      ? pendingRequestRef.current.requestId
      : crypto.randomUUID();
    pendingRequestRef.current = { message: text, requestId };
    setMessages(current => [...current, { id: optimisticId, role: "user", content: text }]);
    setDraft("");
    try {
      const payload = await fetchPublic(
        `/assistant/public/${encodeURIComponent(slug)}/conversations/${encodeURIComponent(visitor.conversation_id)}/messages`,
        {
          method: "POST",
          headers: { "x-oria-visitor-token": visitor.visitor_token },
          body: JSON.stringify({ request_id: requestId, message: text }),
        },
      );
      pendingRequestRef.current = null;
      setMessages(current => [
        ...current.map(item => item.id === optimisticId
          ? { ...item, id: `user-${crypto.randomUUID()}` }
          : item),
        { id: `answer-${crypto.randomUUID()}`, role: "assistant", content: String(payload.message || "") },
      ]);
    } catch (err) {
      setMessages(current => current.filter(item => item.id !== optimisticId));
      setDraft(text);
      if (err instanceof PublicApiError && [400, 401, 403, 404, 409, 422, 429, 502].includes(err.status)) {
        pendingRequestRef.current = null;
      }
      setError(err instanceof Error ? err.message : "La réponse n'a pas pu être générée.");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background"><Bot size={21} /></span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{assistant?.name || "Assistant ORIA"}</p><p className="text-xs text-muted">Propulsé par ORIA</p></div>
          </div>
          <Link href="https://www.myoriaai.com" className="shrink-0 text-xs font-medium text-muted transition hover:text-foreground">ORIA <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-3 pb-4 pt-6 sm:px-6 sm:pt-10">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-3 text-sm text-muted"><LoaderCircle className="animate-spin" size={18} /> Chargement de l'assistant…</div>
        ) : error && !assistant ? (
          <div className="m-auto max-w-md rounded-2xl border border-border p-7 text-center"><Bot size={28} className="mx-auto" /><h1 className="mt-4 text-lg font-semibold">Assistant indisponible</h1><p className="mt-2 text-sm leading-6 text-muted">{error}</p></div>
        ) : (
          <>
            <div className="mb-5 rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted"><Sparkles size={14} /> Assistant personnalisé</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{assistant?.name}</h1>
              {assistant?.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{assistant.description}</p>}
            </div>

            <div className="flex-1 space-y-4 pb-5" aria-live="polite">
              {messages.length === 0 && <div className="max-w-[90%] rounded-2xl rounded-tl-md border border-border bg-surface p-4 text-sm leading-7 sm:max-w-[80%]">{assistant?.welcome_message}</div>}
              {messages.map(message => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[82%] ${message.role === "user" ? "rounded-br-md bg-foreground text-background" : "rounded-tl-md border border-border bg-surface"}`}>{message.content}</div>
                </div>
              ))}
              {sending && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted"><LoaderCircle size={15} className="animate-spin" /> Réflexion en cours…</div></div>}
              <div ref={bottomRef} />
            </div>

            {error && <p role="alert" className="mb-3 rounded-xl border border-border-strong bg-surface-secondary px-4 py-3 text-xs leading-5 text-foreground">{error}</p>}
            <form onSubmit={send} className="sticky bottom-3 rounded-2xl border border-border bg-surface p-2 shadow-lg shadow-black/5">
              <div className="flex items-end gap-2">
                <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} rows={1} maxLength={8000} placeholder="Écris ton message…" disabled={sending || !visitor} className="max-h-36 min-h-12 flex-1 resize-y bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted disabled:opacity-50" />
                <button type="submit" aria-label="Envoyer le message" disabled={!draft.trim() || sending || !visitor} className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-background transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp size={19} /></button>
              </div>
              <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[10px] text-muted"><span className="flex items-center gap-1"><LockKeyhole size={11} /> Conversation privée par session</span><span>Entrée pour envoyer · Maj + Entrée pour sauter une ligne</span></div>
            </form>
            <p className="mx-auto mt-3 max-w-2xl text-center text-[10px] leading-4 text-muted">Les réponses sont générées par intelligence artificielle. Évite de transmettre des informations confidentielles.</p>
          </>
        )}
      </section>
    </main>
  );
}
