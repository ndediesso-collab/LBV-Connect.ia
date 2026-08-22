"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  HelpCircle,
  Lock,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Pack = {
  id: string;
  name: string;
  price: string;
  credits: string;
  duration: string;
  description: string;
  popular?: boolean;
  features: string[];
  tiers: {
    name: string;
    available: boolean;
  }[];
};

/*
 * Données temporaires.
 *
 * Elles seront remplacées plus tard par les données
 * provenant du système de packs / abonnements.
 */
const packs: Pack[] = [
  {
    id: "light",
    name: "Léger",
    price: "6 500 XAF",
    credits: "15 000",
    duration: "35 jours",
    description:
      "Pour découvrir LBV-Connect.ia et utiliser les fonctionnalités essentielles.",
    features: [
      "Chat IA Standard",
      "Modèles Standard",
      "Analyse de documents",
      "Vision et analyse d'images",
      "Recherche Web",
      "Génération de contenu",
    ],
    tiers: [
      {
        name: "Standard",
        available: true,
      },
      {
        name: "Raisonnement",
        available: false,
      },
      {
        name: "Premium",
        available: false,
      },
    ],
  },
  {
    id: "standard",
    name: "Standard",
    price: "12 500 XAF",
    credits: "35 000",
    duration: "35 jours",
    description:
      "Un équilibre entre puissance, volume de crédits et accès aux modèles avancés.",
    popular: true,
    features: [
      "Tout du pack Léger",
      "Modèles Standard",
      "Modèles Raisonnement",
      "Analyse avancée de documents",
      "Analyse de données",
      "Code et assistance technique",
      "Recherche Web avancée",
    ],
    tiers: [
      {
        name: "Standard",
        available: true,
      },
      {
        name: "Raisonnement",
        available: true,
      },
      {
        name: "Premium",
        available: false,
      },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "25 000 XAF",
    credits: "80 000",
    duration: "35 jours",
    description:
      "Pour les utilisateurs intensifs qui veulent accéder aux modèles les plus puissants.",
    features: [
      "Tout du pack Standard",
      "Modèles Standard",
      "Modèles Raisonnement",
      "Modèles Premium",
      "Analyse avancée",
      "Code avancé",
      "Recherche Web",
      "Fonctionnalités créatives",
    ],
    tiers: [
      {
        name: "Standard",
        available: true,
      },
      {
        name: "Raisonnement",
        available: true,
      },
      {
        name: "Premium",
        available: true,
      },
    ],
  },
];

const faqs = [
  {
    question:
      "Combien de temps mes crédits sont-ils valables ?",
    answer:
      "Les crédits d'un pack sont valables pendant la durée indiquée sur celui-ci. Dans notre configuration actuelle, les packs sont valables 35 jours.",
  },
  {
    question:
      "Que se passe-t-il si mes crédits sont épuisés avant la fin du pack ?",
    answer:
      "Vous pouvez acheter des crédits complémentaires sans avoir besoin d'attendre la fin de votre période.",
  },
  {
    question:
      "Puis-je utiliser plusieurs modèles avec un même pack ?",
    answer:
      "Oui. Les modèles auxquels vous avez accès dépendent du niveau inclus dans votre pack.",
  },
  {
    question:
      "Les crédits ont-ils tous la même valeur selon les modèles ?",
    answer:
      "Non. La consommation dépend notamment du modèle et de l'opération effectuée. LBV-Connect.ia estime et réserve les crédits nécessaires avant l'opération.",
  },
];

export default function PacksPage() {
  const [openFaq, setOpenFaq] =
    useState<number | null>(null);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Header */}

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label="Retour au chat"
              className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />

              <span className="font-semibold tracking-tight">
                LBV-Connect.ia
              </span>
            </div>
          </div>

          <Link
            href="/credits"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-sm transition hover:bg-surface-tertiary"
          >
            <CreditCard size={16} />

            <span className="hidden sm:inline">
              Mes crédits
            </span>
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        {/* Header */}

        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium text-muted">
            Packs LBV-Connect.ia
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
            Choisissez votre accès à l&apos;IA.
          </h1>

          <p className="mt-4 text-sm leading-6 text-muted sm:text-base">
            Un pack vous donne un volume de
            crédits utilisable pendant sa période
            de validité. Le niveau de modèle
            accessible dépend du pack choisi.
          </p>
        </div>

        {/* Pack cards */}

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
            />
          ))}
        </div>

        {/* Complementary credits */}

        <section className="mt-8 overflow-hidden rounded-3xl border border-border bg-surface-secondary">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2">
                <Zap size={18} />

                <h2 className="text-lg font-semibold">
                  Besoin de crédits supplémentaires ?
                </h2>
              </div>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Si votre solde arrive à zéro avant
                la fin de votre pack, vous pourrez
                acheter des crédits complémentaires
                à partir de 500 XAF.
              </p>
            </div>

            {/*
             * Fonctionnalité d'achat à connecter
             * lorsque le système de paiement sera
             * implémenté.
             */}

            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-accent-foreground opacity-60"
            >
              Acheter des crédits
              <Zap size={16} />
            </button>
          </div>
        </section>

        {/* How it works */}

        <section className="mt-12">
          <div className="text-center">
            <p className="text-sm font-medium text-muted">
              Fonctionnement
            </p>

            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Simple à comprendre
            </h2>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Step
              number="01"
              title="Choisissez un pack"
              description="Sélectionnez le volume de crédits et le niveau de modèles qui correspondent à votre usage."
            />

            <Step
              number="02"
              title="Utilisez LBV"
              description="Utilisez le chat, les documents, la vision, le code, le Web et les autres capacités disponibles."
            />

            <Step
              number="03"
              title="Suivez vos crédits"
              description="Votre solde est toujours visible et chaque opération consomme uniquement les crédits nécessaires."
            />
          </div>
        </section>

        {/* FAQ */}

        <section className="mt-12">
          <div className="flex items-center justify-center gap-2">
            <HelpCircle size={18} />

            <h2 className="text-lg font-semibold">
              Questions sur les packs
            </h2>
          </div>

          <div className="mx-auto mt-5 max-w-3xl overflow-hidden rounded-2xl border border-border">
            {faqs.map((faq, index) => {
              const isOpen =
                openFaq === index;

              return (
                <div
                  key={faq.question}
                  className="border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-surface-secondary"
                    onClick={() =>
                      setOpenFaq(
                        isOpen ? null : index,
                      )
                    }
                    aria-expanded={isOpen}
                  >
                    <span className="text-sm font-medium">
                      {faq.question}
                    </span>

                    <ChevronDown
                      size={17}
                      className={`shrink-0 text-muted transition-transform ${
                        isOpen
                          ? "rotate-180"
                          : ""
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="bg-surface px-5 pb-5">
                      <p className="text-sm leading-6 text-muted">
                        {faq.answer}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function PackCard({
  pack,
}: {
  pack: Pack;
}) {
  const isPopular = Boolean(
    pack.popular,
  );

  return (
    <article
      className={`relative flex flex-col rounded-3xl border p-6 transition sm:p-7 ${
        isPopular
          ? "border-accent bg-accent text-accent-foreground shadow-xl"
          : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      {/* Popular badge */}

      {isPopular && (
        <div className="absolute right-5 top-5 rounded-full bg-accent-foreground px-3 py-1 text-[11px] font-semibold text-accent">
          Le plus choisi
        </div>
      )}

      {/* Pack identity */}

      <div>
        <p
          className={`text-sm font-medium ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Pack
        </p>

        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {pack.name}
        </h2>

        <p
          className={`mt-3 min-h-[48px] text-sm leading-6 ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          {pack.description}
        </p>
      </div>

      {/* Price */}

      <div className="mt-7">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold tracking-tight">
            {pack.price}
          </span>
        </div>

        <div
          className={`mt-1 flex items-center gap-2 text-sm ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          <Clock3 size={15} />

          {pack.duration}
        </div>
      </div>

      {/* Separator */}

      <div
        className={`my-7 h-px ${
          isPopular
            ? "bg-accent-foreground/10"
            : "bg-border"
        }`}
      />

      {/* Credits */}

      <div>
        <p
          className={`text-xs font-medium uppercase tracking-wider ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Crédit inclus
        </p>

        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {pack.credits}
        </p>
      </div>

      {/* Models */}

      <div className="mt-7">
        <p
          className={`text-xs font-medium uppercase tracking-wider ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Modèles
        </p>

        <div className="mt-3 space-y-2">
          {pack.tiers.map((tier) => (
            <div
              key={tier.name}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                {tier.available ? (
                  <Check
                    size={15}
                    className={
                      isPopular
                        ? "text-accent-foreground"
                        : "text-muted-strong"
                    }
                  />
                ) : (
                  <Lock
                    size={14}
                    className={
                      isPopular
                        ? "opacity-35"
                        : "text-muted"
                    }
                  />
                )}

                <span
                  className={`text-sm ${
                    tier.available
                      ? isPopular
                        ? "opacity-90"
                        : "text-muted-strong"
                      : isPopular
                        ? "opacity-35"
                        : "text-muted"
                  }`}
                >
                  {tier.name}
                </span>
              </div>

              {!tier.available && (
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    isPopular
                      ? "opacity-35"
                      : "text-muted"
                  }`}
                >
                  Verrouillé
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Features */}

      <div className="mt-7">
        <p
          className={`text-xs font-medium uppercase tracking-wider ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Inclus
        </p>

        <ul className="mt-3 space-y-2.5">
          {pack.features.map(
            (feature) => (
              <li
                key={feature}
                className="flex gap-2.5"
              >
                <Check
                  size={16}
                  className={`mt-0.5 shrink-0 ${
                    isPopular
                      ? "text-accent-foreground"
                      : "text-muted-strong"
                  }`}
                />

                <span
                  className={`text-sm ${
                    isPopular
                      ? "opacity-80"
                      : "text-muted-strong"
                  }`}
                >
                  {feature}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>

      {/* Purchase */}

      <button
        type="button"
        disabled
        className={`mt-8 w-full cursor-not-allowed rounded-xl px-4 py-3 text-sm font-medium transition ${
          isPopular
            ? "bg-accent-foreground text-accent opacity-60"
            : "bg-accent text-accent-foreground opacity-60"
        }`}
      >
        Choisir {pack.name}
      </button>
    </article>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <span className="text-xs font-semibold text-muted">
        {number}
      </span>

      <h3 className="mt-4 text-sm font-semibold">
        {title}
      </h3>

      <p className="mt-2 text-sm leading-6 text-muted">
        {description}
      </p>
    </div>
  );
}