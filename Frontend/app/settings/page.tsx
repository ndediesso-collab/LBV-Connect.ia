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
import { useTheme } from "@/components/providers/ThemeProvider";

type Language = "fr" | "en";
type Theme = "light" | "dark";


const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const SETTINGS_TEXT = {
  fr: {
    backToChat: "Retour au chat",
    myCredits: "Mes crédits",
    yourAccount: "Votre compte",
    settings: "Paramètres",
    settingsDescription: "Gérez votre compte et vos préférences Oria.",
    account: "Compte",
    accountDescription: "Informations personnelles et sécurité.",
    personalInformation: "Informations personnelles",
    firstName: "Prénom",
    lastName: "Nom",
    emailAddress: "Adresse e-mail",
    phoneNumber: "Numéro de téléphone",
    countryCode: "Code pays",
    userId: "Identifiant utilisateur",
    authInfo: "L'e-mail et le téléphone sont enregistrés directement dans votre compte d'authentification Supabase.",
    save: "Enregistrer",
    user: "Utilisateur",
    security: "Sécurité",
    securityDescription: "Mot de passe et sessions",
    accountAddress: "Adresse du compte",
    password: "Mot de passe",
    passwordDescription: "Définissez directement un nouveau mot de passe pour votre compte Supabase.",
    newPassword: "Nouveau mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    saving: "Enregistrement...",
    changePassword: "Modifier le mot de passe",
    resetHelp: "Vous pouvez aussi demander un lien sécurisé de réinitialisation par e-mail.",
    sending: "Envoi...",
    sendResetLink: "Envoyer un lien de réinitialisation",
    sessions: "Sessions",
    sessionsDescription: "Fermez les sessions ouvertes sur vos autres appareils.",
    signingOut: "Déconnexion...",
    signOutOtherSessions: "Déconnecter les autres sessions",
    preferences: "Préférences",
    preferencesDescription: "Personnalisez votre expérience.",
    language: "Langue",
    interfaceLanguage: "Langue de l'interface",
    region: "Région",
    regionDescription: "Détection de votre position",
    detecting: "Détection...",
    refresh: "Actualiser",
    detect: "Détecter",
    detectedLocation: "Localisation détectée",
    darkMode: "Mode sombre",
    appearanceDescription: "Modifier l'apparence de l'application",
    enableDarkMode: "Activer le mode sombre",
    notifications: "Notifications",
    notificationsSectionDescription: "Choisissez les informations que vous souhaitez recevoir.",
    notificationsDescription: "Informations importantes sur votre compte et vos crédits",
    enableNotifications: "Activer les notifications",
    subscription: "Abonnement",
    subscriptionDescription: "Consultez votre accès actuel à Oria.",
    currentPack: "Pack actuel",
    currentPackDescription: "Votre accès et votre période de validité",
    manage: "Gérer",
    credits: "Crédits",
    creditsDescription: "Consulter votre solde et votre consommation",
    view: "Consulter",
    logout: "Se déconnecter",
    logoutDescription: "Fermer votre session actuelle",
    unknownCountry: "Pays inconnu",
    locationUndetermined: "Localisation non déterminée",
    loadSettingsError: "Impossible de charger les paramètres de votre compte.",
    emailRequired: "L'adresse e-mail est requise.",
    phoneRequired: "Le numéro de téléphone est requis.",
    countryRequired: "Le code pays est requis.",
    personalSaved: "Vos informations personnelles ont été enregistrées dans Supabase.",
    personalSaveError: "Impossible d'enregistrer vos informations.",
    languageActivated: "Langue française activée.",
    languageSaveError: "Impossible d'enregistrer la langue.",
    notificationsEnabled: "Les notifications sont activées.",
    notificationsDisabled: "Les notifications sont désactivées.",
    preferenceSaveError: "Impossible d'enregistrer cette préférence.",
    darkEnabled: "Mode sombre activé.",
    lightEnabled: "Mode clair activé.",
    themeSaveError: "Impossible d'enregistrer le thème.",
    geolocationUnavailable: "La géolocalisation n'est pas disponible sur cet appareil.",
    determineLocationError: "Impossible de déterminer votre localisation.",
    locationUpdated: "Votre localisation a été mise à jour.",
    locationSaveError: "Impossible d'enregistrer votre localisation.",
    locationPermissionDenied: "Vous avez refusé l'accès à votre position.",
    locationUnavailable: "Votre position n'a pas pu être déterminée.",
    locationTimeout: "La récupération de votre position a expiré.",
    geolocationError: "Une erreur est survenue lors de la géolocalisation.",
    enterNewPassword: "Saisissez un nouveau mot de passe.",
    passwordMinSix: "Le nouveau mot de passe doit contenir au moins 6 caractères.",
    passwordsMismatch: "Les deux mots de passe ne correspondent pas.",
    passwordUpdated: "Votre mot de passe a été mis à jour dans Supabase.",
    passwordUpdateError: "Impossible de mettre à jour votre mot de passe.",
    noEmail: "Aucune adresse e-mail associée à ce compte.",
    resetEmailSent: "L'e-mail de réinitialisation a été envoyé.",
    resetEmailError: "Impossible d'envoyer l'e-mail de réinitialisation.",
    otherSessionsClosed: "Les autres sessions ont été déconnectées.",
    otherSessionsError: "Impossible de fermer les autres sessions.",
    logoutError: "Impossible de vous déconnecter.",
  },
  en: {
    backToChat: "Back to chat",
    myCredits: "My credits",
    yourAccount: "Your account",
    settings: "Settings",
    settingsDescription: "Manage your Oria account and preferences.",
    account: "Account",
    accountDescription: "Personal information and security.",
    personalInformation: "Personal information",
    firstName: "First name",
    lastName: "Last name",
    emailAddress: "Email address",
    phoneNumber: "Phone number",
    countryCode: "Country code",
    userId: "User ID",
    authInfo: "Your email and phone number are saved directly in your Supabase authentication account.",
    save: "Save",
    user: "User",
    security: "Security",
    securityDescription: "Password and sessions",
    accountAddress: "Account address",
    password: "Password",
    passwordDescription: "Set a new password directly for your Supabase account.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    saving: "Saving...",
    changePassword: "Change password",
    resetHelp: "You can also request a secure password reset link by email.",
    sending: "Sending...",
    sendResetLink: "Send reset link",
    sessions: "Sessions",
    sessionsDescription: "Close sessions open on your other devices.",
    signingOut: "Signing out...",
    signOutOtherSessions: "Sign out other sessions",
    preferences: "Preferences",
    preferencesDescription: "Customize your experience.",
    language: "Language",
    interfaceLanguage: "Interface language",
    region: "Region",
    regionDescription: "Location detection",
    detecting: "Detecting...",
    refresh: "Refresh",
    detect: "Detect",
    detectedLocation: "Detected location",
    darkMode: "Dark mode",
    appearanceDescription: "Change the application's appearance",
    enableDarkMode: "Enable dark mode",
    notifications: "Notifications",
    notificationsSectionDescription: "Choose the information you want to receive.",
    notificationsDescription: "Important information about your account and credits",
    enableNotifications: "Enable notifications",
    subscription: "Subscription",
    subscriptionDescription: "View your current Oria access.",
    currentPack: "Current pack",
    currentPackDescription: "Your access and validity period",
    manage: "Manage",
    credits: "Credits",
    creditsDescription: "View your balance and usage",
    view: "View",
    logout: "Sign out",
    logoutDescription: "Close your current session",
    unknownCountry: "Unknown country",
    locationUndetermined: "Location not determined",
    loadSettingsError: "Unable to load your account settings.",
    emailRequired: "Email address is required.",
    phoneRequired: "Phone number is required.",
    countryRequired: "Country code is required.",
    personalSaved: "Your personal information has been saved in Supabase.",
    personalSaveError: "Unable to save your information.",
    languageActivated: "English language activated.",
    languageSaveError: "Unable to save the language.",
    notificationsEnabled: "Notifications are enabled.",
    notificationsDisabled: "Notifications are disabled.",
    preferenceSaveError: "Unable to save this preference.",
    darkEnabled: "Dark mode enabled.",
    lightEnabled: "Light mode enabled.",
    themeSaveError: "Unable to save the theme.",
    geolocationUnavailable: "Geolocation is not available on this device.",
    determineLocationError: "Unable to determine your location.",
    locationUpdated: "Your location has been updated.",
    locationSaveError: "Unable to save your location.",
    locationPermissionDenied: "You denied access to your location.",
    locationUnavailable: "Your location could not be determined.",
    locationTimeout: "Location retrieval timed out.",
    geolocationError: "An error occurred during geolocation.",
    enterNewPassword: "Enter a new password.",
    passwordMinSix: "The new password must contain at least 6 characters.",
    passwordsMismatch: "The two passwords do not match.",
    passwordUpdated: "Your password has been updated in Supabase.",
    passwordUpdateError: "Unable to update your password.",
    noEmail: "No email address is associated with this account.",
    resetEmailSent: "The password reset email has been sent.",
    resetEmailError: "Unable to send the password reset email.",
    otherSessionsClosed: "Other sessions have been signed out.",
    otherSessionsError: "Unable to close the other sessions.",
    logoutError: "Unable to sign out.",
  },
} as const;

