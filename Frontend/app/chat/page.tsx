"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FileText,
  Globe,
  Image as ImageIcon,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Wallet,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import LogoutButton from "@/components/layout/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Conversation } from "@/types/lbv";

/*
 * ============================================================
 * CONFIGURATION API
 * ============================================================
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

/*
 * ============================================================
 * TYPES
 * ============================================================
 */

type WalletData = {
  balance: number;
  initial_credits: number;
  pack_id: string | null;
  pack_activated_at: string | null;
  pack_expires_at: string | null;
};

type ChatResponse = {
  success: boolean;
  action: string;
  cost: number;
  previous_balance: number;
  new_balance: number;
  consumed_credits: number;
  consumed_percentage: number;
  remaining_percentage: number;
  requires_warning: boolean;
  requires_critical_warning: boolean;
  response?: string;
  message?: string;
};

type MediaCapability = {
  action: string;
  type: "image" | "video";
  // Le backend peut exposer une estimation, mais le coût final est dynamique.
  estimated_credits?: number | null;
  credits?: number | null; // compatibilité temporaire avec une ancienne réponse API
  model?: string | null;
  quality?: string | null;
  seconds?: number | string | null;
  size?: string | null;
};

type MediaCapabilitiesResponse = {
  success: boolean;
  pack_id: string | null;
  media: MediaCapability[];
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

type ConversationResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: ChatMessage[];
};

/**
 * Pièce jointe sélectionnée dans le composer.
 *
 * Le frontend accepte jusqu'à 3 fichiers/images par message.
 * Les vrais objets File sont transmis au backend en
 * multipart/form-data. Maximum : 3 pièces par message.
 */
type ChatAttachment = {
  id: string;
  file: File;
  kind: "image" | "file";
  previewUrl: string | null;
};

const MAX_ATTACHMENTS = 3;


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    file: "Fichier",
    image: "Image",
    webSearch: "Recherche Web",
    creation: "Création",
    newConversation: "Nouvelle conversation",
    history: "Historique",
    loading: "Chargement...",
    noConversation: "Aucune conversation pour le moment.",
    availableCredits: "Crédits disponibles",
    daysRemaining: "jours restants",
    durationUnavailable: "Durée indisponible",
    myCredits: "Mes crédits",
    myCreations: "Mes créations",
    settings: "Paramètres",
    activeConversation: "Conversation active",
    credits: "Crédits",
    profile: "Profil",
    closeMenu: "Fermer le menu",
    openMenu: "Ouvrir le menu",
    howCanIHelp: "Comment puis-je vous aider ?",
    welcomeDescription: "Discutez avec les modèles disponibles et utilisez la recherche Web directement depuis votre espace.",
    download: "Télécharger",
    downloadCreation: "Télécharger cette création",
    model: "Modèle",
    trial: "Essai",
    noModel: "Aucun modèle disponible avec ce pack.",
    webEnabled: "Recherche Web activée",
    webEnabledDescription: "La recherche Web reste active pour les prochains messages jusqu'à sa désactivation.",
    disableWeb: "Désactiver la recherche Web",
    mediaCreation: "Création média",
    mediaCreationDescription: "Choisissez Image ou Vidéo, puis la configuration avant de générer.",
    closeMediaCreation: "Fermer la création média",
    generateImage: "Générer une image",
    generateVideo: "Générer une vidéo",
    generationConfiguration: "Configuration de génération",
    creditsUnit: "crédits",
    generation: "Génération...",
    generateTheVideo: "Générer la vidéo",
    generateTheImage: "Générer l'image",
    describeCreation: "Décrivez votre création...",
    writeToOria: "Écrivez à Oria...",
    comingSoon: "Arrive bientôt",
    send: "Envoyer",
    attachmentsHelp: "fichiers ou images peuvent être joints à un message. Les créations image et vidéo dépendent du pack actif.",
    copy: "Copier",
    copied: "Copié",
    copyMessage: "Copier le message",
    mathExpression: "Expression mathématique",
    trialExhausted: "Les 5 essais de ce modèle sont épuisés.",
    superiorModelTrial: "{UI[language].superiorModelTrial}",
    generatedImageAlt: "Image générée par Oria",
    configuration: "configuration",
    configurations: "configurations",
    preciseVideo: "Décrivez précisément la vidéo à créer...",
    preciseImage: "Décrivez précisément l'image à créer...",
    backendValidation: "Oria réserve une estimation, puis facture uniquement le coût réel de la génération.",
  },
  en: {
    file: "File",
    image: "Image",
    webSearch: "Web Search",
    creation: "Create",
    newConversation: "New conversation",
    history: "History",
    loading: "Loading...",
    noConversation: "No conversations yet.",
    availableCredits: "Available credits",
    daysRemaining: "days remaining",
    durationUnavailable: "Duration unavailable",
    myCredits: "My credits",
    myCreations: "My creations",
    settings: "Settings",
    activeConversation: "Active conversation",
    credits: "Credits",
    profile: "Profile",
    closeMenu: "Close menu",
    openMenu: "Open menu",
    howCanIHelp: "How can I help you?",
    welcomeDescription: "Chat with the available models and use Web Search directly from your workspace.",
    download: "Download",
    downloadCreation: "Download this creation",
    model: "Model",
    trial: "Trial",
    noModel: "No model is available with this pack.",
    webEnabled: "Web Search enabled",
    webEnabledDescription: "Web Search stays enabled for your next messages until you turn it off.",
    disableWeb: "Disable Web Search",
    mediaCreation: "Media creation",
    mediaCreationDescription: "Choose Image or Video, then select the configuration before generating.",
    closeMediaCreation: "Close media creation",
    generateImage: "Generate an image",
    generateVideo: "Generate a video",
    generationConfiguration: "Generation configuration",
    creditsUnit: "credits",
    generation: "Generating...",
    generateTheVideo: "Generate video",
    generateTheImage: "Generate image",
    describeCreation: "Describe your creation...",
    writeToOria: "Message Oria...",
    comingSoon: "Coming soon",
    send: "Send",
    attachmentsHelp: "files or images can be attached to a message. Image and video creation depends on your active pack.",
    copy: "Copy",
    copied: "Copied",
    copyMessage: "Copy message",
    mathExpression: "Math expression",
    trialExhausted: "The 5 trials for this model have been used.",
    superiorModelTrial: "Higher model · 5 trials maximum",
    generatedImageAlt: "Image generated by Oria",
    configuration: "configuration",
    configurations: "configurations",
    preciseVideo: "Describe the video you want to create...",
    preciseImage: "Describe the image you want to create...",
    backendValidation: "Oria reserves an estimate, then charges only the actual generation cost.",
  },
} as const;

function localizeFrontendError(message: string, language: OriaLanguage): string {
  if (language === "fr") return message;

  const exact: Record<string, string> = {
    "Utilisateur non authentifié.": "User not authenticated.",
    "Session expirée. Veuillez vous reconnecter.": "Your session has expired. Please sign in again.",
    "Une erreur est survenue avec le serveur.": "A server error occurred.",
    "Le serveur n'a pas fourni de flux de réponse.": "The server did not provide a response stream.",
    "Impossible de charger les crédits.": "Unable to load credits.",
    "Serveur indisponible. Les données locales restent disponibles.": "Server unavailable. Local data is still available.",
    "Conversation créée localement. Synchronisation cloud en attente.": "Conversation created locally. Cloud sync is pending.",
    "Impossible de charger les messages cloud. Les données locales restent affichées.": "Unable to load cloud messages. Local data remains visible.",
    "Téléchargement impossible.": "Download failed.",
    "Aucune option de création n'est disponible.": "No creation option is available.",
    "Cette option de création n'existe pas.": "This creation option does not exist.",
    "La génération du média a échoué.": "Media generation failed.",
    "Le serveur a généré le média mais n'a retourné aucune URL exploitable.": "The server generated the media but returned no usable URL.",
    "Le serveur a généré le média mais n'a retourné aucun identifiant.": "The server generated the media but returned no identifier.",
    "La création média a échoué.": "Media creation failed.",
    "Les essais gratuits de ce modèle sont épuisés.": "The free trials for this model have been used.",
    "Conversation sauvegardée localement. La synchronisation cloud sera réessayée.": "Conversation saved locally. Cloud sync will be retried.",
    "Message conservé localement. Synchronisation cloud en attente.": "Message kept locally. Cloud sync is pending.",
    "Le service IA n'a retourné aucun contenu.": "The AI service returned no content.",
    "Réponse IA conservée localement. Synchronisation cloud en attente.": "AI response kept locally. Cloud sync is pending.",
    "Erreur pendant le streaming IA.": "An error occurred while streaming the AI response.",
  };

  if (exact[message]) return exact[message];

  return message
    .replace("Les données locales restent disponibles.", "Local data is still available.")
    .replace("Les messages locaux restent affichés.", "Local messages remain visible.");
}


function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") return "fr";

  const saved = window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY);
  if (saved === "fr" || saved === "en") return saved;

  return window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr";
}

function getModelDescription(modelId: string, language: OriaLanguage): string {
  const descriptions: Record<string, { fr: string; en: string }> = {
    luna: {
      fr: "Modèle économique · Rapide pour les échanges courants",
      en: "Efficient model · Fast for everyday conversations",
    },
    "gpt-5": {
      fr: "Modèle polyvalent · Pour les tâches plus avancées",
      en: "Versatile model · For more advanced tasks",
    },
    "gpt-5.6-terra": {
      fr: "Raisonnement avancé · Pour les problèmes complexes",
      en: "Advanced reasoning · For complex problems",
    },
    "gpt-6-sol": {
      fr: "Puissance maximale · Pour les tâches les plus exigeantes",
      en: "Maximum capability · For the most demanding tasks",
    },
    "gpt-6-astra": {
      fr: "Modèle haut de gamme · Pour les usages les plus avancés",
      en: "High-end model · For the most advanced use cases",
    },
  };

  return descriptions[modelId]?.[language] ?? "";
}

function getMediaDescription(action: string, language: OriaLanguage, fallback: string): string {
  if (language === "fr") return fallback;

  const descriptions: Record<string, string> = {
    image_480: "Light image generation",
    image_720: "Light image generation",
    image_pro: "Professional image generation",
    image_pro_standard: "Standard professional quality",
    image_pro_ultra: "Maximum professional quality",
    image_business: "Business image generation",
    image_business_hd: "High-definition business generation",
    image_business_ultra: "Maximum business generation",
    video_4s: "Light video generation",
    video_8s: "Light video generation",
    video_lite: "Intermediate video generation",
    video_pro_fast: "Fast professional video generation",
    video_pro_standard: "Standard professional video generation",
    video_pro_extension: "Extend a Pro video generation",
    video_business_fast: "Fast business video generation",
    video_business_standard: "Standard business video generation",
    video_business_long: "Long business video generation",
  };

  return descriptions[action] ?? fallback;
}

function getMediaLabel(action: string, language: OriaLanguage, fallback: string): string {
  if (language === "fr") return fallback;
  return fallback
    .replace(/^Vidéo /, "Video ")
    .replace(/ 4 s$/, " 4s")
    .replace(/ 8 s$/, " 8s");
}


