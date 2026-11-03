import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.myoriaai.com"),
  applicationName: "ORIA",
  title: {
    default: "ORIA | Plateforme d'intelligence artificielle multimodèle",
    template: "%s | ORIA",
  },
  description:
    "ORIA réunit plusieurs modèles d'intelligence artificielle pour discuter, raisonner, rechercher sur le Web, analyser des documents et créer des images ou des vidéos.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "ORIA",
    url: "/",
    title: "ORIA | Plateforme d'intelligence artificielle multimodèle",
    description:
      "Discutez, recherchez, analysez vos fichiers et créez des images ou vidéos avec plusieurs IA réunies dans un seul espace.",
    images: [{ url: "/oria-logo.png", width: 1254, height: 1254, alt: "Logo officiel ORIA" }],
  },
  twitter: {
    card: "summary",
    images: ["/oria-logo.png"],
  },
  icons: {
    icon: "/oria-logo.png",
    shortcut: "/oria-logo.png",
    apple: "/oria-logo.png",
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
