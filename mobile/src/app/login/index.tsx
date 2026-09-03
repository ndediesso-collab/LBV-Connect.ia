import React, { useState } from "react";
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
import { router } from "expo-router";

import { supabase } from "@/lib/supabase/client";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  "https://lbv-connect-api.onrender.com";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

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
        "Veuillez renseigner votre adresse e-mail et votre mot de passe."
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
            "Votre adresse e-mail n'est pas encore confirmée. Consultez votre boîte mail pour activer votre compte."
          );
        } else if (error.code === "invalid_credentials") {
          setErrorMessage("Adresse e-mail ou mot de passe incorrect.");
        } else {
          setErrorMessage(error.message);
        }

        return;
      }

      if (!data.session) {
        setErrorMessage(
          "La connexion n'a pas pu être établie. Veuillez réessayer."
        );
        return;
      }

      console.log("Oria : accès accordé.");

      setSuccessMessage("Connexion réussie. Redirection...");

      // On laisse Supabase terminer la persistance de session avant d'ouvrir le chat.
      setTimeout(() => {
        router.replace("/chat" as any);
      }, 250);
    } catch (error) {
      console.error("LOGIN ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue pendant la connexion."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleForgotPassword() {
    // La page /forgot-password n'est pas encore présente dans le projet mobile.
    // On conserve l'action prête pour la future page.
    Alert.alert(
      "Mot de passe oublié",
      "La page de récupération du mot de passe sera disponible prochainement."
    );
  }

  function handleGoogleLogin() {
    // Le code Web d'origine affichait ce bouton sans implémenter
    // de logique OAuth Google. On conserve donc le bouton sans
    // inventer un flux différent.
    Alert.alert(
      "Google",
      "La connexion avec Google sera activée lors de l'intégration OAuth."
    );
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
              accessibilityLabel="Retour à l'accueil"
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
                <Text style={styles.backText}>Retour</Text>
              </Pressable>

              <View style={styles.intro}>
                <View style={styles.lockIcon}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={19}
                    color="#fff"
                  />
                </View>

                <Text style={styles.title}>Bon retour.</Text>
                <Text style={styles.subtitle}>
                  Connectez-vous à votre compte Oria pour continuer.
                </Text>
              </View>

              <View style={styles.form}>
                <View>
                  <Text style={styles.label}>Adresse e-mail</Text>
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
                    placeholder="vous@exemple.com"
                    placeholderTextColor="#9999a2"
                    style={[styles.input, loading && styles.inputDisabled]}
                    returnKeyType="next"
                  />
                </View>

                <View>
                  <View style={styles.passwordHeader}>
                    <Text style={styles.label}>Mot de passe</Text>

                    <Pressable
                      onPress={handleForgotPassword}
                      disabled={loading}
                      hitSlop={8}
                    >
                      <Text style={styles.forgotText}>
                        Mot de passe oublié ?
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
                      placeholder="Votre mot de passe"
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
                          ? "Masquer le mot de passe"
                          : "Afficher le mot de passe"
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
                      <Text style={styles.submitText}>Connexion...</Text>
                    </>
                  ) : (
                    <Text style={styles.submitText}>Se connecter</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>ou</Text>
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
                  Continuer avec Google
                </Text>
              </Pressable>

              <Text style={styles.registerText}>
                Vous n'avez pas encore de compte ?{" "}
                <Text
                  onPress={loading ? undefined : goRegister}
                  style={styles.registerLink}
                >
                  Créer un compte
                </Text>
              </Text>
            </View>

            <Text style={styles.legalText}>
              En continuant, vous acceptez les conditions d'utilisation et la
              politique de confidentialité de Oria.
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