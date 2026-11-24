"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { collabRequest, collabSupabase } from "@/lib/collaboratif-api";

type Context = {
  success: boolean; workspace_id: string; is_owner: boolean;
  pack_active: boolean; name: string;
};
type Person = { user_id: string; first_name: string; last_name: string; status: string; role: string };
type Group = { id: string; title: string; archived: boolean; message_count: number; message_limit: number };
type DataGroups = { workspace_id: string; groups: Group[] };
type DataPeople = { workspace_id: string; profiles: Person[] };
type Result = { success: boolean; workspace_id: string; checkout_url?: string; [key: string]: unknown };

const field = "block w-full rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm";
const PAYMENT_COUNTRIES = [{"code": "GA", "label": "Gabon (+241)"}, {"code": "CM", "label": "Cameroun (+237)"}, {"code": "CI", "label": "Côte d'Ivoire (+225)"}, {"code": "SN", "label": "Sénégal (+221)"}, {"code": "BJ", "label": "Bénin (+229)"}, {"code": "BF", "label": "Burkina Faso (+226)"}, {"code": "BI", "label": "Burundi (+257)"}, {"code": "CF", "label": "Centrafrique (+236)"}, {"code": "KM", "label": "Comores (+269)"}, {"code": "CG", "label": "Congo (+242)"}, {"code": "DJ", "label": "Djibouti (+253)"}, {"code": "GN", "label": "Guinée (+224)"}, {"code": "GQ", "label": "Guinée équatoriale (+240)"}, {"code": "MG", "label": "Madagascar (+261)"}, {"code": "ML", "label": "Mali (+223)"}, {"code": "NE", "label": "Niger (+227)"}, {"code": "CD", "label": "RDC (+243)"}, {"code": "RW", "label": "Rwanda (+250)"}, {"code": "TG", "label": "Togo (+228)"}] as const;
const RECHARGES = [{id:"credits_1000_563",label:"1 000 crédits · 600 FCFA"},{id:"credits_2000",label:"2 000 crédits · 1 000 FCFA"},{id:"credits_4000",label:"4 000 crédits · 2 000 FCFA"},{id:"credits_10000",label:"10 000 crédits · 5 000 FCFA"}] as const;
const btn = "rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50";
const card = "rounded-2xl border border-border p-5 space-y-3";

