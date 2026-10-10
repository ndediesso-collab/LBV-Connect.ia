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

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AnimatedSplashOverlay />

        <Stack screenOptions={{ headerShown: false }}>
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
