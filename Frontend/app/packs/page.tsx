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



      "Chaque pack contient des crédits valables 35 jours. Le Mini-Studio propose des images, des retouches et des vidéos selon votre pack.",



    launchPromotion: "Promotion de lancement",



    launchOffer: "Prix de lancement",



    launchLimit: "Offre réservée aux 300 premiers clients payants.",



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
      "Le coût dépend de la configuration : consultez le devis en crédits avant chaque création.",
    mediaAvailabilityNotice:
      "Les options de création et les paramètres disponibles dépendent du pack sélectionné.",



    included: "Inclus",



    choose: "Choisir",



  },



  en: {



    backToChat: "Back to chat",



    myCredits: "My credits",



    packsOria: "Oria Packs",



    heroTitle: "Choose your AI access.",



    heroDescription:



      "Each pack includes credits valid for 35 days. Mini-Studio offers pack-dependent image, editing and video tools.",



    launchPromotion: "Launch promotion",



    launchOffer: "Launch price",



    launchLimit: "Offer reserved for the first 300 paying customers.",



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
      "The cost depends on your configuration: check the credit quote before each creation.",
    mediaAvailabilityNotice:
      "Creation options and available settings depend on the selected pack.",



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



  launchPrice: string;



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











const PACK_TEXT_EN: Record<Pack["id"], { name: string; description: string; features: string[] }> = {
  light_pack: {
    name: "Light",
    description: "Essential ORIA access with GPT-6 Luna, 1K image creation, simple photo editing and short video clips.",
    features: [
      "GPT-6 Luna",
      "Web Search with GPT-6 Luna",
      "Google image creation in 1K",
      "Editing with 1 photo",
      "4 or 8-second clips at 720p",
      "File and image analysis",
    ],
  },
  intermediate_pack: {
    name: "Intermediate",
    description: "More flexibility with GPT-5, images up to 2K, and enhanced video tools.",
    features: [
      "All Light-pack features",
      "GPT-5 and Web Search",
      "Google images up to 2K",
      "Editing from one photo",
      "Video clips up to 10 seconds at 720p",
      "Multi-reference and 20-second projects",
      "Advanced file analysis",
    ],
  },
  pro_pack: {
    name: "Pro",
    description: "Advanced reasoning and images up to 4K, with professional creation tools.",
    features: [
      "GPT-6 Luna, GPT-5.6 Terra and GPT-6 Sol",
      "Advanced Web Search",
      "Google images up to 4K",
      "Photo editing and 720p video clips",
      "Up to 6 references",
      "Advanced editing and 40-second projects",
    ],
  },
  business_pack: {
    name: "Business",
    description: "ORIA premium tier: 4K images, high-end Chat models, and extended video projects.",
    features: [
      "GPT-5.6 Terra, GPT-6 Sol and GPT-6 Astra",
      "Premium Web Search",
      "Google images up to 4K",
      "Photo editing and 720p video clips",
      "Up to 10 references",
      "Advanced editing and 120-second projects",
    ],
  },
};

const MEDIA_NAME_EN: Record<string, string> = {
  "Création d’images 1K": "1K image creation",
  "Retouche avec 1 photo": "Editing with 1 photo",
  "Vidéos 4 ou 8 s": "4 or 8-second videos",
  "Images jusqu’à 2K": "Images up to 2K",
  "Retouche photo": "Photo editing",
  "Jusqu’à 3 photos de référence": "Up to 3 reference photos",
  "Clips vidéo 4 à 10 s": "Video clips from 4 to 10 s",
  "Projet vidéo 20 s": "20-second video project",
  "Images jusqu’à 4K": "Images up to 4K",
  "Jusqu’à 6 photos de référence": "Up to 6 reference photos",
  "Retouche avancée": "Advanced editing",
  "Projet vidéo 40 s": "40-second video project",
  "Vidéo : édition avancée": "Video: advanced editing",
  "Jusqu’à 10 photos de référence": "Up to 10 reference photos",
  "Projet vidéo 120 s": "120-second video project",
};

const MEDIA_CONFIG_EN: Record<string, string> = {
  "Texte vers image": "Text to image",
  "1 photo de référence": "1 reference photo",
  "720p · texte ou image vers vidéo": "720p · text or image to video",
  "1K ou 2K": "1K or 2K",
  "Multi-références": "Multi-reference",
  "720p · texte ou photo vers vidéo": "720p · text or photo to video",
  "2 scènes": "2 scenes",
  "1K, 2K ou 4K": "1K, 2K or 4K",
  "Outils avancés": "Advanced tools",
  "Jusqu’à 16 scènes": "Up to 16 scenes",
  "Images de début / fin": "First / last frames",
  "Jusqu’à 32 scènes": "Up to 32 scenes",
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
      configuration: MEDIA_CONFIG_EN[media.configuration] ?? media.configuration,

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
  { question: "How long are my credits valid?", answer: "All packs currently last 35 days." },
  { question: "What happens when my pack expires?", answer: "The linked wallet becomes inactive at expiration, and its remaining credits can no longer be used." },
  { question: "How many credits are included in each pack?", answer: "Light: 15,000; Intermediate: 27,000; Pro: 36,000; Business: 120,000 credits." },
  { question: "Do all actions cost the same number of credits?", answer: "No. Costs vary by model, resolution and duration. Mini-Studio displays a credit quote before each creation." },
  { question: "Can I buy extra credits?", answer: "You can top up your balance: 1,000 credits (563 XAF), 2,000 (1,000 XAF), 4,000 (2,000 XAF), or 10,000 (5,000 XAF)." },
  { question: "Which Chat models are included in each pack?", answer: "Light: GPT-6 Luna; Intermediate: Luna and GPT-5; Pro: Luna, GPT-5.6 Terra and GPT-6 Sol; Business: Terra, Sol and GPT-6 Astra." },
  { question: "What can I create with Mini-Studio on my pack?", answer: "Each pack offers image creation, photo editing and video. Depending on your tier, images reach 1K, 2K or 4K, and video projects can combine multiple clips." },
  { question: "How do I know which settings my pack allows?", answer: "Mini-Studio adapts models, resolutions, durations and editing options to your active pack, and shows the credit quote before confirmation." },
] as const;







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
    launchPrice: "3 000 XAF",
    credits: "15 000",
    duration: "35 jours",
    description: "L’essentiel d’ORIA avec GPT-6 Luna, la création d’images 1K, la retouche simple et des clips vidéo courts.",
    features: [
      "GPT-6 Luna",
      "Recherche Web avec GPT-6 Luna",
      "Images Google en 1K",
      "Retouche avec 1 photo",
      "Clips vidéo de 4 ou 8 s en 720p",
      "Analyse de fichiers et d’images",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: false },
      { name: "GPT-6 Sol", available: false },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Création d’images 1K", available: true, model: "Gemini 3.1 Flash Lite Image", configuration: "Texte vers image" },
      { name: "Retouche avec 1 photo", available: true, model: "Gemini 3.1 Flash Lite Image", configuration: "1 photo de référence" },
      { name: "Vidéos 4 ou 8 s", available: true, model: "Gemini Omni 1.1 Flash", configuration: "720p · texte ou image vers vidéo" },
    ],
  },
  {
    id: "intermediate_pack",
    name: "Intermédiaire",
    price: "8 000 XAF",
    launchPrice: "5 500 XAF",
    credits: "27 000",
    duration: "35 jours",
    description: "Plus de polyvalence avec GPT-5, images jusqu’à 2K et outils vidéo enrichis.",
    popular: true,
    features: [
      "Tout le pack Léger",
      "GPT-5 et recherche Web",
      "Images Google jusqu’à 2K",
      "Retouche à partir d’une photo",
      "Clips vidéo jusqu’à 10 s en 720p",
      "Multi-références et projets 20 s",
      "Analyse avancée des fichiers",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: true },
      { name: "GPT-5.6 Terra", available: false },
      { name: "GPT-6 Sol", available: false },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Images jusqu’à 2K", available: true, model: "Gemini Flash Lite + Nano Banana 2.1", configuration: "1K ou 2K" },
      { name: "Retouche photo", available: true, model: "Gemini Nano Banana 2.1", configuration: "1 photo de référence" },
      { name: "Jusqu’à 3 photos de référence", available: true, model: "Gemini Nano Banana 2.1", configuration: "Multi-références" },
      { name: "Clips vidéo 4 à 10 s", available: true, model: "Gemini Omni 1.1 Flash", configuration: "720p · texte ou photo vers vidéo" },
      { name: "Projet vidéo 20 s", available: true, model: "Montage multi-scènes", configuration: "2 scènes" },
    ],
  },
  {
    id: "pro_pack",
    name: "Pro",
    price: "12 000 XAF",
    launchPrice: "8 000 XAF",
    credits: "36 000",
    duration: "35 jours",
    description: "Raisonnement avancé et images jusqu’à 4K, avec des outils de création professionnelle supplémentaires.",
    features: [
      "GPT-6 Luna, GPT-5.6 Terra et GPT-6 Sol",
      "Recherche Web avancée",
      "Images Google jusqu’à 4K",
      "Retouche photo et clips vidéo 720p",
      "Jusqu’à 6 références",
      "Retouche avancée et projet 40 s",
    ],
    models: [
      { name: "GPT-6 Luna", available: true },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: true },
      { name: "GPT-6 Sol", available: true },
      { name: "GPT-6 Astra", available: false },
    ],
    media: [
      { name: "Images jusqu’à 4K", available: true, model: "Gemini 3 Pro Image", configuration: "1K, 2K ou 4K" },
      { name: "Retouche photo", available: true, model: "Gemini 3 Pro Image", configuration: "1 photo de référence" },
      { name: "Jusqu’à 6 photos de référence", available: true, model: "Gemini Nano Banana / 3 Pro", configuration: "Multi-références" },
      { name: "Retouche avancée", available: true, model: "Gemini 3 Pro Image", configuration: "Outils avancés" },
      { name: "Clips vidéo 4 à 10 s", available: true, model: "Gemini Omni 1.1 Flash", configuration: "720p · texte ou photo vers vidéo" },
      { name: "Projet vidéo 40 s", available: true, model: "Montage et prolongation", configuration: "Jusqu’à 16 scènes" },
      { name: "Vidéo : édition avancée", available: true, model: "Mini-Studio ORIA", configuration: "Images de début / fin" },
    ],
  },
  {
    id: "business_pack",
    name: "Business",
    price: "45 000 XAF",
    launchPrice: "25 000 XAF",
    credits: "120 000",
    duration: "35 jours",
    description: "Le niveau premium d’ORIA : images 4K, modèles Chat haut de gamme et projets vidéo étendus.",
    features: [
      "GPT-5.6 Terra, GPT-6 Sol et GPT-6 Astra",
      "Recherche Web premium",
      "Images Google jusqu’à 4K",
      "Retouche photo et clips vidéo 720p",
      "Jusqu’à 10 références",
      "Retouche avancée et projets 120 s",
    ],
    models: [
      { name: "GPT-6 Luna", available: false },
      { name: "GPT-5", available: false },
      { name: "GPT-5.6 Terra", available: true },
      { name: "GPT-6 Sol", available: true },
      { name: "GPT-6 Astra", available: true },
    ],
    media: [
      { name: "Images jusqu’à 4K", available: true, model: "Gemini 3 Pro Image", configuration: "1K, 2K ou 4K" },
      { name: "Retouche photo", available: true, model: "Gemini 3 Pro Image", configuration: "1 photo de référence" },
      { name: "Jusqu’à 10 photos de référence", available: true, model: "Gemini Nano Banana / 3 Pro", configuration: "Multi-références" },
      { name: "Retouche avancée", available: true, model: "Gemini 3 Pro Image", configuration: "Outils avancés" },
      { name: "Clips vidéo 4 à 10 s", available: true, model: "Gemini Omni 1.1 Flash", configuration: "720p · texte ou photo vers vidéo" },
      { name: "Projet vidéo 120 s", available: true, model: "Montage et prolongation", configuration: "Jusqu’à 32 scènes" },
      { name: "Vidéo : édition avancée", available: true, model: "Mini-Studio ORIA", configuration: "Images de début / fin" },
    ],
  },
];





