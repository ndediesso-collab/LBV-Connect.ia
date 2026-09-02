import React, { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const categories = [
  { title: "Premiers pas", description: "Découvrez comment utiliser Oria.", icon: "sparkles-outline" as const },
  { title: "Crédits", description: "Comprendre le fonctionnement et la consommation.", icon: "card-outline" as const },
  { title: "Modèles IA", description: "Comprendre Standard, Raisonnement et Premium.", icon: "flash-outline" as const },
  { title: "Compte et sécurité", description: "Gérer votre compte et vos paramètres.", icon: "shield-checkmark-outline" as const },
];

const faqs = [
  { question: "Qu'est-ce que Oria ?", answer: "Oria est une interface qui rassemble différentes technologies d'intelligence artificielle au même endroit." },
  { question: "À quoi servent les crédits ?", answer: "Les crédits permettent d'utiliser les différentes fonctionnalités et modèles disponibles dans votre pack. La consommation dépend de l'opération et du modèle utilisé." },
  { question: "Les crédits ont-ils une durée de validité ?", answer: "Oui. Les crédits sont associés à un pack et restent utilisables pendant la durée de validité de celui-ci." },
  { question: "Puis-je utiliser plusieurs modèles d'IA ?", answer: "Oui, les modèles disponibles dépendent du pack auquel vous avez souscrit." },
  { question: "Que se passe-t-il lorsque mes crédits sont épuisés ?", answer: "Vous pouvez acheter des crédits complémentaires afin de continuer à utiliser Oria." },
  { question: "Puis-je utiliser Oria sur mobile ?", answer: "L'interface est conçue pour être responsive et s'adapter aux smartphones, tablettes et ordinateurs." },
];

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const filteredFaqs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return faqs;
    return faqs.filter((faq) =>
      faq.question.toLowerCase().includes(query) ||
      faq.answer.toLowerCase().includes(query)
    );
  }, [search]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.backButton} onPress={() => router.push("/chat" as any)} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color="#55555f" />
          </Pressable>
          <View style={styles.brandIcon}>
            <Ionicons name="sparkles" size={15} color="#15151a" />
          </View>
          <Text style={styles.brandText}>ORIA</Text>
        </View>
        <Pressable style={styles.headerChatButton} onPress={() => router.push("/chat" as any)}>
          <Text style={styles.headerChatButtonText}>Retour au chat</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="help-circle-outline" size={23} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Comment pouvons-nous vous aider ?</Text>
          <Text style={styles.heroDescription}>
            Retrouvez les réponses aux questions les plus fréquentes sur Oria.
          </Text>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={19} color="#9999a2" style={styles.searchIcon} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher une question..."
              placeholderTextColor="#9999a2"
              style={styles.searchInput}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable style={styles.clearButton} onPress={() => setSearch("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#a0a0a8" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Explorer l'aide</Text>
          <View style={styles.categoryGrid}>
            {categories.map((category) => (
              <Pressable key={category.title} style={({ pressed }) => [styles.categoryCard, pressed && styles.categoryCardPressed]}>
                <View style={styles.categoryIcon}>
                  <Ionicons name={category.icon} size={18} color="#606069" />
                </View>
                <View style={styles.categoryContent}>
                  <Text style={styles.categoryTitle}>{category.title}</Text>
                  <Text style={styles.categoryDescription}>{category.description}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.faqHeading}>
            <View style={styles.faqHeadingIcon}>
              <Ionicons name="book-outline" size={18} color="#4f4f58" />
            </View>
            <Text style={styles.sectionTitle}>Questions fréquentes</Text>
          </View>

          <View style={styles.faqContainer}>
            {filteredFaqs.length > 0 ? filteredFaqs.map((faq) => {
              const index = faqs.findIndex((item) => item.question === faq.question);
              const isOpen = openFaq === index;
              return (
                <View key={faq.question} style={styles.faqItem}>
                  <Pressable style={styles.faqQuestion} onPress={() => setOpenFaq(isOpen ? null : index)}>
                    <Text style={styles.faqQuestionText}>{faq.question}</Text>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={17} color="#9999a2" />
                  </Pressable>
                  {isOpen && (
                    <View style={styles.faqAnswerContainer}>
                      <Text style={styles.faqAnswer}>{faq.answer}</Text>
                    </View>
                  )}
                </View>
              );
            }) : (
              <View style={styles.noResults}>
                <View style={styles.noResultsIcon}>
                  <Ionicons name="search-outline" size={21} color="#777780" />
                </View>
                <Text style={styles.noResultsTitle}>Aucun résultat</Text>
                <Text style={styles.noResultsText}>Essayez avec d'autres mots-clés.</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.supportCard}>
          <View style={styles.supportIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={19} color="#606069" />
          </View>
          <Text style={styles.supportTitle}>Vous ne trouvez pas votre réponse ?</Text>
          <Text style={styles.supportDescription}>
            Notre espace d'assistance pourra vous aider pour les problèmes liés à votre compte, vos crédits ou l'utilisation du service.
          </Text>
          <Pressable style={({ pressed }) => [styles.supportButton, pressed && styles.supportButtonPressed]}>
            <Ionicons name="chatbubble-outline" size={16} color="#fff" />
            <Text style={styles.supportButtonText}>Contacter le support</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
  header: { minHeight: 64, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dedee3", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  backButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 7 },
  brandIcon: { width: 29, height: 29, borderRadius: 9, backgroundColor: "#f0f0f2", alignItems: "center", justifyContent: "center", marginRight: 8 },
  brandText: { color: "#15151a", fontSize: 15, fontWeight: "700", letterSpacing: 0.4 },
  headerChatButton: { minHeight: 38, borderRadius: 11, backgroundColor: "#111114", paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  headerChatButtonText: { color: "#fff", fontSize: 11.5, fontWeight: "600" },
  content: { paddingHorizontal: 18, paddingTop: 38, paddingBottom: 45 },
  hero: { alignItems: "center" },
  heroIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: "#111114", alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#15151a", fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.6, textAlign: "center", marginTop: 18 },
  heroDescription: { color: "#777780", fontSize: 13.5, lineHeight: 21, textAlign: "center", maxWidth: 480, marginTop: 8 },
  searchContainer: { width: "100%", maxWidth: 620, height: 52, borderWidth: 1, borderColor: "#dedee3", borderRadius: 16, backgroundColor: "#fafafa", flexDirection: "row", alignItems: "center", marginTop: 25 },
  searchIcon: { marginLeft: 15 },
  searchInput: { flex: 1, height: "100%", paddingHorizontal: 10, color: "#17171c", fontSize: 13.5 },
  clearButton: { paddingHorizontal: 13 },
  section: { marginTop: 39 },
  sectionTitle: { color: "#1b1b20", fontSize: 17, fontWeight: "700" },
  categoryGrid: { marginTop: 15, gap: 10 },
  categoryCard: { minHeight: 91, borderWidth: 1, borderColor: "#e2e2e6", borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "flex-start", backgroundColor: "#fff" },
  categoryCardPressed: { backgroundColor: "#fafafa", borderColor: "#d4d4d9" },
  categoryIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#f1f1f3", alignItems: "center", justifyContent: "center", marginRight: 13 },
  categoryContent: { flex: 1 },
  categoryTitle: { color: "#202025", fontSize: 13.5, fontWeight: "600" },
  categoryDescription: { color: "#777780", fontSize: 12, lineHeight: 18, marginTop: 4 },
  faqHeading: { flexDirection: "row", alignItems: "center" },
  faqHeadingIcon: { width: 35, height: 35, borderRadius: 10, backgroundColor: "#f1f1f3", alignItems: "center", justifyContent: "center", marginRight: 9 },
  faqContainer: { marginTop: 15, borderWidth: 1, borderColor: "#e2e2e6", borderRadius: 16, overflow: "hidden", backgroundColor: "#fff" },
  faqItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e3e3e6" },
  faqQuestion: { minHeight: 56, paddingHorizontal: 15, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  faqQuestionText: { flex: 1, color: "#25252a", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  faqAnswerContainer: { paddingHorizontal: 15, paddingBottom: 17 },
  faqAnswer: { color: "#777780", fontSize: 12.5, lineHeight: 20 },
  noResults: { minHeight: 180, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  noResultsIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#f1f1f3", alignItems: "center", justifyContent: "center" },
  noResultsTitle: { color: "#25252a", fontSize: 13.5, fontWeight: "600", marginTop: 10 },
  noResultsText: { color: "#888891", fontSize: 11.5, marginTop: 4 },
  supportCard: { marginTop: 28, borderWidth: 1, borderColor: "#e2e2e6", borderRadius: 21, backgroundColor: "#fafafa", padding: 23, alignItems: "center" },
  supportIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  supportTitle: { color: "#202025", fontSize: 16.5, fontWeight: "700", textAlign: "center", marginTop: 13 },
  supportDescription: { color: "#777780", fontSize: 12.5, lineHeight: 20, textAlign: "center", marginTop: 7, maxWidth: 520 },
  supportButton: { minHeight: 43, borderRadius: 11, backgroundColor: "#111114", paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 17 },
  supportButtonPressed: { opacity: 0.8 },
  supportButtonText: { color: "#fff", fontSize: 12.5, fontWeight: "600", marginLeft: 7 },
});
