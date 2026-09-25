import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";
import { File as ExpoFile } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { Ionicons } from "@expo/vector-icons";

/**
 * ORIA MOBILE — CHAT
 *
 * Port React Native / Expo du Chat Web fourni.
 *
 * Backend conservé :
 *   https://lbv-connect-api.onrender.com
 *
 * Contrats conservés :
 *   GET  /credits/me
 *   GET  /ai/trials
 *   GET  /conversations
 *   POST /conversations
 *   GET  /conversations/:id/messages
 *   POST /conversations/:id/messages
 *   GET  /media
 *   GET  /ai/media-capabilities
 *   POST /ai/image
 *   POST /ai/video
 *   POST /ai/chat/stream
 *
 * Le cache utilise localStorage sur Web et SecureStore sur Android/iOS.
 */

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const CHAT_TEXT = {
  fr: {
    newConversation: "Nouvelle conversation",
    copyMessage: "Copier le message",
    copied: "Copié",
    copy: "Copier",
    trial: "Essai",
    higherModelTrial: "Modèle supérieur · 5 essais maximum",
    image: "Image",
    file: "Fichier",
    open: "Ouvrir",
    model: "Modèle",
    noModel: "Aucun modèle disponible avec ce pack.",
    welcomeHeading: "Comment puis-je\nvous aider ?",
    welcomeDescription:
      "Discutez avec les modèles disponibles et utilisez la recherche Web directement depuis votre espace.",
    webSearchEnabled: "Recherche Web activée",
    webSearchNext: "Active pour les prochains messages.",
    mediaCreation: "Création média",
    mediaCreationDescription:
      "Choisissez Image ou Vidéo, puis la configuration.",
    creationLocked: "Création verrouillée",
    creationLockedDescription:
      "Activez un pack pour générer des images ou des vidéos.",
    generateImage: "Générer une image",
    generateVideo: "Générer une vidéo",
    configuration: "configuration",
    configurations: "configurations",
    generationConfiguration: "Configuration de génération",
    credits: "crédits",
    videoPrompt: "Décrivez précisément la vidéo à créer...",
    imagePrompt: "Décrivez précisément l'image à créer...",
    cost: "Réservation estimée",
    backendValidation: "Oria réserve une estimation, puis facture uniquement le coût réel de la génération.",
    generating: "Génération...",
    generateTheVideo: "Générer la vidéo",
    generateTheImage: "Générer l'image",
    creationPrompt: "Décrivez votre création...",
    messagePrompt: "Écrivez à Oria...",
    camera: "Caméra",
    webSearch: "Recherche Web",
    creation: "Création",
    attachmentDisclaimer:
      "Jusqu'à {max} fichiers ou images peuvent être joints. Les créations image et vidéo dépendent du pack actif.",
    history: "Historique",
    loading: "Chargement...",
    noConversation: "Aucune conversation pour le moment.",
    availableCredits: "Crédits disponibles",
    daysRemaining: "{days} jours restants",
    durationUnavailable: "Durée indisponible",
    myCredits: "Mes crédits",
    myCreations: "Mes créations",
    settings: "Paramètres",
    logout: "Déconnexion",
    permissionRequired: "Permission requise",
    cameraPermission:
      "Autorisez l'accès à la caméra pour prendre une photo.",
    photosPermission:
      "Autorisez l'accès aux photos pour joindre une image.",
    maxAttachments:
      "Vous pouvez joindre au maximum {max} éléments par message.",
    unsupportedFile: "Format de fichier non pris en charge.",
    activePackRequired:
      "La création d'images et de vidéos nécessite un pack actif.",
    noCreationOption: "Aucune option de création n'est disponible.",
    creationOptionMissing: "Cette option de création n'existe pas.",
    mediaGenerationFailed: "La génération du média a échoué.",
    mediaUrlMissing:
      "Le serveur a généré le média mais n'a retourné aucune URL exploitable.",
    mediaIdMissing:
      "Le serveur a généré le média mais n'a retourné aucun identifiant.",
    mediaCreationFailed: "La création média a échoué.",
    freeTrialsExhausted: "Les essais gratuits de ce modèle sont épuisés.",
    localConversationPending:
      "Conversation créée localement. Synchronisation cloud en attente.",
    localMessagesRemain: "Les messages locaux restent affichés.",
    cloudMessagesFailed: "Impossible de charger les messages cloud.",
    localDataRemain: "Les données locales restent disponibles.",
    serverUnavailableLocal:
      "Serveur indisponible. Les données locales restent disponibles.",
    localConversationRetry:
      "Conversation sauvegardée localement. La synchronisation cloud sera réessayée.",
    aiStreamingError: "Erreur pendant le streaming IA.",
    noAiContent: "Le service IA n'a retourné aucun contenu.",
    cannotContactOria: "Impossible de contacter Oria.",
    errorPrefix: "Erreur",
    attachmentsSummary: "Pièces jointes",
    mediaPromptPrefix: "Création",
    generated: "générée",
    video: "Vidéo",
    seconds: "secondes",
    modelDescriptions: {
      luna: "Modèle économique · Rapide pour les échanges courants",
      "gpt-5": "Modèle polyvalent · Pour les tâches plus avancées",
      "gpt-5.6-terra": "Raisonnement avancé · Pour les problèmes complexes",
      "gpt-6-sol": "Puissance avancée · Pour les tâches les plus exigeantes",
      "gpt-6-astra": "Modèle haut de gamme · Pour les usages les plus avancés",
    },
    mediaDescriptions: {
      image_480: "Génération image légère",
      image_720: "Génération image légère",
      image_pro: "Génération image professionnelle",
      image_pro_standard: "Qualité professionnelle standard",
      image_pro_ultra: "Qualité professionnelle maximale",
      image_business: "Génération business",
      image_business_hd: "Génération business haute définition",
      image_business_ultra: "Génération business maximale",
      video_4s: "Génération vidéo légère",
      video_8s: "Génération vidéo légère",
      video_lite: "Génération vidéo intermédiaire",
      video_pro_fast: "Génération vidéo professionnelle rapide",
      video_pro_standard: "Génération vidéo professionnelle standard",
      video_pro_extension: "Extension d'une génération vidéo Pro",
      video_business_fast: "Génération vidéo business rapide",
      video_business_standard: "Génération vidéo business standard",
      video_business_long: "Génération vidéo business longue",
    },
  },
  en: {
    newConversation: "New conversation",
    copyMessage: "Copy message",
    copied: "Copied",
    copy: "Copy",
    trial: "Trial",
    higherModelTrial: "Higher-tier model · 5 trials maximum",
    image: "Image",
    file: "File",
    open: "Open",
    model: "Model",
    noModel: "No model available with this pack.",
    welcomeHeading: "How can I\nhelp you?",
    welcomeDescription:
      "Chat with the available models and use Web Search directly from your workspace.",
    webSearchEnabled: "Web Search enabled",
    webSearchNext: "Active for upcoming messages.",
    mediaCreation: "Media creation",
    mediaCreationDescription:
      "Choose Image or Video, then select the configuration.",
    creationLocked: "Creation locked",
    creationLockedDescription:
      "Activate a pack to generate images or videos.",
    generateImage: "Generate an image",
    generateVideo: "Generate a video",
    configuration: "configuration",
    configurations: "configurations",
    generationConfiguration: "Generation configuration",
    credits: "credits",
    videoPrompt: "Describe the video you want to create...",
    imagePrompt: "Describe the image you want to create...",
    cost: "Estimated reservation",
    backendValidation: "Oria reserves an estimate, then charges only the actual generation cost.",
    generating: "Generating...",
    generateTheVideo: "Generate video",
    generateTheImage: "Generate image",
    creationPrompt: "Describe your creation...",
    messagePrompt: "Message Oria...",
    camera: "Camera",
    webSearch: "Web Search",
    creation: "Creation",
    attachmentDisclaimer:
      "Up to {max} files or images can be attached. Image and video creation depends on the active pack.",
    history: "History",
    loading: "Loading...",
    noConversation: "No conversations yet.",
    availableCredits: "Available credits",
    daysRemaining: "{days} days remaining",
    durationUnavailable: "Duration unavailable",
    myCredits: "My credits",
    myCreations: "My creations",
    settings: "Settings",
    logout: "Sign out",
    permissionRequired: "Permission required",
    cameraPermission:
      "Allow camera access to take a photo.",
    photosPermission:
      "Allow photo access to attach an image.",
    maxAttachments:
      "You can attach up to {max} items per message.",
    unsupportedFile: "Unsupported file format.",
    activePackRequired:
      "Image and video creation requires an active pack.",
    noCreationOption: "No creation option is available.",
    creationOptionMissing: "This creation option does not exist.",
    mediaGenerationFailed: "Media generation failed.",
    mediaUrlMissing:
      "The server generated the media but did not return a usable URL.",
    mediaIdMissing:
      "The server generated the media but did not return an ID.",
    mediaCreationFailed: "Media creation failed.",
    freeTrialsExhausted: "The free trials for this model have been used up.",
    localConversationPending:
      "Conversation created locally. Cloud sync is pending.",
    localMessagesRemain: "Local messages remain displayed.",
    cloudMessagesFailed: "Unable to load cloud messages.",
    localDataRemain: "Local data remains available.",
    serverUnavailableLocal:
      "Server unavailable. Local data remains available.",
    localConversationRetry:
      "Conversation saved locally. Cloud sync will be retried.",
    aiStreamingError: "Error while streaming the AI response.",
    noAiContent: "The AI service returned no content.",
    cannotContactOria: "Unable to contact Oria.",
    errorPrefix: "Error",
    attachmentsSummary: "Attachments",
    mediaPromptPrefix: "Creation",
    generated: "generated",
    video: "Video",
    seconds: "seconds",
    modelDescriptions: {
      luna: "Economical model · Fast for everyday conversations",
      "gpt-5": "Versatile model · For more advanced tasks",
      "gpt-5.6-terra": "Advanced reasoning · For complex problems",
      "gpt-6-sol": "Advanced capability · For the most demanding tasks",
      "gpt-6-astra": "High-end model · For the most advanced use cases",
    },
    mediaDescriptions: {
      image_480: "Lightweight image generation",
      image_720: "Lightweight image generation",
      image_pro: "Professional image generation",
      image_pro_standard: "Standard professional quality",
      image_pro_ultra: "Maximum professional quality",
      image_business: "Business image generation",
      image_business_hd: "High-definition business generation",
      image_business_ultra: "Maximum business generation",
      video_4s: "Lightweight video generation",
      video_8s: "Lightweight video generation",
      video_lite: "Intermediate video generation",
      video_pro_fast: "Fast professional video generation",
      video_pro_standard: "Standard professional video generation",
      video_pro_extension: "Extend a Pro video generation",
      video_business_fast: "Fast business video generation",
      video_business_standard: "Standard business video generation",
      video_business_long: "Long business video generation",
    },
  },
} as const;

