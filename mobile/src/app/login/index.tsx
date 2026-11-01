import React, { useCallback, useMemo, useState } from "react";
import Animated, { FadeInDown, FadeInUp, ReduceMotion } from "react-native-reanimated";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  "https://lbv-connect-api.onrender.com";


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    homeAccessibility: "Retour à l'accueil",
    back: "Retour",
    welcomeBack: "Bon retour.",
    subtitle: "Connectez-vous à votre compte Oria pour continuer.",
    email: "Adresse e-mail",
    emailPlaceholder: "vous@exemple.com",
    password: "Mot de passe",
    forgotPassword: "Mot de passe oublié ?",
    passwordPlaceholder: "Votre mot de passe",
    hidePassword: "Masquer le mot de passe",
    showPassword: "Afficher le mot de passe",
    signingIn: "Connexion...",
    signIn: "Se connecter",
    or: "ou",
    continueGoogle: "Continuer avec Google",
    noAccount: "Vous n'avez pas encore de compte ?",
    createAccount: "Créer un compte",
    legal:
      "En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité de Oria.",
    missingCredentials:
      "Veuillez renseigner votre adresse e-mail et votre mot de passe.",
    emailNotConfirmed:
      "Votre adresse e-mail n'est pas encore confirmée. Consultez votre boîte mail pour activer votre compte.",
    invalidCredentials: "Adresse e-mail ou mot de passe incorrect.",
    sessionMissing:
      "La connexion n'a pas pu être établie. Veuillez réessayer.",
    success: "Connexion réussie. Redirection...",
    loginError: "Une erreur est survenue pendant la connexion.",
    forgotTitle: "Mot de passe oublié",
    forgotUnavailable:
      "La page de récupération du mot de passe sera disponible prochainement.",
    googleTitle: "Google",
    googleUnavailable:
      "La connexion avec Google sera activée lors de l'intégration OAuth.",
  },
  en: {
    homeAccessibility: "Back to home",
    back: "Back",
    welcomeBack: "Welcome back.",
    subtitle: "Sign in to your Oria account to continue.",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    forgotPassword: "Forgot password?",
    passwordPlaceholder: "Your password",
    hidePassword: "Hide password",
    showPassword: "Show password",
    signingIn: "Signing in...",
    signIn: "Sign in",
    or: "or",
    continueGoogle: "Continue with Google",
    noAccount: "Don't have an account yet?",
    createAccount: "Create an account",
    legal:
      "By continuing, you agree to Oria's terms of use and privacy policy.",
    missingCredentials: "Please enter your email address and password.",
    emailNotConfirmed:
      "Your email address has not been confirmed yet. Check your inbox to activate your account.",
    invalidCredentials: "Incorrect email address or password.",
    sessionMissing:
      "The connection could not be established. Please try again.",
    success: "Signed in successfully. Redirecting...",
    loginError: "An error occurred while signing in.",
    forgotTitle: "Forgot password",
    forgotUnavailable:
      "The password recovery page will be available soon.",
    googleTitle: "Google",
    googleUnavailable:
      "Google sign-in will be enabled when OAuth integration is added.",
  },
} as const;

async function readOriaLanguage(): Promise<OriaLanguage> {
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

      return "fr";
    }

    const saved = await SecureStore.getItemAsync(ORIA_LANGUAGE_STORAGE_KEY);
    return saved === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

function localizeAuthError(message: string, language: OriaLanguage) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials")
  ) {
    return UI[language].invalidCredentials;
  }

  if (normalized.includes("email not confirmed")) {
    return UI[language].emailNotConfirmed;
  }

  return message;
}

