"use client";

import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    back: "Retour",
    welcomeBack: "Bon retour.",
    loginDescription:
      "Connectez-vous à votre compte Oria pour continuer.",
    emailAddress: "Adresse e-mail",
    emailPlaceholder: "vous@exemple.com",
    password: "Mot de passe",
    forgotPassword: "Mot de passe oublié ?",
    passwordPlaceholder: "Votre mot de passe",
    hidePassword: "Masquer le mot de passe",
    showPassword: "Afficher le mot de passe",
    emailNotConfirmed:
      "Votre adresse e-mail n'est pas encore confirmée. Consultez votre boîte mail pour activer votre compte.",
    invalidCredentials:
      "Adresse e-mail ou mot de passe incorrect.",
    loginSuccess: "Connexion réussie. Redirection...",
    loggingIn: "Connexion...",
    signIn: "Se connecter",
    noAccount: "Vous n'avez pas encore de compte ?",
    createAccount: "Créer un compte",
    legalNotice:
      "En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité de Oria.",
  },
  en: {
    back: "Back",
    welcomeBack: "Welcome back.",
    loginDescription:
      "Sign in to your Oria account to continue.",
    emailAddress: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    forgotPassword: "Forgot password?",
    passwordPlaceholder: "Your password",
    hidePassword: "Hide password",
    showPassword: "Show password",
    emailNotConfirmed:
      "Your email address has not been confirmed yet. Check your inbox to activate your account.",
    invalidCredentials:
      "Incorrect email address or password.",
    loginSuccess: "Signed in successfully. Redirecting...",
    loggingIn: "Signing in...",
    signIn: "Sign in",
    noAccount: "Don't have an account yet?",
    createAccount: "Create an account",
    legalNotice:
      "By continuing, you agree to Oria's terms of use and privacy policy.",
  },
} as const;

function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") {
    return "fr";
  }

  const saved = window.localStorage.getItem(
    ORIA_LANGUAGE_STORAGE_KEY,
  );

  if (saved === "fr" || saved === "en") {
    return saved;
  }

  return window.navigator.language
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "fr";
}

function localizeSupabaseError(
  message: string,
  language: OriaLanguage,
): string {
  if (language === "fr") {
    return message;
  }

  const exact: Record<string, string> = {
    "Invalid login credentials":
      UI.en.invalidCredentials,
    "Email not confirmed":
      UI.en.emailNotConfirmed,
  };

  return exact[message] ?? message;
}


export default function LoginPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
    };

    syncLanguage();

    window.addEventListener(
      "storage",
      syncLanguage,
    );
    window.addEventListener(
      "oria-language-change",
      syncLanguage,
    );

    return () => {
      window.removeEventListener(
        "storage",
        syncLanguage,
      );
      window.removeEventListener(
        "oria-language-change",
        syncLanguage,
      );
    };
  }, []);

  const [showPassword, setShowPassword] =
    useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    const supabase = createClient();

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      console.error(
        "SUPABASE LOGIN ERROR:",
        error,
      );

      if (
        error.code ===
        "email_not_confirmed"
      ) {
        setErrorMessage(
          UI[language].emailNotConfirmed,
        );
      } else if (
        error.code ===
        "invalid_credentials"
      ) {
        setErrorMessage(
          UI[language].invalidCredentials,
        );
      } else {
        setErrorMessage(
          localizeSupabaseError(
            error.message,
            language,
          ),
        );
      }

      setLoading(false);
      return;
    }

    console.log(
      "Oria : accès accordé.",
    );

    setSuccessMessage(
      UI[language].loginSuccess,
    );

    /*
     * Rechargement complet volontaire.
     *
     * Cela permet aux cookies/session Supabase
     * d'être correctement pris en compte avant
     * d'arriver dans /chat.
     */
    window.location.href = "/chat";
  }

  return (
    <main className="min-h-dvh overflow-x-clip bg-background text-foreground oria-page-enter">
      {/* Header */}

      <header className="absolute left-0 right-0 top-0 z-20">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-5 sm:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl px-2 py-1.5 text-sm font-semibold tracking-tight transition-[background-color,opacity] duration-200 hover:bg-surface-secondary/60 hover:opacity-90"
          >
            <Sparkles size={18} />

            Oria.
          </Link>
        </div>
      </header>

      {/* Login area */}

      <div className="flex min-h-dvh items-center justify-center px-5 py-24 sm:px-8">
        <div className="w-full max-w-md">
          <div className="relative rounded-[30px] border border-border/70 bg-surface/95 p-6 shadow-[0_22px_65px_-38px_var(--shadow-color)] backdrop-blur-sm sm:p-8 oria-auth-enter">
            {/* Back */}

            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 rounded-xl px-1 py-1 text-sm text-muted-strong transition-colors hover:text-foreground"
            >
              <ArrowLeft size={16} />

              {UI[language].back}
            </Link>

            {/* Intro */}

            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-[19px] border border-border/40 bg-accent text-accent-foreground shadow-[0_10px_26px_-19px_var(--shadow-color)]">
                <LockKeyhole size={19} />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                Bon retour.
              </h1>

              <p className="mt-2 text-sm leading-7 text-muted">
                Connectez-vous à votre compte
                Oria pour continuer.
              </p>
            </div>

            {/* Form */}

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-5"
            >
              {/* Email */}

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium"
                >
                  Adresse e-mail
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={UI[language].emailPlaceholder}
                  required
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value,
                    )
                  }
                  disabled={loading}
                  className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 text-[15px] text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.015)] outline-none transition-[background-color,border-color,box-shadow] duration-200 placeholder:text-muted focus:border-border-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* Password */}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium"
                  >
                    Mot de passe
                  </label>

                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-muted-strong transition hover:text-foreground hover:underline"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="current-password"
                    placeholder={UI[language].passwordPlaceholder}
                    required
                    value={password}
                    onChange={(event) =>
                      setPassword(
                        event.target.value,
                      )
                    }
                    disabled={loading}
                    className="h-12 w-full rounded-2xl border border-border/75 bg-surface-secondary/65 px-4 pr-12 text-[15px] text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.015)] outline-none transition-[background-color,border-color,box-shadow] duration-200 placeholder:text-muted focus:border-border-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showPassword
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                    onClick={() =>
                      setShowPassword(
                        !showPassword,
                      )
                    }
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 text-muted transition-colors duration-200 hover:bg-surface-tertiary hover:text-foreground disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-200/70 bg-danger-surface px-4 py-3 text-sm leading-6 text-danger dark:border-red-900/35"
                >
                  {errorMessage}
                </div>
              )}

              {/* Success */}

              {successMessage && (
                <div
                  role="status"
                  className="rounded-2xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 text-sm leading-6 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400"
                >
                  {successMessage}
                </div>
              )}

              {/* Submit */}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-[0_13px_26px_-21px_var(--shadow-color)] transition-[opacity,transform] duration-200 hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 oria-press"
              >
                {loading ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin oria-loader-icon"
                    />

                    Connexion...
                  </>
                ) : (
                  "Se connecter"
                )}
              </button>
            </form>

            {/* Register */}

            <p className="mt-7 text-center text-sm text-muted">
              Vous n&apos;avez pas encore de
              compte ?{" "}
              <Link
                href="/register"
                className="font-medium text-foreground hover:underline"
              >
                Créer un compte
              </Link>
            </p>
          </div>

          {/* Legal */}

          <p className="mt-5 text-center text-xs leading-5 text-muted">
            {UI[language].legalNotice}
          </p>
        </div>
      </div>
    </main>
  );
}