async function readOriaLanguage(): Promise<OriaLanguage> {
  try {
    if (Platform.OS === "web") {
      const saved = getWebStorage()?.getItem(ORIA_LANGUAGE_STORAGE_KEY);
      if (saved === "fr" || saved === "en") return saved;

      if (
        typeof navigator !== "undefined" &&
        navigator.language.toLowerCase().startsWith("en")
      ) {
        return "en";
      }

      return "fr";
    }

    const saved = await SecureStore.getItemAsync(
      ORIA_LANGUAGE_STORAGE_KEY,
    );

    return saved === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

function interpolate(
  value: string,
  variables: Record<string, string | number>,
) {
  return Object.entries(variables).reduce(
    (result, [key, replacement]) =>
      result.replace(`{${key}}`, String(replacement)),
    value,
  );
}

function getDisplayConversationTitle(
  title: string,
  language: OriaLanguage,
) {
  return title === "Nouvelle conversation"
    ? CHAT_TEXT[language].newConversation
    : title;
}

function getModelDescription(
  model: ModelDefinition,
  language: OriaLanguage,
) {
  return (
    CHAT_TEXT[language].modelDescriptions[
      model.id as keyof typeof CHAT_TEXT.fr.modelDescriptions
    ] ?? model.description
  );
}

function getMediaDescription(
  action: string,
  fallback: string,
  language: OriaLanguage,
) {
  return (
    CHAT_TEXT[language].mediaDescriptions[
      action as keyof typeof CHAT_TEXT.fr.mediaDescriptions
    ] ?? fallback
  );
}

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type WalletData = {
  balance: number;
  initial_credits: number;
  pack_id: string | null;
  pack_activated_at: string | null;
  pack_expires_at: string | null;
};

type TrialInfo = {
  used: number;
  max: number;
  remaining: number;
};

type TrialResponse = {
  success: boolean;
  pack_id: string | null;
  trials: Record<string, TrialInfo>;
};

type MediaCapability = {
  action: string;
  type: "image" | "video";
  estimated_credits?: number | null;
  credits?: number | null; // compatibilité temporaire avec l'ancien format API
  model?: string | null;
  quality?: string | null;
  seconds?: number | string | null;
  size?: string | null;
};

type MediaCapabilitiesResponse = {
  success: boolean;
  pack_id?: string | null;
  images?: string[];
  videos?: string[];
  media?: Array<string | MediaCapability>;
};

type GeneratedMedia = {
  id: string;
  user_id?: string;
  conversation_id?: string | null;
  prompt?: string | null;
  created_at?: string | null;
  media_type?: "image" | "video";
  type: "image" | "video";
  mimeType: string;
  url: string;
  action: string;
  model: string;
  cost: number;
  creditsRemaining: number;
  seconds?: string | null;
  size?: string | null;
};

type ChatAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  size?: number;
};

type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  packs: string[];
};

const MAX_ATTACHMENTS = 3;

const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MEDIA_GENERATION_CONFIGS = [
  {
    action: "image_480",
    type: "image",
    label: "Image Essentielle",
    description: "Génération rapide avec GPT Image 2",
    configuration: "Qualité basse",
    packs: ["light_pack", "intermediate_pack"],
    model: "GPT Image 2",
  },
  {
    action: "image_720",
    type: "image",
    label: "Image Plus",
    description: "Génération équilibrée avec GPT Image 2",
    configuration: "Qualité moyenne",
    packs: ["light_pack", "intermediate_pack"],
    model: "GPT Image 2",
  },
  {
    action: "image_pro",
    type: "image",
    label: "Image Pro",
    description: "Génération professionnelle avec GPT Image 2.5 Flare",
    configuration: "Qualité basse",
    packs: ["pro_pack"],
    model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_pro_standard",
    type: "image",
    label: "Image Pro HD",
    description: "Rendu professionnel détaillé",
    configuration: "Qualité haute",
    packs: ["pro_pack"],
    model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_pro_ultra",
    type: "image",
    label: "Image Pro Ultra",
    description: "Rendu professionnel très haute qualité",
    configuration: "Qualité XHigh",
    packs: ["pro_pack"],
    model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_business",
    type: "image",
    label: "Image Business",
    description: "Création premium avec GPT Image 2.5 Sunburst",
    configuration: "Qualité moyenne",
    packs: ["business_pack"],
    model: "GPT Image 2.5 Sunburst",
  },
  {
    action: "image_business_hd",
    type: "image",
    label: "Image Business HD",
    description: "Création premium haute définition",
    configuration: "Qualité XHigh",
    packs: ["business_pack"],
    model: "GPT Image 2.5 Sunburst",
  },
  {
    action: "image_business_ultra",
    type: "image",
    label: "Image Business Max",
    description: "Qualité maximale pour les créations exigeantes",
    configuration: "Qualité Max",
    packs: ["business_pack"],
    model: "GPT Image 2.5 Sunburst",
  },
  {
    action: "video_4s",
    type: "video",
    label: "Vidéo 4 s",
    description: "Génération vidéo OpenAI courte",
    configuration: "4 secondes · 720p",
    packs: ["light_pack"],
    model: "Sora 2",
  },
  {
    action: "video_8s",
    type: "video",
    label: "Vidéo 8 s",
    description: "Génération vidéo OpenAI étendue",
    configuration: "8 secondes · 720p",
    packs: ["light_pack"],
    model: "Sora 2",
  },
  {
    action: "video_lite",
    type: "video",
    label: "Vidéo Lite",
    description: "Génération vidéo intermédiaire",
    configuration: "4 secondes · 720p",
    packs: ["intermediate_pack"],
    model: "Sora 2",
  },
  {
    action: "video_pro_fast",
    type: "video",
    label: "Vidéo Pro Fast",
    description: "Génération professionnelle rapide",
    configuration: "4 secondes · 720p",
    packs: ["pro_pack"],
    model: "Sora 2",
  },
  {
    action: "video_pro_standard",
    type: "video",
    label: "Vidéo Pro Standard",
    description: "Génération professionnelle standard",
    configuration: "8 secondes · 720p",
    packs: ["pro_pack"],
    model: "Sora 2",
  },
  {
    action: "video_pro_extension",
    type: "video",
    label: "Vidéo Pro Extension",
    description: "Extension d'une génération Pro",
    configuration: "4 secondes · 720p",
    packs: ["pro_pack"],
    model: "Sora 2",
  },
  {
    action: "video_business_fast",
    type: "video",
    label: "Vidéo Business Fast",
    description: "Génération premium rapide",
    configuration: "4 secondes",
    packs: ["business_pack"],
    model: "Sora 2 Pro",
  },
  {
    action: "video_business_standard",
    type: "video",
    label: "Vidéo Business Standard",
    description: "Génération premium standard",
    configuration: "8 secondes",
    packs: ["business_pack"],
    model: "Sora 2 Pro",
  },
  {
    action: "video_business_long",
    type: "video",
    label: "Vidéo Business Long",
    description: "Génération premium longue",
    configuration: "12 secondes",
    packs: ["business_pack"],
    model: "Sora 2 Pro",
  },
] as const;

const models: ModelDefinition[] = [
  {
    id: "luna",
    name: "GPT-6 Luna",
    description: "Modèle économique · Rapide pour les échanges courants",
    packs: ["light_pack", "intermediate_pack", "pro_pack"],
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    description: "Modèle polyvalent · Pour les tâches plus avancées",
    packs: ["intermediate_pack"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Raisonnement avancé · Pour les problèmes complexes",
    packs: ["pro_pack", "business_pack"],
  },
  {
    id: "gpt-6-sol",
    name: "GPT-6 Sol",
    description: "Puissance avancée · Pour les tâches les plus exigeantes",
    packs: ["pro_pack", "business_pack"],
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    description: "Modèle haut de gamme · Pour les usages les plus avancés",
    packs: ["business_pack"],
  },
];

const TRIAL_MODEL_BY_PACK: Record<string, string> = {
  light_pack: "gpt-5",
  intermediate_pack: "gpt-5.6-terra",
  pro_pack: "gpt-6-astra",
};

const ORIA_MEDIA_MARKER_REGEX = /\[\[ORIA_MEDIA_ID:([^\]]+)\]\]/;

function buildMediaMessageContent(
  type: "image" | "video",
  action: string,
  mediaId: string,
) {
  return `${type === "image" ? "Image" : "Vidéo"} générée · ${action}\n[[ORIA_MEDIA_ID:${mediaId}]]`;
}

function getVisibleMessageContent(content: string) {
  return content
    .replace(/\s*\[\[ORIA_MEDIA_ID:[^\]]+\]\]\s*$/g, "")
    .trimEnd();
}

function extractMediaIdFromMessage(content: string) {
  return content.match(ORIA_MEDIA_MARKER_REGEX)?.[1] ?? null;
}

function getMediaGenerationConfig(action: string) {
  return MEDIA_GENERATION_CONFIGS.find((item) => item.action === action);
}

function getLocalMediaCapabilities(packId: string | null): MediaCapability[] {
  if (!packId) return [];

  return MEDIA_GENERATION_CONFIGS
    .filter((item) => (item.packs as readonly string[]).includes(packId))
    .map((item) => ({
      action: item.action,
      type: item.type,
      model: item.model,
    }));
}

function normalizeMediaCapability(
  item: string | MediaCapability,
): MediaCapability | null {
  if (typeof item === "string") {
    const config = getMediaGenerationConfig(item);
    return config
      ? {
          action: config.action,
          type: config.type,
          model: config.model,
        }
      : null;
  }

  if (!item?.action) return null;

  const config = getMediaGenerationConfig(item.action);
  if (!config && item.type !== "image" && item.type !== "video") {
    return null;
  }

  return {
    ...item,
    type: item.type ?? config!.type,
    model: item.model ?? config?.model ?? null,
  };
}

function getAvailableModels(packId: string | null) {
  if (!packId) return [];
  return models.filter((model) => model.packs.includes(packId));
}

function getSelectableModels(
  packId: string | null,
  trials: Record<string, TrialInfo>,
) {
  const normalModels = getAvailableModels(packId);
  if (!packId) return [];

  const selectable = [...normalModels];
  const normalIds = new Set(normalModels.map((model) => model.id));
  const trialModelId = TRIAL_MODEL_BY_PACK[packId];

  if (trialModelId && !normalIds.has(trialModelId)) {
    const trialModel = models.find((model) => model.id === trialModelId);
    const trial = trials[trialModelId];
    if (trialModel && trial) selectable.push(trialModel);
  }

  return selectable;
}

function uid() {
  // React Native/Expo supports crypto.randomUUID on modern runtimes.
  // Fallback avoids depending on browser-only APIs.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCredits(
  value: number,
  language: OriaLanguage = "fr",
) {
  return value.toLocaleString(
    language === "en" ? "en-US" : "fr-FR",
  );
}

async function getSessionOrThrow() {
  if (!supabase) {
    throw new Error(
      "Supabase n'est pas configuré. Ajoutez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  if (!session?.user?.id || !session.access_token) {
    throw new Error("Utilisateur non authentifié.");
  }

  return session;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const session = await getSessionOrThrow();

  const headers = new Headers(options.headers);
  headers.set("user-id", session.user.id);
  headers.set("authorization", `Bearer ${session.access_token}`);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);

    if (response.status === 401) {
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }

    throw new Error(
      error?.detail || "Une erreur est survenue avec le serveur.",
    );
  }

  return response.json();
}

