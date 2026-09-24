"use client";

import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  CircleHelp,
  CreditCard,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    backToChat: "Retour au chat",
    helpTitle: "Comment pouvons-nous vous aider ?",
    helpDescription:
      "Retrouvez les réponses aux questions les plus fréquentes sur Oria.",
    searchPlaceholder: "Rechercher une question...",
    exploreHelp: "Explorer l'aide",
    faqTitle: "Questions fréquentes",
    noResult: "Aucun résultat",
    tryOtherKeywords: "Essayez avec d'autres mots-clés.",
    supportQuestion: "Vous ne trouvez pas votre réponse ?",
    supportDescription:
      "Notre espace d'assistance pourra vous aider pour les problèmes liés à votre compte, vos crédits ou l'utilisation du service.",
    contactSupport: "Contacter le support",
  },
  en: {
    backToChat: "Back to chat",
    helpTitle: "How can we help you?",
    helpDescription:
      "Find answers to the most frequently asked questions about Oria.",
    searchPlaceholder: "Search for a question...",
    exploreHelp: "Explore help",
    faqTitle: "Frequently asked questions",
    noResult: "No results",
    tryOtherKeywords: "Try different keywords.",
    supportQuestion: "Can't find your answer?",
    supportDescription:
      "Our support space can help with issues related to your account, credits, or use of the service.",
    contactSupport: "Contact support",
  },
} as const;

const categories = {
  fr: [
    {
      title: "Premiers pas",
      description: "Découvrez comment utiliser Oria.",
      icon: Sparkles,
    },
    {
      title: "Crédits",
      description: "Comprendre le fonctionnement et la consommation.",
      icon: CreditCard,
    },
    {
      title: "Modèles IA",
      description: "Comprendre Standard, Raisonnement et Premium.",
      icon: Zap,
    },
    {
      title: "Compte et sécurité",
      description: "Gérer votre compte et vos paramètres.",
      icon: ShieldCheck,
    },
  ],
  en: [
    {
      title: "Getting started",
      description: "Learn how to use Oria.",
      icon: Sparkles,
    },
    {
      title: "Credits",
      description: "Understand how credits work and are consumed.",
      icon: CreditCard,
    },
    {
      title: "AI models",
      description: "Understand Standard, Reasoning, and Premium.",
      icon: Zap,
    },
    {
      title: "Account and security",
      description: "Manage your account and settings.",
      icon: ShieldCheck,
    },
  ],
} as const;

const faqs = {
  fr: [
    {
      question: "Qu'est-ce que Oria ?",
      answer:
        "Oria est une interface qui rassemble différentes technologies d'intelligence artificielle au même endroit.",
    },
    {
      question: "À quoi servent les crédits ?",
      answer:
        "Les crédits permettent d'utiliser les différentes fonctionnalités et modèles disponibles dans votre pack. La consommation dépend de l'opération et du modèle utilisé.",
    },
    {
      question: "Les crédits ont-ils une durée de validité ?",
      answer:
        "Oui. Les crédits sont associés à un pack et restent utilisables pendant la durée de validité de celui-ci.",
    },
    {
      question: "Puis-je utiliser plusieurs modèles d'IA ?",
      answer:
        "Oui, les modèles disponibles dépendent du pack auquel vous avez souscrit.",
    },
    {
      question: "Que se passe-t-il lorsque mes crédits sont épuisés ?",
      answer:
        "Vous pouvez acheter des crédits complémentaires afin de continuer à utiliser Oria.",
    },
    {
      question: "Puis-je utiliser Oria sur mobile ?",
      answer:
        "L'interface est conçue pour être responsive et s'adapter aux smartphones, tablettes et ordinateurs.",
    },
  ],
  en: [
    {
      question: "What is Oria?",
      answer:
        "Oria is an interface that brings different artificial intelligence technologies together in one place.",
    },
    {
      question: "What are credits used for?",
      answer:
        "Credits let you use the different features and models available in your pack. Consumption depends on the operation and model used.",
    },
    {
      question: "Do credits have an expiration period?",
      answer:
        "Yes. Credits are linked to a pack and remain usable for the duration of that pack.",
    },
    {
      question: "Can I use multiple AI models?",
      answer:
        "Yes. The models available to you depend on the pack you subscribed to.",
    },
    {
      question: "What happens when I run out of credits?",
      answer:
        "You can purchase additional credits to continue using Oria.",
    },
    {
      question: "Can I use Oria on mobile?",
      answer:
        "The interface is responsive and adapts to smartphones, tablets, and computers.",
    },
  ],
} as const;

