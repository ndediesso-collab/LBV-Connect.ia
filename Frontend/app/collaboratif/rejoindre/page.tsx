"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ShieldCheck, Users } from "lucide-react";
import { AVATARS, collabRequest, collabSupabase } from "@/lib/collaboratif-api";

const field = "mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm";
const primary = "w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50";

export default function RejoindreCollaboratifPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("+241");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [avatar, setAvatar] = useState("ink");
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [step, setStep] = useState<"register" | "sms">("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const value = params.get("invitation") || "";
    setToken(value);
    // Conserver le secret en fragment seulement; pas de transmission au serveur Next.js.
  }, []);

  async function acceptInvite() {
    await collabRequest("/collaboratif/invitations/accept", "POST", {
      token, first_name: first, last_name: last, avatar_key: avatar,
      supervision_accepted: consent,
    });
    // Ne conserver aucune trace du jeton d'invitation dans l'URL après acceptation.
    window.history.replaceState(null, "", window.location.pathname);
    router.push("/collaboratif/profils");
  }

  async function submitRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) { setError("Lien d'invitation absent ou invalide."); return; }
    if (!consent) { setError("Veuillez accepter l'information sur la supervision professionnelle."); return; }
    if (mode === "new" && password.length < 12) { setError("Mot de passe trop court (12 caractères minimum)."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "new") {
        const { data, error: authError } = await collabSupabase.auth.signUp({
          phone: phone.replace(/[\s().-]/g, ""), password, options: { channel: "sms" },
        });
        if (authError) throw authError;
        if (data.session) {
          // Même avec une session, SQL exige phone_confirmed_at pour rattacher un profil.
          await acceptInvite();
        } else {
          setStep("sms");
          setNotice("Un code SMS a été envoyé à ce numéro si l'authentification téléphonique est activée.");
        }
      } else {
        const { error: authError } = await collabSupabase.auth.signInWithPassword({ phone: phone.replace(/[\s().-]/g, ""), password });
        if (authError) throw authError;
        await acceptInvite();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de rejoindre l'équipe.");
    } finally { setBusy(false); }
  }

  async function verifySms(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error: otpError } = await collabSupabase.auth.verifyOtp({
        phone: phone.replace(/[\s().-]/g, ""), token: otp.trim(), type: "sms",
      });
      if (otpError) throw otpError;
      await acceptInvite();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Code invalide."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-dvh bg-background px-5 py-9 text-foreground">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"><ArrowLeft size={16} /> ORIA</Link>
        <header className="mt-12 mb-8">
          <div className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><Users size={15} /> ORIA COLLABORATIF</div>
          <h1 className="text-3xl font-bold sm:text-4xl">Rejoindre votre équipe</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Créez votre identité professionnelle. Vous utiliserez votre propre mot de passe, jamais celui de l&apos;administrateur.</p>
        </header>
        {!token && <p className="mb-4 rounded-xl border border-border p-4 text-sm">Aucune invitation détectée. Demandez un lien valide à l&apos;administrateur.</p>}
        {error && <p className="mb-4 rounded-xl border border-border p-4 text-sm" role="alert">{error}</p>}
        {notice && <p className="mb-4 rounded-xl border border-border p-4 text-sm" role="status">{notice}</p>}
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-8">
          {step === "register" ? (
            <form onSubmit={(e) => void submitRegister(e)} className="space-y-4">
              <div className="flex gap-2 rounded-xl border border-border p-1 text-sm">
                <button type="button" className={`flex-1 rounded-lg px-3 py-2 ${mode === "new" ? "bg-foreground text-background" : ""}`} onClick={() => setMode("new")}>Nouveau profil</button>
                <button type="button" className={`flex-1 rounded-lg px-3 py-2 ${mode === "existing" ? "bg-foreground text-background" : ""}`} onClick={() => setMode("existing")}>Compte existant</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">Prénom<input value={first} onChange={(e) => setFirst(e.target.value)} className={field} maxLength={60} required /></label>
                <label className="text-xs">Nom<input value={last} onChange={(e) => setLast(e.target.value)} className={field} maxLength={60} required /></label>
              </div>
              <label className="block text-xs">Numéro autorisé par l&apos;administrateur (format international)
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} placeholder="+241XXXXXXXX" required autoComplete="tel" />
              </label>
              <label className="block text-xs">{mode === "existing" ? "Mot de passe de ce compte" : "Mot de passe personnel (12 caractères minimum)"}
                <input type="password" minLength={mode === "new" ? 12 : 1} value={password} onChange={(e) => setPassword(e.target.value)} className={field} required autoComplete={mode === "new" ? "new-password" : "current-password"} />
              </label>
              <div className="space-y-2">
                <p className="text-xs font-semibold">Avatar professionnel</p>
                <div className="flex flex-wrap gap-2">{AVATARS.map((item) => <button key={item.key} aria-label={item.label} type="button" onClick={() => setAvatar(item.key)}
                  className={`h-11 w-11 rounded-xl text-sm font-bold ${item.className} ${avatar === item.key ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}>
                  {item.key[0].toUpperCase()}
                </button>)}</div>
              </div>
              <label className="flex gap-3 rounded-xl border border-border p-4 text-xs leading-5">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                <span>Je comprends que cet espace est professionnel et que l&apos;administrateur pourra consulter en lecture seule mes conversations professionnelles ORIA, avec historique, dans la phase correspondante. Mes échanges personnels hors de cet espace ne font pas partie de cette supervision.</span>
              </label>
              <button disabled={busy || !token} className={primary}>{busy ? "Vérification…" : mode === "new" ? "Créer et vérifier mon profil" : "Me connecter et rejoindre"}</button>
            </form>
          ) : (
            <form onSubmit={(e) => void verifySms(e)} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} /> Vérification du téléphone</div>
              <p className="text-xs text-muted">Entrez le code de confirmation envoyé par Supabase Auth au {phone}. Un numéro non vérifié ne peut pas rejoindre le groupe.</p>
              <label className="block text-xs">Code SMS
                <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className={field} required />
              </label>
              <button disabled={busy || !token} className={primary}>{busy ? "Activation…" : "Vérifier et rejoindre"}</button>
              <button className="block text-xs underline" type="button" onClick={() => setStep("register")}>Retour</button>
            </form>
          )}
        </section>
        <div className="mt-6 flex items-center gap-2 text-xs text-muted"><CheckCircle2 size={15} /> Invitation valable 72 heures à partir de sa création.</div>
        <Link className="mt-4 inline-block text-sm underline" href="/collaboratif/connexion">Déjà membre ? Connexion professionnelle</Link>
      </div>
    </main>
  );
}
