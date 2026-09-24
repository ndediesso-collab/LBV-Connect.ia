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
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    back: "Retour",
    createAccountTitle: "Créer votre compte.",
    createAccountDescription:
      "Rejoignez Oria et accédez à vos outils d'intelligence artificielle depuis un seul espace.",
    firstName: "Prénom",
    firstNamePlaceholder: "Votre prénom",
    lastName: "Nom",
    lastNamePlaceholder: "Votre nom",
    country: "Pays",
    countryHelp:
      "Le pays sélectionné détermine automatiquement l'indicatif utilisé pour votre numéro.",
    phone: "Numéro de téléphone",
    phoneHelp:
      "Votre numéro sera enregistré comme donnée de profil et utilisé lors de vos paiements.",
    email: "Adresse e-mail",
    emailPlaceholder: "vous@exemple.com",
    password: "Mot de passe",
    passwordPlaceholder: "Créer un mot de passe",
    hidePassword: "Masquer le mot de passe",
    showPassword: "Afficher le mot de passe",
    minimumEight: "Minimum 8 caractères.",
    confirmPassword: "Confirmer le mot de passe",
    confirmPasswordPlaceholder: "Confirmer votre mot de passe",
    terms:
      "J'accepte les conditions d'utilisation et la politique de confidentialité de Oria.",
    creatingAccount: "Création du compte...",
    createMyAccount: "Créer mon compte",
    or: "ou",
    continueWithGoogle: "Continuer avec Google",
    alreadyHaveAccount: "Vous avez déjà un compte ?",
    signIn: "Se connecter",
    footer:
      "Votre compte vous permettra de retrouver vos conversations, crédits et paramètres depuis tous vos appareils.",
    phoneRequired: "Veuillez renseigner votre numéro de téléphone.",
    invalidPhone: "Veuillez renseigner un numéro de téléphone valide.",
    passwordsMismatch: "Les mots de passe ne correspondent pas.",
    passwordTooShort:
      "Le mot de passe doit contenir au moins 8 caractères.",
    createAccountError:
      "Impossible de créer le compte. Veuillez réessayer.",
    accountNotCreated: "Le compte n'a pas pu être créé.",
    noSession:
      "Le compte a été créé, mais aucune session n'est disponible. Désactivez la confirmation e-mail dans Supabase pour permettre l'enregistrement automatique du numéro.",
    phoneSyncNotConfigured:
      "Le compte a été créé, mais la synchronisation du numéro de téléphone n'est pas configurée.",
    phoneSaveError:
      "Le compte a été créé, mais le numéro de téléphone n'a pas pu être enregistré.",
    phoneMismatch:
      "Le numéro enregistré ne correspond pas au numéro fourni lors de l'inscription.",
    accountCreated:
      "Compte créé avec succès. Votre numéro de téléphone a été enregistré.",
    unexpectedError:
      "Une erreur inattendue est survenue. Veuillez réessayer.",
  },
  en: {
    back: "Back",
    createAccountTitle: "Create your account.",
    createAccountDescription:
      "Join Oria and access your artificial intelligence tools from one place.",
    firstName: "First name",
    firstNamePlaceholder: "Your first name",
    lastName: "Last name",
    lastNamePlaceholder: "Your last name",
    country: "Country",
    countryHelp:
      "The selected country automatically determines the calling code used for your number.",
    phone: "Phone number",
    phoneHelp:
      "Your number will be saved as profile information and used for your payments.",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "Create a password",
    hidePassword: "Hide password",
    showPassword: "Show password",
    minimumEight: "Minimum 8 characters.",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Confirm your password",
    terms: "I accept Oria's terms of use and privacy policy.",
    creatingAccount: "Creating account...",
    createMyAccount: "Create my account",
    or: "or",
    continueWithGoogle: "Continue with Google",
    alreadyHaveAccount: "Already have an account?",
    signIn: "Sign in",
    footer:
      "Your account lets you access your conversations, credits, and settings from all your devices.",
    phoneRequired: "Please enter your phone number.",
    invalidPhone: "Please enter a valid phone number.",
    passwordsMismatch: "Passwords do not match.",
    passwordTooShort: "Password must contain at least 8 characters.",
    createAccountError: "Unable to create the account. Please try again.",
    accountNotCreated: "The account could not be created.",
    noSession:
      "The account was created, but no session is available. Disable email confirmation in Supabase to allow the phone number to be saved automatically.",
    phoneSyncNotConfigured:
      "The account was created, but phone number synchronization is not configured.",
    phoneSaveError:
      "The account was created, but the phone number could not be saved.",
    phoneMismatch:
      "The saved number does not match the number provided during registration.",
    accountCreated:
      "Account created successfully. Your phone number has been saved.",
    unexpectedError:
      "An unexpected error occurred. Please try again.",
  },
} as const;