async function apiMediaFetch<T>(
  path: string,
  payload: {
    action: string;
    prompt: string;
    conversation_id?: string | null;
  },
) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function apiStreamFetch(
  path: string,
  formData: FormData,
): Promise<Response> {
  const session = await getSessionOrThrow();

  /*
   * IMPORTANT MOBILE:
   * Expo's native/WinterCG fetch expects real Blob/File objects for
   * multipart parts. A React-Native `{ uri, type, name }` object can
   * trigger: "Unsupported FormDataPart implementation".
   *
   * The files appended below are therefore Expo File instances.
   */
  const response = await expoFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "user-id": session.user.id,
      authorization: `Bearer ${session.access_token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);

    if (response.status === 401) {
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }

    throw new Error(
      error?.detail || "Une erreur est survenue avec le serveur.",
    );
  }

  if (!response.body) {
    throw new Error("Le serveur n'a pas fourni de flux de réponse.");
  }

  return response;
}

type LocalChatCache = {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
  selectedModel: string;
  activeCapability: string | null;
  savedAt: string;
};

const LOCAL_CACHE_PREFIX = "oria_chat_cache_v1";

function cacheKey(userId: string) {
  return `${LOCAL_CACHE_PREFIX}_${userId}`;
}

function getWebStorage() {
  if (Platform.OS !== "web") return null;

  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}

async function readLocalCache(userId: string): Promise<LocalChatCache | null> {
  try {
    const key = cacheKey(userId);

    const raw =
      Platform.OS === "web"
        ? getWebStorage()?.getItem(key) ?? null
        : await SecureStore.getItemAsync(key);

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    return {
      conversations: Array.isArray(parsed?.conversations)
        ? parsed.conversations
        : [],
      messages:
        parsed?.messages && typeof parsed.messages === "object"
          ? parsed.messages
          : {},
      activeConversationId:
        typeof parsed?.activeConversationId === "string"
          ? parsed.activeConversationId
          : null,
      selectedModel:
        typeof parsed?.selectedModel === "string"
          ? parsed.selectedModel
          : "luna",
      activeCapability:
        typeof parsed?.activeCapability === "string"
          ? parsed.activeCapability
          : null,
      savedAt:
        typeof parsed?.savedAt === "string"
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.error("Erreur lecture cache Oria :", error);
    return null;
  }
}

async function writeLocalCache(
  userId: string,
  cache: Omit<LocalChatCache, "savedAt">,
) {
  try {
    const payload: LocalChatCache = {
      ...cache,
      savedAt: new Date().toISOString(),
    };

    const key = cacheKey(userId);
    const serialized = JSON.stringify(payload);

    if (Platform.OS === "web") {
      getWebStorage()?.setItem(key, serialized);
    } else {
      await SecureStore.setItemAsync(key, serialized);
    }
  } catch (error) {
    console.error("Erreur sauvegarde cache Oria :", error);
  }
}

async function removeLocalCache(userId: string) {
  try {
    const key = cacheKey(userId);

    if (Platform.OS === "web") {
      getWebStorage()?.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  } catch (error) {
    console.error("Erreur suppression cache Oria :", error);
  }
}

async function createConversationRemote(title: string): Promise<Conversation> {
  const data = await apiFetch<
    Conversation | { conversation: Conversation }
  >("/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  if ("conversation" in data && data.conversation) {
    return data.conversation;
  }

  return data as Conversation;
}

async function saveMessageRemote(
  message: ChatMessage,
): Promise<ChatMessage | null> {
  const data = await apiFetch<
    ChatMessage | { message: ChatMessage }
  >(`/conversations/${message.conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: message.role,
      content: message.content,
    }),
  });

  if ("message" in data && data.message) {
    return data.message;
  }

  return data as ChatMessage;
}


function readBalancedGroup(source: string, start: number) {
  if (source[start] !== "{") return null;

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: source.slice(start + 1, i),
          end: i + 1,
        };
      }
    }
  }

  return null;
}

function normalizeMathText(value: string) {
  return value
    .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\text\s*\[([^\]]*)\}/g, "$1")
    .replace(/\\text\s*\[([^\]]*)\]/g, "$1")
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbf\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\operatorname\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\mp/g, "∓")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\to/g, "→")
    .replace(/\\infty/g, "∞")
    .replace(/\\pi/g, "π")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\delta/g, "δ")
    .replace(/\\theta/g, "θ")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\sigma/g, "σ")
    .replace(/\\sum/g, "Σ")
    .replace(/\\prod/g, "Π")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\^\{([^{}]*)\}/g, (_, exponent: string) => {
      const superscriptMap: Record<string, string> = {
        "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
        "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
        "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
        "n": "ⁿ", "i": "ⁱ",
      };
      return exponent
        .split("")
        .map((char) => superscriptMap[char] ?? char)
        .join("");
    })
    .replace(/_\{([^{}]*)\}/g, "$1")
    .replace(/\\([{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\\+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function MathInline({ value }: { value: string }) {
  return (
    <Text style={styles.inlineMathText}>
      {normalizeMathText(value)}
    </Text>
  );
}

function MathExpression({ source }: { source: string }) {
  const value = source.trim();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  const pushPlain = (plain: string) => {
    if (!plain) return;
    const normalized = normalizeMathText(plain);
    if (!normalized) return;
    parts.push(
      <Text key={`math-text-${key++}`} style={styles.mathText}>
        {normalized}
      </Text>,
    );
  };

  while (cursor < value.length) {
    const fractionIndex = value.indexOf("\\frac", cursor);
    const sqrtIndex = value.indexOf("\\sqrt", cursor);

    const candidates = [fractionIndex, sqrtIndex].filter((index) => index >= 0);
    const commandIndex = candidates.length ? Math.min(...candidates) : -1;

    if (commandIndex < 0) {
      pushPlain(value.slice(cursor));
      break;
    }

    pushPlain(value.slice(cursor, commandIndex));

    if (commandIndex === fractionIndex) {
      const numeratorStart = commandIndex + 5;
      const numerator = readBalancedGroup(value, numeratorStart);

      if (!numerator) {
        pushPlain(value.slice(commandIndex, commandIndex + 5));
        cursor = commandIndex + 5;
        continue;
      }

      const denominator = readBalancedGroup(value, numerator.end);

      if (!denominator) {
        pushPlain(value.slice(commandIndex, numerator.end));
        cursor = numerator.end;
        continue;
      }

      parts.push(
        <View key={`fraction-${key++}`} style={styles.fraction}>
          <View style={styles.fractionPart}>
            <Text style={styles.fractionText}>
              {normalizeMathText(numerator.value)}
            </Text>
          </View>
          <View style={styles.fractionLine} />
          <View style={styles.fractionPart}>
            <Text style={styles.fractionText}>
              {normalizeMathText(denominator.value)}
            </Text>
          </View>
        </View>,
      );

      cursor = denominator.end;
      continue;
    }

    const radicand = readBalancedGroup(value, commandIndex + 5);
    if (!radicand) {
      pushPlain("\\sqrt");
      cursor = commandIndex + 5;
      continue;
    }

    parts.push(
      <Text key={`sqrt-${key++}`} style={styles.mathText}>
        {"√("}
        {normalizeMathText(radicand.value)}
        {")"}
      </Text>,
    );

    cursor = radicand.end;
  }

  return (
    <View style={styles.mathBlock}>
      <View style={styles.mathExpression}>{parts}</View>
    </View>
  );
}

function MessageCopyButton({
  value,
  language,
}: {
  value: string;
  language: OriaLanguage;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn("Copie impossible :", error);
    }
  }

  return (
    <Pressable
      onPress={() => void copy()}
      style={styles.messageCopyButton}
      accessibilityRole="button"
      accessibilityLabel={CHAT_TEXT[language].copyMessage}
    >
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={13}
        color="#777771"
      />
      <Text style={styles.messageCopyText}>
        {copied ? CHAT_TEXT[language].copied : CHAT_TEXT[language].copy}
      </Text>
    </Pressable>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let index = 0;

  const tokenRegex =
    /(\\\([^\n]*?\\\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

  while (remaining.length > 0) {
    const match = remaining.match(tokenRegex);

    if (!match || match.index === undefined) {
      parts.push(
        <Text key={index} style={styles.messageText}>
          {remaining}
        </Text>,
      );
      break;
    }

    if (match.index > 0) {
      parts.push(
        <Text key={index} style={styles.messageText}>
          {remaining.slice(0, match.index)}
        </Text>,
      );
      index++;
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <Text key={index} style={[styles.messageText, styles.bold]}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <Text key={index} style={styles.inlineCode}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      parts.push(
        <MathInline
          key={index}
          value={token.slice(2, -2)}
        />,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, url] = linkMatch;
        parts.push(
          <Text
            key={index}
            style={[styles.messageText, styles.link]}
            onPress={() =>
              Linking.openURL(url).catch(() => undefined)
            }
          >
            {label}
          </Text>,
        );
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <Text key={index} style={[styles.messageText, styles.italic]}>
          {token.slice(1, -1)}
        </Text>,
      );
    }

    remaining = remaining.slice(match.index + token.length);
    index++;
  }

  return <Text>{parts}</Text>;
}

function MarkdownMessage({
  content,
  language: uiLanguage,
}: {
  content: string;
  language: OriaLanguage;
}) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  let code: string[] = [];
  let codeLanguage = "";
  let math: string[] = [];
  let inCode = false;
  let inMath = false;
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      <Text key={`p-${index}`} style={styles.messageText}>
        <InlineMarkdown text={paragraph.join(" ")} />
      </Text>,
    );
    index++;
    paragraph = [];
  };

  const flushBullets = () => {
    if (!bullets.length) return;
    flushParagraph();

    blocks.push(
      <View key={`b-${index}`} style={styles.listBlock}>
        {bullets.map((item, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.messageText}>
              <InlineMarkdown text={item} />
            </Text>
          </View>
        ))}
      </View>,
    );

    index++;
    bullets = [];
  };

  const flushNumbered = () => {
    if (!numbered.length) return;
    flushParagraph();

    blocks.push(
      <View key={`n-${index}`} style={styles.listBlock}>
        {numbered.map((item, i) => (
          <View key={i} style={styles.listRow}>
            <Text style={styles.number}>{i + 1}.</Text>
            <Text style={styles.messageText}>
              <InlineMarkdown text={item} />
            </Text>
          </View>
        ))}
      </View>,
    );

    index++;
    numbered = [];
  };

  const flushLists = () => {
    flushBullets();
    flushNumbered();
  };

  const flushMath = () => {
    if (!math.length) return;

    blocks.push(
      <MathExpression
        key={`math-${index}`}
        source={math.join("\n")}
      />,
    );

    index++;
    math = [];
    inMath = false;
  };

  const flushCode = () => {
    if (!inCode) return;

    blocks.push(
      <CodeBlock key={`code-${index}`} language={codeLanguage} value={code.join("\n")} uiLanguage={uiLanguage} />,
    );

    index++;
    code = [];
    codeLanguage = "";
    inCode = false;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    const singleDisplayMath = trimmed.match(/^\\\[(.*)\\\]$/);
    const singleDollarMath = trimmed.match(/^\$\$(.*)\$\$$/);

    if (!inCode && !inMath && singleDisplayMath) {
      flushLists();
      flushParagraph();
      blocks.push(
        <MathExpression
          key={`math-${index}`}
          source={singleDisplayMath[1]}
        />,
      );
      index++;
      return;
    }

    if (!inCode && !inMath && singleDollarMath) {
      flushLists();
      flushParagraph();
      blocks.push(
        <MathExpression
          key={`math-${index}`}
          source={singleDollarMath[1]}
        />,
      );
      index++;
      return;
    }

    if (!inCode && trimmed === "\\[") {
      flushLists();
      flushParagraph();
      math = [];
      inMath = true;
      return;
    }

    if (!inCode && trimmed === "$$") {
      flushLists();
      flushParagraph();
      math = [];
      inMath = true;
      return;
    }

    if (inMath) {
      if (trimmed === "\\]" || trimmed === "$$") {
        flushMath();
      } else {
        math.push(line);
      }
      return;
    }

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushLists();
        flushParagraph();
        inCode = true;
        codeLanguage = trimmed.slice(3).trim();
      } else {
        flushCode();
      }
      return;
    }

    if (inCode) {
      code.push(line);
      return;
    }

    if (!trimmed) {
      flushLists();
      flushParagraph();
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushLists();
      flushParagraph();
      blocks.push(
        <View key={`hr-${index}`} style={styles.separator} />,
      );
      index++;
      return;
    }

    if (trimmed.startsWith("### ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <Text key={`h3-${index}`} style={styles.h3}>
          <InlineMarkdown text={trimmed.slice(4)} />
        </Text>,
      );
      index++;
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <Text key={`h2-${index}`} style={styles.h2}>
          <InlineMarkdown text={trimmed.slice(3)} />
        </Text>,
      );
      index++;
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <Text key={`h1-${index}`} style={styles.h1}>
          <InlineMarkdown text={trimmed.slice(2)} />
        </Text>,
      );
      index++;
      return;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushNumbered();
      bullets.push(bullet[1]);
      return;
    }

    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      flushBullets();
      numbered.push(numberedMatch[1]);
      return;
    }

    if (trimmed.startsWith("> ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <View key={`quote-${index}`} style={styles.quote}>
          <Text style={styles.quoteText}>
            <InlineMarkdown text={trimmed.slice(2)} />
          </Text>
        </View>,
      );
      index++;
      return;
    }

    flushLists();
    paragraph.push(trimmed);
  });

  if (inCode) flushCode();
  if (inMath) flushMath();
  flushLists();
  flushParagraph();

  return (
    <ScrollView
      style={styles.responseScrollArea}
      showsVerticalScrollIndicator
      nestedScrollEnabled
    >
      <View style={styles.markdown}>{blocks}</View>
    </ScrollView>
  );
}