const MEDIA_GENERATION_CONFIGS = [
  {
    action: "image_480", type: "image", label: "Image Essentielle",
    description: "Génération rapide avec GPT Image 2", configuration: "Qualité basse",
    packs: ["light_pack"], model: "GPT Image 2",
  },
  {
    action: "image_720", type: "image", label: "Image Plus",
    description: "Génération équilibrée avec GPT Image 2", configuration: "Qualité moyenne",
    packs: ["light_pack", "intermediate_pack"], model: "GPT Image 2",
  },
  {
    action: "image_pro", type: "image", label: "Image Pro",
    description: "Génération professionnelle avec GPT Image 2.5 Flare", configuration: "Qualité basse",
    packs: ["pro_pack"], model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_pro_standard", type: "image", label: "Image Pro HD",
    description: "Rendu professionnel détaillé", configuration: "Qualité haute",
    packs: ["pro_pack"], model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_pro_ultra", type: "image", label: "Image Pro Ultra",
    description: "Rendu professionnel très haute qualité", configuration: "Qualité XHigh",
    packs: ["pro_pack"], model: "GPT Image 2.5 Flare",
  },
  {
    action: "image_business", type: "image", label: "Image Business",
    description: "Création premium avec GPT Image 2.5 Sunburst", configuration: "Qualité moyenne",
    packs: ["business_pack"], model: "GPT Image 2.5 Sunburst",
  },
  {
    action: "image_business_hd", type: "image", label: "Image Business HD",
    description: "Création premium haute définition", configuration: "Qualité XHigh",
    packs: ["business_pack"], model: "GPT Image 2.5 Sunburst",
  },
  {
    action: "image_business_ultra", type: "image", label: "Image Business Max",
    description: "Qualité maximale pour les créations exigeantes", configuration: "Qualité Max",
    packs: ["business_pack"], model: "GPT Image 2.5 Sunburst",
  },

  {
    action: "video_4s", type: "video", label: "Vidéo 4 s",
    description: "Génération vidéo OpenAI courte", configuration: "4 secondes · 720p",
    packs: ["light_pack"], model: "Sora 2",
  },
  {
    action: "video_8s", type: "video", label: "Vidéo 8 s",
    description: "Génération vidéo OpenAI étendue", configuration: "8 secondes · 720p",
    packs: ["light_pack"], model: "Sora 2",
  },
  {
    action: "video_lite", type: "video", label: "Vidéo Lite",
    description: "Génération vidéo intermédiaire", configuration: "4 secondes · 720p",
    packs: ["intermediate_pack"], model: "Sora 2",
  },
  {
    action: "video_pro_fast", type: "video", label: "Vidéo Pro Fast",
    description: "Génération professionnelle rapide", configuration: "4 secondes · 720p",
    packs: ["pro_pack"], model: "Sora 2",
  },
  {
    action: "video_pro_standard", type: "video", label: "Vidéo Pro Standard",
    description: "Génération professionnelle standard", configuration: "8 secondes · 720p",
    packs: ["pro_pack"], model: "Sora 2",
  },
  {
    action: "video_pro_extension", type: "video", label: "Vidéo Pro Extension",
    description: "Extension d'une génération Pro", configuration: "4 secondes · 720p",
    packs: ["pro_pack"], model: "Sora 2",
  },
  {
    action: "video_business_fast", type: "video", label: "Vidéo Business Fast",
    description: "Génération premium rapide", configuration: "4 secondes",
    packs: ["business_pack"], model: "Sora 2 Pro",
  },
  {
    action: "video_business_standard", type: "video", label: "Vidéo Business Standard",
    description: "Génération premium standard", configuration: "8 secondes",
    packs: ["business_pack"], model: "Sora 2 Pro",
  },
  {
    action: "video_business_long", type: "video", label: "Vidéo Business Long",
    description: "Génération premium longue", configuration: "12 secondes",
    packs: ["business_pack"], model: "Sora 2 Pro",
  },
] as const;

function getLocalMediaCapabilities(packId: string | null): MediaCapability[] {
  if (!packId) return [];

  return MEDIA_GENERATION_CONFIGS
    .filter((item) => item.packs.includes(packId as never))
    .map((item) => ({
      action: item.action,
      type: item.type,
      model: item.model,
    }));
}

type MediaGenerationType = (typeof MEDIA_GENERATION_CONFIGS)[number]["type"];

function getMediaGenerationConfig(action: string) {
  return MEDIA_GENERATION_CONFIGS.find((item) => item.action === action);
}

const ORIA_MEDIA_MARKER_REGEX =
  /\[\[ORIA_MEDIA_ID:([^\]]+)\]\]/;

function buildMediaMessageContent(
  type: "image" | "video",
  action: string,
  mediaId: string,
): string {
  return `${type === "image" ? "Image" : "Vidéo"} générée · ${action}
[[ORIA_MEDIA_ID:${mediaId}]]`;
}

function extractMediaIdFromMessage(
  content: string,
): string | null {
  return (
    content.match(
      ORIA_MEDIA_MARKER_REGEX,
    )?.[1] ?? null
  );
}

function getVisibleMessageContent(
  content: string,
): string {
  return content
    .replace(
      /\s*\[\[ORIA_MEDIA_ID:[^\]]+\]\]\s*$/g,
      "",
    )
    .trimEnd();
}


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

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isAcceptedAttachment(file: File) {
  return (
    ACCEPTED_FILE_TYPES.includes(file.type) ||
    ACCEPTED_IMAGE_TYPES.includes(file.type)
  );
}


/*
 * ============================================================
 * CACHE LOCAL
 * ============================================================
 */

type LocalChatCache = {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
  selectedModel: string;
  activeCapability: string | null;
  savedAt: string;
};

const LOCAL_CACHE_PREFIX =
  "oria_chat_cache_v1";

function getLocalCacheKey(userId: string) {
  return `${LOCAL_CACHE_PREFIX}_${userId}`;
}

function readLocalCache(
  userId: string,
): LocalChatCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(
      getLocalCacheKey(userId),
    );

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    return {
      conversations: Array.isArray(
        parsed?.conversations,
      )
        ? parsed.conversations
        : [],

      messages:
        parsed?.messages &&
        typeof parsed.messages === "object"
          ? parsed.messages
          : {},

      activeConversationId:
        typeof parsed?.activeConversationId ===
        "string"
          ? parsed.activeConversationId
          : null,

      selectedModel:
        typeof parsed?.selectedModel === "string"
          ? parsed.selectedModel
          : "luna",

      activeCapability:
        typeof parsed?.activeCapability ===
        "string"
          ? parsed.activeCapability
          : null,

      savedAt:
        typeof parsed?.savedAt === "string"
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      "Erreur lecture cache Oria :",
      error,
    );

    return null;
  }
}

function writeLocalCache(
  userId: string,
  cache: Omit<LocalChatCache, "savedAt">,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const payload: LocalChatCache = {
      ...cache,
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      getLocalCacheKey(userId),
      JSON.stringify(payload),
    );
  } catch (error) {
    console.error(
      "Erreur sauvegarde cache Oria :",
      error,
    );
  }
}

function removeLocalCache(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(
      getLocalCacheKey(userId),
    );
  } catch (error) {
    console.error(
      "Erreur suppression cache Oria :",
      error,
    );
  }
}

/*
 * ============================================================
 * CAPACITÉS
 * ============================================================
 */

const capabilities = [
  {
    label: "Fichier",
    icon: FileText,
    disabled: false,
  },
  {
    label: "Image",
    icon: ImageIcon,
    disabled: false,
  },
  {
    label: "Recherche Web",
    icon: Globe,
    disabled: false,
  },
  {
    label: "Création",
    icon: Video,
    disabled: false,
  },
];

/*
 * ============================================================
 * MODÈLES
 * ============================================================
 */

type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  packs: string[];
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

function getAvailableModels(
  packId: string | null,
): ModelDefinition[] {
  if (!packId) {
    return [];
  }

  return models.filter((model) =>
    model.packs.includes(packId),
  );
}

const TRIAL_MODEL_BY_PACK: Record<string, string> = {
  light_pack: "gpt-5",
  intermediate_pack: "gpt-5.6-terra",
  pro_pack: "gpt-6-astra",
};

function getSelectableModels(
  packId: string | null,
  trials: Record<string, TrialInfo>,
): ModelDefinition[] {
  const normalModels =
    getAvailableModels(packId);

  if (!packId) {
    return [];
  }

  const selectable = [...normalModels];
  const normalIds = new Set(
    normalModels.map(
      (model) => model.id,
    ),
  );

  // Un seul modèle supérieur est proposé en essai pour
  // chaque pack inférieur : 5 essais maximum.
  const trialModelId =
    TRIAL_MODEL_BY_PACK[packId];

  if (trialModelId && !normalIds.has(trialModelId)) {
    const trialModel = models.find(
      (model) =>
        model.id === trialModelId,
    );

    const trial = trials[trialModelId];

    if (trialModel && trial) {
      selectable.push(trialModel);
    }
  }

  return selectable;
}

/*
 * ============================================================
 * SUPABASE
 * ============================================================
 */

const supabase = createClient();

/*
 * ============================================================
 * API AUTHENTIFIÉE
 * ============================================================
 */

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || !session.access_token) {
    throw new Error(
      "Utilisateur non authentifié.",
    );
  }

  const headers = new Headers(
    options?.headers,
  );

  if (
    options?.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  headers.set(
    "user-id",
    session.user.id,
  );

  headers.set(
    "authorization",
    `Bearer ${session.access_token}`,
  );

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers,
    },
  );

  if (!response.ok) {
    const error =
      await response.json().catch(
        () => null,
      );

    if (response.status === 401) {
      throw new Error(
        "Session expirée. Veuillez vous reconnecter.",
      );
    }

    throw new Error(
      error?.detail ||
        "Une erreur est survenue avec le serveur.",
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
): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/*
 * ============================================================
 * API STREAMING AUTHENTIFIÉE
 * ============================================================
 */

async function apiStreamFetch(
  path: string,
  formData: FormData,
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || !session.access_token) {
    throw new Error(
      "Utilisateur non authentifié.",
    );
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      method: "POST",
      headers: {
        "user-id": session.user.id,
        authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const error =
      await response.json().catch(
        () => null,
      );

    if (response.status === 401) {
      throw new Error(
        "Session expirée. Veuillez vous reconnecter.",
      );
    }

    throw new Error(
      error?.detail ||
        "Une erreur est survenue avec le serveur.",
    );
  }

  if (!response.body) {
    throw new Error(
      "Le serveur n'a pas fourni de flux de réponse.",
    );
  }

  return response;
}

/*
 * ============================================================
 * SYNCHRONISATION BACKEND
 * ============================================================
 */

async function createConversationRemote(
  title: string,
): Promise<Conversation> {
  const data =
    await apiFetch<
      Conversation | {
        conversation: Conversation;
      }
    >(
      "/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          title,
        }),
      },
    );

  if (
    "conversation" in data &&
    data.conversation
  ) {
    return data.conversation;
  }

  return data as Conversation;
}

