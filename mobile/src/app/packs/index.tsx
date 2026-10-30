import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";

/**
 * ============================================================
 * TYPES
 * ============================================================
 *
 * Conversion React Native de la page Packs Web.
 *
 * La logique métier et les données du fichier source sont
 * conservées de manière explicite. Les éléments spécifiques
 * au navigateur (Next Link, window.location, table HTML,
 * classes Tailwind) sont remplacés par leurs équivalents
 * React Native / Expo Router.
 */

type PackId =
  | "light_pack"
  | "intermediate_pack"
  | "pro_pack"
  | "business_pack";

type PackModel = {
  name: string;
  description?: string;
  available: boolean;
};

type PackMedia = {
  name: string;
  available: boolean;
  model: string;
  configuration: string;
};

type Pack = {
  id: PackId;
  name: string;
  price: string;
  launchPrice: string;
  credits: string;
  duration: string;
  description: string;
  popular?: boolean;
  features: string[];
  models: PackModel[];
  media: PackMedia[];
};

type CreditTopUp = {
  id: string;
  credits: number;
  price: string;
  description: string;
};

/**
 * ============================================================
 * PACKS Oria
 * ============================================================
 *
 * Cette configuration correspond à la logique actuellement
 * définie côté backend.
 *
 * Les crédits et les durées sont :
 *
 * Léger         : 15 000 crédits / 35 jours
 * Intermédiaire : 27 000 crédits / 35 jours
 * Pro           : 36 000 crédits / 35 jours
 * Business      : 120 000 crédits / 35 jours
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

/**
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


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

type OriaTheme = "light" | "dark";

const OriaThemeContext = React.createContext<OriaTheme>("light");

async function readOriaTheme(): Promise<OriaTheme> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return "light";
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("theme")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return "light";
    }

    return data?.theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function normalizeHexColor(value: string) {
  const color = value.trim();

  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return null;
  }

  if (color.length === 4) {
    return {
      r: parseInt(color[1] + color[1], 16),
      g: parseInt(color[2] + color[2], 16),
      b: parseInt(color[3] + color[3], 16),
    };
  }

  if (color.length === 7 || color.length === 9) {
    return {
      r: parseInt(color.slice(1, 3), 16),
      g: parseInt(color.slice(3, 5), 16),
      b: parseInt(color.slice(5, 7), 16),
    };
  }

  return null;
}

function darkThemeNeutral(
  value: string,
  property:
    | "color"
    | "backgroundColor"
    | "borderColor"
    | "borderTopColor"
    | "borderBottomColor"
    | "borderLeftColor"
    | "borderRightColor",
) {
  const rgb = normalizeHexColor(value);

  if (!rgb) {
    return value;
  }

  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);

  if (max - min > 28) {
    return value;
  }

  const luminance =
    (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;

  if (property === "color") {
    if (luminance >= 0.82) {
      return value;
    }

    if (luminance >= 0.42) {
      return "#b7b7be";
    }

    return "#f3f3f5";
  }

  if (
    property === "borderColor" ||
    property === "borderTopColor" ||
    property === "borderBottomColor" ||
    property === "borderLeftColor" ||
    property === "borderRightColor"
  ) {
    return luminance >= 0.45 ? "#303036" : "#3a3a40";
  }

  if (luminance >= 0.94) {
    return "#101012";
  }

  if (luminance >= 0.78) {
    return "#17171a";
  }

  if (luminance >= 0.45) {
    return "#1d1d21";
  }

  if (luminance <= 0.12) {
    return "#222226";
  }

  return "#18181b";
}

function buildDarkStyleOverride(style: unknown) {
  const flattened = StyleSheet.flatten(style as any);

  if (!flattened) {
    return undefined;
  }

  const override: Record<string, unknown> = {};

  const themeColorProperties = [
    "color",
    "backgroundColor",
    "borderColor",
    "borderTopColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderRightColor",
  ] as const;

  for (const property of themeColorProperties) {
    const value = flattened[property];

    if (typeof value === "string" && value.startsWith("#")) {
      override[property] = darkThemeNeutral(value, property);
    }
  }

  return Object.keys(override).length > 0 ? override : undefined;
}

function getThemedStyles(theme: OriaTheme) {
  if (theme === "light") {
    return baseStyles;
  }

  const themed: Record<string, unknown> = {};

  for (const key of Object.keys(baseStyles)) {
    const style = baseStyles[key as keyof typeof baseStyles];

    themed[key] = [
      style,
      buildDarkStyleOverride(style),
    ];
  }

  return themed as unknown as typeof baseStyles;
}

function useThemedStyles() {
  const theme = React.useContext(OriaThemeContext);

  return useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
}

function useIsDarkTheme() {
  return React.useContext(OriaThemeContext) === "dark";
}

function themedIconColor(value: string, isDark: boolean) {
  return isDark
    ? darkThemeNeutral(value, "color")
    : value;
}


const UI = {
  fr: {
    payment: "Paiement",
    paymentInitFailed: "Impossible d'initialiser le paiement.",
    checkoutUrlMissing: "Chariow n'a fourni aucune URL de paiement.",
    backToChat: "Retour au chat",
    myCredits: "Mes crédits",
    packsOria: "Packs Oria",
    heroTitle: "Choisissez votre accès à l'IA.",
    heroDescription: "Chaque pack donne des crédits valables 35 jours. Le Mini-Studio propose images, retouches et vidéos selon le pack.",
    launchPromotion: "Promotion de lancement",
    launchOffer: "Prix de lancement",
    launchLimit: "Offre réservée aux 300 premiers clients payants.",
    needMoreCredits: "Besoin de crédits supplémentaires ?",
    topUpIntro: "Rechargez votre solde sans changer de pack. Les crédits complémentaires sont ajoutés directement à votre portefeuille.",
    fromPrice: "À partir de 563 XAF pour 1 000 crédits",
    buyCredits: "Acheter des crédits",
    howItWorks: "Fonctionnement",
    simple: "Simple à comprendre",
    step1Title: "Choisissez un pack",
    step1Description: "Sélectionnez le niveau de puissance, les capacités et le volume de crédits adaptés à votre utilisation.",
    step2Title: "Utilisez Oria",
    step2Description: "Utilisez les modèles, la recherche Web, les images, les vidéos et les autres capacités incluses dans votre pack.",
    step3Title: "Suivez vos crédits",
    step3Description: "Avant une action, Oria réserve une estimation puis ajuste automatiquement votre solde au coût réel une fois l’action terminée.",
    modelAccess: "Accès aux modèles",
    compareModels: "Comparez les niveaux d'IA",
    model: "Modèle",
    packQuestions: "Questions sur les packs",
    additionalCredits: "Crédits complémentaires",
    topUpBalance: "Rechargez votre solde",
    topUpModalDescription: "Choisissez une recharge. Vous serez redirigé vers Chariow pour finaliser le paiement avec les moyens disponibles.",
    close: "Fermer",
    credits: "crédits",
    buy: "Acheter",
    paymentNotice: "Le montant sera débité uniquement après confirmation du paiement. Moov Money et Airtel Money seront connectés à cette étape.",
    mostChosen: "Le plus choisi",
    pack: "Pack",
    includedCredits: "Crédits inclus",
    models: "Modèles",
    locked: "Verrouillé",
    media: "Médias",
    generation: "génération",
    mediaCostNote: "Le coût dépend de la configuration : consultez le devis avant la génération.",
    mediaAvailabilityNotice: "Les options de création et les paramètres disponibles dépendent du pack sélectionné.",
    included: "Inclus",
    redirecting: "Redirection...",
    choose: "Choisir",
  },
  en: {
    payment: "Payment",
    paymentInitFailed: "Unable to initialize payment.",
    checkoutUrlMissing: "Chariow did not provide a payment URL.",
    backToChat: "Back to chat",
    myCredits: "My credits",
    packsOria: "Oria Packs",
    heroTitle: "Choose your AI access.",
    heroDescription: "Each pack includes credits valid for 35 days. Mini-Studio offers pack-dependent images, editing and video.",
    launchPromotion: "Launch promotion",
    launchOffer: "Launch price",
    launchLimit: "Offer reserved for the first 300 paying customers.",
    needMoreCredits: "Need additional credits?",
    topUpIntro: "Top up your balance without changing packs. Additional credits are added directly to your wallet.",
    fromPrice: "Starting at 563 XAF for 1,000 credits",
    buyCredits: "Buy credits",
    howItWorks: "How it works",
    simple: "Simple to understand",
    step1Title: "Choose a pack",
    step1Description: "Select the level of capability, features, and credit volume that fits your usage.",
    step2Title: "Use Oria",
    step2Description: "Use the models, Web Search, images, videos and other capabilities included in your pack.",
    step3Title: "Track your credits",
    step3Description: "Before an action, Oria reserves an estimate and then automatically adjusts your balance to the actual cost once the action is complete.",
    modelAccess: "Model access",
    compareModels: "Compare AI levels",
    model: "Model",
    packQuestions: "Questions about packs",
    additionalCredits: "Additional credits",
    topUpBalance: "Top up your balance",
    topUpModalDescription: "Choose a top-up. You will be redirected to Chariow to complete payment using the available methods.",
    close: "Close",
    credits: "credits",
    buy: "Buy",
    paymentNotice: "The amount will only be charged after payment confirmation. Moov Money and Airtel Money will be connected at this stage.",
    mostChosen: "Most chosen",
    pack: "Pack",
    includedCredits: "Credits included",
    models: "Models",
    locked: "Locked",
    media: "Media",
    generation: "generation",
    mediaCostNote: "The cost depends on your configuration: review the quote before generation.",
    mediaAvailabilityNotice: "Creation options and available settings depend on the selected pack.",
    included: "Included",
    redirecting: "Redirecting...",
    choose: "Choose",
  },
} as const;

const PACK_TEXT_EN: Record<PackId, {
  name: string;
  duration: string;
  description: string;
  features: string[];
  mediaNames: string[];
  mediaConfigurations: string[];
}> = {
  light_pack: {
    name: "Light",
    duration: "35 days",
    description: "Essential ORIA access with GPT-6 Luna, 1K image creation, simple photo editing and short video clips.",
    features: [
      "GPT-6 Luna",
      "Web Search with GPT-6 Luna",
      "Google image creation in 1K",
      "Editing with 1 photo",
      "4 or 8-second clips at 720p",
      "File and image analysis",
    ],
    mediaNames: [
      "1K image creation",
      "Editing with 1 photo",
      "4 or 8-second videos",
    ],
    mediaConfigurations: [
      "Text to image",
      "1 reference photo",
      "720p · text or image to video",
    ],
  },
  intermediate_pack: {
    name: "Intermediate",
    duration: "35 days",
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
    mediaNames: [
      "Images up to 2K",
      "Photo editing",
      "Up to 3 reference photos",
      "Video clips from 4 to 10 s",
      "20-second video project",
    ],
    mediaConfigurations: [
      "1K or 2K",
      "1 reference photo",
      "Multi-reference",
      "720p · text or photo to video",
      "2 scenes",
    ],
  },
  pro_pack: {
    name: "Pro",
    duration: "35 days",
    description: "Advanced reasoning and images up to 4K, with professional creation tools.",
    features: [
      "GPT-6 Luna, GPT-5.6 Terra and GPT-6 Sol",
      "Advanced Web Search",
      "Google images up to 4K",
      "Photo editing and 720p video clips",
      "Up to 6 references",
      "Advanced editing and 40-second projects",
    ],
    mediaNames: [
      "Images up to 4K",
      "Photo editing",
      "Up to 6 reference photos",
      "Advanced editing",
      "Video clips from 4 to 10 s",
      "40-second video project",
      "Video: advanced editing",
    ],
    mediaConfigurations: [
      "1K, 2K or 4K",
      "1 reference photo",
      "Multi-reference",
      "Advanced tools",
      "720p · text or photo to video",
      "Up to 16 scenes",
      "First / last frames",
    ],
  },
  business_pack: {
    name: "Business",
    duration: "35 days",
    description: "ORIA premium tier: 4K images, high-end Chat models, and extended video projects.",
    features: [
      "GPT-5.6 Terra, GPT-6 Sol and GPT-6 Astra",
      "Premium Web Search",
      "Google images up to 4K",
      "Photo editing and 720p video clips",
      "Up to 10 references",
      "Advanced editing and 120-second projects",
    ],
    mediaNames: [
      "Images up to 4K",
      "Photo editing",
      "Up to 10 reference photos",
      "Advanced editing",
      "Video clips from 4 to 10 s",
      "120-second video project",
      "Video: advanced editing",
    ],
    mediaConfigurations: [
      "1K, 2K or 4K",
      "1 reference photo",
      "Multi-reference",
      "Advanced tools",
      "720p · text or photo to video",
      "Up to 32 scenes",
      "First / last frames",
    ],
  },
};

const TOP_UP_DESCRIPTION_EN: Record<string, string> = {
  credits_1000_563: "1,000 additional credits",
  credits_2000: "2,000 additional credits",
  credits_4000: "4,000 additional credits",
  credits_10000: "10,000 additional credits",
};

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

async function readOriaLanguage(): Promise<OriaLanguage> {
  try {
    if (Platform.OS === "web") {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY)
          : null;

      if (saved === "fr" || saved === "en") return saved;

      if (
        typeof navigator !== "undefined" &&
        navigator.language.toLowerCase().startsWith("en")
      ) {
        return "en";
      }

      return "fr";
    }

    const saved = await SecureStore.getItemAsync(ORIA_LANGUAGE_STORAGE_KEY);
    return saved === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

function localizePack(pack: Pack, language: OriaLanguage): Pack {
  if (language === "fr") return pack;

  const translated = PACK_TEXT_EN[pack.id];

  return {
    ...pack,
    name: translated.name,
    duration: translated.duration,
    description: translated.description,
    features: translated.features,
    media: pack.media.map((item, index) => ({
      ...item,
      name: translated.mediaNames[index] ?? item.name,
      configuration: translated.mediaConfigurations[index] ?? item.configuration,
    })),
  };
}

function getTopUpDescription(
  topUp: CreditTopUp,
  language: OriaLanguage,
) {
  if (language === "fr") return topUp.description;
  return TOP_UP_DESCRIPTION_EN[topUp.id] ?? topUp.description;
}

/**
 * ============================================================
 * PAGE
 * ============================================================
 */

