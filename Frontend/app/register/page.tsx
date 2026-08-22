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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(
      formData.get("confirmPassword") ?? "",
    );

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
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
       * Si Supabase demande une confirmation e-mail,
       * l'utilisateur n'est pas encore connecté.
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
      console.error(error);

      setError(
        "Une erreur inattendue est survenue. Veuillez réessayer.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-50 text-neutral-950">
      <header className="absolute left-0 right-0 top-0">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Sparkles size={18} />
            LBV-Connect.ia
          </Link>
        </div>
      </header>

      <div className="flex min-h-dvh items-center justify-center px-5 py-24 sm:px-8">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 text-sm text-neutral-500 transition hover:text-neutral-950"
            >
              <ArrowLeft size={16} />
              Retour
            </Link>

            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                <UserRound size={19} />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
                Créer votre compte.
              </h1>

              <p className="mt-2 text-sm leading-6 text-neutral-500">
                Rejoignez LBV-Connect.ia et accédez à vos outils
                d'intelligence artificielle depuis un seul espace.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
                    className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

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
                  className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

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
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Créer un mot de passe"
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 pr-12 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showPassword
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                <p className="mt-2 text-xs text-neutral-400">
                  Minimum 8 caractères.
                </p>
              </div>

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
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirmer votre mot de passe"
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 pr-12 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                    onClick={() =>
                      setShowConfirmPassword(!showConfirmPassword)
                    }
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:opacity-50"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"
                >
                  {error}
                </div>
              )}

              {message && (
                <div
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm leading-5 text-green-700"
                >
                  {message}
                </div>
              )}

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="terms"
                  required
                  disabled={loading}
                  className="mt-1 h-4 w-4 shrink-0 accent-black"
                />

                <span className="text-xs leading-5 text-neutral-500">
                  J&apos;accepte les conditions d&apos;utilisation et la
                  politique de confidentialité de LBV-Connect.ia.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 size={17} className="animate-spin" />
                    Création du compte...
                  </>
                ) : (
                  "Créer mon compte"
                )}
              </button>
            </form>

            <div className="my-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-xs text-neutral-400">ou</span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>

            <button
              type="button"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continuer avec Google
            </button>

            <p className="mt-7 text-center text-sm text-neutral-500">
              Vous avez déjà un compte ?{" "}
              <Link
                href="/login"
                className="font-medium text-neutral-950 hover:underline"
              >
                Se connecter
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-neutral-400">
            Votre compte vous permettra de retrouver vos conversations,
            crédits et paramètres depuis tous vos appareils.
          </p>
        </div>
      </div>
    </main>
  );
}