async function saveMessageRemote(
  message: ChatMessage,
): Promise<ChatMessage | null> {
  const data =
    await apiFetch<
      ChatMessage | {
        message: ChatMessage;
      }
    >(
      `/conversations/${message.conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          role: message.role,
          content: message.content,
        }),
      },
    );

  if (
    "message" in data &&
    data.message
  ) {
    return data.message;
  }

  return data as ChatMessage;
}

/*
 * ============================================================
 * MARKDOWN INLINE
 * ============================================================
 *
 * Renderer volontairement léger et sans dépendance externe.
 *
 * Il permet notamment :
 *
 * **gras**
 * *italique*
 * `code`
 * [lien](https://...)
 */

function decodeLatexGroup(value: string): string {
  return value
    .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbf\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\operatorname\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\cdot/g, " · ")
    .replace(/\\times/g, " × ")
    .replace(/\\div/g, " ÷ ")
    .replace(/\\pm/g, " ± ")
    .replace(/\\mp/g, " ∓ ")
    .replace(/\\leq/g, " ≤ ")
    .replace(/\\geq/g, " ≥ ")
    .replace(/\\neq/g, " ≠ ")
    .replace(/\\approx/g, " ≈ ")
    .replace(/\\infty/g, "∞")
    .replace(/\\pi/g, "π")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\sqrt\s*([^\s]+)/g, "√($1)")
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/_\{([^{}]+)\}/g, "_($1)")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\quad/g, " ")
    .replace(/\\qquad/g, " ")
    .replace(/\\([{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMathReadable(expression: string): string {
  let value = expression.trim();

  // Common malformed output from some models, e.g. \\text[Centre}.
  value = value.replace(/\\text\[([^\]]+)\}/g, "$1");

  // Resolve simple fractions repeatedly, including text/groups already decoded.
  let previous = "";
  while (previous !== value) {
    previous = value;
    value = value.replace(
      /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      "($1) ÷ ($2)",
    );
  }

  value = decodeLatexGroup(value);

  // Make powers readable without exposing LaTeX syntax.
  const superscripts: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    "n": "ⁿ", "i": "ⁱ",
  };
  value = value.replace(/\^\(([^)]+)\)/g, (_, exponent: string) =>
    exponent.split("").map((char) => superscripts[char] ?? char).join(""),
  );
  value = value.replace(/_\(([^)]+)\)/g, (_, subscript: string) => `_${subscript}`);
  value = value.replace(/\^([A-Za-z0-9])/g, (_, exponent: string) => superscripts[exponent] ?? exponent);

  // Clean leftover commands/braces and normalize operators.
  value = value
    .replace(/\\text/g, "")
    .replace(/\\frac/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s*([=+\-×÷±≤≥≠≈])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function renderMathToken(expression: string, key: string) {
  const readable = makeMathReadable(expression);

  return (
    <span
      key={key}
      className="mx-0.5 rounded-md bg-surface-secondary px-1.5 py-0.5 font-mono text-[0.95em]"
      title="Math"
    >
      {readable}
    </span>
  );
}

function renderInlineMarkdown(
  text: string,
) {
  const parts: ReactNode[] = [];

  let remaining = text;
  let index = 0;

  const tokenRegex =
    /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$[^$]+\$|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

  while (remaining.length > 0) {
    const match =
      remaining.match(tokenRegex);

    if (!match || match.index === undefined) {
      parts.push(
        <span key={index}>
          {remaining}
        </span>,
      );

      break;
    }

    if (match.index > 0) {
      parts.push(
        <span key={index}>
          {remaining.slice(
            0,
            match.index,
          )}
        </span>,
      );

      index++;
    }

    const token = match[0];

    /*
     * MATHS INLINE
     */

    if (
      (token.startsWith("\\[") && token.endsWith("\\]")) ||
      (token.startsWith("$$") && token.endsWith("$$")) ||
      (token.startsWith("\\(") && token.endsWith("\\)")) ||
      (token.startsWith("$") && token.endsWith("$"))
    ) {
      const expression = token.startsWith("$$")
        ? token.slice(2, -2)
        : token.startsWith("$")
          ? token.slice(1, -1)
          : token.slice(2, -2);

      parts.push(renderMathToken(expression, String(index)));
    }

    /*
     * GRAS
     */

    else if (
      token.startsWith("**") &&
      token.endsWith("**")
    ) {
      parts.push(
        <strong
          key={index}
          className="font-semibold"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    }

    /*
     * CODE INLINE
     */

    else if (
      token.startsWith("`") &&
      token.endsWith("`")
    ) {
      parts.push(
        <code
          key={index}
          className="rounded-md bg-surface-tertiary px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }

    /*
     * LIEN
     */

    else if (
      token.startsWith("[")
    ) {
      const linkMatch =
        token.match(
          /^\[([^\]]+)\]\(([^)]+)\)$/,
        );

      if (linkMatch) {
        const [, label, url] =
          linkMatch;

        parts.push(
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:opacity-70"
          >
            {label}
          </a>,
        );
      }
    }

    /*
     * ITALIQUE
     */

    else if (
      token.startsWith("*") &&
      token.endsWith("*")
    ) {
      parts.push(
        <em key={index}>
          {token.slice(1, -1)}
        </em>,
      );
    }

    remaining =
      remaining.slice(
        match.index +
          token.length,
      );

    index++;
  }

  return parts;
}

/*
 * ============================================================
 * MARKDOWN BLOCK RENDERER
 * ============================================================
 *
 * Transforme le texte brut de l'IA en vraie structure visuelle.
 *
 * Gestion :
 *
 * - paragraphes
 * - titres
 * - listes à puces
 * - listes numérotées
 * - blocs de code
 * - citations
 * - séparateurs
 * - Markdown inline
 */

function CopyButton({
  value,
  language = "fr",
}: {
  value: string;
  language?: OriaLanguage;
}) {
  const [copied, setCopied] =
    useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        value,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground"
      aria-label={UI[language].copy}
      title={UI[language].copy}
    >
      {copied ? UI[language].copied : UI[language].copy}
    </button>
  );
}

function MessageCopyButton({
  value,
  language = "fr",
}: {
  value: string;
  language?: OriaLanguage;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground"
      aria-label={UI[language].copyMessage}
      title={UI[language].copyMessage}
    >
      {copied ? <Check size={13} /> : null}
      {copied ? UI[language].copied : UI[language].copy}
    </button>
  );
}

/*
 * ============================================================
 * MARKDOWN MESSAGE
 * ============================================================
 */

function MarkdownMessage({
  content,
  language = "fr",
}: {
  content: string;
  language?: OriaLanguage;
}) {
  const normalized =
    content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const lines =
    normalized.split("\n");

  const blocks: ReactNode[] =
    [];

  let paragraph: string[] = [];

  let bulletItems: string[] =
    [];

  let numberedItems: string[] =
    [];

  let codeLines: string[] =
    [];

  let codeLanguage = "";

  let inCodeBlock = false;

  let blockIndex = 0;

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    const text =
      paragraph.join(" ");

    blocks.push(
      <p
        key={`paragraph-${blockIndex}`}
        className="mb-4 last:mb-0"
      >
        {renderInlineMarkdown(
          text,
        )}
      </p>,
    );

    blockIndex++;
    paragraph = [];
  }

  function flushBulletList() {
    if (bulletItems.length === 0) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ul
        key={`bullet-${blockIndex}`}
        className="mb-4 list-disc space-y-2 pl-6 last:mb-0"
      >
        {bulletItems.map(
          (item, index) => (
            <li
              key={`bullet-item-${index}`}
              className="pl-1"
            >
              {renderInlineMarkdown(
                item,
              )}
            </li>
          ),
        )}
      </ul>,
    );

    blockIndex++;
    bulletItems = [];
  }

  function flushNumberedList() {
    if (
      numberedItems.length ===
      0
    ) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ol
        key={`numbered-${blockIndex}`}
        className="mb-4 list-decimal space-y-2 pl-6 last:mb-0"
      >
        {numberedItems.map(
          (item, index) => (
            <li
              key={`numbered-item-${index}`}
              className="pl-1"
            >
              {renderInlineMarkdown(
                item,
              )}
            </li>
          ),
        )}
      </ol>,
    );

    blockIndex++;
    numberedItems = [];
  }

  function flushAllLists() {
    flushBulletList();
    flushNumberedList();
  }

  function flushCodeBlock() {
    if (!inCodeBlock) {
      return;
    }

    blocks.push(
      <div
        key={`code-${blockIndex}`}
        className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-secondary last:mb-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            {codeLanguage || "Code"}
          </span>

          <CopyButton
            value={codeLines.join("\n")}
            language={language}
          />
        </div>

        <div className="max-h-[360px] overflow-auto">
          <pre className="min-w-max p-4 text-xs leading-6">
            <code>
              {codeLines.join("\n")}
            </code>
          </pre>
        </div>
      </div>,
    );

    blockIndex++;
    codeLines = [];
    codeLanguage = "";
    inCodeBlock = false;
  }

  lines.forEach(
    (line, index) => {
      const trimmed =
        line.trim();

      /*
       * BLOC DE CODE
       */

      if (
        trimmed.startsWith("```")
      ) {
        if (!inCodeBlock) {
          flushAllLists();
          flushParagraph();

          inCodeBlock = true;

          codeLanguage =
            trimmed
              .slice(3)
              .trim();

          return;
        }

        flushCodeBlock();
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      /*
       * LIGNE VIDE
       */

      if (trimmed === "") {
        flushAllLists();
        flushParagraph();
        return;
      }

      /*
       * SÉPARATEUR
       */

      if (
        /^(-{3,}|\*{3,}|_{3,})$/.test(
          trimmed,
        )
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <hr
            key={`hr-${blockIndex}`}
            className="my-6 border-border"
          />,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H2
       */

      if (
        trimmed.startsWith("## ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h2
            key={`h2-${blockIndex}`}
            className="mb-3 mt-7 text-xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(3),
            )}
          </h2>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H3
       */

      if (
        trimmed.startsWith("### ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h3
            key={`h3-${blockIndex}`}
            className="mb-2 mt-6 text-base font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(4),
            )}
          </h3>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H1
       */

      if (
        trimmed.startsWith("# ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h1
            key={`h1-${blockIndex}`}
            className="mb-4 mt-7 text-2xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(2),
            )}
          </h1>,
        );

        blockIndex++;
        return;
      }

      /*
       * LISTE À PUCES
       */

      const bulletMatch =
        trimmed.match(
          /^[-*•]\s+(.+)$/,
        );

      if (bulletMatch) {
        flushParagraph();
        flushNumberedList();

        bulletItems.push(
          bulletMatch[1],
        );

        return;
      }

      /*
       * LISTE NUMÉROTÉE
       */

      const numberedMatch =
        trimmed.match(
          /^\d+[.)]\s+(.+)$/,
        );

      if (numberedMatch) {
        flushParagraph();
        flushBulletList();

        numberedItems.push(
          numberedMatch[1],
        );

        return;
      }

      /*
       * CITATION
       */

      if (
        trimmed.startsWith("> ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <blockquote
            key={`quote-${blockIndex}`}
            className="mb-4 border-l-2 border-border-strong pl-4 text-muted-strong last:mb-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(2),
            )}
          </blockquote>,
        );

        blockIndex++;
        return;
      }

      /*
       * PARAGRAPHE
       *
       * On conserve les phrases d'une même ligne logique
       * ensemble, puis on les espace lors du rendu.
       */

      flushAllLists();

      paragraph.push(
        trimmed,
      );
    },
  );

  /*
   * Fermeture des éventuels blocs restants.
   */

  if (inCodeBlock) {
    flushCodeBlock();
  }

  flushAllLists();
  flushParagraph();

  /*
   * Si le modèle est encore en train de streamer et que le
   * contenu est vide, on évite un conteneur inutile.
   */

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="break-words text-[14px] leading-7">
      {blocks}
    </div>
  );
}