export default function PacksPage() {
  const insets = useSafeAreaInsets();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [activePackTab, setActivePackTab] = useState<"primary" | "addon">(
    tab === "addon" || tab === "topups" ? "addon" : "primary",
  );
  useFocusEffect(useCallback(() => {
    if (tab === "addon" || tab === "topups") setActivePackTab("addon");
  }, [tab]));
  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const [theme, setTheme] = useState<OriaTheme>("light");
  const isDark = theme === "dark";
  const styles = useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
  const t = UI[language];
  const displayedPacks = packs.map((pack) => localizePack(pack, language));
  const displayedFaqs = language === "en" ? FAQS_EN : faqs;

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void Promise.all([
        readOriaLanguage(),
        readOriaTheme(),
      ]).then(([savedLanguage, savedTheme]) => {
        if (active) {
          setLanguage(savedLanguage);
          setTheme(savedTheme);
          setOpenFaq(null);
        }
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const [
    openFaq,
    setOpenFaq,
  ] = useState<number | null>(null);

  const [
    isPaying,
    setIsPaying,
  ] = useState<string | null>(null);

  /**
   * Initialise un paiement auprès du backend.
   *
   * Le flux reste identique au Web :
   *
   * 1. vérifier la session Supabase ;
   * 2. rediriger vers Login si l'utilisateur n'est pas connecté ;
   * 3. appeler /payments/checkout ;
   * 4. transmettre payment_type ;
   * 5. transmettre product_id ;
   * 6. utiliser Chariow comme provider ;
   * 7. récupérer l'URL de paiement ;
   * 8. ouvrir cette URL dans l'environnement mobile.
   */
  async function startPayment(
    target: {
      type:
        | "primary_pack"
        | "addon";
      id: string;
    },
  ) {
    if (isPaying !== null) {
      return;
    }

    const {
      data: {
        session,
      },
    } =
      await supabase.auth.getSession();

    /**
     * Si aucune session n'est disponible,
     * l'utilisateur doit d'abord se connecter.
     *
     * La version Web conservait l'identifiant
     * du produit dans la query string.
     */
    if (!session) {
      router.push({
        pathname: "/login",
        params: {
          redirect:
            `/packs?checkout=${encodeURIComponent(
              target.id,
            )}`,
        },
      } as any);

      return;
    }

    setIsPaying(
      target.id,
    );

    try {
      const apiUrl =
        process.env
          .EXPO_PUBLIC_API_URL ??
        process.env
          .EXPO_PUBLIC_BACKEND_URL ??
        "https://lbv-connect-api.onrender.com";

      const response =
        await fetch(
          `${apiUrl.replace(
            /\/$/,
            "",
          )}/payments/checkout`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${session.access_token}`,

              "user-id":
                session.user.id,
            },

            body: JSON.stringify({
              payment_type:
                target.type,

              product_id:
                target.id,

              /*
               * Chariow est l'unique passerelle de checkout.
               * Aucun opérateur Mobile Money n'est choisi ici.
               */
              provider: "chariow",
            }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (!response.ok) {
        throw new Error(
          typeof data?.detail ===
            "string"
            ? data.detail
            : typeof data?.error ===
                "string"
              ? data.error
              : t.paymentInitFailed,
        );
      }

      /**
       * Le backend peut renvoyer l'une des trois
       * propriétés prévues par la version Web.
       */
      const destination =
        data?.checkout_url ??
        data?.redirect_url ??
        data?.payment_url;

      if (
        typeof destination !==
          "string" ||
        !destination
      ) {
        throw new Error(
          t.checkoutUrlMissing,
        );
      }

      /**
       * Sur mobile, window.location.href n'existe pas.
       *
       * Linking.openURL ouvre l'URL de checkout
       * dans le navigateur disponible sur l'appareil.
       */
      await Linking.openURL(
        destination,
      );
    } catch (error) {
      console.error(
        target.type ===
          "addon"
          ? "Initialisation recharge échouée :"
          : "Initialisation paiement pack échouée :",
        error,
      );

      Alert.alert(
        t.payment,
        error instanceof Error
          ? error.message
          : t.paymentInitFailed,
      );
    } finally {
      setIsPaying(null);
    }
  }

  /**
   * Sélection d'un pack principal.
   */
  function handlePackSelection(
    pack: Pack,
  ) {
    void startPayment({
      type:
        "primary_pack",
      id: pack.id,
    });
  }

  /**
   * Sélection d'une recharge de crédits.
   */
  function handleCreditTopUp(
    topUp: CreditTopUp,
  ) {
    void startPayment({
      type: "addon",
      id: topUp.id,
    });
  }

  /**
   * Navigation retour vers le chat.
   */
  function handleBackToChat() {
    if (isPaying !== null) {
      return;
    }

    router.replace("/chat" as any);
  }

  /**
   * Navigation vers les crédits.
   */
  function handleCredits() {
    if (isPaying !== null) {
      return;
    }

    router.push("/credits" as any);
  }

  return (
    <OriaThemeContext.Provider value={theme}>
      <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right"]}
    >
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
      />
      <View
        style={styles.container}
      >
        {/* Header */}

        <View
          style={styles.header}
        >
          <View
            style={
              styles.headerLeft
            }
          >
            <Pressable
              onPress={
                handleBackToChat
              }
              accessibilityRole="button"
              accessibilityLabel={t.backToChat}
              style={({ pressed }) => [
                styles.headerIconButton,
                pressed &&
                  styles.pressed,
                isPaying !==
                  null &&
                  styles.disabled,
              ]}
            >
              <Ionicons
                name="arrow-back"
                size={20}
                color={themedIconColor("#52525b", isDark)}
              />
            </Pressable>

            <View
              style={
                styles.brandContainer
              }
            >
              <Ionicons
                name="sparkles"
                size={19}
                color={themedIconColor("#18181b", isDark)}
              />

              <Text
                style={
                  styles.brandText
                }
              >
                Oria
              </Text>
            </View>
          </View>

          <Pressable
            onPress={
              handleCredits
            }
            style={({ pressed }) => [
              styles.creditsButton,
              pressed &&
                styles.pressed,
              isPaying !==
                null &&
                styles.disabled,
            ]}
          >
            <Ionicons
              name="card-outline"
              size={17}
              color={themedIconColor("#52525b", isDark)}
            />

            <Text
              style={
                styles.creditsButtonText
              }
            >
              {t.myCredits}
            </Text>
          </Pressable>
        </View>

        {/* Contenu */}

        <ScrollView
          style={
            styles.scrollView
          }
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 60 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* Hero */}

          <View
            style={styles.hero}
          >
            <Text
              style={
                styles.heroEyebrow
              }
            >
              {t.packsOria}
            </Text>

            <Text
              style={styles.heroTitle}
            >
              {t.heroTitle}
            </Text>

            <Text
              style={
                styles.heroDescription
              }
            >
              {t.heroDescription}
            </Text>

          </View>

          {/* Deux catégories visibles à égalité : abonnements et recharges. */}
          <View style={styles.packTabs} accessibilityRole="tablist">
            <Pressable
              onPress={() => setActivePackTab("primary")}
              accessibilityRole="tab"
              accessibilityState={{ selected: activePackTab === "primary" }}
              style={[styles.packTab, activePackTab === "primary" && styles.packTabActive]}
            >
              <Ionicons name="albums-outline" size={18}
                color={activePackTab === "primary" ? "#ffffff" : themedIconColor("#52525b", isDark)} />
              <Text style={[styles.packTabText, activePackTab === "primary" && styles.packTabTextActive]}>
                {t.packsOria}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActivePackTab("addon")}
              accessibilityRole="tab"
              accessibilityState={{ selected: activePackTab === "addon" }}
              style={[styles.packTab, activePackTab === "addon" && styles.packTabActive]}
            >
              <Ionicons name="flash-outline" size={18}
                color={activePackTab === "addon" ? "#ffffff" : themedIconColor("#52525b", isDark)} />
              <Text style={[styles.packTabText, activePackTab === "addon" && styles.packTabTextActive]}>
                {t.additionalCredits}
              </Text>
            </Pressable>
          </View>

          {activePackTab === "primary" ? (
            <>
            <View
              style={
                styles.launchBanner
              }
            >
              <View
                style={
                  styles.launchBannerTitleRow
                }
              >
                <Ionicons
                  name="sparkles"
                  size={15}
                  color={themedIconColor("#18181b", isDark)}
                />

                <Text
                  style={
                    styles.launchBannerTitle
                  }
                >
                  {t.launchPromotion}
                </Text>
              </View>

              <Text
                style={
                  styles.launchBannerText
                }
              >
                {t.launchLimit}
              </Text>
            </View>
              <View style={styles.packList}>
                {displayedPacks.map((pack) => (
                  <PackCard
                    key={pack.id}
                    pack={pack}
                    onSelect={handlePackSelection}
                    isPaying={isPaying}
                    language={language}
                  />
                ))}
              </View>
              <View style={styles.topUpSection}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="information-circle-outline" size={19} color={themedIconColor("#18181b", isDark)} />
                  <Text style={styles.sectionTitle}>
                    {language === "fr" ? "Créations image et vidéo" : "Image and video creation"}
                  </Text>
                </View>
                <Text style={styles.sectionDescription}>
                  {language === "fr"
                    ? "Tous les packs permettent la création selon leurs options. Les vidéos peuvent consommer beaucoup de crédits : vérifiez le devis avant chaque génération. Pour des créations régulières, privilégiez Pro ou Business."
                    : "All packs support creation within their available options. Videos can use many credits: check the quote before each generation. Pro or Business are recommended for regular creations."}
                </Text>
                <Pressable onPress={() => setActivePackTab("addon")} style={styles.secondaryTabButton}>
                  <Text style={styles.secondaryTabButtonText}>
                    {language === "fr" ? "Voir les crédits complémentaires" : "View additional credits"}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={themedIconColor("#18181b", isDark)} />
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.addonSection}>
              <Text style={styles.addonHeading}>{t.topUpBalance}</Text>
              <Text style={styles.sectionDescription}>{t.topUpIntro}</Text>
              {complementaryCredits.map((topUp) => (
                <View key={topUp.id} style={styles.topUpOption}>
                  <View style={styles.topUpOptionInfo}>
                    <Text style={styles.topUpCredits}>
                      {topUp.credits.toLocaleString(language === "en" ? "en-US" : "fr-FR")} {t.credits}
                    </Text>
                    <Text style={styles.topUpDescription}>{getTopUpDescription(topUp, language)}</Text>
                  </View>
                  <View style={styles.topUpOptionAction}>
                    <Text style={styles.topUpOptionPrice}>{topUp.price}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t.buy} ${topUp.credits} ${t.credits}`}
                      onPress={() => handleCreditTopUp(topUp)}
                      disabled={isPaying !== null}
                      style={({ pressed }) => [styles.smallPrimaryButton, pressed && styles.primaryButtonPressed,
                        isPaying !== null && styles.disabled]}
                    >
                      {isPaying === topUp.id ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.smallPrimaryButtonText}>{t.buy}</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ))}
              <View style={styles.paymentNotice}>
                <Ionicons name="information-circle-outline" size={17} color={themedIconColor("#71717a", isDark)} />
                <Text style={styles.paymentNoticeText}>{t.paymentNotice}</Text>
              </View>
            </View>
          )}

          {activePackTab === "primary" ? (
            <>
          {/* {t.howItWorks} */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.centerHeading
              }
            >
              <Text
                style={
                  styles.sectionEyebrow
                }
              >
                {t.howItWorks}
              </Text>

              <Text
                style={
                  styles.sectionHeading
                }
              >
                {t.simple}
              </Text>
            </View>

            <View
              style={
                styles.stepsList
              }
            >
              <Step
                number="01"
                title={t.step1Title}
                description={t.step1Description}
              />

              <Step
                number="02"
                title={t.step2Title}
                description={t.step2Description}
              />

              <Step
                number="03"
                title={t.step3Title}
                description={t.step3Description}
              />
            </View>
          </View>

          {/* Comparaison des modèles */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.centerHeading
              }
            >
              <Text
                style={
                  styles.sectionEyebrow
                }
              >
                {t.modelAccess}
              </Text>

              <Text
                style={
                  styles.sectionHeading
                }
              >
                {t.compareModels}
              </Text>
            </View>

            <View
              style={
                styles.modelComparisonCard
              }
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={
                  false
              }
              >
                <View
                  style={
                    styles.comparisonTable
                  }
                >
                  {/* Table header */}

                  <View
                    style={[
                      styles.tableRow,
                      styles.tableHeaderRow,
                    ]}
                  >
                    <View
                      style={[
                        styles.modelNameCell,
                        styles.tableHeaderCell,
                      ]}
                    >
                      <Text
                        style={
                          styles.tableHeaderText
                        }
                      >
                        {t.model}
                      </Text>
                    </View>

                    {displayedPacks.map(
                      (pack) => (
                        <View
                          key={
                            pack.id
                          }
                          style={[
                            styles.packTableCell,
                            styles.tableHeaderCell,
                          ]}
                        >
                          <Text
                            style={
                              styles.tableHeaderText
                            }
                          >
                            {pack.name}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>

                  {/* Table rows */}

                  {[
                    "GPT-6 Luna",
                    "GPT-5",
                    "GPT-5.6 Terra",
                    "GPT-6 Sol",
                    "GPT-6 Astra",
                  ].map(
                    (
                      modelName,
                    ) => (
                      <View
                        key={
                          modelName
                        }
                        style={
                          styles.tableRow
                        }
                      >
                        <View
                          style={
                            styles.modelNameCell
                          }
                        >
                          <Text
                            style={
                              styles.modelNameText
                            }
                          >
                            {modelName}
                          </Text>
                        </View>

                        {displayedPacks.map(
                          (
                            pack,
                          ) => {
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
                              <View
                                key={
                                  pack.id
                                }
                                style={
                                  styles.packTableCell
                                }
                              >
                                {available ? (
                                  <Ionicons
                                    name="checkmark"
                                    size={18}
                                    color={themedIconColor("#52525b", isDark)}
                                  />
                                ) : (
                                  <Ionicons
                                    name="lock-closed-outline"
                                    size={16}
                                    color={themedIconColor("#a1a1aa", isDark)}
                                  />
                                )}
                              </View>
                            );
                          },
                        )}
                      </View>
                    ),
                  )}
                </View>
              </ScrollView>
            </View>
          </View>

          {/* FAQ */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.faqHeading
              }
            >
              <Ionicons
                name="help-circle-outline"
                size={19}
                color={themedIconColor("#18181b", isDark)}
              />

              <Text
                style={
                  styles.faqHeadingText
                }
              >
                {t.packQuestions}
              </Text>
            </View>

            <View
              style={
                styles.faqContainer
              }
            >
              {displayedFaqs.map(
                (
                  faq,
                  index,
                ) => {
                  const isOpen =
                    openFaq ===
                    index;

                  return (
                    <View
                      key={
                        faq.question
                      }
                      style={[
                        styles.faqItem,
                        index ===
                          displayedFaqs.length -
                            1 &&
                          styles.faqItemLast,
                      ]}
                    >
                      <Pressable
                        onPress={() =>
                          setOpenFaq(
                            isOpen
                              ? null
                              : index,
                          )
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          expanded:
                            isOpen,
                        }}
                        style={({ pressed }) => [
                          styles.faqQuestionButton,
                          pressed &&
                            styles.faqPressed,
                        ]}
                      >
                        <Text
                          style={
                            styles.faqQuestion
                          }
                        >
                          {
                            faq.question
                          }
                        </Text>

                        <Ionicons
                          name={
                            isOpen
                              ? "chevron-up"
                              : "chevron-down"
                          }
                          size={18}
                          color={themedIconColor("#71717a", isDark)}
                        />
                      </Pressable>

                      {isOpen ? (
                        <View
                          style={
                            styles.faqAnswerContainer
                          }
                        >
                          <Text
                            style={
                              styles.faqAnswer
                            }
                          >
                            {
                              faq.answer
                            }
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                },
              )}
            </View>
          </View>
            </>
          ) : null}
        </ScrollView>
      </View>

    </SafeAreaView>
    </OriaThemeContext.Provider>
  );
}

/**
 * ============================================================
 * PACK CARD
 * ============================================================
 *
 * Carte détaillée d'un pack.
 *
 * La structure Web est conservée :
 * - badge "{t.mostChosen}" ;
 * - identité du pack ;
 * - prix ;
 * - durée ;
 * - crédits inclus ;
 * - modèles ;
 * - médias ;
 * - coûts des médias ;
 * - capacités incluses ;
 * - bouton d'achat.
 */

function PackCard({
  pack,
  onSelect,
  isPaying,
  language,
}: {
  pack: Pack;
  onSelect: (
    pack: Pack,
  ) => void;
  isPaying: string | null;
  language: OriaLanguage;
}) {
  const t = UI[language];
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();
  const isPopular =
    Boolean(pack.popular);

  const isCurrentPackPaying =
    isPaying === pack.id;

  return (
    <View
      style={[
        styles.packCard,
        isPopular &&
          styles.packCardPopular,
      ]}
    >
      {/* Badge */}

      {isPopular ? (
        <View
          style={
            styles.popularBadge
          }
        >
          <Text
            style={
              styles.popularBadgeText
            }
          >
            {t.mostChosen}
          </Text>
        </View>
      ) : null}

      {/* Identité */}

      <View>
        <Text
          style={[
            styles.packEyebrow,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {t.pack}
        </Text>

        <Text
          style={
            styles.packName
          }
        >
          {pack.name}
        </Text>

        <Text
          style={[
            styles.packDescription,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {pack.description}
        </Text>
      </View>

      {/* Prix */}

      <View
        style={
          styles.priceBlock
        }
      >
        <Text
          style={[
            styles.launchPriceLabel,
            isPopular &&
              styles.popularLaunchPriceLabel,
          ]}
        >
          {t.launchOffer}
        </Text>

        <View
          style={
            styles.launchPriceRow
          }
        >
          <Text
            style={[
              styles.originalPrice,
              isPopular &&
                styles.popularOriginalPrice,
            ]}
          >
            {pack.price}
          </Text>

          <Text
            style={[
              styles.packPrice,
              isPopular &&
                styles.popularPackPrice,
            ]}
          >
            {pack.launchPrice}
          </Text>
        </View>

        <View
          style={
            styles.durationRow
          }
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={
              isPopular
                ? "#ffffff"
                : themedIconColor("#71717a", isDark)
            }
          />

          <Text
            style={[
              styles.durationText,
              isPopular &&
                styles.popularMutedText,
            ]}
          >
            {pack.duration}
          </Text>
        </View>
      </View>

      {/* Séparateur */}

      <View
        style={[
          styles.cardDivider,
          isPopular &&
            styles.popularDivider,
        ]}
      />

      {/* Crédits */}

      <View>
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {t.includedCredits}
        </Text>

        <Text
          style={
            styles.creditsAmount
          }
        >
          {pack.credits}
        </Text>
      </View>

      {/* {t.model}s */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {t.model}s
        </Text>

        <View
          style={
            styles.listBlock
          }
        >
          {pack.models.map(
            (model) => (
              <View
                key={
                  model.name
                }
                style={
                  styles.listRow
                }
              >
                <View
                  style={
                    styles.listRowLeft
                  }
                >
                  {model.available ? (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={
                        isPopular
                          ? "#ffffff"
                          : themedIconColor("#52525b", isDark)
                      }
                    />
                  ) : (
                    <Ionicons
                      name="lock-closed-outline"
                      size={15}
                      color={
                        isPopular
                          ? "#ffffff"
                          : themedIconColor("#a1a1aa", isDark)
                      }
                    />
                  )}

                  <Text
                    style={[
                      styles.modelText,
                      model.available
                        ? styles.availableText
                        : styles.lockedText,
                      isPopular &&
                        styles.popularModelText,
                    ]}
                  >
                    {
                      model.name
                    }
                  </Text>
                </View>

                {!model.available ? (
                  <Text
                    style={[
                      styles.lockedLabel,
                      isPopular &&
                        styles.popularLockedLabel,
                    ]}
                  >
                    {t.locked}
                  </Text>
                ) : null}
              </View>
            ),
          )}
        </View>
      </View>

      {/* {t.media} */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {t.media}
        </Text>

        <View
          style={
            styles.listBlock
          }
        >
          {pack.media.map(
            (media) => (
              <View
                key={
                  media.name
                }
                style={
                  styles.mediaRow
                }
              >
                {media.available ? (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={
                      isPopular
                        ? "#ffffff"
                        : "#52525b"
                    }
                  />
                ) : (
                  <Ionicons
                    name="lock-closed-outline"
                    size={15}
                    color={
                      isPopular
                        ? "#ffffff"
                        : "#a1a1aa"
                    }
                  />
                )}

                <View
                  style={
                    styles.mediaInfo
                  }
                >
                  <Text
                    style={[
                      styles.mediaName,
                      media.available
                        ? styles.availableText
                        : styles.lockedText,
                      isPopular &&
                        styles.popularMediaText,
                    ]}
                  >
                    {
                      media.name
                    }
                  </Text>

                  {media.available ? (
                    <>
                      <Text
                        style={[
                          styles.mediaCost,
                          isPopular &&
                            styles.popularMutedText,
                        ]}
                      >
                        {media.model}
                      </Text>
                      <Text
                        style={[
                          styles.mediaCost,
                          isPopular &&
                            styles.popularMutedText,
                        ]}
                      >
                        {media.configuration}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
            ),
          )}
        </View>

        <Text
          style={[
            styles.mediaFootnote,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
{t.mediaCostNote}{"\n"}{t.mediaAvailabilityNotice}
        </Text>
      </View>

      {/* Capacités */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {t.included}
        </Text>

        <View
          style={
            styles.featuresList
          }
        >
          {pack.features.map(
            (feature) => (
              <View
                key={
                  feature
                }
                style={
                  styles.featureRow
                }
              >
                <Ionicons
                  name="checkmark"
                  size={17}
                  color={
                    isPopular
                      ? "#ffffff"
                      : themedIconColor("#52525b", isDark)
                  }
                  style={
                    styles.featureIcon
                  }
                />

                <Text
                  style={[
                    styles.featureText,
                    isPopular &&
                      styles.popularFeatureText,
                  ]}
                >
                  {feature}
                </Text>
              </View>
            ),
          )}
        </View>
      </View>

      {/* Achat */}

      <Pressable
        onPress={() =>
          onSelect(pack)
        }
        disabled={
          isPaying !== null
        }
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.packPurchaseButton,
          isPopular &&
            styles.packPurchaseButtonPopular,
          pressed &&
            styles.purchasePressed,
          isPaying !== null &&
            styles.disabled,
        ]}
      >
        {isCurrentPackPaying ? (
          <View
            style={
              styles.purchaseLoading
            }
          >
            <ActivityIndicator
              size="small"
              color={
                isPopular
                  ? "#111111"
                  : "#ffffff"
              }
            />

            <Text
              style={[
                styles.purchaseText,
                isPopular &&
                  styles.purchaseTextPopular,
              ]}
            >
              {t.redirecting}
            </Text>
          </View>
        ) : (
          <Text
            style={[
              styles.purchaseText,
              isPopular &&
                styles.purchaseTextPopular,
            ]}
          >
            {t.choose} {pack.name}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * ============================================================
 * STEP
 * ============================================================
 *
 * Étape du bloc "{t.simple}".
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
  const styles = useThemedStyles();

  return (
    <View
      style={
        styles.stepCard
      }
    >
      <Text
        style={
          styles.stepNumber
        }
      >
        {number}
      </Text>

      <Text
        style={
          styles.stepTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.stepDescription
        }
      >
        {description}
      </Text>
    </View>
  );
}

/**
 * ============================================================
 * STYLES
 * ============================================================
 *
 * Le Web original utilisait des classes Tailwind.
 * React Native ne rend pas ces classes directement.
 *
 * Le StyleSheet ci-dessous transpose donc explicitement
 * l'organisation visuelle de la page :
 *
 * - header ;
 * - hero ;
 * - cartes de packs ;
 * - pack populaire ;
 * - recharge ;
 * - étapes ;
 * - comparaison ;
 * - FAQ ;
 * - modal ;
 * - états de paiement.
 *
 * Les styles sont volontairement détaillés et non compactés.
 */

const baseStyles = StyleSheet.create({
  packTabs: {
    flexDirection: "row",
    gap: 6,
    padding: 5,
    marginBottom: 18,
    marginTop: 19,
    borderWidth: 1,
    borderRadius: 16,
    borderColor: "#e4e4e7",
    backgroundColor: "#f4f4f5",
  },
  packTab: {
    flex: 1,
    minHeight: 58,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  packTabActive: { backgroundColor: "#111111" },
  packTabText: {
    flexShrink: 1,
    color: "#52525b",
    textAlign: "center",
    fontWeight: "700",
    fontSize: 12,
  },
  packTabTextActive: { color: "#ffffff" },
  secondaryTabButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d4d4d8",
    backgroundColor: "#ffffff",
  },
  secondaryTabButtonText: {
    fontSize: 12, fontWeight: "700", color: "#18181b",
  },
  addonSection: { gap: 13 },
  addonHeading: { fontSize: 22, fontWeight: "700", color: "#18181b" },
  safeArea: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  container: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  header: {
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  brandText: {
    color: "#18181b",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  creditsButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  creditsButtonText: {
    color: "#3f3f46",
    fontSize: 13,
    fontWeight: "500",
  },

  scrollView: {
    flex: 1,
  },

  content: {
    width: "100%",
    maxWidth: 1240,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 34,
    paddingBottom: 60,
  },

  hero: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 720,
    alignItems: "center",
    marginBottom: 32,
  },

  heroEyebrow: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "600",
  },

  heroTitle: {
    marginTop: 7,
    color: "#18181b",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
    textAlign: "center",
  },

  heroDescription: {
    marginTop: 14,
    color: "#71717a",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },

  launchBanner: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 16,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },

  launchBannerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  launchBannerTitle: {
    color: "#18181b",
    fontSize: 13,
    fontWeight: "700",
  },

  launchBannerText: {
    color: "#71717a",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },

  packList: {
    width: "100%",
    gap: 14,
  },

  packCard: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 24,
    backgroundColor: "#ffffff",
    paddingHorizontal: 21,
    paddingVertical: 22,
  },

  packCardPopular: {
    borderColor: "#111111",
    backgroundColor: "#111111",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 7,
    },
    elevation: 4,
  },

  popularBadge: {
    position: "absolute",
    top: 18,
    right: 18,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    paddingHorizontal: 11,
    paddingVertical: 5,
  },

  popularBadgeText: {
    color: "#111111",
    fontSize: 10,
    fontWeight: "700",
  },

  packEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  popularMutedText: {
    color: "#ffffff",
    opacity: 0.62,
  },

  packName: {
    marginTop: 3,
    color: "#18181b",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
  },

  packDescription: {
    marginTop: 12,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
    minHeight: 60,
  },

  priceBlock: {
    marginTop: 23,
  },

  launchPriceLabel: {
    color: "#52525b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  popularLaunchPriceLabel: {
    color: "#ffffff",
    opacity: 0.75,
  },

  launchPriceRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  },

  originalPrice: {
    color: "#71717a",
    fontSize: 14,
    textDecorationLine: "line-through",
  },

  popularOriginalPrice: {
    color: "#ffffff",
    opacity: 0.55,
  },

  packPrice: {
    color: "#18181b",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  popularPackPrice: {
    color: "#ffffff",
  },

  durationRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  durationText: {
    color: "#71717a",
    fontSize: 13,
  },

  cardDivider: {
    height: 1,
    backgroundColor: "#e4e4e7",
    marginVertical: 22,
  },

  popularDivider: {
    backgroundColor: "#ffffff",
    opacity: 0.12,
  },

  subsectionLabel: {
    color: "#71717a",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },

  creditsAmount: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  cardSection: {
    marginTop: 23,
  },

  listBlock: {
    marginTop: 11,
    gap: 10,
  },

  listRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  listRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  modelText: {
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },

  availableText: {
    color: "#52525b",
  },

  lockedText: {
    color: "#a1a1aa",
  },

  popularModelText: {
    color: "#ffffff",
  },

  lockedLabel: {
    color: "#a1a1aa",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  popularLockedLabel: {
    color: "#ffffff",
    opacity: 0.35,
  },

  mediaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  mediaInfo: {
    flex: 1,
    minWidth: 0,
  },

  mediaName: {
    fontSize: 13,
    lineHeight: 18,
  },

  popularMediaText: {
    color: "#ffffff",
  },

  mediaCost: {
    marginTop: 2,
    color: "#71717a",
    fontSize: 10,
    lineHeight: 15,
  },

  mediaFootnote: {
    marginTop: 10,
    color: "#71717a",
    fontSize: 10,
    lineHeight: 16,
  },

  featuresList: {
    marginTop: 11,
    gap: 9,
  },

  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },

  featureIcon: {
    marginTop: 1,
  },

  featureText: {
    flex: 1,
    color: "#52525b",
    fontSize: 13,
    lineHeight: 19,
  },

  popularFeatureText: {
    color: "#ffffff",
    opacity: 0.82,
  },

  packPurchaseButton: {
    minHeight: 49,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 25,
    paddingHorizontal: 15,
  },

  packPurchaseButtonPopular: {
    backgroundColor: "#ffffff",
  },

  purchasePressed: {
    opacity: 0.82,
  },

  purchaseLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  purchaseText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  purchaseTextPopular: {
    color: "#111111",
  },

  topUpSection: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 24,
    backgroundColor: "#f4f4f5",
    padding: 21,
    gap: 20,
  },

  topUpTextArea: {
    flex: 1,
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  sectionTitle: {
    flex: 1,
    color: "#18181b",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
  },

  sectionDescription: {
    marginTop: 8,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  topUpPriceText: {
    marginTop: 10,
    color: "#3f3f46",
    fontSize: 13,
    fontWeight: "600",
  },

  primaryButton: {
    minHeight: 47,
    borderRadius: 12,
    backgroundColor: "#111111",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  primaryButtonPressed: {
    opacity: 0.82,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  contentSection: {
    marginTop: 42,
  },

  centerHeading: {
    alignItems: "center",
  },

  sectionEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  sectionHeading: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.3,
    textAlign: "center",
  },

  stepsList: {
    marginTop: 18,
    gap: 12,
  },

  stepCard: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    backgroundColor: "#f4f4f5",
    padding: 18,
  },

  stepNumber: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
  },

  stepTitle: {
    marginTop: 13,
    color: "#18181b",
    fontSize: 14,
    fontWeight: "700",
  },

  stepDescription: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modelComparisonCard: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },

  comparisonTable: {
    minWidth: 720,
  },

  tableRow: {
    minHeight: 57,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },

  tableHeaderRow: {
    backgroundColor: "#f4f4f5",
  },

  tableHeaderCell: {
    justifyContent: "center",
  },

  tableHeaderText: {
    color: "#3f3f46",
    fontSize: 12,
    fontWeight: "600",
  },

  modelNameCell: {
    width: 170,
    paddingHorizontal: 17,
    justifyContent: "center",
  },

  modelNameText: {
    color: "#18181b",
    fontSize: 13,
    fontWeight: "600",
  },

  packTableCell: {
    width: 137,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  faqHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  faqHeadingText: {
    color: "#18181b",
    fontSize: 17,
    fontWeight: "700",
  },

  faqContainer: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },

  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },

  faqItemLast: {
    borderBottomWidth: 0,
  },

  faqQuestionButton: {
    minHeight: 57,
    paddingHorizontal: 17,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  faqPressed: {
    backgroundColor: "#f4f4f5",
  },

  faqQuestion: {
    flex: 1,
    color: "#27272a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  faqAnswerContainer: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 17,
    paddingBottom: 17,
  },

  faqAnswer: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },

  modalBackdrop: {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "rgba(0, 0, 0, 0.50)",
  },

  topUpModal: {
    maxHeight: "88%",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 25,
  },

  modalHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d4d4d8",
    marginBottom: 17,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 15,
  },

  modalHeaderTextArea: {
    flex: 1,
  },

  modalEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  modalTitle: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.4,
  },

  modalDescription: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },

  topUpOptionsScroll: {
    marginTop: 18,
  },

  topUpOptions: {
    gap: 10,
    paddingBottom: 3,
  },

  topUpOption: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 17,
    backgroundColor: "#f4f4f5",
    padding: 15,
    gap: 13,
  },

  topUpOptionInfo: {
    flex: 1,
  },

  topUpCredits: {
    color: "#18181b",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },

  topUpDescription: {
    marginTop: 3,
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
  },

  topUpOptionAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 13,
  },

  topUpOptionPrice: {
    color: "#18181b",
    fontSize: 17,
    fontWeight: "700",
  },

  smallPrimaryButton: {
    minHeight: 42,
    minWidth: 91,
    borderRadius: 11,
    backgroundColor: "#111111",
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  smallPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  paymentNotice: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 15,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  paymentNoticeText: {
    flex: 1,
    color: "#71717a",
    fontSize: 11,
    lineHeight: 17,
  },

  pressed: {
    opacity: 0.72,
  },

  disabled: {
    opacity: 0.5,
  },
});