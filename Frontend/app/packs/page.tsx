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

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";





type OriaLanguage = "fr" | "en";



const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";



const UI = {

  fr: {

    backToChat: "Retour au chat",

    myCredits: "Mes crédits",

    packsOria: "Packs Oria",

    heroTitle: "Choisissez votre accès à l'IA.",

    heroDescription:

      "Chaque pack vous donne un volume de crédits utilisable pendant 35 jours. Les modèles et capacités accessibles dépendent du pack choisi, et chaque action est facturée selon sa consommation réelle.",

    needMoreCredits: "Besoin de crédits supplémentaires ?",

    topUpDescription:

      "Rechargez votre solde sans changer de pack. Les crédits complémentaires sont ajoutés directement à votre portefeuille.",

    startingAt: "À partir de 563 XAF pour 1 000 crédits",

    buyCredits: "Acheter des crédits",

    complementaryCredits: "Crédits complémentaires",

    topUpBalance: "Rechargez votre solde",

    topUpModalDescription:

      "Choisissez une recharge. Vous serez redirigé vers Chariow pour finaliser le paiement avec les moyens disponibles.",

    close: "Fermer",

    credits: "crédits",

    redirecting: "Redirection...",

    buy: "Acheter",

    paymentNotice:

      "Le montant sera débité uniquement après confirmation du paiement. Moov Money et Airtel Money seront connectés à cette étape.",

    howItWorks: "Fonctionnement",

    simpleToUnderstand: "Simple à comprendre",

    choosePack: "Choisissez un pack",

    choosePackDescription:

      "Sélectionnez le niveau de puissance, les capacités et le volume de crédits adaptés à votre utilisation.",

    useOria: "Utilisez Oria",

    useOriaDescription:

      "Utilisez les modèles, la recherche Web, les images, les vidéos et les autres capacités incluses dans votre pack.",

    trackCredits: "Suivez vos crédits",

    trackCreditsDescription:

      "Avant une action, Oria réserve une estimation puis ajuste automatiquement votre solde au coût réel une fois l’action terminée.",

    modelAccess: "Accès aux modèles",

    compareAiLevels: "Comparez les niveaux d'IA",

    model: "Modèle",

    packQuestions: "Questions sur les packs",

    mostChosen: "Le plus choisi",

    pack: "Pack",

    includedCredits: "Crédits inclus",

    models: "Modèles",

    locked: "Verrouillé",

    media: "Médias",

    generationCostNotice:

      "Le coût n’est pas fixe : Oria réserve une estimation avant la génération, puis ne conserve que les crédits correspondant au coût réel.",

    included: "Inclus",

    choose: "Choisir",

  },

  en: {

    backToChat: "Back to chat",

    myCredits: "My credits",

    packsOria: "Oria Packs",

    heroTitle: "Choose your AI access.",

    heroDescription:

      "Each pack gives you a volume of credits usable for 35 days. Available models and capabilities depend on the pack you choose, and each action is charged according to its actual usage.",

    needMoreCredits: "Need additional credits?",

    topUpDescription:

      "Top up your balance without changing your pack. Additional credits are added directly to your wallet.",

    startingAt: "Starting at 563 XAF for 1,000 credits",

    buyCredits: "Buy credits",

    complementaryCredits: "Additional credits",

    topUpBalance: "Top up your balance",

    topUpModalDescription:

      "Choose a top-up. You will be redirected to Chariow to complete payment with the available payment methods.",

    close: "Close",

    credits: "credits",

    redirecting: "Redirecting...",

    buy: "Buy",

    paymentNotice:

      "The amount will only be charged after payment confirmation. Moov Money and Airtel Money will be connected at this step.",

    howItWorks: "How it works",

    simpleToUnderstand: "Simple to understand",

    choosePack: "Choose a pack",

    choosePackDescription:

      "Select the level of capability, features, and credit volume that fits your usage.",

    useOria: "Use Oria",

    useOriaDescription:

      "Use the models, Web Search, images, videos, and other capabilities included in your pack.",

    trackCredits: "Track your credits",

    trackCreditsDescription:

      "Before an action, Oria reserves an estimate and then automatically adjusts your balance to the actual cost once the action is complete.",

    modelAccess: "Model access",

    compareAiLevels: "Compare AI levels",

    model: "Model",

    packQuestions: "Questions about packs",

    mostChosen: "Most chosen",

    pack: "Pack",

    includedCredits: "Included credits",

    models: "Models",

    locked: "Locked",

    media: "Media",

    generationCostNotice:

      "The cost is not fixed: Oria reserves an estimate before generation, then keeps only the credits matching the actual cost.",

    included: "Included",

    choose: "Choose",

  },

} as const;



