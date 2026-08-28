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

type CountryPhoneConfig = {
  iso2: string;
  name: string;
  callingCode: string;
};

/**
 * Référentiel initial LBV-Connect :
 * 19 pays d'Afrique francophone retenus pour la téléphonie/paiement.
 *
 * `iso2` est conservé comme donnée de pays et sera transmis à Chariow
 * dans `phone.country_code`.
 *
 * `callingCode` sert à normaliser le numéro.
 *
 * Aucun opérateur Mobile Money n'est codé ici.
 * Chariow reste responsable des moyens de paiement disponibles.
 */
const COUNTRY_PHONE_CONFIGS: CountryPhoneConfig[] = [
  { iso2: "BJ", name: "Bénin", callingCode: "+229" },
  { iso2: "BF", name: "Burkina Faso", callingCode: "+226" },
  { iso2: "BI", name: "Burundi", callingCode: "+257" },
  { iso2: "CM", name: "Cameroun", callingCode: "+237" },
  { iso2: "CF", name: "République centrafricaine", callingCode: "+236" },
  { iso2: "KM", name: "Comores", callingCode: "+269" },
  { iso2: "CG", name: "Congo", callingCode: "+242" },
  { iso2: "CI", name: "Côte d'Ivoire", callingCode: "+225" },
  { iso2: "DJ", name: "Djibouti", callingCode: "+253" },
  { iso2: "GA", name: "Gabon", callingCode: "+241" },
  { iso2: "GN", name: "Guinée", callingCode: "+224" },
  { iso2: "GQ", name: "Guinée équatoriale", callingCode: "+240" },
  { iso2: "MG", name: "Madagascar", callingCode: "+261" },
  { iso2: "ML", name: "Mali", callingCode: "+223" },
  { iso2: "NE", name: "Niger", callingCode: "+227" },
  { iso2: "CD", name: "République démocratique du Congo", callingCode: "+243" },
  { iso2: "RW", name: "Rwanda", callingCode: "+250" },
  { iso2: "SN", name: "Sénégal", callingCode: "+221" },
  { iso2: "TG", name: "Togo", callingCode: "+228" },
];

const DEFAULT_COUNTRY_ISO2 = "GA";

function getCountryConfig(
  iso2: string,
): CountryPhoneConfig {
  const normalizedIso2 = iso2.trim().toUpperCase();

  const country = COUNTRY_PHONE_CONFIGS.find(
    (item) => item.iso2 === normalizedIso2,
  );

  return (
    country ??
    COUNTRY_PHONE_CONFIGS.find(
      (item) => item.iso2 === DEFAULT_COUNTRY_ISO2,
    )!
  );
}

/**
 * Retourne le numéro national sous forme numérique.
 *
 * Accepte par exemple :
 * - 061234567
 * - +241061234567
 * - 00241061234567
 *
 * Le préfixe national 0 reste dans le numéro national.
 */
function normalizePhoneNumber(
  value: string,
  country: CountryPhoneConfig,
): string {
  let digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  const callingDigits =
    country.callingCode.replace(/\D/g, "");

  if (
    callingDigits &&
    digits.startsWith(callingDigits) &&
    digits.length > callingDigits.length
  ) {
    digits = digits.slice(callingDigits.length);
  } else if (digits.startsWith("00")) {
    const internationalDigits = digits.slice(2);

    if (
      callingDigits &&
      internationalDigits.startsWith(callingDigits) &&
      internationalDigits.length > callingDigits.length
    ) {
      digits = internationalDigits.slice(callingDigits.length);
    }
  }

  return digits;
}

/**
 * Produit le numéro international utilisé comme valeur native
 * `auth.users.phone`.
 *
 * Supabase attend un numéro au format international (E.164).
 * Le 0 national est retiré avant l'ajout de l'indicatif.
 */
function buildInternationalPhone(
  phoneNumber: string,
  country: CountryPhoneConfig,
): string {
  let national = normalizePhoneNumber(
    phoneNumber,
    country,
  );

  if (!national) {
    return "";
  }

  if (national.startsWith("0")) {
    national = national.slice(1);
  }

  return `${country.callingCode}${national}`;
}

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

    const countryIso2 = String(
      formData.get("countryIso2") ?? DEFAULT_COUNTRY_ISO2,
    ).trim().toUpperCase();

    const country = getCountryConfig(
      countryIso2,
    );

    const phoneRaw = String(
      formData.get("phone") ?? "",
    ).trim();

    const phoneNumber = normalizePhoneNumber(
      phoneRaw,
      country,
    );

    const phoneInternational =
      buildInternationalPhone(
        phoneRaw,
        country,
      );

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

    if (!phoneNumber) {
      setError(
        "Veuillez renseigner votre numéro de téléphone.",
      );
      return;
    }

    if (phoneNumber.length < 6 || !phoneInternational) {
      setError(
        "Veuillez renseigner un numéro de téléphone valide.",
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
          phone: phoneInternational,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              country_iso2: country.iso2,
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

              {/* Pays + téléphone */}

              <div>
                <label
                  htmlFor="countryIso2"
                  className="mb-2 block text-sm font-medium"
                >
                  Pays
                </label>

                <select
                  id="countryIso2"
                  name="countryIso2"
                  defaultValue={DEFAULT_COUNTRY_ISO2}
                  required
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {COUNTRY_PHONE_CONFIGS.map(
                    (country) => (
                      <option
                        key={country.iso2}
                        value={country.iso2}
                      >
                        {country.name} ({country.callingCode})
                      </option>
                    ),
                  )}
                </select>

                <p className="mt-2 text-xs text-muted">
                  Votre pays détermine automatiquement l’indicatif
                  utilisé pour normaliser votre numéro.
                </p>
              </div>

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
                  placeholder="06 00 00 00"
                  required
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                />

                <p className="mt-2 text-xs text-muted">
                  Un seul numéro est demandé. LBV-Connect le normalise
                  automatiquement avant son enregistrement et son utilisation
                  pour les paiements.
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