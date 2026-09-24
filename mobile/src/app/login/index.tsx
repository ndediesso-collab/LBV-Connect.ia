import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
          <View style={styles.header}>
            <Pressable
              onPress={goHome}
              style={styles.brandButton}
              accessibilityRole="button"
              accessibilityLabel={t.homeAccessibility}
            >
              <Ionicons name="sparkles" size={18} color="#17171b" />
              <Text style={styles.brand}>Oria.</Text>
            </Pressable>
          </View>

          <View style={styles.center}>
            <View style={styles.card}>
              <Pressable
                onPress={goHome}
                disabled={loading}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.pressed,
                  loading && styles.disabled,
                ]}
              >
                <Ionicons name="arrow-back" size={17} color="#777780" />
                <Text style={styles.backText}>{t.back}</Text>
              </Pressable>

              <View style={styles.intro}>
                <View style={styles.lockIcon}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={19}
                    color="#fff"
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
                    placeholderTextColor="#9999a2"
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
                      placeholderTextColor="#9999a2"
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
                        color="#777780"
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
                      <ActivityIndicator size="small" color="#fff" />
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
            </View>

            <Text style={styles.legalText}>
              {t.legal}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fafafa",
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
    color: "#17171b",
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
    borderColor: "#e7e7eb",
    borderRadius: 28,
    backgroundColor: "#fff",
    padding: 24,
    shadowColor: "#000",
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
    color: "#777780",
    fontSize: 14,
    fontWeight: "500",
  },

  intro: {
    alignItems: "flex-start",
  },

  lockIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17171b",
  },

  title: {
    marginTop: 22,
    color: "#17171b",
    fontSize: 29,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.8,
  },

  subtitle: {
    marginTop: 7,
    color: "#777780",
    fontSize: 14,
    lineHeight: 22,
  },

  form: {
    marginTop: 30,
    gap: 20,
  },

  label: {
    marginBottom: 8,
    color: "#242429",
    fontSize: 14,
    fontWeight: "600",
  },

  input: {
    height: 50,
    width: "100%",
    borderWidth: 1,
    borderColor: "#dedee3",
    borderRadius: 13,
    backgroundColor: "#f7f7f8",
    paddingHorizontal: 15,
    color: "#17171b",
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
    color: "#777780",
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
    borderRadius: 13,
    backgroundColor: "#fff4f2",
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
    borderRadius: 13,
    backgroundColor: "#f0fbf3",
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
    borderRadius: 13,
    backgroundColor: "#17171b",
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
    color: "#fff",
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
    backgroundColor: "#e7e7eb",
  },

  dividerText: {
    color: "#9999a2",
    fontSize: 12,
  },

  googleButton: {
    height: 50,
    width: "100%",
    borderWidth: 1,
    borderColor: "#dedee3",
    borderRadius: 13,
    backgroundColor: "#fff",
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
    color: "#242429",
    fontSize: 14,
    fontWeight: "600",
  },

  registerText: {
    marginTop: 27,
    textAlign: "center",
    color: "#777780",
    fontSize: 13,
    lineHeight: 20,
  },

  registerLink: {
    color: "#17171b",
    fontWeight: "700",
  },

  legalText: {
    marginTop: 18,
    paddingHorizontal: 10,
    textAlign: "center",
    color: "#9999a2",
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