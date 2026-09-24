import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";

/**
 * ============================================================
 * SETTINGS — REACT NATIVE / EXPO
 * ============================================================
 *
 * Conversion complète de la page Settings Web.
 *
 * Le fichier source contient 1 804 lignes. Cette version ne
 * cherche volontairement pas à condenser le comportement.
 *
 * Les responsabilités sont conservées séparément :
 *
 * 1. chargement du compte Supabase ;
 * 2. chargement / création du profil ;
 * 3. informations personnelles ;
 * 4. langue ;
 * 5. notifications ;
 * 6. thème ;
 * 7. géolocalisation ;
 * 8. reverse geocoding ;
 * 9. changement de mot de passe ;
 * 10. réinitialisation par e-mail ;
 * 11. fermeture des autres sessions ;
 * 12. déconnexion ;
 * 13. navigation vers Packs / Crédits / Chat.
 *
 * Les primitives Web ont été remplacées par leurs équivalents
 * natifs :
 *
 * Link              -> router.push / router.replace
 * window.location   -> router
 * input             -> TextInput
 * button            -> Pressable
 * checkbox/toggle   -> Switch
 * select            -> Modal de sélection
 * navigator.geo     -> expo-location
 * lucide-react      -> Ionicons
 * Tailwind          -> StyleSheet
 */

/**
 * ============================================================
 * TYPES
 * ============================================================
 */

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

/**
 * ============================================================
 * CONSTANTES
 * ============================================================
 */

const DEFAULT_COUNTRY_ISO2 = "GA";

const DEFAULT_LANGUAGE: Language = "fr";

const DEFAULT_THEME: Theme = "light";


const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const SETTINGS_TEXT = {
  fr: {
    backToChat: "Retour au chat",
    myCredits: "Mes crédits",
    yourAccount: "Votre compte",
    settings: "Paramètres",
    pageDescription: "Gérez votre compte et vos préférences Oria.",
    loadingSettings: "Chargement de vos paramètres...",
    account: "Compte",
    accountDescription: "Informations personnelles et sécurité.",
    personalInformation: "Informations personnelles",
    firstName: "Prénom",
    lastName: "Nom",
    email: "Adresse e-mail",
    phone: "Numéro de téléphone",
    countryCode: "Code pays",
    userId: "Identifiant utilisateur",
    authInfo:
      "L'e-mail et le téléphone sont enregistrés directement dans votre compte d'authentification Supabase.",
    save: "Enregistrer",
    security: "Sécurité",
    securityDescription: "Mot de passe et sessions",
    accountAddress: "Adresse du compte",
    password: "Mot de passe",
    passwordDescription:
      "Définissez directement un nouveau mot de passe pour votre compte Supabase.",
    newPassword: "Nouveau mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    changePassword: "Modifier le mot de passe",
    resetDescription:
      "Vous pouvez aussi demander un lien sécurisé de réinitialisation par e-mail.",
    sendResetLink: "Envoyer un lien de réinitialisation",
    sessions: "Sessions",
    sessionsDescription: "Fermez les sessions ouvertes sur vos autres appareils.",
    signOutOtherSessions: "Déconnecter les autres sessions",
    preferences: "Préférences",
    preferencesDescription: "Personnalisez votre expérience.",
    language: "Langue",
    interfaceLanguage: "Langue de l'interface",
    french: "Français",
    english: "English",
    region: "Région",
    locationDetection: "Détection de votre position",
    detecting: "Détection...",
    refresh: "Actualiser",
    detect: "Détecter",
    detectedLocation: "Localisation détectée",
    locationUndetermined: "Localisation non déterminée",
    unknownCountry: "Pays inconnu",
    darkMode: "Mode sombre",
    darkModeDescription: "Modifier l'apparence de l'application",
    enableDarkMode: "Activer le mode sombre",
    notifications: "Notifications",
    notificationsSectionDescription:
      "Choisissez les informations que vous souhaitez recevoir.",
    notificationsDescription:
      "Informations importantes sur votre compte et vos crédits",
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
    loggingOut: "Déconnexion...",
    logoutDescription: "Fermer votre session actuelle",
    chooseLanguage: "Choisir une langue",
    close: "Fermer",
    closeMessage: "Fermer le message",
    saving: "Enregistrement...",
    sending: "Envoi...",
    userFallback: "Utilisateur",

    loadSettingsError: "Impossible de charger les paramètres de votre compte.",
    emailRequired: "L'adresse e-mail est requise.",
    phoneRequired: "Le numéro de téléphone est requis.",
    countryRequired: "Le code pays est requis.",
    personalSaved:
      "Vos informations personnelles ont été enregistrées dans Supabase.",
    personalSaveError: "Impossible d'enregistrer vos informations.",
    frenchActivated: "Langue française activée.",
    englishActivated: "English language activated.",
    languageSaveError: "Impossible d'enregistrer la langue.",
    notificationsEnabled: "Les notifications sont activées.",
    notificationsDisabled: "Les notifications sont désactivées.",
    preferenceSaveError: "Impossible d'enregistrer cette préférence.",
    darkActivated: "Mode sombre activé.",
    lightActivated: "Mode clair activé.",
    themeSaveError: "Impossible d'enregistrer le thème.",
    locationPermissionDenied: "Vous avez refusé l'accès à votre position.",
    locationDetermineError: "Impossible de déterminer votre localisation.",
    locationUpdated: "Votre localisation a été mise à jour.",
    locationSaveError: "Impossible d'enregistrer votre localisation.",
    enterNewPassword: "Saisissez un nouveau mot de passe.",
    passwordMin: "Le nouveau mot de passe doit contenir au moins 6 caractères.",
    passwordsMismatch: "Les deux mots de passe ne correspondent pas.",
    passwordUpdated: "Votre mot de passe a été mis à jour dans Supabase.",
    passwordUpdateError: "Impossible de mettre à jour votre mot de passe.",
    noAccountEmail: "Aucune adresse e-mail associée à ce compte.",
    resetEmailSent: "L'e-mail de réinitialisation a été envoyé.",
    resetEmailError: "Impossible d'envoyer l'e-mail de réinitialisation.",
    otherSessionsSignedOut: "Les autres sessions ont été déconnectées.",
    otherSessionsError: "Impossible de fermer les autres sessions.",
    logoutError: "Impossible de vous déconnecter.",
  },
  en: {
    backToChat: "Back to chat",
    myCredits: "My credits",
    yourAccount: "Your account",
    settings: "Settings",
    pageDescription: "Manage your Oria account and preferences.",
    loadingSettings: "Loading your settings...",
    account: "Account",
    accountDescription: "Personal information and security.",
    personalInformation: "Personal information",
    firstName: "First name",
    lastName: "Last name",
    email: "Email address",
    phone: "Phone number",
    countryCode: "Country code",
    userId: "User ID",
    authInfo:
      "Your email and phone number are stored directly in your Supabase authentication account.",
    save: "Save",
    security: "Security",
    securityDescription: "Password and sessions",
    accountAddress: "Account address",
    password: "Password",
    passwordDescription:
      "Set a new password directly for your Supabase account.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    changePassword: "Change password",
    resetDescription:
      "You can also request a secure password reset link by email.",
    sendResetLink: "Send password reset link",
    sessions: "Sessions",
    sessionsDescription: "Close sessions open on your other devices.",
    signOutOtherSessions: "Sign out other sessions",
    preferences: "Preferences",
    preferencesDescription: "Customize your experience.",
    language: "Language",
    interfaceLanguage: "Interface language",
    french: "Français",
    english: "English",
    region: "Region",
    locationDetection: "Detect your location",
    detecting: "Detecting...",
    refresh: "Refresh",
    detect: "Detect",
    detectedLocation: "Detected location",
    locationUndetermined: "Location not determined",
    unknownCountry: "Unknown country",
    darkMode: "Dark mode",
    darkModeDescription: "Change the application's appearance",
    enableDarkMode: "Enable dark mode",
    notifications: "Notifications",
    notificationsSectionDescription:
      "Choose the information you want to receive.",
    notificationsDescription:
      "Important information about your account and credits",
    enableNotifications: "Enable notifications",
    subscription: "Subscription",
    subscriptionDescription: "Review your current Oria access.",
    currentPack: "Current pack",
    currentPackDescription: "Your access and validity period",
    manage: "Manage",
    credits: "Credits",
    creditsDescription: "View your balance and usage",
    view: "View",
    logout: "Sign out",
    loggingOut: "Signing out...",
    logoutDescription: "Close your current session",
    chooseLanguage: "Choose a language",
    close: "Close",
    closeMessage: "Close message",
    saving: "Saving...",
    sending: "Sending...",
    userFallback: "User",

    loadSettingsError: "Unable to load your account settings.",
    emailRequired: "Email address is required.",
    phoneRequired: "Phone number is required.",
    countryRequired: "Country code is required.",
    personalSaved: "Your personal information has been saved in Supabase.",
    personalSaveError: "Unable to save your information.",
    frenchActivated: "Langue française activée.",
    englishActivated: "English language activated.",
    languageSaveError: "Unable to save the language.",
    notificationsEnabled: "Notifications are enabled.",
    notificationsDisabled: "Notifications are disabled.",
    preferenceSaveError: "Unable to save this preference.",
    darkActivated: "Dark mode enabled.",
    lightActivated: "Light mode enabled.",
    themeSaveError: "Unable to save the theme.",
    locationPermissionDenied: "You denied access to your location.",
    locationDetermineError: "Unable to determine your location.",
    locationUpdated: "Your location has been updated.",
    locationSaveError: "Unable to save your location.",
    enterNewPassword: "Enter a new password.",
    passwordMin: "The new password must contain at least 6 characters.",
    passwordsMismatch: "The two passwords do not match.",
    passwordUpdated: "Your password has been updated in Supabase.",
    passwordUpdateError: "Unable to update your password.",
    noAccountEmail: "No email address is associated with this account.",
    resetEmailSent: "The password reset email has been sent.",
    resetEmailError: "Unable to send the password reset email.",
    otherSessionsSignedOut: "Other sessions have been signed out.",
    otherSessionsError: "Unable to close the other sessions.",
    logoutError: "Unable to sign you out.",
  },
} as const;

