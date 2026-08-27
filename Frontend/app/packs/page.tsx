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
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
type Pack = {
  id:
    | "light_pack"
    | "intermediate_pack"
    | "pro_pack"
    | "business_pack";

  name: string;
  price: string;
  credits: string;
  duration: string;
  description: string;
  popular?: boolean;
  features: string[];

  models: {
    name: string;
    description?: string;
    available: boolean;
  }[];

  media: {
    name: string;
    available: boolean;
    cost: number;
    unit?: string;
  }[];
};

type CreditTopUp = {
  id: string;
  credits: number;
  price: string;
  description: string;
};

/*
 * ============================================================
 * PACKS LBV-CONNECT.IA
 * ============================================================
 *
 * Cette configuration correspond à la logique actuellement
 * définie côté backend.
 *
 * Les crédits et les durées sont :
 *
 * Léger         : 3 000 crédits  / 35 jours
 * Intermédiaire : 28 500 crédits / 35 jours
 * Pro           : 45 000 crédits / 35 jours
 * Business      : 96 000 crédits / 35 jours
 *
 * Les prix correspondent aux prix actuellement définis
 * pour les offres.
 */

const complementaryCredits: CreditTopUp[] = [
  {
    id: "credit_1000",
    credits: 1_000,
    price: "500 XAF",
    description: "1 000 crédits supplémentaires",
  },
  {
    id: "credit_2000",
    credits: 2_000,
    price: "1 000 XAF",
    description: "2 000 crédits supplémentaires",
  },
  {
    id: "credit_4000",
    credits: 4_000,
    price: "2 000 XAF",
    description: "4 000 crédits supplémentaires",
  },
  {
    id: "credit_10000",
    credits: 10_000,
    price: "5 000 XAF",
    description: "10 000 crédits supplémentaires",
  },
];

const packs: Pack[] = [
  {
    id: "light_pack",

    name: "Léger",

    price: "6 500 XAF",

    credits: "3 000",

    duration: "35 jours",

    description:
      "L'accès essentiel à LBV-Connect.ia pour les usages courants.",

    features: [
      "Chat avec Luna",
      "Recherche Web avec Luna",
      "Génération d'images",
      "Génération de vidéos courtes",
      "Analyse de fichiers",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: false,
      },
      {
        name: "GPT-5.6 Terra",
        available: false,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Images 480",
        available: true,
        cost: 50,
        unit: "génération",
      },
      {
        name: "Images 720",
        available: true,
        cost: 75,
        unit: "génération",
      },
      {
        name: "Vidéo 4 s",
        available: true,
        cost: 500,
        unit: "génération",
      },
      {
        name: "Vidéo 8 s",
        available: true,
        cost: 1_000,
        unit: "génération",
      },
    ],
  },

  {
    id: "intermediate_pack",

    name: "Intermédiaire",

    price: "11 500 XAF",

    credits: "28 500",

    duration: "35 jours",

    description:
      "Un niveau supérieur pour accéder à davantage de puissance et de capacités.",

    popular: true,

    features: [
      "Tout le pack Léger",
      "GPT-5.6",
      "Recherche Web avec GPT-5.6",
      "Génération d'images avancée",
      "Veo Lite",
      "Analyse avancée de fichiers",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: false,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Images 480",
        available: true,
        cost: 50,
        unit: "génération",
      },
      {
        name: "Images 720",
        available: true,
        cost: 75,
        unit: "génération",
      },
    ],
  },

  {
    id: "pro_pack",

    name: "Pro",

    price: "17 500 XAF",

    credits: "45 000",

    duration: "35 jours",

    description:
      "Pour les utilisateurs intensifs qui recherchent davantage de puissance, de médias et de possibilités.",

    features: [
      "Tout le pack Intermédiaire",
      "GPT-5.6 Terra",
      "Recherche Web avancée",
      "Images Pro",
      "Vidéos Pro",
      "Extension vidéo",
      "Accès aux capacités créatives avancées",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: true,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Image Pro",
        available: true,
        cost: 100,
        unit: "génération",
      },
      {
        name: "Image Pro Standard",
        available: true,
        cost: 180,
        unit: "génération",
      },
      {
        name: "Image Pro Ultra",
        available: true,
        cost: 270,
        unit: "génération",
      },
      {
        name: "Veo Pro Fast",
        available: true,
        cost: 1_500,
        unit: "génération",
      },
      {
        name: "Veo Pro Standard",
        available: true,
        cost: 3_000,
        unit: "génération",
      },
      {
        name: "Veo Pro Extension",
        available: true,
        cost: 1_500,
        unit: "génération",
      },
    ],
  },

  {
    id: "business_pack",

    name: "Business",

    price: "25 000 XAF",

    credits: "96 000",

    duration: "35 jours",

    description:
      "L'offre la plus complète pour les usages intensifs, professionnels et créatifs.",

    features: [
      "Tout le pack Pro",
      "GPT-5.6 Sol",
      "Recherche Web avec Sol",
      "Images Business",
      "Images HD et Ultra",
      "Vidéos Business",
      "Vidéos longues",
      "Capacités IA avancées",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: true,
      },
      {
        name: "GPT-5.6 Sol",
        available: true,
      },
    ],

    media: [
      {
        name: "Image Business",
        available: true,
        cost: 250,
        unit: "génération",
      },
      {
        name: "Image Business HD",
        available: true,
        cost: 400,
        unit: "génération",
      },
      {
        name: "Image Business Ultra",
        available: true,
        cost: 600,
        unit: "génération",
      },
      {
        name: "Veo Business Fast",
        available: true,
        cost: 2_500,
        unit: "génération",
      },
      {
        name: "Veo Business Standard",
        available: true,
        cost: 5_000,
        unit: "génération",
      },
      {
        name: "Veo Business Long",
        available: true,
        cost: 10_000,
        unit: "génération",
      },
    ],
  },
];

