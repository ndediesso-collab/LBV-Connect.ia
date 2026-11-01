import React, { useEffect, useRef, useState } from "react";
import { Animated, type ImageResizeMode, type ImageStyle, StyleSheet, View,
  type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";

type SkeletonProps = { style?: StyleProp<ViewStyle>; dark?: boolean };

/** Forme de chargement douce, sans boucle si l'utilisateur réduit les animations. */
export function OriaSkeleton({ style, dark = false }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.53)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.9, duration: 780, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.53, duration: 780, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  return <Animated.View accessibilityElementsHidden style={[
    { backgroundColor: dark ? "#303030" : "#eaeaea", borderRadius: 15, opacity: reduceMotion ? 0.65 : undefined },
    !reduceMotion && { opacity }, style,
  ]} />;
}

type OriaImageProps = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  dark?: boolean;
  accessibilityLabel?: string;
};

/**
 * Image avec état de chargement + transition native.
 * N'affiche pas une image distante à partir d'une URL vide, ne précharge
 * aucune image privée et ne stocke aucun fichier dans le cache de l'app.
 */
export function OriaImage({ uri, style, resizeMode = "cover", dark = false,
  accessibilityLabel }: OriaImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    opacity.setValue(0);
  }, [uri, opacity]);
  const containerStyle = style as StyleProp<ViewStyle>;
  return <View style={[containerStyle, { overflow: "hidden", backgroundColor: dark ? "#1d1d1d" : "#efefef" }]}>
    {!loaded && !failed ? <OriaSkeleton dark={dark} style={StyleSheet.absoluteFill} /> : null}
    {failed ? <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Ionicons name="image-outline" size={30} color={dark ? "#888888" : "#aaaaaa"} />
    </View> : null}
    <Animated.Image source={{ uri }} resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      style={[StyleSheet.absoluteFill, { opacity }]}
      onLoad={() => {
        setLoaded(true);
        Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : 240,
          useNativeDriver: true }).start();
      }}
      onError={() => { setFailed(true); setLoaded(false); }}
    />
  </View>;
}
