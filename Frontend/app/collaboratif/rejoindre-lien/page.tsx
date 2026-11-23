"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import { AVATARS, COLLAB_API_URL, collabRequest, collabSupabase } from "@/lib/collaboratif-api";

type Preview = { success: boolean; workspace_name: string; link_valid: boolean };
const field = "mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm";
const primary = "w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50";

export default function RejoindreParLien() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [avatar, setAvatar] = useState("ink");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    const secret = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invitation") || "";
    setToken(secret);
    if (!secret) { setError("Ce lien ne contient pas d'invitation."); return; }
    void fetch(`${COLLAB_API_URL}/collaboratif/share-invitations/preview`, {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: secret }),
    }).then(async response => {
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok || !payload || typeof payload !== "object" || !("success" in payload) || !payload.success) {
        throw new Error("Invitation indisponible.");
      }
      if (alive) setPreview(payload as Preview);
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Invitation indisponible.");
    });
    void collabSupabase.auth.getUser().then(({ data }) => {
      if (alive && data.user) { setSignedIn(true); setEmail(data.user.email || ""); }
    });
    const { data: listener } = collabSupabase.auth.onAuthStateChange((_event, session) => {
      if (alive && session?.user) { setSignedIn(true); setEmail(session.user.email || ""); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "new") {
        if (password.length < 12) throw new Error("Utilisez un mot de passe de 12 caractères minimum.");
        const { data, error: authError } = await collabSupabase.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: `${window.location.origin}/collaboratif/rejoindre-lien` },
        });
        if (authError) throw authError;
        if (!data.session) {
          setNotice("Confirmez votre adresse dans l'e-mail Supabase Auth, puis rouvrez le lien reçu sur WhatsApp pour rejoindre l'équipe.");
        } else {
          setSignedIn(true);
          setNotice("Compte créé. Si une confirmation est demandée, validez-la avant l'adhésion.");
        }
      } else {
        const { error: authError } = await collabSupabase.auth.signInWithPassword({
          email: email.trim(), password,
        });
        if (authError) throw authError;
        setSignedIn(true);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connexion impossible."); }
    finally { setBusy(false); }
  }

  async function accept(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const joined = await collabRequest<{ success: boolean; workspace_id: string }>(
        "/collaboratif/share-invitations/accept", "POST", {
          token, first_name: first.trim(), last_name: last.trim(),
          avatar_key: avatar, supervision_accepted: consent,
        },
      );
      if (!joined.success || !joined.workspace_id) throw new Error("L'adhésion n'a pas été confirmée.");
      window.history.replaceState(null, "", window.location.pathname);
      router.push(`/collaboratif/espaces/${encodeURIComponent(joined.workspace_id)}/chat`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Adhésion impossible."); }
    finally { setBusy(false); }
  }

  async function switchAccount() {
    await collabSupabase.auth.signOut(); setSignedIn(false); setEmail(""); setPassword("");
  }

  return <main className="min-h-dvh bg-background px-5 py-10 text-foreground">
    <div className="mx-auto max-w-xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted"><ArrowLeft size={15}/> ORIA</Link>
      <h1 className="mt-9 flex items-center gap-3 text-3xl font-bold"><Building2 size={26}/> Rejoindre ORIA Collaboratif</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Connectez-vous avec votre propre compte ORIA. Un compte gratuit suffit pour rejoindre une équipe invitante.</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl border border-border p-4 text-sm">{notice}</p>}
      {preview && <section className="mt-6 rounded-2xl border border-border p-5">
        <p className="text-xs text-muted">Espace professionnel</p><p className="mt-1 text-xl font-semibold">{preview.workspace_name}</p>
        {!preview.link_valid && <p className="mt-3 text-sm text-muted">Ce lien a expiré ou n'est plus disponible. Demandez un nouveau lien à l'administrateur.</p>}
      </section>}
      {preview?.link_valid && !signedIn && <form onSubmit={e => void authenticate(e)} className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex gap-2 text-sm">
          <button type="button" className={`flex-1 rounded-xl px-3 py-2 ${mode === "existing" ? "bg-foreground text-background" : "border border-border"}`} onClick={() => setMode("existing")}>Compte existant</button>
          <button type="button" className={`flex-1 rounded-xl px-3 py-2 ${mode === "new" ? "bg-foreground text-background" : "border border-border"}`} onClick={() => setMode("new")}>Créer un compte</button>
        </div>
        <label className="block text-sm">Adresse e-mail ORIA<input className={field} type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></label>
        <label className="block text-sm">Mot de passe<input className={field} type="password" required minLength={mode === "new" ? 12 : 1} autoComplete={mode === "new" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)}/></label>
        <button className={primary} disabled={busy}>{busy ? "Traitement…" : mode === "new" ? "Créer mon compte ORIA" : "Me connecter"}</button>
      </form>}
      {preview?.link_valid && signedIn && <form onSubmit={e => void accept(e)} className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm font-semibold"><ShieldCheck size={18} className="mr-2 inline"/> Connecté : {email}</p>
        <button type="button" className="text-xs underline" onClick={() => void switchAccount()}>Changer de compte</button>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">Prénom<input className={field} required maxLength={60} value={first} onChange={e => setFirst(e.target.value)}/></label>
          <label className="text-sm">Nom<input className={field} required maxLength={60} value={last} onChange={e => setLast(e.target.value)}/></label>
        </div>
        <p className="text-sm font-semibold">Avatar professionnel</p>
        <div className="flex flex-wrap gap-2">{AVATARS.map(option => <button key={option.key} type="button" aria-label={option.label} onClick={() => setAvatar(option.key)}
          className={`h-11 w-11 rounded-lg ${option.className} ${avatar === option.key ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}>{option.key[0].toUpperCase()}</button>)}</div>
        <label className="flex gap-3 rounded-xl border border-border p-3 text-xs leading-5"><input type="checkbox" className="mt-1" required checked={consent} onChange={e => setConsent(e.target.checked)}/>
          J'accepte que l'administrateur supervise mes conversations professionnelles dans cet espace. Mes conversations ORIA personnelles restent privées.</label>
        <button className={primary} disabled={busy || !consent}>{busy ? "Activation…" : "Accepter et rejoindre l'équipe"}</button>
      </form>}
      <p className="mt-6 text-xs text-muted">Après adhésion, l'équipe apparaît dans « Mes espaces ». Le lien n'est utilisable qu'une fois.</p>
    </div>
  </main>;
}
