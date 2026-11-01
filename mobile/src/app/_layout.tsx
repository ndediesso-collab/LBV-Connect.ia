import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

/** Couleurs de navigation alignées sur ORIA Web et la nouvelle UI mobile. */
const oriaLightNavigation = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#ffffff",
    card: "#ffffff",
    text: "#111111",
    primary: "#111111",
    border: "#e8e8e8",
    notification: "#111111",
  },
};

const oriaDarkNavigation = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#000000",
    card: "#101010",
    text: "#ffffff",
    primary: "#ffffff",
    border: "#303030",
    notification: "#ffffff",
  },
};

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const isDark = useColorScheme() === "dark";
  const pathname = usePathname();
  // La vitrine publique reste noire dans tous les thèmes du téléphone.
  const isHome = pathname === "/" || pathname === "/index";

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? oriaDarkNavigation : oriaLightNavigation}>
        <StatusBar style={isHome || isDark ? "light" : "dark"} />
        <AnimatedSplashOverlay />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "fade_from_bottom",
            contentStyle: { backgroundColor: isDark ? "#000000" : "#ffffff" },
          }}
        >
          <Stack.Screen
            name="index"
            options={{ contentStyle: { backgroundColor: "#000000" } }}
          />
          {/* Le chat conserve son comportement de navigation existant. */}
          <Stack.Screen name="chat" options={{ gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
