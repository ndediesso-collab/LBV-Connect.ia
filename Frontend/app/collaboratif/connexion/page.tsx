"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, LockKeyhole } from "lucide-react";
import { collabRequest, collabSupabase } from "@/lib/collaboratif-api";

const field = "mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm";
const primary = "w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50";

export default function CollaboratifConnexionPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "reset" | "verify">("login");
  const [phone, setPhone] = useState("+241");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error: authError } = await collabSupabase.auth.signInWithPassword({ phone: phone.replace(/[\s().-]/g, ""), password });
      if (authError) throw authError;
      await collabRequest("/collaboratif/profiles");
      router.push("/collaboratif/profils");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connexion impossible."); }
    finally { setBusy(false); }
  }

  async function askReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error: authError } = await collabSupabase.auth.signInWithOtp({
        phone: phone.replace(/[\s().-]/g, ""), options: { shouldCreateUser: false },
      });
      if (authError) throw authError;
      setMode("verify");
      setNotice("Si ce numéro est enregistré et le fournisseur SMS actif, vous recevrez un code de vérification.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Envoi du SMS impossible."); }
    finally { setBusy(false); }
  }

  async function confirmReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) { setError("Choisissez au moins 12 caractères."); return; }
    setBusy(true); setError("");
    try {
      const { error: verifyError } = await collabSupabase.auth.verifyOtp({
        phone: phone.replace(/[\s().-]/g, ""), token: code.trim(), type: "sms",
      });
      if (verifyError) throw verifyError;
      const { error: updateError } = await collabSupabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setCode(""); setNewPassword("");
      await collabRequest("/collaboratif/profiles");
      router.push("/collaboratif/profils");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Réinitialisation impossible."); }
    finally { setBusy(false); }
  }

  async function exitCurrentProfile() {
    setBusy(true); setError("");
    const { error: authError } = await collabSupabase.auth.signOut({ scope: "local" });
    setBusy(false);
    if (authError) setError(authError.message);
    else setNotice("Session locale fermée. Vous pouvez choisir un autre profil.");
  }

  return (
    <main className="min-h-dvh bg-background px-5 py-9 text-foreground">
      <div className="mx-auto max-w-md">
        <Link href="/collaboratif/profils" className="inline-flex items-center gap-2 text-sm text-muted"><ArrowLeft size={16} /> Retour aux profils</Link>
        <div className="mt-12 mb-7">
          <div className="mb-3 flex items-center gap-2 text-xs tracking-widest text-muted"><LockKeyhole size={16} /> ORIA COLLABORATIF</div>
          <h1 className="text-3xl font-bold">{mode === "login" ? "Connexion professionnelle" : "Récupérer mon accès"}</h1>
          <p className="mt-3 text-sm text-muted">Chaque personne se connecte avec son numéro et son mot de passe personnel.</p>
        </div>
        {error && <p className="mb-4 rounded-xl border border-border p-4 text-sm" role="alert">{error}</p>}
        {notice && <p className="mb-4 rounded-xl border border-border p-4 text-sm" role="status">{notice}</p>}
        <section className="rounded-2xl border border-border bg-surface p-6">
          {mode === "login" && <form className="space-y-4" onSubmit={(event) => void login(event)}>
            <label className="block text-xs">Téléphone
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} autoComplete="tel" required />
            </label>
            <label className="block text-xs">Mot de passe
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} autoComplete="current-password" required />
            </label>
            <button disabled={busy} className={primary}>Me connecter</button>
            <button type="button" className="text-xs underline" onClick={() => setMode("reset")}>Mot de passe oublié ?</button>
          </form>}
          {mode === "reset" && <form className="space-y-4" onSubmit={(event) => void askReset(event)}>
            <p className="flex items-center gap-2 text-sm"><KeyRound size={16} /> Réinitialisation par SMS</p>
            <label className="block text-xs">Téléphone vérifié
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} required />
            </label>
            <button disabled={busy} className={primary}>Recevoir un code SMS</button>
            <button type="button" onClick={() => setMode("login")} className="text-xs underline">Retour à la connexion</button>
          </form>}
          {mode === "verify" && <form className="space-y-4" onSubmit={(event) => void confirmReset(event)}>
            <label className="block text-xs">Code SMS<input value={code} onChange={(e) => setCode(e.target.value)} className={field} autoComplete="one-time-code" required /></label>
            <label className="block text-xs">Nouveau mot de passe (12 caractères minimum)<input type="password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={field} autoComplete="new-password" required /></label>
            <button disabled={busy} className={primary}>Enregistrer mon mot de passe</button>
          </form>}
        </section>
        <button type="button" disabled={busy} onClick={() => void exitCurrentProfile()}
          className="mt-5 text-xs underline">Fermer la session de ce navigateur pour changer de profil</button>
        <p className="mt-4 text-xs leading-5 text-muted">Un fournisseur SMS doit être configuré et activé dans Supabase Auth. Sans cela, l&apos;inscription et la récupération par téléphone ne sont pas disponibles.</p>
      </div>
    </main>
  );
}