export default function LoginPage() {
  // Pages publiques : le thème suit le réglage système sans requête Supabase.
  const isDark = useColorScheme() === "dark";
  const styles = useMemo(() => authStyles(isDark), [isDark]);

  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const [showPassword, setShowPassword] = useState(false);

  const t = UI[language];

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void readOriaLanguage().then((savedLanguage) => {
        if (active) setLanguage(savedLanguage);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function handleSubmit() {
    if (loading) return;

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setErrorMessage(
        t.missingCredentials
      );
      setSuccessMessage("");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        console.error("SUPABASE LOGIN ERROR:", error);

        if (error.code === "email_not_confirmed") {
          setErrorMessage(
            t.emailNotConfirmed
          );
        } else if (error.code === "invalid_credentials") {
          setErrorMessage(t.invalidCredentials);
        } else {
          setErrorMessage(localizeAuthError(error.message, language));
        }

        return;
      }

      if (!data.session) {
        setErrorMessage(
          t.sessionMissing
        );
        return;
      }

      console.log("Oria : accès accordé.");

      setSuccessMessage(t.success);

      // On laisse Supabase terminer la persistance de session avant d'ouvrir le chat.
      setTimeout(() => {
        router.replace("/chat" as any);
      }, 250);
    } catch (error) {
      console.error("LOGIN ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? localizeAuthError(error.message, language)
          : t.loginError
      );
    } finally {
      setLoading(false);
    }
  }

  function handleForgotPassword() {
    // La page /forgot-password n'est pas encore présente dans le projet mobile.
    // On conserve l'action prête pour la future page.
    Alert.alert(t.forgotTitle, t.forgotUnavailable);
  }

  function handleGoogleLogin() {
    // Le code Web d'origine affichait ce bouton sans implémenter
    // de logique OAuth Google. On conserve donc le bouton sans
    // inventer un flux différent.
    Alert.alert(t.googleTitle, t.googleUnavailable);
  }

  function goHome() {
    router.replace("/");
  }

  function goRegister() {
    router.push("/register" as any);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(350).reduceMotion(ReduceMotion.System)} style={styles.header}>
            <Pressable
              onPress={goHome}
              style={styles.brandButton}
              accessibilityRole="button"
              accessibilityLabel={t.homeAccessibility}
            >
              <Ionicons name="sparkles" size={18} color={isDark ? "#ffffff" : "#111111"} />
              <Text style={styles.brand}>Oria.</Text>
            </Pressable>
          </Animated.View>

          <View style={styles.center}>
            <Animated.View entering={FadeInDown.duration(440).reduceMotion(ReduceMotion.System)} style={styles.card}>
              <Pressable
                onPress={goHome}
                disabled={loading}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.pressed,
                  loading && styles.disabled,
                ]}
              >
                <Ionicons name="arrow-back" size={17} color={isDark ? "#bcbcbc" : "#777777"} />
                <Text style={styles.backText}>{t.back}</Text>
              </Pressable>

              <View style={styles.intro}>
                <Text style={styles.eyebrow}>{language === "fr" ? "VOTRE ESPACE ORIA" : "YOUR ORIA WORKSPACE"}</Text>
                <View style={styles.lockIcon}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={19}
                    color={isDark ? "#000000" : "#ffffff"}
                  />
                </View>

                <Text style={styles.title}>{t.welcomeBack}</Text>
                <Text style={styles.subtitle}>
                  {t.subtitle}
                </Text>
              </View>

              <View style={styles.form}>
                <View>
                  <Text style={styles.label}>{t.email}</Text>
                  <TextInput
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value);
                      if (errorMessage) setErrorMessage("");
                    }}
                    editable={!loading}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    placeholder={t.emailPlaceholder}
                    placeholderTextColor={isDark ? "#858585" : "#999999"}
                    style={[styles.input, loading && styles.inputDisabled]}
                    returnKeyType="next"
                  />
                </View>

                <View>
                  <View style={styles.passwordHeader}>
                    <Text style={styles.label}>{t.password}</Text>

                    <Pressable
                      onPress={handleForgotPassword}
                      disabled={loading}
                      hitSlop={8}
                    >
                      <Text style={styles.forgotText}>
                        {t.forgotPassword}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.passwordContainer}>
                    <TextInput
                      value={password}
                      onChangeText={(value) => {
                        setPassword(value);
                        if (errorMessage) setErrorMessage("");
                      }}
                      editable={!loading}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="password"
                      textContentType="password"
                      placeholder={t.passwordPlaceholder}
                      placeholderTextColor={isDark ? "#858585" : "#999999"}
                      style={[
                        styles.input,
                        styles.passwordInput,
                        loading && styles.inputDisabled,
                      ]}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                    />

                    <Pressable
                      onPress={() => setShowPassword((value) => !value)}
                      disabled={loading}
                      style={styles.eyeButton}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassword
                          ? t.hidePassword
                          : t.showPassword
                      }
                    >
                      <Ionicons
                        name={
                          showPassword
                            ? "eye-off-outline"
                            : "eye-outline"
                        }
                        size={19}
                        color={isDark ? "#bcbcbc" : "#777777"}
                      />
                    </Pressable>
                  </View>
                </View>

                {!!errorMessage && (
                  <View style={styles.errorBox} accessibilityRole="alert">
                    <Ionicons
                      name="alert-circle-outline"
                      size={17}
                      color="#b42318"
                    />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}

                {!!successMessage && (
                  <View style={styles.successBox} accessibilityRole="alert">
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={17}
                      color="#16803c"
                    />
                    <Text style={styles.successText}>{successMessage}</Text>
                  </View>
                )}

                <Pressable
                  onPress={handleSubmit}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.submitButton,
                    pressed && !loading && styles.submitPressed,
                    loading && styles.submitDisabled,
                  ]}
                >
                  {loading ? (
                    <>
                      <ActivityIndicator size="small" color={isDark ? "#000000" : "#ffffff"} />
                      <Text style={styles.submitText}>{t.signingIn}</Text>
                    </>
                  ) : (
                    <Text style={styles.submitText}>{t.signIn}</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>{t.or}</Text>
                <View style={styles.divider} />
              </View>

              <Pressable
                onPress={handleGoogleLogin}
                disabled={loading}
                style={({ pressed }) => [
                  styles.googleButton,
                  pressed && styles.pressed,
                  loading && styles.disabled,
                ]}
              >
                <View style={styles.googleMark}>
                  <Text style={styles.googleG}>G</Text>
                </View>
                <Text style={styles.googleText}>
                  {t.continueGoogle}
                </Text>
              </Pressable>

              <Text style={styles.registerText}>
                {t.noAccount}{" "}
                <Text
                  onPress={loading ? undefined : goRegister}
                  style={styles.registerLink}
                >
                  {t.createAccount}
                </Text>
              </Text>
            </Animated.View>

            <Animated.Text entering={FadeInUp.delay(120).duration(450).reduceMotion(ReduceMotion.System)} style={styles.legalText}>
              {t.legal}
            </Animated.Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },

  keyboardView: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },

  header: {
    height: 46,
    justifyContent: "center",
  },

  brandButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingRight: 8,
  },

  brand: {
    color: "#191919",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  center: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    justifyContent: "center",
    paddingVertical: 28,
  },

  card: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e6e6e6",
    borderRadius: 29,
    backgroundColor: "#ffffff",
    paddingHorizontal: 26,
    paddingVertical: 29,
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 28,
    paddingVertical: 4,
  },

  backText: {
    color: "#717171",
    fontSize: 14,
    fontWeight: "500",
  },

  intro: {
    alignItems: "flex-start",
  },
  eyebrow: {
    fontSize: 10, color: "#737373", fontWeight: "700", letterSpacing: 2,
    marginBottom: 2,
  },

  lockIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#191919",
  },

  title: {
    marginTop: 22,
    color: "#191919",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
  },

  subtitle: {
    marginTop: 7,
    color: "#717171",
    fontSize: 14,
    lineHeight: 22,
  },

  form: {
    marginTop: 30,
    gap: 20,
  },

  label: {
    marginBottom: 8,
    color: "#222222",
    fontSize: 14,
    fontWeight: "600",
  },

  input: {
    height: 50,
    width: "100%",
    borderWidth: 1,
    borderColor: "#d8d8d8",
    borderRadius: 16,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 15,
    color: "#191919",
    fontSize: 14,
  },

  inputDisabled: {
    opacity: 0.6,
  },

  passwordHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  forgotText: {
    color: "#717171",
    fontSize: 12,
    fontWeight: "600",
  },

  passwordContainer: {
    position: "relative",
  },

  passwordInput: {
    paddingRight: 52,
  },

  eyeButton: {
    position: "absolute",
    right: 7,
    top: 5,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: "#f2c9c5",
    borderRadius: 16,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },

  errorText: {
    flex: 1,
    color: "#b42318",
    fontSize: 13,
    lineHeight: 19,
  },

  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: "#b7e3c5",
    borderRadius: 16,
    backgroundColor: "#fafafa",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },

  successText: {
    flex: 1,
    color: "#16803c",
    fontSize: 13,
    lineHeight: 19,
  },

  submitButton: {
    height: 50,
    borderRadius: 16,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 16,
  },

  submitPressed: {
    opacity: 0.82,
  },

  submitDisabled: {
    opacity: 0.6,
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
    marginVertical: 27,
  },

  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "#e6e6e6",
  },

  dividerText: {
    color: "#9d9d9d",
    fontSize: 12,
  },

  googleButton: {
    height: 50,
    width: "100%",
    borderWidth: 1,
    borderColor: "#d8d8d8",
    borderRadius: 16,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 11,
  },

  googleMark: {
    width: 21,
    height: 21,
    alignItems: "center",
    justifyContent: "center",
  },

  googleG: {
    color: "#4285F4",
    fontSize: 17,
    fontWeight: "700",
  },

  googleText: {
    color: "#222222",
    fontSize: 14,
    fontWeight: "600",
  },

  registerText: {
    marginTop: 27,
    textAlign: "center",
    color: "#717171",
    fontSize: 13,
    lineHeight: 20,
  },

  registerLink: {
    color: "#191919",
    fontWeight: "700",
  },

  legalText: {
    marginTop: 18,
    paddingHorizontal: 10,
    textAlign: "center",
    color: "#9d9d9d",
    fontSize: 11,
    lineHeight: 18,
  },

  pressed: {
    opacity: 0.7,
  },

  disabled: {
    opacity: 0.5,
  },
});

