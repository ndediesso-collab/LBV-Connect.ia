import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packs et tarifs IA",
  description:
    "Comparez les packs ORIA Léger, Intermédiaire, Pro et Business. Découvrez les crédits et les possibilités de la plateforme d'intelligence artificielle multimodèle.",
  alternates: { canonical: "/packs" },
  openGraph: {
    title: "Packs et tarifs | ORIA",
    description: "Découvrez les offres et les crédits ORIA pour choisir un accès adapté à vos usages.",
    url: "/packs",
  },
};

export default function PacksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