async function readStoredOriaLanguage(): Promise<Language> {
  try {
    if (Platform.OS === "web") {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY)
          : null;

      if (saved === "fr" || saved === "en") return saved;

      if (
        typeof navigator !== "undefined" &&
        navigator.language.toLowerCase().startsWith("en")
      ) {
        return "en";
      }

      return DEFAULT_LANGUAGE;
    }

    const saved = await SecureStore.getItemAsync(ORIA_LANGUAGE_STORAGE_KEY);
    return saved === "en" ? "en" : "fr";
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

async function publishOriaLanguage(value: Language) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ORIA_LANGUAGE_STORAGE_KEY, value);
      window.dispatchEvent(new Event("oria-language-change"));
    }
    return;
  }

  await SecureStore.setItemAsync(ORIA_LANGUAGE_STORAGE_KEY, value);
}


/**
 * ============================================================
 * PAGE PRINCIPALE
 * ============================================================
 */

export default function SettingsPage() {
  /**
   * ----------------------------------------------------------
   * DONNÉES PROFIL
   * ----------------------------------------------------------
   */

  const [
    profile,
    setProfile,
  ] = useState<Profile | null>(null);

  const [
    userId,
    setUserId,
  ] = useState<string | null>(null);

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    originalEmail,
    setOriginalEmail,
  ] = useState("");

  const [
    phone,
    setPhone,
  ] = useState("");

  const [
    countryIso2,
    setCountryIso2,
  ] = useState(
    DEFAULT_COUNTRY_ISO2,
  );

  const [
    firstName,
    setFirstName,
  ] = useState("");

  const [
    lastName,
    setLastName,
  ] = useState("");

  /**
   * ----------------------------------------------------------
   * SÉCURITÉ
   * ----------------------------------------------------------
   */

  const [
    newPassword,
    setNewPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  /**
   * ----------------------------------------------------------
   * PRÉFÉRENCES
   * ----------------------------------------------------------
   */

  const [
    language,
    setLanguage,
  ] = useState<Language>(
    DEFAULT_LANGUAGE,
  );

  const t = SETTINGS_TEXT[language];

  const [
    notifications,
    setNotifications,
  ] = useState(true);

  /**
   * Le thème est stocké localement dans cette page et
   * synchronisé avec le profil Supabase.
   *
   * Si un ThemeProvider existe déjà dans le projet mobile,
   * cette valeur pourra être reliée à celui-ci sans modifier
   * le reste de la logique.
   */
  const [
    theme,
    setTheme,
  ] = useState<Theme>(
    DEFAULT_THEME,
  );

  /**
   * ----------------------------------------------------------
   * ÉTATS DE CHARGEMENT
   * ----------------------------------------------------------
   */

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    savingProfile,
    setSavingProfile,
  ] = useState(false);

  const [
    savingLanguage,
    setSavingLanguage,
  ] = useState(false);

  const [
    savingNotifications,
    setSavingNotifications,
  ] = useState(false);

  const [
    savingTheme,
    setSavingTheme,
  ] = useState(false);

  const [
    locating,
    setLocating,
  ] = useState(false);

  const [
    loggingOut,
    setLoggingOut,
  ] = useState(false);

  const [
    resettingPassword,
    setResettingPassword,
  ] = useState(false);

  const [
    savingPassword,
    setSavingPassword,
  ] = useState(false);

  const [
    loggingOutOthers,
    setLoggingOutOthers,
  ] = useState(false);

  /**
   * ----------------------------------------------------------
   * MESSAGES
   * ----------------------------------------------------------
   */

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  /**
   * ----------------------------------------------------------
   * SECTIONS
   * ----------------------------------------------------------
   */

  const [
    personalOpen,
    setPersonalOpen,
  ] = useState(false);

  const [
    securityOpen,
    setSecurityOpen,
  ] = useState(false);

  /**
   * ----------------------------------------------------------
   * LOCALISATION
   * ----------------------------------------------------------
   */

  const [
    countryName,
    setCountryName,
  ] = useState<string>(
    SETTINGS_TEXT[language].locationUndetermined,
  );

  const [
    countryCode,
    setCountryCode,
  ] = useState("");

  const [
    cityName,
    setCityName,
  ] = useState("");

  const [
    subdivisionName,
    setSubdivisionName,
  ] = useState("");

  /**
   * ----------------------------------------------------------
   * MODAL LANGUE
   * ----------------------------------------------------------
   */

  const [
    languageModalVisible,
    setLanguageModalVisible,
  ] = useState(false);

  /**
   * ----------------------------------------------------------
   * CHARGEMENT INITIAL
   * ----------------------------------------------------------
   */

  useEffect(() => {
    void readStoredOriaLanguage().then(
      (storedLanguage) => {
        setLanguage(storedLanguage);
      },
    );

    void loadSettings();
  }, []);

  /**
   * ==========================================================
   * LOAD SETTINGS
   * ==========================================================
   */

  async function loadSettings() {
    setLoading(true);

    setErrorMessage("");

    try {
      /**
       * Identité officielle Supabase.
       */
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      /**
       * Aucun utilisateur :
       * retour vers Login.
       *
       * window.location.href du Web est remplacé par
       * router.replace dans Expo Router.
       */
      if (!user) {
        router.replace("/login" as any);

        return;
      }

      /**
       * ------------------------------------------------------
       * IDENTITÉ AUTH
       * ------------------------------------------------------
       */

      setUserId(
        user.id,
      );

      setEmail(
        user.email ?? "",
      );

      setOriginalEmail(
        user.email ?? "",
      );

      setPhone(
        user.phone ?? "",
      );

      /**
       * ------------------------------------------------------
       * PAYS AUTH
       * ------------------------------------------------------
       */

      const metadataCountry =
        (
          user.user_metadata
            ?.country_iso2 as
          | string
          | undefined
        ) ??
        (
          user.user_metadata
            ?.country as
          | string
          | undefined
        ) ??
        "";

      setCountryIso2(
        metadataCountry
          .trim()
          .toUpperCase() ||
          DEFAULT_COUNTRY_ISO2,
      );

      /**
       * ------------------------------------------------------
       * PROFIL SUPABASE
       * ------------------------------------------------------
       *
       * On récupère uniquement le profil de l'utilisateur
       * connecté.
       */
      const {
        data:
          existingProfile,
        error:
          profileError,
      } =
        await supabase
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
          .eq(
            "id",
            user.id,
          )
          .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      let currentProfile =
        existingProfile as
          | Profile
          | null;

      /**
       * ------------------------------------------------------
       * CRÉATION DE SECOURS DU PROFIL
       * ------------------------------------------------------
       *
       * Si le trigger Supabase n'a pas créé le profil,
       * on le crée sans supposer que l'utilisateur se trouve
       * dans un pays précis.
       */
      if (!currentProfile) {
        const {
          data:
            createdProfile,
          error:
            createError,
        } =
          await supabase
            .from("profiles")
            .insert({
              id: user.id,

              first_name:
                (
                  user.user_metadata
                    ?.first_name as
                  | string
                  | undefined
                ) ??
                null,

              last_name:
                (
                  user.user_metadata
                    ?.last_name as
                  | string
                  | undefined
                ) ??
                null,

              language: "fr",

              notifications_enabled:
                true,

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

      /**
       * ------------------------------------------------------
       * SYNCHRONISATION REACT
       * ------------------------------------------------------
       */

      setProfile(
        currentProfile,
      );

      setFirstName(
        currentProfile.first_name ??
          "",
      );

      setLastName(
        currentProfile.last_name ??
          "",
      );

      setLanguage(
        currentProfile.language,
      );

      await publishOriaLanguage(
        currentProfile.language,
      );

      setNotifications(
        currentProfile.notifications_enabled,
      );

      setTheme(
        currentProfile.theme,
      );

      /**
       * ------------------------------------------------------
       * SYNCHRONISATION LOCALISATION
       * ------------------------------------------------------
       */

      setCountryName(
        currentProfile.country_name ??
          SETTINGS_TEXT[currentProfile.language].locationUndetermined,
      );

      setCountryCode(
        currentProfile.country_code ??
          "",
      );

      setCityName(
        currentProfile.city ??
          "",
      );

      setSubdivisionName(
        currentProfile.subdivision ??
          "",
      );

      /**
       * ------------------------------------------------------
       * REVERSE GEOCODING SI GPS EXISTANT
       * ------------------------------------------------------
       *
       * Comme dans la version Web, si les coordonnées sont
       * déjà enregistrées, on peut recalculer une localisation
       * lisible.
       */
      if (
        currentProfile.latitude !==
          null &&
        currentProfile.longitude !==
          null
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

  /**
   * ==========================================================
   * SAVE PERSONAL INFORMATION
   * ==========================================================
   */

  async function savePersonalInformation() {
    setSavingProfile(true);

    clearMessages();

    try {
      /**
       * Utilisateur réellement connecté.
       */
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      /**
       * Normalisation des valeurs.
       */
      const normalizedEmail =
        email.trim();

      const normalizedPhone =
        phone.trim();

      const normalizedCountry =
        countryIso2
          .trim()
          .toUpperCase();

      /**
       * Validations identiques à la logique Web.
       */
      if (!normalizedEmail) {
        throw new Error(
          t.emailRequired,
        );
      }

      if (!normalizedPhone) {
        throw new Error(
          t.phoneRequired,
        );
      }

      if (!normalizedCountry) {
        throw new Error(
          t.countryRequired,
        );
      }

      /**
       * ======================================================
       * 1. PROFIL APPLICATIF
       * ======================================================
       */

      const {
        error:
          profileError,
      } =
        await supabase
          .from("profiles")
          .update({
            first_name:
              firstName.trim() ||
              null,

            last_name:
              lastName.trim() ||
              null,
          })
          .eq(
            "id",
            user.id,
          );

      if (profileError) {
        throw profileError;
      }

      /**
       * ======================================================
       * 2. COMPTE AUTH SUPABASE
       * ======================================================
       *
       * L'e-mail et le téléphone sont enregistrés dans
       * auth.users via Supabase Auth.
       */

      const authChanges: {
        email?: string;

        phone?: string;
      } = {};

      if (
        normalizedEmail !==
        originalEmail.trim()
      ) {
        authChanges.email =
          normalizedEmail;
      }

      if (
        normalizedPhone !==
        (
          user.phone ??
          ""
        ).trim()
      ) {
        authChanges.phone =
          normalizedPhone;
      }

      if (
        Object.keys(
          authChanges,
        ).length > 0
      ) {
        const {
          data:
            updatedAuth,
          error:
            authUpdateError,
        } =
          await supabase.auth.updateUser(
            authChanges,
          );

        if (authUpdateError) {
          throw authUpdateError;
        }

        const updatedUser =
          updatedAuth.user;

        setEmail(
          updatedUser.email ??
            normalizedEmail,
        );

        setOriginalEmail(
          updatedUser.email ??
            normalizedEmail,
        );

        setPhone(
          updatedUser.phone ??
            normalizedPhone,
        );
      }

      /**
       * ======================================================
       * 3. PAYS DU PROFIL
       * ======================================================
       *
       * Le code pays est conservé dans user_metadata afin
       * que le backend de paiement puisse l'utiliser.
       */

      const currentCountry =
        String(
          user.user_metadata
            ?.country_iso2 ??
            "",
        )
          .trim()
          .toUpperCase();

      if (
        normalizedCountry !==
        currentCountry
      ) {
        const {
          error:
            metadataError,
        } =
          await supabase.auth.updateUser(
            {
              data: {
                country_iso2:
                  normalizedCountry,
              },
            },
          );

        if (metadataError) {
          throw metadataError;
        }
      }

      /**
       * Synchronisation locale.
       */
      setCountryIso2(
        normalizedCountry,
      );

      setProfile(
        (current) =>
          current
            ? {
                ...current,

                first_name:
                  firstName.trim() ||
                  null,

                last_name:
                  lastName.trim() ||
                  null,
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
      setSavingProfile(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * CHANGE LANGUAGE
   * ==========================================================
   */

  async function changeLanguage(
    value: Language,
  ) {
    const previousLanguage =
      language;

    setLanguage(value);

    setSavingLanguage(
      true,
    );

    clearMessages();

    setLanguageModalVisible(
      false,
    );

    try {
      await publishOriaLanguage(
        value,
      );
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      const {
        error,
      } =
        await supabase
          .from("profiles")
          .update({
            language: value,
          })
          .eq(
            "id",
            user.id,
          );

      if (error) {
        throw error;
      }

      setProfile(
        (current) =>
          current
            ? {
                ...current,
                language: value,
              }
            : current,
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
          setCountryName(
            localizedLocation.countryName,
          );
          setCountryCode(
            localizedLocation.countryCode,
          );
          setCityName(
            localizedLocation.city,
          );
          setSubdivisionName(
            localizedLocation.subdivision,
          );
        }
      } else {
        setCountryName(
          SETTINGS_TEXT[value].locationUndetermined,
        );
      }

      setSuccessMessage(
        value === "fr"
          ? SETTINGS_TEXT.fr.frenchActivated
          : SETTINGS_TEXT.en.englishActivated,
      );
    } catch (error) {
      console.error(
        "LANGUAGE UPDATE ERROR:",
        error,
      );

      setLanguage(
        previousLanguage,
      );

      try {
        await publishOriaLanguage(
          previousLanguage,
        );
      } catch {
        // The Supabase error remains the primary user-facing error.
      }

      setErrorMessage(
        SETTINGS_TEXT[previousLanguage].languageSaveError,
      );
    } finally {
      setSavingLanguage(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * CHANGE NOTIFICATIONS
   * ==========================================================
   */

  async function changeNotifications(
    value: boolean,
  ) {
    const previousValue =
      notifications;

    setNotifications(value);

    setSavingNotifications(
      true,
    );

    clearMessages();

    try {
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      const {
        error,
      } =
        await supabase
          .from("profiles")
          .update({
            notifications_enabled:
              value,
          })
          .eq(
            "id",
            user.id,
          );

      if (error) {
        throw error;
      }

      setProfile(
        (current) =>
          current
            ? {
                ...current,

                notifications_enabled:
                  value,
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

      setNotifications(
        previousValue,
      );

      setErrorMessage(
        t.preferenceSaveError,
      );
    } finally {
      setSavingNotifications(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * CHANGE THEME
   * ==========================================================
   */

  async function changeTheme(
    value: Theme,
  ) {
    setSavingTheme(true);

    clearMessages();

    try {
      /**
       * Le Web appelle useTheme().setTheme().
       *
       * Dans cette conversion, le thème local de la page est
       * modifié immédiatement. Si le projet mobile possède un
       * ThemeProvider global, cette fonction est le point unique
       * où le relier.
       */
      setTheme(value);

      /**
       * Synchronisation Supabase.
       *
       * Le Web stocke également le thème dans profiles.
       */
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      const {
        error,
      } =
        await supabase
          .from("profiles")
          .update({
            theme: value,
          })
          .eq(
            "id",
            user.id,
          );

      if (error) {
        throw error;
      }

      setProfile(
        (current) =>
          current
            ? {
                ...current,
                theme: value,
              }
            : current,
      );

      setSuccessMessage(
        value === "dark"
          ? t.darkActivated
          : t.lightActivated,
      );
    } catch (error) {
      console.error(
        "THEME UPDATE ERROR:",
        error,
      );

      setErrorMessage(
        t.themeSaveError,
      );
    } finally {
      setSavingTheme(false);
    }
  }

  /**
   * ==========================================================
   * DETECT LOCATION
   * ==========================================================
   *
   * navigator.geolocation du navigateur est remplacé par
   * expo-location.
   */

  async function detectLocation() {
    if (locating) {
      return;
    }

    setLocating(true);

    clearMessages();

    try {
      /**
       * ------------------------------------------------------
       * DEMANDE D'AUTORISATION
       * ------------------------------------------------------
       */

      const {
        status:
          foregroundStatus,
      } =
        await Location.requestForegroundPermissionsAsync();

      if (
        foregroundStatus !==
        Location.PermissionStatus.GRANTED
      ) {
        setErrorMessage(
          t.locationPermissionDenied,
        );

        return;
      }

      /**
       * ------------------------------------------------------
       * POSITION ACTUELLE
       * ------------------------------------------------------
       */

      const position =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy.High,
          },
        );

      /**
       * ------------------------------------------------------
       * UTILISATEUR CONNECTÉ
       * ------------------------------------------------------
       */

      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      /**
       * ------------------------------------------------------
       * COORDONNÉES
       * ------------------------------------------------------
       */

      const latitude =
        position.coords.latitude;

      const longitude =
        position.coords.longitude;

      /**
       * ------------------------------------------------------
       * GPS -> LOCALISATION LISIBLE
       * ------------------------------------------------------
       */

      const location =
        await reverseGeocode(
          latitude,
          longitude,
        );

      if (!location) {
        throw new Error(
          t.locationDetermineError,
        );
      }

      /**
       * ------------------------------------------------------
       * DATE DE MISE À JOUR
       * ------------------------------------------------------
       */

      const locationUpdatedAt =
        new Date().toISOString();

      /**
       * ------------------------------------------------------
       * UPDATE UNIQUE SUPABASE
       * ------------------------------------------------------
       */

      const {
        error,
      } =
        await supabase
          .from("profiles")
          .update({
            latitude,

            longitude,

            country_code:
              location.countryCode,

            country_name:
              location.countryName,

            city:
              location.city ||
              null,

            subdivision:
              location.subdivision ||
              null,

            location_updated_at:
              locationUpdatedAt,
          })
          .eq(
            "id",
            user.id,
          );

      if (error) {
        throw error;
      }

      /**
       * ------------------------------------------------------
       * PROFIL LOCAL
       * ------------------------------------------------------
       */

      setProfile(
        (current) =>
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
                  location.city ||
                  null,

                subdivision:
                  location.subdivision ||
                  null,

                location_updated_at:
                  locationUpdatedAt,
              }
            : current,
      );

      /**
       * ------------------------------------------------------
       * INTERFACE
       * ------------------------------------------------------
       */

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

      if (
        error instanceof Error &&
        error.message
      ) {
        setErrorMessage(
          t.locationSaveError,
        );
      } else {
        setErrorMessage(
          t.locationSaveError,
        );
      }
    } finally {
      setLocating(false);
    }
  }

  /**
   * ==========================================================
   * REVERSE GEOCODING
   * ==========================================================
   *
   * Même service externe que le Web :
   * BigDataCloud.
   */

  async function reverseGeocode(
    latitude: number,
    longitude: number,
    locale: Language = language,
  ): Promise<
    GeocodedLocation | null
  > {
    try {
      const response =
        await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
            String(latitude),
          )}&longitude=${encodeURIComponent(
            String(longitude),
          )}&localityLanguage=${encodeURIComponent(
            locale,
          )}`,
        );

      if (!response.ok) {
        throw new Error(
          "Reverse geocoding failed",
        );
      }

      const data =
        await response.json();

      const countryCode =
        data.countryCode ??
        "";

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

  /**
   * ==========================================================
   * CHANGE PASSWORD
   * ==========================================================
   */

  async function changePassword() {
    clearMessages();

    /**
     * Validation 1.
     */
    if (!newPassword) {
      setErrorMessage(
        t.enterNewPassword,
      );

      return;
    }

    /**
     * Validation 2.
     */
    if (
      newPassword.length <
      6
    ) {
      setErrorMessage(
        t.passwordMin,
      );

      return;
    }

    /**
     * Validation 3.
     */
    if (
      newPassword !==
      confirmPassword
    ) {
      setErrorMessage(
        t.passwordsMismatch,
      );

      return;
    }

    setSavingPassword(
      true,
    );

    try {
      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/login" as any);

        return;
      }

      /**
       * Mise à jour directe du mot de passe Supabase.
       */
      const {
        error,
      } =
        await supabase.auth.updateUser(
          {
            password:
              newPassword,
          },
        );

      if (error) {
        throw error;
      }

      /**
       * Nettoyage des champs.
       */
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
      setSavingPassword(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * PASSWORD RESET
   * ==========================================================
   */

  async function sendPasswordReset() {
    if (!email) {
      setErrorMessage(
        t.noAccountEmail,
      );

      return;
    }

    setResettingPassword(
      true,
    );

    clearMessages();

    try {
      /**
       * Sur mobile, window.location.origin n'existe pas.
       *
       * Le redirectTo doit donc pointer vers un deep link
       * de l'application.
       *
       * Le chemin /settings est conservé comme destination
       * logique de retour.
       */
      const redirectTo =
        "oria://settings";

      const {
        error,
      } =
        await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo,
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
      setResettingPassword(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * SIGN OUT OTHER SESSIONS
   * ==========================================================
   */

  async function signOutOtherSessions() {
    setLoggingOutOthers(
      true,
    );

    clearMessages();

    try {
      const {
        error,
      } =
        await supabase.auth.signOut(
          {
            scope: "others",
          },
        );

      if (error) {
        throw error;
      }

      setSuccessMessage(
        t.otherSessionsSignedOut,
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
      setLoggingOutOthers(
        false,
      );
    }
  }

  /**
   * ==========================================================
   * LOGOUT
   * ==========================================================
   */

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    clearMessages();

    try {
      const {
        error,
      } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace(
        "/login" as any,
      );
    } catch (error) {
      console.error(
        "LOGOUT ERROR:",
        error,
      );

      setErrorMessage(
        t.logoutError,
      );

      setLoggingOut(false);
    }
  }

  /**
   * ==========================================================
   * CLEAR MESSAGES
   * ==========================================================
   */

  function clearMessages() {
    setErrorMessage("");

    setSuccessMessage("");
  }

  /**
   * ==========================================================
   * DERIVED DATA
   * ==========================================================
   */

  const fullName =
    [
      firstName,
      lastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    t.userFallback;

  const hasLocation =
    profile?.latitude !=
      null &&
    profile?.longitude !=
      null;

  /**
   * ==========================================================
   * RENDER
   * ==========================================================
   */

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        theme === "dark" &&
          styles.safeAreaDark,
      ]}
      edges={[
        "top",
        "left",
        "right",
      ]}
    >
      <KeyboardAvoidingView
        style={
          styles.keyboardContainer
        }
        behavior={
          Platform.OS ===
          "ios"
            ? "padding"
            : undefined
        }
      >
        <View
          style={[
            styles.page,
            theme === "dark" &&
              styles.pageDark,
          ]}
        >
          {/* ==================================================
              HEADER
          ================================================== */}

          <View
            style={[
              styles.header,
              theme === "dark" &&
                styles.headerDark,
            ]}
          >
            <View
              style={
                styles.headerLeft
              }
            >
              <Pressable
                onPress={() =>
                  router.replace(
                    "/chat" as any,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t.backToChat}
                style={({ pressed }) => [
                  styles.headerBackButton,
                  pressed &&
                    styles.pressed,
                  loggingOut &&
                    styles.disabled,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={20}
                  color={
                    theme ===
                    "dark"
                      ? "#e4e4e7"
                      : "#52525b"
                  }
                />
              </Pressable>

              <View
                style={
                  styles.brandContainer
                }
              >
                <Ionicons
                  name="sparkles"
                  size={18}
                  color={
                    theme ===
                    "dark"
                      ? "#ffffff"
                      : "#18181b"
                  }
                />

                <Text
                  style={[
                    styles.brandText,
                    theme ===
                      "dark" &&
                      styles.textDark,
                  ]}
                >
                  Oria
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() =>
                router.push(
                  "/credits" as any,
                )
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.headerCreditsButton,
                pressed &&
                  styles.pressed,
              ]}
            >
              <Ionicons
                name="card-outline"
                size={17}
                color={
                  theme ===
                  "dark"
                    ? "#d4d4d8"
                    : "#52525b"
                }
              />

              <Text
                style={[
                  styles.headerCreditsText,
                  theme ===
                    "dark" &&
                    styles.textMutedDark,
                ]}
              >
                {t.myCredits}
              </Text>
            </Pressable>
          </View>

          {/* ==================================================
              CONTENT
          ================================================== */}

          <ScrollView
            style={
              styles.scrollView
            }
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={
              false
            }
            keyboardShouldPersistTaps="handled"
          >
            {/* =================================================
                TITLE
            ================================================= */}

            <View
              style={
                styles.titleArea
              }
            >
              <Text
                style={[
                  styles.eyebrow,
                  theme ===
                    "dark" &&
                    styles.textMutedDark,
                ]}
              >
                {t.yourAccount}
              </Text>

              <Text
                style={[
                  styles.pageTitle,
                  theme ===
                    "dark" &&
                    styles.textDark,
                ]}
              >
                {t.settings}
              </Text>

              <Text
                style={[
                  styles.pageDescription,
                  theme ===
                    "dark" &&
                    styles.textMutedDark,
                ]}
              >
                  {t.pageDescription}
              </Text>
            </View>

            {/* =================================================
                LOADING
            ================================================= */}

            {loading ? (
              <View
                style={[
                  styles.loadingCard,
                  theme ===
                    "dark" &&
                    styles.cardDark,
                ]}
              >
                <ActivityIndicator
                  size="small"
                  color={
                    theme ===
                    "dark"
                      ? "#ffffff"
                      : "#18181b"
                  }
                />

                <Text
                  style={[
                    styles.loadingText,
                    theme ===
                      "dark" &&
                      styles.textMutedDark,
                  ]}
                >
                    {t.loadingSettings}
                </Text>
              </View>
            ) : null}

            {/* =================================================
                ERROR
            ================================================= */}

            {!loading &&
            errorMessage ? (
              <MessageBanner
                type="error"
                message={
                  errorMessage
                }
                onClose={() =>
                  setErrorMessage(
                    "",
                  )
                }
                closeLabel={t.closeMessage}
              />
            ) : null}

            {/* =================================================
                SUCCESS
            ================================================= */}

            {!loading &&
            successMessage ? (
              <MessageBanner
                type="success"
                message={
                  successMessage
                }
                onClose={() =>
                  setSuccessMessage(
                    "",
                  )
                }
                closeLabel={t.closeMessage}
              />
            ) : null}

            {/* =================================================
                SETTINGS
            ================================================= */}

            {!loading ? (
              <>
                {/* =================================================
                    COMPTE
                ================================================= */}

                <SettingsSection
                  iconName="person-outline"
                  title={t.account}
                  description={t.accountDescription}
                  theme={theme}
                >
                  {/* ===============================================
                      INFORMATIONS PERSONNELLES
                  =============================================== */}

                  <SettingsActionRow
                    iconName="person-outline"
                    title={t.personalInformation}
                    description={`${fullName} · ${email}`}
                    theme={theme}
                    expanded={
                      personalOpen
                    }
                    onPress={() =>
                      setPersonalOpen(
                        !personalOpen,
                      )
                    }
                  />

                  {personalOpen ? (
                    <View
                      style={[
                        styles.expandedArea,
                        theme ===
                          "dark" &&
                          styles.expandedAreaDark,
                      ]}
                    >
                      {/* -------------------------------------------
                          PRÉNOM
                      ------------------------------------------- */}

                      <InputField
                        label={t.firstName}
                        value={
                          firstName
                        }
                        onChangeText={
                          setFirstName
                        }
                        theme={
                          theme
                        }
                        autoCapitalize="words"
                      />

                      {/* -------------------------------------------
                          NOM
                      ------------------------------------------- */}

                      <InputField
                        label={t.lastName}
                        value={
                          lastName
                        }
                        onChangeText={
                          setLastName
                        }
                        theme={
                          theme
                        }
                        autoCapitalize="words"
                      />

                      {/* -------------------------------------------
                          E-MAIL
                      ------------------------------------------- */}

                      <InputField
                        label={t.email}
                        value={
                          email
                        }
                        onChangeText={
                          setEmail
                        }
                        theme={
                          theme
                        }
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={
                          false
                        }
                      />

                      {/* -------------------------------------------
                          TÉLÉPHONE
                      ------------------------------------------- */}

                      <InputField
                        label={t.phone}
                        value={
                          phone
                        }
                        onChangeText={
                          setPhone
                        }
                        theme={
                          theme
                        }
                        keyboardType="phone-pad"
                        placeholder="+241 77 37 98 48"
                      />

                      {/* -------------------------------------------
                          CODE PAYS
                      ------------------------------------------- */}

                      <InputField
                        label={t.countryCode}
                        value={
                          countryIso2
                        }
                        onChangeText={(
                          value,
                        ) =>
                          setCountryIso2(
                            value
                              .toUpperCase(),
                          )
                        }
                        theme={
                          theme
                        }
                        placeholder="GA"
                        autoCapitalize="characters"
                        maxLength={
                          2
                        }
                      />

                      {/* -------------------------------------------
                          IDENTIFIANT
                      ------------------------------------------- */}

                      <InfoField
                        label={t.userId}
                        value={
                          userId ??
                          ""
                        }
                        theme={
                          theme
                        }
                      />

                      {/* -------------------------------------------
                          INFORMATION
                      ------------------------------------------- */}

                      <Text
                        style={[
                          styles.helperText,
                          theme ===
                            "dark" &&
                            styles.textMutedDark,
                        ]}
                      >
                            {t.authInfo}
                      </Text>

                      {/* -------------------------------------------
                          SAVE
                      ------------------------------------------- */}

                      <PrimaryActionButton
                    language={language}
                        title={t.save}
                        loading={
                          savingProfile
                        }
                        disabled={
                          savingProfile
                        }
                        onPress={
                          savePersonalInformation
                        }
                        theme={
                          theme
                        }
                      />
                    </View>
                  ) : null}

                  {/* ===============================================
                      SECURITY
                  =============================================== */}

                  <SettingsActionRow
                    iconName="shield-checkmark-outline"
                    title={t.security}
                    description={t.securityDescription}
                    theme={theme}
                    expanded={
                      securityOpen
                    }
                    onPress={() =>
                      setSecurityOpen(
                        !securityOpen,
                      )
                    }
                  />

                  {securityOpen ? (
                    <View
                      style={[
                        styles.expandedArea,
                        theme ===
                          "dark" &&
                          styles.expandedAreaDark,
                      ]}
                    >
                      {/* -------------------------------------------
                          ACCOUNT EMAIL
                      ------------------------------------------- */}

                      <View
                        style={[
                          styles.securityCard,
                          theme ===
                            "dark" &&
                            styles.innerDark,
                        ]}
                      >
                        <Text
                          style={[
                            styles.securityTitle,
                            theme ===
                              "dark" &&
                              styles.textDark,
                          ]}
                        >
                          {t.accountAddress}
                        </Text>

                        <Text
                          style={[
                            styles.securityValue,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                          numberOfLines={
                            2
                          }
                        >
                          {email}
                        </Text>
                      </View>

                      {/* -------------------------------------------
                          PASSWORD
                      ------------------------------------------- */}

                      <View
                        style={[
                          styles.securityCard,
                          theme ===
                            "dark" &&
                            styles.innerDark,
                        ]}
                      >
                        <Text
                          style={[
                            styles.securityTitle,
                            theme ===
                              "dark" &&
                              styles.textDark,
                          ]}
                        >
                          {t.password}
                        </Text>

                        <Text
                          style={[
                            styles.securityDescription,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                        >
                          {t.passwordDescription}
                        </Text>

                        {/* Nouveau mot de passe */}

                        <InputField
                          label={t.newPassword}
                          value={
                            newPassword
                          }
                          onChangeText={
                            setNewPassword
                          }
                          theme={
                            theme
                          }
                          secureTextEntry
                          placeholder="••••••••"
                          autoCapitalize="none"
                          autoCorrect={
                            false
                        }
                        />

                        {/* Confirmation */}

                        <InputField
                          label={t.confirmPassword}
                          value={
                            confirmPassword
                          }
                          onChangeText={
                            setConfirmPassword
                          }
                          theme={
                            theme
                          }
                          secureTextEntry
                          placeholder="••••••••"
                          autoCapitalize="none"
                          autoCorrect={
                            false
                          }
                        />

                        <PrimaryActionButton
                    language={language}
                          title={t.changePassword}
                          loading={
                            savingPassword
                          }
                          disabled={
                            savingPassword
                          }
                          onPress={
                            changePassword
                          }
                          theme={
                            theme
                          }
                        />

                        {/* Reset */}

                        <View
                          style={[
                            styles.subDivider,
                            theme ===
                              "dark" &&
                              styles.subDividerDark,
                          ]}
                        />

                        <Text
                          style={[
                            styles.resetDescription,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                        >
                          {t.resetDescription}
                        </Text>

                        <SecondaryActionButton
                    language={language}
                          title={t.sendResetLink}
                          loading={
                            resettingPassword
                          }
                          disabled={
                            resettingPassword
                          }
                          onPress={
                            sendPasswordReset
                          }
                          theme={
                            theme
                          }
                        />
                      </View>

                      {/* -------------------------------------------
                          OTHER SESSIONS
                      ------------------------------------------- */}

                      <View
                        style={[
                          styles.securityCard,
                          theme ===
                            "dark" &&
                            styles.innerDark,
                        ]}
                      >
                        <Text
                          style={[
                            styles.securityTitle,
                            theme ===
                              "dark" &&
                              styles.textDark,
                          ]}
                        >
                          {t.sessions}
                        </Text>

                        <Text
                          style={[
                            styles.securityDescription,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                        >
                          {t.sessionsDescription}
                        </Text>

                        <SecondaryActionButton
                    language={language}
                          title={t.signOutOtherSessions}
                          loading={
                            loggingOutOthers
                          }
                          disabled={
                            loggingOutOthers
                          }
                          onPress={
                            signOutOtherSessions
                          }
                          theme={
                            theme
                          }
                        />
                      </View>
                    </View>
                  ) : null}
                </SettingsSection>

                {/* =================================================
                    PRÉFÉRENCES
                ================================================= */}

                <SettingsSection
                  iconName="color-palette-outline"
                  title={t.preferences}
                  description={t.preferencesDescription}
                  theme={theme}
                >
                  {/* -----------------------------------------------
                      LANGUE
                  ----------------------------------------------- */}

                  <SettingsPreferenceRow
                    iconName="language-outline"
                    title={t.language}
                    description={t.interfaceLanguage}
                    theme={theme}
                  >
                    <View
                      style={
                        styles.preferenceAction
                      }
                    >
                      {savingLanguage ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            theme ===
                            "dark"
                              ? "#ffffff"
                              : "#71717a"
                          }
                        />
                      ) : null}

                      <Pressable
                        onPress={() =>
                          setLanguageModalVisible(
                            true,
                          )
                        }
                        disabled={
                          savingLanguage
                        }
                        style={[
                          styles.selectButton,
                          theme ===
                            "dark" &&
                            styles.selectButtonDark,
                        ]}
                      >
                        <Text
                          style={[
                            styles.selectButtonText,
                            theme ===
                              "dark" &&
                              styles.textDark,
                          ]}
                        >
                          {language ===
                          "fr"
                            ? t.french
                    : t.english}
                        </Text>

                        <Ionicons
                          name="chevron-down"
                          size={15}
                          color={
                            theme ===
                            "dark"
                              ? "#d4d4d8"
                              : "#71717a"
                          }
                        />
                      </Pressable>
                    </View>
                  </SettingsPreferenceRow>

                  {/* -----------------------------------------------
                      RÉGION
                  ----------------------------------------------- */}

                  <SettingsPreferenceRow
                    iconName="globe-outline"
                    title={t.region}
                    description={t.locationDetection}
                    theme={theme}
                  >
                    <Pressable
                      onPress={
                        detectLocation
                      }
                      disabled={
                        locating
                      }
                      style={({ pressed }) => [
                        styles.secondarySmallButton,
                        theme ===
                          "dark" &&
                          styles.secondarySmallButtonDark,
                        pressed &&
                          styles.pressed,
                        locating &&
                          styles.disabled,
                      ]}
                    >
                      {locating ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            theme ===
                            "dark"
                              ? "#ffffff"
                              : "#52525b"
                          }
                        />
                      ) : (
                        <Ionicons
                          name="location-outline"
                          size={15}
                          color={
                            theme ===
                            "dark"
                              ? "#ffffff"
                              : "#52525b"
                          }
                        />
                      )}

                      <Text
                        style={[
                          styles.secondarySmallButtonText,
                          theme ===
                            "dark" &&
                            styles.textDark,
                        ]}
                      >
                        {locating
                          ? t.detecting
                    : hasLocation
                      ? t.refresh
                      : t.detect}
                      </Text>
                    </Pressable>
                  </SettingsPreferenceRow>

                  {/* -----------------------------------------------
                      LOCALISATION DÉTECTÉE
                  ----------------------------------------------- */}

                  {hasLocation ? (
                    <View
                      style={[
                        styles.locationDetails,
                        theme ===
                          "dark" &&
                          styles.locationDetailsDark,
                      ]}
                    >
                      <Text
                        style={[
                          styles.locationLabel,
                          theme ===
                            "dark" &&
                            styles.textMutedDark,
                        ]}
                      >
                          {t.detectedLocation}
                      </Text>

                      <Text
                        style={[
                          styles.locationValue,
                          theme ===
                            "dark" &&
                            styles.textDark,
                        ]}
                      >
                        {countryName}

                        {cityName
                          ? ` · ${cityName}`
                          : ""}
                      </Text>

                      {subdivisionName ? (
                        <Text
                          style={[
                            styles.locationSubdivision,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                        >
                          {
                            subdivisionName
                          }
                        </Text>
                      ) : null}

                      {countryCode ? (
                        <Text
                          style={[
                            styles.locationCode,
                            theme ===
                              "dark" &&
                              styles.textMutedDark,
                          ]}
                        >
                          {countryCode.toUpperCase()}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {/* -----------------------------------------------
                      THÈME
                  ----------------------------------------------- */}

                  <SettingsPreferenceRow
                    iconName="moon-outline"
                    title={t.darkMode}
                    description={t.darkModeDescription}
                    theme={theme}
                  >
                    <View
                      style={
                        styles.preferenceAction
                      }
                    >
                      {savingTheme ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            theme ===
                            "dark"
                              ? "#ffffff"
                              : "#71717a"
                          }
                        />
                      ) : null}

                      <Switch
                        value={
                          theme ===
                          "dark"
                        }
                        onValueChange={(
                          checked,
                        ) =>
                          void changeTheme(
                            checked
                              ? "dark"
                              : "light",
                          )
                        }
                        disabled={
                          savingTheme
                        }
                        trackColor={{
                          false:
                            "#d4d4d8",
                          true:
                            "#18181b",
                        }}
                        thumbColor={
                          theme ===
                          "dark"
                            ? "#ffffff"
                            : "#ffffff"
                        }
                        ios_backgroundColor="#d4d4d8"
                        accessibilityLabel={t.enableDarkMode}
                      />
                    </View>
                  </SettingsPreferenceRow>
                </SettingsSection>

                {/* =================================================
                    NOTIFICATIONS
                ================================================= */}

                <SettingsSection
                  iconName="notifications-outline"
                  title={t.notifications}
                  description={t.notificationsSectionDescription}
                  theme={theme}
                >
                  <SettingsPreferenceRow
                    iconName="notifications-outline"
                    title={t.notifications}
                    description={t.notificationsDescription}
                    theme={theme}
                  >
                    <View
                      style={
                        styles.preferenceAction
                      }
                    >
                      {savingNotifications ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            theme ===
                            "dark"
                              ? "#ffffff"
                              : "#71717a"
                          }
                        />
                      ) : null}

                      <Switch
                        value={
                          notifications
                        }
                        onValueChange={(
                          value,
                        ) =>
                          void changeNotifications(
                            value,
                          )
                        }
                        disabled={
                          savingNotifications
                        }
                        trackColor={{
                          false:
                            "#d4d4d8",
                          true:
                            "#18181b",
                        }}
                        thumbColor="#ffffff"
                        ios_backgroundColor="#d4d4d8"
                        accessibilityLabel={t.enableNotifications}
                      />
                    </View>
                  </SettingsPreferenceRow>
                </SettingsSection>

                {/* =================================================
                    ABONNEMENT
                ================================================= */}

                <SettingsSection
                  iconName="sparkles-outline"
                  title={t.subscription}
                  description={t.subscriptionDescription}
                  theme={theme}
                >
                  <SettingsNavigationRow
                    iconName="sparkles-outline"
                    title={t.currentPack}
                    description={t.currentPackDescription}
                    actionText={t.manage}
                    theme={theme}
                    onPress={() =>
                      router.push(
                        "/packs" as any,
                      )
                    }
                  />

                  <SettingsNavigationRow
                    iconName="sparkles-outline"
                    title={t.credits}
                    description={t.creditsDescription}
                    actionText={t.view}
                    theme={theme}
                    onPress={() =>
                      router.push(
                        "/credits" as any,
                      )
                    }
                  />
                </SettingsSection>

                {/* =================================================
                    LOGOUT
                ================================================= */}

                <View
                  style={
                    styles.logoutSection
                  }
                >
                  <Pressable
                    onPress={
                      handleLogout
                    }
                    disabled={
                      loggingOut
                    }
                    style={({ pressed }) => [
                      styles.logoutButton,
                      pressed &&
                        styles.logoutPressed,
                      loggingOut &&
                        styles.disabled,
                    ]}
                  >
                    <View
                      style={
                        styles.logoutIconBox
                      }
                    >
                      {loggingOut ? (
                        <ActivityIndicator
                          size="small"
                          color="#dc2626"
                        />
                      ) : (
                        <Ionicons
                          name="log-out-outline"
                          size={18}
                          color="#dc2626"
                        />
                      )}
                    </View>

                    <View
                      style={
                        styles.logoutTextArea
                      }
                    >
                      <Text
                        style={
                          styles.logoutTitle
                        }
                      >
                        {loggingOut
                          ? t.loggingOut
                    : t.logout}
                      </Text>

                      <Text
                        style={
                          styles.logoutDescription
                        }
                      >
                    {t.logoutDescription}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </>
            ) : null}

            {/* =================================================
                VERSION
            ================================================= */}

            <Text
              style={[
                styles.versionText,
                theme ===
                  "dark" &&
                  styles.textMutedDark,
              ]}
            >
              Oria · Version 1.0
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* ========================================================
          LANGUAGE MODAL
      ======================================================== */}

      <Modal
        visible={
          languageModalVisible
        }
        transparent
        animationType="slide"
        onRequestClose={() =>
          setLanguageModalVisible(
            false,
          )
        }
      >
        <View
          style={
            styles.modalOverlay
          }
        >
          <Pressable
            style={
              styles.modalBackdrop
            }
            onPress={() =>
              setLanguageModalVisible(
                false,
              )
            }
          />

          <View
            style={[
              styles.languageModal,
              theme ===
                "dark" &&
                styles.languageModalDark,
            ]}
          >
            <View
              style={
                styles.modalHandle
              }
            />

            <View
              style={
                styles.modalHeader
              }
            >
              <View
                style={
                  styles.modalHeaderTextArea
                }
              >
                <Text
                  style={[
                    styles.modalEyebrow,
                    theme ===
                      "dark" &&
                      styles.textMutedDark,
                  ]}
                >
                  {t.preferences}
                </Text>

                <Text
                  style={[
                    styles.modalTitle,
                    theme ===
                      "dark" &&
                      styles.textDark,
                  ]}
                >
                  {t.chooseLanguage}
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setLanguageModalVisible(
                    false,
                  )
                }
                style={
                  styles.modalClose
                }
                accessibilityRole="button"
                accessibilityLabel={t.close}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={
                    theme ===
                    "dark"
                      ? "#e4e4e7"
                      : "#52525b"
                  }
                />
              </Pressable>
            </View>

            <View
              style={
                styles.languageOptions
              }
            >
              <LanguageOption
                title={t.french}
                code="FR"
                selected={
                  language ===
                  "fr"
                }
                theme={
                  theme
                }
                onPress={() =>
                  void changeLanguage(
                    "fr",
                  )
                }
              />

              <LanguageOption
                title={t.english}
                code="EN"
                selected={
                  language ===
                  "en"
                }
                theme={
                  theme
                }
                onPress={() =>
                  void changeLanguage(
                    "en",
                  )
                }
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * ============================================================
 * MESSAGE BANNER
 * ============================================================
 */

function MessageBanner({
  type,
  message,
  onClose,
  closeLabel,
}: {
  type:
    | "error"
    | "success";

  message: string;

  onClose: () => void;

  closeLabel: string;
}) {
  const isError =
    type === "error";

  return (
    <View
      style={[
        styles.messageBanner,
        isError
          ? styles.errorBanner
          : styles.successBanner,
      ]}
    >
      <Ionicons
        name={
          isError
            ? "close-circle-outline"
            : "checkmark-circle-outline"
        }
        size={19}
        color={
          isError
            ? "#b91c1c"
            : "#15803d"
        }
      />

      <Text
        style={[
          styles.messageText,
          isError
            ? styles.errorText
            : styles.successText,
        ]}
      >
        {message}
      </Text>

      <Pressable
        onPress={onClose}
        style={
          styles.messageClose
        }
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      >
        <Ionicons
          name="close"
          size={16}
          color={
            isError
              ? "#b91c1c"
              : "#15803d"
          }
        />
      </Pressable>
    </View>
  );
}

/**
 * ============================================================
 * SETTINGS SECTION
 * ============================================================
 */

function SettingsSection({
  iconName,
  title,
  description,
  theme,
  children,
}: {
  iconName:
    | keyof typeof Ionicons.glyphMap;

  title: string;

  description: string;

  theme: Theme;

  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.settingsSection,
        theme ===
          "dark" &&
          styles.settingsSectionDark,
      ]}
    >
      <View
        style={[
          styles.sectionHeader,
          theme ===
            "dark" &&
            styles.sectionHeaderDark,
        ]}
      >
        <IconBox
          iconName={
            iconName
          }
          theme={theme}
        />

        <View
          style={
            styles.sectionHeaderText
          }
        >
          <Text
            style={[
              styles.sectionTitle,
              theme ===
                "dark" &&
                styles.textDark,
            ]}
          >
            {title}
          </Text>

          <Text
            style={[
              styles.sectionDescription,
              theme ===
                "dark" &&
                styles.textMutedDark,
            ]}
          >
            {description}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.sectionBody,
          theme ===
            "dark" &&
            styles.sectionBodyDark,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * ============================================================
 * SETTINGS ACTION ROW
 * ============================================================
 */

function SettingsActionRow({
  iconName,
  title,
  description,
  theme,
  expanded,
  onPress,
}: {
  iconName:
    | keyof typeof Ionicons.glyphMap;

  title: string;

  description: string;

  theme: Theme;

  expanded: boolean;

  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsActionRow,
        pressed &&
          styles.rowPressed,
      ]}
    >
      <IconBox
        iconName={
          iconName
        }
        theme={theme}
      />

      <View
        style={
          styles.rowTextArea
        }
      >
        <Text
          style={[
            styles.rowTitle,
            theme ===
              "dark" &&
              styles.textDark,
          ]}
        >
          {title}
        </Text>

        <Text
          style={[
            styles.rowDescription,
            theme ===
              "dark" &&
              styles.textMutedDark,
          ]}
          numberOfLines={2}
        >
          {description}
        </Text>
      </View>

      <Ionicons
        name={
          expanded
            ? "chevron-down"
            : "chevron-forward"
        }
        size={17}
        color={
          theme ===
          "dark"
            ? "#a1a1aa"
            : "#71717a"
        }
      />
    </Pressable>
  );
}

/**
 * ============================================================
 * SETTINGS PREFERENCE ROW
 * ============================================================
 */

function SettingsPreferenceRow({
  iconName,
  title,
  description,
  theme,
  children,
}: {
  iconName:
    | keyof typeof Ionicons.glyphMap;

  title: string;

  description: string;

  theme: Theme;

  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.settingsPreferenceRow,
        theme ===
          "dark" &&
          styles.settingsPreferenceRowDark,
      ]}
    >
      <IconBox
        iconName={
          iconName
        }
        theme={theme}
      />

      <View
        style={
          styles.rowTextArea
        }
      >
        <Text
          style={[
            styles.rowTitle,
            theme ===
              "dark" &&
              styles.textDark,
          ]}
        >
          {title}
        </Text>

        <Text
          style={[
            styles.rowDescription,
            theme ===
              "dark" &&
              styles.textMutedDark,
          ]}
        >
          {description}
        </Text>
      </View>

      <View
        style={
          styles.rowActionArea
        }
      >
        {children}
      </View>
    </View>
  );
}

/**
 * ============================================================
 * SETTINGS NAVIGATION ROW
 * ============================================================
 */

function SettingsNavigationRow({
  iconName,
  title,
  description,
  actionText,
  theme,
  onPress,
}: {
  iconName:
    | keyof typeof Ionicons.glyphMap;

  title: string;

  description: string;

  actionText: string;

  theme: Theme;

  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsNavigationRow,
        theme ===
          "dark" &&
          styles.settingsNavigationRowDark,
        pressed &&
          styles.rowPressed,
      ]}
    >
      <IconBox
        iconName={
          iconName
        }
        theme={theme}
      />

      <View
        style={
          styles.rowTextArea
        }
      >
        <Text
          style={[
            styles.rowTitle,
            theme ===
              "dark" &&
              styles.textDark,
          ]}
        >
          {title}
        </Text>

        <Text
          style={[
            styles.rowDescription,
            theme ===
              "dark" &&
              styles.textMutedDark,
          ]}
        >
          {description}
        </Text>
      </View>

      <View
        style={
          styles.navigationAction
        }
      >
        <Text
          style={[
            styles.navigationActionText,
            theme ===
              "dark" &&
              styles.textDark,
          ]}
        >
          {actionText}
        </Text>

        <Ionicons
          name="chevron-forward"
          size={15}
          color={
            theme ===
            "dark"
              ? "#d4d4d8"
              : "#52525b"
          }
        />
      </View>
    </Pressable>
  );
}

/**
 * ============================================================
 * ICON BOX
 * ============================================================
 */

function IconBox({
  iconName,
  theme,
}: {
  iconName:
    | keyof typeof Ionicons.glyphMap;

  theme: Theme;

}) {
  return (
    <View
      style={[
        styles.iconBox,
        theme ===
          "dark" &&
          styles.iconBoxDark,
      ]}
    >
      <Ionicons
        name={iconName}
        size={17}
        color={
          theme ===
          "dark"
            ? "#d4d4d8"
            : "#71717a"
        }
      />
    </View>
  );
}

/**
 * ============================================================
 * INPUT FIELD
 * ============================================================
 */

function InputField({
  label,
  value,
  onChangeText,
  theme,
  keyboardType,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  autoCorrect,
  maxLength,
}: {
  label: string;

  value: string;

  onChangeText: (
    value: string,
  ) => void;

  theme: Theme;

  keyboardType?: React.ComponentProps<
    typeof TextInput
  >["keyboardType"];

  placeholder?: string;

  secureTextEntry?: boolean;

  autoCapitalize?: React.ComponentProps<
    typeof TextInput
  >["autoCapitalize"];

  autoCorrect?: boolean;

  maxLength?: number;
}) {
  return (
    <View
      style={
        styles.inputGroup
      }
    >
      <Text
        style={[
          styles.inputLabel,
          theme ===
            "dark" &&
            styles.textMutedDark,
        ]}
      >
        {label}
      </Text>

      <TextInput
        value={value}
        onChangeText={
          onChangeText
        }
        keyboardType={
          keyboardType
        }
        placeholder={
          placeholder
        }
        placeholderTextColor={
          theme ===
          "dark"
            ? "#71717a"
            : "#a1a1aa"
        }
        secureTextEntry={
          secureTextEntry
        }
        autoCapitalize={
          autoCapitalize
        }
        autoCorrect={
          autoCorrect
        }
        maxLength={
          maxLength
        }
        style={[
          styles.textInput,
          theme ===
            "dark" &&
            styles.textInputDark,
        ]}
      />
    </View>
  );
}

/**
 * ============================================================
 * INFO FIELD
 * ============================================================
 */

function InfoField({
  label,
  value,
  theme,
}: {
  label: string;

  value: string;

  theme: Theme;
}) {
  return (
    <View
      style={
        styles.inputGroup
      }
    >
      <Text
        style={[
          styles.inputLabel,
          theme ===
            "dark" &&
            styles.textMutedDark,
        ]}
      >
        {label}
      </Text>

      <View
        style={[
          styles.infoField,
          theme ===
            "dark" &&
            styles.infoFieldDark,
        ]}
      >
        <Text
          style={[
            styles.infoFieldText,
            theme ===
              "dark" &&
              styles.textDark,
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

/**
 * ============================================================
 * PRIMARY BUTTON
 * ============================================================
 */

function PrimaryActionButton({
  title,
  loading,
  disabled,
  onPress,
  theme,
  language,
}: {
  title: string;

  loading: boolean;

  disabled: boolean;

  onPress: () => void;

  theme: Theme;

  language: Language;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryAction,
        theme ===
          "dark" &&
          styles.primaryActionDark,
        pressed &&
          styles.primaryPressed,
        disabled &&
          styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color="#ffffff"
        />
      ) : null}

      <Text
        style={
          styles.primaryActionText
        }
      >
        {loading
          ? SETTINGS_TEXT[language].saving
          : title}
      </Text>
    </Pressable>
  );
}

/**
 * ============================================================
 * SECONDARY BUTTON
 * ============================================================
 */

function SecondaryActionButton({
  title,
  loading,
  disabled,
  onPress,
  theme,
  language,
}: {
  title: string;

  loading: boolean;

  disabled: boolean;

  onPress: () => void;

  theme: Theme;

  language: Language;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondaryAction,
        theme ===
          "dark" &&
          styles.secondaryActionDark,
        pressed &&
          styles.primaryPressed,
        disabled &&
          styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            theme ===
            "dark"
              ? "#ffffff"
              : "#52525b"
          }
        />
      ) : null}

      <Text
        style={[
          styles.secondaryActionText,
          theme ===
            "dark" &&
            styles.textDark,
        ]}
      >
        {loading
          ? SETTINGS_TEXT[language].sending
          : title}
      </Text>
    </Pressable>
  );
}

/**
 * ============================================================
 * LANGUAGE OPTION
 * ============================================================
 */

function LanguageOption({
  title,
  code,
  selected,
  theme,
  onPress,
}: {
  title: string;

  code: string;

  selected: boolean;

  theme: Theme;

  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.languageOption,
        theme ===
          "dark" &&
          styles.languageOptionDark,
        selected &&
          styles.languageOptionSelected,
        pressed &&
          styles.rowPressed,
      ]}
    >
      <View
        style={
          styles.languageCode
        }
      >
        <Text
          style={
            styles.languageCodeText
          }
        >
          {code}
        </Text>
      </View>

      <Text
        style={[
          styles.languageTitle,
          theme ===
            "dark" &&
            styles.textDark,
        ]}
      >
        {title}
      </Text>

      {selected ? (
        <Ionicons
          name="checkmark-circle"
          size={20}
          color={
            theme ===
            "dark"
              ? "#ffffff"
              : "#18181b"
          }
        />
      ) : (
        <Ionicons
          name="ellipse-outline"
          size={20}
          color={
            theme ===
            "dark"
              ? "#71717a"
              : "#d4d4d8"
          }
        />
      )}
    </Pressable>
  );
}

/**
 * ============================================================
 * STYLES
 * ============================================================
 *
 * Les styles sont explicitement séparés afin de conserver une
 * architecture facilement modifiable et proche de la page Web.
 */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  safeAreaDark: {
    backgroundColor: "#09090b",
  },

  keyboardContainer: {
    flex: 1,
  },

  page: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  pageDark: {
    backgroundColor: "#09090b",
  },

  /* ==========================================================
     HEADER
  ========================================================== */

  header: {
    minHeight: 64,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerDark: {
    borderBottomColor: "#27272a",
  },

  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  headerBackButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  brandText: {
    color: "#18181b",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  textDark: {
    color: "#f4f4f5",
  },

  textMutedDark: {
    color: "#a1a1aa",
  },

  headerCreditsButton: {
    minHeight: 40,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    backgroundColor: "#f4f4f5",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  headerCreditsText: {
    color: "#52525b",
    fontSize: 13,
    fontWeight: "500",
  },

  /* ==========================================================
     CONTENT
  ========================================================== */

  scrollView: {
    flex: 1,
  },

  content: {
    width: "100%",
    maxWidth: 780,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 30,
    paddingBottom: 60,
  },

  titleArea: {
    marginBottom: 26,
  },

  eyebrow: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "500",
  },

  pageTitle: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.7,
  },

  pageDescription: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  /* ==========================================================
     LOADING
  ========================================================== */

  loadingCard: {
    minHeight: 92,
    marginBottom: 17,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  cardDark: {
    borderColor: "#27272a",
    backgroundColor: "#18181b",
  },

  loadingText: {
    color: "#71717a",
    fontSize: 12,
  },

  /* ==========================================================
     MESSAGES
  ========================================================== */

  messageBanner: {
    marginBottom: 17,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },

  errorBanner: {
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },

  successBanner: {
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
  },

  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
  },

  errorText: {
    color: "#b91c1c",
  },

  successText: {
    color: "#15803d",
  },

  messageClose: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ==========================================================
     SETTINGS SECTION
  ========================================================== */

  settingsSection: {
    marginTop: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },

  settingsSectionDark: {
    borderColor: "#27272a",
    backgroundColor: "#18181b",
  },

  sectionHeader: {
    minHeight: 76,
    paddingHorizontal: 17,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  sectionHeaderDark: {
    borderBottomColor: "#27272a",
    backgroundColor: "#18181b",
  },

  sectionHeaderText: {
    flex: 1,
  },

  sectionTitle: {
    color: "#18181b",
    fontSize: 14,
    fontWeight: "700",
  },

  sectionDescription: {
    marginTop: 3,
    color: "#71717a",
    fontSize: 11,
    lineHeight: 17,
  },

  sectionBody: {
    backgroundColor: "#ffffff",
  },

  sectionBodyDark: {
    backgroundColor: "#09090b",
  },

  /* ==========================================================
     ICON BOX
  ========================================================== */

  iconBox: {
    width: 37,
    height: 37,
    borderRadius: 11,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  iconBoxDark: {
    backgroundColor: "#27272a",
  },

  /* ==========================================================
     ROWS
  ========================================================== */

  settingsActionRow: {
    minHeight: 69,
    paddingHorizontal: 17,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  settingsPreferenceRow: {
    minHeight: 76,
    paddingHorizontal: 17,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  settingsPreferenceRowDark: {
    borderBottomColor: "#27272a",
  },

  settingsNavigationRow: {
    minHeight: 76,
    paddingHorizontal: 17,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  settingsNavigationRowDark: {
    borderBottomColor: "#27272a",
  },

  rowTextArea: {
    flex: 1,
    minWidth: 0,
  },

  rowTitle: {
    color: "#27272a",
    fontSize: 13,
    fontWeight: "600",
  },

  rowDescription: {
    marginTop: 3,
    color: "#71717a",
    fontSize: 11,
    lineHeight: 17,
  },

  rowActionArea: {
    flexShrink: 0,
    alignItems: "flex-end",
  },

  rowPressed: {
    backgroundColor: "#f4f4f5",
  },

  /* ==========================================================
     EXPANDED
  ========================================================== */

  expandedArea: {
    padding: 17,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    backgroundColor: "#ffffff",
  },

  expandedAreaDark: {
    borderBottomColor: "#27272a",
    backgroundColor: "#09090b",
  },

  /* ==========================================================
     INPUTS
  ========================================================== */

  inputGroup: {
    marginBottom: 15,
  },

  inputLabel: {
    marginBottom: 7,
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
  },

  textInput: {
    minHeight: 45,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#fafafa",
    color: "#18181b",
    fontSize: 13,
  },

  textInputDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
    color: "#f4f4f5",
  },

  infoField: {
    minHeight: 45,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    justifyContent: "center",
  },

  infoFieldDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#27272a",
  },

  infoFieldText: {
    color: "#3f3f46",
    fontSize: 12,
  },

  helperText: {
    marginTop: -2,
    marginBottom: 2,
    color: "#71717a",
    fontSize: 10,
    lineHeight: 16,
  },

  /* ==========================================================
     BUTTONS
  ========================================================== */

  primaryAction: {
    minHeight: 45,
    marginTop: 5,
    borderRadius: 12,
    backgroundColor: "#111111",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  primaryActionDark: {
    backgroundColor: "#f4f4f5",
  },

  primaryActionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  primaryPressed: {
    opacity: 0.78,
  },

  secondaryAction: {
    minHeight: 43,
    marginTop: 13,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 11,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  secondaryActionDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
  },

  secondaryActionText: {
    color: "#3f3f46",
    fontSize: 12,
    fontWeight: "600",
  },

  disabled: {
    opacity: 0.48,
  },

  /* ==========================================================
     SECURITY
  ========================================================== */

  securityCard: {
    marginBottom: 13,
    padding: 15,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 16,
    backgroundColor: "#fafafa",
  },

  innerDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
  },

  securityTitle: {
    color: "#27272a",
    fontSize: 13,
    fontWeight: "700",
  },

  securityValue: {
    marginTop: 5,
    color: "#71717a",
    fontSize: 12,
  },

  securityDescription: {
    marginTop: 5,
    color: "#71717a",
    fontSize: 11,
    lineHeight: 18,
  },

  subDivider: {
    height: 1,
    marginTop: 17,
    marginBottom: 13,
    backgroundColor: "#e4e4e7",
  },

  subDividerDark: {
    backgroundColor: "#3f3f46",
  },

  resetDescription: {
    color: "#71717a",
    fontSize: 10,
    lineHeight: 16,
  },

  /* ==========================================================
     PREFERENCE ACTIONS
  ========================================================== */

  preferenceAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  selectButton: {
    minHeight: 39,
    minWidth: 118,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
  },

  selectButtonDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
  },

  selectButtonText: {
    color: "#27272a",
    fontSize: 12,
    fontWeight: "500",
  },

  secondarySmallButton: {
    minHeight: 39,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  secondarySmallButtonDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
  },

  secondarySmallButtonText: {
    color: "#3f3f46",
    fontSize: 12,
    fontWeight: "500",
  },

  /* ==========================================================
     LOCATION
  ========================================================== */

  locationDetails: {
    paddingHorizontal: 17,
    paddingTop: 13,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    backgroundColor: "#fafafa",
  },

  locationDetailsDark: {
    borderBottomColor: "#27272a",
    backgroundColor: "#18181b",
  },

  locationLabel: {
    color: "#71717a",
    fontSize: 10,
  },

  locationValue: {
    marginTop: 4,
    color: "#27272a",
    fontSize: 13,
    fontWeight: "600",
  },

  locationSubdivision: {
    marginTop: 3,
    color: "#71717a",
    fontSize: 11,
  },

  locationCode: {
    marginTop: 5,
    color: "#71717a",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
  },

  /* ==========================================================
     NAVIGATION
  ========================================================== */

  navigationAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  navigationActionText: {
    color: "#27272a",
    fontSize: 12,
    fontWeight: "600",
  },

  /* ==========================================================
     LOGOUT
  ========================================================== */

  logoutSection: {
    marginTop: 28,
  },

  logoutButton: {
    minHeight: 72,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#fee2e2",
    borderRadius: 18,
    backgroundColor: "#fef2f2",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  logoutPressed: {
    backgroundColor: "#fee2e2",
  },

  logoutIconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },

  logoutTextArea: {
    flex: 1,
  },

  logoutTitle: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "600",
  },

  logoutDescription: {
    marginTop: 3,
    color: "#ef4444",
    fontSize: 10,
  },

  /* ==========================================================
     VERSION
  ========================================================== */

  versionText: {
    marginTop: 25,
    color: "#a1a1aa",
    fontSize: 10,
    textAlign: "center",
  },

  /* ==========================================================
     LANGUAGE MODAL
  ========================================================== */

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },

  modalBackdrop: {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "rgba(0, 0, 0, 0.50)",
  },

  languageModal: {
    maxHeight: "58%",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: "#ffffff",
  },

  languageModalDark: {
    backgroundColor: "#18181b",
  },

  modalHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    marginBottom: 18,
    borderRadius: 99,
    backgroundColor: "#d4d4d8",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },

  modalHeaderTextArea: {
    flex: 1,
  },

  modalEyebrow: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
  },

  modalTitle: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "700",
    letterSpacing: -0.3,
  },

  modalClose: {
    width: 39,
    height: 39,
    borderRadius: 11,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },

  languageOptions: {
    marginTop: 18,
    gap: 9,
  },

  languageOption: {
    minHeight: 62,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 15,
    backgroundColor: "#fafafa",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },

  languageOptionDark: {
    borderColor: "#3f3f46",
    backgroundColor: "#09090b",
  },

  languageOptionSelected: {
    borderColor: "#a1a1aa",
  },

  languageCode: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#e4e4e7",
    alignItems: "center",
    justifyContent: "center",
  },

  languageCodeText: {
    color: "#52525b",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  languageTitle: {
    flex: 1,
    color: "#27272a",
    fontSize: 13,
    fontWeight: "600",
  },

  pressed: {
    opacity: 0.72,
  },
});