// Couleurs natives de la version MONO Web. Les formulaires et actions sont inchangés.
const darkStyles = StyleSheet.create({
  'safeArea': {backgroundColor: '#000000'},
  'brand': {color: '#ffffff'},
  'card': {backgroundColor: '#090909', borderColor: '#282828', shadowOpacity: 0, elevation: 0},
  'backText': {color: '#b5b5b5'},
  'lockIcon': {backgroundColor: '#ffffff'},
  'title': {color: '#ffffff'},
  'subtitle': {color: '#b5b5b5'},
  'label': {color: '#eeeeee'},
  'eyebrow': { color: '#a5a5a5' },
  'input': {color: '#ffffff', backgroundColor: '#171717', borderColor: '#333333'},
  'forgotText': {color: '#bdbdbd'},
  'submitButton': {backgroundColor: '#ffffff'},
  'submitText': {color: '#000000'},
  'divider': {backgroundColor: '#303030'},
  'dividerText': {color: '#9c9c9c'},
  'googleButton': {backgroundColor: '#171717', borderColor: '#343434'},
  'googleText': {color: '#ffffff'},
  'registerText': {color: '#b5b5b5'},
  'registerLink': {color: '#ffffff'},
  'legalText': {color: '#939393'},
  'errorBox': {backgroundColor: '#271616', borderColor: '#633636'},
  'successBox': {backgroundColor: '#102719', borderColor: '#2d6141'},
});

function authStyles(dark: boolean): typeof lightStyles {
  if (!dark) return lightStyles;
  const overrides = darkStyles as Partial<Record<keyof typeof lightStyles, object>>;
  const entries = Object.keys(lightStyles).map((key) => {
    const id = key as keyof typeof lightStyles;
    return [key, overrides[id] ? [lightStyles[id], overrides[id]] : lightStyles[id]] as const;
  });
  return Object.fromEntries(entries) as typeof lightStyles;
}
