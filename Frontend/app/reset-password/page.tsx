"use client";

import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Status = "checking" | "ready" | "invalid" | "success";

const translations = {
  fr: {
    back: "Retour à la connexion",
    title: "Nouveau mot de passe",
    intro: "Choisis un mot de passe sûr pour retrouver ton compte ORIA.",
    checking: "Vérification du lien sécurisé…",
    invalidTitle: "Lien invalide ou expiré",
    invalid: "Ce lien ne peut plus être utilisé. Demande un nouveau lien pour réinitialiser ton mot de passe.",
    resend: "Demander un nouveau lien",
    password: "Nouveau mot de passe",
    confirm: "Confirmer le mot de passe",
    passwordPlaceholder: "Au moins 8 caractères",
    passwordMismatch: "Les deux mots de passe ne correspondent pas.",
    passwordShort: "Utilise au moins 8 caractères.",
    changing: "Modification en cours…",
    change: "Enregistrer mon nouveau mot de passe",
    genericError: "La modification a échoué. Vérifie le lien reçu par email et réessaie.",
    successTitle: "Mot de passe modifié",
    success: "Ton mot de passe a bien été enregistré. Connecte-toi maintenant avec le nouveau mot de passe.",
    login: "Se connecter",
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
  },
  en: {
    back: "Back to sign in",
    title: "Choose a new password",
    intro: "Set a secure password to regain access to your ORIA account.",
    checking: "Checking the secure link…",
    invalidTitle: "Invalid or expired link",
    invalid: "This link can't be used anymore. Please request a new password reset link.",
    resend: "Request a new link",
    password: "New password",
    confirm: "Confirm password",
    passwordPlaceholder: "At least 8 characters",
    passwordMismatch: "The passwords don't match.",
    passwordShort: "Use at least 8 characters.",
    changing: "Saving…",
    change: "Save new password",
    genericError: "Password update failed. Check your email link and try again.",
    successTitle: "Password updated",
    success: "Your new password has been saved. Sign in using your new password.",
    login: "Sign in",
    show: "Show password",
    hide: "Hide password",
  },
} as const;

export default function ResetPasswordPage() {
  const [language, setLanguage] = useState<Language>("fr");
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "fr" || saved === "en" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    async function validateRecovery() {
      const authError = query.get("error") || hash.get("error");
      if (authError) {
        if (!cancelled) setStatus("invalid");
        return;
      }

      const code = query.get("code");
      const tokenHash = query.get("token_hash");
      const recoveryFlow = query.get("flow") === "recovery";
      const recoveryHash = hash.get("type") === "recovery";
      // A normal authenticated user visiting /reset-password has no recovery proof.
      if (!recoveryFlow && !recoveryHash && !(tokenHash && query.get("type") === "recovery")) {
        if (!cancelled) setStatus("invalid");
        return;
      }

      try {
        if (tokenHash && query.get("type") === "recovery") {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (error) throw error;
        } else if (code) {
          // Supabase SSR/PKCE flow. Some browser clients exchange this code automatically;
          // if so, a valid current session is accepted as the fallback.
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const { data: sessionData } = await supabase.auth.getSession();
            if (!sessionData.session) throw error;
          }
        } else if (recoveryHash && hash.get("access_token") && hash.get("refresh_token")) {
          // Implicit flow fallback for installations using the default JS auth flow.
          const { error } = await supabase.auth.setSession({
            access_token: hash.get("access_token")!,
            refresh_token: hash.get("refresh_token")!,
          });
          if (error) throw error;
        }

        // A query-string marker alone grants nothing: Supabase must validate a real user session.
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) throw error ?? new Error("No recovery session");
        if (!cancelled) setStatus("ready");
      } catch (error) {
        console.error("ORIA PASSWORD RECOVERY VALIDATION ERROR", error);
        if (!cancelled) setStatus("invalid");
      }
    }

    void validateRecovery();
    return () => { cancelled = true; };
  }, []);

  const t = translations[language];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "ready" || loading) return;
    setErrorMessage("");
    if (password.length < 8) { setErrorMessage(t.passwordShort); return; }
    if (password !== confirmPassword) { setErrorMessage(t.passwordMismatch); return; }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("No recovery session");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Restore the normal "sign in" flow instead of leaving the recovery session open.
      try { await supabase.auth.signOut(); } catch { /* Password was updated successfully. */ }
      window.history.replaceState(null, "", "/reset-password");
      setStatus("success");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("ORIA PASSWORD UPDATE ERROR", error);
      setErrorMessage(error instanceof Error && error.message ? error.message : t.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center px-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"><Sparkles size={18} />Oria.</Link>
      </header>
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center px-5 pb-20 sm:px-0">
        <section className="w-full rounded-[30px] border border-border/70 bg-surface/85 p-6 shadow-[0_22px_65px_-38px_var(--shadow-color)] sm:p-8">
          <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-strong hover:text-foreground"><ArrowLeft size={16} />{t.back}</Link>
          <div className="flex h-12 w-12 items-center justify-center rounded-[19px] border border-border/40 bg-accent text-accent-foreground">
            {status === "success" ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
            {status === "invalid" ? t.invalidTitle : status === "success" ? t.successTitle : t.title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            {status === "checking" ? t.checking : status === "invalid" ? t.invalid : status === "success" ? t.success : t.intro}
          </p>

          {status === "checking" ? <div className="mt-8 flex items-center gap-3 text-sm text-muted"><Loader2 className="animate-spin" size={20} />{t.checking}</div> : null}
          {status === "invalid" ? <Link className="mt-8 flex h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground" href="/forgot-password">{t.resend}</Link> : null}
          {status === "success" ? <Link className="mt-8 flex h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground" href="/login">{t.login}</Link> : null}

          {status === "ready" ? (
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label htmlFor="new-password" className="mb-2 block text-sm font-medium">{t.password}</label>
                <div className="relative">
                  <input id="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                    value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} placeholder={t.passwordPlaceholder}
                    className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 pr-12 text-[15px] text-foreground outline-none placeholder:text-muted focus:border-border-strong focus:shadow-[0_0_0_3px_var(--focus-ring)]" />
                  <button type="button" aria-label={showPassword ? t.hide : t.show} onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-foreground">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium">{t.confirm}</label>
                <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                  value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={loading}
                  className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 text-[15px] text-foreground outline-none focus:border-border-strong focus:shadow-[0_0_0_3px_var(--focus-ring)]" />
              </div>
              {errorMessage ? <p role="alert" className="rounded-2xl border border-red-200/70 bg-danger-surface px-4 py-3 text-sm text-danger">{errorMessage}</p> : null}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60">
                {loading ? <><Loader2 size={17} className="animate-spin" />{t.changing}</> : t.change}
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </main>
  );
}
