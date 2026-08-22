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
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);

      if (error.code === "email_not_confirmed") {
        setErrorMessage(
          "Votre adresse e-mail n'est pas encore confirmée. Consultez votre boîte mail pour activer votre compte.",
        );
      } else if (error.code === "invalid_credentials") {
        setErrorMessage(
          "Adresse e-mail ou mot de passe incorrect.",
        );
      } else {
        setErrorMessage(error.message);
      }

      setLoading(false);
      return;
    }

    console.log("LBV-Connect.ia : accès accordé.");

    setSuccessMessage("Connexion réussie. Redirection...");

    /*
     * Rechargement complet volontaire.
     *
     * Cela permet aux cookies/session Supabase d'être
     * correctement pris en compte avant d'arriver dans /chat.
     */
    window.location.href = "/chat";
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
                <LockKeyhole size={19} />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
                Bon retour.
              </h1>

              <p className="mt-2 text-sm leading-6 text-neutral-500">
                Connectez-vous à votre compte LBV-Connect.ia pour continuer.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium"
                  >
                    Mot de passe
                  </label>

                  <button
                    type="button"
                    disabled={loading}
                    className="text-xs font-medium text-neutral-500 transition hover:text-neutral-950 disabled:opacity-50"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Votre mot de passe"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
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
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"
                >
                  {errorMessage}
                </div>
              )}

              {successMessage && (
                <div
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm leading-5 text-green-700"
                >
                  {successMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 size={17} className="animate-spin" />
                    Connexion...
                  </>
                ) : (
                  "Se connecter"
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
              Vous n&apos;avez pas encore de compte ?{" "}
              <Link
                href="/register"
                className="font-medium text-neutral-950 hover:underline"
              >
                Créer un compte
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-neutral-400">
            En continuant, vous acceptez les conditions d&apos;utilisation et
            la politique de confidentialité de LBV-Connect.ia.
          </p>
        </div>
      </div>
    </main>
  );
}