function getInitialOriaLanguage(): OriaLanguage {

  if (typeof window === "undefined") return "fr";



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



function localizePaymentError(

  message: string,

  language: OriaLanguage,

): string {

  if (language === "fr") return message;



  const translations: Record<string, string> = {

    "Impossible d'initialiser le paiement.":

      "Unable to initialize payment.",

    "Chariow n'a fourni aucune URL de paiement.":

      "Chariow did not provide a payment URL.",

  };



  return translations[message] ?? message;

}



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
    model: string;
    configuration: string;
  }[];

};



type CreditTopUp = {

  id: string;

  credits: number;

  price: string;

  description: string;

};





const PACK_TEXT_EN: Record<
  Pack["id"],
  {
    name: string;
    description: string;
    features: string[];
  }
> = {
  light_pack: {
    name: "Light",
    description: "Essential access to Oria for everyday AI use.",
    features: [
      "GPT-6 Luna",
      "Web Search with GPT-6 Luna",
      "GPT Image 2 creation",
      "Short Sora 2 videos",
      "File and image analysis",
    ],
  },
  intermediate_pack: {
    name: "Intermediate",
    description: "A more versatile tier with GPT-5 and broader creative capabilities.",
    features: [
      "Everything in the Light pack",
      "GPT-5",
      "Web Search with GPT-5",
      "GPT Image 2 creation",
      "Sora 2 video creation",
      "Advanced file and image analysis",
    ],
  },
  pro_pack: {
    name: "Pro",
    description: "For intensive users who need advanced reasoning and professional creative tools.",
    features: [
      "GPT-6 Luna",
      "GPT-5.6 Terra",
      "GPT-6 Sol",
      "Advanced Web Search",
      "GPT Image 2.5 Flare",
      "Professional Sora 2 videos",
      "Advanced creative capabilities",
    ],
  },
  business_pack: {
    name: "Business",
    description: "Oria's premium tier for demanding AI, image, and video workloads.",
    features: [
      "GPT-5.6 Terra",
      "GPT-6 Sol",
      "GPT-6 Astra",
      "Web Search with Terra, Sol and Astra",
      "GPT Image 2.5 Sunburst",
      "Sora 2 Pro",
      "Long-form Business video capabilities",
      "Premium AI capabilities",
    ],
  },
};


const MEDIA_NAME_EN: Record<string, string> = {
  "Image Essentielle": "Essential Image",
  "Image Plus": "Image Plus",
  "Image Pro": "Pro Image",
  "Image Pro HD": "Pro HD Image",
  "Image Pro Ultra": "Pro Ultra Image",
  "Image Business": "Business Image",
  "Image Business HD": "Business HD Image",
  "Image Business Max": "Business Max Image",
  "Vidéo 4 s": "Video 4s",
  "Vidéo 8 s": "Video 8s",
  "Vidéo Lite": "Lite Video",
  "Vidéo Pro Fast": "Pro Fast Video",
  "Vidéo Pro Standard": "Pro Standard Video",
  "Vidéo Pro Extension": "Pro Extension Video",
  "Vidéo Business Fast": "Business Fast Video",
  "Vidéo Business Standard": "Business Standard Video",
  "Vidéo Business Long": "Business Long Video",
};


function localizePack(

  pack: Pack,

  language: OriaLanguage,

): Pack {

  if (language === "fr") return pack;



  const localized = PACK_TEXT_EN[pack.id];



  return {

    ...pack,

    name: localized.name,

    duration: pack.duration.replace("jours", "days"),

    description: localized.description,

    features: localized.features,

    media: pack.media.map((media) => ({
      ...media,
      name: MEDIA_NAME_EN[media.name] ?? media.name,
    })),

  };

}



function getTopUpDescription(

  credits: number,

  language: OriaLanguage,

): string {

  const formatted = credits.toLocaleString(

    language === "en" ? "en-US" : "fr-FR",

  );



  return language === "en"

    ? `${formatted} additional credits`

    : `${formatted} crédits supplémentaires`;

}



