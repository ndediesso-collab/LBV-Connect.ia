import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "À propos et informations légales",
  description:
    "Découvrez ORIA, sa vision, son fonctionnement, ses engagements et les informations qui encadrent l'utilisation de la plateforme.",
  alternates: { canonical: "/legal" },
  openGraph: {
    title: "À propos et informations légales | ORIA",
    url: "/legal",
    description:
      "Découvrez la vision d'ORIA, les services proposés et ses engagements envers les utilisateurs.",
  },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
