"use client";

import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Language = "fr" | "en";

// Toujours utiliser le domaine officiel, même si la demande part de localhost.
const RECOVERY_REDIRECT_URL = "https://www.myoriaai.com/reset-password?flow=recovery";

const translations = {
  fr: {
    back: "Retour à la connexion",
    title: "Mot de passe oublié ?",
    description: "Indique ton adresse e-mail. Nous t'enverrons un lien sécurisé pour choisir un nouveau mot de passe.",
    email: "Adresse e-mail",
    placeholder: "vous@exemple.com",
    send: "Envoyer le lien de réinitialisation",
    sending: "Envoi en cours…",
    successTitle: "Consulte ta boîte mail",
    success: "Si un compte ORIA correspond à cette adresse, un lien de réinitialisation vient de lui être envoyé. Vérifie aussi les courriers indésirables.",
    retry: "Utiliser une autre adresse",
    error: "Impossible d'envoyer le lien pour le moment. Réessaie dans quelques instants.",
    security: "Pour protéger les comptes, nous ne confirmons jamais si une adresse est enregistrée.",
  },
  en: {
    back: "Back to sign in",
    title: "Forgot your password?",
    description: "Enter your email. We'll send you a secure link to choose a new password.",
    email: "Email address",
    placeholder: "you@example.com",
    send: "Send reset link",
    sending: "Sending…",
    successTitle: "Check your inbox",
    success: "If an ORIA account exists for this address, a password reset link has been sent. Check your spam folder, too.",
    retry: "Use another email",
    error: "We couldn't send the link right now. Please try again shortly.",
    security: "To protect accounts, we never disclose whether an email is registered.",
  },
} as const;

export default function ForgotPasswordPage() {
  const [language, setLanguage] = useState<Language>("fr");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("oria_language");
    setLanguage(saved === "en" || saved === "fr" ? saved : window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr");
  }, []);

  const t = translations[language];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setErrorMessage("");
    setLoading(true);
    try {
      // URL de production fixe : l’email ne doit jamais ouvrir localhost sur un autre appareil.
      const redirectTo = RECOVERY_REDIRECT_URL;
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo,
      });
      if (error) throw error;
      // Never reveal whether the entered email belongs to an ORIA account.
      setSent(true);
    } catch (error) {
      console.error("ORIA PASSWORD RESET REQUEST ERROR", error);
      setErrorMessage(t.error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center px-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles size={18} /> Oria.
        </Link>
      </header>
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md items-center px-5 pb-20 sm:px-0">
        <section className="w-full rounded-[30px] border border-border/70 bg-surface/85 p-6 shadow-[0_22px_65px_-38px_var(--shadow-color)] sm:p-8">
          <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-strong hover:text-foreground">
            <ArrowLeft size={16} /> {t.back}
          </Link>
          <div className="flex h-12 w-12 items-center justify-center rounded-[19px] border border-border/40 bg-accent text-accent-foreground">
            {sent ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">{sent ? t.successTitle : t.title}</h1>
          <p className="mt-3 text-sm leading-7 text-muted">{sent ? t.success : t.description}</p>

          {!sent ? (
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label htmlFor="recovery-email" className="mb-2 block text-sm font-medium">{t.email}</label>
                <div className="relative">
                  <Mail size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    id="recovery-email" type="email" name="email" autoComplete="email" required
                    value={email} disabled={loading} onChange={(event) => setEmail(event.target.value)}
                    placeholder={t.placeholder}
                    className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 pl-12 pr-4 text-[15px] text-foreground outline-none placeholder:text-muted focus:border-border-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--focus-ring)]"
                  />
                </div>
              </div>
              {errorMessage ? <p role="alert" className="rounded-2xl border border-red-200/70 bg-danger-surface px-4 py-3 text-sm text-danger">{errorMessage}</p> : null}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60">
                {loading ? <><Loader2 size={17} className="animate-spin" />{t.sending}</> : t.send}
              </button>
              <p className="text-center text-xs leading-5 text-muted">{t.security}</p>
            </form>
          ) : (
            <div className="mt-7 space-y-4">
              <button type="button" className="flex h-12 w-full items-center justify-center rounded-2xl border border-border/75 text-sm font-semibold hover:bg-surface-secondary" onClick={() => { setSent(false); setErrorMessage(""); }}>
                {t.retry}
              </button>
              <Link href="/login" className="block text-center text-sm font-medium text-muted-strong hover:text-foreground">{t.back}</Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
