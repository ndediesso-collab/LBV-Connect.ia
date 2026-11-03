import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aide et questions fréquentes",
  description:
    "Découvrez les réponses aux questions fréquentes sur ORIA, ses modèles d'intelligence artificielle, ses crédits et son fonctionnement.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Aide et questions fréquentes | ORIA",
    url: "/help",
    description:
      "Des réponses pratiques pour comprendre les modèles, les crédits et les fonctionnalités d'ORIA.",
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
