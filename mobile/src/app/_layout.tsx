import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

// Thèmes de navigation natifs identiques à la palette ORIA Web.
const oriaLightNavigation = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors,
    background: "#ffffff", card: "#ffffff", text: "#111111",
    primary: "#111111", border: "#e5e5e5", notification: "#111111" },
};
const oriaDarkNavigation = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors,
    background: "#000000", card: "#101010", text: "#ffffff",
    primary: "#ffffff", border: "#303030", notification: "#ffffff" },
};

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? oriaDarkNavigation : oriaLightNavigation}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AnimatedSplashOverlay />

        <Stack screenOptions={{
          headerShown: false,
          animation: "fade_from_bottom",
          contentStyle: { backgroundColor: isDark ? "#000000" : "#ffffff" },
        }}>
          {/*
            Le Chat est l'écran racine une fois connecté.
            On désactive son geste natif de retour dès la création de la route,
            avant même que le composant Chat ne soit monté. Les autres pages
            conservent le swipe-back natif.
          */}
          <Stack.Screen
            name="chat"
            options={{
              gestureEnabled: false,
            }}
          />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
