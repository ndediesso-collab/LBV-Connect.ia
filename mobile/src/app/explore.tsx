import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
  overline: string;
};

const destinations: Destination[] = [
  { title: "Chat multi-IA", overline: "01 / DISCUTER", description: "Échangez avec les modèles accessibles dans votre pack.", icon: "chatbubbles-outline", route: "/chat" },
  { title: "Mes créations", overline: "02 / BIBLIOTHÈQUE", description: "Vos images, vidéos, documents et fichiers au même endroit.", icon: "images-outline", route: "/mes_creations" },
  { title: "Mini-Studio", overline: "03 / CRÉER", description: "Retrouvez le studio image et vidéo depuis le Chat ORIA.", icon: "sparkles-outline", route: "/chat" },
  { title: "Crédits", overline: "04 / PORTEFEUILLE", description: "Suivez votre solde et les opérations réellement facturées.", icon: "wallet-outline", route: "/credits" },
  { title: "Les packs ORIA", overline: "05 / ABONNEMENTS", description: "Comparez les capacités, les modèles et les tarifs.", icon: "layers-outline", route: "/packs" },
  { title: "Centre d'aide", overline: "06 / ASSISTANCE", description: "Consultez les réponses aux questions fréquentes.", icon: "help-circle-outline", route: "/help" },
];

export default function ExplorePage() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const isDark = theme.background?.toLowerCase() === "#000000";
  const columns = width >= 720 ? 2 : 1;
  const C = useMemo(() => ({
    bg: isDark ? "#000000" : "#ffffff",
    glass: isDark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.025)",
    surface: isDark ? "#111111" : "#ffffff",
    secondary: isDark ? "#1c1c1c" : "#f5f5f5",
    text: isDark ? "#ffffff" : "#111111",
    muted: isDark ? "#aaaaaa" : "#666666",
    softText: isDark ? "#777777" : "#999999",
    line: isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.09)",
    accent: isDark ? "#ffffff" : "#000000",
    onAccent: isDark ? "#000000" : "#ffffff",
  }), [isDark]);

  return (
    <SafeAreaView style={StyleSheet.flatten([styles.screen, { backgroundColor: C.bg }])} edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
      >
        <View style={styles.topbar}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: C.accent }]}>
              <Text style={[styles.brandMarkText, { color: C.onAccent }]}>O</Text>
            </View>
            <Text style={[styles.brandText, { color: C.text }]}>ORIA</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retour au chat"
            onPress={() => router.push("/chat" as any)}
            style={({ pressed }) => [styles.topButton, { borderColor: C.line, backgroundColor: C.glass, opacity: pressed ? 0.72 : 1 }]}
          >
            <Ionicons name="arrow-back-outline" size={18} color={C.text} />
            <Text style={[styles.topButtonText, { color: C.text }]}>Chat</Text>
          </Pressable>
        </View>

        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(350)} style={styles.heading}>
          <View style={[styles.eyebrow, { backgroundColor: C.glass, borderColor: C.line }]}>
            <View style={[styles.dot, { backgroundColor: C.accent }]} />
            <Text style={[styles.eyebrowText, { color: C.muted }]}>VOTRE ESPACE ORIA</Text>
          </View>
          <Text style={[styles.title, { color: C.text }]}>Tout est ici.{"\n"}<Text style={{ color: C.muted }}>Explorez Oria.</Text></Text>
          <Text style={[styles.subtitle, { color: C.muted }]}>
            Un espace pour réfléchir, créer et avancer. Accédez à vos outils sans quitter ORIA.
          </Text>
        </Animated.View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Vos outils</Text>
          <Text style={[styles.sectionCount, { color: C.softText }]}>06 ESPACES</Text>
        </View>
        <View style={styles.grid}>
          {destinations.map((item, index) => (
            <Animated.View
              key={item.title}
              entering={reduceMotion ? undefined : FadeInDown.duration(310).delay(Math.min(index * 55, 260))}
              style={[styles.item, columns === 2 ? styles.itemHalf : styles.itemFull]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityHint={item.title === "Mini-Studio" ? "Ouvre le chat, depuis lequel le Mini-Studio est accessible" : undefined}
                onPress={() => router.push(item.route as any)}
                style={({ pressed }) => [styles.card, {
                  backgroundColor: C.glass,
                  borderColor: C.line,
                  opacity: pressed ? 0.84 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                }]}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.cardIcon, { backgroundColor: C.secondary, borderColor: C.line }]}>
                    <Ionicons name={item.icon} size={24} color={C.text} />
                  </View>
                  <Ionicons name="arrow-forward-outline" size={20} color={C.muted} />
                </View>
                <Text style={[styles.overline, { color: C.softText }]}>{item.overline}</Text>
                <Text style={[styles.cardTitle, { color: C.text }]}>{item.title}</Text>
                <Text style={[styles.cardDescription, { color: C.muted }]}>{item.description}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
        <View style={[styles.footerPanel, { backgroundColor: C.surface, borderColor: C.line }]}>
          <View style={[styles.footerAccent, { backgroundColor: C.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.footerHeading, { color: C.text }]}>Une seule application. Plus de possibilités.</Text>
            <Text style={[styles.footerText, { color: C.muted }]}>Technologie · Créativité · Afrique</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 900, alignSelf: "center", paddingHorizontal: 20, paddingBottom: 48 },
  topbar: { minHeight: 74, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", gap: 10, alignItems: "center" },
  brandMark: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  brandMarkText: { fontSize: 18, fontWeight: "900" },
  brandText: { fontSize: 15, fontWeight: "800", letterSpacing: 2 },
  topButton: { minHeight: 42, flexDirection: "row", gap: 7, alignItems: "center", paddingHorizontal: 14, borderRadius: 14, borderWidth: 1 },
  topButtonText: { fontSize: 13, fontWeight: "700" },
  heading: { marginTop: 33, marginBottom: 38 },
  eyebrow: { flexDirection: "row", alignItems: "center", borderRadius: 100, borderWidth: 1, gap: 10, paddingVertical: 8, paddingHorizontal: 13, marginBottom: 20, alignSelf: "flex-start" },
  eyebrowText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  title: { fontSize: 39, lineHeight: 47, fontWeight: "800", letterSpacing: -1.5 },
  subtitle: { maxWidth: 540, marginTop: 16, fontSize: 15, lineHeight: 25 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  sectionTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.6 },
  sectionCount: { fontSize: 10, letterSpacing: 1.2, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6, rowGap: 12 },
  item: { paddingHorizontal: 6 },
  itemHalf: { width: "50%" },
  itemFull: { width: "100%" },
  card: { borderWidth: 1, borderRadius: 24, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 23, minHeight: 210 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 26 },
  cardIcon: { width: 52, height: 52, borderRadius: 17, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  overline: { fontSize: 10, fontWeight: "700", letterSpacing: 1.35, marginBottom: 7 },
  cardTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.4, marginBottom: 7 },
  cardDescription: { fontSize: 13, lineHeight: 21 },
  footerPanel: { borderWidth: 1, borderRadius: 22, padding: 20, flexDirection: "row", alignItems: "center", gap: 15, marginTop: 28 },
  footerAccent: { width: 4, height: 43, borderRadius: 3 },
  footerHeading: { fontSize: 14, fontWeight: "800", marginBottom: 4 },
  footerText: { fontSize: 11, letterSpacing: 0.6 },
});
