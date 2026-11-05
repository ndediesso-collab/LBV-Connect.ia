"use client";

import { CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import Link from "next/link";
import { createClient as createEphemeralClient, type SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient as createWebsiteClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Status = "initializing" | "confirm" | "ready" | "invalid" | "success" | "logout-error";
type InvalidReason = "missing" | "server-rejected" | "verification-failed";

type RecoveryLink =
  | { kind: "direct"; tokenHash: string }
  | { kind: "legacy-session"; accessToken: string; refreshToken: string }
  | { kind: "legacy-code"; code: string }
  | { kind: "invalid"; reason: InvalidReason };

/**
 * Recognize the custom ORIA token_hash email and both legacy Supabase redirects.
 * Parsing NEVER sends, consumes, or logs a secret. URL input is immediately
 * cleared by the caller before any asynchronous work.
 */
function parseRecoveryLink(search: string, hash: string): RecoveryLink {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));

  // Supabase can redirect here with an error if its /verify endpoint already
  // consumed/rejected the link (for example after an email scanner request).
  if (query.has("error") || fragment.has("error")) {
    return { kind: "invalid", reason: "server-rejected" };
  }

  const tokenHash = query.get("token_hash");
  const tokenType = query.get("type") ?? query.get("amp;type");
  if (tokenHash && tokenType === "recovery") {
    return { kind: "direct", tokenHash };
  }

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (fragment.get("type") === "recovery" && accessToken && refreshToken) {
    return { kind: "legacy-session", accessToken, refreshToken };
  }

  const code = query.get("code");
  if (query.get("flow") === "recovery" && code) {
    return { kind: "legacy-code", code };
  }

  // Never treat an existing login as a recovery entitlement.
  return { kind: "invalid", reason: "missing" };
}


const UI = {
  fr: {
    title: "Créer un nouveau mot de passe",
    prepare: "Préparation sécurisée de votre récupération…",
    confirmTitle: "Confirmer la récupération",
    confirmText: "Vous avez ouvert un lien de récupération ORIA. Cliquez ci-dessous pour vérifier ce lien à usage unique, puis choisissez votre nouveau mot de passe.",
    confirmButton: "Vérifier mon lien et continuer",
    readyText: "Lien vérifié. Choisissez maintenant votre nouveau mot de passe.",
    invalidTitle: "Lien de récupération non utilisable",
    invalidText: "Ce lien ne peut pas être vérifié. Votre mot de passe n'a pas été modifié.",
    missingText: "Le lien ouvert ne contient pas les informations de récupération attendues. Il s'agit peut-être d'un ancien modèle d'email Supabase ou d'une redirection qui a supprimé les paramètres.",
    rejectedText: "Supabase a rejeté ce lien avant l'ouverture du formulaire. Il peut avoir expiré ou été ouvert automatiquement par un système de vérification des emails.",
    failedText: "Supabase n'a pas pu valider ce lien. Il est peut-être expiré, déjà consommé ou issu d'un ancien format incompatible.",
    diagnosticDirect: "Lien ORIA détecté",
    diagnosticLegacy: "Ancien lien Supabase reconnu",
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
    invalidTitle: "Recovery link cannot be used",
    invalidText: "The link could not be verified. Your password has not been changed.",
    missingText: "This link does not include the expected recovery parameters. It may have come from an old Supabase email template, or a redirect may have removed them.",
    rejectedText: "Supabase rejected the link before the form opened. It may have expired or been visited automatically by an email scanner.",
    failedText: "Supabase could not verify this link. It may be expired, already consumed, or from an incompatible legacy flow.",
    diagnosticDirect: "ORIA link detected",
    diagnosticLegacy: "Legacy Supabase link recognized",
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
  const [invalidReason, setInvalidReason] = useState<InvalidReason>("missing");
  const [linkKind, setLinkKind] = useState<RecoveryLink["kind"]>("invalid");
  const startedRef = useRef(false);
  const linkRef = useRef<RecoveryLink | null>(null);
  const recoveryClientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "fr" || saved === "en" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Capture an email link exactly once and hide its secrets from browser
    // history *before* doing any Supabase calls or changing browser routes.
    const link = parseRecoveryLink(window.location.search, window.location.hash);
    linkRef.current = link;
    setLinkKind(link.kind);
    if (link.kind === "invalid") setInvalidReason(link.reason);
    window.history.replaceState(window.history.state, "", "/reset-password");

    // A recovery link is not an ordinary sign-in. Clear an old website session,
    // and keep any temporary recovery credentials in an isolated client.
    void closeWebsiteSession()
      .then(() => setStatus(link.kind === "invalid" ? "invalid" : "confirm"))
      .catch(() => setStatus("logout-error"));
  }, []);

  const t = UI[language];

  useEffect(() => {
    if (status !== "success") return;
    const timeout = window.setTimeout(() => window.location.replace("/login"), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function handleVerify() {
    const link = linkRef.current;
    if (status !== "confirm" || loading || !link || link.kind === "invalid") return;
    setErrorMessage("");
    setLoading(true);
    try {
      // Wait for a physical click: email previewers fetching the ORIA page
      // must not consume the Supabase one-time recovery token.
      const recoveryClient = newRecoveryClient();
      let verifiedUserId: string | null = null;

      if (link.kind === "direct") {
        const { data, error } = await recoveryClient.auth.verifyOtp({
          token_hash: link.tokenHash,
          type: "recovery",
        });
        if (!error && data.session && data.user) verifiedUserId = data.user.id;
      } else if (link.kind === "legacy-session") {
        // Supabase default email verification may redirect back with an
        // authenticated recovery session in the URL fragment. Import it into
        // MEMORY-ONLY storage, never the regular website client.
        const { data, error } = await recoveryClient.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        if (!error && data.session && data.user) verifiedUserId = data.user.id;
      } else if (link.kind === "legacy-code") {
        // PKCE requires the original browser code_verifier. It can fail when
        // mail is opened on a different device; direct token_hash links work
        // across devices and should be used for new recovery emails.
        const { data, error } = await recoveryClient.auth.exchangeCodeForSession(link.code);
        if (!error && data.session && data.user) verifiedUserId = data.user.id;
      }

      // Release secrets even after failure. Never grant the form merely
      // because an unrelated website session happens to exist.
      linkRef.current = null;
      if (!verifiedUserId) {
        setInvalidReason("verification-failed");
        setStatus("invalid");
        return;
      }
      const { data: userData, error: userError } = await recoveryClient.auth.getUser();
      if (userError || !userData.user || userData.user.id !== verifiedUserId) {
        await recoveryClient.auth.signOut({ scope: "local" });
        setInvalidReason("verification-failed");
        setStatus("invalid");
        return;
      }
      recoveryClientRef.current = recoveryClient;
      setStatus("ready");
    } catch {
      // Network errors do not prove the OTP was rejected by Supabase.
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
      setStatus(linkRef.current && linkRef.current.kind !== "invalid" ? "confirm" : "invalid");
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
            {status === "initializing" ? t.prepare : status === "confirm" ? t.confirmText : status === "ready" ? t.readyText : status === "invalid" ? (
              invalidReason === "missing" ? t.missingText : invalidReason === "server-rejected" ? t.rejectedText : t.failedText
            ) : status === "success" ? t.successText : status === "logout-error" ? t.logoutText : t.prepare}
          </p>

          {status === "confirm" ? <p className="mt-3 text-xs text-muted" aria-live="polite">{linkKind === "direct" ? t.diagnosticDirect : t.diagnosticLegacy}</p> : null}
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
