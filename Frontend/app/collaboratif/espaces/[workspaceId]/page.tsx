"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Building2, RefreshCcw, Users, MessageCircle, MessagesSquare,
  Wallet, PencilLine, LockKeyhole, Save,
} from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type Context = {
  success: boolean; workspace_id: string; name: string; role: "owner" | "member";
  is_owner: boolean; pack_active: boolean; pack_id: string | null;
  active_count: number; seat_limit: number; capacity_exceeded: boolean;
  profile: { first_name: string | null; last_name: string | null; avatar_key: string | null };
};
type Profile = { user_id: string; role: string; status: string; first_name: string | null; last_name: string | null; avatar_key: string | null };
type Group = { id: string; title: string; description: string; archived: boolean; message_count: number; message_limit: number };
type Conversation = { id: string; title: string; member_user_id: string; updated_at: string };
type Message = { id: string; content: string; role?: string; sender_kind?: string; created_at: string };
type Quota = { member_user_id: string; available: number; reserved: number; spent: number };

type Tab = "profiles" | "groups" | "private" | "quota";
const tabs: { id: Tab; text: string }[] = [
  { id: "profiles", text: "Profils" }, { id: "groups", text: "Salons" },
  { id: "private", text: "Conversations" }, { id: "quota", text: "Crédits" },
];
const secondary = "rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface";
const primary = "rounded-xl bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50";
function displayPerson(p: Profile) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "Profil professionnel";
}

