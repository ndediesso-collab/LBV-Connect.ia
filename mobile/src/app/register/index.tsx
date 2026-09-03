import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase/client";

/**
 * Configuration d'un pays et de son indicatif téléphonique.
 */
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
  {
    iso2: "BJ",
    name: "Bénin",
    callingCode: "+229",
  },
  {
    iso2: "BF",
    name: "Burkina Faso",
    callingCode: "+226",
  },
  {
    iso2: "BI",
    name: "Burundi",
    callingCode: "+257",
  },
  {
    iso2: "CM",
    name: "Cameroun",
    callingCode: "+237",
  },
  {
    iso2: "CF",
    name: "République centrafricaine",
    callingCode: "+236",
  },
  {
    iso2: "KM",
    name: "Comores",
    callingCode: "+269",
  },
  {
    iso2: "CG",
    name: "Congo",
    callingCode: "+242",
  },
  {
    iso2: "CI",
    name: "Côte d'Ivoire",
    callingCode: "+225",
  },
  {
    iso2: "DJ",
    name: "Djibouti",
    callingCode: "+253",
  },
  {
    iso2: "GA",
    name: "Gabon",
    callingCode: "+241",
  },
  {
    iso2: "GN",
    name: "Guinée",
    callingCode: "+224",
  },
  {
    iso2: "GQ",
    name: "Guinée équatoriale",
    callingCode: "+240",
  },
  {
    iso2: "MG",
    name: "Madagascar",
    callingCode: "+261",
  },
  {
    iso2: "ML",
    name: "Mali",
    callingCode: "+223",
  },
  {
    iso2: "NE",
    name: "Niger",
    callingCode: "+227",
  },
  {
    iso2: "CD",
    name: "République démocratique du Congo",
    callingCode: "+243",
  },
  {
    iso2: "RW",
    name: "Rwanda",
    callingCode: "+250",
  },
  {
    iso2: "SN",
    name: "Sénégal",
    callingCode: "+221",
  },
  {
    iso2: "TG",
    name: "Togo",
    callingCode: "+228",
  },
];

const DEFAULT_COUNTRY_ISO2 = "GA";

/**
 * Récupère la configuration d'un pays.
 *
 * Le comportement est conservé par rapport à la version Web :
 * l'ISO2 est normalisé puis recherché dans le référentiel.
 * Si le pays n'existe pas, le Gabon est utilisé comme valeur
 * de secours.
 */
