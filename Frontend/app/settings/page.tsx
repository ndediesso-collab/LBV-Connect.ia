"use client";

import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Globe,
  Languages,
  Loader2,
  LogOut,
  MapPin,
  Moon,
  Palette,
  Shield,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Theme = "light" | "dark";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  language: Language;
  region: string;
  notifications_enabled: boolean;
  theme: Theme;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export default function SettingsPage() {
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [language, setLanguage] = useState<Language>("fr");
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState<Theme>("light");

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [savingNotifications, setSavingNotifications] =
    useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [resettingPassword, setResettingPassword] =
    useState(false);
  const [loggingOutOthers, setLoggingOutOthers] =
    useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [personalOpen, setPersonalOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  async function loadSettings() {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setEmail(user.email ?? "");

      const { data, error } = await supabase
        .from("profiles")
        .select(
          `
          id,
          first_name,
          last_name,
          language,
          region,
          notifications_enabled,
          theme,
          latitude,
          longitude,
          location_updated_at,
          created_at,
          updated_at
        `,
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        setErrorMessage(
          "Votre profil n'a pas encore été créé.",
        );
        return;
      }

      const currentProfile = data as Profile;

      setProfile(currentProfile);

      setFirstName(currentProfile.first_name ?? "");
      setLastName(currentProfile.last_name ?? "");
      setLanguage(currentProfile.language);
      setNotifications(
        currentProfile.notifications_enabled,
      );
      setTheme(currentProfile.theme);
    } catch (error) {
      console.error("SETTINGS LOAD ERROR:", error);

      setErrorMessage(
        "Impossible de charger les paramètres de votre compte.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function savePersonalInformation() {
    setSavingProfile(true);
    clearMessages();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        })
        .eq("id", user.id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      setProfile(data as Profile);

      setSuccessMessage(
        "Vos informations personnelles ont été enregistrées.",
      );
    } catch (error) {
      console.error(
        "PROFILE UPDATE ERROR:",
        error,
      );

      setErrorMessage(
        "Impossible d'enregistrer vos informations.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function changeLanguage(
    value: Language,
  ) {
    setLanguage(value);
    setSavingLanguage(true);
    clearMessages();

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          language: value,
        })
        .eq("id", profile?.id);

      if (error) {
        throw error;
      }

      setSuccessMessage(
        value === "fr"
          ? "Langue française activée."
          : "English language activated.",
      );
    } catch (error) {
      console.error(
        "LANGUAGE UPDATE ERROR:",
        error,
      );

      setErrorMessage(
        "Impossible d'enregistrer la langue.",
      );
    } finally {
      setSavingLanguage(false);
    }
  }

  async function changeNotifications(
    value: boolean,
  ) {
    setNotifications(value);
    setSavingNotifications(true);
    clearMessages();

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          notifications_enabled: value,
        })
        .eq("id", profile?.id);

      if (error) {
        throw error;
      }

      setSuccessMessage(
        value
          ? "Les notifications sont activées."
          : "Les notifications sont désactivées.",
      );
    } catch (error) {
      console.error(
        "NOTIFICATION UPDATE ERROR:",
        error,
      );

      setNotifications(!value);

      setErrorMessage(
        "Impossible d'enregistrer cette préférence.",
      );
    } finally {
      setSavingNotifications(false);
    }
  }

  async function changeTheme(value: Theme) {
    setTheme(value);
    setSavingTheme(true);
    clearMessages();

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          theme: value,
        })
        .eq("id", profile?.id);

      if (error) {
        throw error;
      }

      applyTheme(value);

      setSuccessMessage(
        value === "dark"
          ? "Mode sombre activé."
          : "Mode clair activé.",
      );
    } catch (error) {
      console.error(
        "THEME UPDATE ERROR:",
        error,
      );

      setTheme(value === "dark" ? "light" : "dark");

      setErrorMessage(
        "Impossible d'enregistrer le thème.",
      );
    } finally {
      setSavingTheme(false);
    }
  }

  function detectLocation() {
    if (!navigator.geolocation) {
      setErrorMessage(
        "La géolocalisation n'est pas disponible sur cet appareil.",
      );
      return;
    }

    setLocating(true);
    clearMessages();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const latitude =
            position.coords.latitude;

          const longitude =
            position.coords.longitude;

          const { data, error } = await supabase
            .from("profiles")
            .update({
              latitude,
              longitude,
              location_updated_at:
                new Date().toISOString(),
            })
            .eq("id", profile?.id)
            .select()
            .single();

          if (error) {
            throw error;
          }

          setProfile(data as Profile);

          setSuccessMessage(
            "Votre position a été enregistrée.",
          );
        } catch (error) {
          console.error(
            "LOCATION UPDATE ERROR:",
            error,
          );

          setErrorMessage(
            "Impossible d'enregistrer votre position.",
          );
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        console.error(
          "GEOLOCATION ERROR:",
          error,
        );

        setLocating(false);

        if (error.code === 1) {
          setErrorMessage(
            "Vous avez refusé l'accès à votre position.",
          );
        } else if (error.code === 2) {
          setErrorMessage(
            "Votre position n'a pas pu être déterminée.",
          );
        } else {
          setErrorMessage(
            "La récupération de votre position a expiré.",
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 300000,
      },
    );
  }

  async function sendPasswordReset() {
    if (!email) {
      setErrorMessage(
        "Aucune adresse e-mail associée à ce compte.",
      );
      return;
    }

    setResettingPassword(true);
    clearMessages();

    try {
      const { error } =
        await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo:
              `${window.location.origin}/settings`,
          },
        );

      if (error) {
        throw error;
      }

      setSuccessMessage(
        "L'e-mail de réinitialisation a été envoyé.",
      );
    } catch (error) {
      console.error(
        "PASSWORD RESET ERROR:",
        error,
      );

      setErrorMessage(
        "Impossible d'envoyer l'e-mail de réinitialisation.",
      );
    } finally {
      setResettingPassword(false);
    }
  }

  async function signOutOtherSessions() {
    setLoggingOutOthers(true);
    clearMessages();

    try {
      const { error } =
        await supabase.auth.signOut({
          scope: "others",
        });

      if (error) {
        throw error;
      }

      setSuccessMessage(
        "Les autres sessions ont été déconnectées.",
      );
    } catch (error) {
      console.error(
        "OTHER SESSIONS ERROR:",
        error,
      );

      setErrorMessage(
        "Impossible de fermer les autres sessions.",
      );
    } finally {
      setLoggingOutOthers(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    clearMessages();

    try {
      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      window.location.href = "/login";
    } catch (error) {
      console.error("LOGOUT ERROR:", error);

      setErrorMessage(
        "Impossible de vous déconnecter.",
      );

      setLoggingOut(false);
    }
  }

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  const fullName =
    [firstName, lastName]
      .filter(Boolean)
      .join(" ") || "Utilisateur";

  const hasLocation =
    profile?.latitude !== null &&
    profile?.longitude !== null;

  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label="Retour au chat"
              className="rounded-xl p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />

              <span className="font-semibold tracking-tight">
                LBV-Connect.ia
              </span>
            </div>
          </div>

          <Link
            href="/credits"
            className="text-sm font-medium text-neutral-600 transition hover:text-neutral-950"
          >
            Mes crédits
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-neutral-500">
            Votre compte
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            Paramètres
          </h1>

          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Gérez votre compte et vos préférences
            LBV-Connect.ia.
          </p>
        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
            <Loader2
              size={20}
              className="animate-spin"
            />
          </div>
        )}

        {!loading && (
          <>
            {errorMessage && (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <X
                  size={17}
                  className="mt-0.5 shrink-0"
                />

                <span className="flex-1">
                  {errorMessage}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setErrorMessage("")
                  }
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {successMessage && (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                <Check
                  size={17}
                  className="mt-0.5 shrink-0"
                />

                <span>{successMessage}</span>
              </div>
            )}

            {/* =================================================
                COMPTE
            ================================================= */}

            <SettingsSection
              icon={<UserRound size={18} />}
              title="Compte"
              description="Informations personnelles et sécurité."
            >
              <button
                type="button"
                onClick={() =>
                  setPersonalOpen(!personalOpen)
                }
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-neutral-50"
              >
                <IconBox>
                  <UserRound size={17} />
                </IconBox>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Informations personnelles
                  </p>

                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {fullName} · {email}
                  </p>
                </div>

                <ChevronRight
                  size={17}
                  className={`transition-transform ${
                    personalOpen
                      ? "rotate-90"
                      : ""
                  }`}
                />
              </button>

              {personalOpen && (
                <div className="border-t border-neutral-200 bg-neutral-50 p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <InputField
                      label="Prénom"
                      value={firstName}
                      onChange={setFirstName}
                    />

                    <InputField
                      label="Nom"
                      value={lastName}
                      onChange={setLastName}
                    />
                  </div>

                  <div className="mt-4">
                    <InfoField
                      label="Adresse e-mail"
                      value={email}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={savingProfile}
                    onClick={savePersonalInformation}
                    className="mt-5 flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {savingProfile && (
                      <Loader2
                        size={14}
                        className="animate-spin"
                      />
                    )}

                    Enregistrer
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  setSecurityOpen(!securityOpen)
                }
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-neutral-50"
              >
                <IconBox>
                  <Shield size={17} />
                </IconBox>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Sécurité
                  </p>

                  <p className="mt-0.5 text-xs text-neutral-500">
                    Mot de passe et sessions
                  </p>
                </div>

                <ChevronRight
                  size={17}
                  className={`transition-transform ${
                    securityOpen
                      ? "rotate-90"
                      : ""
                  }`}
                />
              </button>

              {securityOpen && (
                <div className="border-t border-neutral-200 bg-neutral-50 p-5">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-medium">
                      Adresse du compte
                    </p>

                    <p className="mt-1 truncate text-sm text-neutral-500">
                      {email}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-medium">
                      Mot de passe
                    </p>

                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      Recevez un lien sécurisé pour
                      modifier votre mot de passe.
                    </p>

                    <button
                      type="button"
                      disabled={resettingPassword}
                      onClick={
                        sendPasswordReset
                      }
                      className="mt-4 rounded-xl bg-neutral-950 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {resettingPassword
                        ? "Envoi..."
                        : "Réinitialiser mon mot de passe"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-medium">
                      Sessions
                    </p>

                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      Fermez les sessions ouvertes sur
                      vos autres appareils.
                    </p>

                    <button
                      type="button"
                      disabled={loggingOutOthers}
                      onClick={
                        signOutOtherSessions
                      }
                      className="mt-4 rounded-xl border border-neutral-200 px-4 py-2.5 text-xs font-medium transition hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {loggingOutOthers
                        ? "Déconnexion..."
                        : "Déconnecter les autres sessions"}
                    </button>
                  </div>
                </div>
              )}
            </SettingsSection>

            {/* =================================================
                PREFERENCES
            ================================================= */}

            <SettingsSection
              icon={<Palette size={18} />}
              title="Préférences"
              description="Personnalisez votre expérience."
            >
              <SettingsRow
                icon={<Languages size={17} />}
                title="Langue"
                description="Langue de l'interface"
              >
                <div className="flex items-center gap-2">
                  {savingLanguage && (
                    <Loader2
                      size={14}
                      className="animate-spin text-neutral-400"
                    />
                  )}

                  <select
                    value={language}
                    onChange={(event) =>
                      changeLanguage(
                        event.target.value as Language,
                      )
                    }
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
                  >
                    <option value="fr">
                      Français
                    </option>

                    <option value="en">
                      English
                    </option>
                  </select>
                </div>
              </SettingsRow>

              <SettingsRow
                icon={<Globe size={17} />}
                title="Région"
                description="Détection de votre position"
              >
                <button
                  type="button"
                  disabled={locating}
                  onClick={detectLocation}
                  className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  {locating ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                    />
                  ) : (
                    <MapPin size={14} />
                  )}

                  {locating
                    ? "Détection..."
                    : hasLocation
                      ? "Actualiser"
                      : "Détecter"}
                </button>
              </SettingsRow>

              {hasLocation && (
                <div className="border-t border-neutral-200 bg-neutral-50 px-5 py-3">
                  <p className="text-xs text-neutral-500">
                    Position enregistrée :
                  </p>

                  <p className="mt-1 font-mono text-[11px] text-neutral-400">
                    {profile?.latitude?.toFixed(6)}
                    {" · "}
                    {profile?.longitude?.toFixed(6)}
                  </p>
                </div>
              )}

              <SettingsRow
                icon={<Moon size={17} />}
                title="Mode sombre"
                description="Modifier l'apparence de l'application"
              >
                <div className="flex items-center gap-2">
                  {savingTheme && (
                    <Loader2
                      size={14}
                      className="animate-spin text-neutral-400"
                    />
                  )}

                  <Toggle
                    checked={theme === "dark"}
                    onChange={(checked) =>
                      changeTheme(
                        checked ? "dark" : "light",
                      )
                    }
                    label="Activer le mode sombre"
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {/* =================================================
                NOTIFICATIONS
            ================================================= */}

            <SettingsSection
              icon={<Bell size={18} />}
              title="Notifications"
              description="Choisissez les informations que vous souhaitez recevoir."
            >
              <SettingsRow
                icon={<Bell size={17} />}
                title="Notifications"
                description="Informations importantes sur votre compte et vos crédits"
              >
                <div className="flex items-center gap-2">
                  {savingNotifications && (
                    <Loader2
                      size={14}
                      className="animate-spin text-neutral-400"
                    />
                  )}

                  <Toggle
                    checked={notifications}
                    onChange={
                      changeNotifications
                    }
                    label="Activer les notifications"
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {/* =================================================
                ABONNEMENT
            ================================================= */}

            <SettingsSection
              icon={<Sparkles size={18} />}
              title="Abonnement"
              description="Consultez votre accès actuel à LBV-Connect.ia."
            >
              <SettingsRow
                icon={<Sparkles size={17} />}
                title="Pack actuel"
                description="Votre accès et votre période de validité"
              >
                <Link
                  href="/packs"
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Gérer
                  <ChevronRight size={15} />
                </Link>
              </SettingsRow>

              <SettingsRow
                icon={<Sparkles size={17} />}
                title="Crédits"
                description="Consulter votre solde et votre consommation"
              >
                <Link
                  href="/credits"
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Consulter
                  <ChevronRight size={15} />
                </Link>
              </SettingsRow>
            </SettingsSection>

            {/* =================================================
                LOGOUT
            ================================================= */}

            <section className="mt-8">
              <button
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                className="flex w-full items-center gap-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-left transition hover:bg-red-100 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-red-600">
                  {loggingOut ? (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  ) : (
                    <LogOut size={17} />
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-red-700">
                    {loggingOut
                      ? "Déconnexion..."
                      : "Se déconnecter"}
                  </p>

                  <p className="mt-0.5 text-xs text-red-500">
                    Fermer votre session actuelle
                  </p>
                </div>
              </button>
            </section>
          </>
        )}

        <p className="mt-8 text-center text-xs text-neutral-400">
          LBV-Connect.ia · Version 1.0
        </p>
      </section>
    </main>
  );
}