function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") {
    return "fr";
  }

  const saved = window.localStorage.getItem(
    ORIA_LANGUAGE_STORAGE_KEY,
  );

  if (saved === "fr" || saved === "en") {
    return saved;
  }

  return window.navigator.language
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "fr";
}

export default function HelpPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");

  const [search, setSearch] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
      setOpenFaq(null);
    };

    syncLanguage();

    window.addEventListener(
      "storage",
      syncLanguage,
    );
    window.addEventListener(
      "oria-language-change",
      syncLanguage,
    );

    return () => {
      window.removeEventListener(
        "storage",
        syncLanguage,
      );
      window.removeEventListener(
        "oria-language-change",
        syncLanguage,
      );
    };
  }, []);

  const currentFaqs = faqs[language];
  const currentCategories = categories[language];

  const filteredFaqs = currentFaqs.filter((faq) => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      faq.question.toLowerCase().includes(query) ||
      faq.answer.toLowerCase().includes(query)
    );
  });

  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label={UI[language].backToChat}
              className="rounded-xl p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <span className="font-semibold tracking-tight">
                Oria
              </span>
            </div>
          </div>

          <Link
            href="/chat"
            className="hidden rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 sm:inline-flex"
          >
            {UI[language].backToChat}
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        {/* Hero */}
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white">
            <CircleHelp size={22} />
          </div>

          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            {UI[language].helpTitle}
          </h1>

          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-500 sm:text-base">
            {UI[language].helpDescription}
          </p>

          <div className="relative mx-auto mt-7 max-w-2xl">
            <Search
              size={19}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
            />

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={UI[language].searchPlaceholder}
              className="h-13 w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Categories */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold">
            {UI[language].exploreHelp}
          </h2>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {currentCategories.map((category) => {
              const Icon = category.icon;

              return (
                <button
                  key={category.title}
                  className="group flex items-start gap-4 rounded-2xl border border-neutral-200 p-5 text-left transition hover:border-neutral-300 hover:bg-neutral-50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 transition group-hover:bg-white">
                    <Icon size={18} className="text-neutral-600" />
                  </div>

                  <div>
                    <h3 className="text-sm font-medium">
                      {category.title}
                    </h3>

                    <p className="mt-1 text-sm leading-5 text-neutral-500">
                      {category.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <div className="flex items-center gap-2">
            <BookOpen size={18} />
            <h2 className="text-lg font-semibold">
              {UI[language].faqTitle}
            </h2>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-neutral-200">
            {filteredFaqs.length > 0 ? (
              filteredFaqs.map((faq, index) => {
                const isOpen = openFaq === index;

                return (
                  <div
                    key={faq.question}
                    className="border-b border-neutral-200 last:border-b-0"
                  >
                    <button
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-neutral-50"
                      onClick={() =>
                        setOpenFaq(isOpen ? null : index)
                      }
                      aria-expanded={isOpen}
                    >
                      <span className="text-sm font-medium">
                        {faq.question}
                      </span>

                      <ChevronDown
                        size={17}
                        className={`shrink-0 text-neutral-400 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-5">
                        <p className="max-w-3xl text-sm leading-6 text-neutral-500">
                          {faq.answer}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium">
                  {UI[language].noResult}
                </p>

                <p className="mt-1 text-sm text-neutral-500">
                  {UI[language].tryOtherKeywords}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Support */}
        <section className="mt-10 rounded-3xl border border-neutral-200 bg-neutral-50 p-6 text-center sm:p-8">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white">
            <MessageCircle size={18} className="text-neutral-600" />
          </div>

          <h2 className="mt-4 text-lg font-semibold">
            {UI[language].supportQuestion}
          </h2>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-500">
            {UI[language].supportDescription}
          </p>

          <button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800">
            <MessageCircle size={16} />
            {UI[language].contactSupport}
          </button>
        </section>
      </section>
    </main>
  );
}