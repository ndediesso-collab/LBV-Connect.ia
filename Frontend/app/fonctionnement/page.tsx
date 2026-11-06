import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Comment fonctionne ORIA ?",
  description:
    "Découvrez comment utiliser ORIA : créer un compte, choisir un pack de crédits et accéder au chat IA, à la recherche Web, aux documents et aux créations multimédias.",
  alternates: { canonical: "/fonctionnement" },
  openGraph: {
    title: "Comment fonctionne ORIA ?",
    description: "Trois étapes pour découvrir la plateforme IA multimodèle ORIA.",
    url: "/fonctionnement",
  },
};

const etapes = [
  { n: "01", titre: "Découvrez les possibilités", texte: "Explorez la conversation avec plusieurs IA, la recherche Web, l'analyse de documents et les créations d'images ou de vidéos, selon les options disponibles." },
  { n: "02", titre: "Créez votre compte et choisissez un pack", texte: "Consultez les offres et leurs crédits. Le pack choisi détermine les modèles et les fonctions accessibles dans votre espace." },
  { n: "03", titre: "Utilisez ORIA selon vos besoins", texte: "Choisissez un outil, envoyez votre demande et suivez votre consommation de crédits. Le coût des créations multimédias est présenté avant confirmation." },
] as const;

// Cette page est /fonctionnement, distincte de la vraie landing / (OriaLanding.tsx).
// Aucune clé privée ni vérification d'éligibilité utilisateur ici : cela reste dans /packs.
const discoveryPublic = process.env.NEXT_PUBLIC_ORIA_DISCOVERY_ENABLED === "1";

export default function FonctionnementPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/70 px-5 py-5 sm:px-8">
        <nav aria-label="Navigation" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">ORIA</Link>
          <div className="flex flex-wrap items-center gap-5 text-sm text-muted-strong">
            <Link href="/" className="hover:text-foreground">Accueil</Link>
            <Link href="/packs" className="hover:text-foreground">Packs et tarifs</Link>
            <Link href="/help" className="hover:text-foreground">Aide</Link>
          </div>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-strong">Découvrir la plateforme</p>
        <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">Comment fonctionne ORIA ?</h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-muted-strong sm:text-lg">
          ORIA rassemble plusieurs outils d'intelligence artificielle au même endroit. Vous choisissez un pack, puis utilisez les fonctionnalités disponibles avec vos crédits.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/packs" className="rounded-2xl bg-foreground px-6 py-3.5 text-sm font-semibold text-background">Voir les packs</Link>
          <Link href="/help" className="rounded-2xl border border-border px-6 py-3.5 text-sm font-semibold hover:bg-surface-secondary">Consulter l'aide</Link>
        </div>
      </section>
      {discoveryPublic && (
        <section aria-labelledby="offre-decouverte-titre" className="border-y border-border/70 px-5 py-12 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-muted-strong">Offre de bienvenue · une fois par compte</p>
              <h2 id="offre-decouverte-titre" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Commencez avec le Pack Découverte.</h2>
              <p className="mt-3 text-sm leading-7 text-muted-strong">
                8 000 crédits sans expiration, GPT-6 Luna et deux essais GPT-5.6 Terra. Découvrez aussi la création d'une image Recraft en 1K et jusqu'à deux vidéos Grok de 4 secondes en 480p. Les fonctionnalités avancées restent réservées aux autres formules.
              </p>
              <p className="mt-2 text-xs text-muted-strong">Recharge supplémentaire unique : 1 000 crédits pour 600 FCFA, sans date d'expiration. L'éligibilité est vérifiée avant l'achat.</p>
            </div>
            <div className="shrink-0 md:text-right">
              <p className="text-3xl font-semibold tracking-tight">1 000 FCFA</p>
              <p className="mt-1 text-sm text-muted-strong">Paiement unique</p>
              <Link href="/packs#offre-decouverte" className="mt-4 inline-flex rounded-2xl bg-foreground px-5 py-3 text-sm font-semibold text-background">Découvrir l'offre</Link>
            </div>
          </div>
        </section>
      )}
      <section className="border-y border-border/70 bg-surface-secondary/35 px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trois étapes pour commencer</h2>
          <ol className="mt-10 grid gap-8 lg:grid-cols-3">
            {etapes.map((etape) => (
              <li key={etape.n} className="border-t border-border-strong/60 pt-5">
                <span className="text-xs font-semibold tracking-[0.22em] text-muted">{etape.n}</span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{etape.titre}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-strong">{etape.texte}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Une plateforme, plusieurs usages</h2>
        <div className="mt-7 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          <div><h3 className="font-semibold">Comprendre et raisonner</h3><p className="mt-2 text-sm leading-7 text-muted-strong">Posez vos questions, approfondissez un sujet et utilisez les modèles disponibles dans votre pack.</p></div>
          <div><h3 className="font-semibold">Rechercher sur le Web</h3><p className="mt-2 text-sm leading-7 text-muted-strong">Appuyez-vous sur la recherche Web pour explorer des informations et leurs sources.</p></div>
          <div><h3 className="font-semibold">Travailler avec des documents</h3><p className="mt-2 text-sm leading-7 text-muted-strong">Analysez vos fichiers et préparez vos contenus selon les fonctions disponibles.</p></div>
          <div><h3 className="font-semibold">Créer des images et des vidéos</h3><p className="mt-2 text-sm leading-7 text-muted-strong">Transformez vos idées en visuels. Les possibilités et la consommation de crédits dépendent de votre formule et des paramètres choisis.</p></div>
        </div>
        <section id="oria-mini-studio-visuels" aria-labelledby="oria-mini-studio-visuels-titre" className="mt-12">
          <h2 id="oria-mini-studio-visuels-titre" className="text-2xl font-semibold tracking-tight sm:text-3xl">Découvrir les créations ORIA</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-strong">Deux aperçus des outils de création disponibles dans le Mini-Studio ORIA, selon le pack choisi.</p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <figure className="overflow-hidden rounded-2xl border border-border/70 bg-surface/80">
              <Image src="/oria/oria-mini-studio-image.webp" alt="ORIA Mini-Studio : aperçu de la création d’images par intelligence artificielle" width={482} height={171} unoptimized className="h-auto w-full" />
              <figcaption className="px-5 py-4 text-sm font-medium">Création d’images avec ORIA</figcaption>
            </figure>
            <figure className="overflow-hidden rounded-2xl border border-border/70 bg-surface/80">
              <Image src="/oria/oria-mini-studio-video.webp" alt="ORIA Mini-Studio : aperçu des outils de création vidéo par intelligence artificielle" width={481} height={175} unoptimized className="h-auto w-full" />
              <figcaption className="px-5 py-4 text-sm font-medium">Création vidéo avec ORIA</figcaption>
            </figure>
          </div>
        </section>
        <div className="mt-12 flex flex-wrap gap-6 text-sm text-muted-strong">
          <Link href="/packs" className="font-semibold text-foreground underline underline-offset-4">Découvrir les tarifs</Link>
          <Link href="/help" className="hover:text-foreground">Questions fréquentes</Link>
          <Link href="/legal" className="hover:text-foreground">À propos d'ORIA</Link>
        </div>
      </section>
    </main>
  );
}