/*
 * ============================================================
 * FAQ
 * ============================================================
 */

const faqs = [
  {
    question:
      "Combien de temps mes crédits sont-ils valables ?",

    answer:
      "Les crédits sont valables pendant la durée de votre pack. Tous les packs LBV-Connect.ia sont actuellement configurés pour une durée de 35 jours.",
  },

  {
    question:
      "Que se passe-t-il lorsque mon pack expire ?",

    answer:
      "Le portefeuille associé au pack devient inactif à sa date d'expiration. Les crédits restants ne peuvent alors plus être consommés avec ce portefeuille.",
  },

  {
    question:
      "Les crédits sont-ils identiques entre les packs ?",

    answer:
      "Non. Chaque pack possède son propre volume de crédits et ses propres capacités. Le pack Léger contient 3 000 crédits, l'Intermédiaire 28 500, le Pro 45 000 et le Business 96 000.",
  },

  {
    question:
      "Toutes les actions consomment-elles le même nombre de crédits ?",

    answer:
      "Non. Le coût dépend du modèle et de l'opération effectuée. Les actions les plus avancées consomment davantage de crédits. Une génération d'image ou de vidéo affiche son coût directement dans le pack concerné.",
  },

  {
    question:
      "Puis-je acheter des crédits supplémentaires ?",

    answer:
      "Oui. Vous pouvez acheter des recharges complémentaires de 1 000 crédits pour 500 XAF, 2 000 crédits pour 1 000 XAF, 4 000 crédits pour 2 000 XAF ou 10 000 crédits pour 5 000 XAF. Le paiement est lancé depuis cette page et confirmé par le système de paiement LBV-Connect.ia.",
  },

  {
    question:
      "Puis-je utiliser plusieurs modèles avec mon pack ?",

    answer:
      "Oui. Les modèles disponibles dépendent du pack. Luna est disponible sur tous les packs, GPT-5.6 à partir de l'Intermédiaire, GPT-5.6 Terra à partir du Pro et GPT-5.6 Sol avec le Business.",
  },

  {
    question:
      "Les vidéos sont-elles disponibles sur tous les packs ?",

    answer:
      "Les capacités vidéo évoluent selon le pack. Le pack Léger propose les vidéos courtes, l'Intermédiaire propose Veo Lite, le Pro propose les capacités vidéo Pro et le Business ajoute les capacités vidéo Business, notamment les vidéos longues.",
  },
];

/*
 * ============================================================
 * PAGE
 * ============================================================
 */

