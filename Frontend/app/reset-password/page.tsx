"use client";

import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Status = "checking" | "ready" | "invalid" | "success";

const translations = {
  fr: {
    back: "Retour à la connexion",
    title: "Créer un nouveau mot de passe",
    intro: "Ton lien sécurisé a été vérifié. Choisis maintenant ton nouveau mot de passe ORIA.",
    checking: "Vérification du lien sécurisé…",
    invalidTitle: "Lien invalide ou expiré",
    invalid: "Ce lien a expiré ou a déjà été utilisé. Demande un nouvel email de récupération.",
    resend: "Recevoir un nouveau lien",
    password: "Nouveau mot de passe",
    confirm: "Confirmer le mot de passe",
    passwordPlaceholder: "Au moins 8 caractères",
    passwordMismatch: "Les mots de passe ne correspondent pas.",
    passwordShort: "Le mot de passe doit contenir au moins 8 caractères.",
    changing: "Enregistrement en cours…",
    change: "Enregistrer mon nouveau mot de passe",
    genericError: "Impossible d'enregistrer le mot de passe. Demande un nouveau lien si nécessaire.",
    successTitle: "Mot de passe modifié !",
    success: "Tu peux maintenant te connecter à ORIA avec ton nouveau mot de passe. Redirection vers la connexion…",
    login: "Aller à la connexion",
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
  },
  en: {
    back: "Back to sign in",
    title: "Create a new password",
    intro: "Your secure link has been verified. Choose your new ORIA password.",
    checking: "Verifying secure link…",
    invalidTitle: "Invalid or expired link",
    invalid: "This link has expired or was already used. Request a new recovery email.",
    resend: "Request a new link",
    password: "New password",
    confirm: "Confirm password",
    passwordPlaceholder: "At least 8 characters",
    passwordMismatch: "Passwords do not match.",
    passwordShort: "Your password must have at least 8 characters.",
    changing: "Saving…",
    change: "Save my new password",
    genericError: "We couldn't save the password. Request a new link if needed.",
    successTitle: "Password updated!",
    success: "You can now sign in to ORIA with your new password. Redirecting to sign in…",
    login: "Go to sign in",
    show: "Show password",
    hide: "Hide password",
  },
} as const;

/**
 * Vérifier le jeton Supabase est OBLIGATOIRE pour accéder au formulaire.
 * Un utilisateur déjà connecté qui visite simplement /reset-password ne
 * doit jamais obtenir automatiquement le formulaire de récupération.
 *
 * Chemin conseillé : /reset-password?token_hash=...&type=recovery
 * Support rétrocompatible : ?flow=recovery&code=... ou hash implicite.
 */
async function verifyRecoveryLink(): Promise<boolean> {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const tokenHash = query.get("token_hash");
  const recoveryType = query.get("type");
  const code = query.get("code");
  const hashToken = fragment.get("access_token");
  const hashRefresh = fragment.get("refresh_token");
  const hashType = fragment.get("type");
  const hasError = query.has("error") || fragment.has("error");

  // Retirer immédiatement les secrets de l'URL après lecture : pas de
  // réutilisation accidentelle, d'historique de navigateur ou de copie.
  window.history.replaceState(window.history.state, "", "/reset-password");

  if (hasError) return false;

  try {
    const supabase = createClient();
    if (tokenHash && recoveryType === "recovery") {
      // Jeton à usage unique ; fonctionne même sur un autre navigateur/appareil.
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (error) return false;
    } else if (code && query.get("flow") === "recovery") {
      // Compatibilité avec les anciens emails Supabase utilisant le PKCE.
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return false;
    } else if (hashType === "recovery" && hashToken && hashRefresh) {
      // Compatibilité avec le flux implicite. À ne pas utiliser dans le
      // nouveau template : il place des credentials dans le fragment d'URL.
      const { error } = await supabase.auth.setSession({
        access_token: hashToken,
        refresh_token: hashRefresh,
      });
      if (error) return false;
    } else {
      return false;
    }

    const { data, error } = await supabase.auth.getUser();
    return !error && !!data.user;
  } catch {
    return false;
  }
}

export default function ResetPasswordPage() {
  const [language, setLanguage] = useState<Language>("fr");
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // React StrictMode peut exécuter useEffect deux fois en développement.
  // Empêcher une double consommation du jeton Supabase à usage unique.
  const startedRef = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "fr" || saved === "en" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void verifyRecoveryLink().then((valid) => setStatus(valid ? "ready" : "invalid"));
  }, []);

  useEffect(() => {
    if (status !== "success") return;
    const timeout = window.setTimeout(() => window.location.replace("/login"), 2500);
    return () => window.clearTimeout(timeout);
  }, [status]);

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
      // Ne pas autoriser une mise à jour sans session obtenue par le jeton.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Recovery session unavailable");

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Fermer la session temporaire avant le retour à la connexion.
      // Scope local : ne pas déconnecter tous les autres appareils.
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        console.warn("ORIA: local sign-out after password recovery failed");
      }
      setStatus("success");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setErrorMessage(t.genericError);
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
          <p className="mt-3 text-sm leading-7 text-muted" aria-live="polite">
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
