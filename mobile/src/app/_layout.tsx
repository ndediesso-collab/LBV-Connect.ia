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
      <ThemeProvider
        value={isDark ? DarkTheme : DefaultTheme}
      >
        <StatusBar
          style={isDark ? "light" : "dark"}
        />

        <AnimatedSplashOverlay />

        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}