export default function WorkspaceActions() {
  const params = useParams();
  const space = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const base = `/collaboratif/workspaces/${encodeURIComponent(space)}`;
  const [ctx, setCtx] = useState<Context | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [groupId, setGroupId] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [credits, setCredits] = useState("1000");
  const [kind, setKind] = useState("pack");
  const [email, setEmail] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentCountry, setPaymentCountry] = useState("GA");
  const [addon, setAddon] = useState("credits_1000_563");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    // P14: ne pas bloquer une recharge parce que le répertoire ou les groupes
    // ne répondent pas. Le contexte authentifié, lui, est obligatoire.
    const c = await collabRequest<Context>(`${base}/scope/context`);
    if (!c.success || c.workspace_id !== space) {
      throw new Error("L'espace sélectionné ne correspond pas à l'identité vérifiée.");
    }
    setCtx(c);
    const [g, p] = await Promise.allSettled([
      collabRequest<DataGroups>(`${base}/scope/groups`),
      collabRequest<DataPeople>(`${base}/scope/profiles`),
    ]);
    setGroups(g.status === "fulfilled" && g.value.workspace_id === space ? g.value.groups ?? [] : []);
    setPeople(p.status === "fulfilled" && p.value.workspace_id === space ? p.value.profiles ?? [] : []);
  }, [base, space]);

  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  useEffect(() => {
    let mounted = true;
    void collabSupabase.auth.getUser().then(({data}) => {
      if (!mounted || !data.user) return;
      if (data.user.email) setEmail(previous => previous || data.user!.email || "");
      if (data.user.phone) setPaymentPhone(previous => previous || data.user!.phone || "");
      const country = data.user.user_metadata?.country_iso2;
      if (typeof country === "string" && PAYMENT_COUNTRIES.some(c => c.code === country.toUpperCase())) {
        setPaymentCountry(country.toUpperCase());
      }
    }).catch(() => { /* La saisie manuelle reste possible. */ });
    return () => { mounted = false; };
  }, []);

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

  // P14: meme checkout que /packs, sans nouvelle commande ni webhook.
  async function buyPersonalRecharge() {
    if (busy || !ctx || ctx.is_owner || !ctx.pack_active) return;
    if (!email.trim() || !email.includes("@") || !paymentPhone.trim()) {
      setError("Renseignez un e-mail valide et un numéro de paiement Chariow."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await collabRequest<{success:boolean;checkout_url?:string}>("/payments/checkout", "POST", {
        payment_type: "addon", product_id: addon, provider: "chariow",
        billing_email: email.trim(), billing_phone: paymentPhone.trim(),
        billing_country_iso2: paymentCountry, workspace_id: space,
      });
      if (!result.success || !result.checkout_url || !result.checkout_url.startsWith("https://")) {
        throw new Error("Aucun lien sécurisé Chariow reçu. Aucun crédit ajouté.");
      }
      // Le webhook signé, jamais cette redirection, confirmera l'achat.
      window.location.assign(result.checkout_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paiement indisponible.");
      setBusy(false);
    }
  }

  return <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex gap-5 text-sm">
        <Link href={`/collaboratif/espaces/${encodeURIComponent(space)}/chat`} className="underline">Retour au chat et aux groupes</Link>
        <Link href="/collaboratif/espaces" className="underline">Mes espaces</Link>
      </div>
      <h1 className="text-2xl font-bold">Crédits et extensions — {ctx?.name ?? "Espace professionnel"}</h1>
      <p className="text-sm text-muted">Chaque action est associée à l'espace choisi. Les crédits et extensions ne sont confirmés qu’après validation du paiement et des contrôles du serveur.</p>
      {ctx && !ctx.pack_active && <p role="alert" className="rounded-xl border border-border p-4 text-sm">Le pack du propriétaire est inactif : les nouvelles opérations seront refusées.</p>}
      {error && <p role="alert" className="rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-border p-4 text-sm">{notice}</p>}
      <div className="grid gap-4 md:grid-cols-2">
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
          <h2 className="font-semibold">Acheter des crédits pour mon profil</h2>
          <p className="text-sm text-muted">Ces crédits seront utilisables par votre profil dans cet espace, sans augmenter le solde des autres membres. Paiement et validation via le même Chariow qu’ORIA personnel.</p>
          <label className="block text-sm">Recharge
            <select className={`${field} mt-2`} aria-label="Recharge personnelle" value={addon} onChange={e=>setAddon(e.target.value)}>
              {RECHARGES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">E-mail du reçu
            <input className={`${field} mt-2`} type="email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="adresse@exemple.com"/>
          </label>
          <label className="block text-sm">Pays du numéro de paiement
            <select className={`${field} mt-2`} aria-label="Pays du numéro de paiement" value={paymentCountry} onChange={e=>setPaymentCountry(e.target.value)}>
              {PAYMENT_COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">Numéro utilisé pour le paiement
            <input className={`${field} mt-2`} type="tel" inputMode="tel" autoComplete="tel" maxLength={25} value={paymentPhone} onChange={e=>setPaymentPhone(e.target.value)} placeholder="+241…"/>
          </label>
          <button type="button" className={btn} disabled={busy || !ctx.pack_active || !email.includes("@") || !paymentPhone.trim()}
            onClick={()=>void buyPersonalRecharge()}>Continuer vers Chariow</button>
          <p className="text-xs text-muted">Si vous préférez, demandez au propriétaire de vous transférer une partie des crédits de l'équipe.</p>
          <div className="flex flex-wrap gap-4 text-sm underline">
            <Link href={`/collaboratif/espaces/${encodeURIComponent(space)}/finances`}>Mon solde et mes achats</Link>
            <Link href={`/collaboratif/espaces/${encodeURIComponent(space)}/chat`}>Demander au propriétaire dans le groupe</Link>
          </div>
        </section>}
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Mes recharges personnelles</h2>
          <p className="text-sm text-muted">En tant que propriétaire, effectuez vos achats de crédits depuis ORIA personnel. Vos transferts aux collaborateurs restent disponibles ici.</p>
          <Link href="/packs?recharge=standard" className="inline-flex items-center rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background">Voir les recharges ORIA</Link>
        </section>}
        {ctx?.is_owner && <section className={card}>
          <h2 className="font-semibold">Étendre un groupe : +5 000 messages / 3 000 FCFA</h2>
          <p className="text-xs text-muted">Sélectionne le groupe à étendre ; l’extension ne sera appliquée qu’à celui-ci après confirmation Chariow.</p>
          <select className={field} aria-label="Salon à étendre" value={groupId} onChange={e=>setGroupId(e.target.value)}>
            <option value="">Choisir un salon</option>{groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          {groupId && <p className="rounded-lg border border-border p-2 text-sm" role="status">Groupe sélectionné : <strong>{groups.find(g=>g.id===groupId)?.title ?? "Groupe inconnu"}</strong> · {groups.find(g=>g.id===groupId)?.message_count ?? 0} / {groups.find(g=>g.id===groupId)?.message_limit ?? 0} messages</p>}
          <input className={field} type="email" aria-label="Email de reçu extension" value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail de reçu Chariow"/>
          <button className={btn} disabled={busy || !groupId || !email.includes("@")} onClick={()=>void act(`/groups/${encodeURIComponent(groupId)}/extensions/checkout`,"POST",{billing_email:email})}>Acheter via Chariow</button>
        </section>}
      </div>
      <p className="text-xs text-muted">Un retour du navigateur Chariow ne confirme jamais le paiement. Seul le webhook signé ORIA crédite l'achat. Les extensions de messages sont des achats distincts des recharges personnelles et restent soumises à leur activation backend.</p>
    </div>
  </main>;
}
