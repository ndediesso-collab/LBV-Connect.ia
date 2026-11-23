"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import Link from "next/link";
import {
  Archive, ArchiveRestore, ArrowLeft, CirclePlus, LockKeyhole, MessageSquare,
  RefreshCcw, Send, ShieldCheck, Users, UserPlus, UserMinus,
} from "lucide-react";
import { collabRequest, profileLabel } from "@/lib/collaboratif-api";
import type { Profile, TeamData } from "@/lib/collaboratif-api";

type Group = {
  id: string;
  title: string;
  description: string;
  archived: boolean;
  message_count: number;
  message_limit: number;
  pending_ai_slots: number;
  allow_unequal_ai_split: boolean;
  participants: string[];
  updated_at: string;
};
type GroupList = { success: boolean; is_owner: boolean; workspace_id: string; groups: Group[] };
type ChatMessage = { id: string; sender_user_id: string | null; sender_kind?: "member" | "oria"; content: string; created_at: string };
type Page = { success: boolean; group_id: string; messages: ChatMessage[]; message_count: number; message_limit: number };
type CreateResponse = { success: boolean; group_id: string };
type Pending = { group: string; content: string; requestId: string };
type GroupAIModels = { success: boolean; models: string[] };
type GroupAIStatus = { success: boolean; request_id: string; group_id: string; state: string; response: string | null; cost: number | null };
type ExtensionOrder = { reference: string; state: "pending" | "granted"; created_at: string; granted_at: string | null; granted_messages: number };
type ExtensionStatus = { success: boolean; orders: ExtensionOrder[]; message_limit: number };
type ExtensionCheckout = { success: boolean; checkout_url: string; reference: string };
const oriaMention = /(^|[^\w])@oria(?!\w)/i;

const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-foreground/20";
const primary = "rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-45";
const secondary = "rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-45";
const date = (iso: string) => new Date(iso).toLocaleString("fr-GA", { dateStyle: "short", timeStyle: "short" });
const number = (n: number) => new Intl.NumberFormat("fr-GA").format(n);