function getCountryConfig(
  iso2: string,
): CountryPhoneConfig {
  const normalizedIso2 = iso2
    .trim()
    .toUpperCase();

  const country =
    COUNTRY_PHONE_CONFIGS.find(
      (item) =>
        item.iso2 === normalizedIso2,
    );

  return (
    country ??
    COUNTRY_PHONE_CONFIGS.find(
      (item) =>
        item.iso2 === DEFAULT_COUNTRY_ISO2,
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
  let digits = value.replace(
    /\D/g,
    "",
  );

  if (!digits) {
    return "";
  }

  const callingDigits =
    country.callingCode.replace(
      /\D/g,
      "",
    );

  /*
   * Cas : +24161234567
   */
  if (
    callingDigits &&
    digits.startsWith(callingDigits) &&
    digits.length >
      callingDigits.length
  ) {
    digits = digits.slice(
      callingDigits.length,
    );
  }

  /*
   * Cas : 0024161234567
   */
  else if (
    digits.startsWith("00")
  ) {
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
 * dans le profil utilisateur puis synchronisée
 * dans auth.users.phone.
 */
function buildInternationalPhone(
  phoneNumber: string,
  country: CountryPhoneConfig,
): string {
  let national =
    normalizePhoneNumber(
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

/**
 * Page d'inscription mobile.
 *
 * Cette version est une transposition React Native/Expo
 * de la page Web originale.
 *
 * La logique métier n'est volontairement pas compactée :
 * les validations, la création Supabase, la synchronisation
 * backend du téléphone et la vérification de la réponse
 * restent séparées et explicites.
 */
export default function RegisterPage() {
  const [
    firstName,
    setFirstName,
  ] = useState("");

  const [
    lastName,
    setLastName,
  ] = useState("");

  const [
    selectedCountryIso2,
    setSelectedCountryIso2,
  ] = useState(
    DEFAULT_COUNTRY_ISO2,
  );

  const [
    phone,
    setPhone,
  ] = useState("");

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    termsAccepted,
    setTermsAccepted,
  ] = useState(false);

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [
    showCountryPicker,
    setShowCountryPicker,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  /**
   * Configuration actuellement sélectionnée.
   */
  const country =
    getCountryConfig(
      selectedCountryIso2,
    );

  /**
   * Gestion de la création du compte.
   *
   * Les étapes restent volontairement explicites :
   *
   * 1. Nettoyage des messages.
   * 2. Lecture et normalisation des champs.
   * 3. Validation du téléphone.
   * 4. Validation du mot de passe.
   * 5. Création du compte Supabase.
   * 6. Vérification de la session.
   * 7. Synchronisation du téléphone via le backend.
   * 8. Vérification du numéro renvoyé par le backend.
   * 9. Redirection vers /chat.
   */
  async function handleSubmit() {
    setError("");
    setMessage("");

    const normalizedFirstName =
      firstName.trim();

    const normalizedLastName =
      lastName.trim();

    const countryIso2 =
      selectedCountryIso2
        .trim()
        .toUpperCase();

    const selectedCountry =
      getCountryConfig(
        countryIso2,
      );

    const phoneRaw =
      phone.trim();

    const phoneNumber =
      normalizePhoneNumber(
        phoneRaw,
        selectedCountry,
      );

    const phoneInternational =
      buildInternationalPhone(
        phoneRaw,
        selectedCountry,
      );

    const normalizedEmail =
      email
        .trim()
        .toLowerCase();

    const passwordValue =
      password;

    const confirmPasswordValue =
      confirmPassword;

    /*
     * Validation des champs obligatoires.
     *
     * Les champs prénom, nom et e-mail sont également
     * requis au niveau de l'interface native.
     */
    if (!normalizedFirstName) {
      setError(
        "Veuillez renseigner votre prénom.",
      );

      return;
    }

    if (!normalizedLastName) {
      setError(
        "Veuillez renseigner votre nom.",
      );

      return;
    }

    if (!normalizedEmail) {
      setError(
        "Veuillez renseigner votre adresse e-mail.",
      );

      return;
    }

    /*
     * Validation téléphone
     */
    if (!phoneNumber) {
      setError(
        "Veuillez renseigner votre numéro de téléphone.",
      );

      return;
    }

    if (
      phoneNumber.length < 6 ||
      !phoneInternational
    ) {
      setError(
        "Veuillez renseigner un numéro de téléphone valide.",
      );

      return;
    }

    /*
     * Validation mot de passe
     */
    if (
      passwordValue !==
      confirmPasswordValue
    ) {
      setError(
        "Les mots de passe ne correspondent pas.",
      );

      return;
    }

    if (
      passwordValue.length < 8
    ) {
      setError(
        "Le mot de passe doit contenir au moins 8 caractères.",
      );

      return;
    }

    /*
     * Validation des conditions d'utilisation.
     *
     * Sur le Web, le navigateur empêchait la soumission
     * grâce à required sur la checkbox.
     * En React Native, la validation est donc reproduite
     * explicitement ici.
     */
    if (!termsAccepted) {
      setError(
        "Veuillez accepter les conditions d'utilisation et la politique de confidentialité.",
      );

      return;
    }

    setLoading(true);

    try {
      /*
       * Création du compte Supabase.
       *
       * Le téléphone est conservé dans user_metadata
       * comme donnée de profil ET synchronisé immédiatement
       * dans auth.users.phone par le backend sécurisé.
       *
       * IMPORTANT :
       * La confirmation e-mail doit être désactivée dans
       * Supabase pour que signUp() retourne immédiatement
       * une session.
       */
      const {
        data,
        error: signUpError,
      } =
        await supabase.auth.signUp({
          email:
            normalizedEmail,
          password:
            passwordValue,

          options: {
            data: {
              first_name:
                normalizedFirstName,

              last_name:
                normalizedLastName,

              phone:
                phoneInternational,

              country_iso2:
                selectedCountry.iso2,
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

      if (!data.user) {
        setError(
          "Le compte n'a pas pu être créé.",
        );

        return;
      }

      /*
       * Le backend écrit le numéro directement dans
       * auth.users.phone avec la Service Role Key.
       *
       * Il faut une session immédiate :
       * si data.session est null, la confirmation e-mail
       * est encore active côté Supabase.
       */
      if (!data.session) {
        console.error(
          "REGISTER SESSION ABSENTE : désactivez la confirmation e-mail dans Supabase.",
        );

        setError(
          "Le compte a été créé, mais aucune session n'est disponible. Désactivez la confirmation e-mail dans Supabase pour permettre l'enregistrement automatique du numéro.",
        );

        return;
      }

      /*
       * Dans l'application mobile, l'URL backend est fournie
       * par EXPO_PUBLIC_API_URL.
       *
       * Une valeur de secours est conservée pour éviter qu'une
       * configuration absente bloque complètement l'inscription
       * lorsque l'API officielle du projet est utilisée.
       */
      const apiBaseUrl =
        process.env
          .EXPO_PUBLIC_API_URL ||
        process.env
          .EXPO_PUBLIC_BACKEND_URL ||
        "https://lbv-connect-api.onrender.com";

      if (!apiBaseUrl) {
        console.error(
          "EXPO_PUBLIC_API_URL / EXPO_PUBLIC_BACKEND_URL non configurée.",
        );

        setError(
          "Le compte a été créé, mais la synchronisation du numéro de téléphone n'est pas configurée.",
        );

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
          `${apiBaseUrl.replace(
            /\/$/,
            "",
          )}/profile/phone`,
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${data.session.access_token}`,

              "user-id":
                data.user.id,
            },

            body: JSON.stringify({
              phone:
                phoneInternational,

              country_iso2:
                selectedCountry.iso2,
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
        /*
         * Réponse non JSON :
         * on utilisera le message générique.
         */
      }

      if (!phoneResponse.ok) {
        console.error(
          "PHONE PROFILE SYNC ERROR:",
          phoneResult,
        );

        setError(
          phoneResult.detail ||
            "Le compte a été créé, mais le numéro de téléphone n'a pas pu être enregistré.",
        );

        return;
      }

      /*
       * Vérification de la réponse du backend.
       *
       * Le backend doit confirmer le numéro international
       * attendu.
       */
      if (
        phoneResult.phone &&
        phoneResult.phone.replace(
          /\D/g,
          "",
        ) !==
          phoneInternational.replace(
            /\D/g,
            "",
          )
      ) {
        console.error(
          "PHONE PROFILE SYNC MISMATCH:",
          phoneResult,
        );

        setError(
          "Le numéro enregistré ne correspond pas au numéro fourni lors de l'inscription.",
        );

        return;
      }

      setMessage(
        "Compte créé avec succès. Votre numéro de téléphone a été enregistré.",
      );

      /*
       * La session Supabase reste disponible :
       * l'utilisateur peut accéder directement à son espace.
       *
       * Dans Expo Router, router.replace() remplace la page
       * d'inscription dans l'historique de navigation.
       */
      router.replace(
        "/chat" as any,
      );

      return;
    } catch (caughtError) {
      console.error(
        "SUPABASE REGISTER ERROR:",
        caughtError,
      );

      setError(
        "Une erreur inattendue est survenue. Veuillez réessayer.",
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sélection d'un pays.
   */
  function handleCountrySelect(
    iso2: string,
  ) {
    setSelectedCountryIso2(
      iso2,
    );

    setShowCountryPicker(
      false,
    );

    setError("");
  }

  /**
   * Retour vers l'accueil.
   */
  function handleBack() {
    if (loading) {
      return;
    }

    router.replace("/");
  }

  /**
   * Ouverture de la page de connexion.
   */
  function handleLogin() {
    if (loading) {
      return;
    }

    router.push("/login" as any);
  }

  /**
   * Bouton Google.
   *
   * Le fichier Web original affichait le bouton mais
   * ne contenait aucun handler OAuth.
   *
   * Il est donc conservé visuellement sans inventer
   * une implémentation Google qui n'existait pas dans
   * la source fournie.
   */
  function handleGoogle() {
    if (loading) {
      return;
    }

    Alert.alert(
      "Google",
      "La connexion avec Google n'est pas encore configurée.",
    );
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* Header */}

          <View
            style={styles.header}
          >
            <Pressable
              onPress={
                handleBack
              }
              disabled={loading}
              style={({ pressed }) => [
                styles.brandButton,
                pressed &&
                  styles.pressed,
                loading &&
                  styles.disabled,
              ]}
            >
              <Ionicons
                name="sparkles"
                size={19}
                color="#111111"
              />

              <Text
                style={styles.brandText}
              >
                Oria
              </Text>
            </Pressable>
          </View>

          {/* Register area */}

          <View
            style={styles.registerArea}
          >
            <View
              style={styles.card}
            >
              {/* Back */}

              <Pressable
                onPress={
                  handleBack
                }
                disabled={loading}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed &&
                    styles.pressed,
                  loading &&
                    styles.disabled,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={17}
                  color="#71717a"
                />

                <Text
                  style={
                    styles.backText
                  }
                >
                  Retour
                </Text>
              </Pressable>

              {/* Intro */}

              <View>
                <View
                  style={
                    styles.introIcon
                  }
                >
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color="#ffffff"
                  />
                </View>

                <Text
                  style={styles.title}
                >
                  Créer votre compte.
                </Text>

                <Text
                  style={
                    styles.description
                  }
                >
                  Rejoignez Oria et
                  accédez à vos outils
                  d'intelligence
                  artificielle depuis un
                  seul espace.
                </Text>
              </View>

              {/* Form */}

              <View
                style={styles.form}
              >
                {/* First / Last name */}

                <View
                  style={
                    styles.nameRow
                  }
                >
                  <View
                    style={
                      styles.nameColumn
                    }
                  >
                    <Text
                      style={
                        styles.label
                      }
                    >
                      Prénom
                    </Text>

                    <TextInput
                      value={
                        firstName
                      }
                      onChangeText={
                        setFirstName
                      }
                      placeholder="Votre prénom"
                      placeholderTextColor="#a1a1aa"
                      autoCapitalize="words"
                      autoCorrect={false}
                      autoComplete="given-name"
                      editable={
                        !loading
                      }
                      style={
                        styles.input
                      }
                    />
                  </View>

                  <View
                    style={
                      styles.nameColumn
                    }
                  >
                    <Text
                      style={
                        styles.label
                      }
                    >
                      Nom
                    </Text>

                    <TextInput
                      value={
                        lastName
                      }
                      onChangeText={
                        setLastName
                      }
                      placeholder="Votre nom"
                      placeholderTextColor="#a1a1aa"
                      autoCapitalize="words"
                      autoCorrect={false}
                      autoComplete="family-name"
                      editable={
                        !loading
                      }
                      style={
                        styles.input
                      }
                    />
                  </View>
                </View>

                {/* Country */}

                <View>
                  <Text
                    style={
                      styles.label
                    }
                  >
                    Pays
                  </Text>

                  <Pressable
                    onPress={() =>
                      setShowCountryPicker(
                        true,
                      )
                    }
                    disabled={loading}
                    style={({ pressed }) => [
                      styles.selectButton,
                      pressed &&
                        styles.pressed,
                      loading &&
                        styles.disabled,
                    ]}
                  >
                    <View
                      style={
                        styles.selectContent
                      }
                    >
                      <Text
                        style={
                          styles.selectText
                        }
                      >
                        {
                          country.name
                        }{" "}
                        (
                        {
                          country.callingCode
                        }
                        )
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color="#71717a"
                    />
                  </Pressable>

                  <Text
                    style={
                      styles.helperText
                    }
                  >
                    Le pays sélectionné
                    détermine
                    automatiquement
                    l'indicatif utilisé pour
                    votre numéro.
                  </Text>
                </View>

                {/* Phone */}

                <View>
                  <Text
                    style={
                      styles.label
                    }
                  >
                    Numéro de téléphone
                  </Text>

                  <View
                    style={
                      styles.phoneInputWrapper
                    }
                  >
                    <View
                      style={
                        styles.countryCodeBox
                      }
                    >
                      <Text
                        style={
                          styles.countryCodeText
                        }
                      >
                        {
                          country.callingCode
                        }
                      </Text>
                    </View>

                    <TextInput
                      value={phone}
                      onChangeText={
                        setPhone
                      }
                      placeholder="06 12 34 56 7"
                      placeholderTextColor="#a1a1aa"
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      editable={
                        !loading
                      }
                      style={[
                        styles.input,
                        styles.phoneInput,
                      ]}
                    />
                  </View>

                  <Text
                    style={
                      styles.helperText
                    }
                  >
                    Votre numéro sera
                    enregistré comme
                    donnée de profil et
                    utilisé lors de vos
                    paiements.
                  </Text>
                </View>

                {/* Email */}

                <View>
                  <Text
                    style={
                      styles.label
                    }
                  >
                    Adresse e-mail
                  </Text>

                  <TextInput
                    value={email}
                    onChangeText={
                      setEmail
                    }
                    placeholder="vous@exemple.com"
                    placeholderTextColor="#a1a1aa"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    editable={
                      !loading
                    }
                    style={
                      styles.input
                    }
                  />
                </View>

                {/* Password */}

                <View>
                  <Text
                    style={
                      styles.label
                    }
                  >
                    Mot de passe
                  </Text>

                  <View
                    style={
                      styles.passwordWrapper
                    }
                  >
                    <TextInput
                      value={
                        password
                      }
                      onChangeText={
                        setPassword
                      }
                      placeholder="Créer un mot de passe"
                      placeholderTextColor="#a1a1aa"
                      secureTextEntry={
                        !showPassword
                      }
                      autoComplete="new-password"
                      editable={
                        !loading
                      }
                      style={[
                        styles.input,
                        styles.passwordInput,
                      ]}
                    />

                    <Pressable
                      onPress={() =>
                        setShowPassword(
                          !showPassword,
                        )
                      }
                      disabled={
                        loading
                      }
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassword
                          ? "Masquer le mot de passe"
                          : "Afficher le mot de passe"
                      }
                      style={({ pressed }) => [
                        styles.eyeButton,
                        pressed &&
                          styles.pressed,
                        loading &&
                          styles.disabled,
                      ]}
                    >
                      <Ionicons
                        name={
                          showPassword
                            ? "eye-off-outline"
                            : "eye-outline"
                        }
                        size={19}
                        color="#71717a"
                      />
                    </Pressable>
                  </View>

                  <Text
                    style={
                      styles.helperText
                    }
                  >
                    Minimum 8 caractères.
                  </Text>
                </View>

                {/* Confirm password */}

                <View>
                  <Text
                    style={
                      styles.label
                    }
                  >
                    Confirmer le mot de passe
                  </Text>

                  <View
                    style={
                      styles.passwordWrapper
                    }
                  >
                    <TextInput
                      value={
                        confirmPassword
                      }
                      onChangeText={
                        setConfirmPassword
                      }
                      placeholder="Confirmer votre mot de passe"
                      placeholderTextColor="#a1a1aa"
                      secureTextEntry={
                        !showConfirmPassword
                      }
                      autoComplete="new-password"
                      editable={
                        !loading
                      }
                      style={[
                        styles.input,
                        styles.passwordInput,
                      ]}
                    />

                    <Pressable
                      onPress={() =>
                        setShowConfirmPassword(
                          !showConfirmPassword,
                        )
                      }
                      disabled={
                        loading
                      }
                      accessibilityRole="button"
                      accessibilityLabel={
                        showConfirmPassword
                          ? "Masquer le mot de passe"
                          : "Afficher le mot de passe"
                      }
                      style={({ pressed }) => [
                        styles.eyeButton,
                        pressed &&
                          styles.pressed,
                        loading &&
                          styles.disabled,
                      ]}
                    >
                      <Ionicons
                        name={
                          showConfirmPassword
                            ? "eye-off-outline"
                            : "eye-outline"
                        }
                        size={19}
                        color="#71717a"
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Error */}

                {error ? (
                  <View
                    style={
                      styles.errorBox
                    }
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={18}
                      color="#b91c1c"
                    />

                    <Text
                      style={
                        styles.errorText
                      }
                    >
                      {error}
                    </Text>
                  </View>
                ) : null}

                {/* Success */}

                {message ? (
                  <View
                    style={
                      styles.successBox
                    }
                  >
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color="#047857"
                    />

                    <Text
                      style={
                        styles.successText
                      }
                    >
                      {message}
                    </Text>
                  </View>
                ) : null}

                {/* Terms */}

                <Pressable
                  onPress={() =>
                    setTermsAccepted(
                      !termsAccepted,
                    )
                  }
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.termsRow,
                    pressed &&
                      styles.pressed,
                    loading &&
                      styles.disabled,
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      termsAccepted &&
                        styles.checkboxChecked,
                    ]}
                  >
                    {termsAccepted ? (
                      <Ionicons
                        name="checkmark"
                        size={13}
                        color="#ffffff"
                      />
                    ) : null}
                  </View>

                  <Text
                    style={
                      styles.termsText
                    }
                  >
                    J'accepte les conditions
                    d'utilisation et la
                    politique de
                    confidentialité de
                    Oria.
                  </Text>
                </Pressable>

                {/* Submit */}

                <Pressable
                  onPress={
                    handleSubmit
                  }
                  disabled={loading}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.submitButton,
                    pressed &&
                      styles.submitPressed,
                    loading &&
                      styles.disabled,
                  ]}
                >
                  {loading ? (
                    <View
                      style={
                        styles.submitContent
                      }
                    >
                      <ActivityIndicator
                        size="small"
                        color="#ffffff"
                      />

                      <Text
                        style={
                          styles.submitText
                        }
                      >
                        Création du compte...
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={
                        styles.submitText
                      }
                    >
                      Créer mon compte
                    </Text>
                  )}
                </Pressable>
              </View>

              {/* Divider */}

              <View
                style={
                  styles.dividerRow
                }
              >
                <View
                  style={
                    styles.dividerLine
                  }
                />

                <Text
                  style={
                    styles.dividerText
                  }
                >
                  ou
                </Text>

                <View
                  style={
                    styles.dividerLine
                  }
                />
              </View>

              {/* Google */}

              <Pressable
                onPress={
                  handleGoogle
                }
                disabled={loading}
                style={({ pressed }) => [
                  styles.googleButton,
                  pressed &&
                    styles.googlePressed,
                  loading &&
                    styles.disabled,
                ]}
              >
                <View
                  style={
                    styles.googleIcon
                  }
                >
                  <Text
                    style={
                      styles.googleG
                    }
                  >
                    G
                  </Text>
                </View>

                <Text
                  style={
                    styles.googleText
                  }
                >
                  Continuer avec Google
                </Text>
              </Pressable>

              {/* Login */}

              <View
                style={
                  styles.loginRow
                }
              >
                <Text
                  style={
                    styles.loginText
                  }
                >
                  Vous avez déjà un compte ?
                </Text>

                <Pressable
                  onPress={
                    handleLogin
                  }
                  disabled={loading}
                  style={({ pressed }) => [
                    pressed &&
                      styles.pressed,
                    loading &&
                      styles.disabled,
                  ]}
                >
                  <Text
                    style={
                      styles.loginLink
                    }
                  >
                    Se connecter
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Footer */}

            <Text
              style={
                styles.footerText
              }
            >
              Votre compte vous permettra de
              retrouver vos conversations,
              crédits et paramètres depuis tous
              vos appareils.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker */}

      <Modal
        visible={
          showCountryPicker
        }
        transparent
        animationType="slide"
        onRequestClose={() =>
          setShowCountryPicker(
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
              setShowCountryPicker(
                false,
              )
            }
          />

          <View
            style={
              styles.countryModal
            }
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
              <View>
                <Text
                  style={
                    styles.modalTitle
                  }
                >
                  Choisir votre pays
                </Text>

                <Text
                  style={
                    styles.modalSubtitle
                  }
                >
                  L'indicatif sera utilisé
                  pour votre numéro.
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setShowCountryPicker(
                    false,
                  )
                }
                style={
                  styles.modalClose
                }
              >
                <Ionicons
                  name="close"
                  size={22}
                  color="#52525b"
                />
              </Pressable>
            </View>

            <ScrollView
              style={
                styles.countryList
              }
              contentContainerStyle={
                styles.countryListContent
              }
              showsVerticalScrollIndicator={
                false
              }
            >
              {COUNTRY_PHONE_CONFIGS.map(
                (item) => {
                  const isSelected =
                    item.iso2 ===
                    selectedCountryIso2;

                  return (
                    <Pressable
                      key={
                        item.iso2
                      }
                      onPress={() =>
                        handleCountrySelect(
                          item.iso2,
                        )
                      }
                      style={({ pressed }) => [
                        styles.countryItem,
                        isSelected &&
                          styles.countryItemSelected,
                        pressed &&
                          styles.pressed,
                      ]}
                    >
                      <View
                        style={
                          styles.countryItemText
                        }
                      >
                        <Text
                          style={[
                            styles.countryName,
                            isSelected &&
                              styles.countryNameSelected,
                          ]}
                        >
                          {item.name}
                        </Text>

                        <Text
                          style={
                            styles.countryCallingCode
                          }
                        >
                          {
                            item.callingCode
                          }
                        </Text>
                      </View>

                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={21}
                          color="#111111"
                        />
                      ) : null}
                    </Pressable>
                  );
                },
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Styles.
 *
 * La version Web utilisait les classes Tailwind du projet.
 * En React Native, elles sont remplacées par un StyleSheet
 * local afin de conserver une hiérarchie visuelle proche :
 * fond, carte, champs, messages, bouton principal,
 * séparateur et sélecteur de pays.
 */
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  keyboardContainer: {
    flex: 1,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    paddingBottom: 28,
  },

  header: {
    height: 64,
    paddingHorizontal: 20,
    justifyContent: "center",
  },

  brandButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 8,
  },

  brandText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  registerArea: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },

  card: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 2,
  },

  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginBottom: 28,
    paddingVertical: 4,
    paddingRight: 8,
  },

  backText: {
    color: "#71717a",
    fontSize: 14,
    fontWeight: "500",
  },

  introIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    marginTop: 22,
    color: "#18181b",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.7,
  },

  description: {
    marginTop: 8,
    color: "#71717a",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "400",
  },

  form: {
    marginTop: 28,
    gap: 20,
  },

  nameRow: {
    flexDirection: "row",
    gap: 12,
  },

  nameColumn: {
    flex: 1,
  },

  label: {
    marginBottom: 8,
    color: "#27272a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },

  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#fafafa",
    paddingHorizontal: 15,
    paddingVertical: 12,
    color: "#18181b",
    fontSize: 14,
  },

  selectButton: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#fafafa",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  selectContent: {
    flex: 1,
    paddingRight: 10,
  },

  selectText: {
    color: "#27272a",
    fontSize: 14,
  },

  helperText: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
  },

  phoneInputWrapper: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },

  countryCodeBox: {
    minWidth: 62,
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  countryCodeText: {
    color: "#27272a",
    fontSize: 14,
    fontWeight: "600",
  },

  phoneInput: {
    flex: 1,
  },

  passwordWrapper: {
    position: "relative",
  },

  passwordInput: {
    paddingRight: 52,
  },

  eyeButton: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 13,
    paddingVertical: 12,
  },

  errorText: {
    flex: 1,
    color: "#b91c1c",
    fontSize: 13,
    lineHeight: 19,
  },

  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderColor: "#a7f3d0",
    borderRadius: 12,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 13,
    paddingVertical: 12,
  },

  successText: {
    flex: 1,
    color: "#047857",
    fontSize: 13,
    lineHeight: 19,
  },

  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },

  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: "#a1a1aa",
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },

  checkboxChecked: {
    backgroundColor: "#111111",
    borderColor: "#111111",
  },

  termsText: {
    flex: 1,
    color: "#71717a",
    fontSize: 12,
    lineHeight: 19,
  },

  submitButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },

  submitPressed: {
    opacity: 0.82,
  },

  submitContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  submitText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 26,
  },

  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e4e4e7",
  },

  dividerText: {
    color: "#71717a",
    fontSize: 12,
  },

  googleButton: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    paddingHorizontal: 16,
  },

  googlePressed: {
    backgroundColor: "#fafafa",
  },

  googleIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  googleG: {
    color: "#4285F4",
    fontSize: 17,
    fontWeight: "800",
  },

  googleText: {
    color: "#27272a",
    fontSize: 14,
    fontWeight: "600",
  },

  loginRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 26,
  },

  loginText: {
    color: "#71717a",
    fontSize: 13,
  },

  loginLink: {
    color: "#18181b",
    fontSize: 13,
    fontWeight: "600",
  },

  footerText: {
    marginTop: 18,
    paddingHorizontal: 8,
    color: "#71717a",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
  },

  pressed: {
    opacity: 0.72,
  },

  disabled: {
    opacity: 0.55,
  },

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

  countryModal: {
    maxHeight: "82%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: Platform.OS === "ios" ? 30 : 18,
  },

  modalHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d4d4d8",
    marginBottom: 18,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  modalTitle: {
    color: "#18181b",
    fontSize: 18,
    fontWeight: "700",
  },

  modalSubtitle: {
    marginTop: 4,
    color: "#71717a",
    fontSize: 12,
  },

  modalClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },

  countryList: {
    maxHeight: 500,
  },

  countryListContent: {
    paddingBottom: 8,
  },

  countryItem: {
    minHeight: 56,
    borderRadius: 13,
    paddingHorizontal: 13,
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  countryItemSelected: {
    backgroundColor: "#f4f4f5",
  },

  countryItemText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 14,
  },

  countryName: {
    color: "#27272a",
    fontSize: 14,
  },

  countryNameSelected: {
    color: "#111111",
    fontWeight: "600",
  },

  countryCallingCode: {
    color: "#71717a",
    fontSize: 13,
  },
});