export default function EspaceSelectionne() {
  const params = useParams();
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const root = `/collaboratif/workspaces/${encodeURIComponent(workspaceId)}/scope`;
  const [ctx, setCtx] = useState<Context | null>(null);
  const [tab, setTab] = useState<Tab>("profiles");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [myRecharge, setMyRecharge] = useState(0);
  const [picked, setPicked] = useState<{ id: string; type: "group" | "private" } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [avatar, setAvatar] = useState("ink");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshContext = useCallback(async () => {
    const value = await collabRequest<Context>(`${root}/context`);
    if (!value.success || value.workspace_id !== workspaceId) throw new Error("Espace inaccessible.");
    setCtx(value);
    setFirst(value.profile.first_name ?? "");
    setLast(value.profile.last_name ?? "");
    setAvatar(value.profile.avatar_key ?? "ink");
  }, [root, workspaceId]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void collabRequest<Context>(`${root}/context`).then(value => {
      if (!active) return;
      if (!value.success || value.workspace_id !== workspaceId) throw new Error("Espace inaccessible.");
      setCtx(value);
      setFirst(value.profile.first_name ?? ""); setLast(value.profile.last_name ?? "");
      setAvatar(value.profile.avatar_key ?? "ink");
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Erreur d'accès."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [root, workspaceId]);

  const loadTab = useCallback(async (next: Tab) => {
    setError(""); setPicked(null); setMessages([]); setTab(next);
    try {
      if (next === "profiles") {
        const data = await collabRequest<{ success: boolean; workspace_id: string; profiles: Profile[] }>(`${root}/profiles`);
        if (data.workspace_id !== workspaceId) throw new Error("Contexte d'espace incorrect.");
        setProfiles(data.profiles ?? []);
      } else if (next === "groups") {
        const data = await collabRequest<{ success: boolean; workspace_id: string; groups: Group[] }>(`${root}/groups`);
        if (data.workspace_id !== workspaceId) throw new Error("Contexte d'espace incorrect.");
        setGroups(data.groups ?? []);
      } else if (next === "private") {
        const data = await collabRequest<{ success: boolean; workspace_id: string; conversations: Conversation[] }>(`${root}/private/conversations`);
        if (data.workspace_id !== workspaceId) throw new Error("Contexte d'espace incorrect.");
        setConversations(data.conversations ?? []);
      } else {
        const data = await collabRequest<{ success: boolean; workspace_id: string; quotas: Quota[]; my_workspace_recharge_balance: number }>(`${root}/quota`);
        if (data.workspace_id !== workspaceId) throw new Error("Contexte d'espace incorrect.");
        setQuotas(data.quotas ?? []); setMyRecharge(data.my_workspace_recharge_balance ?? 0);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
  }, [root, workspaceId]);

  useEffect(() => {
    if (ctx?.success && tab === "profiles") void loadTab("profiles");
    // La sélection des autres onglets est manuelle, pour éviter des lectures inutiles.
  }, [ctx?.success, loadTab]);

  async function openHistory(id: string, type: "group" | "private") {
    setError(""); setPicked({ id, type }); setMessages([]);
    try {
      const suffix = type === "group" ? `/groups/${encodeURIComponent(id)}/messages`
        : `/private/conversations/${encodeURIComponent(id)}/messages`;
      const data = await collabRequest<{ success: boolean; workspace_id: string; messages: Message[] }>(`${root}${suffix}`);
      if (data.workspace_id !== workspaceId) throw new Error("Historique inaccessible.");
      setMessages(data.messages ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Historique indisponible."); }
  }

  async function saveProfile() {
    setError(""); setBusy(true); setNotice("");
    try {
      const response = await collabRequest<{ success: boolean; workspace_id: string }>(`${root}/profile/me`, "PATCH", {
        first_name: first.trim(), last_name: last.trim(), avatar_key: avatar,
      });
      if (!response.success || response.workspace_id !== workspaceId) throw new Error("Modification non confirmée.");
      await refreshContext(); setEditing(false); setNotice("Profil professionnel mis à jour.");
      await loadTab("profiles");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/collaboratif/espaces" className="inline-flex items-center gap-2 text-muted hover:text-foreground"><ArrowLeft size={16}/> Mes espaces</Link>
        <Link href="/chat" className="text-muted hover:text-foreground">Retour à mon ORIA personnel</Link>
        <Link href={`/collaboratif/espaces/${encodeURIComponent(workspaceId)}/chat`} className="font-semibold underline">Ouvrir le chat collaboratif</Link>
        <Link href={`/collaboratif/espaces/${encodeURIComponent(workspaceId)}/actions`} className="text-muted hover:text-foreground">Opérations de cet espace</Link>
        <Link href={`/collaboratif/espaces/${encodeURIComponent(workspaceId)}/finances`} className="text-muted hover:text-foreground">Finances de cet espace</Link>
      </div>
      <div className="mt-8 flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl"><Building2 size={27}/>{ctx?.name ?? "Espace professionnel"}</h1>
          {ctx && <p className="mt-2 text-sm text-muted">{ctx.is_owner ? "Administrateur" : "Collaborateur"} · {ctx.active_count} membre(s) actif(s) · {ctx.seat_limit} places autorisées</p>}
        </div>
        <button type="button" className={secondary} onClick={() => void refreshContext().catch(cause => setError(String(cause)))}><RefreshCcw className="mr-2 inline" size={15}/> Actualiser</button>
      </div>
      {loading && <p className="mt-7 text-sm" role="status">Vérification de l'appartenance…</p>}
      {error && <p className="mt-6 rounded-xl border border-border p-4 text-sm" role="alert">{error}</p>}
      {notice && <p className="mt-6 rounded-xl border border-border p-4 text-sm" role="status">{notice}</p>}
      {ctx && <>
        {!ctx.pack_active && <div className="mt-6 flex gap-2 rounded-xl border border-border p-4 text-sm"><LockKeyhole size={19}/><p>Le pack du propriétaire est inactif. Les historiques restent consultables, mais les fonctionnalités IA payantes ne doivent pas être utilisées.</p></div>}
        {ctx.capacity_exceeded && <p className="mt-4 rounded-xl border border-border p-4 text-sm">L'espace dépasse le nombre de places autorisées par son pack actuel.</p>}
        <p className="mt-6 rounded-xl border border-border p-4 text-xs text-muted">Mode de consultation sécurisé 6B2B1 : chaque requête vérifie cet espace et votre compte. Les nouvelles opérations financières restent désactivées jusqu'à la migration complète.</p>
        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Ressources de l'espace">
          {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab===t.id}
            className={tab===t.id ? primary : secondary} onClick={() => void loadTab(t.id)}>{t.text}</button>)}
        </div>

        {tab === "profiles" && <section className="mt-6 space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users size={18}/> Équipe</h2>
            <button type="button" className={secondary} onClick={() => setEditing(v=>!v)}><PencilLine className="mr-2 inline" size={14}/> Mon profil</button></div>
          {editing && <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
            <label className="text-xs">Prénom<input value={first} maxLength={60} onChange={e=>setFirst(e.target.value)} className="mt-2 block w-full rounded-lg border border-border bg-background p-2 text-sm"/></label>
            <label className="text-xs">Nom<input value={last} maxLength={60} onChange={e=>setLast(e.target.value)} className="mt-2 block w-full rounded-lg border border-border bg-background p-2 text-sm"/></label>
            <label className="text-xs">Style du profil<select value={avatar} onChange={e=>setAvatar(e.target.value)} className="mt-2 block w-full rounded-lg border border-border bg-background p-2 text-sm">{["ink","stone","paper","slate","silver","carbon"].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
            <button type="button" className={primary} disabled={busy || !first.trim() || !last.trim()} onClick={() => void saveProfile()}><Save className="mr-2 inline" size={14}/> Enregistrer</button>
          </div>}
          {profiles.map(p=><div key={p.user_id} className="rounded-xl border border-border p-4"><strong>{displayPerson(p)}</strong><p className="mt-1 text-xs text-muted">{p.role === "owner" ? "Propriétaire" : "Collaborateur"} · {p.status}</p></div>)}
          {ctx.is_owner && <Link href={`/collaboratif/invitations-email?workspace=${encodeURIComponent(workspaceId)}`} className="inline-block text-sm underline">Gérer les invitations e-mail</Link>}
        </section>}

        {tab === "groups" && <section className="mt-6 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><MessagesSquare size={18}/> Salons de cet espace</h2>
          {groups.length === 0 && <p className="text-sm text-muted">Aucun salon accessible.</p>}
          {groups.map(g=><button type="button" key={g.id} className="block w-full rounded-xl border border-border p-4 text-left hover:bg-surface" onClick={() => void openHistory(g.id,"group")}>
            <strong>{g.title}</strong><p className="mt-1 text-xs text-muted">{g.description} · {g.message_count} / {g.message_limit} messages {g.archived ? "· Archivé" : ""}</p>
          </button>)}
        </section>}

        {tab === "private" && <section className="mt-6 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageCircle size={18}/> Conversations professionnelles</h2>
          <p className="text-xs text-muted">Le propriétaire peut consulter les conversations professionnelles en lecture seule, jamais les conversations personnelles hors équipe.</p>
          {conversations.length === 0 && <p className="text-sm text-muted">Aucune conversation accessible.</p>}
          {conversations.map(c=><button type="button" key={c.id} className="block w-full rounded-xl border border-border p-4 text-left hover:bg-surface" onClick={() => void openHistory(c.id,"private")}>
            <strong>{c.title}</strong><p className="mt-1 text-xs text-muted">Créée par le profil {c.member_user_id.slice(0,8)}…</p>
          </button>)}
        </section>}

        {tab === "quota" && <section className="mt-6 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={18}/> Quotas professionnels (lecture)</h2>
          {quotas.map(q=><div key={q.member_user_id} className="rounded-xl border border-border p-4 text-sm">
            <span className="font-semibold">Profil {q.member_user_id.slice(0,8)}…</span>
            <p className="mt-1 text-muted">Disponibles : {q.available.toLocaleString("fr-FR")} · Réservés : {q.reserved.toLocaleString("fr-FR")} · Dépensés : {q.spent.toLocaleString("fr-FR")}</p>
          </div>)}
          <p className="text-sm text-muted">Mes recharges affectées à cet espace : {myRecharge.toLocaleString("fr-FR")} crédits.</p>
          <p className="text-xs text-muted">Ce tableau affiche les derniers états enregistrés : il ne déclenche aucun transfert ni recalcul financier.</p>
        </section>}
        {picked && (tab==="groups" || tab==="private") && <section className="mt-6 rounded-2xl border border-border p-5">
          <h3 className="font-semibold">Historique {picked.type === "group" ? "du salon" : "de conversation"}</h3>
          {messages.length === 0 && <p className="mt-3 text-sm text-muted">Aucun message à afficher.</p>}
          <div className="mt-4 space-y-3">{messages.map(m=><article key={m.id} className="rounded-xl bg-surface p-3 text-sm"><p className="mb-2 text-xs text-muted">{m.role ?? m.sender_kind ?? "Membre"}</p><p className="whitespace-pre-wrap break-words">{m.content}</p></article>)}</div>
        </section>}
      </>}
    </div>
  </main>;
}