function CodeBlock({
  language,
  value,
  uiLanguage,
}: {
  language: string;
  value: string;
  uiLanguage: OriaLanguage;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language || "Code"}</Text>
        <Pressable onPress={copy} style={styles.copyButton}>
          <Text style={styles.copyText}>{copied ? CHAT_TEXT[uiLanguage].copied : CHAT_TEXT[uiLanguage].copy}</Text>
        </Pressable>
      </View>
      <ScrollView
        style={styles.codeScrollArea}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
          <Text style={styles.codeText}>{value}</Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function VideoMessage({ url }: { url: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
    />
  );
}

function ModelOption({
  model,
  active,
  trial,
  disabled,
  onPress,
  language,
}: {
  model: ModelDefinition;
  active: boolean;
  trial?: TrialInfo;
  disabled: boolean;
  onPress: () => void;
  language: OriaLanguage;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.modelOption,
        active && styles.modelOptionActive,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.modelName}>{model.name}</Text>
        {trial ? (
          <Text style={styles.trialBadge}>
            {CHAT_TEXT[language].trial} · {trial.remaining}/{trial.max}
          </Text>
        ) : active ? (
          <Ionicons name="checkmark" size={17} color="#111111" />
        ) : null}
      </View>
      <Text style={styles.modelDescription}>{getModelDescription(model, language)}</Text>
      {trial ? (
        <Text style={styles.smallMuted}>
          Modèle supérieur · 5 essais maximum
        </Text>
      ) : null}
    </Pressable>
  );
}