function mergeMessages(old: ChatMessage[], fresh: ChatMessage[]): ChatMessage[] {
  const entries = new Map<string, ChatMessage>();
  [...old, ...fresh].forEach((m) => entries.set(m.id, m));
  return [...entries.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export default function GroupesCollaboratifPage() {
  const [listing, setListing] = useState<GroupList | null>(null);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [currentId, setCurrentId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderAvailable, setOlderAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState("");
  const [memberToAdd, setMemberToAdd] = useState("");
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiModel, setAiModel] = useState("");
  const [aiMode, setAiMode] = useState("balanced");
  const [extensionEmail, setExtensionEmail] = useState("");
  const [extensionEnabled, setExtensionEnabled] = useState(false);
  const [extensionOrders, setExtensionOrders] = useState<ExtensionOrder[]>([]);
  const pending = useRef<Pending | null>(null);
  const selectedIdRef = useRef("");

  const refreshGroups = useCallback(async () => {
    const response = await collabRequest<GroupList>("/collaboratif/groups");
    setListing(response);
    setCurrentId((previous) => {
      const next = previous && response.groups.some((g) => g.id === previous)
        ? previous : (response.groups[0]?.id ?? "");
      selectedIdRef.current = next;
      return next;
    });
  }, []);

  const fetchMessages = useCallback(async (groupId: string, older = false, cursor?: string) => {
    if (!groupId) return;
    const params = new URLSearchParams({ limit: "50" });
    if (older && cursor) params.set("before", cursor);
    const response = await collabRequest<Page>(
      `/collaboratif/groups/${groupId}/messages?${params.toString()}`,
    );
    if (selectedIdRef.current !== groupId) return;
    setMessages((existing) => mergeMessages(older ? response.messages : existing, response.messages));
    if (older) setOlderAvailable(response.messages.length === 50);
    else if (!cursor && response.messages.length === 50) setOlderAvailable(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initial() {
      try {
        const [groups, profiles] = await Promise.all([
          collabRequest<GroupList>("/collaboratif/groups"),
          collabRequest<TeamData>("/collaboratif/profiles"),
        ]);
        if (cancelled) return;
        setListing(groups); setTeam(profiles);
        // The feature is disabled unless the backend explicitly lists models.
        try {
          const available = await collabRequest<GroupAIModels>("/collaboratif/groups/ai/models");
          if (!cancelled) {
            setAiModels(available.models);
            setAiModel((prev) => available.models.includes(prev) ? prev : (available.models[0] || ""));
          }
        } catch { if (!cancelled) setAiModels([]); }
        if (groups.groups.length > 0) {
          const first = groups.groups[0].id;
          selectedIdRef.current = first;
          setCurrentId(first);
        }
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "Salons indisponibles.");
      } finally { if (!cancelled) setLoading(false); }
    }
    void initial();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentId) return;
    setMessages([]); setOlderAvailable(false);
    void fetchMessages(currentId).catch((exc) => setError(exc instanceof Error ? exc.message : "Historique indisponible."));
  }, [currentId, fetchMessages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshGroups().catch(() => {});
      if (selectedIdRef.current) void fetchMessages(selectedIdRef.current).catch(() => {});
    }, 12000);
    return () => window.clearInterval(timer);
  }, [refreshGroups, fetchMessages]);

  const group = useMemo(() => listing?.groups.find((g) => g.id === currentId), [listing, currentId]);
  const isOwner = listing?.is_owner === true;
  const names = useMemo(() => new Map((team?.profiles ?? []).map((p) => [p.user_id, profileLabel(p)])), [team]);
  const active = (team?.profiles ?? []).filter((p) => p.status === "active");
  const candidates = active.filter((p) => p.role !== "owner" && !group?.participants.includes(p.user_id));
  const remaining = group ? Math.max(0, group.message_limit - group.message_count - (group.pending_ai_slots || 0)) : 0;
  useEffect(() => {
    if (!isOwner || !currentId) { setExtensionEnabled(false); setExtensionOrders([]); return; }
    let cancelled = false;
    void collabRequest<ExtensionStatus>(`/collaboratif/groups/${currentId}/message-extensions`)
      .then((result) => { if (!cancelled) { setExtensionEnabled(true); setExtensionOrders(result.orders); } })
      .catch(() => { if (!cancelled) { setExtensionEnabled(false); setExtensionOrders([]); } });
    return () => { cancelled = true; };
  }, [isOwner, currentId]);

  async function buyMessageExtension() {
    if (!group || !isOwner || !extensionEnabled || busy) return;
    if (!window.confirm("Acheter 5 000 messages pour 3 000 FCFA dans ce salon ?")) return;
    setBusy(true); setError("");
    try {
      const result = await collabRequest<ExtensionCheckout>(
        `/collaboratif/groups/${group.id}/message-extensions/checkout`, "POST",
        { billing_email: extensionEmail.trim() },
      );
      // Checkout = pending : un retour navigateur ne vaut jamais paiement.
      const destination = new URL(result.checkout_url);
      if (destination.protocol !== "https:") throw new Error("Lien de paiement invalide.");
      window.location.assign(destination.toString());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Paiement indisponible.");
      setBusy(false);
    }
  }

  async function refreshExtensions() {
    if (!group || !isOwner || !extensionEnabled || busy) return;
    await execute(async () => {
      const latest = await collabRequest<ExtensionStatus>(`/collaboratif/groups/${group.id}/message-extensions`);
      setExtensionOrders(latest.orders);
      setNotice("Achats vérifiés côté serveur. Un paiement en attente n’ajoute pas de messages.");
    });
  }

  function chooseGroup(id: string) {
    selectedIdRef.current = id;
    pending.current = null;
    setDraft(""); setError(""); setNotice(""); setCurrentId(id);
  }

  async function execute(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refreshGroups(); }
    catch (exc) { setError(exc instanceof Error ? exc.message : "Opération indisponible."); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    await execute(async () => {
      const result = await collabRequest<CreateResponse>("/collaboratif/groups", "POST", { title, description });
      setTitle(""); setDescription("");
      chooseGroup(result.group_id);
      setNotice("Salon créé. Ajoutez les collaborateurs autorisés.");
    });
  }

  async function changeMember(userId: string, added: boolean) {
    if (!group || busy) return;
    await execute(async () => {
      await collabRequest(`/collaboratif/groups/${group.id}/participants`, "POST", {
        member_user_id: userId, added,
      });
      setMemberToAdd("");
      setNotice(added ? "Participant ajouté." : "Participant retiré.");
    });
  }

  async function archive() {
    if (!group || busy) return;
    if (!window.confirm(group.archived ? "Réouvrir ce salon ?" : "Archiver ce salon ? Les messages seront conservés.")) return;
    await execute(async () => {
      await collabRequest(`/collaboratif/groups/${group.id}/archive`, "PATCH", { archived: !group.archived });
      setNotice(group.archived ? "Salon réouvert." : "Salon archivé.");
    });
  }

  async function changeAiPolicy(enabled: boolean) {
    if (!group || busy || !isOwner) return;
    await execute(async () => {
      await collabRequest(`/collaboratif/groups/${group.id}/ai/policy`, "PATCH", { allow_unequal: enabled });
      setNotice(enabled ? "Répartition inégale autorisée dans ce salon." : "Répartition égale obligatoire.");
    });
  }

  async function inspectPending() {
    const attempt = pending.current;
    if (!attempt || !oriaMention.test(attempt.content)) return;
    setBusy(true); setError("");
    try {
      const response = await collabRequest<GroupAIStatus>(`/collaboratif/groups/ai/jobs/${attempt.requestId}`);
      if (response.state === "settled") {
        pending.current = null; setDraft("");
        setNotice(`Réponse ORIA enregistrée : ${number(response.cost || 0)} crédits partagés.`);
        await Promise.all([refreshGroups(), fetchMessages(attempt.group)]);
      } else {
        setError("La génération est toujours en attente de rapprochement. Aucun nouvel appel IA n'a été lancé.");
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Vérification de génération indisponible.");
    } finally { setBusy(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group || busy || group.archived || remaining <= 0 || !draft.trim()) return;
    const content = draft.trim();
    const isAI = oriaMention.test(content);
    if (isAI && !aiModel) {
      setError("@ORIA n'est pas activé sur cet environnement : aucun appel ni débit.");
      return;
    }
    if (isAI && remaining < 2) {
      setError("Deux messages disponibles sont nécessaires pour la demande et la réponse @ORIA.");
      return;
    }
    const requestId = pending.current?.group === group.id && pending.current.content === content
      ? pending.current.requestId : crypto.randomUUID();
    pending.current = { group: group.id, content, requestId };
    setBusy(true); setError(""); setNotice("");
    try {
      if (isAI) {
        const response = await collabRequest<{ success: boolean; message: string; cost: number }>(
          `/collaboratif/groups/${group.id}/ai/ask`, "POST", {
            request_id: requestId, model: aiModel, prompt: content, reasoning_mode: aiMode,
          });
        setNotice(`ORIA a répondu dans le groupe. Coût collectif : ${number(response.cost)} crédits.`);
      } else {
        await collabRequest(`/collaboratif/groups/${group.id}/messages`, "POST", {
          client_message_id: requestId, content,
        });
      }
      pending.current = null; setDraft("");
      await Promise.all([refreshGroups(), fetchMessages(group.id)]);
    } catch (exc) {
      setError(isAI
        ? `${exc instanceof Error ? exc.message : "Génération indisponible."} Vérifiez d'abord l'état de cet appel : ne relancez pas le fournisseur.`
        : `${exc instanceof Error ? exc.message : "Envoi impossible."} Réessayez sans changer le texte pour éviter un doublon.`);
    } finally { setBusy(false); }
  }

  async function loadOlder() {
    if (!group || !messages.length || busy) return;
    setBusy(true); setError("");
    try { await fetchMessages(group.id, true, messages[0].id); }
    catch (exc) { setError(exc instanceof Error ? exc.message : "Historique ancien indisponible."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-7">
      <div className="mx-auto max-w-6xl">
        <Link href="/collaboratif/profils" className="mb-5 inline-flex items-center gap-2 text-sm underline">
          <ArrowLeft size={16} /> Retour aux profils
        </Link>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Espaces de groupe</h1>
            <Link href="/collaboratif/supervision" className="mt-1 inline-block text-xs underline underline-offset-4">Supervision et alertes de capacité</Link>
            <p className="mt-1 text-sm text-muted">Discussions professionnelles entre profils de votre équipe.</p></div>
          <button type="button" className={secondary} onClick={() => void execute(async () => { await refreshGroups(); if (group) await fetchMessages(group.id); })} disabled={busy}>
            <RefreshCcw size={16} className="mr-2 inline" /> Actualiser
          </button>
        </div>
        <div className="mb-5 rounded-xl border border-border p-3 text-xs text-muted">
          <ShieldCheck className="mr-2 inline" size={15} /> L'administrateur peut consulter les messages professionnels.
          Les messages professionnels peuvent être consultés par l'administrateur.
          Les mentions <strong>@ORIA</strong> partagent le coût mesuré entre les participants actifs du salon,
          sur leurs quotas professionnels uniquement. L'extension Chariow de 5 000 messages (3 000 FCFA) est attribuée uniquement après confirmation du paiement signé.
        </div>
        {error && <div role="alert" className="mb-4 rounded-xl border border-border p-3 text-sm">{error}</div>}
        {notice && <div role="status" className="mb-4 rounded-xl border border-border p-3 text-sm">{notice}</div>}
        {loading ? <p className="text-sm text-muted">Chargement des groupes…</p> : !listing ? (
          <p className="rounded-xl border border-border p-6 text-sm">Aucun espace de groupe accessible. Vérifiez votre pack et votre connexion.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section className="rounded-2xl border border-border p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users size={17} /> Salons ({listing.groups.length})</h2>
                <div className="max-h-[430px] space-y-2 overflow-y-auto">
                  {listing.groups.length === 0 && <p className="text-sm text-muted">Aucun salon pour le moment.</p>}
                  {listing.groups.map((item) => (
                    <button key={item.id} type="button" onClick={() => chooseGroup(item.id)}
                      className={`w-full rounded-xl border p-3 text-left text-sm ${currentId === item.id ? "border-foreground" : "border-border"}`}>
                      <div className="flex justify-between gap-2 font-semibold"><span className="truncate">{item.title}</span>
                        {item.archived && <Archive size={14} className="shrink-0" />}</div>
                      <div className="mt-1 text-xs text-muted">{number(item.message_count)} / {number(item.message_limit)} messages</div>
                      <div className="mt-1 text-xs text-muted">{item.participants.length} participant(s)</div>
                    </button>
                  ))}
                </div>
              </section>
              {isOwner && <section className="rounded-2xl border border-border p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CirclePlus size={17} /> Nouveau salon</h2>
                <form onSubmit={(event: FormEvent<HTMLFormElement>) => void create(event)} className="space-y-3">
                  <label className="block text-xs">Nom du salon
                    <input className={`mt-1 ${input}`} maxLength={100} required value={title} onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Équipe marketing" /></label>
                  <label className="block text-xs">Description (facultative)
                    <textarea className={`mt-1 ${input}`} maxLength={500} rows={2} value={description} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} /></label>
                  <button type="submit" className={primary} disabled={busy || !title.trim()}>Créer le salon</button>
                </form>
              </section>}
            </aside>
            <section className="min-w-0 rounded-2xl border border-border">
              {!group ? <div className="flex min-h-[350px] items-center justify-center p-6 text-center text-sm text-muted">
                <div><MessageSquare className="mx-auto mb-3" size={28} /> Sélectionnez un salon pour consulter ses messages.</div>
              </div> : <>
                <header className="border-b border-border p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="font-semibold">{group.title}</h2>
                      {group.description && <p className="mt-1 text-xs text-muted">{group.description}</p>}
                      <p className="mt-2 text-xs text-muted">{number(remaining)} message(s) restant(s) · limite {number(group.message_limit)}
                        {group.archived ? " · Salon archivé" : ""}</p></div>
                    {isOwner && <button className={secondary} type="button" disabled={busy} onClick={() => void archive()}>
                      {group.archived ? <ArchiveRestore size={15} className="mr-2 inline" /> : <Archive size={15} className="mr-2 inline" />}
                      {group.archived ? "Réouvrir" : "Archiver"}</button>}
                  </div>
                    {isOwner && aiModels.length > 0 && <div className="mt-4 border-t border-border pt-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={group.allow_unequal_ai_split || false} disabled={busy}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => void changeAiPolicy(e.target.checked)} />
                        Autoriser une répartition inégale si un participant manque de crédits
                      </label>
                    </div>}
                  {isOwner && extensionEnabled && <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <h3 className="text-sm font-semibold">+5 000 messages · 3 000 FCFA</h3>
                    <p className="text-xs text-muted">Paiement Chariow lié à ce salon. Crédit de messages uniquement après confirmation du webhook signé.</p>
                    <label className="block text-xs">E-mail du reçu
                      <input type="email" className={`mt-1 ${input}`} maxLength={254} value={extensionEmail}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setExtensionEmail(e.target.value)} placeholder="contact@exemple.com" /></label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={primary} disabled={busy || !extensionEmail.includes("@")}
                        onClick={() => void buyMessageExtension()}>Acheter 5 000 messages</button>
                      <button type="button" className={secondary} disabled={busy}
                        onClick={() => void refreshExtensions()}>Vérifier mes achats</button>
                    </div>
                    {extensionOrders.slice(0, 5).map((order) => <p key={order.reference} className="text-xs text-muted">
                      {order.reference} · {order.state === "granted" ? "+5 000 messages attribués" : "Paiement en attente"}
                    </p>)}
                  </div>}
                  {isOwner && <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-xs font-semibold">Participants</h3>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {group.participants.map((uid) => {
                        const owner = active.some((p) => p.user_id === uid && p.role === "owner");
                        return <div key={uid} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
                          <span>{names.get(uid) || "Profil indisponible"}</span>
                          {!owner && <button aria-label={`Retirer ${names.get(uid) || "ce profil"}`} type="button" disabled={busy}
                            onClick={() => void changeMember(uid, false)}><UserMinus size={14} /></button>}
                        </div>;
                      })}
                    </div>
                    {candidates.length > 0 && <div className="flex flex-wrap items-center gap-2">
                      <select className={`max-w-[260px] ${input}`} value={memberToAdd} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMemberToAdd(e.target.value)}>
                        <option value="">Ajouter un profil actif…</option>
                        {candidates.map((p) => <option key={p.user_id} value={p.user_id}>{profileLabel(p)}</option>)}
                      </select>
                      <button type="button" className={secondary} disabled={!memberToAdd || busy}
                        onClick={() => void changeMember(memberToAdd, true)}><UserPlus size={15} className="mr-2 inline" /> Ajouter</button>
                    </div>}
                  </div>}
                </header>
                <div className="h-[390px] space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite">
                  {olderAvailable && messages.length > 0 && <div className="text-center">
                    <button className="text-xs underline disabled:opacity-40" type="button" onClick={() => void loadOlder()} disabled={busy}>
                      Charger les messages précédents
                    </button>
                  </div>}
                  {messages.length === 0 && <p className="py-16 text-center text-sm text-muted">Aucun message dans ce salon.</p>}
                  {messages.map((message) => <div key={message.id} className="rounded-xl border border-border p-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">{message.sender_kind === "oria" ? "@ORIA · Assistant collectif" : (names.get(message.sender_user_id || "") || "Ancien collaborateur")}</span>
                      <span className="text-muted">{date(message.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                  </div>)}
                </div>
                <form onSubmit={(event: FormEvent<HTMLFormElement>) => void send(event)} className="border-t border-border p-4 sm:p-5">
                  <label htmlFor="group-message" className="mb-2 block text-xs font-medium">Écrire au groupe</label>
                  <textarea id="group-message" className={input} maxLength={4000} rows={3} value={draft}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { setDraft(e.target.value); if (pending.current?.content !== e.target.value.trim()) pending.current = null; }}
                    placeholder={group.archived ? "Salon archivé" : remaining <= 0 ? "Limite de messages atteinte" : "Votre message professionnel…"}
                    disabled={busy || group.archived || remaining <= 0} />
                  {aiModels.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
                    <label className="text-xs">Modèle IA
                      <select className={`mt-1 ${input}`} value={aiModel} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAiModel(e.target.value)}>
                        {aiModels.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">Raisonnement
                      <select className={`mt-1 ${input}`} value={aiMode} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAiMode(e.target.value)}>
                        <option value="fast">Rapide</option><option value="balanced">Équilibré</option>
                        <option value="deep">Approfondi</option>
                      </select>
                    </label>
                  </div>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted">{draft.length}/4 000 caractères. {oriaMention.test(draft) ? "@ORIA : coût IA réparti sur les quotas du groupe." : "Messages humains gratuits."}</span>
                    <button className={primary} disabled={busy || group.archived || remaining <= 0 || !draft.trim()}>
                      <Send size={15} className="mr-2 inline" /> Envoyer</button>
                  </div>
                  {pending.current && oriaMention.test(pending.current.content) && <button type="button"
                    onClick={() => void inspectPending()} className={`${secondary} mt-3`} disabled={busy}>
                    Vérifier ma dernière demande @ORIA sans relancer l'IA
                  </button>}
                  {remaining === 0 && <p className="mt-2 text-xs text-muted"><LockKeyhole size={14} className="mr-1 inline" />
                    Vous avez atteint la limite de messages de cette conversation. L'extension Chariow de 5 000 messages sera activée après vérification des paiements.</p>}
                </form>
              </>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
