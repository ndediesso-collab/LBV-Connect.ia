import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";

type Props = { dark: boolean; variant?: "rows" | "wallet"; count?: number };

/** ORIA native skeleton. Never sends an API request or starts a paid operation. */
export default function OriaSkeleton({ dark, variant = "rows", count = 3 }: Props) {
  const opacity = useRef(new Animated.Value(0.48)).current;
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active || reduced) {
        opacity.setValue(0.75);
        return;
      }
      animation = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.48, duration: 850, useNativeDriver: true }),
      ]));
      animation.start();
    });
    return () => { active = false; animation?.stop(); };
  }, [opacity]);

  const surface = dark ? "#111111" : "#f6f6f6";
  const line = dark ? "#292929" : "#e8e8e8";
  if (variant === "wallet") {
    return (
      <Animated.View style={[styles.wallet, { backgroundColor: surface, borderColor: line, opacity }]}
        accessible accessibilityLabel="Chargement des crédits">
        <View style={[styles.short, { backgroundColor: line }]} />
        <View style={[styles.amount, { backgroundColor: line }]} />
        <View style={[styles.track, { backgroundColor: line }]} />
        <View style={[styles.short, { width: "55%", backgroundColor: line }]} />
      </Animated.View>
    );
  }
  return (
    <View style={styles.list} accessible accessibilityLabel="Chargement">
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} style={[styles.row, {
          opacity, backgroundColor: surface, borderColor: line,
        }]}>
          <View style={[styles.avatar, { backgroundColor: line }]} />
          <View style={styles.content}>
            <View style={[styles.title, { width: i % 2 ? "52%" : "78%", backgroundColor: line }]} />
            <View style={[styles.subtitle, { width: i % 2 ? "83%" : "65%", backgroundColor: line }]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingVertical: 8 },
  row: { minHeight: 90, borderWidth: 1, borderRadius: 21, padding: 16,
    flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 40, height: 40, borderRadius: 14 },
  content: { flex: 1, gap: 11 },
  title: { height: 12, borderRadius: 6 },
  subtitle: { height: 9, borderRadius: 5 },
  wallet: { borderWidth: 1, borderRadius: 28, padding: 24, gap: 21, minHeight: 220 },
  short: { width: "38%", height: 12, borderRadius: 6 },
  amount: { width: "72%", height: 39, borderRadius: 9 },
  track: { width: "100%", height: 7, borderRadius: 4 },
});
