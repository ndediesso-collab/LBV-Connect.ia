"use client";

import { CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";
import { createClient as createEphemeralClient, type SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient as createWebsiteClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Status = "initializing" | "confirm" | "ready" | "invalid" | "success" | "logout-error";

const UI = {
  fr: {
    title: "Créer un nouveau mot de passe",
    prepare: "Préparation sécurisée de votre récupération…",
    confirmTitle: "Confirmer la récupération",
    confirmText: "Vous avez ouvert un lien de récupération ORIA. Cliquez ci-dessous pour vérifier ce lien à usage unique, puis choisissez votre nouveau mot de passe.",
    confirmButton: "Vérifier mon lien et continuer",
    readyText: "Lien vérifié. Choisissez maintenant votre nouveau mot de passe.",
    invalidTitle: "Lien invalide, expiré ou déjà utilisé",
    invalidText: "Ce lien ne peut plus être utilisé. Demandez un nouvel email de récupération. Ce parcours n'a pas modifié votre mot de passe.",
    newLink: "Demander un nouveau lien",
    password: "Nouveau mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    placeholder: "Au moins 8 caractères",
    mismatch: "Les mots de passe ne correspondent pas.",
    tooShort: "Le mot de passe doit contenir au moins 8 caractères.",
    save: "Enregistrer mon nouveau mot de passe",
    saving: "Enregistrement en cours…",
    checking: "Vérification du lien…",
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
    genericError: "Une erreur s'est produite. Veuillez réessayer ou demander un nouveau lien.",
    successTitle: "Mot de passe modifié",
    successText: "Votre nouveau mot de passe est enregistré. Vous pouvez maintenant vous connecter avec votre adresse email.",
    logoutTitle: "Session à fermer",
    logoutText: "Une session ORIA doit être fermée avant de continuer. Si vous venez d’enregistrer un nouveau mot de passe, il est peut-être déjà pris en compte : ne répétez pas l’enregistrement.",
    retryLogout: "Fermer la session et continuer",
    login: "Retour à la connexion",
  },
  en: {
    title: "Create a new password",
    prepare: "Preparing secure password recovery…",
    confirmTitle: "Confirm recovery",
    confirmText: "You have opened an ORIA password recovery link. Select the button below to verify this one-time link and choose a new password.",
    confirmButton: "Verify my link and continue",
    readyText: "Link verified. You can now choose a new password.",
    invalidTitle: "Invalid, expired or already used link",
    invalidText: "This link cannot be used again. Request a new recovery email. Your existing password was not changed.",
    newLink: "Request a new link",
    password: "New password",
    confirmPassword: "Confirm new password",
    placeholder: "At least 8 characters",
    mismatch: "Passwords do not match.",
    tooShort: "The password must have at least 8 characters.",
    save: "Save my new password",
    saving: "Saving…",
    checking: "Verifying your link…",
    show: "Show password",
    hide: "Hide password",
    genericError: "Something went wrong. Please try again or request a new link.",
    successTitle: "Password changed",
    successText: "Your new password was saved. You can now sign in with your email address.",
    logoutTitle: "Session must be closed",
    logoutText: "Password recovery cannot continue while an old ORIA session is still active. Close it before returning to sign in.",
    retryLogout: "Close session and continue",
    login: "Return to sign in",
  },
} as const;

/**
 * IMPORTANT: Supabase verifyOtp() normally creates an authenticated session.
 * Use a separate, MEMORY-ONLY client so a verified recovery link NEVER signs
 * the normal ORIA browser client into /chat.
 */
function newRecoveryClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public configuration is missing");
  return createEphemeralClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Remove an old / normal ORIA session locally, without revoking other devices. */
async function closeWebsiteSession(): Promise<void> {
  const auth = createWebsiteClient().auth;
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (data.session) {
    const { error: logoutError } = await auth.signOut({ scope: "local" });
    if (logoutError) throw logoutError;
  }
  const { data: after, error: checkError } = await auth.getSession();
  if (checkError || after.session) throw checkError ?? new Error("Old session remains active");
}

export default function ResetPasswordPage() {
  const [language, setLanguage] = useState<Language>("fr");
  const [status, setStatus] = useState<Status>("initializing");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const startedRef = useRef(false);
  const tokenHashRef = useRef<string | null>(null);
  const recoveryClientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "fr" || saved === "en" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Read the token ONCE. Remove it from browser history before any async work.
    const parameters = new URLSearchParams(window.location.search);
    const token = parameters.get("token_hash");
    tokenHashRef.current = parameters.get("type") === "recovery" && token ? token : null;
    window.history.replaceState(window.history.state, "", "/reset-password");

    // Always clear any older ORIA web session first, including one left behind
    // by a failed recovery. Do NOT verify or consume the token on page load.
    void closeWebsiteSession()
      .then(() => setStatus(tokenHashRef.current ? "confirm" : "invalid"))
      .catch(() => setStatus("logout-error"));
  }, []);

  const t = UI[language];

  useEffect(() => {
    if (status !== "success") return;
    const timeout = window.setTimeout(() => window.location.replace("/login"), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function handleVerify() {
    if (status !== "confirm" || loading || !tokenHashRef.current) return;
    setErrorMessage("");
    setLoading(true);
    try {
      // Explicit user click: automated mail scanners loading this page should
      // not consume the one-time Supabase token.
      const recoveryClient = newRecoveryClient();
      const { data, error } = await recoveryClient.auth.verifyOtp({
        token_hash: tokenHashRef.current,
        type: "recovery",
      });
      if (error || !data.session || !data.user) {
        tokenHashRef.current = null;
        setStatus("invalid");
        return;
      }
      const { data: userData, error: userError } = await recoveryClient.auth.getUser();
      if (userError || !userData.user || userData.user.id !== data.user.id) {
        tokenHashRef.current = null;
        await recoveryClient.auth.signOut({ scope: "local" });
        setStatus("invalid");
        return;
      }
      tokenHashRef.current = null;
      recoveryClientRef.current = recoveryClient;
      setStatus("ready");
    } catch {
      // A transient network problem is not proof the token is invalid.
      setErrorMessage(t.genericError);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "ready" || loading || !recoveryClientRef.current) return;
    setErrorMessage("");
    if (password.length < 8) { setErrorMessage(t.tooShort); return; }
    if (password !== confirmPassword) { setErrorMessage(t.mismatch); return; }
    setLoading(true);
    let passwordUpdated = false;
    try {
      const recoveryClient = recoveryClientRef.current;
      const { data, error } = await recoveryClient.auth.getUser();
      if (error || !data.user) throw new Error("Recovery session unavailable");
      const update = await recoveryClient.auth.updateUser({ password });
      if (update.error) throw update.error;
      passwordUpdated = true;

      // Password changed: never leave an authenticated recovery session behind.
      setPassword("");
      setConfirmPassword("");
      recoveryClientRef.current = null;
      const logout = await recoveryClient.auth.signOut({ scope: "local" });
      if (logout.error) console.warn("ORIA: isolated recovery sign-out failed; ephemeral session won't be persisted");
      await closeWebsiteSession();
      setStatus("success");
    } catch {
      if (passwordUpdated) setStatus("logout-error");
      setErrorMessage(t.genericError);
    } finally {
      setLoading(false);
    }
  }

  async function goToLogin() {
    if (loading) return;
    setLoading(true);
    setErrorMessage("");
    try {
      if (recoveryClientRef.current) {
        await recoveryClientRef.current.auth.signOut({ scope: "local" });
        recoveryClientRef.current = null;
      }
      await closeWebsiteSession();
      window.location.replace("/login");
    } catch {
      setStatus("logout-error");
      setErrorMessage(t.genericError);
      setLoading(false);
    }
  }

  async function retryLogout() {
    if (loading) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await closeWebsiteSession();
      // Invalid/no link stays invalid; an unused valid link may be verified.
      setStatus(tokenHashRef.current ? "confirm" : "invalid");
    } catch {
      setErrorMessage(t.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center px-5 sm:px-8">
        <div className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"><Sparkles size={18} /> Oria.</div>
      </header>
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center px-5 pb-20 sm:px-0">
        <section className="w-full rounded-[30px] border border-border/70 bg-surface/85 p-6 shadow-[0_22px_65px_-38px_var(--shadow-color)] sm:p-8">
          <button type="button" disabled={loading} onClick={() => void goToLogin()} className="mb-8 text-sm text-muted-strong hover:text-foreground disabled:opacity-50">
            ← {t.login}
          </button>
          <div className="flex h-12 w-12 items-center justify-center rounded-[19px] border border-border/40 bg-accent text-accent-foreground">
            {status === "success" ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
            {status === "confirm" ? t.confirmTitle : status === "invalid" ? t.invalidTitle : status === "success" ? t.successTitle : status === "logout-error" ? t.logoutTitle : t.title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted" aria-live="polite">
            {status === "initializing" ? t.prepare : status === "confirm" ? t.confirmText : status === "ready" ? t.readyText : status === "invalid" ? t.invalidText : status === "success" ? t.successText : status === "logout-error" ? t.logoutText : t.prepare}
          </p>

          {status === "initializing" ? <div className="mt-7 flex items-center gap-2 text-sm text-muted"><Loader2 size={18} className="animate-spin" />{t.prepare}</div> : null}
          {status === "confirm" ? (
            <button type="button" onClick={() => void handleVerify()} disabled={loading} className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">
              {loading ? <><Loader2 size={17} className="animate-spin" />{t.checking}</> : t.confirmButton}
            </button>
          ) : null}
          {status === "invalid" ? <Link href="/forgot-password" className="mt-7 flex h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground">{t.newLink}</Link> : null}
          {status === "logout-error" ? <button type="button" onClick={() => void retryLogout()} disabled={loading} className="mt-7 flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">{t.retryLogout}</button> : null}
          {status === "success" ? <button type="button" disabled={loading} onClick={() => void goToLogin()} className="mt-7 flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground">{t.login}</button> : null}

          {status === "ready" ? (
            <form onSubmit={handleSave} className="mt-7 space-y-5">
              <div>
                <label htmlFor="new-password" className="mb-2 block text-sm font-medium">{t.password}</label>
                <div className="relative">
                  <input id="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                    value={password} onChange={event => setPassword(event.target.value)} disabled={loading} placeholder={t.placeholder}
                    className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 pr-12 text-[15px] text-foreground outline-none focus:border-border-strong" />
                  <button type="button" aria-label={showPassword ? t.hide : t.show} onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-foreground">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium">{t.confirmPassword}</label>
                <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                  value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={loading}
                  className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 text-[15px] text-foreground outline-none focus:border-border-strong" />
              </div>
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">
                {loading ? <><Loader2 size={17} className="animate-spin" />{t.saving}</> : t.save}
              </button>
            </form>
          ) : null}
          {errorMessage ? <p role="alert" className="mt-4 rounded-2xl border border-red-200/70 bg-danger-surface px-4 py-3 text-sm text-danger">{errorMessage}</p> : null}
        </section>
      </div>
    </main>
  );
}
