"use client";

import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const firstName = String(
      formData.get("firstName") ?? "",
    ).trim();

    const lastName = String(
      formData.get("lastName") ?? "",
    ).trim();

    const phone = String(
      formData.get("phone") ?? "",
    ).trim();

    const email = String(
      formData.get("email") ?? "",
    )
      .trim()
      .toLowerCase();

    const password = String(
      formData.get("password") ?? "",
    );

    const confirmPassword = String(
      formData.get("confirmPassword") ?? "",
    );

    if (!phone) {
      setError(
        "Veuillez renseigner votre numéro de téléphone.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(
        "Les mots de passe ne correspondent pas.",
      );
      return;
    }

    if (password.length < 8) {
      setError(
        "Le mot de passe doit contenir au moins 8 caractères.",
      );
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const { data, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              phone,
            },
          },
        });

      if (signUpError) {
        setError(
          signUpError.message ||
            "Impossible de créer le compte. Veuillez réessayer.",
        );
        return;
      }

      /*
       * Si Supabase demande une confirmation
       * e-mail, l'utilisateur n'est pas encore
       * connecté.
       */
      if (data.user && !data.session) {
        setMessage(
          "Compte créé avec succès. Consultez votre boîte e-mail pour confirmer votre adresse.",
        );

        form.reset();
        return;
      }

      /*
       * Si la confirmation e-mail est désactivée,
       * Supabase peut créer directement une session.
       */
      if (data.session) {
        window.location.href = "/chat";
        return;
      }

      setMessage(
        "Votre compte a été créé. Vérifiez votre adresse e-mail pour continuer.",
      );
    } catch (error) {
      console.error(
        "SUPABASE REGISTER ERROR:",
        error,
      );

      setError(
        "Une erreur inattendue est survenue. Veuillez réessayer.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Header */}

      <header className="absolute left-0 right-0 top-0">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight transition-opacity hover:opacity-70"
          >
            <Sparkles size={18} />

            LBV-Connect.ia
          </Link>
        </div>
      </header>

      {/* Register area */}

      <div className="flex min-h-dvh items-center justify-center px-5 py-24 sm:px-8">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
            {/* Back */}

            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 text-sm text-muted-strong transition hover:text-foreground"
            >
              <ArrowLeft size={16} />

              Retour
            </Link>

            {/* Intro */}

            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <UserRound size={19} />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
                Créer votre compte.
              </h1>

              <p className="mt-2 text-sm leading-6 text-muted">
                Rejoignez LBV-Connect.ia et
                accédez à vos outils
                d&apos;intelligence artificielle
                depuis un seul espace.
              </p>
            </div>

            {/* Form */}

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-5"
            >
              {/* First / Last name */}

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="firstName"
                    className="mb-2 block text-sm font-medium"
                  >
                    Prénom
                  </label>

                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Votre prénom"
                    required
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lastName"
                    className="mb-2 block text-sm font-medium"
                  >
                    Nom
                  </label>

                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Votre nom"
                    required
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Phone */}

              <div>
                <label
                  htmlFor="phone"
                  className="mb-2 block text-sm font-medium"
                >
                  Numéro de téléphone
                </label>

                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+241 06 00 00 00"
                  required
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                />

                <p className="mt-2 text-xs text-muted">
                  Utilisé pour sécuriser et initialiser vos paiements.
                </p>
              </div>

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
                  placeholder="vous@exemple.com"
                  required
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* Password */}

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium"
                >
                  Mot de passe
                </label>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="new-password"
                    placeholder="Créer un mot de passe"
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 pr-12 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted transition hover:bg-surface-tertiary hover:text-foreground disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                <p className="mt-2 text-xs text-muted">
                  Minimum 8 caractères.
                </p>
              </div>

              {/* Confirm password */}

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium"
                >
                  Confirmer le mot de passe
                </label>

                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={
                      showConfirmPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="new-password"
                    placeholder="Confirmer votre mot de passe"
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 pr-12 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                    onClick={() =>
                      setShowConfirmPassword(
                        !showConfirmPassword,
                      )
                    }
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted transition hover:bg-surface-tertiary hover:text-foreground disabled:opacity-50"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-danger-surface px-4 py-3 text-sm leading-5 text-danger dark:border-red-900/40"
                >
                  {error}
                </div>
              )}

              {/* Success */}

              {message && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400"
                >
                  {message}
                </div>
              )}

              {/* Terms */}

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="terms"
                  required
                  disabled={loading}
                  className="mt-1 h-4 w-4 shrink-0 accent-black dark:accent-white"
                />

                <span className="text-xs leading-5 text-muted">
                  J&apos;accepte les conditions
                  d&apos;utilisation et la
                  politique de confidentialité
                  de LBV-Connect.ia.
                </span>
              </label>

              {/* Submit */}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />

                    Création du compte...
                  </>
                ) : (
                  "Créer mon compte"
                )}
              </button>
            </form>

            {/* Divider */}

            <div className="my-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />

              <span className="text-xs text-muted">
                ou
              </span>

              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Google */}

            <button
              type="button"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface px-4 text-sm font-medium transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continuer avec Google
            </button>

            {/* Login */}

            <p className="mt-7 text-center text-sm text-muted">
              Vous avez déjà un compte ?{" "}
              <Link
                href="/login"
                className="font-medium text-foreground hover:underline"
              >
                Se connecter
              </Link>
            </p>
          </div>

          {/* Footer */}

          <p className="mt-5 text-center text-xs leading-5 text-muted">
            Votre compte vous permettra de
            retrouver vos conversations, crédits
            et paramètres depuis tous vos
            appareils.
          </p>
        </div>
      </div>
    </main>
  );
}