"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp, Building2, CarFront, Check, Hotel, LoaderCircle,
  LockKeyhole, MessageCircle, RefreshCw, Store,
} from "lucide-react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");

type PublicAssistant = {
  name: string;
  description: string;
  welcome_message: string;
  slug: string;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};
type VisitorSession = { conversation_id: string; visitor_token: string };

class PublicApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "IA";
  return words.slice(0, 2).map((word) => Array.from(word)[0]?.toUpperCase() || "").join("") || "IA";
}

function suggestionsFor(name: string, description: string): string[] {
  const value = `${name} ${description}`.toLocaleLowerCase("fr");
  if (/(location|voiture|véhicule|automobile|transport|chauffeur)/.test(value)) {
    return ["Quels véhicules proposez-vous ?", "Quelles sont les conditions de location ?", "Comment réserver un véhicule ?"];
  }
  if (/(hôtel|hotel|hébergement|chambre|séjour)/.test(value)) {
    return ["Quels sont vos tarifs ?", "Quels services proposez-vous ?", "Comment réserver ?"];
  }
  if (/(boutique|vente|vêtement|mode|produit|commande)/.test(value)) {
    return ["Quels produits proposez-vous ?", "Quels sont vos tarifs ?", "Comment passer une commande ?"];
  }
  return ["Quels sont vos services ?", "Quels sont vos tarifs ?", "Comment vous contacter ?"];
}