const COUNTRY_NAMES_EN: Record<string, string> = {
  BJ: "Benin",
  BF: "Burkina Faso",
  BI: "Burundi",
  CM: "Cameroon",
  CF: "Central African Republic",
  KM: "Comoros",
  CG: "Congo",
  CI: "Côte d'Ivoire",
  DJ: "Djibouti",
  GA: "Gabon",
  GN: "Guinea",
  GQ: "Equatorial Guinea",
  MG: "Madagascar",
  ML: "Mali",
  NE: "Niger",
  CD: "Democratic Republic of the Congo",
  RW: "Rwanda",
  SN: "Senegal",
  TG: "Togo",
};

function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") return "fr";

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

function getCountryDisplayName(
  country: CountryPhoneConfig,
  language: OriaLanguage,
): string {
  return language === "en"
    ? COUNTRY_NAMES_EN[country.iso2] ?? country.name
    : country.name;
}

function localizeFrontendError(
  message: string,
  language: OriaLanguage,
): string {
  if (language === "fr") return message;

  const translations: Record<string, string> = {
    "User already registered":
      "An account already exists with this email address.",
    "Signup requires a valid password":
      "Please enter a valid password.",
    "Unable to validate email address: invalid format":
      "Please enter a valid email address.",
    "Impossible de créer le compte. Veuillez réessayer.":
      UI.en.createAccountError,
    "Le compte n'a pas pu être créé.":
      UI.en.accountNotCreated,
    "Le compte a été créé, mais le numéro de téléphone n'a pas pu être enregistré.":
      UI.en.phoneSaveError,
    "Une erreur inattendue est survenue. Veuillez réessayer.":
      UI.en.unexpectedError,
  };

  return translations[message] ?? message;
}


type CountryPhoneConfig = {
  iso2: string;
  name: string;
  callingCode: string;
};

/**
 * Référentiel des 19 pays d'Afrique francophone.
 *
 * Aucun opérateur Mobile Money n'est codé en dur.
 * Le pays sert uniquement à déterminer :
 * - l'indicatif téléphonique ;
 * - le country_iso2 transmis au backend/Chariow.
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
 * Normalise le numéro afin d'obtenir uniquement
 * le numéro national.
 *
 * Exemples :
 *
 * 061234567
 * +241061234567
 * 00241061234567
 *
 * deviennent :
 *
 * 061234567
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

  /*
   * Cas : +24161234567
   */
  if (
    callingDigits &&
    digits.startsWith(callingDigits) &&
    digits.length > callingDigits.length
  ) {
    digits = digits.slice(callingDigits.length);
  }

  /*
   * Cas : 0024161234567
   */
  else if (digits.startsWith("00")) {
    const internationalDigits =
      digits.slice(2);

    if (
      callingDigits &&
      internationalDigits.startsWith(
        callingDigits,
      ) &&
      internationalDigits.length >
        callingDigits.length
    ) {
      digits =
        internationalDigits.slice(
          callingDigits.length,
        );
    }
  }

  return digits;
}

