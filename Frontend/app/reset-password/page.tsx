"use client";

import { CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { createClient as createEphemeralClient, type SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient as createWebsiteClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Status = "initializing" | "form" | "invalid" | "success" | "logout-error";
type RecoveryLink =
  | { kind: "direct"; tokenHash: string }
  | { kind: "legacy-session"; accessToken: string; refreshToken: string }
  | { kind: "legacy-code"; code: string }
  | { kind: "invalid" };

/** Identify a recovery link without contacting Supabase or consuming its token. */
function parseRecoveryLink(search: string, hash: string): RecoveryLink {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  if (query.has("error") || fragment.has("error")) return { kind: "invalid" };

  const tokenHash = query.get("token_hash");
  if (tokenHash && (query.get("type") ?? query.get("amp;type")) === "recovery") {
    return { kind: "direct", tokenHash };
  }

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (fragment.get("type") === "recovery" && accessToken && refreshToken) {
    return { kind: "legacy-session", accessToken, refreshToken };
  }

  const code = query.get("code");
  if (query.get("flow") === "recovery" && code) return { kind: "legacy-code", code };
  return { kind: "invalid" };
}

const UI = {
  fr: {
    back: "Retour à la connexion",
    title: "Créer un nouveau mot de passe",
    description: "Choisissez un nouveau mot de passe pour votre compte ORIA.",
    prepare: "Préparation du formulaire sécurisé…",
    password: "Nouveau mot de passe",
    confirm: "Confirmer le mot de passe",
    placeholder: "Au moins 8 caractères",
    save: "Modifier mon mot de passe",
    saving: "Enregistrement sécurisé…",
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
    tooShort: "Utilisez au moins 8 caractères.",
    mismatch: "Les deux mots de passe ne correspondent pas.",
    invalidTitle: "Ce lien ne fonctionne plus",
    invalidDescription: "Le lien est incomplet, expiré ou déjà utilisé. Aucun mot de passe n'a été modifié. Demandez un nouvel email de récupération.",
    invalidAfterVerify: "Supabase a refusé ce lien. Il peut être expiré ou déjà utilisé. Demandez-en un nouveau.",
    newLink: "Demander un nouveau lien",
    successTitle: "Mot de passe modifié",
    successDescription: "Votre nouveau mot de passe a été enregistré. Retour à la connexion…",
    logoutTitle: "Impossible de fermer une ancienne session",
    logoutDescription: "Pour empêcher l'accès automatique au chat, ORIA doit d'abord fermer la session du navigateur. Réessayez ; si le mot de passe a déjà été enregistré, ne le soumettez pas de nouveau.",
    logout: "Réessayer la déconnexion",
    genericError: "Impossible de finaliser cette opération. Réessayez ou demandez un nouveau lien.",
    sessionError: "La session temporaire de récupération n'est plus disponible. Demandez un nouveau lien.",
  },
  en: {
    back: "Back to sign in",
    title: "Create a new password",
    description: "Choose a new password for your ORIA account.",
    prepare: "Preparing secure password form…",
    password: "New password",
    confirm: "Confirm password",
    placeholder: "At least 8 characters",
    save: "Change my password",
    saving: "Saving securely…",
    show: "Show password",
    hide: "Hide password",
    tooShort: "Use at least 8 characters.",
    mismatch: "The two passwords do not match.",
    invalidTitle: "This link no longer works",
    invalidDescription: "The link is incomplete, expired or has already been used. Your password was not changed. Request a new recovery email.",
    invalidAfterVerify: "Supabase rejected this link. It may have expired or been used. Request a new one.",
    newLink: "Request a new link",
    successTitle: "Password changed",
    successDescription: "Your new password has been saved. Returning to sign in…",
    logoutTitle: "Could not close a previous session",
    logoutDescription: "ORIA must sign out the browser session to prevent direct chat access. Retry sign-out; if the password was already saved, do not submit it again.",
    logout: "Retry sign-out",
    genericError: "Could not complete this operation. Retry or request a new link.",
    sessionError: "The temporary recovery session is no longer available. Request a new link.",
  },
} as const;

/** An isolated client: a verified email link must NEVER log in the normal ORIA app. */
function newRecoveryClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase configuration missing");
  return createEphemeralClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Close only this browser's normal ORIA session, not the user's other devices. */
async function closeWebsiteSession(): Promise<void> {
  const { auth } = createWebsiteClient();
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (data.session) {
    const { error: signOutError } = await auth.signOut({ scope: "local" });
    if (signOutError) throw signOutError;
  }
  const { data: after, error: checkError } = await auth.getSession();
  if (checkError || after.session) throw checkError ?? new Error("Website session still active");
}

export default function ResetPasswordPage() {
  const [language, setLanguage] = useState<Language>("fr");
  const [status, setStatus] = useState<Status>("initializing");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const startedRef = useRef(false);
  const recoveryLinkRef = useRef<RecoveryLink | null>(null);
  const recoveryClientRef = useRef<SupabaseClient | null>(null);
  const passwordChangedRef = useRef(false);
  const t = UI[language];

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "fr" || saved === "en" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Capture secrets once, then remove them from the address bar/history.
    const link = parseRecoveryLink(window.location.search, window.location.hash);
    recoveryLinkRef.current = link;
    window.history.replaceState(window.history.state, "", "/reset-password");

    // The public reset page never grants normal website access.
    void closeWebsiteSession()
      .then(() => setStatus(link.kind === "invalid" ? "invalid" : "form"))
      .catch(() => setStatus("logout-error"));
  }, []);

  useEffect(() => {
    if (status !== "success") return;
    const handle = window.setTimeout(() => window.location.replace("/login"), 1700);
    return () => window.clearTimeout(handle);
  }, [status]);

  /** No separate Verify button. Security checks happen only on form submission. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "form" || loading) return;
    setErrorMessage("");
    if (password.length < 8) { setErrorMessage(t.tooShort); return; }
    if (confirmation !== password) { setErrorMessage(t.mismatch); return; }
    setLoading(true);
    try {
      let client = recoveryClientRef.current;
      if (!client) {
        const link = recoveryLinkRef.current;
        if (!link || link.kind === "invalid") { setStatus("invalid"); return; }
        client = newRecoveryClient();
        let valid = false;
        if (link.kind === "direct") {
          const { data, error } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: "recovery" });
          valid = !error && !!data.session && !!data.user;
        } else if (link.kind === "legacy-session") {
          const { data, error } = await client.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
          valid = !error && !!data.session && !!data.user;
        } else if (link.kind === "legacy-code") {
          // A PKCE code may require the original browser's code_verifier.
          const { data, error } = await client.auth.exchangeCodeForSession(link.code);
          valid = !error && !!data.session && !!data.user;
        }
        recoveryLinkRef.current = null;
        if (!valid) { setErrorMessage(t.invalidAfterVerify); setStatus("invalid"); return; }
        recoveryClientRef.current = client;
      }

      // The verified session belongs ONLY to this ephemeral, non-persisted client.
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) { setErrorMessage(t.sessionError); setStatus("invalid"); return; }

      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) {
        // Keep the verified in-memory session for a retry if Supabase rejects a weak password.
        setErrorMessage(updateError.message || t.genericError);
        return;
      }
      passwordChangedRef.current = true;
      setPassword("");
      setConfirmation("");
      recoveryClientRef.current = null;
      recoveryLinkRef.current = null;
      try { await client.auth.signOut({ scope: "local" }); } catch { /* ephemeral only */ }
      await closeWebsiteSession();
      setStatus("success");
    } catch {
      setErrorMessage(t.genericError);
      if (passwordChangedRef.current) setStatus("logout-error");
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
      if (passwordChangedRef.current) { setStatus("success"); return; }
      setStatus(recoveryLinkRef.current?.kind && recoveryLinkRef.current.kind !== "invalid" ? "form" : "invalid");
    } catch {
      setErrorMessage(t.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center px-5 sm:px-8">
        <div className="inline-flex items-center gap-2 text-base font-semibold tracking-tight"><Sparkles size={20} />Oria.</div>
      </header>
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-lg items-center px-5 pb-20 sm:px-0">
        <section className="w-full rounded-[30px] border border-border/70 bg-surface/95 p-6 shadow-[0_22px_65px_-38px_var(--shadow-color)] sm:p-9">
          <button type="button" disabled={loading} onClick={() => void goToLogin()} className="mb-9 text-sm text-muted-strong transition-colors hover:text-foreground disabled:opacity-50">
            ← {t.back}
          </button>
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[19px] border border-border/40 bg-accent text-accent-foreground">
            {status === "success" ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            {status === "invalid" ? t.invalidTitle : status === "success" ? t.successTitle : status === "logout-error" ? t.logoutTitle : t.title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted" aria-live="polite">
            {status === "initializing" ? t.prepare : status === "invalid" ? t.invalidDescription : status === "success" ? t.successDescription : status === "logout-error" ? t.logoutDescription : t.description}
          </p>

          {status === "initializing" ? (
            <div className="mt-7 flex items-center gap-2 text-sm text-muted"><Loader2 size={18} className="animate-spin" />{t.prepare}</div>
          ) : null}
          {status === "form" ? (
            <form onSubmit={handleSave} className="mt-8 space-y-5">
              <div>
                <label htmlFor="new-password" className="mb-2 block text-sm font-medium">{t.password}</label>
                <div className="relative">
                  <input id="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                    value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} placeholder={t.placeholder}
                    className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 pr-12 text-[15px] text-foreground outline-none focus:border-border-strong disabled:opacity-60" />
                  <button type="button" aria-label={showPassword ? t.hide : t.show} disabled={loading} onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-foreground disabled:opacity-60">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium">{t.confirm}</label>
                <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8}
                  value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={loading} placeholder={t.placeholder}
                  className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 text-[15px] text-foreground outline-none focus:border-border-strong disabled:opacity-60" />
              </div>
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
                {loading ? <><Loader2 size={17} className="animate-spin" />{t.saving}</> : t.save}
              </button>
            </form>
          ) : null}
          {status === "invalid" ? (
            <a href="/forgot-password" className="mt-7 flex h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground">{t.newLink}</a>
          ) : null}
          {status === "logout-error" ? (
            <button type="button" disabled={loading} onClick={() => void retryLogout()} className="mt-7 flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">{t.logout}</button>
          ) : null}
          {status === "success" ? (
            <button type="button" onClick={() => void goToLogin()} className="mt-7 flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground">{t.back}</button>
          ) : null}
          {errorMessage ? <p role="alert" className="mt-5 rounded-2xl border border-red-200/70 bg-danger-surface px-4 py-3 text-sm text-danger">{errorMessage}</p> : null}
        </section>
      </div>
    </main>
  );
}