const FAQS_EN = [
  {
    question: "How long are my credits valid?",
    answer:
      "Credits remain valid for the duration of your pack. All Oria packs are currently configured for 35 days.",
  },
  {
    question: "What happens when my pack expires?",
    answer:
      "The wallet linked to the pack becomes inactive on its expiration date. Remaining credits can no longer be used from that expired wallet.",
  },
  {
    question: "How many credits are included in each pack?",
    answer:
      "Light includes 20,000 credits, Intermediate 36,000, Pro 48,000, and Business 160,000.",
  },
  {
    question: "Do all actions consume the same number of credits?",
    answer:
      "No. Oria uses dynamic billing. Before an action, an estimate is reserved. After the provider returns the real usage, Oria charges the actual cost and returns any unused reserved credits.",
  },
  {
    question: "Can I buy additional credits?",
    answer:
      "Yes. You can buy top-ups of 1,000 credits for 563 XAF, 2,000 credits for 1,000 XAF, 4,000 credits for 2,000 XAF, or 10,000 credits for 5,000 XAF.",
  },
  {
    question: "Which models are included in each pack?",
    answer:
      "Light includes GPT-6 Luna. Intermediate includes GPT-6 Luna and GPT-5. Pro includes GPT-6 Luna, GPT-5.6 Terra and GPT-6 Sol. Business includes GPT-5.6 Terra, GPT-6 Sol and GPT-6 Astra.",
  },
  {
    question: "Are image and video tools available on every pack?",
    answer:
      "Yes, but the available model, quality, duration, and configuration depend on the pack. Images progress from GPT Image 2 to GPT Image 2.5 Flare and Sunburst, while video progresses from Sora 2 to Sora 2 Pro.",
  },
] as const;


/*

 * ============================================================

 * PACKS Oria

 * ============================================================

 *

 * Cette configuration correspond à la logique actuellement

 * définie côté backend.

 *

 * Les crédits et les durées sont :

 *

 * Léger         : 20 000 crédits  / 35 jours

 * Intermédiaire : 36 000 crédits / 35 jours

 * Pro           : 48 000 crédits / 35 jours

 * Business      : 160 000 crédits / 35 jours

 *

 * Les prix correspondent aux prix actuellement définis

 * pour les offres.

 */



const complementaryCredits: CreditTopUp[] = [

  {

    id: "credits_1000_563",

    credits: 1_000,

    price: "563 XAF",

    description: "1 000 crédits supplémentaires",

  },

  {

    id: "credits_2000",

    credits: 2_000,

    price: "1 000 XAF",

    description: "2 000 crédits supplémentaires",

  },

  {

    id: "credits_4000",

    credits: 4_000,

    price: "2 000 XAF",

    description: "4 000 crédits supplémentaires",

  },

  {

    id: "credits_10000",

    credits: 10_000,

    price: "5 000 XAF",

    description: "10 000 crédits supplémentaires",

  },

];