function getInitialOriaLanguage(): Language {
  if (typeof window === "undefined") return "fr";

  const saved = window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY);

  if (saved === "fr" || saved === "en") {
    return saved;
  }

  return window.navigator.language.toLowerCase().startsWith("en")
    ? "en"
    : "fr";
}

function publishOriaLanguage(value: Language) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(ORIA_LANGUAGE_STORAGE_KEY, value);
  window.dispatchEvent(new Event("oria-language-change"));
}


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

  country_code: string | null;
  country_name: string | null;
  city: string | null;
  subdivision: string | null;

  location_updated_at: string | null;

  created_at: string;
  updated_at: string;
};

type GeocodedLocation = {
  countryCode: string;
  countryName: string;
  city: string;
  subdivision: string;
};

export default function SettingsPage() {
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [countryIso2, setCountryIso2] = useState("GA");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [language, setLanguage] =
    useState<Language>(() => getInitialOriaLanguage());
  const [notifications, setNotifications] = useState(true);
  const { theme, setTheme } = useTheme();
  const t = SETTINGS_TEXT[language];

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
  const [savingPassword, setSavingPassword] =
    useState(false);
  const [loggingOutOthers, setLoggingOutOthers] =
    useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [personalOpen, setPersonalOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  const [countryName, setCountryName] =
    useState<string>(() =>
      SETTINGS_TEXT[
        getInitialOriaLanguage()
      ].locationUndetermined,
    );
  const [countryCode, setCountryCode] = useState("");
  const [cityName, setCityName] = useState("");
  const [subdivisionName, setSubdivisionName] = useState("");

  
  useEffect(() => {
    loadSettings();
  }, []);

  
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

    // Identité officielle Supabase
    setUserId(user.id);
    setEmail(user.email ?? "");
    setOriginalEmail(user.email ?? "");
    setPhone(user.phone ?? "");

    const metadataCountry =
      (user.user_metadata?.country_iso2 as string | undefined)
      ?? (user.user_metadata?.country as string | undefined)
      ?? "";

    setCountryIso2(
      metadataCountry.trim().toUpperCase()
      || "GA",
    );

    // Récupération du profil de l'utilisateur connecté uniquement
    const {
      data: existingProfile,
      error: profileError,
    } = await supabase
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
          country_code,
          country_name,
          city,
          subdivision,
          location_updated_at,
          created_at,
          updated_at
        `,
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    let currentProfile =
      existingProfile as Profile | null;

    // Si le trigger Supabase n'a pas créé le profil,
    // on le crée sans supposer que l'utilisateur
    // se trouve dans un pays particulier.
    if (!currentProfile) {
      const {
        data: createdProfile,
        error: createError,
      } = await supabase
        .from("profiles")
        .insert({
          id: user.id,

          first_name:
            (user.user_metadata?.first_name as
              | string
              | undefined) ?? null,

          last_name:
            (user.user_metadata?.last_name as
              | string
              | undefined) ?? null,

          language: "fr",
          notifications_enabled: true,
          theme: "light",
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      currentProfile =
        createdProfile as Profile;
    }

    // Synchronisation du profil avec React
    setProfile(currentProfile);

    setFirstName(
      currentProfile.first_name ?? "",
    );

    setLastName(
      currentProfile.last_name ?? "",
    );

    setLanguage(
      currentProfile.language,
    );
    publishOriaLanguage(
      currentProfile.language,
    );

    setNotifications(
      currentProfile.notifications_enabled,
    );

    // Synchronisation de la localisation
    setCountryName(
      currentProfile.country_name ??
        SETTINGS_TEXT[currentProfile.language].locationUndetermined,
    );

    setCountryCode(
      currentProfile.country_code ?? "",
    );

    setCityName(
      currentProfile.city ?? "",
    );

    setSubdivisionName(
      currentProfile.subdivision ?? "",
    );

    /*
     * Si les coordonnées existent déjà,
     * on peut recalculer la localisation lisible.
     */
    if (
      currentProfile.latitude != null &&
      currentProfile.longitude != null
    ) {
      const location =
        await reverseGeocode(
          currentProfile.latitude,
          currentProfile.longitude,
          currentProfile.language,
        );

      if (location) {
        setCountryName(
          location.countryName,
        );

        setCountryCode(
          location.countryCode,
        );

        setCityName(
          location.city,
        );

        setSubdivisionName(
          location.subdivision,
        );
      }
    }
  } catch (error) {
    console.error(
      "SETTINGS LOAD ERROR:",
      error,
    );

    setErrorMessage(
      t.loadSettingsError,
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
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const normalizedEmail = email.trim();
      const normalizedPhone = phone.trim();
      const normalizedCountry = countryIso2.trim().toUpperCase();

      if (!normalizedEmail) {
        throw new Error(t.emailRequired);
      }

      if (!normalizedPhone) {
        throw new Error(t.phoneRequired);
      }

      if (!normalizedCountry) {
        throw new Error(t.countryRequired);
      }

      // ======================================================
      // 1. PROFIL APPLICATIF
      // ======================================================

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        })
        .eq("id", user.id);

      if (profileError) {
        throw profileError;
      }

      // ======================================================
      // 2. COMPTE AUTH SUPABASE
      // ======================================================
      // email et téléphone sont réellement enregistrés dans
      // auth.users via Supabase Auth.

      const authChanges: {
        email?: string;
        phone?: string;
      } = {};

      if (normalizedEmail !== originalEmail.trim()) {
        authChanges.email = normalizedEmail;
      }

      if (normalizedPhone !== (user.phone ?? "").trim()) {
        authChanges.phone = normalizedPhone;
      }

      if (Object.keys(authChanges).length > 0) {
        const {
          data: updatedAuth,
          error: authUpdateError,
        } = await supabase.auth.updateUser(
          authChanges,
        );

        if (authUpdateError) {
          throw authUpdateError;
        }

        const updatedUser = updatedAuth.user;

        setEmail(
          updatedUser.email
          ?? normalizedEmail,
        );

        setOriginalEmail(
          updatedUser.email
          ?? normalizedEmail,
        );

        setPhone(
          updatedUser.phone
          ?? normalizedPhone,
        );
      }

      // ======================================================
      // 3. PAYS DU PROFIL
      // ======================================================
      // Le code pays est conservé dans user_metadata afin que
      // le backend de paiement puisse l'utiliser.

      const currentCountry = String(
        user.user_metadata?.country_iso2 ?? ""
      ).trim().toUpperCase();

      if (normalizedCountry !== currentCountry) {
        const {
          error: metadataError,
        } = await supabase.auth.updateUser({
          data: {
            country_iso2: normalizedCountry,
          },
        });

        if (metadataError) {
          throw metadataError;
        }
      }

      setProfile((current) =>
        current
          ? {
              ...current,
              first_name:
                firstName.trim() || null,
              last_name:
                lastName.trim() || null,
            }
          : current,
      );

      setSuccessMessage(
        t.personalSaved,
      );
    } catch (error) {
      console.error(
        "PROFILE UPDATE ERROR:",
        error,
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : t.personalSaveError,
      );
    } finally {
      setSavingProfile(false);
    }
  }


async function changeLanguage(
  value: Language,
) {
  const previousLanguage = language;

  setLanguage(value);
  publishOriaLanguage(value);
  setSavingLanguage(true);
  clearMessages();

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

    const { error } = await supabase
      .from("profiles")
      .update({
        language: value,
      })
      .eq("id", user.id);

    if (error) {
      throw error;
    }

    setProfile((current) =>
      current
        ? {
            ...current,
            language: value,
          }
        : current,
    );

    setSuccessMessage(
      SETTINGS_TEXT[value].languageActivated,
    );

    if (
      profile?.latitude != null &&
      profile?.longitude != null
    ) {
      const localizedLocation =
        await reverseGeocode(
          profile.latitude,
          profile.longitude,
          value,
        );

      if (localizedLocation) {
        setCountryName(localizedLocation.countryName);
        setCountryCode(localizedLocation.countryCode);
        setCityName(localizedLocation.city);
        setSubdivisionName(localizedLocation.subdivision);
      }
    }
  } catch (error) {
    console.error(
      "LANGUAGE UPDATE ERROR:",
      error,
    );

    setLanguage(previousLanguage);
    publishOriaLanguage(previousLanguage);

    setErrorMessage(
      SETTINGS_TEXT[previousLanguage].languageSaveError,
    );
  } finally {
    setSavingLanguage(false);
  }
}


async function changeNotifications(
  value: boolean,
) {
  const previousValue = notifications;

  setNotifications(value);
  setSavingNotifications(true);
  clearMessages();

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

    const { error } = await supabase
      .from("profiles")
      .update({
        notifications_enabled: value,
      })
      .eq("id", user.id);

    if (error) {
      throw error;
    }

    setProfile((current) =>
      current
        ? {
            ...current,
            notifications_enabled: value,
          }
        : current,
    );

    setSuccessMessage(
      value
        ? t.notificationsEnabled
        : t.notificationsDisabled,
    );
  } catch (error) {
    console.error(
      "NOTIFICATION UPDATE ERROR:",
      error,
    );

    setNotifications(previousValue);

    setErrorMessage(
      t.preferenceSaveError,
    );
  } finally {
    setSavingNotifications(false);
  }
}


async function changeTheme(value: Theme) {
  setSavingTheme(true);
  clearMessages();

  try {
    await setTheme(value);

    setProfile((current) =>
      current
        ? {
            ...current,
            theme: value,
          }
        : current,
    );

    setSuccessMessage(
      value === "dark"
        ? t.darkEnabled
        : t.lightEnabled,
    );
  } catch (error) {
    console.error("THEME UPDATE ERROR:", error);

    setErrorMessage(
      t.themeSaveError,
    );
  } finally {
    setSavingTheme(false);
  }
}


function detectLocation() {
  if (!navigator.geolocation) {
    setErrorMessage(
      t.geolocationUnavailable,
    );
    return;
  }

  setLocating(true);
  clearMessages();

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        // Utilisateur réellement connecté
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

        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        // Conversion GPS → localisation lisible
        const location =
          await reverseGeocode(
            latitude,
            longitude,
          );

        if (!location) {
          throw new Error(
            t.determineLocationError,
          );
        }

        const locationUpdatedAt =
          new Date().toISOString();

        // Un seul UPDATE Supabase
        const { error } = await supabase
          .from("profiles")
          .update({
            latitude,
            longitude,

            country_code:
              location.countryCode,

            country_name:
              location.countryName,

            city:
              location.city || null,

            subdivision:
              location.subdivision || null,

            location_updated_at:
              locationUpdatedAt,
          })
          .eq("id", user.id);

        if (error) {
          throw error;
        }

        // Mise à jour immédiate du profil local
        setProfile((current) =>
          current
            ? {
                ...current,

                latitude,
                longitude,

                country_code:
                  location.countryCode,

                country_name:
                  location.countryName,

                city:
                  location.city || null,

                subdivision:
                  location.subdivision || null,

                location_updated_at:
                  locationUpdatedAt,
              }
            : current,
        );

        // Mise à jour immédiate de l'interface
        setCountryName(
          location.countryName,
        );

        setCountryCode(
          location.countryCode,
        );

        setCityName(
          location.city,
        );

        setSubdivisionName(
          location.subdivision,
        );

        setSuccessMessage(
          t.locationUpdated,
        );
      } catch (error) {
        console.error(
          "LOCATION UPDATE ERROR:",
          error,
        );

        setErrorMessage(
          t.locationSaveError,
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
          t.locationPermissionDenied,
        );
      } else if (error.code === 2) {
        setErrorMessage(
          t.locationUnavailable,
        );
      } else if (error.code === 3) {
        setErrorMessage(
          t.locationTimeout,
        );
      } else {
        setErrorMessage(
          t.geolocationError,
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


async function reverseGeocode(
  latitude: number,
  longitude: number,
  locale: Language = language,
): Promise<GeocodedLocation | null> {
  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=${locale}`,
    );

    if (!response.ok) {
      throw new Error(
        "Reverse geocoding failed",
      );
    }

    const data = await response.json();

    const countryCode =
      data.countryCode ?? "";

    const countryName =
      data.countryName ??
      SETTINGS_TEXT[locale].unknownCountry;

    const city =
      data.city ??
      data.locality ??
      "";

    const subdivision =
      data.principalSubdivision ??
      "";

    return {
      countryCode,
      countryName,
      city,
      subdivision,
    };
  } catch (error) {
    console.error(
      "REVERSE GEOCODING ERROR:",
      error,
    );

    return null;
  }
}

  async function changePassword() {
    clearMessages();

    if (!newPassword) {
      setErrorMessage(
        t.enterNewPassword,
      );
      return;
    }

    if (newPassword.length < 6) {
      setErrorMessage(
        t.passwordMinSix,
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage(
        t.passwordsMismatch,
      );
      return;
    }

    setSavingPassword(true);

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

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      setNewPassword("");
      setConfirmPassword("");

      setSuccessMessage(
        t.passwordUpdated,
      );
    } catch (error) {
      console.error(
        "PASSWORD UPDATE ERROR:",
        error,
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : t.passwordUpdateError,
      );
    } finally {
      setSavingPassword(false);
    }
  }


  async function sendPasswordReset() {
    if (!email) {
      setErrorMessage(
        t.noEmail,
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
        t.resetEmailSent,
      );
    } catch (error) {
      console.error(
        "PASSWORD RESET ERROR:",
        error,
      );

      setErrorMessage(
        t.resetEmailError,
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
        t.otherSessionsClosed,
      );
    } catch (error) {
      console.error(
        "OTHER SESSIONS ERROR:",
        error,
      );

      setErrorMessage(
        t.otherSessionsError,
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
        t.logoutError,
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
      .join(" ") || t.user;

  const hasLocation =
  profile?.latitude != null &&
  profile?.longitude != null;

  return (
    <main className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label={t.backToChat}
              className="rounded-xl p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />

              <span className="font-semibold tracking-tight">
                Oria
              </span>
            </div>
          </div>

          <Link
            href="/credits"
            className="text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            {t.myCredits}
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">
            {t.yourAccount}
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t.settings}
          </h1>

          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t.settingsDescription}
          </p>
        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
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
              title={t.account}
              description={t.accountDescription}
            >
              <button
                type="button"
                onClick={() =>
                  setPersonalOpen(!personalOpen)
                }
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-[var(--surface-2)]"
              >
                <IconBox>
                  <UserRound size={17} />
                </IconBox>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t.personalInformation}
                  </p>

                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
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
                <div className="border-t border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <InputField
                      label={t.firstName}
                      value={firstName}
                      onChange={setFirstName}
                    />

                    <InputField
                      label={t.lastName}
                      value={lastName}
                      onChange={setLastName}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <InputField
                      label={t.emailAddress}
                      value={email}
                      onChange={setEmail}
                      type="email"
                    />

                    <InputField
                      label={t.phoneNumber}
                      value={phone}
                      onChange={setPhone}
                      type="tel"
                      placeholder="+241 77 37 98 48"
                    />
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <InputField
                      label={t.countryCode}
                      value={countryIso2}
                      onChange={(value) =>
                        setCountryIso2(
                          value.toUpperCase(),
                        )
                      }
                      placeholder="GA"
                    />

                    <InfoField
                      label={t.userId}
                      value={userId ?? ""}
                    />
                  </div>

                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    {t.authInfo}
                  </p>

                  <button
                    type="button"
                    disabled={savingProfile}
                    onClick={savePersonalInformation}
                    className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {savingProfile && (
                      <Loader2
                        size={14}
                        className="animate-spin"
                      />
                    )}

                    {t.save}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  setSecurityOpen(!securityOpen)
                }
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-[var(--surface-2)]"
              >
                <IconBox>
                  <Shield size={17} />
                </IconBox>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t.security}
                  </p>

                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {t.securityDescription}
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
                <div className="border-t border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <p className="text-sm font-medium">
                      {t.accountAddress}
                    </p>

                    <p className="mt-1 truncate text-sm text-[var(--muted)]">
                      {email}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <p className="text-sm font-medium">
                      {t.password}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {t.passwordDescription}
                    </p>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <InputField
                        label={t.newPassword}
                        value={newPassword}
                        onChange={setNewPassword}
                        type="password"
                        placeholder="••••••••"
                      />

                      <InputField
                        label={t.confirmPassword}
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        type="password"
                        placeholder="••••••••"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={savingPassword}
                      onClick={changePassword}
                      className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {savingPassword && (
                        <Loader2
                          size={14}
                          className="animate-spin"
                        />
                      )}
                      {savingPassword
                        ? t.saving
                        : t.changePassword}
                    </button>

                    <div className="mt-5 border-t border-[var(--border)] pt-4">
                      <p className="text-xs leading-5 text-[var(--muted)]">
                        {t.resetHelp}
                      </p>

                      <button
                        type="button"
                        disabled={resettingPassword}
                        onClick={sendPasswordReset}
                        className="mt-3 rounded-xl border border-[var(--border)] px-4 py-2.5 text-xs font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-50"
                      >
                        {resettingPassword
                          ? t.sending
                          : t.sendResetLink}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <p className="text-sm font-medium">
                      {t.sessions}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {t.sessionsDescription}
                    </p>

                    <button
                      type="button"
                      disabled={loggingOutOthers}
                      onClick={
                        signOutOtherSessions
                      }
                      className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2.5 text-xs font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-50"
                    >
                      {loggingOutOthers
                        ? t.signingOut
                        : t.signOutOtherSessions}
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
              title={t.preferences}
              description={t.preferencesDescription}
            >
              <SettingsRow
                icon={<Languages size={17} />}
                title={t.language}
                description={t.interfaceLanguage}
              >
                <div className="flex items-center gap-2">
                  {savingLanguage && (
                    <Loader2
                      size={14}
                      className="animate-spin text-[var(--muted)]"
                    />
                  )}

                  <select
                    value={language}
                    onChange={(event) =>
                      changeLanguage(
                        event.target.value as Language,
                      )
                    }
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-neutral-400"
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
                title={t.region}
                description={t.regionDescription}
              >
                <button
                  type="button"
                  disabled={locating}
                  onClick={detectLocation}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm transition hover:bg-[var(--surface-2)] disabled:opacity-50"
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
                    ? t.detecting
                    : hasLocation
                      ? t.refresh
                      : t.detect}
                </button>
              </SettingsRow>

              {hasLocation && (
                <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
                  <p className="text-xs text-[var(--muted)]">
                    {t.detectedLocation}
                  </p>

                  <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
                    {countryName}
                    {cityName ? ` · ${cityName}` : ""}
                  </p>

                  {subdivisionName && (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {subdivisionName}
                    </p>
                  )}

                  {countryCode && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      {countryCode}
                    </p>
                  )}
                </div>
              )}

              <SettingsRow
                icon={<Moon size={17} />}
                title={t.darkMode}
                description={t.appearanceDescription}
              >
                <div className="flex items-center gap-2">
                  {savingTheme && (
                    <Loader2
                      size={14}
                      className="animate-spin text-[var(--muted)]"
                    />
                  )}

                  <Toggle
                    checked={theme === "dark"}
                    onChange={(checked) =>
                      changeTheme(
                        checked ? "dark" : "light",
                      )
                    }
                    label={t.enableDarkMode}
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {/* =================================================
                NOTIFICATIONS
            ================================================= */}

            <SettingsSection
              icon={<Bell size={18} />}
              title={t.notifications}
              description={t.notificationsSectionDescription}
            >
              <SettingsRow
                icon={<Bell size={17} />}
                title={t.notifications}
                description={t.notificationsDescription}
              >
                <div className="flex items-center gap-2">
                  {savingNotifications && (
                    <Loader2
                      size={14}
                      className="animate-spin text-[var(--muted)]"
                    />
                  )}

                  <Toggle
                    checked={notifications}
                    onChange={
                      changeNotifications
                    }
                    label={t.enableNotifications}
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {/* =================================================
                ABONNEMENT
            ================================================= */}

            <SettingsSection
              icon={<Sparkles size={18} />}
              title={t.subscription}
              description={t.subscriptionDescription}
            >
              <SettingsRow
                icon={<Sparkles size={17} />}
                title={t.currentPack}
                description={t.currentPackDescription}
              >
                <Link
                  href="/packs"
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  {t.manage}
                  <ChevronRight size={15} />
                </Link>
              </SettingsRow>

              <SettingsRow
                icon={<Sparkles size={17} />}
                title={t.credits}
                description={t.creditsDescription}
              >
                <Link
                  href="/credits"
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  {t.view}
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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--background)] text-red-600">
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
                      ? t.signingOut
                      : t.logout}
                  </p>

                  <p className="mt-0.5 text-xs text-red-500">
                    {t.logoutDescription}
                  </p>
                </div>
              </button>
            </section>
          </>
        )}

        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          Oria · Version 1.0
        </p>
      </section>
    </main>
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
    <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-3">
          <IconBox>{icon}</IconBox>

          <div>
            <h2 className="text-sm font-semibold">
              {title}
            </h2>

            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-neutral-200 bg-[var(--background)]">
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

        <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
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
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
        {label}
      </label>

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none transition focus:border-neutral-400"
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
      <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">
        {label}
      </p>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm text-[var(--foreground)]">
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
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]">
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
          ? "bg-[var(--foreground)]"
          : "bg-neutral-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-[var(--background)] transition ${
          checked
            ? "left-6"
            : "left-1"
        }`}
      />
    </button>
  );
}