/*
 * ============================================================
 * PAGE CHAT
 * ============================================================
 */

export default function ChatPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
    };

    syncLanguage();

    window.addEventListener("storage", syncLanguage);
    window.addEventListener("oria-language-change", syncLanguage);

    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener("oria-language-change", syncLanguage);
    };
  }, []);

  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [modelMenuOpen, setModelMenuOpen] =
    useState(false);

  const [selectedModel, setSelectedModel] =
    useState("luna");

  const [message, setMessage] =
    useState("");

  const [attachments, setAttachments] =
    useState<ChatAttachment[]>([]);

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const imageInputRef =
    useRef<HTMLInputElement>(null);

  const [messages, setMessages] =
    useState<ChatMessage[]>([]);

  const [isThinking, setIsThinking] =
    useState(false);

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [
    activeConversationId,
    setActiveConversationId,
  ] = useState<string | null>(null);

  const [
    activeCapability,
    setActiveCapability,
  ] = useState<string | null>(null);

  const [wallet, setWallet] =
    useState<WalletData | null>(null);

  const [trials, setTrials] =
    useState<Record<string, TrialInfo>>({});

  const [isLoadingTrials, setIsLoadingTrials] =
    useState(true);

  const [isLoadingWallet, setIsLoadingWallet] =
    useState(true);

  const [
    isLoadingConversations,
    setIsLoadingConversations,
  ] = useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [
    isInitialized,
    setIsInitialized,
  ] = useState(false);

  const [
    currentUserId,
    setCurrentUserId,
  ] = useState<string | null>(null);

  // Les configurations locales permettent au bouton « Création »
  // de rester immédiatement utilisable. Le backend reste l'autorité
  // finale pour le pack, les droits, le coût et le débit.
  const [mediaCapabilities, setMediaCapabilities] =
    useState<MediaCapability[]>([]);

  const [selectedMediaAction, setSelectedMediaAction] =
    useState<string>("");

  const [mediaPrompt, setMediaPrompt] =
    useState("");

  const [generatedMedia, setGeneratedMedia] =
    useState<GeneratedMedia[]>([]);

  const [isLoadingMediaCapabilities, setIsLoadingMediaCapabilities] =
    useState(false);

  const [mediaMenuOpen, setMediaMenuOpen] =
    useState(false);

  /*
   * ==========================================================
   * SAUVEGARDE LOCALE
   * ==========================================================
   */

  useEffect(() => {
    if (
      !isInitialized ||
      !currentUserId
    ) {
      return;
    }

    const timeout =
      window.setTimeout(() => {
        writeLocalCache(
          currentUserId,
          {
            conversations,
            messages: {
              ...(readLocalCache(
                currentUserId,
              )?.messages || {}),
              ...(activeConversationId
                ? {
                    [activeConversationId]:
                      messages,
                  }
                : {}),
            },
            activeConversationId,
            selectedModel,
            activeCapability,
          },
        );
      }, 300);

    return () =>
      window.clearTimeout(
        timeout,
      );
  }, [
    conversations,
    messages,
    activeConversationId,
    selectedModel,
    activeCapability,
    currentUserId,
    isInitialized,
  ]);

  /*
   * ==========================================================
   * CHARGEMENT WALLET
   * ==========================================================
   */

  async function loadWallet(
    trialState: Record<string, TrialInfo> = trials,
  ) {
    try {
      setIsLoadingWallet(true);
      setError(null);

      const data =
        await apiFetch<{
          success: boolean;
          wallet: WalletData;
        }>("/credits/me");

      const walletData =
        data.wallet;

      setWallet(walletData);

      const availableModels =
        getSelectableModels(
          walletData.pack_id,
          trialState,
        );

      if (
        availableModels.length > 0
      ) {
        setSelectedModel(
          (current) =>
            availableModels.some(
              (model) =>
                model.id === current,
            )
              ? current
              : availableModels[0].id,
        );
      } else {
        setSelectedModel("");
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement wallet :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger les crédits.",
      );
    } finally {
      setIsLoadingWallet(false);
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT DES ESSAIS
   * ==========================================================
   *
   * Le backend est la source de vérité.
   * Le frontend récupère l'état réel via /ai/trials.
   */

  async function loadTrials(): Promise<
    Record<string, TrialInfo>
  > {
    try {
      setIsLoadingTrials(true);

      const data =
        await apiFetch<TrialResponse>(
          "/ai/trials",
        );

      const trialState =
        data.trials || {};

      setTrials(trialState);

      return trialState;
    } catch (requestError) {
      console.error(
        "Erreur chargement essais :",
        requestError,
      );

      setTrials({});

      return {};
    } finally {
      setIsLoadingTrials(false);
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT CLOUD DES CONVERSATIONS
   * ==========================================================
   */

  async function loadConversations(
    localCache?: LocalChatCache | null,
  ) {
    try {
      setIsLoadingConversations(
        true,
      );

      const data =
        await apiFetch<ConversationResponse>(
          "/conversations",
        );

      const remoteConversations =
        data.conversations || [];

      const remoteIds =
        new Set(
          remoteConversations.map(
            (conversation) =>
              conversation.id,
          ),
        );

      const unsyncedLocal =
        (
          localCache?.conversations ||
          []
        ).filter(
          (conversation) =>
            !remoteIds.has(
              conversation.id,
            ),
        );

      const merged = [
        ...unsyncedLocal,
        ...remoteConversations,
      ];

      setConversations(merged);

      if (
        !activeConversationId &&
        localCache?.activeConversationId
      ) {
        const localActive =
          merged.find(
            (conversation) =>
              conversation.id ===
              localCache.activeConversationId,
          );

        if (localActive) {
          setActiveConversationId(
            localActive.id,
          );
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement conversations :",
        requestError,
      );

      if (
        localCache?.conversations
      ) {
        setConversations(
          localCache.conversations,
        );
      } else {
        setConversations([]);
      }

      setError(
        requestError instanceof Error
          ? `${requestError.message} Les données locales restent disponibles.`
          : "Serveur indisponible. Les données locales restent disponibles.",
      );
    } finally {
      setIsLoadingConversations(
        false,
      );
    }
  }

  /*
   * ==========================================================
   * INITIALISATION
   * ==========================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const {
          data: { session },
        } =
          await supabase.auth.getSession();

        if (
          !session?.user?.id ||
          !session.access_token
        ) {
          throw new Error(
            "Utilisateur non authentifié.",
          );
        }

        if (cancelled) {
          return;
        }

        const userId =
          session.user.id;

        setCurrentUserId(userId);

        const localCache =
          readLocalCache(userId);

        if (localCache) {
          setConversations(
            localCache.conversations,
          );

          setActiveConversationId(
            localCache.activeConversationId,
          );

          if (
            localCache.selectedModel
          ) {
            setSelectedModel(
              localCache.selectedModel,
            );
          }

          setActiveCapability(
            localCache.activeCapability,
          );

          if (
            localCache.activeConversationId
          ) {
            const cachedMessages =
              localCache.messages[
                localCache
                  .activeConversationId
              ];

            if (
              Array.isArray(
                cachedMessages,
              )
            ) {
              setMessages(
                cachedMessages,
              );
            }
          }
        }

        setIsInitialized(true);

        const trialState =
          await loadTrials();

        await Promise.all([
          loadWallet(trialState),
          loadConversations(
            localCache,
          ),
          loadPersistedMedia(),
        ]);

        // Les capacités média sont chargées à l'ouverture du mode
        // « Création » afin qu'un endpoint indisponible ne bloque pas
        // l'initialisation générale du chat.
        void cancelled;
      } catch (requestError) {
        console.error(
          "Erreur initialisation Chat :",
          requestError,
        );

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Impossible d'initialiser le chat.",
        );

        setIsLoadingConversations(
          false,
        );

        setIsLoadingWallet(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ==========================================================
   * NOUVELLE CONVERSATION
   * ==========================================================
   */

  async function createConversation() {
    const now =
      new Date().toISOString();

    const localId =
      crypto.randomUUID();

    const newConversation:
      Conversation = {
      id: localId,
      title:
        "Nouvelle conversation",
      createdAt: now,
      updatedAt: now,
    };

    setConversations(
      (current) => [
        newConversation,
        ...current,
      ],
    );

    setActiveConversationId(
      localId,
    );

    setMessages([]);
    setMessage("");
    setAttachments([]);
    setActiveCapability(null);
    setError(null);
    setSidebarOpen(false);

    if (currentUserId) {
      writeLocalCache(
        currentUserId,
        {
          conversations: [
            newConversation,
            ...conversations,
          ],
          messages: {
            ...(readLocalCache(
              currentUserId,
            )?.messages || {}),
            [localId]: [],
          },
          activeConversationId:
            localId,
          selectedModel,
          activeCapability: null,
        },
      );
    }

    try {
      const remoteConversation =
        await createConversationRemote(
          "Nouvelle conversation",
        );

      setConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              localId
                ? remoteConversation
                : conversation,
          ),
      );

      setActiveConversationId(
        remoteConversation.id,
      );

      const localCache =
        currentUserId
          ? readLocalCache(
              currentUserId,
            )
          : null;

      if (
        localCache?.messages[
          localId
        ]
      ) {
        const cachedMessages =
          localCache.messages[
            localId
          ];

        for (const cachedMessage of cachedMessages) {
          await saveMessageRemote({
            ...cachedMessage,
            conversationId:
              remoteConversation.id,
          });
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur création conversation backend :",
        requestError,
      );

      setError(
        "Conversation créée localement. Synchronisation cloud en attente.",
      );
    }
  }

  /*
   * ==========================================================
   * SÉLECTION CONVERSATION
   * ==========================================================
   */

  async function selectConversation(
    conversationId: string,
  ) {
    setActiveConversationId(
      conversationId,
    );

    setSidebarOpen(false);
    setError(null);

    if (currentUserId) {
      const cache =
        readLocalCache(
          currentUserId,
        );

      const localMessages =
        cache?.messages[
          conversationId
        ];

      if (
        Array.isArray(
          localMessages,
        )
      ) {
        setMessages(
          localMessages,
        );
      } else {
        setMessages([]);
      }
    }

    try {
      const data =
        await apiFetch<MessagesResponse>(
          `/conversations/${conversationId}/messages`,
        );

      const remoteMessages =
        data.messages || [];

      if (
        remoteMessages.length > 0
      ) {
        setMessages(
          remoteMessages,
        );

        if (currentUserId) {
          const cache =
            readLocalCache(
              currentUserId,
            );

          writeLocalCache(
            currentUserId,
            {
              conversations:
                cache?.conversations ||
                conversations,
              messages: {
                ...(cache?.messages ||
                  {}),
                [conversationId]:
                  remoteMessages,
              },
              activeConversationId:
                conversationId,
              selectedModel,
              activeCapability,
            },
          );
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement messages :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? `${requestError.message} Les messages locaux restent affichés.`
          : "Impossible de charger les messages cloud. Les données locales restent affichées.",
      );
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT DES CAPACITÉS MÉDIA
   * ==========================================================
   */

  /*
   * ==========================================================
   * MÉDIAS PERSISTÉS — SUPABASE
   * ==========================================================
   */

  async function loadPersistedMedia(): Promise<void> {
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
          size_bytes?: number | null;
          prompt?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          createdAt?: string | null;
        }>;
      }>("/media");

      const restored: GeneratedMedia[] = (data.media ?? []).flatMap(
        (item): GeneratedMedia[] => {
          const type: "image" | "video" =
            item.media_type === "video" || item.type === "video"
              ? "video"
              : "image";

          const rawUrl =
            item.public_url ??
            item.media_url ??
            item.url;

          const url =
            typeof rawUrl === "string"
              ? rawUrl.trim()
              : "";

          if (!url) {
            return [];
          }

          const media: GeneratedMedia = {
            id: item.id,
            conversation_id: item.conversation_id ?? null,
            prompt: item.prompt ?? null,
            created_at:
              item.created_at ??
              item.createdAt ??
              null,
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
          };

          return [media];
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
    if (item.role !== "assistant") {
      return null;
    }

    const exact = generatedMedia.find(
      (media) => media.id === item.id,
    );

    if (exact) {
      return exact;
    }

    const markerId = extractMediaIdFromMessage(
      item.content || "",
    );

    if (markerId) {
      const byMarker = generatedMedia.find(
        (media) => media.id === markerId,
      );

      if (byMarker) {
        return byMarker;
      }
    }

    const visibleContent =
      getVisibleMessageContent(
        item.content || "",
      );

    const actionMatch = visibleContent.match(
      /^(?:Image|Vidéo) générée · (.+)$/u,
    );

    if (!actionMatch) {
      return null;
    }

    const candidates =
      generatedMedia.filter(
        (media) =>
          media.conversation_id ===
            item.conversationId &&
          media.action === actionMatch[1],
      );

    if (candidates.length === 0) {
      return null;
    }

    if (
      candidates.length === 1 ||
      !item.createdAt
    ) {
      return candidates[0];
    }

    const messageTime =
      new Date(item.createdAt).getTime();

    return [...candidates].sort(
      (a, b) => {
        const aTime = new Date(
          a.created_at ?? 0,
        ).getTime();

        const bTime = new Date(
          b.created_at ?? 0,
        ).getTime();

        return (
          Math.abs(aTime - messageTime) -
          Math.abs(bTime - messageTime)
        );
      },
    )[0];
  }

  async function downloadMedia(media: GeneratedMedia): Promise<void> {
    try {
      const response = await fetch(media.url);

      if (!response.ok) {
        throw new Error("Téléchargement impossible.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const extension =
        media.mimeType?.split("/")[1]?.split(";")[0] ??
        (media.type === "video" ? "mp4" : "png");

      const safeExtension =
        extension === "jpeg" ? "jpg" : extension;

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `oria-${media.id}.${safeExtension}`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
    } catch (downloadError) {
      console.error("Erreur téléchargement média Oria :", downloadError);

      // Fallback navigateur : ouvre directement l'URL publique persistée.
      window.open(media.url, "_blank", "noopener,noreferrer");
    }
  }


  async function loadMediaCapabilities(): Promise<void> {
    try {
      setIsLoadingMediaCapabilities(true);

      const data = await apiFetch<MediaCapabilitiesResponse>(
        "/ai/media-capabilities",
      );

      const available = Array.isArray(data.media) ? data.media : [];
      const fallback = getLocalMediaCapabilities(
        data.pack_id ?? wallet?.pack_id ?? null,
      );
      const next = available.length > 0 ? available : fallback;

      setMediaCapabilities(next);
      setSelectedMediaAction((current) =>
        current && next.some((item) => item.action === current)
          ? current
          : next[0]?.action ?? "",
      );
    } catch (requestError) {
      console.warn(
        "Capacités média indisponibles pour le compte courant :",
        requestError,
      );

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

  /*
   * ==========================================================
   * CAPACITÉS
   * ==========================================================
   */

  function handleCapabilityClick(
    label: string,
  ) {
    if (label === "Fichier") {
      fileInputRef.current?.click();
      return;
    }

    if (label === "Image") {
      imageInputRef.current?.click();
      return;
    }

    if (label === "Recherche Web") {
      setActiveCapability(
        (current) =>
          current === label
            ? null
            : label,
      );
      setMediaMenuOpen(false);
      return;
    }

    if (label === "Création") {
      setActiveCapability("Création");
      setMediaMenuOpen(true);
      setError(null);
      void loadMediaCapabilities();
    }
  }

  function addAttachments(
    fileList: FileList | File[],
    expectedKind?: "image" | "file",
  ) {
    const incoming = Array.from(fileList);

    if (incoming.length === 0) {
      return;
    }

    const remainingSlots =
      MAX_ATTACHMENTS - attachments.length;

    if (remainingSlots <= 0) {
      setError(
        `Vous pouvez joindre au maximum ${MAX_ATTACHMENTS} éléments par message.`,
      );
      return;
    }

    const selected = incoming.slice(
      0,
      remainingSlots,
    );

    const invalid = selected.find(
      (file) =>
        !isAcceptedAttachment(file) ||
        (expectedKind === "image" &&
          !isImageFile(file)) ||
        (expectedKind === "file" &&
          isImageFile(file)),
    );

    if (invalid) {
      setError(
        expectedKind === "image"
          ? "Format d'image non pris en charge."
          : "Format de fichier non pris en charge.",
      );
      return;
    }

    const newAttachments = selected.map(
      (file) => ({
        id: crypto.randomUUID(),
        file,
        kind: isImageFile(file)
          ? ("image" as const)
          : ("file" as const),
        previewUrl: isImageFile(file)
          ? URL.createObjectURL(file)
          : null,
      }),
    );

    setAttachments((current) => [
      ...current,
      ...newAttachments,
    ]);
    setError(null);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const attachment = current.find(
        (item) => item.id === id,
      );

      if (attachment?.previewUrl) {
        URL.revokeObjectURL(
          attachment.previewUrl,
        );
      }

      return current.filter(
        (item) => item.id !== id,
      );
    });
  }

  /*
   * ==========================================================
   * MISE À JOUR CONVERSATION
   * ==========================================================
   */

  function updateConversationLocally(
    conversationId: string,
    content: string,
    now: string,
  ) {
    setConversations(
      (current) =>
        current.map(
          (conversation) =>
            conversation.id ===
            conversationId
              ? {
                  ...conversation,
                  title:
                    conversation.title ===
                      "Nouvelle conversation" &&
                    content
                      ? content.length > 45
                        ? `${content.slice(
                            0,
                            45,
                          )}...`
                        : content
                      : conversation.title,
                  updatedAt: now,
                }
              : conversation,
        ),
    );
  }

  async function handleGenerateMedia(promptOverride?: string) {
    const prompt = (promptOverride ?? mediaPrompt).trim();

    if (!prompt || isThinking) {
      return;
    }

    if (!selectedMediaAction) {
      setError(
        "Aucune option de création n'est disponible.",
      );
      return;
    }

    // Si l'endpoint de capacités est indisponible, on peut tout de même
    // utiliser la configuration locale. Le backend décidera ensuite si
    // l'action est réellement autorisée pour le compte.
    const capability =
      mediaCapabilities.find(
        (item) => item.action === selectedMediaAction,
      ) ??
      (() => {
        const localConfig = getMediaGenerationConfig(selectedMediaAction);
        return localConfig
          ? {
              action: localConfig.action,
              type: localConfig.type,
              model: localConfig.model,
            }
          : undefined;
      })();

    if (!capability) {
      setError(
        "Cette option de création n'existe pas.",
      );
      return;
    }

    const now =
      new Date().toISOString();

    let conversationId =
      activeConversationId;

    setIsThinking(true);
    setError(null);

    try {
      if (!conversationId) {
        const localId =
          crypto.randomUUID();

        const title =
          prompt.length > 45
            ? `${prompt.slice(0, 45)}...`
            : prompt;

        const localConversation:
          Conversation = {
          id: localId,
          title,
          createdAt: now,
          updatedAt: now,
        };

        conversationId = localId;

        setConversations(
          (current) => [
            localConversation,
            ...current,
          ],
        );

        setActiveConversationId(localId);

        if (currentUserId) {
          const cache =
            readLocalCache(
              currentUserId,
            );

          writeLocalCache(
            currentUserId,
            {
              conversations: [
                localConversation,
                ...(cache?.conversations ||
                  conversations),
              ],
              messages: {
                ...(cache?.messages || {}),
                [localId]: [],
              },
              activeConversationId:
                localId,
              selectedModel,
              activeCapability: "Création",
            },
          );
        }

        try {
          const remoteConversation =
            await createConversationRemote(title);

          setConversations(
            (current) =>
              current.map(
                (conversation) =>
                  conversation.id === localId
                    ? remoteConversation
                    : conversation,
              ),
          );

          conversationId =
            remoteConversation.id;

          setActiveConversationId(
            remoteConversation.id,
          );
        } catch (requestError) {
          console.error(
            "Création conversation cloud échouée :",
            requestError,
          );
        }
      }

      const userMessage:
        ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "user",
        content:
          `[Création ${capability.type === "image" ? "image" : "vidéo"} · ${selectedMediaAction}]\n${prompt}`,
        createdAt: now,
      };

      setMessages(
        (current) => [
          ...current,
          userMessage,
        ],
      );

      try {
        await saveMessageRemote(
          userMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde prompt média :",
          saveError,
        );
      }

      const endpoint =
        capability.type === "image"
          ? "/ai/image"
          : "/ai/video";

      const response =
        await apiMediaFetch<{
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
        }>(
          endpoint,
          {
            action:
              selectedMediaAction,
            prompt,
            conversation_id:
              conversationId,
          },
        );

      if (!response.success) {
        throw new Error(
          "La génération du média a échoué.",
        );
      }

      /*
       * Le backend peut renvoyer directement l'URL du média sauvegardé
       * dans Supabase. Le base64 reste accepté comme fallback.
       */
      const rawUrl =
        response.public_url ||
        response.media_url ||
        response.url ||
        "";

      let url =
        typeof rawUrl === "string"
          ? rawUrl.trim()
          : "";

      const mimeType =
        response.mime_type ||
        (response.type === "image"
          ? "image/png"
          : "video/mp4");

      if (!url && response.data) {
        const binaryString =
          window.atob(response.data);

        const bytes =
          new Uint8Array(
            binaryString.length,
          );

        for (
          let index = 0;
          index < binaryString.length;
          index++
        ) {
          bytes[index] =
            binaryString.charCodeAt(index);
        }

        const blob =
          new Blob(
            [bytes],
            { type: mimeType },
          );

        url = URL.createObjectURL(blob);
      }

      if (!url) {
        throw new Error(
          "Le serveur a généré le média mais n'a retourné aucune URL exploitable.",
        );
      }

      const mediaId =
        response.media_id ||
        response.id;

      if (!mediaId) {
        throw new Error(
          "Le serveur a généré le média mais n'a retourné aucun identifiant.",
        );
      }

      setGeneratedMedia(
        (current) => [
          ...current.filter(
            (media) => media.id !== mediaId,
          ),
          {
            id: mediaId,
            conversation_id:
              response.conversation_id ??
              conversationId,
            prompt,
            created_at: new Date().toISOString(),
            type: response.type,
            media_type: response.type,
            mimeType,
            url,
            action: response.action,
            model: response.model,
            cost: response.cost,
            creditsRemaining:
              response.credits_remaining,
            seconds: response.seconds,
            size: response.size,
          },
        ],
      );

      const assistantMessage:
        ChatMessage = {
        id: mediaId,
        conversationId,
        role: "assistant",
        content: buildMediaMessageContent(
          response.type,
          response.action,
          mediaId,
        ),
        createdAt:
          new Date().toISOString(),
      };

      setMessages(
        (current) => [
          ...current,
          assistantMessage,
        ],
      );

      try {
        await saveMessageRemote(
          assistantMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde résultat média :",
          saveError,
        );
      }

      setMediaPrompt("");
      setMediaMenuOpen(false);

      const refreshedTrials =
        await loadTrials();

      await loadWallet(
        refreshedTrials,
      );

      await loadMediaCapabilities();
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "La création média a échoué.";

      setError(errorMessage);
    } finally {
      setIsThinking(false);
    }
  }

  /*
   * ==========================================================
   * ENVOI MESSAGE
   * ==========================================================
   */

  async function handleSendMessage() {
    const content =
      message.trim();

    const selectedTrial =
      trials[selectedModel];

    if (
      selectedTrial &&
      selectedTrial.remaining <= 0
    ) {
      setError(
        "Les essais gratuits de ce modèle sont épuisés.",
      );
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

    const now =
      new Date().toISOString();

    let conversationId =
      activeConversationId;

    /*
     * ========================================================
     * CONVERSATION
     * ========================================================
     */

    if (!conversationId) {
      const localId =
        crypto.randomUUID();

      const localConversation:
        Conversation = {
        id: localId,
        title:
          content.length > 45
            ? `${content.slice(
                0,
                45,
              )}...`
            : content ||
              "Nouvelle conversation",
        createdAt: now,
        updatedAt: now,
      };

      conversationId =
        localId;

      setConversations(
        (current) => [
          localConversation,
          ...current,
        ],
      );

      setActiveConversationId(
        localId,
      );

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        writeLocalCache(
          currentUserId,
          {
            conversations: [
              localConversation,
              ...(cache?.conversations ||
                conversations),
            ],
            messages: {
              ...(cache?.messages ||
                {}),
              [localId]: [],
            },
            activeConversationId:
              localId,
            selectedModel,
            activeCapability,
          },
        );
      }

      try {
        const remoteConversation =
          await createConversationRemote(
            localConversation.title,
          );

        const oldLocalId =
          localId;

        conversationId =
          remoteConversation.id;

        setActiveConversationId(
          remoteConversation.id,
        );

        setConversations(
          (current) =>
            current.map(
              (conversation) =>
                conversation.id ===
                oldLocalId
                  ? remoteConversation
                  : conversation,
            ),
        );
      } catch (requestError) {
        console.error(
          "Création conversation cloud échouée :",
          requestError,
        );

        setError(
          "Conversation sauvegardée localement. La synchronisation cloud sera réessayée.",
        );
      }
    } else {
      updateConversationLocally(
        conversationId,
        content,
        now,
      );
    }

    /*
     * ========================================================
     * MESSAGE UTILISATEUR
     * ========================================================
     */

    const webEnabled =
      activeCapability ===
      "Recherche Web";

    const attachmentSummary =
      attachments.length > 0
        ? `\n\n[Pièces jointes : ${attachments
            .map((attachment) => attachment.file.name)
            .join(", ")}]`
        : "";

    const userMessage:
      ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: `${content}${attachmentSummary}`.trim(),
      createdAt: now,
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ],
    );

    if (currentUserId) {
      const cache =
        readLocalCache(
          currentUserId,
        );

      const existingMessages =
        cache?.messages[
          conversationId
        ] || [];

      writeLocalCache(
        currentUserId,
        {
          conversations:
            cache?.conversations ||
            conversations,
          messages: {
            ...(cache?.messages ||
              {}),
            [conversationId]: [
              ...existingMessages,
              userMessage,
            ],
          },
          activeConversationId:
            conversationId,
          selectedModel,
          activeCapability,
        },
      );
    }

    setMessage("");
    setIsThinking(true);

    /*
     * La recherche Web reste volontairement active.
     */

    try {
      /*
       * ======================================================
       * SAUVEGARDE MESSAGE UTILISATEUR
       * ======================================================
       */

      try {
        await saveMessageRemote(
          userMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde message utilisateur :",
          saveError,
        );

        setError(
          "Message conservé localement. Synchronisation cloud en attente.",
        );
      }

      /*
       * ======================================================
       * OPENAI — STREAMING + MULTIMODAL
       * ======================================================
       */

      const formData =
        new FormData();

      formData.append(
        "model",
        selectedModel,
      );

      formData.append(
        "message",
        content,
      );

      formData.append(
        "web",
        String(webEnabled),
      );

      // Identifie la conversation côté backend afin que l'IA
      // puisse recharger son historique persistant.
      formData.append(
        "conversation_id",
        conversationId,
      );

      for (
        const attachment of attachments
      ) {
        formData.append(
          "files",
          attachment.file,
          attachment.file.name,
        );
      }

      const streamResponse =
        await apiStreamFetch(
          "/ai/chat/stream",
          formData,
        );

      const reader =
        streamResponse.body!.getReader();

      const decoder =
        new TextDecoder();

      const assistantId =
        crypto.randomUUID();

      const assistantCreatedAt =
        new Date().toISOString();

      let assistantContent = "";
      let streamBuffer = "";
      let streamDone = false;
      setMessages(
        (current) => [
          ...current,
          {
            id: assistantId,
            conversationId,
            role: "assistant",
            content: "",
            createdAt:
              assistantCreatedAt,
          },
        ],
      );

      while (!streamDone) {
        const { value, done } =
          await reader.read();

        if (done) {
          break;
        }

        streamBuffer +=
          decoder.decode(
            value,
            { stream: true },
          );

        const events =
          streamBuffer.split(
            "\n\n",
          );

        streamBuffer =
          events.pop() || "";

        for (
          const rawEvent of events
        ) {
          if (!rawEvent.trim()) {
            continue;
          }

          let eventName =
            "message";
          let dataText = "";

          for (
            const line of rawEvent.split(
              "\n",
            )
          ) {
            if (
              line.startsWith(
                "event:",
              )
            ) {
              eventName =
                line.slice(6).trim();
            }

            if (
              line.startsWith(
                "data:",
              )
            ) {
              dataText +=
                line.slice(5).trim();
            }
          }

          if (!dataText) {
            continue;
          }

          let eventData:
            | Record<string, unknown>;

          try {
            eventData =
              JSON.parse(
                dataText,
              );
          } catch {
            continue;
          }

          if (
            eventName ===
            "delta"
          ) {
            const delta =
              typeof eventData.content ===
              "string"
                ? eventData.content
                : "";

            if (!delta) {
              continue;
            }

            assistantContent +=
              delta;

            setMessages(
              (current) =>
                current.map(
                  (item) =>
                    item.id ===
                    assistantId
                      ? {
                          ...item,
                          content:
                            assistantContent,
                        }
                      : item,
                ),
            );
          }

          if (
            eventName ===
            "done"
          ) {
            streamDone = true;
            break;
          }

          if (
            eventName ===
            "error"
          ) {
            throw new Error(
              typeof eventData.detail ===
              "string"
                ? eventData.detail
                : "Erreur pendant le streaming IA.",
            );
          }
        }
      }

      if (!assistantContent.trim()) {
        throw new Error(
          "Le service IA n'a retourné aucun contenu.",
        );
      }

      const assistantMessage:
        ChatMessage = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content:
          assistantContent,
        createdAt:
          assistantCreatedAt,
      };

      /*
       * ======================================================
       * MESSAGE IA
       * ======================================================
       */

      /*
       * ======================================================
       * SAUVEGARDE LOCALE
       * ======================================================
       */

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        const existingMessages =
          cache?.messages[
            conversationId
          ] || [];

        const hasUserMessage =
          existingMessages.some(
            (item) =>
              item.id ===
              userMessage.id,
          );

        const mergedMessages =
          hasUserMessage
            ? [
                ...existingMessages,
                assistantMessage,
              ]
            : [
                ...existingMessages,
                userMessage,
                assistantMessage,
              ];

        writeLocalCache(
          currentUserId,
          {
            conversations:
              cache?.conversations ||
              conversations,
            messages: {
              ...(cache?.messages ||
                {}),
              [conversationId]:
                mergedMessages,
            },
            activeConversationId:
              conversationId,
            selectedModel,
            activeCapability,
          },
        );
      }

      /*
       * ======================================================
       * SAUVEGARDE BACKEND
       * ======================================================
       */

      try {
        await saveMessageRemote(
          assistantMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde réponse IA :",
          saveError,
        );

        setError(
          "Réponse IA conservée localement. Synchronisation cloud en attente.",
        );
      }

      /*
       * ======================================================
       * CONVERSATION
       * ======================================================
       */

      const updatedAt =
        new Date().toISOString();

      setConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              conversationId
                ? {
                    ...conversation,
                    updatedAt,
                  }
                : conversation,
          ),
      );

      /*
       * ======================================================
       * WALLET
       * ======================================================
       */

      attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(
            attachment.previewUrl,
          );
        }
      });
      setAttachments([]);

      const refreshedTrials =
        await loadTrials();

      await loadWallet(
        refreshedTrials,
      );
    } catch (requestError) {
      const errorMessage =
        requestError instanceof
        Error
          ? requestError.message
          : "Impossible de contacter Oria.";

      const assistantMessage:
        ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: `Erreur : ${errorMessage}`,
        createdAt:
          new Date().toISOString(),
      };

      setMessages(
        (current) => [
          ...current,
          assistantMessage,
        ],
      );

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        const existingMessages =
          cache?.messages[
            conversationId
          ] || [];

        writeLocalCache(
          currentUserId,
          {
            conversations:
              cache?.conversations ||
              conversations,
            messages: {
              ...(cache?.messages ||
                {}),
              [conversationId]: [
                ...existingMessages,
                assistantMessage,
              ],
            },
            activeConversationId:
              conversationId,
            selectedModel,
            activeCapability,
          },
        );
      }
    } finally {
      setIsThinking(false);
    }
  }

  /*
   * ==========================================================
   * JOURS RESTANTS
   * ==========================================================
   */

  const remainingDays =
    wallet?.pack_expires_at
      ? Math.max(
          0,
          Math.ceil(
            (
              new Date(
                wallet.pack_expires_at,
              ).getTime() -
              Date.now()
            ) /
              (1000 *
                60 *
                60 *
                24),
          ),
        )
      : null;

  /*
   * ==========================================================
   * AFFICHAGE
   * ==========================================================
   */

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <button
          type="button"
          aria-label={UI[language].closeMenu}
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
          onClick={() =>
            setSidebarOpen(false)
          }
        />
      )}

      <button
        type="button"
        aria-label={UI[language].openMenu}
        title={UI[language].openMenu}
        className="fixed bottom-6 left-5 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface shadow-lg transition hover:bg-surface-secondary"
        onClick={() =>
          setSidebarOpen(true)
        }
      >
        <Menu size={19} />
      </button>

      {/* ======================================================
          SIDEBAR
          ====================================================== */}

      <aside
        className={`fixed bottom-3 left-3 top-3 z-50 flex w-[min(280px,78vw)] flex-col rounded-3xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-[120%]"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div>
            <div className="font-semibold tracking-tight">
              Oria
            </div>

            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted">
              Intelligence workspace
            </div>
          </div>

          <button
            type="button"
            aria-label={UI[language].closeMenu}
            className="rounded-xl p-2 text-muted transition hover:bg-surface-tertiary hover:text-foreground md:hidden"
            onClick={() =>
              setSidebarOpen(false)
            }
          >
            <X size={17} />
          </button>
        </div>

        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={
              createConversation
            }
            className="flex w-full items-center justify-between rounded-2xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition hover:opacity-85"
          >
            <span className="flex items-center gap-3">
              <Plus size={17} />
              {UI[language].newConversation}
            </span>

            <span className="text-xs opacity-50">
              +
            </span>
          </button>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto px-4">
          <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            {UI[language].history}
          </div>

          {isLoadingConversations ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              {UI[language].loading}
            </p>
          ) : conversations.length ===
            0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              {UI[language].noConversation}
            </p>
          ) : (
            <div className="space-y-1">
              {conversations.map(
                (conversation) => (
                  <button
                    key={
                      conversation.id
                    }
                    type="button"
                    onClick={() =>
                      selectConversation(
                        conversation.id,
                      )
                    }
                    className={`w-full truncate rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      activeConversationId ===
                      conversation.id
                        ? "bg-surface-tertiary font-medium text-foreground"
                        : "text-muted-strong hover:bg-surface-tertiary hover:text-foreground"
                    }`}
                  >
                    {language === "en" && conversation.title === "Nouvelle conversation"
                      ? UI.en.newConversation
                      : conversation.title}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        <div className="px-4 pb-3">
          <div className="rounded-2xl border border-border bg-surface-secondary p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {UI[language].availableCredits}
              </span>

              <Wallet
                size={15}
                className="text-muted"
              />
            </div>

            <p className="mt-2 text-xl font-semibold tracking-tight">
              {isLoadingWallet
                ? "..."
                : wallet
                  ? wallet.balance.toLocaleString(language === "en" ? "en-US" : "fr-FR")
                  : "—"}
            </p>

            <p className="mt-1 text-[11px] text-muted">
              {remainingDays !==
              null
                ? `${remainingDays} ${UI[language].daysRemaining}`
                : UI[language].durationUnavailable}
            </p>
          </div>
        </div>

        <div className="space-y-1 border-t border-border px-4 py-3">
          <Link
            href="/credits"
            onClick={() =>
              setSidebarOpen(false)
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-strong transition hover:bg-surface-tertiary hover:text-foreground"
          >
            <Wallet size={17} />
            {UI[language].myCredits}
          </Link>

          <Link
            href="/mes_creations"
            onClick={() =>
              setSidebarOpen(false)
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-strong transition hover:bg-surface-tertiary hover:text-foreground"
          >
            <ImageIcon size={17} />
            {UI[language].myCreations}
            {generatedMedia.length > 0 && (
              <span className="ml-auto rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] text-muted">
                {generatedMedia.length}
              </span>
            )}
          </Link>

          <Link
            href="/settings"
            onClick={() =>
              setSidebarOpen(false)
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-strong transition hover:bg-surface-tertiary hover:text-foreground"
          >
            <Settings size={17} />
            {UI[language].settings}
          </Link>

          <LogoutButton />
        </div>
      </aside>

      {/* ======================================================
          WORKSPACE
          ====================================================== */}

      <section className="flex min-h-dvh flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={UI[language].openMenu}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface shadow-sm transition hover:bg-surface-secondary"
              onClick={() =>
                setSidebarOpen(true)
              }
            >
              <Menu size={19} />
            </button>

            <div className="hidden sm:block">
              <p className="text-xs text-muted">
                Workspace
              </p>

              <p className="text-sm font-medium">
                {activeConversationId
                  ? conversations.find(
                      (
                        conversation,
                      ) =>
                        conversation.id ===
                        activeConversationId,
                    )?.title === "Nouvelle conversation"
                      ? UI[language].newConversation
                      : conversations.find(
                          (conversation) =>
                            conversation.id === activeConversationId,
                        )?.title ||
                        UI[language].activeConversation
                  : UI[language].newConversation}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/credits"
              className="hidden rounded-full border border-border bg-surface px-3 py-1.5 transition hover:bg-surface-secondary sm:flex"
            >
              <span className="text-xs text-muted">
                {UI[language].credits}
              </span>

              <span className="ml-2 text-sm font-semibold">
                {isLoadingWallet
                  ? "..."
                  : wallet
                    ? wallet.balance.toLocaleString(language === "en" ? "en-US" : "fr-FR")
                    : "—"}
              </span>
            </Link>

            <Link
              href="/settings"
              aria-label={UI[language].profile}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-sm font-medium shadow-sm transition hover:bg-surface-secondary"
            >
              U
            </Link>
          </div>
        </header>

        <div className="flex flex-1 flex-col px-4 pb-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {error && (
              <div className="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-border bg-surface-secondary px-4 py-3 text-sm text-muted-strong">
                {localizeFrontendError(error, language)}
              </div>
            )}

            {/* ==================================================
                EMPTY STATE
                ================================================== */}

            {messages.length ===
              0 && (
              <div className="flex flex-1 flex-col justify-center">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
                      <Sparkles
                        size={20}
                      />
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">
                        Oria
                      </p>

                      <p className="text-sm font-medium">
                        Intelligence
                        workspace
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
{UI[language].howCanIHelp}
                  </h1>

                  <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
{UI[language].welcomeDescription}
                  </p>
                </div>
              </div>
            )}

            {/* ==================================================
                MESSAGES
                ================================================== */}

            {messages.length >
              0 && (
              <div className="flex-1 overflow-y-auto py-8">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
                  {messages.map(
                    (item) => (
                      <div
                        key={
                          item.id
                        }
                        className={
                          item.role ===
                          "user"
                            ? "flex justify-end"
                            : "flex justify-start"
                        }
                      >
                        <div
                          className={
                            item.role ===
                            "user"
                              ? "max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-5 py-3.5 text-sm leading-6 text-accent-foreground"
                              : "max-w-[90%] rounded-3xl rounded-bl-lg border border-border bg-surface px-5 py-4 text-foreground shadow-sm"
                          }
                        >
                          {item.role ===
                          "assistant" ? (
                            /*
                             * IMPORTANT :
                             *
                             * Les réponses IA passent maintenant
                             * par le renderer Markdown.
                             */
                            <>
                              <MarkdownMessage
                                language={language}
                                content={getVisibleMessageContent(
                                  item.content,
                                )}
                              />

                              <div className="mt-3 flex justify-start">
                                <MessageCopyButton
                                  language={language}
                                  value={getVisibleMessageContent(
                                    item.content,
                                  )}
                                />
                              </div>
                            </>
                          ) : (
                            /*
                             * Le message utilisateur reste simple
                             * et conserve les retours à la ligne.
                             */
                            <div className="whitespace-pre-wrap break-words">
                              {
                                item.content
                              }
                            </div>
                          )}
                        </div>

                        {(() => {
                          const mediaForMessage =
                            findMediaForMessage(item);

                          if (!mediaForMessage) {
                            return null;
                          }

                          const media =
                            mediaForMessage;

                          return (
                            <div className="mt-3 max-w-[90%]">
                              <div className="relative inline-block max-w-full">
                                {media.type === "image" ? (
                                  <img
                                    src={media.url}
                                    alt={UI[language].generatedImageAlt}
                                    className="max-h-[620px] w-auto rounded-2xl border border-border shadow-sm"
                                  />
                                ) : (
                                  <video
                                    src={media.url}
                                    controls
                                    playsInline
                                    className="max-h-[620px] w-full rounded-2xl border border-border bg-black shadow-sm"
                                  />
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    void downloadMedia(media)
                                  }
                                  className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-black"
                                  title={UI[language].download}
                                  aria-label={UI[language].downloadCreation}
                                >
                                  <Download size={14} />
                                  {UI[language].download}
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ),
                  )}

                  {isThinking && (
                    <div className="flex justify-start">
                      <div className="rounded-3xl rounded-bl-lg border border-border bg-surface px-5 py-3.5 text-sm text-muted shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex gap-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />

                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />

                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                          </span>

                          Oria réfléchit...
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==================================================
                MODÈLE
                ================================================== */}

            <div
              className={`mx-auto w-full max-w-3xl ${
                messages.length ===
                0
                  ? "mt-10"
                  : "mt-4"
              }`}
            >
              <div className="relative inline-block">
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition ${
                    modelMenuOpen
                      ? "border-border-strong bg-surface-tertiary"
                      : "border-border bg-surface hover:bg-surface-secondary"
                  }`}
                  onClick={() => {
                    if (
                      getSelectableModels(
                        wallet?.pack_id ??
                          null,
                        trials,
                      ).length >
                      1
                    ) {
                      setModelMenuOpen(
                        (current) =>
                          !current,
                      );
                    }
                  }}
                >
                  <Sparkles
                    size={16}
                  />

                  {models.find(
                    (model) =>
                      model.id ===
                      selectedModel,
                  )?.name ||
                    "Modèle"}

                  {trials[selectedModel] && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-accent-foreground">
                      {UI[language].trial} ·{" "}
                      {trials[selectedModel].remaining}/
                      {trials[selectedModel].max}
                    </span>
                  )}

                  <ChevronDown
                    size={15}
                    className={`transition-transform ${
                      modelMenuOpen
                        ? "rotate-180"
                        : ""
                    }`}
                  />
                </button>

                {modelMenuOpen && (
                  <div className="absolute bottom-12 left-0 z-30 w-80 rounded-2xl border border-border bg-surface p-2 shadow-xl">
                    {getSelectableModels(
                      wallet?.pack_id ??
                        null,
                      trials,
                    ).map(
                      (model) => (
                        <ModelOption
                          language={language}
                          key={
                            model.id
                          }
                          name={
                            model.name
                          }
                          description={getModelDescription(model.id, language) || model.description}
                          active={
                            selectedModel ===
                            model.id
                          }
                          trial={
                            trials[model.id]
                          }
                          disabled={
                            Boolean(
                              trials[model.id],
                            ) &&
                            trials[model.id]
                              .remaining <= 0
                          }
                          onClick={() => {
                            if (
                              trials[model.id] &&
                              trials[model.id]
                                .remaining <= 0
                            ) {
                              return;
                            }

                            setSelectedModel(
                              model.id,
                            );

                            setModelMenuOpen(
                              false,
                            );
                          }}
                        />
                      ),
                    )}

                    {getSelectableModels(
                      wallet?.pack_id ??
                        null,
                      trials,
                    ).length ===
                      0 && (
                      <p className="px-3 py-2 text-xs text-muted">
                        {UI[language].noModel}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ==================================================
                MODE WEB
                ================================================== */}

            {activeCapability ===
              "Recherche Web" && (
              <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-tertiary">
                    <Globe
                      size={17}
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium">
                      {UI[language].webEnabled}
                    </p>

                    <p className="text-[11px] text-muted">
                      {UI[language].webEnabledDescription}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveCapability(
                      null,
                    )
                  }
                  className="rounded-lg p-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
                  aria-label={UI[language].disableWeb}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {activeCapability === "Création" && (
  <div className="mx-auto mt-3 w-full max-w-3xl rounded-2xl border border-border bg-surface p-4 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{UI[language].mediaCreation}</p>
        <p className="mt-1 text-[11px] text-muted">
          {UI[language].mediaCreationDescription}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setActiveCapability(null);
          setSelectedMediaAction("");
          setMediaPrompt("");
        }}
        className="rounded-lg p-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
        aria-label={UI[language].closeMediaCreation}
      >
        <X size={16} />
      </button>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-3">
      {(["image", "video"] as const).map((type) => {
        const fallbackForType = getLocalMediaCapabilities(wallet?.pack_id ?? null)
          .filter((item) => item.type === type);

        const available = mediaCapabilities.filter((item) => item.type === type);

        const selectable =
          available.length > 0
            ? available
            : fallbackForType;

        const selectedType = selectedMediaAction
          ? mediaCapabilities.find(
              (item) => item.action === selectedMediaAction,
            )?.type ??
            getMediaGenerationConfig(selectedMediaAction)?.type
          : undefined;

        return (
          <button
            key={type}
            type="button"
            disabled={selectable.length === 0}
            onClick={() => {
              if (selectable.length > 0) {
                setSelectedMediaAction(selectable[0].action);
                setError(null);
              }
            }}
            className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              selectedType === type
                ? "border-border-strong bg-surface-tertiary"
                : "border-border hover:bg-surface-secondary"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {type === "image" ? <ImageIcon size={22} /> : <Video size={22} />}
            <span>{type === "image" ? UI[language].generateImage : UI[language].generateVideo}</span>
            <span className="text-[10px] font-normal text-muted">
              {selectable.length} {selectable.length > 1 ? UI[language].configurations : UI[language].configuration}
            </span>
          </button>
        );
      })}
    </div>

    {selectedMediaAction && (
      <>
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium text-muted">
            {UI[language].generationConfiguration}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(() => {
              const selectedType =
                mediaCapabilities.find(
                  (item) => item.action === selectedMediaAction,
                )?.type ??
                getMediaGenerationConfig(selectedMediaAction)?.type;

              const fallbackForType = selectedType
                ? getLocalMediaCapabilities(wallet?.pack_id ?? null)
                    .filter((item) => item.type === selectedType)
                : [];

              const configurations =
                mediaCapabilities.filter(
                  (item) => item.type === selectedType,
                ).length > 0
                  ? mediaCapabilities.filter(
                      (item) => item.type === selectedType,
                    )
                  : fallbackForType;

              return configurations.map((media) => {
                const config = getMediaGenerationConfig(media.action);
                if (!config) return null;

                const selected = selectedMediaAction === media.action;

                return (
                  <button
                    key={media.action}
                    type="button"
                    onClick={() => setSelectedMediaAction(media.action)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-border-strong bg-surface-tertiary"
                        : "border-border hover:bg-surface-secondary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{getMediaLabel(config.action, language, config.label)}</p>
                        <p className="mt-1 text-[11px] text-muted">
                          {getMediaDescription(config.action, language, config.description)}
                        </p>
                      </div>
                      {selected && <Check size={15} className="shrink-0" />}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted">
                      <span>{config.configuration}</span>
                      <span className="text-right">{media.model || config.model}</span>
                    </div>
                    {(media.estimated_credits ?? media.credits) != null && (
                      <p className="mt-1 text-[10px] text-muted">
                        {language === "en" ? "Estimated reservation" : "Réservation estimée"} :{" "}
                        {(media.estimated_credits ?? media.credits)!.toLocaleString(
                          language === "en" ? "en-US" : "fr-FR",
                        )}{" "}
                        {UI[language].creditsUnit}
                      </p>
                    )}
                  </button>
                );
              });
            })()}
          </div>
        </div>

        <textarea
          rows={4}
          value={mediaPrompt}
          onChange={(event) => setMediaPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleGenerateMedia();
            }
          }}
          placeholder={
            (
              mediaCapabilities.find(
                (item) => item.action === selectedMediaAction,
              )?.type ??
              getMediaGenerationConfig(selectedMediaAction)?.type
            ) === "video"
              ? UI[language].preciseVideo
              : UI[language].preciseImage
          }
          disabled={isThinking}
          className="mt-4 w-full resize-none rounded-xl border border-border bg-transparent px-4 py-3 text-sm leading-6 outline-none placeholder:text-muted focus:border-muted-strong disabled:opacity-60"
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {(() => {
              const selected = mediaCapabilities.find(
                (item) => item.action === selectedMediaAction,
              );
              const estimate = selected?.estimated_credits ?? selected?.credits;

              return (
                <>
                  <p className="text-[10px] text-muted">
                    {estimate != null
                      ? `${language === "en" ? "Estimated reservation" : "Réservation estimée"} : ${estimate.toLocaleString(language === "en" ? "en-US" : "fr-FR")} ${UI[language].creditsUnit}`
                      : language === "en"
                        ? "Dynamic cost · calculated from actual API usage"
                        : "Coût dynamique · calculé selon l'utilisation réelle de l'API"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {UI[language].backendValidation}
                  </p>
                </>
              );
            })()}
          </div>

          <button
            type="button"
            onClick={() => void handleGenerateMedia()}
            disabled={
              !mediaPrompt.trim() ||
              !selectedMediaAction ||
              isThinking
            }
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-5 py-3 text-xs font-semibold text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Sparkles size={15} />
            {isThinking
              ? UI[language].generation
              : (
                  mediaCapabilities.find(
                    (item) => item.action === selectedMediaAction,
                  )?.type ??
                  getMediaGenerationConfig(selectedMediaAction)?.type
                ) === "video"
                ? UI[language].generateTheVideo
                : UI[language].generateTheImage}
          </button>
        </div>
      </>
    )}
  </div>
)}

            {/* ==================================================
                COMPOSER
                ================================================== */}

            <div className="mx-auto mt-4 w-full max-w-3xl">
              <div className="overflow-hidden rounded-[28px] border border-border-strong bg-surface shadow-[0_12px_40px_var(--shadow-color)] transition focus-within:border-muted-strong">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-4 pt-4">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group relative flex max-w-[220px] items-center gap-2 rounded-2xl border border-border bg-surface-secondary p-2"
                      >
                        {attachment.previewUrl ? (
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.file.name}
                            className="h-12 w-12 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary">
                            <FileText size={18} />
                          </div>
                        )}

                        <div className="min-w-0 pr-6">
                          <p className="truncate text-xs font-medium">
                            {attachment.file.name}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted">
                            {attachment.kind === "image"
                              ? UI[language].image
                              : UI[language].file}
                          </p>
                        </div>

                        <button
                          type="button"
                          aria-label={`Supprimer ${attachment.file.name}`}
                          onClick={() =>
                            removeAttachment(attachment.id)
                          }
                          className="absolute right-1.5 top-1.5 rounded-full bg-surface p-1 text-muted shadow-sm transition hover:text-foreground"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  onChange={(event) => {
                    if (event.target.files) {
                      addAttachments(
                        event.target.files,
                        "file",
                      );
                    }
                    event.target.value = "";
                  }}
                />

                <input
                  ref={imageInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={(event) => {
                    if (event.target.files) {
                      addAttachments(
                        event.target.files,
                        "image",
                      );
                    }
                    event.target.value = "";
                  }}
                />

                <textarea
                  rows={4}
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();

                      handleSendMessage();
                    }
                  }}
                  placeholder={activeCapability === "Création" ? UI[language].describeCreation : UI[language].writeToOria}
                  disabled={
                    isThinking
                  }
                  className="w-full resize-none bg-transparent px-5 pt-5 text-sm leading-6 outline-none placeholder:text-muted disabled:opacity-60"
                />

                <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
                  <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {capabilities.map(
                      ({
                        label,
                        icon: Icon,
                        disabled,
                      }) => {
                        const isActive =
                          activeCapability ===
                          label;

                        return (
                          <button
                            key={
                              label
                            }
                            type="button"
                            title={
                              disabled
                                ? `${language === "en" ? ({ Fichier: "File", Image: "Image", "Recherche Web": "Web Search", Création: "Create" } as Record<string, string>)[label] ?? label : label} — ${UI[language].comingSoon}`
                                : (language === "en" ? ({ Fichier: "File", Image: "Image", "Recherche Web": "Web Search", Création: "Create" } as Record<string, string>)[label] ?? label : label)
                            }
                            onClick={() =>
                              handleCapabilityClick(
                                label,
                              )
                            }
                            disabled={
                              disabled
                            }
                            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 transition ${
                              disabled
                                ? "cursor-not-allowed text-muted opacity-50"
                                : isActive
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-strong hover:bg-surface-tertiary hover:text-foreground"
                            }`}
                          >
                            <Icon
                              size={17}
                            />

                            <span className="hidden text-xs sm:inline">
                              {language === "en" ? ({ Fichier: "File", Image: "Image", "Recherche Web": "Web Search", Création: "Create" } as Record<string, string>)[label] ?? label : label}
                            </span>

                            {label !== "Recherche Web" &&
                              label !== "Création" &&
                              attachments.length > 0 && (
                                <span className="text-[10px] opacity-70">
                                  {attachments.length}/{MAX_ATTACHMENTS}
                                </span>
                              )}
                          </button>
                        );
                      },
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label={UI[language].send}
                    onClick={
                      handleSendMessage
                    }
                    disabled={
                      (!message.trim() &&
                        attachments.length === 0) ||
                      isThinking
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp
                      size={18}
                    />
                  </button>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-muted">
                {language === "fr" ? <>Jusqu&apos;à {MAX_ATTACHMENTS} {UI.fr.attachmentsHelp}</> : <>Up to {MAX_ATTACHMENTS} {UI.en.attachmentsHelp}</>}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/*
 * ============================================================
 * OPTION MODÈLE
 * ============================================================
 */

type ModelOptionProps = {
  language?: OriaLanguage;
  name: string;
  description: string;
  active?: boolean;
  trial?: TrialInfo;
  disabled?: boolean;
  onClick?: () => void;
};

function ModelOption({
  language = "fr",
  name,
  description,
  active = false,
  trial,
  disabled = false,
  onClick,
}: ModelOptionProps) {
  const isTrial =
    Boolean(trial);

  const trialExhausted =
    isTrial &&
    (trial?.remaining ?? 0) <= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        trialExhausted
          ? UI[language].trialExhausted
          : undefined
      }
      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
        disabled
          ? "cursor-not-allowed opacity-45"
          : active
            ? "bg-surface-tertiary"
            : "hover:bg-surface-secondary"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {name}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {isTrial && (
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${
                trialExhausted
                  ? "bg-surface-tertiary text-muted"
                  : "bg-accent text-accent-foreground"
              }`}
            >
              {UI[language].trial} · {trial?.remaining ?? 0}/
              {trial?.max ?? 5}
            </span>
          )}

          {active && (
            <Check
              size={15}
              className="text-muted-strong"
            />
          )}
        </div>
      </div>

      <p className="mt-0.5 text-xs text-muted">
        {description}
      </p>

      {isTrial && (
        <p className="mt-1 text-[10px] text-muted">
          Modèle supérieur · 5 essais maximum
        </p>
      )}
    </button>
  );
}