export default function PacksPage() {
  const [openFaq, setOpenFaq] =
    useState<number | null>(null);

  const [showCreditTopUp, setShowCreditTopUp] =
    useState(false);
  const [isPaying, setIsPaying] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<
    "airtel_money" | "moov_money" | null
  >(null);
  const [paymentTarget, setPaymentTarget] = useState<{
    type: "primary_pack" | "addon";
    id: string;
  } | null>(null);
  const router = useRouter();

  function handlePackSelection(pack: Pack) {
    void (async () => {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = `/login?redirect=${encodeURIComponent(
          `/packs?checkout=${pack.id}`,
        )}`;
        return;
      }

      setPaymentTarget({
        type: "primary_pack",
        id: pack.id,
      });
      setSelectedProvider(null);
    })();
  }

  function handleCreditTopUp(topUp: CreditTopUp) {
    void (async () => {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = `/login?redirect=${encodeURIComponent(
          `/packs?checkout=${topUp.id}`,
        )}`;
        return;
      }

      setPaymentTarget({
        type: "addon",
        id: topUp.id,
      });
      setSelectedProvider(null);
    })();
  }

  async function startPayment() {
    if (!paymentTarget || !selectedProvider) {
      return;
    }

    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = `/login?redirect=${encodeURIComponent(
        `/packs?checkout=${paymentTarget.id}`,
      )}`;
      return;
    }

    setIsPaying(paymentTarget.id);

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ??
        "https://lbv-connect-api.onrender.com";

      const response = await fetch(
        `${apiUrl}/payments/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            "user-id": session.user.id,
          },
          body: JSON.stringify({
            payment_type: paymentTarget.type,
            product_id: paymentTarget.id,
            provider: selectedProvider,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : typeof data?.error === "string"
              ? data.error
              : "Impossible d'initialiser le paiement.",
        );
      }

      const destination =
        data?.checkout_url ??
        data?.redirect_url ??
        data?.payment_url;

      if (typeof destination === "string") {
        window.location.href = destination;
        return;
      }

      if (typeof data?.payment_id === "string") {
        router.push(
          `/payments/${encodeURIComponent(data.payment_id)}`,
        );
        return;
      }

      throw new Error(
        "Le serveur n'a fourni aucune destination de paiement.",
      );
    } catch (error) {
      console.error(
        paymentTarget.type === "addon"
          ? "Initialisation recharge échouée :"
          : "Initialisation paiement pack échouée :",
        error,
      );

      window.alert(
        error instanceof Error
          ? error.message
          : "Impossible d'initialiser le paiement.",
      );
    } finally {
      setIsPaying(null);
      setPaymentTarget(null);
      setSelectedProvider(null);
    }
  }


  return (
    <>
      {paymentTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-provider-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted">
                  Paiement
                </p>
                <h2
                  id="payment-provider-title"
                  className="mt-1 text-2xl font-semibold tracking-tight"
                >
                  Choisir le moyen de paiement
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Sélectionnez votre moyen de paiement.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setPaymentTarget(null);
                  setSelectedProvider(null);
                }}
                aria-label="Fermer"
                className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedProvider("airtel_money")
                }
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedProvider === "airtel_money"
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-border-strong"
                }`}
              >
                <span className="block text-sm font-semibold">
                  Airtel Money
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Paiement mobile
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setSelectedProvider("moov_money")
                }
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedProvider === "moov_money"
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-border-strong"
                }`}
              >
                <span className="block text-sm font-semibold">
                  Moov Money
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Paiement mobile
                </span>
              </button>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPaymentTarget(null);
                  setSelectedProvider(null);
                }}
                className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium transition hover:bg-surface-secondary"
              >
                Annuler
              </button>

              <button
                type="button"
                disabled={
                  !selectedProvider ||
                  isPaying !== null
                }
                onClick={() => void startPayment()}
                className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPaying === paymentTarget.id
                  ? "Initialisation..."
                  : "Continuer"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Contenu */}

      <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        {/* Hero */}

        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium text-muted">
            Packs LBV-Connect.ia
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
            Choisissez votre accès à l'IA.
          </h1>

          <p className="mt-4 text-sm leading-6 text-muted sm:text-base">
            Chaque pack vous donne un volume
            de crédits utilisable pendant 35
            jours. Les modèles et capacités
            accessibles dépendent du pack choisi.
          </p>
        </div>

        {/* Packs */}

        <div className="mt-10 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              onSelect={handlePackSelection}
            />
          ))}
        </div>

        {/* Crédits complémentaires */}

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
                Rechargez votre solde sans changer de pack.
                Les crédits complémentaires sont ajoutés
                directement à votre portefeuille.
              </p>

              <p className="mt-3 text-sm font-medium">
                À partir de 500 XAF pour 1 000 crédits
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowCreditTopUp(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-85"
            >
              Acheter des crédits
              <Zap size={16} />
            </button>
          </div>
        </section>

        {/* Modal crédits complémentaires */}

        {showCreditTopUp && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credit-topup-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setShowCreditTopUp(false);
              }
            }}
          >
            <div className="w-full max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-2xl sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted">
                    Crédits complémentaires
                  </p>

                  <h2
                    id="credit-topup-title"
                    className="mt-1 text-2xl font-semibold tracking-tight"
                  >
                    Rechargez votre solde
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-muted">
                    Choisissez une recharge. Le paiement est lancé depuis cette page et confirmé
                    par le système de paiement LBV-Connect.ia.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCreditTopUp(false)}
                  aria-label="Fermer"
                  className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-6 space-y-3">
                {complementaryCredits.map((topUp) => (
                  <div
                    key={topUp.id}
                    className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-secondary p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-lg font-semibold">
                        {topUp.credits.toLocaleString("fr-FR")} crédits
                      </p>

                      <p className="mt-1 text-sm text-muted">
                        {topUp.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                      <span className="text-lg font-semibold">
                        {topUp.price}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCreditTopUp(topUp)}
                        disabled={isPaying !== null}
                        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPaying === topUp.id
                          ? "Paiement..."
                          : "Acheter"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-border bg-surface-secondary p-4">
                <p className="text-xs leading-5 text-muted">
                  Le montant sera débité uniquement après confirmation
                  du paiement. Moov Money et Airtel Money seront
                  connectés à cette étape.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Fonctionnement */}

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
              description="Sélectionnez le niveau de puissance, les capacités et le volume de crédits adaptés à votre utilisation."
            />

            <Step
              number="02"
              title="Utilisez LBV"
              description="Utilisez les modèles, la recherche Web, les images, les vidéos et les autres capacités incluses dans votre pack."
            />

            <Step
              number="03"
              title="Suivez vos crédits"
              description="Votre solde évolue automatiquement après chaque opération et reste consultable depuis votre espace."
            />
          </div>
        </section>

        {/* Comparaison des modèles */}

        <section className="mt-12">
          <div className="text-center">
            <p className="text-sm font-medium text-muted">
              Accès aux modèles
            </p>

            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Comparez les niveaux d'IA
            </h2>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary">
                    <th className="px-5 py-4 text-sm font-medium">
                      Modèle
                    </th>

                    {packs.map(
                      (pack) => (
                        <th
                          key={pack.id}
                          className="px-5 py-4 text-sm font-medium"
                        >
                          {pack.name}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {[
                    "Luna",
                    "GPT-5.6",
                    "GPT-5.6 Terra",
                    "GPT-5.6 Sol",
                  ].map(
                    (modelName) => (
                      <tr
                        key={modelName}
                        className="border-b border-border last:border-b-0"
                      >
                        <td className="px-5 py-4 text-sm font-medium">
                          {modelName}
                        </td>

                        {packs.map(
                          (pack) => {
                            const model =
                              pack.models.find(
                                (
                                  item,
                                ) =>
                                  item.name ===
                                  modelName,
                              );

                            const available =
                              Boolean(
                                model?.available,
                              );

                            return (
                              <td
                                key={
                                  pack.id
                                }
                                className="px-5 py-4"
                              >
                                {available ? (
                                  <Check
                                    size={
                                      17
                                    }
                                    className="text-muted-strong"
                                  />
                                ) : (
                                  <Lock
                                    size={
                                      15
                                    }
                                    className="text-muted"
                                  />
                                )}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
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
            {faqs.map(
              (faq, index) => {
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
                          isOpen
                            ? null
                            : index,
                        )
                      }
                      aria-expanded={
                        isOpen
                      }
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
              },
            )}
          </div>
        </section>
      </section>
    </main>
    </>
  );
}

/*
 * ============================================================
 * PACK CARD
 * ============================================================
 */

function PackCard({
  pack,
  onSelect,
}: {
  pack: Pack;
  onSelect: (pack: Pack) => void;
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
      {/* Badge */}

      {isPopular && (
        <div className="absolute right-5 top-5 rounded-full bg-accent-foreground px-3 py-1 text-[11px] font-semibold text-accent">
          Le plus choisi
        </div>
      )}

      {/* Identité */}

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
          className={`mt-3 min-h-[72px] text-sm leading-6 ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          {pack.description}
        </p>
      </div>

      {/* Prix */}

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

      {/* Séparateur */}

      <div
        className={`my-7 h-px ${
          isPopular
            ? "bg-accent-foreground/10"
            : "bg-border"
        }`}
      />

      {/* Crédits */}

      <div>
        <p
          className={`text-xs font-medium uppercase tracking-wider ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Crédits inclus
        </p>

        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {pack.credits}
        </p>
      </div>

      {/* Modèles */}

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

        <div className="mt-3 space-y-2.5">
          {pack.models.map(
            (model) => (
              <div
                key={model.name}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {model.available ? (
                    <Check
                      size={15}
                      className={
                        isPopular
                          ? "shrink-0 text-accent-foreground"
                          : "shrink-0 text-muted-strong"
                      }
                    />
                  ) : (
                    <Lock
                      size={14}
                      className={
                        isPopular
                          ? "shrink-0 opacity-35"
                          : "shrink-0 text-muted"
                      }
                    />
                  )}

                  <span
                    className={`text-sm ${
                      model.available
                        ? isPopular
                          ? "opacity-90"
                          : "text-muted-strong"
                        : isPopular
                          ? "opacity-35"
                          : "text-muted"
                    }`}
                  >
                    {model.name}
                  </span>
                </div>

                {!model.available && (
                  <span
                    className={`shrink-0 text-[10px] uppercase tracking-wider ${
                      isPopular
                        ? "opacity-35"
                        : "text-muted"
                    }`}
                  >
                    Verrouillé
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {/* Médias */}

      <div className="mt-7">
        <p
          className={`text-xs font-medium uppercase tracking-wider ${
            isPopular
              ? "opacity-60"
              : "text-muted"
          }`}
        >
          Médias
        </p>

        <div className="mt-3 space-y-2.5">
          {pack.media.map(
            (media) => (
              <div
                key={media.name}
                className="flex items-center gap-2"
              >
                {media.available ? (
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

                <div className="min-w-0">
                  <span
                    className={`block text-sm ${
                      media.available
                        ? isPopular
                          ? "opacity-80"
                          : "text-muted-strong"
                        : isPopular
                          ? "opacity-35"
                          : "text-muted"
                    }`}
                  >
                    {media.name}
                  </span>

                  {media.available && (
                    <span
                      className={`mt-0.5 block text-[11px] ${
                        isPopular
                          ? "opacity-60"
                          : "text-muted"
                      }`}
                    >
                      {media.cost.toLocaleString("fr-FR")} crédits
                      {media.unit ? ` / ${media.unit}` : ""}
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        <p
          className={`mt-3 text-[11px] leading-5 ${
            isPopular
              ? "opacity-55"
              : "text-muted"
          }`}
        >
          Le coût affiché correspond à une génération et
          est déduit de votre solde de crédits.
        </p>
      </div>

      {/* Capacités */}

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

      {/* Achat */}

      <button
        type="button"
        onClick={() => onSelect(pack)}
        className={`mt-8 w-full rounded-xl px-4 py-3 text-sm font-medium transition hover:opacity-85 ${
          isPopular
            ? "bg-accent-foreground text-accent"
            : "bg-accent text-accent-foreground"
        }`}
      >
        Choisir {pack.name}
      </button>
    </article>
  );
}

/*
 * ============================================================
 * STEP
 * ============================================================
 */

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