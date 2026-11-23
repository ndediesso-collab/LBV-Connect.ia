"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { collabRequest } from "@/lib/collaboratif-api";

type Context = {
  success: boolean; workspace_id: string; is_owner: boolean;
  pack_active: boolean; name: string;
};
type Person = { user_id: string; first_name: string; last_name: string; status: string; role: string };
type Group = { id: string; title: string; archived: boolean; message_count: number; message_limit: number };
type DataGroups = { workspace_id: string; groups: Group[] };
type DataPeople = { workspace_id: string; profiles: Person[] };
type Result = { success: boolean; workspace_id: string; checkout_url?: string; [key: string]: unknown };

const field = "block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const btn = "rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50";
const card = "rounded-2xl border border-border p-5 space-y-3";

export default function WorkspaceActions() {
  const params = useParams();
  const space = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const base = `/collaboratif/workspaces/${encodeURIComponent(space)}`;
  const [ctx, setCtx] = useState<Context | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privateTitle, setPrivateTitle] = useState("Nouvelle conversation");
  const [groupId, setGroupId] = useState("");
  const [message, setMessage] = useState("");
  const [member, setMember] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [credits, setCredits] = useState("1000");
  const [kind, setKind] = useState("pack");
  const [email, setEmail] = useState("");
  const [addon, setAddon] = useState("credits_1000_563");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [c, g, p] = await Promise.all([
      collabRequest<Context>(`${base}/scope/context`),
      collabRequest<DataGroups>(`${base}/scope/groups`),
      collabRequest<DataPeople>(`${base}/scope/profiles`),
    ]);
    if (c.workspace_id !== space || g.workspace_id !== space || p.workspace_id !== space) {
      throw new Error("L'espace sélectionné ne correspond pas aux données retournées.");
    }
    setCtx(c); setGroups(g.groups ?? []); setPeople(p.profiles ?? []);
  }, [base, space]);

  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);

  async function act(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await collabRequest<Result>(`${base}/actions${path}`, method, body);
      if (!result.success || result.workspace_id !== space) throw new Error("Contexte financier incorrect.");
      if (result.checkout_url) {
        // Redirect is NOT proof of payment. Confirmation comes only from signed Chariow webhook.
        window.location.assign(result.checkout_url);
        return;
      }
      setNotice("Action confirmée dans cet espace.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Opération refusée."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex gap-5 text-sm">
        <Link href={`/collaboratif/espaces/${encodeURIComponent(space)}`} className="underline">Retour à cet espace</Link>
        <Link href="/collaboratif/espaces" className="underline">Mes espaces</Link>
      </div>
      <h1 className="text-2xl font-bold">Opérations — {ctx?.name ?? "Espace professionnel"}</h1>
      <p className="text-sm text-muted">Chaque action est associée à l'espace choisi. La facturation IA et les adhésions multiples restent désactivées jusqu'à la bascule complète.</p>
      {ctx && !ctx.pack_active && <p role="alert" className="rounded-xl border border-border p-4 text-sm">Le pack du propriétaire est inactif : les nouvelles opérations seront refusées.</p>}
      {error && <p role="alert" className="rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-border p-4 text-sm">{notice}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className="font-semibold">Nouvelle conversation professionnelle</h2>
          <input className={field} aria-label="Titre de conversation" maxLength={120} value={privateTitle} onChange={e=>setPrivateTitle(e.target.value)}/>
          <button className={btn} disabled={busy || !privateTitle.trim()} onClick={()=>void act("/private/conversations","POST",{title:privateTitle})}>Créer ma conversation</button>
        </section>
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Nouveau salon</h2>
          <input className={field} aria-label="Titre du salon" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Nom du salon"/>
          <textarea className={field} aria-label="Description" value={description} maxLength={500} onChange={e=>setDescription(e.target.value)}/>
          <button className={btn} disabled={busy || !title.trim()} onClick={()=>void act("/groups","POST",{title,description})}>Créer ce salon</button>
        </section>}
        <section className={card}>
          <h2 className="font-semibold">Écrire dans un salon</h2>
          <select className={field} aria-label="Salon" value={groupId} onChange={e=>setGroupId(e.target.value)}>
            <option value="">Choisir un salon</option>
            {groups.filter(g=>!g.archived).map(g=><option key={g.id} value={g.id}>{g.title} ({g.message_count}/{g.message_limit})</option>)}
          </select>
          <textarea className={field} aria-label="Message" value={message} onChange={e=>setMessage(e.target.value)} maxLength={4000} placeholder="Message humain (sans @ORIA)"/>
          <button className={btn} disabled={busy || !groupId || !message.trim()} onClick={()=>void act(`/groups/${encodeURIComponent(groupId)}/messages`,"POST",{client_message_id:crypto.randomUUID(),content:message})}>Envoyer le message</button>
        </section>
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Participants du salon</h2>
          <select className={field} aria-label="Salon des participants" value={groupId} onChange={e=>setGroupId(e.target.value)}>
            <option value="">Choisir un salon</option>
            {groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <select className={field} aria-label="Collaborateur" value={member} onChange={e=>setMember(e.target.value)}>
            <option value="">Choisir un collaborateur</option>
            {people.filter(p=>p.role==="member"&&p.status==="active").map(p=><option key={p.user_id} value={p.user_id}>{p.first_name} {p.last_name}</option>)}
          </select>
          <div className="flex gap-2">
            <button className={btn} disabled={busy || !groupId || !member} onClick={()=>void act(`/groups/${encodeURIComponent(groupId)}/participants`,"POST",{member_user_id:member,add:true})}>Ajouter</button>
            <button className="rounded-lg border border-border px-4 py-2 text-sm" disabled={busy || !groupId || !member} onClick={()=>void act(`/groups/${encodeURIComponent(groupId)}/participants`,"POST",{member_user_id:member,add:false})}>Retirer</button>
          </div>
        </section>}
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Transférer des crédits d'équipe</h2>
          <select className={field} aria-label="Source" value={source} onChange={e=>setSource(e.target.value)}>
            <option value="">Profil source</option>
            {people.filter(p=>p.status==="active"||p.status==="suspended").map(p=><option key={p.user_id} value={p.user_id}>{p.first_name} {p.last_name}</option>)}
          </select>
          <select className={field} aria-label="Destinataire" value={destination} onChange={e=>setDestination(e.target.value)}>
            <option value="">Profil destinataire</option>
            {people.filter(p=>p.status==="active").map(p=><option key={p.user_id} value={p.user_id}>{p.first_name} {p.last_name}</option>)}
          </select>
          <select className={field} value={kind} aria-label="Type de crédits" onChange={e=>setKind(e.target.value)}>
            <option value="pack">Quota du pack</option><option value="personal">Réserve personnelle de l'administrateur</option>
          </select>
          <input type="number" min="1" max="1200000000" className={field} aria-label="Crédits à transférer" value={credits} onChange={e=>setCredits(e.target.value)}/>
          <button className={btn} disabled={busy || !source || !destination || source===destination || !Number.isSafeInteger(Number(credits)) || Number(credits)<=0} onClick={()=>void act("/quotas/transfer","POST",{from_user_id:source,to_user_id:destination,credits:Number(credits),kind})}>Confirmer le transfert</button>
        </section>}
        {ctx && !ctx.is_owner && <section className={card}>
          <h2 className="font-semibold">Recharge de mon profil dans cet espace</h2>
          <input className={field} type="email" aria-label="Email reçu" value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail de reçu Chariow"/>
          <select className={field} aria-label="Recharge" value={addon} onChange={e=>setAddon(e.target.value)}>
            <option value="credits_1000_563">1 000 crédits · 600 FCFA</option>
            <option value="credits_2000">2 000 crédits · 1 000 FCFA</option>
            <option value="credits_4000">4 000 crédits · 2 000 FCFA</option>
            <option value="credits_10000">10 000 crédits · 5 000 FCFA</option>
          </select>
          <button className={btn} disabled={busy || !email.includes("@")} onClick={()=>void act("/recharges/checkout","POST",{billing_email:email,addon_id:addon})}>Continuer vers Chariow</button>
        </section>}
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Extension de salon : 5 000 messages / 3 000 FCFA</h2>
          <select className={field} aria-label="Salon à étendre" value={groupId} onChange={e=>setGroupId(e.target.value)}>
            <option value="">Choisir un salon</option>{groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <input className={field} type="email" aria-label="Email de reçu extension" value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail de reçu Chariow"/>
          <button className={btn} disabled={busy || !groupId || !email.includes("@")} onClick={()=>void act(`/groups/${encodeURIComponent(groupId)}/extensions/checkout`,"POST",{billing_email:email})}>Acheter via Chariow</button>
        </section>}
      </div>
      <p className="text-xs text-muted">Un retour du navigateur Chariow ne confirme jamais le paiement. Seul le webhook signé ORIA crédite l'achat. Les opérations restent désactivées par défaut sur le backend.</p>
    </div>
  </main>;
}
