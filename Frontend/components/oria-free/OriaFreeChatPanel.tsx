"use client";

import Link from "next/link";
import OriaFreeRechargeStatus from "./OriaFreeRechargeStatus";
import OriaFreeOfferNotifications from "./OriaFreeOfferNotifications";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, FileText, Globe2, Loader2, MessageSquareText, RefreshCw, Wallet } from "lucide-react";

type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;
type Mode = "chat" | "web" | "pdf" | "docx";
type Reasoning = "fast" | "balanced";
type WalletSnapshot = {balance: number; free_credits: number; purchased_credits: number};
type FreeStatus = {success: boolean; daily_credits: number; paid_pack_active: boolean; wallet: WalletSnapshot};
type FreeCatalog = {chat?: {wired?: boolean}; web?: {wired?: boolean}; documents?: {wired?: boolean; target_formats?: string[]}};
type Capabilities = {success: boolean; catalog: FreeCatalog};
type Quote = {reserved_credits: number; can_reserve_by_balance: boolean; reason?: string | null; wallet?: WalletSnapshot; provider: string; web?: boolean; format?: string; two_sites_guaranteed?: boolean};
type FreeResponse = {success: boolean; message?: string; cost?: number; credits_remaining?: number; requires_reconciliation?: boolean; artifacts?: Array<{filename?: string; download_url?: string; url?: string}>};
type FreeTurn = {id: string; role: "user" | "assistant"; content: string; artifacts?: FreeResponse["artifacts"]};

const MODES: Array<{id: Mode; label: string; icon: typeof MessageSquareText}> = [
  {id: "chat", label: "Chat", icon: MessageSquareText},
  {id: "web", label: "Recherche Web", icon: Globe2},
  {id: "pdf", label: "PDF", icon: FileText},
  {id: "docx", label: "Word", icon: FileText},
];

function downloadHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  return /^https:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null;
}