const packs: Pack[] = [
  {
    id: "light_pack",
    name: "Léger",
    price: "4 000 XAF",
    credits: "20 000",
    duration: "35 jours",
    description:
      "L'accès essentiel à Oria pour les usages courants, avec GPT-6 Luna et les créations légères.",
    features: [
      "GPT-6 Luna",
      "Recherche Web avec GPT-6 Luna",
      "GPT Image 2",
      "Vidéos courtes avec Sora 2",
      "Analyse de fichiers et d'images",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: false },
      { name: "GPT-6 Sol", available: false },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Image Essentielle", available: true, model: "GPT Image 2", configuration: "Qualité basse" },
      { name: "Image Plus", available: true, model: "GPT Image 2", configuration: "Qualité moyenne" },
      { name: "Vidéo 4 s", available: true, model: "Sora 2", configuration: "4 secondes · 720p" },
      { name: "Vidéo 8 s", available: true, model: "Sora 2", configuration: "8 secondes · 720p" },
    ],
  },
  {
    id: "intermediate_pack",
    name: "Intermédiaire",
    price: "8 000 XAF",
    credits: "36 000",
    duration: "35 jours",
    description:
      "Un niveau plus polyvalent avec GPT-5 et davantage de capacité pour les usages quotidiens et créatifs.",
    popular: true,
    features: [
      "Tout le pack Léger",
      "GPT-5",
      "Recherche Web avec GPT-5",
      "GPT Image 2",
      "Vidéo Lite avec Sora 2",
      "Analyse avancée de fichiers et d'images",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: true },
      { name: "GPT-5.6 Terra", available: false },
      { name: "GPT-6 Sol", available: false },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Image Essentielle", available: true, model: "GPT Image 2", configuration: "Qualité basse" },
      { name: "Image Plus", available: true, model: "GPT Image 2", configuration: "Qualité moyenne" },
      { name: "Vidéo Lite", available: true, model: "Sora 2", configuration: "4 secondes · 720p" },
    ],
  },
  {
    id: "pro_pack",
    name: "Pro",
    price: "12 000 XAF",
    credits: "48 000",
    duration: "35 jours",
    description:
      "Pour les utilisateurs intensifs qui recherchent davantage de raisonnement, de puissance et de création professionnelle.",
    features: [
      "GPT-6 Luna",
      "GPT-5.6 Terra",
      "GPT-6 Sol",
      "Recherche Web avancée",
      "GPT Image 2.5 Flare",
      "Vidéos Pro avec Sora 2",
      "Capacités créatives avancées",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: true },
      { name: "GPT-6 Sol", available: true },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Image Pro", available: true, model: "GPT Image 2.5 Flare", configuration: "Qualité basse" },
      { name: "Image Pro HD", available: true, model: "GPT Image 2.5 Flare", configuration: "Qualité haute" },
      { name: "Image Pro Ultra", available: true, model: "GPT Image 2.5 Flare", configuration: "Qualité XHigh" },
      { name: "Vidéo Pro Fast", available: true, model: "Sora 2", configuration: "4 secondes · 720p" },
      { name: "Vidéo Pro Standard", available: true, model: "Sora 2", configuration: "8 secondes · 720p" },
      { name: "Vidéo Pro Extension", available: true, model: "Sora 2", configuration: "4 secondes · 720p" },
    ],
  },
  {
    id: "business_pack",
    name: "Business",
    price: "45 000 XAF",
    credits: "160 000",
    duration: "35 jours",
    description:
      "L'offre haut de gamme d'Oria pour les usages IA et créatifs les plus exigeants.",
    features: [
      "GPT-5.6 Terra",
      "GPT-6 Sol",
      "GPT-6 Astra",
      "Recherche Web avec Terra, Sol et Astra",
      "GPT Image 2.5 Sunburst",
      "Sora 2 Pro",
      "Vidéos Business jusqu'à 12 secondes",
      "Capacités IA premium",
    ],
    models: [
      { name: "GPT-6 Luna", available: false },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: true },
      { name: "GPT-6 Sol", available: true },
      { name: "GPT-6 Astra", available: true },
    ],
    media: [
      { name: "Image Business", available: true, model: "GPT Image 2.5 Sunburst", configuration: "Qualité moyenne" },
      { name: "Image Business HD", available: true, model: "GPT Image 2.5 Sunburst", configuration: "Qualité XHigh" },
      { name: "Image Business Max", available: true, model: "GPT Image 2.5 Sunburst", configuration: "Qualité Max" },
      { name: "Vidéo Business Fast", available: true, model: "Sora 2 Pro", configuration: "4 secondes" },
      { name: "Vidéo Business Standard", available: true, model: "Sora 2 Pro", configuration: "8 secondes" },
      { name: "Vidéo Business Long", available: true, model: "Sora 2 Pro", configuration: "12 secondes" },
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
    question: "Combien de temps mes crédits sont-ils valables ?",
    answer:
      "Les crédits sont valables pendant la durée de votre pack. Tous les packs Oria sont actuellement configurés pour une durée de 35 jours.",
  },
  {
    question: "Que se passe-t-il lorsque mon pack expire ?",
    answer:
      "Le portefeuille associé au pack devient inactif à sa date d'expiration. Les crédits restants ne peuvent alors plus être consommés avec ce portefeuille expiré.",
  },
  {
    question: "Combien de crédits contient chaque pack ?",
    answer:
      "Le pack Léger contient 20 000 crédits, l'Intermédiaire 36 000, le Pro 48 000 et le Business 160 000.",
  },
  {
    question: "Toutes les actions consomment-elles le même nombre de crédits ?",
    answer:
      "Non. Oria utilise une facturation dynamique. Une estimation est d'abord réservée, puis le coût réel est calculé après l'action. Les crédits réservés mais non consommés sont automatiquement rendus au portefeuille.",
  },
  {
    question: "Puis-je acheter des crédits supplémentaires ?",
    answer:
      "Oui. Vous pouvez acheter des recharges complémentaires de 1 000 crédits pour 563 XAF, 2 000 crédits pour 1 000 XAF, 4 000 crédits pour 2 000 XAF ou 10 000 crédits pour 5 000 XAF.",
  },
  {
    question: "Quels modèles sont inclus dans chaque pack ?",
    answer:
      "Léger inclut GPT-6 Luna. Intermédiaire inclut GPT-6 Luna et GPT-5. Pro inclut GPT-6 Luna, GPT-5.6 Terra et GPT-6 Sol. Business inclut GPT-5.6 Terra, GPT-6 Sol et GPT-6 Astra.",
  },
  {
    question: "Les images et vidéos sont-elles disponibles sur tous les packs ?",
    answer:
      "Oui, mais le modèle, la qualité, la durée et les configurations disponibles dépendent du pack. Les images évoluent de GPT Image 2 vers GPT Image 2.5 Flare puis Sunburst, tandis que la vidéo évolue de Sora 2 vers Sora 2 Pro.",
  },
];