/**
 * Construit le numéro international.
 *
 * Exemple Gabon :
 *
 * 061234567
 *      ↓
 * +24161234567
 *
 * C'est cette valeur qui est enregistrée
 * dans le profil utilisateur puis synchronisé dans auth.users.phone.
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

  /*
   * Retire le 0 national avant d'ajouter
   * l'indicatif international.
   */
  if (national.startsWith("0")) {
    national = national.slice(1);
  }

  return `${country.callingCode}${national}`;
}

export default function RegisterPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
    };

    syncLanguage();

    window.addEventListener("storage", syncLanguage);
    window.addEventListener(
      "oria-language-change",
      syncLanguage,
    );

    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener(
        "oria-language-change",
        syncLanguage,
      );
    };
  }, []);

  const [showPassword, setShowPassword] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

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
      formData.get("countryIso2") ??
        DEFAULT_COUNTRY_ISO2,
    )
      .trim()
      .toUpperCase();

    const country =
      getCountryConfig(countryIso2);

    const phoneRaw = String(
      formData.get("phone") ?? "",
    ).trim();

    const phoneNumber =
      normalizePhoneNumber(
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

    /*
     * Validation téléphone
     */
    if (!phoneNumber) {
      setError(UI[language].phoneRequired);
      return;
    }

    if (
      phoneNumber.length < 6 ||
      !phoneInternational
    ) {
      setError(UI[language].invalidPhone);
      return;
    }

    /*
     * Validation mot de passe
     */
    if (password !== confirmPassword) {
      setError(UI[language].passwordsMismatch);
      return;
    }

    if (password.length < 8) {
      setError(UI[language].passwordTooShort);
      return;
    }

    setLoading(true);

    try {
      const supabase =
        createClient();

      /*
       * Création du compte Supabase.
       *
       * Le téléphone est conservé dans user_metadata comme donnée
       * de profil ET synchronisé immédiatement dans auth.users.phone
       * par le backend sécurisé.
       *
       * IMPORTANT :
       * La confirmation e-mail doit être désactivée dans Supabase
       * pour que signUp() retourne immédiatement une session.
       */
      const { data, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,

          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              phone: phoneInternational,
              country_iso2: country.iso2,
            },
          },
        });

      if (signUpError) {
        setError(
          signUpError.message ||
            UI[language].createAccountError,
        );
        return;
      }

      if (!data.user) {
        setError(UI[language].accountNotCreated);
        return;
      }

      /*
       * Le backend écrit le numéro directement dans
       * auth.users.phone avec la Service Role Key.
       *
       * Il faut une session immédiate : si data.session est null,
       * la confirmation e-mail est encore active côté Supabase.
       */
      if (!data.session) {
        console.error(
          "REGISTER SESSION ABSENTE : désactivez la confirmation e-mail dans Supabase.",
        );

        setError(UI[language].noSession);
        return;
      }

      const apiBaseUrl =
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL;

      if (!apiBaseUrl) {
        console.error(
          "NEXT_PUBLIC_API_URL / NEXT_PUBLIC_BACKEND_URL non configurée.",
        );

        setError(UI[language].phoneSyncNotConfigured);
        return;
      }

      /*
       * Synchronisation immédiate :
       *
       * /profile/phone
       *        ↓
       * Service Role
       *        ↓
       * auth.users.phone
       */
      const phoneResponse =
        await fetch(
          `${apiBaseUrl.replace(/\/$/, "")}/profile/phone`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization:
                `Bearer ${data.session.access_token}`,
              "user-id": data.user.id,
            },
            body: JSON.stringify({
              phone: phoneInternational,
              country_iso2: country.iso2,
            }),
          },
        );

      let phoneResult: {
        detail?: string;
        message?: string;
        phone?: string;
        success?: boolean;
      } = {};

      try {
        phoneResult =
          await phoneResponse.json();
      } catch {
        // Réponse non JSON : on utilisera le message générique.
      }

      if (!phoneResponse.ok) {
        console.error(
          "PHONE PROFILE SYNC ERROR:",
          phoneResult,
        );

        setError(
          phoneResult.detail ||
            UI[language].phoneSaveError,
        );
        return;
      }

      /*
       * Vérification de la réponse du backend.
       * Le backend doit confirmer le numéro international attendu.
       */
      if (
        phoneResult.phone &&
        phoneResult.phone.replace(/\D/g, "") !==
          phoneInternational.replace(/\D/g, "")
      ) {
        console.error(
          "PHONE PROFILE SYNC MISMATCH:",
          phoneResult,
        );

        setError(UI[language].phoneMismatch);
        return;
      }

      setMessage(UI[language].accountCreated);

      /*
       * La session Supabase reste disponible : l'utilisateur
       * peut accéder directement à son espace.
       */
      window.location.href = "/chat";

      return;
    } catch (error) {
      console.error(
        "SUPABASE REGISTER ERROR:",
        error,
      );

      setError(UI[language].unexpectedError);
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

            Oria
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

              {UI[language].back}
            </Link>

            {/* Intro */}

            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <UserRound size={19} />
              </div>

              <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
                {UI[language].createAccountTitle}
              </h1>

              <p className="mt-2 text-sm leading-6 text-muted">
                {UI[language].createAccountDescription}
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
                    {UI[language].firstName}
                  </label>

                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder={UI[language].firstNamePlaceholder}
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
                    {UI[language].lastName}
                  </label>

                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder={UI[language].lastNamePlaceholder}
                    required
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Country */}

              <div>
                <label
                  htmlFor="countryIso2"
                  className="mb-2 block text-sm font-medium"
                >
                  {UI[language].country}
                </label>

                <select
                  id="countryIso2"
                  name="countryIso2"
                  defaultValue={
                    DEFAULT_COUNTRY_ISO2
                  }
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
                        {getCountryDisplayName(
                          country,
                          language,
                        )} (
                        {country.callingCode})
                      </option>
                    ),
                  )}
                </select>

                <p className="mt-2 text-xs text-muted">
                  {UI[language].countryHelp}
                </p>
              </div>

              {/* Phone */}

              <div>
                <label
                  htmlFor="phone"
                  className="mb-2 block text-sm font-medium"
                >
                  {UI[language].phone}
                </label>

                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="06 12 34 56 7"
                  required
                  disabled={loading}
                  className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                />

                <p className="mt-2 text-xs text-muted">
                  {UI[language].phoneHelp}
                </p>
              </div>

              {/* Email */}

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium"
                >
                  {UI[language].email}
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={UI[language].emailPlaceholder}
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
                  {UI[language].password}
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
                    placeholder={UI[language].passwordPlaceholder}
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 pr-12 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showPassword
                        ? UI[language].hidePassword
                        : UI[language].showPassword
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
                  {UI[language].minimumEight}
                </p>
              </div>

              {/* Confirm password */}

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium"
                >
                  {UI[language].confirmPassword}
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
                    placeholder={UI[language].confirmPasswordPlaceholder}
                    required
                    minLength={8}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-border bg-surface-secondary px-4 pr-12 text-sm outline-none transition placeholder:text-muted focus:border-border-strong focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword
                        ? UI[language].hidePassword
                        : UI[language].showPassword
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
                  {localizeFrontendError(
                    error,
                    language,
                  )}
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
                  {UI[language].terms}
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

                    {UI[language].creatingAccount}
                  </>
                ) : (
                  UI[language].createMyAccount
                )}
              </button>
            </form>

            {/* Divider */}

            <div className="my-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />

              <span className="text-xs text-muted">
                {UI[language].or}
              </span>

              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Google */}

            <button
              type="button"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface px-4 text-sm font-medium transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {UI[language].continueWithGoogle}
            </button>

            {/* Login */}

            <p className="mt-7 text-center text-sm text-muted">
              {UI[language].alreadyHaveAccount}{" "}
              <Link
                href="/login"
                className="font-medium text-foreground hover:underline"
              >
                {UI[language].signIn}
              </Link>
            </p>
          </div>

          {/* Footer */}

          <p className="mt-5 text-center text-xs leading-5 text-muted">
            {UI[language].footer}
          </p>
        </div>
      </div>
    </main>
  );
}