function userFacingError(error: unknown): string {
  if (error instanceof PublicApiError) {
    if (error.status === 400 || error.status === 422) return error.message || "Vérifiez votre message puis réessayez.";
    if (error.status === 402) return "Cet assistant est momentanément indisponible. Merci de contacter directement l'entreprise.";
    if (error.status === 401 || error.status === 404) return "Cette session n'est plus valide. Utilisez « Recommencer » pour ouvrir une nouvelle conversation.";
    if (error.status === 409) return "Une réponse précédente doit être terminée. Patientez quelques instants avant de réessayer.";
    if (error.status === 429) return "Un grand nombre de demandes vient d'être envoyé. Patientez un instant avant de réessayer.";
    if (error.status >= 500) return "Le service rencontre actuellement un problème temporaire. Votre message est conservé dans le champ : vous pourrez réessayer dans un instant.";
    return error.message || "Votre demande n'a pas pu être traitée.";
  }
  return "La connexion au service a été interrompue. Vérifiez votre connexion puis réessayez.";
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
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState("");
  const conversationRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingRequestRef = useRef<{ message: string; requestId: string } | null>(null);
  const storageKey = useMemo(() => `oria-assistant-session:${slug}`, [slug]);

  const fetchPublic = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
    } catch {
      throw new PublicApiError("Connexion au service indisponible.", 0);
    }
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : "";
      throw new PublicApiError(detail, response.status);
    }
    return payload;
  }, []);

  const loadMessages = useCallback(async (session: VisitorSession) => {
    const payload = await fetchPublic(
      `/assistant/public/${encodeURIComponent(slug)}/conversations/${encodeURIComponent(session.conversation_id)}/messages`,
      { headers: { "x-oria-visitor-token": session.visitor_token } },
    );
    setMessages(Array.isArray(payload.messages) ? payload.messages as Message[] : []);
  }, [fetchPublic, slug]);

  const createVisitorSession = useCallback(async (): Promise<VisitorSession> => {
    const started = await fetchPublic(`/assistant/public/${encodeURIComponent(slug)}/conversations`, { method: "POST" });
    const session = {
      conversation_id: String(started.conversation_id || ""),
      visitor_token: String(started.visitor_token || ""),
    };
    if (!session.conversation_id || !session.visitor_token) {
      throw new PublicApiError("Impossible de démarrer cette conversation.", 503);
    }
    try { window.localStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* session valable dans l'onglet */ }
    return session;
  }, [fetchPublic, slug, storageKey]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      setLoading(true);
      setError("");
      try {
        const info = await fetchPublic(`/assistant/public/${encodeURIComponent(slug)}`);
        if (!active) return;
        const publicAssistant = info.assistant as PublicAssistant;
        if (!publicAssistant?.name) throw new PublicApiError("Cet assistant n'est pas disponible publiquement.", 404);
        setAssistant(publicAssistant);

        let session: VisitorSession | null = null;
        try {
          const stored = window.localStorage.getItem(storageKey);
          if (stored) session = JSON.parse(stored) as VisitorSession;
        } catch { session = null; }

        if (session?.conversation_id && session?.visitor_token) {
          try {
            await loadMessages(session);
          } catch {
            session = null;
          }
        }
        if (!session) {
          session = await createVisitorSession();
          if (active) setMessages([]);
        }
        if (active) setVisitor(session);
      } catch (err) {
        if (active) setError(userFacingError(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    if (slug) void initialize();
    return () => { active = false; };
  }, [createVisitorSession, fetchPublic, loadMessages, slug, storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || !visitor || sending) return;
    setSending(true);
    setError("");
    const optimisticId = `optimistic-${Date.now()}`;
    const requestId = pendingRequestRef.current?.message === text
      ? pendingRequestRef.current.requestId
      : crypto.randomUUID();
    pendingRequestRef.current = { message: text, requestId };
    setMessages((current) => [...current, { id: optimisticId, role: "user", content: text }]);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
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
      setMessages((current) => [
        ...current.map((item) => item.id === optimisticId ? { ...item, id: `user-${crypto.randomUUID()}` } : item),
        { id: `answer-${crypto.randomUUID()}`, role: "assistant", content: String(payload.message || "") },
      ]);
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setDraft(text);
      if (err instanceof PublicApiError && err.status > 0 && err.status < 500 && err.status !== 409) {
        pendingRequestRef.current = null;
      }
      setError(userFacingError(err));
    } finally {
      setSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const restartConversation = async () => {
    if (restarting || sending) return;
    setRestarting(true);
    setError("");
    try {
      const session = await createVisitorSession();
      pendingRequestRef.current = null;
      setVisitor(session);
      setMessages([]);
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setRestarting(false);
    }
  };

  const name = assistant?.name || "Assistant ORIA";
  const description = assistant?.description || "Assistant officiel · Renseignements et accompagnement";
  const initials = initialsFromName(name);
  const suggestions = suggestionsFor(name, description);
  const ActivityIcon = /(location|voiture|véhicule|automobile|transport)/i.test(`${name} ${description}`)
    ? CarFront
    : /(hôtel|hotel|hébergement|chambre)/i.test(`${name} ${description}`)
      ? Hotel
      : /(boutique|vente|commerce|produit)/i.test(`${name} ${description}`)
        ? Store
        : Building2;

  return (
    <main className="oria-public-page">
      <style jsx global>{`
        :root { color-scheme: light; }
        html, body { height: 100%; min-height: 100%; }
        body { margin: 0; background: #f7f7f6; color: #171717; -webkit-font-smoothing: antialiased; }
        button, textarea { font: inherit; }
        button { -webkit-tap-highlight-color: transparent; }
        .oria-public-page { width: 100%; height: 100dvh; min-height: 100svh; overflow: hidden; background: #fff; color: #171717; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .oria-app-shell { width: 100%; height: 100dvh; min-height: 100svh; display: flex; align-items: stretch; justify-content: stretch; padding: 0; overflow: hidden; }
        .oria-chat-card { width: 100%; height: 100dvh; min-height: 100svh; display: flex; flex-direction: column; overflow: hidden; background: #fff; border: 0; border-radius: 0; box-shadow: none; }
        .oria-business-header { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px clamp(20px, 4vw, 64px); border-bottom: 1px solid #e9e9e7; background: rgba(255,255,255,.98); flex-shrink: 0; }
        .oria-business-identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
        .oria-avatar { flex: 0 0 48px; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 16px; background: #171717; color: #fff; font-size: 14px; font-weight: 750; letter-spacing: -.04em; }
        .oria-identity-copy { min-width: 0; }
        .oria-eyebrow { margin: 0 0 3px; color: #858585; font-size: 10px; font-weight: 750; letter-spacing: .15em; text-transform: uppercase; }
        .oria-business-name { margin: 0; font-size: 16px; font-weight: 720; letter-spacing: -.035em; line-height: 1.25; overflow-wrap: anywhere; }
        .oria-business-description { margin: 4px 0 0; color: #777; font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
        .oria-header-actions { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
        .oria-status { display: inline-flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid #e9e9e7; border-radius: 999px; color: #555; font-size: 11px; white-space: nowrap; }
        .oria-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #242424; box-shadow: 0 0 0 3px #ededeb; }
        .oria-icon-button { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #e9e9e7; border-radius: 50%; background: #fff; color: #555; cursor: pointer; transition: background .18s, transform .18s; }
        .oria-icon-button:hover { background: #f5f5f4; transform: translateY(-1px); }
        .oria-icon-button:disabled { cursor: wait; opacity: .45; }
        .oria-conversation { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; padding: clamp(28px, 5vh, 52px) clamp(20px, 5vw, 80px) 28px; scroll-behavior: smooth; }
        .oria-welcome-block { width: 100%; max-width: 760px; margin: 12px auto 32px; text-align: center; }
        .oria-welcome-mark { width: 42px; height: 42px; margin: 0 auto 16px; display: grid; place-items: center; border: 1px solid #e9e9e7; border-radius: 14px; background: #fff; }
        .oria-welcome-block h1 { margin: 0; font-size: clamp(22px, 4vw, 29px); font-weight: 720; letter-spacing: -.055em; }
        .oria-welcome-block p { margin: 10px auto 0; max-width: 470px; color: #777; font-size: 13px; line-height: 1.65; }
        .oria-welcome-note { display: inline-flex; align-items: center; gap: 7px; margin-top: 15px; color: #777; font-size: 11px; }
        .oria-suggestions { width: 100%; max-width: 1100px; display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; margin: 0 auto 34px; }
        .oria-suggestion { min-height: 36px; padding: 8px 13px; border: 1px solid #e8e8e6; border-radius: 999px; background: white; color: #4c4c4c; font-size: 11px; cursor: pointer; transition: all .18s; }
        .oria-suggestion:hover { border-color: #bdbdb9; background: #f8f8f7; color: #111; }
        .oria-messages { width: 100%; max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
        .oria-message-row { display: flex; align-items: flex-end; gap: 9px; animation: oria-appear .22s ease-out; }
        .oria-message-row.user { justify-content: flex-end; }
        .oria-mini-avatar { flex: 0 0 27px; width: 27px; height: 27px; display: grid; place-items: center; border-radius: 9px; background: #171717; color: white; font-size: 9px; font-weight: 750; }
        .oria-message-content { max-width: min(84%, 760px); min-width: 0; }
        .oria-message-meta { margin: 0 0 5px 2px; color: #888; font-size: 10px; }
        .oria-bubble { padding: 12px 15px; border-radius: 16px 16px 16px 5px; background: #f4f4f2; color: #292929; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
        .oria-message-row.user .oria-bubble { border-radius: 16px 16px 5px 16px; background: #171717; color: #fff; }
        .oria-message-row.user .oria-message-meta { text-align: right; margin-right: 2px; }
        .oria-typing { display: inline-flex; align-items: center; gap: 4px; min-width: 46px; padding: 15px; }
        .oria-typing span { width: 5px; height: 5px; background: #777; border-radius: 50%; animation: oria-pulse 1s infinite ease-in-out; }
        .oria-typing span:nth-child(2) { animation-delay: .15s; }
        .oria-typing span:nth-child(3) { animation-delay: .3s; }
        .oria-composer-wrap { flex-shrink: 0; padding: 15px clamp(20px, 5vw, 80px) 14px; border-top: 1px solid #e9e9e7; background: #fff; }
        .oria-composer { width: 100%; max-width: 1100px; margin: 0 auto; display: flex; align-items: flex-end; gap: 10px; padding: 8px 9px 8px 16px; border: 1px solid #dededb; border-radius: 17px; background: #fff; box-shadow: 0 3px 12px rgba(0,0,0,.025); transition: border-color .18s, box-shadow .18s; }
        .oria-composer:focus-within { border-color: #999; box-shadow: 0 0 0 3px rgba(0,0,0,.045); }
        .oria-composer textarea { flex: 1; min-width: 0; max-height: 130px; min-height: 27px; resize: none; border: 0; outline: 0; padding: 5px 0; color: #222; background: transparent; font-size: 16px; line-height: 1.45; }
        .oria-composer textarea::placeholder { color: #a0a09d; }
        .oria-send-button { flex: 0 0 38px; width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 12px; background: #171717; color: white; cursor: pointer; transition: background .18s, transform .18s; }
        .oria-send-button:hover { background: #393939; transform: translateY(-1px); }
        .oria-send-button:disabled { cursor: not-allowed; opacity: .35; transform: none; }
        .oria-composer-hint { width: 100%; max-width: 1100px; margin: 9px auto 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #999; font-size: 10px; }
        .oria-privacy { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .oria-error { width: calc(100% - 40px); max-width: 1100px; margin: 0 auto 12px; padding: 11px 14px; border: 1px solid #e7d8d8; border-radius: 12px; background: #fff8f8; color: #7b3535; font-size: 12px; line-height: 1.5; flex-shrink: 0; }
        .oria-footer { width: 100%; max-width: 1100px; margin: 0 auto; padding: 12px 20px max(14px, env(safe-area-inset-bottom)); text-align: center; color: #92928f; font-size: 10px; letter-spacing: .01em; flex-shrink: 0; }
        .oria-footer strong { color: #555; font-weight: 700; }
        .oria-footer a { color: inherit; text-decoration: none; }
        .oria-footer a:hover { color: #222; text-decoration: underline; }
        .oria-loading { flex: 1; min-height: 0; display: grid; place-items: center; gap: 10px; color: #777; font-size: 13px; }
        @keyframes oria-appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes oria-pulse { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
        @media (max-width: 640px) {
          .oria-app-shell { width: 100%; height: 100dvh; min-height: 100svh; padding: 0; }
          .oria-chat-card { width: 100%; height: 100dvh; min-height: 100svh; border: 0; border-radius: 0; box-shadow: none; }
          .oria-business-header { padding: 15px 16px; padding-top: max(15px, env(safe-area-inset-top)); gap: 8px; }
          .oria-avatar { width: 42px; height: 42px; flex-basis: 42px; border-radius: 14px; }
          .oria-business-name { font-size: 14px; }
          .oria-business-description { max-width: 190px; font-size: 11px; }
          .oria-status { padding: 7px 9px; font-size: 10px; }
          .oria-status-label { display: none; }
          .oria-header-actions { gap: 7px; }
          .oria-icon-button { width: 34px; height: 34px; }
          .oria-conversation { min-height: 0; padding: 24px 16px 18px; }
          .oria-welcome-block { margin-top: 8px; margin-bottom: 24px; }
          .oria-welcome-block h1 { font-size: 25px; }
          .oria-welcome-block p { font-size: 12px; }
          .oria-suggestions { gap: 7px; margin-bottom: 24px; }
          .oria-suggestion { min-height: 35px; padding: 8px 11px; font-size: 10px; }
          .oria-message-content { max-width: 90%; }
          .oria-bubble { padding: 11px 13px; font-size: 13px; }
          .oria-composer-wrap { padding: 11px 13px calc(10px + env(safe-area-inset-bottom)); }
          .oria-composer { border-radius: 16px; padding-left: 13px; }
          .oria-composer-hint { font-size: 9px; flex-wrap: wrap; }
          .oria-footer { padding: 10px 15px calc(13px + env(safe-area-inset-bottom)); }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        }
      `}</style>

      <div className="oria-app-shell">
        <main className="oria-chat-card" aria-label={`Conversation avec ${name}`}>
          <header className="oria-business-header">
            <div className="oria-business-identity">
              <div className="oria-avatar" aria-hidden="true">{initials}</div>
              <div className="oria-identity-copy">
                <p className="oria-eyebrow">Assistant officiel</p>
                <h2 className="oria-business-name">{name}</h2>
                <p className="oria-business-description">{description}</p>
              </div>
            </div>
            <div className="oria-header-actions">
              <div className="oria-status" aria-label="Assistant disponible">
                <span className="oria-status-dot" />
                <span className="oria-status-label">Assistant disponible</span>
              </div>
              <button className="oria-icon-button" type="button" onClick={() => void restartConversation()} disabled={!visitor || restarting || sending} aria-label="Recommencer la conversation" title="Recommencer">
                {restarting ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>
          </header>

          <section className="oria-conversation" ref={conversationRef} aria-live="polite">
            {loading ? (
              <div className="oria-loading"><LoaderCircle size={19} className="animate-spin" /> Chargement de l'assistant…</div>
            ) : error && !assistant ? (
              <div className="oria-welcome-block">
                <div className="oria-welcome-mark"><MessageCircle size={19} /></div>
                <h1>Assistant indisponible</h1>
                <p>{error}</p>
              </div>
            ) : assistant ? (
              <>
                {messages.length === 0 && (
                  <>
                    <div className="oria-welcome-block">
                      <div className="oria-welcome-mark"><ActivityIcon size={19} strokeWidth={1.7} /></div>
                      <h1>Bienvenue chez {assistant.name}</h1>
                      <p>{assistant.description || `Je suis l'assistant officiel de ${assistant.name}. Posez-moi votre question concernant ses services.`}</p>
                      <div className="oria-welcome-note"><Check size={13} /> Réponses basées sur les informations de l'entreprise</div>
                    </div>
                    <div className="oria-suggestions" aria-label="Questions suggérées">
                      {suggestions.map((question) => (
                        <button key={question} className="oria-suggestion" type="button" onClick={() => void sendMessage(question)} disabled={!visitor || sending}>{question}</button>
                      ))}
                    </div>
                  </>
                )}
                <div className="oria-messages">
                  {messages.length === 0 && (
                    <div className="oria-message-row">
                      <div className="oria-mini-avatar" aria-hidden="true">{initials}</div>
                      <div className="oria-message-content">
                        <div className="oria-message-meta">{assistant.name} · à l'instant</div>
                        <div className="oria-bubble">{assistant.welcome_message}</div>
                      </div>
                    </div>
                  )}
                  {messages.map((message) => (
                    <div key={message.id} className={`oria-message-row ${message.role === "user" ? "user" : ""}`}>
                      {message.role !== "user" && <div className="oria-mini-avatar" aria-hidden="true">{initials}</div>}
                      <div className="oria-message-content">
                        <div className="oria-message-meta">{message.role === "user" ? "Vous · à l'instant" : `${assistant.name} · à l'instant`}</div>
                        <div className="oria-bubble">{message.content}</div>
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="oria-message-row" aria-label="Réponse en cours">
                      <div className="oria-mini-avatar" aria-hidden="true">{initials}</div>
                      <div className="oria-message-content">
                        <div className="oria-message-meta">{assistant.name} · rédaction en cours</div>
                        <div className="oria-bubble oria-typing"><span /><span /><span /></div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </>
            ) : null}
          </section>

          {assistant && (
            <>
              {error && <div className="oria-error" role="alert">{error}</div>}
              <div className="oria-composer-wrap">
                <form className="oria-composer" onSubmit={submit}>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      event.currentTarget.style.height = "auto";
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 130)}px`;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    maxLength={8000}
                    aria-label="Votre message"
                    placeholder="Écrivez votre message..."
                    disabled={!visitor || sending}
                  />
                  <button className="oria-send-button" type="submit" aria-label="Envoyer le message" disabled={!draft.trim() || !visitor || sending}>
                    {sending ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowUp size={17} />}
                  </button>
                </form>
                <div className="oria-composer-hint">
                  <span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span>
                  <span className="oria-privacy"><LockKeyhole size={11} /> Session temporaire</span>
                </div>
              </div>
              <footer className="oria-footer">
                Une assistance automatisée, fournie par <strong>ORIA</strong> · <strong>Une IA née au Gabon pour l'Afrique</strong>
                <br />
                <a href="https://www.myoriaai.com" target="_blank" rel="noopener noreferrer">Découvrir ORIA ↗</a>
              </footer>
            </>
          )}
        </main>
      </div>
    </main>
  );
}
