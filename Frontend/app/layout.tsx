import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import oriaLogo from "./oria-logo.png";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Oria",
  description: "Votre espace intelligent Oria",
  icons: {
    icon: oriaLogo.src,
    shortcut: oriaLogo.src,
    apple: oriaLogo.src,
  },
};

// Charge avant l'hydratation : le mode sombre ne commence plus par un flash blanc.
// Aucune preference tierce n'est envoyee au serveur par ce script.
const initialThemeScript = `
(function () {
  var theme = null;
  try {
    var stored = localStorage.getItem("oria_theme");
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (_) {}
  if (!theme) {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <Script id="oria-initial-theme" strategy="beforeInteractive">
          {initialThemeScript}
        </Script>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
