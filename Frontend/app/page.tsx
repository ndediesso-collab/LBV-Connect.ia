import type { Metadata } from "next";
import OriaLanding from "@/components/oria-landing/OriaLanding";

// Accueil public ORIA. L'espace utilisateur reste accessible sur /chat.
export const metadata: Metadata = {
  title: "ORIA | Plusieurs intelligences. Une seule expérience.",
  description:
    "Découvrez ORIA : chat multimodèle, documents, images, vidéos, code et recherche Web. Choisissez un pack adapté et créez depuis un seul espace.",
  applicationName: "ORIA",
  alternates: { canonical: "https://www.myoriaai.com/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "ORIA | Plusieurs intelligences. Une seule expérience.",
    description:
      "Discutez, analysez vos documents, créez et avancez avec plusieurs modèles d'intelligence artificielle dans un seul espace.",
    url: "https://www.myoriaai.com/",
    siteName: "ORIA",
    type: "website",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary",
    title: "ORIA | Plusieurs intelligences. Une seule expérience.",
    description: "Chat, documents, créations et modèles d'IA au même endroit.",
  },
};

export default function HomePage() {
  return <OriaLanding />;
}