export default function OriaFreeChatPanel({apiFetch}: {apiFetch: ApiFetch}) {
  const [status, setStatus] = useState<FreeStatus | null>(null);
  const [catalog, setCatalog] = useState<FreeCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const [reasoning, setReasoning] = useState<Reasoning>("balanced");
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteFor, setQuoteFor] = useState("");
  const [cvPrepared, setCvPrepared] = useState(false);
  const [turns, setTurns] = useState<FreeTurn[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const result = await apiFetch<FreeStatus>("/ai/free/status");
      if (!result.success || result.paid_pack_active || !result.wallet) throw new Error("Le serveur ne permet pas ce parcours gratuit pour ce compte.");
      setStatus(result);
      setBlocked(null);
    } catch (exc) {
      setStatus(null);
      setBlocked(exc instanceof Error ? exc.message : "Accès gratuit indisponible.");
    }
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const [s, c] = await Promise.all([
          apiFetch<FreeStatus>("/ai/free/status"),
          apiFetch<Capabilities>("/ai/free/capabilities"),
        ]);
        if (cancelled) return;
        if (!s.success || s.paid_pack_active || !s.wallet || !c.success || c.catalog?.chat?.wired !== true) {
          throw new Error("Le chat gratuit n'est pas autorisé pour ce compte.");
        }
        setStatus(s);
        setCatalog(c.catalog);
        setBlocked(null);
      } catch (exc) {
        if (!cancelled) setBlocked(exc instanceof Error ? exc.message : "Accès gratuit en préparation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void boot();
    return () => {cancelled = true;};
  }, [apiFetch]);

  const availableModes = useMemo(() => MODES.filter(({id}) =>
    id === "chat" ? catalog?.chat?.wired === true :
    id === "web" ? catalog?.web?.wired === true :
    catalog?.documents?.wired === true && (catalog?.documents?.target_formats ?? []).includes(id)
  ), [catalog]);

  const fingerprint = JSON.stringify({mode, reasoning, message: draft.trim()});
  const canSubmit = Boolean(status && !blocked && draft.trim().length > 0 && draft.trim().length <= 12000 && !busy);

  function setDraftSafely(text: string) {setDraft(text); setCvPrepared(false); setQuote(null); setQuoteFor(""); setError(null);}
  function selectMode(next: Mode) {setMode(next); setCvPrepared(false); setQuote(null); setQuoteFor(""); setError(null);}
  function selectReasoning(next: Reasoning) {setReasoning(next); setQuote(null); setQuoteFor(""); setError(null);}

  async function requestQuote() {
    if (!canSubmit || !availableModes.some((item) => item.id === mode)) return;
    setBusy(true); setError(null); setQuote(null);
    try {
      // CV is a conversation first: ask for missing fields at zero API cost.
      // The free document endpoint is called only after a complete profile
      // and an explicit quote/confirmation.
      const continuingCV = turns.some((item) => item.role === "assistant" &&
        (item.content.startsWith("Bien sûr ! Je peux te préparer un CV") ||
         item.content.startsWith("Pour finaliser ton CV")));
      if (!cvPrepared && (mode === "chat" || /\b(?:cv|curriculum vitae)\b/i.test(draft) || continuingCV)) {
        const plan = await apiFetch<{
          success: boolean; is_cv: boolean; ready?: boolean;
          question?: string | null; style?: string; format?: "pdf" | "docx";
          profile_text?: string | null;
        }>("/ai/free/cv/plan", {method: "POST", body: JSON.stringify({
          message: draft.trim(),
          history: turns.map((item) => ({role: item.role, content: item.content})).slice(-22),
          explicit_type: mode === "pdf" || mode === "docx" ? mode : null,
        })});
        if (!plan.success) throw new Error("Plan CV incomplet.");
        if (plan.is_cv) {
          if (!plan.ready) {
            setTurns((prev) => [...prev,
              {id: crypto.randomUUID(), role: "user", content: draft.trim()},
              {id: crypto.randomUUID(), role: "assistant", content: plan.question || "Complète les informations de ton CV."},
            ]);
            setDraft(""); setQuoteFor("");
            return;
          }
          if (!plan.profile_text || !["pdf", "docx"].includes(plan.format || "")) {
            throw new Error("Données CV insuffisantes pour créer le document.");
          }
          const finalFormat = plan.format!;
          // Only facts supplied by the user; the model is instructed not to invent.
          const cvText = `Crée mon CV ${plan.style || "moderne"} en ${finalFormat}.\nInformations utilisateur :\n${plan.profile_text}`;
          setMode(finalFormat);
          setCvPrepared(true);
          setDraft(cvText.slice(0, 12000));
          setQuoteFor("");
          setError("Tes informations CV sont prêtes. Vérifie le texte, puis clique sur « Calculer le devis » et confirme la génération.");
          return;
        }
      }
      const isDoc = mode === "pdf" || mode === "docx";
      const endpoint = isDoc ? "/ai/free/document/quote" : "/ai/free/quote";
      const body = isDoc
        ? {message: draft.trim(), format: mode, reasoning_mode: reasoning}
        : {message: draft.trim(), model: "luna", reasoning_mode: reasoning, web: mode === "web"};
      const result = await apiFetch<{success: boolean; quote: Quote}>(endpoint, {method: "POST", body: JSON.stringify(body)});
      if (!result.success || typeof result.quote?.reserved_credits !== "number") throw new Error("Devis incomplet reçu du serveur.");
      setQuote(result.quote);
      setQuoteFor(fingerprint);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Impossible d'établir le devis.");
    } finally {setBusy(false);}
  }

  async function confirmSend() {
    if (!canSubmit || !quote || quoteFor !== fingerprint || !quote.can_reserve_by_balance) return;
    const text = draft.trim();
    const target: Mode = mode;
    setBusy(true); setError(null);
    try {
      const isDoc = target === "pdf" || target === "docx";
      const endpoint = isDoc ? "/ai/free/document" : "/ai/free/chat";
      const body = isDoc
        ? {message: text, format: target, reasoning_mode: reasoning, confirmed: true}
        : {message: text, model: "luna", reasoning_mode: reasoning, web: target === "web"};
      const answer = await apiFetch<FreeResponse>(endpoint, {method: "POST", body: JSON.stringify(body)});
      if (!answer.success) throw new Error("Réponse incomplète du serveur.");
      const items: FreeTurn[] = [
        {id: crypto.randomUUID(), role: "user", content: text},
        {id: crypto.randomUUID(), role: "assistant", content: answer.message || (isDoc ? "Document créé. Consulte le lien ci-dessous." : "Réponse reçue."), artifacts: answer.artifacts},
      ];
      setTurns((prev) => [...prev, ...items]);
      setDraft(""); setQuote(null); setQuoteFor("");
      if (answer.requires_reconciliation) setError("Une opération de rapprochement des crédits est en cours.");
      // Solde toujours relu sur le serveur, jamais calculé côté navigateur.
      await loadStatus();
    } catch (exc) {
      // Ne pas réessayer automatiquement un POST potentiellement facturé.
      setQuote(null); setQuoteFor("");
      setError((exc instanceof Error ? exc.message : "Envoi impossible.") + " Ne relance pas automatiquement si une réservation a pu être créée.");
    } finally {setBusy(false);}
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <OriaFreeOfferNotifications status={status} enabled={Boolean(status && catalog && !blocked)} onRefresh={loadStatus} />
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="text-xl font-black tracking-tight">ORIA<span className="text-muted">.</span></Link>
          <div className="flex items-center gap-3 text-xs sm:text-sm"><span className="font-semibold">GPT-6 Luna · Accès gratuit</span><Link href="/packs" className="rounded-full border border-border px-3 py-2 font-semibold hover:bg-surface-secondary">Les packs <ArrowUpRight size={14} className="inline" /></Link></div>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-7 sm:py-10">
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-widest text-muted">ORIA GRATUIT · QUOTA QUOTIDIEN</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{status?.daily_credits ?? 90} crédits ORIA par jour</h1><p className="mt-2 text-sm text-muted">Le serveur décide du solde, des droits et du coût de chaque action. Les crédits gratuits ne se substituent pas à ceux d'un pack payant.</p></div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3"><Wallet size={20} /><div><p className="text-xs text-muted">Crédits disponibles</p><p className="text-xl font-bold tabular-nums">{status?.wallet.balance ?? "—"}</p></div><button type="button" onClick={() => void loadStatus()} className="rounded-lg p-2 hover:bg-surface" aria-label="Actualiser le solde" title="Actualiser le solde"><RefreshCw size={16}/></button></div>
          </div>
        </div>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" /> Vérification de l’accès gratuit…</p> : null}
        {blocked ? <div role="alert" className="rounded-xl border border-border bg-surface-secondary p-5"><strong>Accès gratuit non activé sur ce serveur.</strong><p className="mt-2 text-sm">{blocked}</p><p className="mt-2 text-sm text-muted">Aucun appel IA payant n'a été lancé depuis cette interface. Tu peux consulter les packs ou revenir plus tard.</p><Link className="mt-3 inline-block text-sm font-semibold underline" href="/packs">Voir les packs</Link></div> : null}
        {status && catalog && !blocked ? <>
          <section aria-label="Conversation gratuite" className="space-y-3">
            {turns.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">Pose une question à Luna ou choisis un format de document. Chaque requête gratuite est indépendante pour le moment ; le suivi d'une conversation complète n'est pas encore intégré à cette route.</div> : null}
            {turns.map((turn) => <article key={turn.id} className={`rounded-2xl border border-border p-4 ${turn.role === "user" ? "ml-4 bg-surface-secondary" : "mr-4 bg-surface"}`}><p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{turn.role === "user" ? "Toi" : "ORIA · Luna"}</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.content}</p>{turn.artifacts?.map((item, idx) => {const href = downloadHref(item.download_url || item.url); return <p className="mt-3 text-sm" key={`${turn.id}-${idx}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Télécharger {item.filename || "le document"}</a> : <span>{item.filename || "Document créé"} — lien indisponible</span>}</p>;})}</article>)}
          </section>
          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6" aria-label="Nouvelle demande">
            <div className="flex flex-wrap gap-2">{availableModes.map((item) => {const Icon = item.icon; return <button key={item.id} type="button" onClick={() => selectMode(item.id)} disabled={busy} aria-pressed={mode === item.id} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${mode === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:bg-surface-secondary"}`}><Icon size={15}/>{item.label}</button>;})}</div>
            <div className="mt-4 flex items-center gap-3 text-xs"><label htmlFor="oria-free-reasoning" className="font-semibold">Raisonnement</label><select id="oria-free-reasoning" className="rounded-lg border border-border bg-background px-3 py-2" disabled={busy} value={reasoning} onChange={(e) => selectReasoning(e.target.value as Reasoning)}><option value="fast">Rapide</option><option value="balanced">Équilibré</option></select></div>
            <label htmlFor="oria-free-message" className="mt-4 block text-sm font-semibold">Ta demande</label>
            <textarea id="oria-free-message" rows={5} maxLength={12000} value={draft} disabled={busy} onChange={(e) => setDraftSafely(e.target.value)} placeholder="Écris ici ce que tu souhaites demander à ORIA…" className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-foreground" />
            <p className="mt-1 text-xs text-muted">{draft.length}/12000 caractères · Pas de fichiers joints ni de streaming sur cette route gratuite.</p>
            {mode === "web" && <p className="mt-2 text-xs text-muted">La recherche Web est bornée côté serveur. Sur OpenAI, la limite d'une recherche-outil ne garantit pas deux sites consultés.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!canSubmit} onClick={() => void requestQuote()} className="rounded-xl bg-foreground px-5 py-3 text-sm font-bold text-background disabled:opacity-40">{busy ? "Traitement…" : "Calculer le devis"}</button><span className="text-xs text-muted">Le devis ne débite aucun crédit.</span></div>
            {quote && quoteFor === fingerprint ? <div className="mt-4 rounded-xl border border-border bg-surface-secondary p-4" role="status"><p className="font-bold">Réservation maximale : {quote.reserved_credits} crédits</p><p className="mt-1 text-xs text-muted">Coût réel calculé par le serveur après usage. Solde actuel : {quote.wallet?.balance ?? status.wallet.balance} crédits.</p>{quote.can_reserve_by_balance ? <button type="button" disabled={busy} onClick={() => void confirmSend()} className="mt-3 rounded-xl bg-foreground px-5 py-3 text-sm font-bold text-background disabled:opacity-40">{busy ? "En cours…" : "Confirmer et lancer"}</button> : <p className="mt-2 text-sm">Solde insuffisant ou action trop coûteuse. <Link href="/packs" className="font-semibold underline">Découvrir les packs</Link></p>}</div> : null}
            {error ? <p role="alert" className="mt-4 rounded-xl border border-border p-3 text-sm">{error}</p> : null}
          </section>
        </> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <span className="flex-1">Besoin de plus de crédits ? Les recharges restent disponibles sans acheter de pack, selon les permissions du serveur.</span>
          <Link href="/packs?recharge=standard" className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background">Voir les recharges</Link>
        </div>
        <OriaFreeRechargeStatus />
        <p className="text-xs text-muted">ORIA Gratuit est une fonctionnalité en staging. Les permissions réelles, les débits et les limites sont exclusivement contrôlés par le Backend et Supabase.</p>
      </div>
    </main>
  );
}