/* =========================================================
   THEME
========================================================= */

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle(
    "dark",
    theme === "dark",
  );
}

/* =========================================================
   SECTION
========================================================= */

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 p-5">
        <div className="flex items-center gap-3">
          <IconBox>{icon}</IconBox>

          <div>
            <h2 className="text-sm font-semibold">
              {title}
            </h2>

            <p className="mt-0.5 text-xs text-neutral-500">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-neutral-200 bg-white">
        {children}
      </div>
    </section>
  );
}

/* =========================================================
   ROW
========================================================= */

function SettingsRow({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 p-4">
      <IconBox>{icon}</IconBox>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {title}
        </p>

        <p className="mt-0.5 text-xs leading-5 text-neutral-500">
          {description}
        </p>
      </div>

      <div className="shrink-0">
        {children}
      </div>
    </div>
  );
}

/* =========================================================
   INPUT
========================================================= */

function InputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-neutral-500">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-400"
      />
    </div>
  );
}

/* =========================================================
   INFO
========================================================= */

function InfoField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-neutral-500">
        {label}
      </p>

      <div className="rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-700">
        {value}
      </div>
    </div>
  );
}

/* =========================================================
   ICON BOX
========================================================= */

function IconBox({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
      {children}
    </div>
  );
}

/* =========================================================
   TOGGLE
========================================================= */

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${
        checked
          ? "bg-neutral-950"
          : "bg-neutral-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
          checked
            ? "left-6"
            : "left-1"
        }`}
      />
    </button>
  );
}