/*



 * ============================================================



 * FAQ



 * ============================================================



 */







const faqs = [
  { question: "Combien de temps mes crédits sont-ils valables ?", answer: "Les crédits suivent la durée du pack, actuellement de 35 jours." },
  { question: "Que se passe-t-il lorsque mon pack expire ?", answer: "Le portefeuille associé devient inactif à la date d'expiration ; les crédits restants de ce pack ne sont plus consommables." },
  { question: "Combien de crédits contient chaque pack ?", answer: "Léger : 15 000 ; Intermédiaire : 27 000 ; Pro : 36 000 ; Business : 120 000 crédits." },
  { question: "Toutes les actions consomment-elles le même nombre de crédits ?", answer: "Non. Le coût dépend notamment du modèle, de la résolution et de la durée. Le Mini-Studio affiche un devis en crédits avant chaque création." },
  { question: "Puis-je acheter des crédits supplémentaires ?", answer: "Vous pouvez recharger votre solde : 1 000 crédits (563 XAF), 2 000 (1 000 XAF), 4 000 (2 000 XAF) ou 10 000 (5 000 XAF)." },
  { question: "Quels modèles Chat sont inclus dans chaque pack ?", answer: "Léger : GPT-6 Luna ; Intermédiaire : Luna et GPT-5 ; Pro : Luna, GPT-5.6 Terra et GPT-6 Sol ; Business : Terra, Sol et GPT-6 Astra." },
  { question: "Quelles sont les possibilités du Mini-Studio selon mon pack ?", answer: "Chaque pack propose la création d’images, la retouche photo et la vidéo. Selon votre formule, les images atteignent 1K, 2K ou 4K, et les projets vidéo peuvent combiner plusieurs séquences." },
  { question: "Comment connaître les options accessibles avec mon pack ?", answer: "Le Mini-Studio adapte les modèles, résolutions, durées et options de retouche à votre pack actif et affiche le devis avant confirmation." },
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







  const [activePackTab, setActivePackTab] = useState<"primary" | "addon">("primary");



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



          <div className="mt-6 inline-flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface-secondary px-5 py-3 sm:flex-row sm:gap-2">



            <span className="inline-flex items-center gap-2 text-sm font-semibold">



              <Sparkles size={15} />



              {UI[language].launchPromotion}



            </span>



            <span className="text-xs text-muted">



              {UI[language].launchLimit}



            </span>



          </div>



        </div>







        {/* Deux offres commerciales visibles au même niveau */}
        <div className="mt-10 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface-secondary p-1.5" role="tablist" aria-label={language === "fr" ? "Catégories de crédits" : "Credit categories"}>
          <button type="button" role="tab" aria-selected={activePackTab === "primary"} onClick={() => setActivePackTab("primary")}
            className={`rounded-xl px-3 py-3 text-sm font-semibold transition ${activePackTab === "primary" ? "bg-accent text-accent-foreground" : "text-muted-strong hover:bg-surface-tertiary"}`}>
            {UI[language].packsOria}
          </button>
          <button type="button" role="tab" aria-selected={activePackTab === "addon"} onClick={() => setActivePackTab("addon")}
            className={`rounded-xl px-3 py-3 text-sm font-semibold transition ${activePackTab === "addon" ? "bg-accent text-accent-foreground" : "text-muted-strong hover:bg-surface-tertiary"}`}>
            {UI[language].complementaryCredits}
          </button>
        </div>

        {activePackTab === "primary" ? (
          <section className="mt-6" role="tabpanel">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {displayedPacks.map((pack) => (
                <PackCard key={pack.id} pack={pack} language={language} onSelect={handlePackSelection} />
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-border bg-surface-secondary p-5 sm:p-6">
              <div className="flex items-center gap-2 font-semibold"><HelpCircle size={18} />{language === "fr" ? "À savoir avant de créer des vidéos" : "Before creating videos"}</div>
              <p className="mt-2 text-sm leading-6 text-muted">
                {language === "fr"
                  ? "Tous les packs donnent accès aux créations vidéo selon leurs options disponibles. Attention : une vidéo peut consommer une part importante, voire la totalité de vos crédits. Les packs Léger et Intermédiaire sont principalement adaptés aux études, au chat, aux documents et à la productivité. Pour des créations médias régulières, privilégiez Pro (36 000 crédits) ou Business (120 000 crédits). Le coût en crédits est présenté avant confirmation de la génération."
                  : "All packs offer video creation within their available settings. A video can consume a substantial share, or even all, of your credits. Light and Intermediate are mainly suited to studying, chat, documents and productivity. For regular media creation, consider Pro (36,000 credits) or Business (120,000 credits). The credit quote is shown before confirming a generation."}
              </p>
            </div>
          </section>
        ) : (
          <section className="mt-6" role="tabpanel">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">{UI[language].topUpBalance}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{UI[language].topUpDescription}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {complementaryCredits.map((topUp) => (
                <article key={topUp.id} className="flex flex-col rounded-3xl border border-border bg-surface p-6 transition hover:border-border-strong">
                  <Zap size={22} className="text-muted-strong" />
                  <p className="mt-5 text-3xl font-semibold tracking-tight">{topUp.credits.toLocaleString(language === "en" ? "en-US" : "fr-FR")}</p>
                  <p className="mt-1 text-sm text-muted">{UI[language].credits}</p>
                  <p className="mt-6 text-2xl font-semibold">{topUp.price}</p>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted">{getTopUpDescription(topUp.credits, language)}</p>
                  <button type="button" onClick={() => handleCreditTopUp(topUp)} disabled={isPaying !== null}
                    className="mt-7 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50">
                    {isPaying === topUp.id ? UI[language].redirecting : UI[language].buyCredits}
                  </button>
                </article>
              ))}
            </div>
            <p className="mt-5 rounded-2xl border border-border bg-surface-secondary p-4 text-xs leading-5 text-muted">{UI[language].paymentNotice}</p>
          </section>
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



        <p



          className={`text-xs font-semibold uppercase tracking-wider ${



            isPopular ? "opacity-75" : "text-muted-strong"



          }`}



        >



          {UI[language].launchOffer}



        </p>



        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">



          <span



            className={`text-sm line-through ${



              isPopular ? "opacity-55" : "text-muted"



            }`}



          >



            {pack.price}



          </span>



          <span className="text-3xl font-semibold tracking-tight">



            {pack.launchPrice}



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
            {" "}{UI[language].mediaAvailabilityNotice}



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



                {<Check



                  size={16}



                  className={`mt-0.5 shrink-0 ${



                    isPopular



                      ? "text-accent-foreground"



                      : "text-muted-strong"



                  }`}



                />}







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