/*

 * ============================================================

 * PAGE

 * ============================================================

 */



export default function PacksPage() {

  const [language, setLanguage] =

    useState<OriaLanguage>("fr");



  useEffect(() => {

    const syncLanguage = () => {

      setLanguage(getInitialOriaLanguage());

      setOpenFaq(null);

    };



    syncLanguage();



    window.addEventListener("storage", syncLanguage);

    window.addEventListener(

      "oria-language-change",

      syncLanguage,

    );



    return () => {

      window.removeEventListener("storage", syncLanguage);

      window.removeEventListener(

        "oria-language-change",

        syncLanguage,

      );

    };

  }, []);



  const [openFaq, setOpenFaq] =

    useState<number | null>(null);



  const [showCreditTopUp, setShowCreditTopUp] =

    useState(false);

  const [isPaying, setIsPaying] = useState<string | null>(null);



  const displayedPacks = packs.map((pack) =>

    localizePack(pack, language),

  );



  const displayedFaqs =

    language === "en" ? FAQS_EN : faqs;



  async function startPayment(

    target: {

      type: "primary_pack" | "addon";

      id: string;

    },

  ) {

    if (isPaying !== null) {

      return;

    }



    const supabase = createClient();



    const {

      data: { session },

    } = await supabase.auth.getSession();



    if (!session) {

      window.location.href = `/login?redirect=${encodeURIComponent(

        `/packs?checkout=${target.id}`,

      )}`;

      return;

    }



    setIsPaying(target.id);



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

            payment_type: target.type,

            product_id: target.id,

            // Chariow est l'unique passerelle de checkout.

            // Aucun opérateur Mobile Money n'est choisi ici.

            provider: "chariow",

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



      if (typeof destination !== "string" || !destination) {

        throw new Error(

          "Chariow n'a fourni aucune URL de paiement.",

        );

      }



      window.location.href = destination;

    } catch (error) {

      console.error(

        target.type === "addon"

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

    }

  }



  function handlePackSelection(pack: Pack) {

    void startPayment({

      type: "primary_pack",

      id: pack.id,

    });

  }



  function handleCreditTopUp(topUp: CreditTopUp) {

    void startPayment({

      type: "addon",

      id: topUp.id,

    });

  }



  return (

    <>

      <main className="min-h-dvh bg-background text-foreground">

      {/* Header */}



      <header className="border-b border-border">

        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">

          <div className="flex items-center gap-3">

            <Link

              href="/chat"

              aria-label={UI[language].backToChat}

              className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"

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

            href="/credits"

            className="flex items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-sm transition hover:bg-surface-tertiary"

          >

            <CreditCard size={16} />



            <span className="hidden sm:inline">

              {UI[language].myCredits}

            </span>

          </Link>

        </div>

      </header>



      {/* Contenu */}



      <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">

        {/* Hero */}



        <div className="mx-auto max-w-2xl text-center">

          <p className="text-sm font-medium text-muted">

            {UI[language].packsOria}

          </p>



          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">

            {UI[language].heroTitle}

          </h1>



          <p className="mt-4 text-sm leading-6 text-muted sm:text-base">

            {UI[language].heroDescription}

          </p>

        </div>



        {/* Packs */}



        <div className="mt-10 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">

          {displayedPacks.map((pack) => (

            <PackCard

              key={pack.id}

              pack={pack}

              language={language}

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

                  {UI[language].needMoreCredits}

                </h2>

              </div>



              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">

                {UI[language].topUpDescription}

              </p>



              <p className="mt-3 text-sm font-medium">

                {UI[language].startingAt}

              </p>

            </div>



            <button

              type="button"

              onClick={() => setShowCreditTopUp(true)}

              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-85"

            >

              {UI[language].buyCredits}

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

                    {UI[language].complementaryCredits}

                  </p>



                  <h2

                    id="credit-topup-title"

                    className="mt-1 text-2xl font-semibold tracking-tight"

                  >

                    {UI[language].topUpBalance}

                  </h2>



                  <p className="mt-2 text-sm leading-6 text-muted">

                    {UI[language].topUpModalDescription}

                  </p>

                </div>



                <button

                  type="button"

                  onClick={() => setShowCreditTopUp(false)}

                  aria-label={UI[language].close}

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

                        {topUp.credits.toLocaleString(

                          language === "en" ? "en-US" : "fr-FR",

                        )}{" "}

                        {UI[language].credits}

                      </p>



                      <p className="mt-1 text-sm text-muted">

                        {getTopUpDescription(

                          topUp.credits,

                          language,

                        )}

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

                          ? UI[language].redirecting

                          : UI[language].buy}

                      </button>

                    </div>

                  </div>

                ))}

              </div>



              <div className="mt-5 rounded-2xl border border-border bg-surface-secondary p-4">

                <p className="text-xs leading-5 text-muted">

                  {UI[language].paymentNotice}

                </p>

              </div>

            </div>

          </div>

        )}



        {/* Fonctionnement */}



        <section className="mt-12">

          <div className="text-center">

            <p className="text-sm font-medium text-muted">

              {UI[language].howItWorks}

            </p>



            <h2 className="mt-1 text-2xl font-semibold tracking-tight">

              {UI[language].simpleToUnderstand}

            </h2>

          </div>



          <div className="mt-6 grid gap-4 sm:grid-cols-3">

            <Step

              number="01"

              title={UI[language].choosePack}

              description={UI[language].choosePackDescription}

            />



            <Step

              number="02"

              title={UI[language].useOria}

              description={UI[language].useOriaDescription}

            />



            <Step

              number="03"

              title={UI[language].trackCredits}

              description={UI[language].trackCreditsDescription}

            />

          </div>

        </section>



        {/* Comparaison des modèles */}



        <section className="mt-12">

          <div className="text-center">

            <p className="text-sm font-medium text-muted">

              {UI[language].modelAccess}

            </p>



            <h2 className="mt-1 text-2xl font-semibold tracking-tight">

              {UI[language].compareAiLevels}

            </h2>

          </div>



          <div className="mt-6 overflow-hidden rounded-2xl border border-border">

            <div className="overflow-x-auto">

              <table className="w-full min-w-[700px] text-left">

                <thead>

                  <tr className="border-b border-border bg-surface-secondary">

                    <th className="px-5 py-4 text-sm font-medium">

                      {UI[language].model}

                    </th>



                    {displayedPacks.map(

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

                    "GPT-6 Luna",

                    "GPT-5",

                    "GPT-5.6 Terra",

                    "GPT-6 Sol",

                    "GPT-6 Astra",

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

              {UI[language].packQuestions}

            </h2>

          </div>



          <div className="mx-auto mt-5 max-w-3xl overflow-hidden rounded-2xl border border-border">

            {displayedFaqs.map(

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

  language,

  onSelect,

}: {

  pack: Pack;

  language: OriaLanguage;

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

          {UI[language].mostChosen}

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

          {UI[language].pack}

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

          {UI[language].includedCredits}

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

          {UI[language].models}

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

                    {UI[language].locked}

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

          {UI[language].media}

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
                    <>
                      <span
                        className={`mt-0.5 block text-[11px] ${
                          isPopular ? "opacity-60" : "text-muted"
                        }`}
                      >
                        {media.model}
                      </span>
                      <span
                        className={`mt-0.5 block text-[10px] ${
                          isPopular ? "opacity-50" : "text-muted"
                        }`}
                      >
                        {media.configuration}
                      </span>
                    </>
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

          {UI[language].generationCostNotice}

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

          {UI[language].included}

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

        {UI[language].choose} {pack.name}

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