function AttachmentCard({
  attachment,
  onRemove,
  language,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
  language: OriaLanguage;
}) {
  return (
    <View style={styles.attachmentCard}>
      {attachment.kind === "image" ? (
        <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
      ) : (
        <View style={styles.fileIcon}>
          <Ionicons name="document-text-outline" size={22} color="#666" />
        </View>
      )}

      <View style={styles.attachmentInfo}>
        <Text numberOfLines={1} style={styles.attachmentName}>
          {attachment.name}
        </Text>
        <Text style={styles.smallMuted}>
          {attachment.kind === "image" ? CHAT_TEXT[language].image : CHAT_TEXT[language].file}
        </Text>
      </View>

      <Pressable onPress={onRemove} style={styles.removeAttachment}>
        <Ionicons name="close" size={16} color="#666" />
      </Pressable>
    </View>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const t = CHAT_TEXT[language];

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void readOriaLanguage().then((savedLanguage) => {
        if (active) setLanguage(savedLanguage);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("luna");
  const [message, setMessage] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [bottomAreaHeight, setBottomAreaHeight] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);
  const [activeCapability, setActiveCapability] =
    useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [trials, setTrials] =
    useState<Record<string, TrialInfo>>({});
  const [isLoadingWallet, setIsLoadingWallet] = useState(true);
  const [isLoadingConversations, setIsLoadingConversations] =
    useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const drawerWidth = Math.min(290, Math.max(235, screenWidth * 0.74));
  const drawerTranslateX = useRef(new Animated.Value(-320)).current;

  const openDrawer = useCallback(() => {
    drawerTranslateX.stopAnimation();
    drawerTranslateX.setValue(-drawerWidth);
    setDrawerVisible(true);
    setSidebarOpen(true);

    requestAnimationFrame(() => {
      Animated.timing(drawerTranslateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [drawerTranslateX, drawerWidth]);

  const closeDrawer = useCallback(() => {
    drawerTranslateX.stopAnimation();

    Animated.timing(drawerTranslateX, {
      toValue: -drawerWidth,
      duration: 190,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setSidebarOpen(false);
        setDrawerVisible(false);
      }
    });
  }, [drawerTranslateX, drawerWidth]);

  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !drawerVisible &&
          gesture.x0 <= 28 &&
          gesture.dx > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          drawerTranslateX.setValue(
            Math.max(
              -drawerWidth,
              Math.min(0, -drawerWidth + gesture.dx),
            ),
          );
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > drawerWidth * 0.22) {
            openDrawer();
          } else {
            Animated.timing(drawerTranslateX, {
              toValue: -drawerWidth,
              duration: 150,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.timing(drawerTranslateX, {
            toValue: -drawerWidth,
            duration: 150,
            useNativeDriver: true,
          }).start();
        },
      }),
    [drawerVisible, drawerTranslateX, drawerWidth, openDrawer],
  );

  const drawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          drawerVisible &&
          gesture.dx < -8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          drawerTranslateX.setValue(
            Math.max(-drawerWidth, Math.min(0, gesture.dx)),
          );
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -drawerWidth * 0.22) {
            closeDrawer();
          } else {
            Animated.timing(drawerTranslateX, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.timing(drawerTranslateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        },
      }),
    [drawerVisible, drawerTranslateX, drawerWidth, closeDrawer],
  );

  const [mediaCapabilities, setMediaCapabilities] =
    useState<MediaCapability[]>([]);
  const [selectedMediaAction, setSelectedMediaAction] =
    useState<string>("");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [generatedMedia, setGeneratedMedia] =
    useState<GeneratedMedia[]>([]);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [isLoadingMediaCapabilities, setIsLoadingMediaCapabilities] =
    useState(false);

  const availableModels = useMemo(
    () => getSelectableModels(wallet?.pack_id ?? null, trials),
    [wallet?.pack_id, trials],
  );

  const hasActivePack = Boolean(wallet?.pack_id);

  const remainingDays = wallet?.pack_expires_at
    ? Math.max(
        0,
        Math.ceil(
          (new Date(wallet.pack_expires_at).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null;

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const session = await getSessionOrThrow();

        if (cancelled) return;

        const userId = session.user.id;
        setCurrentUserId(userId);

        const cache = await readLocalCache(userId);

        if (cache) {
          setConversations(cache.conversations);
          setActiveConversationId(cache.activeConversationId);
          setSelectedModel(cache.selectedModel || "luna");
          setActiveCapability(cache.activeCapability);

          if (cache.activeConversationId) {
            const cachedMessages =
              cache.messages[cache.activeConversationId];

            if (Array.isArray(cachedMessages)) {
              setMessages(cachedMessages);
            }
          }
        }

        setIsInitialized(true);

        const trialState = await loadTrials();
        await Promise.all([
          loadWallet(trialState),
          loadConversations(cache),
          loadPersistedMedia(),
        ]);
      } catch (requestError) {
        console.error("Erreur initialisation Chat :", requestError);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Impossible d'initialiser le chat.",
        );
        setIsLoadingConversations(false);
        setIsLoadingWallet(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isInitialized || !currentUserId) return;

    const timeout = setTimeout(async () => {
      const oldCache = await readLocalCache(currentUserId);

      await writeLocalCache(currentUserId, {
        conversations,
        messages: {
          ...(oldCache?.messages || {}),
          ...(activeConversationId
            ? { [activeConversationId]: messages }
            : {}),
        },
        activeConversationId,
        selectedModel,
        activeCapability,
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [
    conversations,
    messages,
    activeConversationId,
    selectedModel,
    activeCapability,
    currentUserId,
    isInitialized,
  ]);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    if (!messages.length) return;

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [messages.length, isThinking, bottomAreaHeight]);

  async function loadWallet(
    trialState: Record<string, TrialInfo> = trials,
  ) {
    try {
      setIsLoadingWallet(true);
      const data = await apiFetch<{
        success: boolean;
        wallet: WalletData;
      }>("/credits/me");

      setWallet(data.wallet);

      const selectable = getSelectableModels(
        data.wallet.pack_id,
        trialState,
      );

      if (selectable.length) {
        setSelectedModel((current) =>
          selectable.some((item) => item.id === current)
            ? current
            : selectable[0].id,
        );
      } else {
        setSelectedModel("");
      }
    } catch (requestError) {
      console.error("Erreur chargement wallet :", requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger les crédits.",
      );
    } finally {
      setIsLoadingWallet(false);
    }
  }

  async function loadTrials(): Promise<Record<string, TrialInfo>> {
    try {
      const data = await apiFetch<TrialResponse>("/ai/trials");
      const state = data.trials || {};
      setTrials(state);
      return state;
    } catch (requestError) {
      console.error("Erreur chargement essais :", requestError);
      setTrials({});
      return {};
    }
  }

  async function loadConversations(
    localCache?: LocalChatCache | null,
  ) {
    try {
      setIsLoadingConversations(true);

      const data = await apiFetch<{
        conversations: Conversation[];
      }>("/conversations");

      const remote = data.conversations || [];
      const remoteIds = new Set(remote.map((item) => item.id));

      const unsynced = (localCache?.conversations || []).filter(
        (item) => !remoteIds.has(item.id),
      );

      const merged = [...unsynced, ...remote];
      setConversations(merged);

      if (!activeConversationId && localCache?.activeConversationId) {
        const active = merged.find(
          (item) => item.id === localCache.activeConversationId,
        );

        if (active) setActiveConversationId(active.id);
      }
    } catch (requestError) {
      console.error("Erreur chargement conversations :", requestError);

      if (localCache?.conversations) {
        setConversations(localCache.conversations);
      } else {
        setConversations([]);
      }

      setError(
        requestError instanceof Error
          ? `${requestError.message} Les données locales restent disponibles.`
          : "Serveur indisponible. Les données locales restent disponibles.",
      );
    } finally {
      setIsLoadingConversations(false);
    }
  }

  async function loadPersistedMedia() {
    try {
      const data = await apiFetch<{
        success?: boolean;
        media?: Array<{
          id: string;
          media_type?: "image" | "video";
          type?: "image" | "video";
          mime_type?: string | null;
          public_url?: string | null;
          media_url?: string | null;
          url?: string | null;
          action?: string | null;
          model?: string | null;
          cost?: number | null;
          credits_remaining?: number | null;
          seconds?: string | number | null;
          size?: string | number | null;
          prompt?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          createdAt?: string | null;
        }>;
      }>("/media");

      const restored: GeneratedMedia[] = (data.media ?? []).flatMap(
        (item) => {
          const type =
            item.media_type === "video" || item.type === "video"
              ? "video"
              : "image";

          const url = (
            item.public_url ??
            item.media_url ??
            item.url ??
            ""
          ).trim();

          if (!url) return [];

          return [
            {
              id: item.id,
              conversation_id: item.conversation_id ?? null,
              prompt: item.prompt ?? null,
              created_at: item.created_at ?? item.createdAt ?? null,
              type,
              media_type: type,
              mimeType:
                item.mime_type ??
                (type === "image" ? "image/png" : "video/mp4"),
              url,
              action: item.action ?? "",
              model: item.model ?? "",
              cost: item.cost ?? 0,
              creditsRemaining: item.credits_remaining ?? 0,
              seconds:
                item.seconds === null || item.seconds === undefined
                  ? undefined
                  : String(item.seconds),
              size:
                item.size === null || item.size === undefined
                  ? undefined
                  : String(item.size),
            } satisfies GeneratedMedia,
          ];
        },
      );

      setGeneratedMedia(restored);
    } catch (requestError) {
      console.error("Erreur chargement créations Oria :", requestError);
    }
  }

  function findMediaForMessage(
    item: ChatMessage,
  ): GeneratedMedia | null {
    if (item.role !== "assistant") return null;

    const exact = generatedMedia.find((media) => media.id === item.id);
    if (exact) return exact;

    const markerId = extractMediaIdFromMessage(item.content);
    if (markerId) {
      const byMarker = generatedMedia.find(
        (media) => media.id === markerId,
      );
      if (byMarker) return byMarker;
    }

    const visible = getVisibleMessageContent(item.content);
    const actionMatch = visible.match(
      /^(?:Image|Vidéo) générée · (.+)$/u,
    );

    if (!actionMatch) return null;

    const candidates = generatedMedia.filter(
      (media) =>
        media.conversation_id === item.conversationId &&
        media.action === actionMatch[1],
    );

    if (!candidates.length) return null;
    if (candidates.length === 1 || !item.createdAt) {
      return candidates[0];
    }

    const messageTime = new Date(item.createdAt).getTime();

    return [...candidates].sort((a, b) => {
      const aTime = new Date(a.created_at ?? 0).getTime();
      const bTime = new Date(b.created_at ?? 0).getTime();
      return (
        Math.abs(aTime - messageTime) -
        Math.abs(bTime - messageTime)
      );
    })[0];
  }

  async function loadMediaCapabilities() {
    try {
      setIsLoadingMediaCapabilities(true);

      const data = await apiFetch<MediaCapabilitiesResponse>(
        "/ai/media-capabilities",
      );

      const rawMedia =
        Array.isArray(data.media) && data.media.length > 0
          ? data.media
          : [
              ...(Array.isArray(data.images) ? data.images : []),
              ...(Array.isArray(data.videos) ? data.videos : []),
            ];

      const normalized = rawMedia
        .map(normalizeMediaCapability)
        .filter((item): item is MediaCapability => item !== null);

      const fallback = getLocalMediaCapabilities(
        data.pack_id ?? wallet?.pack_id ?? null,
      );

      const available = normalized.length > 0 ? normalized : fallback;

      setMediaCapabilities(available);
      setSelectedMediaAction((current) =>
        current && available.some((item) => item.action === current)
          ? current
          : available[0]?.action ?? "",
      );
    } catch (requestError) {
      console.warn("Capacités média indisponibles :", requestError);

      const fallback = getLocalMediaCapabilities(wallet?.pack_id ?? null);
      setMediaCapabilities(fallback);
      setSelectedMediaAction((current) =>
        current && fallback.some((item) => item.action === current)
          ? current
          : fallback[0]?.action ?? "",
      );
    } finally {
      setIsLoadingMediaCapabilities(false);
    }
  }

  async function createConversation() {
    const now = new Date().toISOString();
    const localId = uid();

    const localConversation: Conversation = {
      id: localId,
      title: "Nouvelle conversation",
      createdAt: now,
      updatedAt: now,
    };

    setConversations((current) => [
      localConversation,
      ...current,
    ]);
    setActiveConversationId(localId);
    setMessages([]);
    setMessage("");
    setAttachments([]);
    setComposerExpanded(false);
    setActiveCapability(null);
    setError(null);
    closeDrawer();

    if (currentUserId) {
      const cache = await readLocalCache(currentUserId);

      await writeLocalCache(currentUserId, {
        conversations: [
          localConversation,
          ...(cache?.conversations || conversations),
        ],
        messages: {
          ...(cache?.messages || {}),
          [localId]: [],
        },
        activeConversationId: localId,
        selectedModel,
        activeCapability: null,
      });
    }

    try {
      const remote = await createConversationRemote(
        "Nouvelle conversation",
      );

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === localId ? remote : conversation,
        ),
      );
      setActiveConversationId(remote.id);
    } catch (requestError) {
      console.error(
        "Erreur création conversation backend :",
        requestError,
      );
      setError(
        t.localConversationPending,
      );
    }
  }

  async function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    closeDrawer();
    setError(null);

    if (currentUserId) {
      const cache = await readLocalCache(currentUserId);
      const localMessages = cache?.messages[conversationId];

      setMessages(Array.isArray(localMessages) ? localMessages : []);
    }

    try {
      const data = await apiFetch<{ messages: ChatMessage[] }>(
        `/conversations/${conversationId}/messages`,
      );

      const remote = data.messages || [];

      if (remote.length) {
        setMessages(remote);

        if (currentUserId) {
          const cache = await readLocalCache(currentUserId);

          await writeLocalCache(currentUserId, {
            conversations: cache?.conversations || conversations,
            messages: {
              ...(cache?.messages || {}),
              [conversationId]: remote,
            },
            activeConversationId: conversationId,
            selectedModel,
            activeCapability,
          });
        }
      }
    } catch (requestError) {
      console.error("Erreur chargement messages :", requestError);
      setError(
        requestError instanceof Error
          ? `${requestError.message} ${t.localMessagesRemain}`
          : t.cloudMessagesFailed,
      );
    }
  }

  function updateConversationLocally(
    conversationId: string,
    content: string,
    now: string,
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.title === "Nouvelle conversation" && content
                  ? content.length > 45
                    ? `${content.slice(0, 45)}...`
                    : content
                  : conversation.title,
              updatedAt: now,
            }
          : conversation,
      ),
    );
  }

  async function pickCamera() {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(
        interpolate(t.maxAttachments, { max: MAX_ATTACHMENTS }),
      );
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        t.permissionRequired,
        t.cameraPermission,
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    const incoming: ChatAttachment = {
      id: uid(),
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
      kind: "image",
      size: asset.fileSize,
    };

    setAttachments((current) => [
      ...current,
      incoming,
    ].slice(0, MAX_ATTACHMENTS));
    setError(null);
    setComposerExpanded(true);
  }

  async function pickImage() {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(
        interpolate(t.maxAttachments, { max: MAX_ATTACHMENTS }),
      );
      return;
    }

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        t.permissionRequired,
        t.photosPermission,
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS - attachments.length,
      quality: 0.9,
    });

    if (result.canceled) return;

    const incoming: ChatAttachment[] = result.assets
      .slice(0, MAX_ATTACHMENTS - attachments.length)
      .map((asset) => ({
        id: uid(),
        uri: asset.uri,
        name: asset.fileName || `image-${Date.now()}.jpg`,
        mimeType: asset.mimeType || "image/jpeg",
        kind: "image" as const,
        size: asset.fileSize,
      }));

    setAttachments((current) => [...current, ...incoming]);
    setError(null);
  }

  async function pickFiles() {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(
        interpolate(t.maxAttachments, { max: MAX_ATTACHMENTS }),
      );
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: "*/*",
    });

    if (result.canceled) return;

    const incoming: ChatAttachment[] = [];

    for (
      const asset of result.assets.slice(
        0,
        MAX_ATTACHMENTS - attachments.length,
      )
    ) {
      const mime = asset.mimeType || "application/octet-stream";

      if (
        !ACCEPTED_FILE_TYPES.includes(mime) &&
        !ACCEPTED_IMAGE_TYPES.includes(mime)
      ) {
        setError(t.unsupportedFile);
        continue;
      }

      incoming.push({
        id: uid(),
        uri: asset.uri,
        name: asset.name,
        mimeType: mime,
        kind: mime.startsWith("image/") ? "image" : "file",
        size: asset.size,
      });
    }

    setAttachments((current) => [...current, ...incoming]);
    setError(null);
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }

  async function handleGenerateMedia(promptOverride?: string) {
    if (!hasActivePack) {
      setError(t.activePackRequired);
      return;
    }
    const prompt = (promptOverride ?? mediaPrompt).trim();

    if (!prompt || isThinking) return;

    if (!selectedMediaAction) {
      setError(t.noCreationOption);
      return;
    }

    const capability =
      mediaCapabilities.find(
        (item) => item.action === selectedMediaAction,
      ) ??
      (() => {
        const config = getMediaGenerationConfig(selectedMediaAction);
        return config
          ? {
              action: config.action,
              type: config.type,
              model: config.model,
            }
          : undefined;
      })();

    if (!capability) {
      setError(t.creationOptionMissing);
      return;
    }

    const now = new Date().toISOString();
    let conversationId = activeConversationId;

    setIsThinking(true);
    setError(null);

    try {
      if (!conversationId) {
        const localId = uid();
        const title =
          prompt.length > 45
            ? `${prompt.slice(0, 45)}...`
            : prompt;

        const localConversation: Conversation = {
          id: localId,
          title,
          createdAt: now,
          updatedAt: now,
        };

        conversationId = localId;

        setConversations((current) => [
          localConversation,
          ...current,
        ]);
        setActiveConversationId(localId);

        try {
          const remote = await createConversationRemote(title);
          conversationId = remote.id;
          setActiveConversationId(remote.id);

          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === localId ? remote : conversation,
            ),
          );
        } catch (requestError) {
          console.error(
            "Création conversation cloud échouée :",
            requestError,
          );
        }
      }

      const userMessage: ChatMessage = {
        id: uid(),
        conversationId,
        role: "user",
        content: `[Création ${
          capability.type === "image" ? "image" : "vidéo"
        } · ${selectedMediaAction}]\n${prompt}`,
        createdAt: now,
      };

      setMessages((current) => [...current, userMessage]);

      try {
        await saveMessageRemote(userMessage);
      } catch (saveError) {
        console.error("Erreur sauvegarde prompt média :", saveError);
      }

      const endpoint =
        capability.type === "image"
          ? "/ai/image"
          : "/ai/video";

      const response = await apiMediaFetch<{
        success: boolean;
        type: "image" | "video";
        action: string;
        model: string;
        cost: number;
        credits_remaining: number;
        mime_type: string;
        data?: string | null;
        seconds?: string | null;
        size?: string | null;
        media_id?: string | null;
        id?: string | null;
        public_url?: string | null;
        media_url?: string | null;
        url?: string | null;
        conversation_id?: string | null;
      }>(endpoint, {
        action: selectedMediaAction,
        prompt,
        conversation_id: conversationId,
      });

      if (!response.success) {
        throw new Error(t.mediaGenerationFailed);
      }

      const url = (
        response.public_url ||
        response.media_url ||
        response.url ||
        ""
      ).trim();

      if (!url) {
        throw new Error(
          t.mediaUrlMissing,
        );
      }

      const mediaId = response.media_id || response.id;

      if (!mediaId) {
        throw new Error(
          t.mediaIdMissing,
        );
      }

      const media: GeneratedMedia = {
        id: mediaId,
        conversation_id: response.conversation_id ?? conversationId,
        prompt,
        created_at: new Date().toISOString(),
        type: response.type,
        media_type: response.type,
        mimeType:
          response.mime_type ||
          (response.type === "image"
            ? "image/png"
            : "video/mp4"),
        url,
        action: response.action,
        model: response.model,
        cost: response.cost,
        creditsRemaining: response.credits_remaining,
        seconds: response.seconds,
        size: response.size,
      };

      setGeneratedMedia((current) => [
        ...current.filter((item) => item.id !== mediaId),
        media,
      ]);

      const assistantMessage: ChatMessage = {
        id: mediaId,
        conversationId,
        role: "assistant",
        content: buildMediaMessageContent(
          response.type,
          response.action,
          mediaId,
        ),
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [
        ...current,
        assistantMessage,
      ]);

      try {
        await saveMessageRemote(assistantMessage);
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde résultat média :",
          saveError,
        );
      }

      setMediaPrompt("");
      setMediaMenuOpen(false);

      const refreshedTrials = await loadTrials();
      await loadWallet(refreshedTrials);
      await loadMediaCapabilities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t.mediaCreationFailed,
      );
    } finally {
      setIsThinking(false);
    }
  }

  async function handleSendMessage() {
    const content = message.trim();
    const selectedTrial = trials[selectedModel];

    if (selectedTrial && selectedTrial.remaining <= 0) {
      setError(t.freeTrialsExhausted);
      return;
    }

    if (
      (!content && attachments.length === 0) ||
      isThinking
    ) {
      return;
    }

    if (activeCapability === "Création") {
      setMediaPrompt(content);
      await handleGenerateMedia(content);
      return;
    }

    const now = new Date().toISOString();
    let conversationId = activeConversationId;

    if (!conversationId) {
      const localId = uid();

      const title =
        content.length > 45
          ? `${content.slice(0, 45)}...`
          : content || "Nouvelle conversation";

      const localConversation: Conversation = {
        id: localId,
        title,
        createdAt: now,
        updatedAt: now,
      };

      conversationId = localId;

      setConversations((current) => [
        localConversation,
        ...current,
      ]);
      setActiveConversationId(localId);

      try {
        const remote = await createConversationRemote(title);

        conversationId = remote.id;
        setActiveConversationId(remote.id);

        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === localId ? remote : conversation,
          ),
        );
      } catch (requestError) {
        console.error(
          "Création conversation cloud échouée :",
          requestError,
        );

        setError(
          t.localConversationRetry,
        );
      }
    } else {
      updateConversationLocally(
        conversationId,
        content,
        now,
      );
    }

    const webEnabled = activeCapability === "Recherche Web";

    const attachmentSummary =
      attachments.length > 0
        ? `\n\n[${t.attachmentsSummary} : ${attachments
            .map((attachment) => attachment.name)
            .join(", ")}]`
        : "";

    const userMessage: ChatMessage = {
      id: uid(),
      conversationId,
      role: "user",
      content: `${content}${attachmentSummary}`.trim(),
      createdAt: now,
    };

    setMessages((current) => [
      ...current,
      userMessage,
    ]);
    setMessage("");
    setComposerExpanded(false);
    setIsThinking(true);
    setError(null);

    try {
      try {
        await saveMessageRemote(userMessage);
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde message utilisateur :",
          saveError,
        );
      }

      const formData = new FormData();

      formData.append("model", selectedModel);
      formData.append("message", content);
      formData.append("web", String(webEnabled));
      formData.append("conversation_id", conversationId);

      for (const attachment of attachments) {
        /*
         * Do NOT append the React Native `{ uri, type, name }` shape here.
         * Expo's multipart implementation can reject that object with:
         * "Unsupported FormDataPart implementation".
         *
         * ExpoFile implements Blob and can be appended directly to FormData.
         * DocumentPicker already copies files to the app cache and ImagePicker
         * provides a local file URI, so both attachment types are supported.
         */
        const nativeFile = new ExpoFile(attachment.uri);

        formData.append(
          "files",
          nativeFile,
          attachment.name,
        );
      }

      const streamResponse = await apiStreamFetch(
        "/ai/chat/stream",
        formData,
      );

      const assistantId = uid();
      const assistantCreatedAt = new Date().toISOString();

      let assistantContent = "";

      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          conversationId,
          role: "assistant",
          content: "",
          createdAt: assistantCreatedAt,
        },
      ]);

      /*
       * React Native runtimes can expose ReadableStream differently
       * depending on Expo/runtime version. We support the standard
       * reader path first and fall back to the complete response text.
       */
      if (streamResponse.body?.getReader) {
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";
        let done = false;

        while (!done) {
          const result = await reader.read();

          if (result.done) break;

          buffer += decoder.decode(result.value, {
            stream: true,
          });

          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;

            let eventName = "message";
            let dataText = "";

            for (const line of rawEvent.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              }

              if (line.startsWith("data:")) {
                dataText += line.slice(5).trim();
              }
            }

            if (!dataText) continue;

            let eventData: Record<string, unknown>;

            try {
              eventData = JSON.parse(dataText);
            } catch {
              continue;
            }

            if (eventName === "delta") {
              const delta =
                typeof eventData.content === "string"
                  ? eventData.content
                  : "";

              if (!delta) continue;

              assistantContent += delta;

              setMessages((current) =>
                current.map((item) =>
                  item.id === assistantId
                    ? {
                        ...item,
                        content: assistantContent,
                      }
                    : item,
                ),
              );
            }

            if (eventName === "error") {
              throw new Error(
                typeof eventData.detail === "string"
                  ? eventData.detail
                  : t.aiStreamingError,
              );
            }

            if (eventName === "done") {
              done = true;
              break;
            }
          }
        }
      } else {
        const text = await streamResponse.text();
        assistantContent = text;
      }

      if (!assistantContent.trim()) {
        throw new Error(
          t.noAiContent,
        );
      }

      const assistantMessage: ChatMessage = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content: assistantContent,
        createdAt: assistantCreatedAt,
      };

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? assistantMessage
            : item,
        ),
      );

      try {
        await saveMessageRemote(assistantMessage);
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde réponse IA :",
          saveError,
        );
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                updatedAt: new Date().toISOString(),
              }
            : conversation,
        ),
      );

      setAttachments([]);

      const refreshedTrials = await loadTrials();
      await loadWallet(refreshedTrials);
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : t.cannotContactOria;

      const assistantMessage: ChatMessage = {
        id: uid(),
        conversationId,
        role: "assistant",
        content: `${t.errorPrefix} : ${errorMessage}`,
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [
        ...current,
        assistantMessage,
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  function selectCapability(label: string) {
    if (label === "Fichier") {
      void pickFiles();
      return;
    }

    if (label === "Image") {
      void pickImage();
      return;
    }

    if (label === "Recherche Web") {
      setActiveCapability((current) =>
        current === label ? null : label,
      );
      setMediaMenuOpen(false);
      return;
    }

    if (label === "Création") {
      setActiveCapability("Création");
      setMediaMenuOpen(true);
      setError(null);
      setSelectedMediaAction((current) =>
        current ||
        getLocalMediaCapabilities(wallet?.pack_id ?? null)[0]?.action ||
        "",
      );
      if (hasActivePack) {
        void loadMediaCapabilities();
      }
    }
  }

  async function logout() {
    try {
      if (supabase) await supabase.auth.signOut();
    } finally {
      if (currentUserId) {
        await removeLocalCache(currentUserId);
      }
      router.replace("/login" as any);
    }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const media = findMediaForMessage(item);
    const copyValue =
      item.role === "assistant"
        ? getVisibleMessageContent(item.content)
        : item.content;

    return (
      <View
        style={[
          styles.messageRow,
          item.role === "user"
            ? styles.messageRowUser
            : styles.messageRowAssistant,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            item.role === "user"
              ? styles.userBubble
              : styles.assistantBubble,
          ]}
        >
          {item.role === "assistant" ? (
            <MarkdownMessage
              content={getVisibleMessageContent(item.content)}
              language={language}
            />
          ) : (
            <Text style={styles.userText}>{item.content}</Text>
          )}
        </View>

        <View
          style={[
            styles.messageActions,
            item.role === "user"
              ? styles.messageActionsUser
              : styles.messageActionsAssistant,
          ]}
        >
          <MessageCopyButton value={copyValue} language={language} />
        </View>

        {media ? (
          <View style={styles.mediaMessage}>
            {media.type === "image" ? (
              <Image
                source={{ uri: media.url }}
                style={styles.generatedImage}
                resizeMode="contain"
              />
            ) : (
              <VideoMessage url={media.url} />
            )}

            <Pressable
              style={styles.openMediaButton}
              onPress={() =>
                Linking.openURL(media.url).catch(() => undefined)
              }
            >
              <Ionicons
                name="open-outline"
                size={15}
                color="#ffffff"
              />
              <Text style={styles.openMediaText}>{t.open}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const activeTitle = getDisplayConversationTitle(
    conversations.find(
      (conversation) =>
        conversation.id === activeConversationId,
    )?.title || "Nouvelle conversation",
    language,
  );

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <View style={styles.container} {...edgePanResponder.panHandlers}>
          <View style={styles.header}>
            <Pressable
              style={styles.headerButton}
              onPress={openDrawer}
            >
              <Ionicons name="menu" size={22} color="#111111" />
            </Pressable>

            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerOverline}>
                Workspace
              </Text>
              <Text
                numberOfLines={1}
                style={styles.headerTitle}
              >
                {activeTitle}
              </Text>
            </View>

            <View style={styles.headerRight}>
              <Pressable
                style={styles.creditPill}
                onPress={() => router.push("/credits"as any)}
              >
                <Ionicons
                  name="wallet-outline"
                  size={15}
                  color="#555555"
                />
                <Text style={styles.creditText}>
                  {isLoadingWallet
                    ? "..."
                    : wallet
                      ? formatCredits(wallet.balance)
                      : "—"}
                </Text>
              </Pressable>

              <Pressable
                style={styles.profileButton}
                onPress={() => router.push("/settings" as any)}
              >
                <Text style={styles.profileLetter}>U</Text>
              </Pressable>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => setError(null)}>
                <Ionicons name="close" size={17} color="#555555" />
              </Pressable>
            </View>
          ) : null}

          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.brandRow}>
                <View style={styles.brandIcon}>
                  <Ionicons
                    name="sparkles"
                    size={21}
                    color="#ffffff"
                  />
                </View>
                <View>
                  <Text style={styles.brandOverline}>ORIA</Text>
                  <Text style={styles.brandTitle}>
                    Intelligence workspace
                  </Text>
                </View>
              </View>

              <Text style={styles.emptyHeading}>
                {t.welcomeHeading}
              </Text>

              <Text style={styles.emptyDescription}>
                {t.welcomeDescription}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              style={styles.messageListContainer}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={[
                styles.messageList,
                {
                  paddingBottom: Math.max(
                    34,
                    bottomAreaHeight + 20,
                  ),
                },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                if (isThinking) {
                  scrollToBottom(false);
                }
              }}
            />
          )}

          <View
            style={[
              styles.bottomArea,
              { bottom: safeAreaBottom },
            ]}
            onLayout={(event) => {
              const height = Math.ceil(event.nativeEvent.layout.height);
              setBottomAreaHeight((current) =>
                current === height ? current : height,
              );
            }}
          >
            {modelMenuOpen ? (
              <View style={styles.modelMenu}>
                {availableModels.length === 0 ? (
                  <Text style={styles.emptyMenuText}>
                    {t.noModel}
                  </Text>
                ) : (
                  availableModels.map((model) => (
                    <ModelOption
                      key={model.id}
                      model={model}
                      active={selectedModel === model.id}
                      trial={trials[model.id]}
                      disabled={
                        Boolean(trials[model.id]) &&
                        trials[model.id].remaining <= 0
                      }
                      language={language}
                      onPress={() => {
                        if (
                          trials[model.id] &&
                          trials[model.id].remaining <= 0
                        ) {
                          return;
                        }

                        setSelectedModel(model.id);
                        setModelMenuOpen(false);
                      }}
                    />
                  ))
                )}
              </View>
            ) : null}

            <Pressable
              style={styles.modelSelector}
              onPress={() => {
                if (availableModels.length > 1) {
                  setModelMenuOpen((current) => !current);
                }
              }}
            >
              <Ionicons
                name="sparkles-outline"
                size={17}
                color="#111111"
              />
              <Text style={styles.modelSelectorText}>
                {models.find(
                  (model) => model.id === selectedModel,
)?.name || t.model}
              </Text>

              {trials[selectedModel] ? (
                <Text style={styles.trialBadge}>
                  {t.trial} · {trials[selectedModel].remaining}/
                  {trials[selectedModel].max}
                </Text>
              ) : null}

              <Ionicons
                name={
                  modelMenuOpen
                    ? "chevron-up"
                    : "chevron-down"
                }
                size={15}
                color="#555555"
              />
            </Pressable>

            {activeCapability === "Recherche Web" ? (
              <View style={styles.capabilityBanner}>
                <View style={styles.capabilityIcon}>
                  <Ionicons
                    name="globe-outline"
                    size={18}
                    color="#111111"
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.capabilityTitle}>
                    {t.webSearchEnabled}
                  </Text>
                  <Text style={styles.capabilityDescription}>
                    {t.webSearchNext}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setActiveCapability(null)}
                >
                  <Ionicons
                    name="close"
                    size={18}
                    color="#666666"
                  />
                </Pressable>
              </View>
            ) : null}

            {activeCapability === "Création" ? (
              <View style={styles.mediaPanel}>
                <View style={styles.rowBetween}>
                  <View style={styles.flex}>
                    <Text style={styles.capabilityTitle}>
                      {t.mediaCreation}
                    </Text>
                    <Text style={styles.capabilityDescription}>
                      {t.mediaCreationDescription}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setActiveCapability(null);
                      setSelectedMediaAction("");
                      setMediaPrompt("");
                      setMediaMenuOpen(false);
                    }}
                  >
                    <Ionicons
                      name="close"
                      size={18}
                      color="#666666"
                    />
                  </Pressable>
                </View>

                {!hasActivePack ? (
                  <View style={styles.mediaLockedBanner}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={17}
                      color="#555555"
                    />
                    <View style={styles.flex}>
                      <Text style={styles.mediaLockedTitle}>
                        {t.creationLocked}
                      </Text>
                      <Text style={styles.mediaLockedText}>
                        {t.creationLockedDescription}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.mediaTypeRow}>
                  {(["image", "video"] as const).map((type) => {
                    const configurationsForType =
                      mediaCapabilities.filter(
                        (item) => item.type === type,
                      );

                    const selectedType =
                      getMediaGenerationConfig(
                        selectedMediaAction,
                      )?.type;

                    return (
                      <Pressable
                        key={type}
                        disabled={!hasActivePack || configurationsForType.length === 0}
                        onPress={() => {
                          if (hasActivePack && configurationsForType.length > 0) {
                            setSelectedMediaAction(
                              configurationsForType[0].action,
                            );
                            setError(null);
                          }
                        }}
                        style={[
                          styles.mediaTypeButton,
                          selectedType === type &&
                            styles.mediaTypeButtonActive,
                          (!hasActivePack || configurationsForType.length === 0) &&
                            styles.mediaTypeButtonLocked,
                        ]}
                      >
                        <Ionicons
                          name={
                            type === "image"
                              ? "image-outline"
                              : "videocam-outline"
                          }
                          size={23}
                          color="#111111"
                        />
                        <Text style={styles.mediaTypeText}>
                          {type === "image"
                            ? t.generateImage
                            : t.generateVideo}
                        </Text>
                        <Text style={styles.smallMuted}>
                          {configurationsForType.length}{" "}
                          {configurationsForType.length > 1
                            ? t.configurations
                            : t.configuration}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedMediaAction ? (
                  <>
                    <Text style={styles.mediaSectionLabel}>
                      {t.generationConfiguration}
                    </Text>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalOptions}
                    >
                      {mediaCapabilities
                        .filter(
                          (item) =>
                            item.type ===
                            getMediaGenerationConfig(
                              selectedMediaAction,
                            )?.type,
                        )
                        .map((capability) => {
                          const config = getMediaGenerationConfig(
                            capability.action,
                          );

                          if (!config) return null;

                          const selected =
                            selectedMediaAction === config.action;

                          const estimate =
                            capability.estimated_credits ??
                            capability.credits;

                          return (
                            <Pressable
                              key={config.action}
                              disabled={!hasActivePack}
                              onPress={() =>
                                setSelectedMediaAction(config.action)
                              }
                              style={[
                                styles.mediaOption,
                                selected &&
                                  styles.mediaOptionActive,
                                !hasActivePack &&
                                  styles.mediaOptionLocked,
                              ]}
                            >
                              <View style={styles.rowBetween}>
                                <Text
                                  style={styles.mediaOptionTitle}
                                >
                                  {config.label}
                                </Text>
                                {selected ? (
                                  <Ionicons
                                    name="checkmark"
                                    size={15}
                                    color="#111111"
                                  />
                                ) : null}
                              </View>

                              <Text style={styles.smallMuted}>
                                {getMediaDescription(
                                  config.action,
                                  config.description,
                                  language,
                                )}
                              </Text>

                              <View style={styles.rowBetween}>
                                <Text style={styles.smallMuted}>
                                  {config.configuration}
                                </Text>
                                <Text style={styles.smallMuted}>
                                  {capability.model || config.model}
                                </Text>
                              </View>

                              {estimate != null ? (
                                <Text style={styles.smallMuted}>
                                  {t.cost} : {formatCredits(estimate, language)} {t.credits}
                                </Text>
                              ) : null}
                            </Pressable>
                          );
                        })}
                    </ScrollView>

                    <TextInput
                      value={mediaPrompt}
                      onChangeText={setMediaPrompt}
                      placeholder={
                        (
                          getMediaGenerationConfig(
                            selectedMediaAction,
                          )?.type
                        ) === "video"
                          ? t.videoPrompt
                          : t.imagePrompt
                      }
                      multiline
                      editable={hasActivePack && !isThinking}
                      style={[
                        styles.mediaPrompt,
                        !hasActivePack && styles.mediaPromptLocked,
                      ]}
                    />

                    <View style={styles.rowBetween}>
                      <View style={styles.flex}>
                        {(() => {
                          const selected =
                            mediaCapabilities.find(
                              (item) =>
                                item.action === selectedMediaAction,
                            );

                          const estimate =
                            selected?.estimated_credits ??
                            selected?.credits;

                          return (
                            <Text style={styles.smallMuted}>
                              {estimate != null
                                ? `${t.cost} : ${formatCredits(
                                    estimate,
                                    language,
                                  )} ${t.credits}`
                                : language === "en"
                                  ? "Dynamic cost · calculated from actual API usage"
                                  : "Coût dynamique · calculé selon l'utilisation réelle de l'API"}
                            </Text>
                          );
                        })()}
                        <Text style={styles.smallMuted}>
                          {t.backendValidation}
                        </Text>
                      </View>

                      <Pressable
                        disabled={
                          !hasActivePack ||
                          !mediaPrompt.trim() ||
                          !selectedMediaAction ||
                          isThinking
                        }
                        onPress={() =>
                          void handleGenerateMedia()
                        }
                        style={[
                          styles.generateButton,
                          (!mediaPrompt.trim() ||
                            !selectedMediaAction ||
                            isThinking) &&
                            styles.generateButtonDisabled,
                        ]}
                      >
                        <Ionicons
                          name="sparkles"
                          size={15}
                          color="#ffffff"
                        />
                        <Text style={styles.generateButtonText}>
                          {isThinking
                            ? t.generating
                            : (
                                getMediaGenerationConfig(
                                  selectedMediaAction,
                                )?.type
                              ) === "video"
                              ? t.generateTheVideo
                              : t.generateTheImage}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            ) : null}

            <View style={styles.composer}>
              {attachments.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.attachmentsRow}
                >
                  {attachments.map((attachment) => (
                    <AttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      language={language}
                      onRemove={() =>
                        removeAttachment(attachment.id)
                      }
                    />
                  ))}
                </ScrollView>
              ) : null}

              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={
                  activeCapability === "Création"
                    ? t.creationPrompt
                    : t.messagePrompt
                }
                placeholderTextColor="#999999"
                editable={!isThinking}
                multiline
                textAlignVertical="top"
                style={[
                  styles.composerInput,
                  composerExpanded
                    ? styles.composerInputExpanded
                    : styles.composerInputCompact,
                ]}
                onFocus={() => setComposerExpanded(true)}
                onBlur={() => setComposerExpanded(false)}
                onSubmitEditing={(event) => {
                  if (Platform.OS === "ios") {
                    event.preventDefault();
                  }
                }}
              />

              <View style={styles.composerFooter}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.capabilityRow}
                >
                  <Pressable
                    style={styles.capabilityButton}
                    onPress={() => selectCapability("Fichier")}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={17}
                      color="#555555"
                    />
                    <Text style={styles.capabilityButtonText}>
                      {t.file}
                    </Text>
                    {attachments.length > 0 ? (
                      <Text style={styles.smallMuted}>
                        {attachments.length}/{MAX_ATTACHMENTS}
                      </Text>
                    ) : null}
                  </Pressable>

                  <Pressable
                    style={styles.capabilityButton}
                    onPress={() => selectCapability("Image")}
                  >
                    <Ionicons
                      name="image-outline"
                      size={17}
                      color="#555555"
                    />
                    <Text style={styles.capabilityButtonText}>
                      {t.image}
                    </Text>
                    {attachments.length > 0 ? (
                      <Text style={styles.smallMuted}>
                        {attachments.length}/{MAX_ATTACHMENTS}
                      </Text>
                    ) : null}
                  </Pressable>

                  <Pressable
                    style={styles.capabilityButton}
                    onPress={() => void pickCamera()}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={17}
                      color="#555555"
                    />
                    <Text style={styles.capabilityButtonText}>
                      {t.camera}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.capabilityButton,
                      activeCapability === "Recherche Web" &&
                        styles.capabilityActive,
                    ]}
                    onPress={() =>
                      selectCapability("Recherche Web")
                    }
                  >
                    <Ionicons
                      name="globe-outline"
                      size={17}
                      color={
                        activeCapability === "Recherche Web"
                          ? "#ffffff"
                          : "#555555"
                      }
                    />
                    <Text
                      style={[
                        styles.capabilityButtonText,
                        activeCapability === "Recherche Web" &&
                          styles.capabilityActiveText,
                      ]}
                    >
                      {t.webSearch}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.capabilityButton,
                      activeCapability === "Création" &&
                        styles.capabilityActive,
                    ]}
                    onPress={() =>
                      selectCapability("Création")
                    }
                  >
                    <Ionicons
                      name="videocam-outline"
                      size={17}
                      color={
                        activeCapability === "Création"
                          ? "#ffffff"
                          : "#555555"
                      }
                    />
                    <Text
                      style={[
                        styles.capabilityButtonText,
                        activeCapability === "Création" &&
                          styles.capabilityActiveText,
                      ]}
                    >
                      {t.creation}
                    </Text>
                  </Pressable>
                </ScrollView>

                <Pressable
                  style={[
                    styles.sendButton,
                    (!message.trim() &&
                      attachments.length === 0) ||
                    isThinking
                      ? styles.sendDisabled
                      : null,
                  ]}
                  disabled={
                    (!message.trim() &&
                      attachments.length === 0) ||
                    isThinking
                  }
                  onPress={() => void handleSendMessage()}
                >
                  {isThinking ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={19}
                      color="#ffffff"
                    />
                  )}
                </Pressable>
              </View>
            </View>

            <Text style={styles.disclaimer}>
              {interpolate(t.attachmentDisclaimer, {
                max: MAX_ATTACHMENTS,
              })}
            </Text>
          </View>

          <Modal
            visible={drawerVisible}
            transparent
            animationType="none"
            onRequestClose={closeDrawer}
          >
            <View style={styles.drawerOverlay}>
              <Animated.View
                style={[
                  styles.drawer,
                  {
                    width: drawerWidth,
                    transform: [{ translateX: drawerTranslateX }],
                  },
                ]}
                {...drawerPanResponder.panHandlers}
              >
                <View style={styles.drawerHeader}>
                  <View>
                    <Text style={styles.drawerBrand}>Oria</Text>
                    <Text style={styles.drawerSubtitle}>
                      Intelligence workspace
                    </Text>
                  </View>

                  <Pressable
                    style={styles.closeButton}
                    onPress={closeDrawer}
                  >
                    <Ionicons
                      name="close"
                      size={20}
                      color="#555555"
                    />
                  </Pressable>
                </View>

                <Pressable
                  style={styles.newConversationButton}
                  onPress={() => void createConversation()}
                >
                  <View style={styles.row}>
                    <Ionicons
                      name="add"
                      size={18}
                      color="#ffffff"
                    />
                    <Text style={styles.newConversationText}>
                      {t.newConversation}
                    </Text>
                  </View>
                  <Text style={styles.plusText}>+</Text>
                </Pressable>

                <Text style={styles.historyLabel}>
                  {t.history}
                </Text>

                <FlatList
                  data={conversations}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.historyList}
                  ListEmptyComponent={
                    <Text style={styles.smallMuted}>
                      {isLoadingConversations
                        ? t.loading
                        : t.noConversation}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() =>
                        void selectConversation(item.id)
                      }
                      style={[
                        styles.conversationItem,
                        item.id === activeConversationId &&
                          styles.conversationItemActive,
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={styles.conversationTitle}
                      >
                        {getDisplayConversationTitle(
                          item.title,
                          language,
                        )}
                      </Text>
                    </Pressable>
                  )}
                />

                <View style={styles.walletCard}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.smallMuted}>
                      {t.availableCredits}
                    </Text>
                    <Ionicons
                      name="wallet-outline"
                      size={16}
                      color="#666666"
                    />
                  </View>

                  <Text style={styles.walletBalance}>
                    {isLoadingWallet
                      ? "..."
                      : wallet
                        ? formatCredits(wallet.balance)
                        : "—"}
                  </Text>

                  <Text style={styles.smallMuted}>
                    {remainingDays !== null
                      ? interpolate(t.daysRemaining, { days: remainingDays })
                      : t.durationUnavailable}
                  </Text>
                </View>

                <View style={styles.drawerLinks}>
                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => {
                      closeDrawer();
                      router.push("/credits" as any);
                    }}
                  >
                    <Ionicons
                      name="wallet-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.myCredits}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => {
                      closeDrawer();
                      router.push("/mes_creations" as any);
                    }}
                  >
                    <Ionicons
                      name="images-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.myCreations}
                    </Text>
                    {generatedMedia.length > 0 ? (
                      <Text style={styles.drawerCount}>
                        {generatedMedia.length}
                      </Text>
                    ) : null}
                  </Pressable>

                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => {
                      closeDrawer();
                      router.push("/settings" as any);
                    }}
                  >
                    <Ionicons
                      name="settings-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.settings}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => void logout()}
                  >
                    <Ionicons
                      name="log-out-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.logout}
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>

              <Pressable
                style={styles.drawerBackdrop}
                onPress={closeDrawer}
              />
            </View>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f8f8f6",
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#f8f8f6",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e2",
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dfdfdc",
    backgroundColor: "#ffffff",
  },

  emptyMenuText: {
  color: "#8b8b95",
  fontSize: 14,
  paddingVertical: 12,
  paddingHorizontal: 14,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerOverline: {
    fontSize: 10,
    color: "#8a8a86",
    textTransform: "uppercase",
    letterSpacing: 1.3,
  },
  headerTitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: "#171715",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  creditPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#dfdfdc",
    backgroundColor: "#ffffff",
  },
  creditText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#222222",
  },
  profileButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dfdfdc",
    backgroundColor: "#ffffff",
  },
  profileLetter: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111111",
  },
  errorBox: {
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: "#eeeeeb",
    borderWidth: 1,
    borderColor: "#ddddda",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#4f4f4b",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
  },
  brandOverline: {
    fontSize: 10,
    color: "#8a8a86",
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  brandTitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    color: "#171715",
  },
  emptyHeading: {
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.2,
    fontWeight: "700",
    color: "#111111",
  },
  emptyDescription: {
    marginTop: 17,
    maxWidth: 370,
    fontSize: 14,
    lineHeight: 21,
    color: "#7b7b76",
  },
  messageListContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 34,
    gap: 18,
  },
  messageRow: {
    width: "100%",
  },
  messageRowUser: {
    alignItems: "flex-end",
  },
  messageRowAssistant: {
    alignItems: "flex-start",
  },
  messageActions: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
  },
  messageActionsUser: {
    justifyContent: "flex-end",
  },
  messageActionsAssistant: {
    justifyContent: "flex-start",
  },
  messageCopyButton: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  messageCopyText: {
    fontSize: 10,
    color: "#777771",
    fontWeight: "500",
  },
  messageBubble: {
    maxWidth: "91%",
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: "#111111",
    borderBottomRightRadius: 7,
  },
  assistantBubble: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e0e0dc",
    borderBottomLeftRadius: 7,
  },
  userText: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 21,
  },
  messageText: {
    color: "#1b1b19",
    fontSize: 14,
    lineHeight: 22,
  },
  inlineMathText: {
    color: "#1b1b19",
    fontSize: 14,
    lineHeight: 22,
    fontStyle: "italic",
  },
  mathBlock: {
    width: "100%",
    marginVertical: 5,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#f5f5f2",
    borderWidth: 1,
    borderColor: "#e2e2dd",
  },
  mathExpression: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 4,
    rowGap: 6,
  },
  mathText: {
    color: "#151513",
    fontSize: 15,
    lineHeight: 22,
  },
  fraction: {
    minWidth: 54,
    alignItems: "stretch",
    justifyContent: "center",
    marginHorizontal: 2,
  },
  fractionPart: {
    minHeight: 19,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  fractionText: {
    color: "#151513",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  fractionLine: {
    height: 1,
    backgroundColor: "#343430",
    width: "100%",
    minWidth: 40,
  },
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    backgroundColor: "#eeeeeb",
    color: "#222222",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
  },
  link: {
    textDecorationLine: "underline",
  },
  responseScrollArea: {
    flexGrow: 0,
    maxHeight: 430,
  },
  markdown: {
    gap: 8,
  },
  h1: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  h2: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  h3: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  listBlock: {
    gap: 7,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  bullet: {
    width: 15,
    fontSize: 16,
    lineHeight: 22,
    color: "#444440",
  },
  number: {
    width: 22,
    fontSize: 13,
    lineHeight: 22,
    color: "#666660",
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: "#999993",
    paddingLeft: 11,
  },
  quoteText: {
    color: "#686863",
    fontSize: 14,
    lineHeight: 22,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#deded9",
    marginVertical: 8,
  },
  codeBlock: {
    marginTop: 3,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#181816",
    borderWidth: 1,
    borderColor: "#292925",
  },
  codeHeader: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#33332f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeLanguage: {
    color: "#bcbcb4",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  copyButton: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: "#2b2b27",
  },
  copyText: {
    color: "#eeeeea",
    fontSize: 10,
    fontWeight: "600",
  },
  codeScrollArea: {
    flexGrow: 0,
    maxHeight: 360,
  },
  codeText: {
    color: "#f0f0ec",
    fontSize: 11,
    lineHeight: 18,
    padding: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  mediaMessage: {
    marginTop: 8,
    width: "91%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111111",
    borderWidth: 1,
    borderColor: "#deded9",
  },
  generatedImage: {
    width: "100%",
    height: 310,
    backgroundColor: "#eeeeeb",
  },
  video: {
    width: "100%",
    height: 310,
    backgroundColor: "#000000",
  },
  openMediaButton: {
    position: "absolute",
    right: 10,
    bottom: 10,
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  openMediaText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: 13,
    paddingBottom: Platform.OS === "ios" ? 6 : 10,
    backgroundColor: "#f8f8f6",
  },
  modelMenu: {
    marginBottom: 8,
    maxHeight: 280,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    padding: 6,
  },
  modelSelector: {
    alignSelf: "flex-start",
    minHeight: 39,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  modelSelectorText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#171715",
  },
  modelOption: {
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 11,
  },
  modelOptionActive: {
    backgroundColor: "#f0f0ed",
  },
  modelName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#171715",
  },
  modelDescription: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
    color: "#777771",
  },
  trialBadge: {
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: "#111111",
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "700",
  },
  smallMuted: {
    fontSize: 9,
    lineHeight: 14,
    color: "#83837d",
  },
  disabled: {
    opacity: 0.42,
  },
  capabilityBanner: {
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  capabilityIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eeeeeb",
  },
  capabilityTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#171715",
  },
  capabilityDescription: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 14,
    color: "#83837d",
  },
  mediaPanel: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    marginBottom: 8,
  },
  mediaLockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: "#F3F3F1",
    borderWidth: 1,
    borderColor: "#E2E2DE",
  },
  mediaLockedTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333333",
  },
  mediaLockedText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: "#777771",
  },
  mediaTypeButtonLocked: {
    opacity: 0.55,
  },
  mediaOptionLocked: {
    opacity: 0.55,
  },
  mediaPromptLocked: {
    opacity: 0.55,
    backgroundColor: "#F3F3F1",
  },
  mediaTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  mediaTypeButton: {
    flex: 1,
    minHeight: 84,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#ddddda",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  mediaTypeButtonActive: {
    backgroundColor: "#eeeeeb",
    borderColor: "#bdbdb8",
  },
  mediaTypeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#171715",
    textAlign: "center",
  },
  mediaSectionLabel: {
    marginTop: 12,
    marginBottom: 7,
    fontSize: 9,
    fontWeight: "600",
    color: "#777771",
  },
  horizontalOptions: {
    gap: 7,
    paddingRight: 10,
  },
  mediaOption: {
    width: 190,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddddda",
    gap: 5,
  },
  mediaOptionActive: {
    backgroundColor: "#eeeeeb",
    borderColor: "#bdbdb8",
  },
  mediaOptionTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: "#171715",
  },
  mediaPrompt: {
    marginTop: 10,
    minHeight: 85,
    maxHeight: 140,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#ddddda",
    color: "#171715",
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: "top",
  },
  generateButton: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  generateButtonDisabled: {
    opacity: 0.35,
  },
  generateButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  composer: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#cfcfca",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  attachmentsRow: {
    paddingHorizontal: 11,
    paddingTop: 10,
    gap: 7,
  },
  attachmentCard: {
    width: 205,
    minHeight: 58,
    padding: 6,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#deded9",
    backgroundColor: "#f7f7f4",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  attachmentImage: {
    width: 45,
    height: 45,
    borderRadius: 10,
  },
  fileIcon: {
    width: 45,
    height: 45,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eaeae6",
  },
  attachmentInfo: {
    flex: 1,
    minWidth: 0,
  },
  attachmentName: {
    fontSize: 10,
    fontWeight: "600",
    color: "#22221f",
  },
  removeAttachment: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  composerInput: {
    paddingHorizontal: 15,
    paddingTop: 11,
    paddingBottom: 9,
    color: "#171715",
    fontSize: 14,
    lineHeight: 21,
  },
  composerInputCompact: {
    minHeight: 48,
    maxHeight: 48,
  },
  composerInputExpanded: {
    minHeight: 92,
    maxHeight: 180,
  },
  composerFooter: {
    minHeight: 54,
    paddingHorizontal: 9,
    paddingBottom: 9,
    paddingTop: 2,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
  },
  capabilityRow: {
    alignItems: "center",
    gap: 2,
    paddingRight: 3,
  },
  capabilityButton: {
    minHeight: 37,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  capabilityButtonText: {
    fontSize: 10,
    color: "#555550",
  },
  capabilityActive: {
    backgroundColor: "#111111",
  },
  capabilityActiveText: {
    color: "#ffffff",
  },
  sendButton: {
    width: 39,
    height: 39,
    borderRadius: 14,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    opacity: 0.28,
  },
  disclaimer: {
    marginTop: 7,
    paddingHorizontal: 8,
    fontSize: 8,
    lineHeight: 13,
    color: "#8a8a85",
    textAlign: "center",
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  drawer: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 13,
    paddingTop: 18,
    paddingBottom: 12,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 3, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },
  drawerHeader: {
    paddingHorizontal: 5,
    paddingBottom: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  drawerBrand: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111111",
  },
  drawerSubtitle: {
    marginTop: 2,
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1.3,
    color: "#888882",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f1ee",
  },
  newConversationButton: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  newConversationText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  plusText: {
    color: "#ffffff",
    fontSize: 15,
    opacity: 0.5,
  },
  historyLabel: {
    marginTop: 20,
    marginBottom: 7,
    paddingHorizontal: 5,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    color: "#888882",
  },
  historyList: {
    gap: 2,
    paddingBottom: 12,
  },
  conversationItem: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 11,
  },
  conversationItemActive: {
    backgroundColor: "#eeeeeb",
  },
  conversationTitle: {
    fontSize: 12,
    color: "#565650",
  },
  walletCard: {
    marginTop: 8,
    padding: 13,
    borderRadius: 15,
    backgroundColor: "#f4f4f1",
    borderWidth: 1,
    borderColor: "#e1e1dc",
  },
  walletBalance: {
    marginTop: 7,
    fontSize: 22,
    fontWeight: "700",
    color: "#171715",
  },
  drawerLinks: {
    marginTop: 9,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e1e1dc",
    gap: 2,
  },
  drawerLink: {
    minHeight: 42,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  drawerLinkText: {
    flex: 1,
    fontSize: 12,
    color: "#555550",
  },
  drawerCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: "#e5e5e1",
    color: "#666660",
    fontSize: 9,
    textAlign: "center",
  },
});