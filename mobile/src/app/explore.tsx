import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useTheme } from "@/hooks/use-theme";

type Destination = {
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  route: "/chat" | "/mes_creations" | "/credits" | "/packs" | "/help";
};

const destinations: Destination[] = [
  { title: "Chat multi-IA", description: "Discutez, raisonnez et échangez avec les modèles inclus dans votre pack.", icon: "chatbubbles-outline", route: "/chat" },
  { title: "Mes créations", description: "Retrouvez vos images, vidéos, documents et fichiers générés.", icon: "images-outline", route: "/mes_creations" },
  { title: "Mini-Studio", description: "Préparez vos images, clips et projets vidéo depuis le Chat ORIA.", icon: "film-outline", route: "/chat" },
  { title: "Crédits", description: "Consultez votre portefeuille et les opérations réellement facturées.", icon: "wallet-outline", route: "/credits" },
  { title: "Les packs ORIA", description: "Comparez les capacités, tarifs et droits de votre formule.", icon: "layers-outline", route: "/packs" },
  { title: "Centre d'aide", description: "Trouvez des réponses aux questions sur les fonctionnalités ORIA.", icon: "help-circle-outline", route: "/help" },
];

export default function ExplorePage() {
  const colors = useTheme();
  const reduceMotion = useReducedMotion();
  const isDark = colors.background === "#000000";
  const C = {
    bg: isDark ? "#000000" : "#ffffff",
    surface: isDark ? "#111111" : "#ffffff",
    secondary: isDark ? "#1b1b1b" : "#f6f6f6",
    text: isDark ? "#ffffff" : "#111111",
    muted: isDark ? "#b8b8b8" : "#666666",
    line: isDark ? "#303030" : "#e5e5e5",
    icon: isDark ? "#ffffff" : "#111111",
  };
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: C.bg }]} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(320)} style={styles.heading}>
          <View style={[styles.eyebrow, { backgroundColor: C.secondary, borderColor: C.line }]}>
            <View style={[styles.dot, { backgroundColor: C.icon }]} />
            <Text style={[styles.eyebrowText, { color: C.muted }]}>VOTRE ESPACE ORIA</Text>
          </View>
          <Text style={[styles.title, { color: C.text }]}>Explorer Oria.</Text>
          <Text style={[styles.subtitle, { color: C.muted }]}>
            Tous vos outils d’intelligence artificielle, réunis dans un seul espace.
          </Text>
        </Animated.View>

        <View style={styles.grid}>
          {destinations.map((item, index) => (
            <Animated.View
              key={item.title}
              entering={reduceMotion ? undefined : FadeInDown.duration(340).delay(Math.min(index * 45, 225))}
              style={styles.item}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => router.push(item.route as any)}
                style={({ pressed }) => [styles.card, {
                  backgroundColor: C.surface, borderColor: C.line,
                  opacity: pressed ? 0.83 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                }]}
              >
                <View style={[styles.cardIcon, { backgroundColor: C.secondary, borderColor: C.line }]}>
                  <Ionicons name={item.icon} size={22} color={C.icon} />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>{item.title}</Text>
                  <Text style={[styles.cardDescription, { color: C.muted }]}>{item.description}</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={C.muted} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
        <Text style={[styles.footer, { color: C.muted }]}>Technologie · Créativité · Afrique</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 18, paddingTop: 28, paddingBottom: 42 },
  heading: { alignItems: "flex-start", marginBottom: 26 },
  eyebrow: { flexDirection: "row", alignItems: "center", borderRadius: 999, borderWidth: 1, gap: 9, paddingVertical: 8, paddingHorizontal: 13, marginBottom: 16 },
  eyebrowText: { fontSize: 10, fontWeight: "600", letterSpacing: 1.5 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  title: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: -1.2 },
  subtitle: { maxWidth: 530, marginTop: 9, fontSize: 14, lineHeight: 23 },
  grid: { gap: 11 },
  item: { width: "100%" },
  card: { flexDirection: "row", alignItems: "center", gap: 13, borderWidth: 1, borderRadius: 22, padding: 17, minHeight: 98 },
  cardIcon: { width: 48, height: 48, flexShrink: 0, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, gap: 5 },
  cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.25 },
  cardDescription: { fontSize: 12, lineHeight: 19 },
  footer: { textAlign: "center", fontSize: 11, letterSpacing: 1.2, marginTop: 30 },
});
