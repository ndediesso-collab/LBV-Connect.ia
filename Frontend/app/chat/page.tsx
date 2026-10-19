"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FileText,
  Code2,
  Maximize2,
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  ExternalLink,
  Loader2,
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
import dynamic from "next/dynamic";
import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";

import LogoutButton from "@/components/layout/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Conversation } from "@/types/lbv";

// Moteur avance charge uniquement si une reponse contient un bloc visuel.
// Le composant historique reste disponible comme solution de secours.
const OriaVisualAdvanced = dynamic(
  () => import("@/components/oria-visual/OriaVisualAdvanced"),
  { ssr: false, loading: () => <div role="status" className="my-4 rounded-xl border border-border p-4 text-xs text-muted">Chargement du visuel interactif…</div> },
);

// Moteurs visuels complémentaires, chargés uniquement pour les blocs concernés.
const OriaVisualCore = dynamic(
  () => import("@/components/oria-visual/OriaVisualCore"),
  { ssr: false, loading: () => <div role="status" className="my-4 rounded-xl border border-border p-4 text-xs text-muted">Chargement du visuel…</div> },
);
const OriaVisual3D = dynamic(
  () => import("@/components/oria-visual/OriaVisual3D"),
  { ssr: false, loading: () => <div role="status" className="my-4 rounded-xl border border-border p-4 text-xs text-muted">Chargement de la scène 3D…</div> },
);
const OriaVisualMaps = dynamic(
  () => import("@/components/oria-visual/OriaVisualMaps"),
  { ssr: false, loading: () => <div role="status" className="my-4 rounded-xl border border-border p-4 text-xs text-muted">Chargement de la carte…</div> },
);

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
  is_pack_active: boolean;
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
  web_images?: WebIllustration[];
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
  pack_active?: boolean;
  // L'API renvoie principalement des identifiants, pas des objets.
  // Certaines versions peuvent aussi renvoyer des objets enrichis.
  images?: unknown[];
  videos?: unknown[];
  media?: unknown[];
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

type GeneratedArtifact = {
  id: string;
  artifact_id?: string;
  user_id?: string;
  conversation_id?: string | null;
  source_message_id?: string | null;
  filename: string;
  extension: string;
  mimeType: string;
  category: string;
  sizeBytes: number;
  sha256?: string | null;
  model?: string | null;
  downloadUrl?: string | null;
  created_at?: string | null;

  // Association locale pendant le streaming. Une fois le message sauvegardé,
  // les marqueurs ORIA_ARTIFACT_ID deviennent la source de vérité.
  messageId?: string | null;
};

type ConversationResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: ChatMessage[];
  artifacts?: Array<Record<string, unknown>>;
  voice_notes?: Array<Record<string, unknown>>;
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

type WebIllustration = {
  image_url: string;
  source_url: string;
  caption: string;
  alt: string;
  after_paragraph: number;
};

type VoiceNote = {
  audio_id: string;
  message_id?: string | null;
  conversation_id?: string | null;
  duration_ms?: number | null;
  transcription_status: string;
  billing_status: string;
  transcription?: string | null;
  delivery_mode?: string | null;
  playback_url?: string | null;
  credit_cost?: number | null;
};

type VoiceDraft = VoiceNote & {
  localUrl: string;
  editedText: string;
  busy: boolean;
};

type CodePreviewData = { title: string; language: string; code: string };

const CODE_PREVIEW_EXTENSIONS = new Set([
  "py", "js", "jsx", "ts", "tsx", "html", "css", "json", "sql",
  "xml", "yaml", "yml", "toml", "md", "sh", "ps1", "java",
  "c", "cpp", "h", "hpp", "cs", "go", "rs", "php", "rb", "svg", "env",
]);

function normalizeWebImages(raw: unknown): WebIllustration[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 12).flatMap((value): WebIllustration[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const image_url = typeof item.image_url === "string" ? item.image_url.trim() : "";
    const source_url = typeof item.source_url === "string" ? item.source_url.trim() : "";
    try {
      const image = new URL(image_url);
      const source = new URL(source_url);
      if (image.protocol !== "https:" || source.protocol !== "https:" ||
          !image.hostname.includes(".") || !source.hostname.includes(".") ||
          image.username || source.username || seen.has(image_url)) return [];
    } catch { return []; }
    seen.add(image_url);
    return [{ image_url, source_url,
      caption: String(item.caption || "").slice(0, 500),
      alt: String(item.alt || item.caption || "Illustration Web").slice(0, 300),
      after_paragraph: typeof item.after_paragraph === "number" && Number.isFinite(item.after_paragraph)
        ? Math.max(0, Math.min(200, Math.floor(item.after_paragraph))) : 0 }];
  }).slice(0, 3);
}

function normalizeVoiceNote(raw: Record<string, unknown>): VoiceNote | null {
  const audio_id = typeof raw.audio_id === "string" ? raw.audio_id :
    typeof raw.id === "string" ? raw.id : "";
  if (!audio_id) return null;
  return {
    audio_id,
    message_id: typeof raw.message_id === "string" ? raw.message_id : null,
    conversation_id: typeof raw.conversation_id === "string" ? raw.conversation_id : null,
    duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
    transcription_status: String(raw.transcription_status || "queued"),
    billing_status: String(raw.billing_status || "none"),
    transcription: typeof raw.transcription === "string" ? raw.transcription : null,
    delivery_mode: typeof raw.delivery_mode === "string" ? raw.delivery_mode : null,
    playback_url: typeof raw.playback_url === "string" ? raw.playback_url : null,
    credit_cost: typeof raw.credit_cost === "number" ? raw.credit_cost : null,
  };
}

function mergeVoiceNotes(current: VoiceNote[], incoming: VoiceNote[]): VoiceNote[] {
  const notes = new Map(current.map((note) => [note.audio_id, note]));
  for (const note of incoming) notes.set(note.audio_id, { ...notes.get(note.audio_id), ...note });
  return [...notes.values()];
}

function prettyDuration(ms: number | null | undefined) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const MAX_ATTACHMENTS = 3;

// Un gros collage devient automatiquement une pièce jointe texte.
// Cela évite de transformer le composer et l'historique en mur de texte.
const LONG_PASTE_THRESHOLD = 6000;

// Les messages utilisateur restent compacts dans l'historique.
const USER_MESSAGE_COLLAPSE_CHARACTERS = 700;
const USER_MESSAGE_COLLAPSE_LINES = 8;


type OriaLanguage = "fr" | "en";
type ReasoningMode = "fast" | "balanced" | "deep";

const REASONING_OPTIONS: Array<{
  id: ReasoningMode;
  label: Record<OriaLanguage, string>;
  description: Record<OriaLanguage, string>;
}> = [
  {
    id: "fast",
    label: { fr: "Rapide", en: "Fast" },
    description: {
      fr: "Réponse plus rapide",
      en: "Faster response",
    },
  },
  {
    id: "balanced",
    label: { fr: "Équilibré", en: "Balanced" },
    description: {
      fr: "Bon compromis vitesse / réflexion",
      en: "Balanced speed and reasoning",
    },
  },
  {
    id: "deep",
    label: { fr: "Approfondi", en: "Deep" },
    description: {
      fr: "Plus de réflexion pour les tâches complexes",
      en: "More reasoning for complex tasks",
    },
  },
];

function getReasoningOption(mode: ReasoningMode) {
  return (
    REASONING_OPTIONS.find((item) => item.id === mode) ??
    REASONING_OPTIONS[1]
  );
}

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
    packExpired: "Pack expiré",
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
    packExpired: "Pack expired",
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
    packs: ["light_pack", "intermediate_pack"], model: "GPT Image 2",
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

// La réponse réelle de /ai/media-capabilities est une liste d'actions
// (ex. "image_480"). On accepte aussi les objets enrichis pour compatibilité.
// La configuration locale sert uniquement aux libellés et aux métadonnées :
// les actions réellement accessibles proviennent de l'API.
function normalizeMediaCapability(raw: unknown): MediaCapability | null {
  const item = typeof raw === "string" ? { action: raw } : raw;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  const config = getMediaGenerationConfig(action);

  if (!config) return null;

  return {
    action: config.action,
    type: config.type,
    model:
      typeof record.model === "string" && record.model.trim()
        ? record.model
        : config.model,
    estimated_credits:
      typeof record.estimated_credits === "number" &&
      Number.isFinite(record.estimated_credits) &&
      record.estimated_credits >= 0
        ? record.estimated_credits
        : null,
    credits:
      typeof record.credits === "number" &&
      Number.isFinite(record.credits) && record.credits >= 0
        ? record.credits
        : null,
    quality: typeof record.quality === "string" ? record.quality : null,
    seconds:
      typeof record.seconds === "string" || typeof record.seconds === "number"
        ? record.seconds
        : null,
    size: typeof record.size === "string" ? record.size : null,
  };
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

const ORIA_AUDIO_MARKER_REGEX = /\[\[ORIA_AUDIO_ID:([^\]]+)\]\]/;
const ORIA_WEB_IMAGES_MARKER_REGEX = /\[\[ORIA_WEB_IMAGES:([A-Za-z0-9+/=]+)\]\]/;

function extractAudioIdFromMessage(content: string): string | null {
  return content.match(ORIA_AUDIO_MARKER_REGEX)?.[1] || null;
}

function webImagesMarker(images: WebIllustration[]): string {
  if (!images.length) return "";
  const bytes = new TextEncoder().encode(JSON.stringify(images));
  return `[[ORIA_WEB_IMAGES:${btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""))}]]`;
}

function extractWebImagesFromMessage(content: string): WebIllustration[] {
  const marker = content.match(ORIA_WEB_IMAGES_MARKER_REGEX)?.[1];
  if (!marker) return [];
  try {
    const binary = atob(marker);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return normalizeWebImages(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return []; }
}

const ORIA_ARTIFACT_MARKER_REGEX =
  /\[\[ORIA_ARTIFACT_ID:([^\]]+)\]\]/g;

function buildArtifactMessageMarkers(
  artifacts: GeneratedArtifact[],
): string {
  return artifacts
    .map(
      (artifact) =>
        `[[ORIA_ARTIFACT_ID:${artifact.id}]]`,
    )
    .join("\n");
}

function extractArtifactIdsFromMessage(
  content: string,
): string[] {
  const ids: string[] = [];

  for (
    const match of content.matchAll(
      ORIA_ARTIFACT_MARKER_REGEX,
    )
  ) {
    const id = match[1]?.trim();

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

function getVisibleMessageContent(
  content: string,
): string {
  return content
    .replace(
      /\s*\[\[ORIA_MEDIA_ID:[^\]]+\]\]\s*$/g,
      "",
    )
    .replace(
      /\s*\[\[ORIA_ARTIFACT_ID:[^\]]+\]\]\s*/g,
      "\n",
    )
    .replace(/\s*\[\[ORIA_WEB_IMAGES:[A-Za-z0-9+/=]+\]\]/g, "")
    .replace(/\s*\[\[ORIA_AUDIO_ID:[^\]]+\]\]/g, "")
    .trimEnd();
}

function normalizeGeneratedArtifact(
  raw: Record<string, unknown>,
  messageId?: string | null,
): GeneratedArtifact | null {
  const id =
    typeof raw.id === "string"
      ? raw.id
      : typeof raw.artifact_id === "string"
        ? raw.artifact_id
        : "";

  if (!id) {
    return null;
  }

  const filename =
    typeof raw.filename === "string" && raw.filename.trim()
      ? raw.filename.trim()
      : `fichier-${id}`;

  const extension =
    typeof raw.extension === "string"
      ? raw.extension.replace(/^\./, "").toLowerCase()
      : filename.includes(".")
        ? filename.split(".").pop()?.toLowerCase() || ""
        : "";

  const mimeType =
    typeof raw.mime_type === "string"
      ? raw.mime_type
      : typeof raw.mimeType === "string"
        ? raw.mimeType
        : "application/octet-stream";

  const category =
    typeof raw.category === "string"
      ? raw.category
      : "file";

  const sizeValue =
    typeof raw.size_bytes === "number"
      ? raw.size_bytes
      : typeof raw.sizeBytes === "number"
        ? raw.sizeBytes
        : 0;

  const downloadUrl =
    typeof raw.download_url === "string"
      ? raw.download_url
      : typeof raw.url === "string"
        ? raw.url
        : null;

  return {
    id,
    artifact_id: id,
    user_id:
      typeof raw.user_id === "string"
        ? raw.user_id
        : undefined,
    conversation_id:
      typeof raw.conversation_id === "string"
        ? raw.conversation_id
        : null,
    source_message_id:
      typeof raw.source_message_id === "string"
        ? raw.source_message_id
        : null,
    filename,
    extension,
    mimeType,
    category,
    sizeBytes:
      Number.isFinite(sizeValue)
        ? sizeValue
        : 0,
    sha256:
      typeof raw.sha256 === "string"
        ? raw.sha256
        : null,
    model:
      typeof raw.model === "string"
        ? raw.model
        : null,
    downloadUrl,
    created_at:
      typeof raw.created_at === "string"
        ? raw.created_at
        : null,
    messageId: messageId ?? null,
  };
}

function mergeGeneratedArtifacts(
  current: GeneratedArtifact[],
  incoming: GeneratedArtifact[],
): GeneratedArtifact[] {
  const map = new Map<string, GeneratedArtifact>();

  for (const artifact of current) {
    map.set(artifact.id, artifact);
  }

  for (const artifact of incoming) {
    const previous = map.get(artifact.id);

    map.set(
      artifact.id,
      previous
        ? {
            ...previous,
            ...artifact,
            downloadUrl:
              artifact.downloadUrl ||
              previous.downloadUrl ||
              null,
            messageId:
              artifact.messageId ||
              previous.messageId ||
              null,
          }
        : artifact,
    );
  }

  return [...map.values()];
}

function formatArtifactSize(
  sizeBytes: number,
  language: OriaLanguage,
): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return language === "en"
      ? "Size unavailable"
      : "Taille indisponible";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} o`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} Ko`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
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

const MATH_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ",
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", sim: "∼",
  equiv: "≡", propto: "∝", to: "→", rightarrow: "→",
  leftarrow: "←", leftrightarrow: "↔", mapsto: "↦",
  implies: "⇒", Rightarrow: "⇒", iff: "⇔", Leftrightarrow: "⇔",
  sum: "∑", prod: "∏", int: "∫", iint: "∬", iiint: "∭",
  cup: "∪", cap: "∩", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", in: "∈", notin: "∉",
  forall: "∀", exists: "∃", angle: "∠", degree: "°",
  perp: "⊥", parallel: "∥", therefore: "∴", because: "∵",
};

const MATH_WORD_COMMANDS: Record<string, string> = {
  sin: "sin", cos: "cos", tan: "tan", cot: "cot",
  arcsin: "arcsin", arccos: "arccos", arctan: "arctan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh",
  ln: "ln", log: "log", exp: "exp", lim: "lim",
  min: "min", max: "max", det: "det", gcd: "gcd",
};

type MathGroup = {
  content: string;
  nextIndex: number;
};

function normalizeMathSource(expression: string): string {
  return expression
    .replace(/\\dfrac/g, "\\frac")
    .replace(/\\tfrac/g, "\\frac")
    .replace(/\\displaystyle/g, "")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\begin\{(?:aligned|align\*?|gathered|cases|matrix|pmatrix|bmatrix|vmatrix)\}/g, "")
    .replace(/\\end\{(?:aligned|align\*?|gathered|cases|matrix|pmatrix|bmatrix|vmatrix)\}/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\quad/g, "  ")
    .replace(/\\qquad/g, "   ")
    .trim();
}

function readMathGroup(source: string, startIndex: number): MathGroup | null {
  if (source[startIndex] !== "{") return null;

  let depth = 0;

  for (let index = startIndex; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;

    if (depth === 0) {
      return {
        content: source.slice(startIndex + 1, index),
        nextIndex: index + 1,
      };
    }
  }

  return null;
}

function readOptionalMathArgument(
  source: string,
  startIndex: number,
): MathGroup | null {
  if (source[startIndex] === "{") {
    return readMathGroup(source, startIndex);
  }

  if (startIndex >= source.length) return null;

  if (source[startIndex] === "\\") {
    const commandMatch = source.slice(startIndex + 1).match(/^[A-Za-z]+/);
    if (commandMatch) {
      return {
        content: `\\${commandMatch[0]}`,
        nextIndex: startIndex + 1 + commandMatch[0].length,
      };
    }
  }

  return {
    content: source[startIndex],
    nextIndex: startIndex + 1,
  };
}

function renderMathNodes(
  rawSource: string,
  keyPrefix: string,
): ReactNode[] {
  const source = normalizeMathSource(rawSource);
  const nodes: ReactNode[] = [];
  let index = 0;
  let nodeIndex = 0;

  const pushText = (value: string) => {
    if (!value) return;
    nodes.push(
      <span key={`${keyPrefix}-text-${nodeIndex++}`}>
        {value}
      </span>,
    );
  };

  while (index < source.length) {
    const char = source[index];

    if (char === "\\") {
      // Double antislash LaTeX : retour à la ligne dans une formule multi-ligne.
      if (source[index + 1] === "\\") {
        nodes.push(<br key={`${keyPrefix}-br-${nodeIndex++}`} />);
        index += 2;
        continue;
      }

      const commandMatch = source.slice(index + 1).match(/^[A-Za-z]+/);

      if (!commandMatch) {
        pushText(source[index + 1] || "");
        index += source[index + 1] ? 2 : 1;
        continue;
      }

      const command = commandMatch[0];
      index += 1 + command.length;

      if (command === "frac") {
        const numerator = readMathGroup(source, index);
        if (!numerator) {
          pushText("÷");
          continue;
        }

        index = numerator.nextIndex;
        const denominator = readMathGroup(source, index);
        if (!denominator) {
          pushText(`(${numerator.content}) ÷`);
          continue;
        }

        index = denominator.nextIndex;
        nodes.push(
          <span
            key={`${keyPrefix}-frac-${nodeIndex++}`}
            className="mx-1 inline-flex min-w-[1.5em] flex-col items-center justify-center align-middle leading-none"
          >
            <span className="border-b border-current px-1 pb-0.5 text-center">
              {renderMathNodes(numerator.content, `${keyPrefix}-num-${nodeIndex}`)}
            </span>
            <span className="px-1 pt-0.5 text-center">
              {renderMathNodes(denominator.content, `${keyPrefix}-den-${nodeIndex}`)}
            </span>
          </span>,
        );
        continue;
      }

      if (command === "sqrt") {
        let rootDegree: string | null = null;

        if (source[index] === "[") {
          const closing = source.indexOf("]", index + 1);
          if (closing !== -1) {
            rootDegree = source.slice(index + 1, closing);
            index = closing + 1;
          }
        }

        const radicand = readMathGroup(source, index);
        if (!radicand) {
          pushText("√");
          continue;
        }

        index = radicand.nextIndex;
        nodes.push(
          <span
            key={`${keyPrefix}-sqrt-${nodeIndex++}`}
            className="mx-0.5 inline-flex items-start align-middle"
          >
            {rootDegree ? (
              <sup className="mr-[-0.15em] mt-[-0.1em] text-[0.58em] leading-none">
                {rootDegree}
              </sup>
            ) : null}
            <span className="text-[1.08em] leading-none">√</span>
            <span className="border-t border-current px-1 pt-0.5">
              {renderMathNodes(radicand.content, `${keyPrefix}-rad-${nodeIndex}`)}
            </span>
          </span>,
        );
        continue;
      }

      if (["text", "mathrm", "mathbf", "operatorname"].includes(command)) {
        const group = readMathGroup(source, index);
        if (!group) {
          pushText(command === "operatorname" ? "" : command);
          continue;
        }

        index = group.nextIndex;
        const content = group.content.replace(/\\ /g, " ");

        nodes.push(
          command === "mathbf" ? (
            <strong key={`${keyPrefix}-textcmd-${nodeIndex++}`} className="font-semibold">
              {content}
            </strong>
          ) : (
            <span
              key={`${keyPrefix}-textcmd-${nodeIndex++}`}
              className={command === "operatorname" ? "font-medium not-italic" : "not-italic"}
            >
              {content}
            </span>
          ),
        );
        continue;
      }

      if (["vec", "overrightarrow"].includes(command)) {
        const group = readMathGroup(source, index);
        if (!group) {
          pushText("→");
          continue;
        }

        index = group.nextIndex;
        nodes.push(
          <span
            key={`${keyPrefix}-vec-${nodeIndex++}`}
            className="relative mx-0.5 inline-block px-0.5 pt-1"
          >
            <span className="absolute left-0 right-0 top-[-0.25em] text-center text-[0.7em] leading-none">
              →
            </span>
            {renderMathNodes(group.content, `${keyPrefix}-veccontent-${nodeIndex}`)}
          </span>,
        );
        continue;
      }

      if (MATH_SYMBOLS[command]) {
        pushText(MATH_SYMBOLS[command]);
        continue;
      }

      if (MATH_WORD_COMMANDS[command]) {
        nodes.push(
          <span
            key={`${keyPrefix}-word-${nodeIndex++}`}
            className="mx-0.5 font-medium not-italic"
          >
            {MATH_WORD_COMMANDS[command]}
          </span>,
        );
        continue;
      }

      // Une commande inconnue est rendue sans antislash afin de ne pas
      // exposer du LaTeX brut / langage machine à l'utilisateur.
      pushText(command);
      continue;
    }

    if (char === "^" || char === "_") {
      const isSuperscript = char === "^";
      const argument = readOptionalMathArgument(source, index + 1);

      if (!argument) {
        pushText(char);
        index++;
        continue;
      }

      index = argument.nextIndex;
      const Tag = isSuperscript ? "sup" : "sub";

      nodes.push(
        <Tag
          key={`${keyPrefix}-${isSuperscript ? "sup" : "sub"}-${nodeIndex++}`}
          className={
            isSuperscript
              ? "ml-0.5 align-super text-[0.68em] leading-none"
              : "ml-0.5 align-sub text-[0.68em] leading-none"
          }
        >
          {renderMathNodes(argument.content, `${keyPrefix}-script-${nodeIndex}`)}
        </Tag>,
      );
      continue;
    }

    if (char === "{") {
      const group = readMathGroup(source, index);
      if (group) {
        nodes.push(
          <span key={`${keyPrefix}-group-${nodeIndex++}`}>
            {renderMathNodes(group.content, `${keyPrefix}-groupcontent-${nodeIndex}`)}
          </span>,
        );
        index = group.nextIndex;
        continue;
      }
    }

    if (char === "&") {
      pushText("   ");
      index++;
      continue;
    }

    let end = index + 1;
    while (
      end < source.length &&
      !["\\", "^", "_", "{", "&"].includes(source[end])
    ) {
      end++;
    }

    pushText(source.slice(index, end));
    index = end;
  }

  return nodes;
}

function renderMathToken(
  expression: string,
  key: string,
  display = false,
) {
  const content = renderMathNodes(expression, `math-${key}`);

  if (display) {
    return (
      <div
        key={key}
        className="my-4 w-full overflow-x-auto rounded-xl border border-border/70 bg-surface-secondary/55 px-4 py-3"
        title="Formule mathématique"
      >
        <div className="min-w-max text-center font-serif text-[1.05rem] leading-8 tracking-[0.01em]">
          {content}
        </div>
      </div>
    );
  }

  return (
    <span
      key={key}
      className="mx-0.5 inline-flex max-w-full items-baseline rounded-md bg-surface-secondary/70 px-1.5 py-0.5 font-serif text-[1em] leading-relaxed"
      title="Formule mathématique"
    >
      {content}
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

      const isDisplayMath =
        token.startsWith("$$") ||
        token.startsWith("\[");

      parts.push(
        renderMathToken(
          expression,
          String(index),
          isDisplayMath,
        ),
      );
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
        const [, label, url] = linkMatch;
        const safeUrl = oriaSafeUrl(url);
        parts.push(safeUrl ? (
          <a key={index} href={safeUrl} target="_blank" rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:opacity-70">{label}</a>
        ) : <span key={index}>{label}</span>);
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

function CollapsibleUserMessage({
  content,
  language = "fr",
}: {
  content: string;
  language?: OriaLanguage;
}) {
  const [expanded, setExpanded] =
    useState(false);

  const lineCount =
    content.split("\n").length;

  const collapsible =
    content.length >
      USER_MESSAGE_COLLAPSE_CHARACTERS ||
    lineCount >
      USER_MESSAGE_COLLAPSE_LINES;

  return (
    <div>
      <div
        className={`relative whitespace-pre-wrap break-words ${
          collapsible && !expanded
            ? "max-h-32 overflow-hidden"
            : ""
        }`}
      >
        {content}

        {collapsible && !expanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-accent to-transparent" />
        ) : null}
      </div>

      {collapsible ? (
        <button
          type="button"
          onClick={() =>
            setExpanded(
              (current) => !current,
            )
          }
          className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent-foreground/80 transition hover:bg-white/10 hover:text-accent-foreground"
          aria-expanded={expanded}
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${
              expanded
                ? "rotate-180"
                : ""
            }`}
          />
          {expanded
            ? language === "en"
              ? "Show less"
              : "Réduire"
            : language === "en"
              ? "Show more"
              : "Afficher la suite"}
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
 * ORIA — Code viewer, Web illustrations and private audio
 * ============================================================ */

function codeFileName(lang: string, hint = ""): string {
  const candidate = hint.match(/([\w./-]+\.[a-z0-9]{1,8})/i)?.[1];
  if (candidate) return candidate;
  const ext: Record<string, string> = {
    python: "py", javascript: "js", typescript: "ts", bash: "sh",
    shell: "sh", json: "json", tsx: "tsx", jsx: "jsx", html: "html", css: "css",
  };
  return `code_oria.${ext[lang.toLowerCase()] || lang.toLowerCase() || "txt"}`;
}

const CODE_WORDS = new Set([
  "const", "let", "var", "function", "class", "return", "if", "else", "try", "catch",
  "finally", "throw", "new", "async", "await", "import", "export", "default", "from",
  "interface", "type", "extends", "implements", "public", "private", "static", "def",
  "self", "None", "True", "False", "pass", "for", "while", "in", "of", "as",
  "with", "yield", "lambda", "raise", "except", "elif", "print", "SELECT", "WHERE",
  "FROM", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "AND", "OR", "JOIN",
]);

function highlightedCode(source: string): ReactNode {
  // Le source entier reste téléchargeable/copier, même quand il est très long.
  // Au-delà de 160 Ko, limiter uniquement la coloration (jamais le contenu).
  if (source.length > 160_000) return source;
  const token = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  const chunks: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const match of source.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > at) chunks.push(source.slice(at, index));
    const value = match[0];
    const className = /^(\/\/|#|--|\/\*)/.test(value)
      ? "text-emerald-500/90" : /^["'`]/.test(value)
        ? "text-amber-600 dark:text-amber-300" : /^\d/.test(value)
          ? "text-sky-600 dark:text-sky-300" : CODE_WORDS.has(value)
            ? "text-violet-600 dark:text-violet-300 font-semibold" : "";
    chunks.push(className ? <span key={n++} className={className}>{value}</span> : value);
    at = index + value.length;
  }
  if (at < source.length) chunks.push(source.slice(at));
  return chunks;
}

function downloadSource(code: string, filename: string) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\/\\]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function CodePreviewModal({ preview, onClose, language }: {
  preview: CodePreviewData; onClose: () => void; language: OriaLanguage;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={preview.title}
      className="fixed inset-0 z-[90] flex flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary"><Code2 size={19}/></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{preview.title}</p>
            <p className="text-[11px] text-muted">{preview.language.toUpperCase()} · {preview.code.split("\n").length} {language === "fr" ? "lignes" : "lines"}</p></div>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton value={preview.code} language={language}/>
          <button type="button" onClick={() => downloadSource(preview.code, preview.title)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-secondary"><Download size={15}/><span className="hidden sm:inline">{UI[language].download}</span></button>
          <button type="button" aria-label={language === "fr" ? "Fermer" : "Close"} onClick={onClose}
            className="rounded-xl p-2.5 transition hover:bg-surface-secondary"><X size={20}/></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-secondary/35 p-4 sm:p-7">
        <pre className="min-w-max whitespace-pre text-[12px] leading-[1.9] tabular-nums sm:text-[13px]"><code>{highlightedCode(preview.code)}</code></pre>
      </div>
    </div>
  );
}

function CodeBlockCard({ language, code, title, onExpand, uiLanguage }: {
  language: string; code: string; title: string;
  onExpand: (preview: CodePreviewData) => void; uiLanguage: OriaLanguage;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-secondary last:mb-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-muted-strong"><Code2 size={13} className="mr-1.5 inline"/>{title}</span>
        <div className="flex items-center gap-1.5"><CopyButton value={code} language={uiLanguage}/>
          <button type="button" onClick={() => onExpand({ title, language, code })}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] hover:bg-surface-tertiary"
            aria-label={uiLanguage === "fr" ? "Ouvrir le lecteur" : "Open code viewer"}>
            <Maximize2 size={13}/>{uiLanguage === "fr" ? "Ouvrir" : "Open"}</button>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto p-4 text-xs leading-6"><code className="whitespace-pre">{highlightedCode(code)}</code></pre>
    </div>
  );
}

function WebImageGallery({ images, language }: { images: WebIllustration[]; language: OriaLanguage }) {
  if (!images.length) return null;
  return (
    <div className="my-4 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
      {images.map((item) => (
        <a key={item.image_url} href={item.source_url} target="_blank" rel="noopener noreferrer"
          className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:border-muted-strong">
          <div className="aspect-[16/10] w-full overflow-hidden bg-surface-secondary">
            <img src={item.image_url} alt={item.alt} loading="lazy" referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"/>
          </div>
          <div className="flex items-start gap-2 p-3"><p className="min-w-0 flex-1 text-xs leading-5 text-muted-strong">
            {item.caption || item.alt}</p><ExternalLink size={13} className="mt-1 shrink-0 text-muted"/></div>
          <p className="px-3 pb-3 text-[10px] text-muted">{language === "fr" ? "Voir la source" : "View source"} · {new URL(item.source_url).hostname}</p>
        </a>
      ))}
    </div>
  );
}

function AudioWaveBars({ active = false }: { active?: boolean }) {
  return <div aria-hidden="true" className="flex h-8 flex-1 items-center justify-center gap-[3px]">
    {Array.from({length: 28}, (_, index) => (
      <span key={index} className={`w-[3px] rounded-full bg-current opacity-60 ${active ? "animate-pulse" : ""}`}
        style={{height: `${5 + ((index * 17 + 9) % 25)}px`, animationDelay: `${index * 40}ms`}}/>
    ))}
  </div>;
}

function VoiceMessageBubble({ note, language, onLoad }: {
  note: VoiceNote; language: OriaLanguage; onLoad: (id: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(note.playback_url || null);
  const pendingPlaybackRef = useRef(false);
  useEffect(() => {
    if (url && pendingPlaybackRef.current && audioRef.current) {
      pendingPlaybackRef.current = false;
      void audioRef.current.play().catch(() => setError(true));
    }
  }, [url]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  async function toggle() {
    if (playing) { audioRef.current?.pause(); return; }
    if (!url) {
      setLoading(true); setError(false);
      try {
        const next = await onLoad(note.audio_id);
        pendingPlaybackRef.current = true;
        setUrl(next);
      } catch { setError(true); } finally { setLoading(false); }
    } else {
      try { await audioRef.current?.play(); } catch { setError(true); }
    }
  }
  return (
    <div className="w-full max-w-[310px] rounded-2xl border border-border bg-surface p-3 text-foreground shadow-sm">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void toggle()} aria-label={playing ? "Pause" : "Play"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {loading ? <Loader2 size={17} className="animate-spin"/> : playing ? <Pause size={17}/> : <Play size={17}/>}</button>
        <div className="min-w-0 flex-1 text-accent"><AudioWaveBars active={playing}/>
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>{language === "fr" ? "Note vocale" : "Voice note"}</span><span>{prettyDuration(note.duration_ms)}</span>
          </div>
        </div>
      </div>
      {url && <audio ref={audioRef} src={url} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onError={() => { setPlaying(false); setUrl(null); setError(true); }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
        }}/>} 
      {url ? <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-tertiary">
        <div className="h-full rounded-full bg-accent" style={{width: `${progress}%`}}/></div> : null}
      {error ? <p className="mt-2 text-[11px] text-red-500">{language === "fr" ? "Lecture indisponible. Réessayez." : "Playback unavailable. Try again."}</p> : null}
    </div>
  );
}

/* ============================================================
 * ORIA — VISUAL RESPONSE BLOCKS (Web)
 * Safe, declarative visualizations: no executable markup, no raw SVG/HTML.
 * Schema is intentionally small so frontend and backend can evolve together.
 * ============================================================ */

type OriaRecord = Record<string, unknown>;

function oriaRecord(value: unknown): OriaRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as OriaRecord : null;
}

function oriaLabel(value: unknown, fallback = "", max = 160): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function oriaFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oriaSafeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname ? url.href : null;
  } catch { return null; }
}

function oriaTableCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let codeOpen = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && source[index + 1] === "|") {
      current += "|";
      index++;
    } else if (char === "`") {
      codeOpen = !codeOpen;
      current += char;
    } else if (char === "|" && !codeOpen) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function oriaIsTableDivider(line: string): boolean {
  const cells = oriaTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function OriaDataTable({ headers, rows, alignment, language }: {
  headers: string[];
  rows: string[][];
  alignment: Array<"left" | "center" | "right">;
  language: OriaLanguage;
}) {
  const [copied, setCopied] = useState(false);
  const asTsv = [headers, ...rows].map((row) => row.map((cell) =>
    cell.replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
  const alignClass = (index: number) => alignment[index] === "right" ? "text-right" :
    alignment[index] === "center" ? "text-center" : "text-left";
  return <section className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label={language === "fr" ? "Tableau de données" : "Data table"}>
    <div className="flex items-center justify-between border-b border-border bg-surface-secondary/40 px-3 py-2">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-muted"><FileText size={14}/>{language === "fr" ? "Tableau" : "Table"}</span>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(asTsv).then(() => {
        setCopied(true); window.setTimeout(() => setCopied(false), 1500);
      }).catch(() => setCopied(false)); }} className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-surface-tertiary">
        {copied ? (language === "fr" ? "Copié" : "Copied") : (language === "fr" ? "Copier" : "Copy")}
      </button>
    </div>
    <div className="max-w-full overflow-x-auto" role="region" tabIndex={0} aria-label={language === "fr" ? "Tableau défilable" : "Scrollable table"}>
      <table className="w-full min-w-max border-collapse text-[13px] leading-5">
        <thead><tr className="bg-surface-secondary/70">{headers.map((cell, index) =>
          <th scope="col" key={index} className={`whitespace-nowrap border-b border-border px-4 py-3 font-semibold ${alignClass(index)}`}>{renderInlineMarkdown(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="even:bg-surface-secondary/30">{headers.map((_, index) =>
          <td key={index} className={`max-w-[360px] border-b border-border/50 px-4 py-2.5 align-top last:border-b-0 ${alignClass(index)}`}>{renderInlineMarkdown(row[index] || "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function OriaCallout({ kind, lines, language }: {kind: string; lines: string[]; language: OriaLanguage}) {
  const variants: Record<string, { color: string; title: string }> = {
    NOTE: { color: "border-sky-500/50", title: language === "fr" ? "Note" : "Note" },
    TIP: { color: "border-emerald-500/50", title: language === "fr" ? "Conseil" : "Tip" },
    IMPORTANT: { color: "border-violet-500/50", title: language === "fr" ? "Important" : "Important" },
    WARNING: { color: "border-amber-500/60", title: language === "fr" ? "Attention" : "Warning" },
    CAUTION: { color: "border-red-500/60", title: language === "fr" ? "Prudence" : "Caution" },
  };
  const variant = variants[kind] || variants.NOTE;
  return <aside className={`my-4 rounded-xl border-l-4 ${variant.color} bg-surface-secondary/50 p-3.5`}>
    <p className="mb-1 text-xs font-bold tracking-wide">{variant.title}</p>
    <div className="space-y-1 text-[13px]">{lines.map((line, index) => <p key={index}>{renderInlineMarkdown(line)}</p>)}</div>
  </aside>;
}

const ORIA_PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#64748b"];

function OriaChart({ data, language }: { data: OriaRecord; language: OriaLanguage }) {
  const kind = oriaLabel(data.type || data.chartType).toLowerCase();
  if (!["bar", "line", "pie", "scatter"].includes(kind) || !Array.isArray(data.data)) return null;
  const title = oriaLabel(data.title, language === "fr" ? "Graphique" : "Chart");
  const items = data.data.slice(0, 36).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  const values = items.map((item) => oriaFinite(item.value ?? item.y));
  const points = items.filter((_, index) => values[index] !== null).map((item) => ({
    label: oriaLabel(item.label ?? item.name ?? item.x, "", 48),
    x: oriaFinite(item.x),
    y: oriaFinite(item.value ?? item.y) as number,
  }));
  if (!points.length) return null;
  const W = 640, H = 320, left = 55, right = 18, top = 24, bottom = 65;
  const plotW = W - left - right, plotH = H - top - bottom;
  const minY = Math.min(0, ...points.map((item) => item.y));
  const maxY = Math.max(0, ...points.map((item) => item.y));
  const scaleMin = minY === maxY ? minY - 1 : minY;
  const scaleMax = minY === maxY ? maxY + 1 : maxY;
  const yToPx = (value: number) => top + (scaleMax - value) / (scaleMax - scaleMin) * plotH;
  const labelFor = (value: number) => Number(value.toFixed(2)).toLocaleString(language === "fr" ? "fr-FR" : "en-US");
  let marks: ReactNode = null;
  if (kind === "pie") {
    const positive = points.filter((point) => point.y > 0);
    const sum = positive.reduce((total, item) => total + item.y, 0);
    if (!sum) return null;
    let cursor = -Math.PI / 2;
    marks = <>{positive.map((item, index) => {
      const ratio = item.y / sum;
      const angle = Math.PI * 2 * ratio;
      const start = cursor;
      cursor += angle;
      const cx = 300, cy = 155, radius = 115;
      if (ratio >= 0.99999) return <circle key={index} cx={cx} cy={cy} r={radius} fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}/>;
      const x1 = cx + radius * Math.cos(start), y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(cursor), y2 = cy + radius * Math.sin(cursor);
      return <path key={index} d={`M${cx} ${cy} L${x1} ${y1} A${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`}
        fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}><title>{item.label}: {labelFor(item.y)}</title></path>;
    })}</>;
  } else {
    const xs = points.map((point, index) => kind === "scatter" ? (point.x ?? index) : index);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const xToPx = (x: number) => minX === maxX ? left + plotW / 2 : left + (x - minX) / (maxX - minX) * plotW;
    const step = plotW / points.length;
    const linePoints = points.map((point, index) => `${xToPx(xs[index])},${yToPx(point.y)}`).join(" ");
    marks = <>
      {Array.from({length: 5}, (_, index) => {
        const value = scaleMin + (scaleMax - scaleMin) * index / 4;
        return <g key={index}><line x1={left} y1={yToPx(value)} x2={W - right} y2={yToPx(value)} stroke="currentColor" strokeOpacity="0.12"/>
          <text x={left - 8} y={yToPx(value) + 4} fontSize="12" textAnchor="end" fill="currentColor" opacity="0.7">{labelFor(value)}</text></g>;
      })}
      {kind === "bar" ? points.map((item, index) => {
        const x = left + index * step + step * 0.16;
        const barWidth = step * 0.68;
        const zeroY = yToPx(0), pointY = yToPx(item.y);
        return <rect key={index} x={x} y={Math.min(zeroY, pointY)} width={barWidth} height={Math.max(1, Math.abs(zeroY - pointY))} rx="3" fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}>
          <title>{item.label}: {labelFor(item.y)}</title></rect>;
      }) : null}
      {kind === "line" ? <polyline fill="none" stroke={ORIA_PALETTE[0]} strokeWidth="3" strokeLinejoin="round" points={linePoints}/> : null}
      {kind === "line" || kind === "scatter" ? points.map((item, index) => <circle key={index} cx={xToPx(xs[index])} cy={yToPx(item.y)} r={kind === "scatter" ? 5 : 4} fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}>
        <title>{item.label}: {labelFor(item.y)}</title></circle>) : null}
      {points.map((item, index) => points.length <= 14 || index % Math.ceil(points.length / 12) === 0 ?
        <text key={index} x={kind === "bar" ? left + step * (index + .5) : xToPx(xs[index])} y={H - bottom + 21}
          fontSize="11" fill="currentColor" opacity=".75" textAnchor="middle">{item.label.slice(0, 12)}</text> : null)}
    </>;
  }
  return <figure className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-4">
    <figcaption className="mb-2 font-semibold">{title}</figcaption>
    <div className="max-w-full overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="w-full min-w-[320px]" xmlns="http://www.w3.org/2000/svg">{marks}</svg></div>
    {kind === "pie" ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">{points.filter((point) => point.y > 0).map((point, index) =>
      <span key={index} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{backgroundColor: ORIA_PALETTE[index % ORIA_PALETTE.length]}}/>{point.label}: {labelFor(point.y)}</span>)}</div> : null}
    <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">{language === "fr" ? "Voir les données" : "View data"}</summary>
      <div className="mt-2 max-h-36 overflow-auto">{points.map((point, index) => <p key={index}>{point.label || index + 1}: {labelFor(point.y)}</p>)}</div>
    </details>
  </figure>;
}

function OriaStats({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.items)) return null;
  const items = data.items.slice(0, 12).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  if (!items.length) return null;
  return <section className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={oriaLabel(data.title, "Statistiques")}>
    {items.map((item, index) => <div key={index} className="min-w-0 rounded-xl border border-border bg-surface p-3">
      <p className="truncate text-[11px] text-muted">{oriaLabel(item.label)}</p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums">{oriaLabel(item.value, String(oriaFinite(item.value) ?? "—"), 60)}</p>
      {item.detail ? <p className="mt-1 text-xs text-muted">{oriaLabel(item.detail)}</p> : null}
    </div>)}
  </section>;
}

function OriaDiagram({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.nodes)) return null;
  const nodes = data.nodes.slice(0, 12).map(oriaRecord).filter((item): item is OriaRecord => !!item)
    .map((node, index) => ({id: oriaLabel(node.id, String(index)), label: oriaLabel(node.label, "Étape", 64)}));
  if (!nodes.length) return null;
  const edges = Array.isArray(data.edges) ? data.edges.slice(0, 24).map(oriaRecord).filter((item): item is OriaRecord => !!item) : [];
  const width = 600, row = 92, height = nodes.length * row + 28;
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  return <figure className="my-4 overflow-hidden rounded-2xl border border-border bg-surface p-3">
    <figcaption className="mb-2 font-semibold">{oriaLabel(data.title, "Diagramme")}</figcaption>
    <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label={oriaLabel(data.title, "Diagramme")}>
      {edges.map((edge, index) => {
        const from = indexes.get(oriaLabel(edge.from)), to = indexes.get(oriaLabel(edge.to));
        if (from === undefined || to === undefined || from === to) return null;
        const y1 = from * row + 71, y2 = to * row + 19;
        return <g key={index}><path d={`M300 ${y1} L300 ${y2}`} fill="none" stroke="#64748b" strokeWidth="1.5"/>
          <polygon points={y2 >= y1 ? `294,${y2 - 9} 306,${y2 - 9} 300,${y2}` : `294,${y2 + 9} 306,${y2 + 9} 300,${y2}`} fill="#64748b"/>
          {edge.label ? <text x="310" y={(y1 + y2) / 2} fontSize="11" fill="currentColor">{oriaLabel(edge.label, "", 30)}</text> : null}</g>;
      })}
      {nodes.map((node, index) => <g key={node.id}><rect x="120" y={index * row + 18} width="360" height="54" rx="14" fill="#2563eb" fillOpacity=".08" stroke="#64748b" strokeOpacity=".6"/>
        <text x="300" y={index * row + 49} fill="currentColor" fontSize="14" textAnchor="middle">{node.label}</text></g>)}
    </svg></div>
  </figure>;
}

function OriaGeometry({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.elements)) return null;
  const width = Math.min(1200, Math.max(100, oriaFinite(data.width) ?? 600));
  const height = Math.min(900, Math.max(100, oriaFinite(data.height) ?? 360));
  const shapes = data.elements.slice(0, 80).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  const number = (item: OriaRecord, key: string) => oriaFinite(item[key]);
  const color = (item: OriaRecord) => ORIA_PALETTE[Math.min(ORIA_PALETTE.length - 1, Math.max(0, Math.floor(oriaFinite(item.colorIndex) ?? 0)))];
  return <figure className="my-4 overflow-hidden rounded-2xl border border-border bg-surface p-3">
    <figcaption className="mb-2 font-semibold">{oriaLabel(data.title, "Figure géométrique")}</figcaption>
    <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label={oriaLabel(data.title, "Figure géométrique")}>
      {shapes.map((item, index) => {
        const type = oriaLabel(item.type);
        const stroke = color(item);
        if (type === "line") {
          const x1 = number(item,"x1"), y1 = number(item,"y1"), x2 = number(item,"x2"), y2 = number(item,"y2");
          return [x1,y1,x2,y2].every((v) => v !== null) ? <line key={index} x1={x1!} y1={y1!} x2={x2!} y2={y2!} stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "circle") {
          const cx = number(item,"cx"), cy = number(item,"cy"), r = number(item,"r");
          return cx !== null && cy !== null && r !== null && r > 0 && r < 2000 ? <circle key={index} cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "rect") {
          const x = number(item,"x"), y = number(item,"y"), w = number(item,"width"), h = number(item,"height");
          return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0 ? <rect key={index} x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "polygon" && Array.isArray(item.points)) {
          const coordinates = item.points.slice(0, 25).filter((point) => Array.isArray(point) && point.length === 2 && point.every((n) => oriaFinite(n) !== null)) as number[][];
          return coordinates.length >= 3 ? <polygon key={index} points={coordinates.map((p) => p.join(",")).join(" ")} fill={stroke} fillOpacity=".1" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "point" || type === "text") {
          const x = number(item,"x"), y = number(item,"y");
          if (x === null || y === null) return null;
          return <g key={index}>{type === "point" ? <circle cx={x} cy={y} r="4.5" fill={stroke}/> : null}
            <text x={x + (type === "point" ? 10 : 0)} y={y - (type === "point" ? 8 : 0)} fill="currentColor" fontSize="14">{oriaLabel(item.label, "", 60)}</text></g>;
        }
        return null;
      })}
    </svg></div>
    {data.caption ? <p className="mt-2 text-xs text-muted">{oriaLabel(data.caption, "", 280)}</p> : null}
  </figure>;
}

function oriaRenderVisualBlock(kind: string, raw: string, language: OriaLanguage): ReactNode | null {
  if (raw.length > 60000) return null;
  let data: OriaRecord | null;
  try { data = oriaRecord(JSON.parse(raw)); } catch { return null; }
  if (!data) return null;
  if (kind === "oria-chart") return <OriaChart data={data} language={language}/>;
  if (kind === "oria-stats") return <OriaStats data={data}/>;
  if (kind === "oria-diagram") return <OriaDiagram data={data}/>;
  if (kind === "oria-geometry") return <OriaGeometry data={data}/>;
  return null;
}

/*
 * ============================================================
 * MARKDOWN MESSAGE
 * ============================================================
 */

function MarkdownMessage({
  content,
  language = "fr",
  onOpenCode,
  webImages = [],
}: {
  content: string;
  language?: OriaLanguage;
  onOpenCode?: (preview: CodePreviewData) => void;
  webImages?: WebIllustration[];
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
  let codeTitle = "";
  let lastCodeHeading = "";
  const consumedTableLines = new Set<number>();

  let inCodeBlock = false;

  let blockIndex = 0;
  let paragraphIndex = 0;
  const placedImageUrls = new Set<string>();

  function addWebImages(upToParagraph: number) {
    const due = webImages.filter((item) => !placedImageUrls.has(item.image_url) &&
      item.after_paragraph <= upToParagraph);
    if (!due.length) return;
    due.forEach((item) => placedImageUrls.add(item.image_url));
    blocks.push(<WebImageGallery key={`web-${blockIndex++}`} images={due} language={language}/>);
  }

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
    addWebImages(paragraphIndex++);
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
              {/^\[([ xX])\]\s+/.test(item) ? (
                <label className="inline-flex items-start gap-2">
                  <input type="checkbox" checked={/^\[[xX]\]/.test(item)} readOnly
                    className="mt-1.5 h-3.5 w-3.5 accent-blue-600"/>
                  <span>{renderInlineMarkdown(item.replace(/^\[[ xX]\]\s+/, ""))}</span>
                </label>
              ) : renderInlineMarkdown(item)}
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

    const code = codeLines.join("\n");
    const title = codeFileName(codeLanguage, codeTitle);
    // Le rendu historique reste disponible en secours pour les anciens formats.
    const visual = ["oria-chart", "oria-stats", "oria-diagram", "oria-geometry"].includes(codeLanguage)
      ? oriaRenderVisualBlock(codeLanguage, code, language) : null;
    const codeFallback = <CodeBlockCard
      code={code}
      language={codeLanguage || "text"}
      title={title}
      uiLanguage={language}
      onExpand={onOpenCode || (() => undefined)}
    />;
    const fallback = visual ?? codeFallback;
    const advancedKinds = ["oria-chart", "oria-diagram", "oria-grid"];
    const coreKinds = ["oria-stats", "oria-geometry", "oria-callout", "oria-table"];
    // Un JSON mal formé reste visible sous forme de code au lieu d'une zone vide.
    const validVisualJson = (() => {
      if (![...advancedKinds, ...coreKinds, "oria-3d", "oria-map"].includes(codeLanguage)) return false;
      try {
        const value: unknown = JSON.parse(code);
        return value !== null && typeof value === "object" && !Array.isArray(value);
      } catch { return false; }
    })();
    blocks.push(!validVisualJson
      ? <Fragment key={`code-${blockIndex}`}>{codeFallback}</Fragment>
      : advancedKinds.includes(codeLanguage)
        ? <OriaVisualAdvanced key={`advanced-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={fallback} />
        : coreKinds.includes(codeLanguage)
          ? <OriaVisualCore key={`core-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={fallback} />
          : codeLanguage === "oria-3d"
            ? <OriaVisual3D key={`3d-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={codeFallback} />
            : <OriaVisualMaps key={`map-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={codeFallback} />);

    blockIndex++;
    codeLines = [];
    codeLanguage = "";
    codeTitle = "";
    inCodeBlock = false;
  }

  lines.forEach(
    (line, index) => {
      if (consumedTableLines.has(index)) return;
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
              .trim().split(/\s+/)[0];
          codeTitle = lastCodeHeading;
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
       * TABLEAUX GFM : détection en streaming, sans casser les blocs de code.
       */
      if (trimmed.includes("|") && index + 1 < lines.length &&
          oriaIsTableDivider(lines[index + 1].trim())) {
        const headers = oriaTableCells(trimmed);
        const separators = oriaTableCells(lines[index + 1].trim());
        if (headers.length >= 2 && headers.length <= 16 &&
            headers.length === separators.length) {
          flushAllLists();
          flushParagraph();
          consumedTableLines.add(index + 1);
          const alignment = separators.map((separator): "left" | "center" | "right" =>
            separator.startsWith(":") && separator.endsWith(":") ? "center" :
              separator.endsWith(":") ? "right" : "left");
          const rows: string[][] = [];
          let cursor = index + 2;
          while (cursor < lines.length && rows.length < 200 &&
              lines[cursor].trim() !== "" && lines[cursor].includes("|")) {
            const cells = oriaTableCells(lines[cursor]);
            if (cells.length !== headers.length) break;
            rows.push(cells);
            consumedTableLines.add(cursor);
            cursor++;
          }
          blocks.push(<OriaDataTable key={`table-${blockIndex}`} headers={headers}
            rows={rows} alignment={alignment} language={language}/>);
          blockIndex++;
          return;
        }
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
       * Citations multiligne et encadrés [!NOTE], [!TIP], etc.
       */
      if (trimmed.startsWith(">")) {
        flushAllLists();
        flushParagraph();
        const quoteLines: string[] = [];
        let cursor = index;
        while (cursor < lines.length && lines[cursor].trimStart().startsWith(">")) {
          quoteLines.push(lines[cursor].trimStart().replace(/^>\s?/, ""));
          if (cursor !== index) consumedTableLines.add(cursor);
          cursor++;
        }
        const marker = quoteLines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
        if (marker) {
          blocks.push(<OriaCallout key={`callout-${blockIndex}`} kind={marker[1].toUpperCase()}
            lines={quoteLines.slice(1).filter(Boolean)} language={language}/>);
        } else {
          blocks.push(<blockquote key={`quote-${blockIndex}`}
            className="mb-4 border-l-2 border-border-strong pl-4 text-muted-strong last:mb-0">
            {quoteLines.map((value, position) => <p key={position}>{renderInlineMarkdown(value)}</p>)}
          </blockquote>);
        }
        blockIndex++;
        return;
      }

      // Retient un titre de fichier éventuel pour le lecteur de code.
      if (/\.[a-z0-9]{1,8}(?:`|\*\*)?$/i.test(trimmed)) {
        lastCodeHeading = trimmed;
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
  addWebImages(Number.MAX_SAFE_INTEGER);

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

  const [reasoningMenuOpen, setReasoningMenuOpen] =
    useState(false);

  const [selectedModel, setSelectedModel] =
    useState("luna");

  const [reasoningMode, setReasoningMode] =
    useState<ReasoningMode>("balanced");

  const [activeGenerationId, setActiveGenerationId] =
    useState<string | null>(null);

  const [canModifyActiveGeneration, setCanModifyActiveGeneration] =
    useState(false);

  const [activeGenerationStarted, setActiveGenerationStarted] =
    useState(false);

  const [activeRequestMessageId, setActiveRequestMessageId] =
    useState<string | null>(null);

  const [modificationPanelOpen, setModificationPanelOpen] =
    useState(false);

  const [modificationDraft, setModificationDraft] =
    useState("");

  const [isApplyingModification, setIsApplyingModification] =
    useState(false);

  const [modificationStatus, setModificationStatus] =
    useState<"queued" | "applied" | null>(null);

  const pendingModificationRef =
    useRef<{
      generationId: string;
      instruction: string;
    } | null>(null);

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

  // Seules les actions annoncées par le backend sont affichées en temps
  // normal. En cas d'échec réseau, le fallback local reste disponible
  // uniquement si le wallet local indique un pack actif.
  // Le backend contrôle toujours l'autorisation lors de la génération.
  const [mediaCapabilities, setMediaCapabilities] =
    useState<MediaCapability[]>([]);

  const [selectedMediaAction, setSelectedMediaAction] =
    useState<string>("");

  const [mediaPrompt, setMediaPrompt] =
    useState("");

  const [generatedMedia, setGeneratedMedia] =
    useState<GeneratedMedia[]>([]);

  const [generatedArtifacts, setGeneratedArtifacts] =
    useState<GeneratedArtifact[]>([]);

  const [isLoadingMediaCapabilities, setIsLoadingMediaCapabilities] =
    useState(false);

  const [mediaMenuOpen, setMediaMenuOpen] =
    useState(false);

  // Ajouts Chat Web : lecteur source, images de recherche, notes vocales.
  const [codePreview, setCodePreview] = useState<CodePreviewData | null>(null);
  const [webImagesByMessage, setWebImagesByMessage] = useState<Record<string, WebIllustration[]>>({});
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const audioUploadBusyRef = useRef(false);
  // Enregistrement local : aucun transfert ni coût avant « Continuer vers l'envoi ».
  const localVoiceBlobRef = useRef<Blob | null>(null);
  // Même identifiant lors d'une relance après erreur réseau : protège l'idempotence.
  const localVoiceRequestIdRef = useRef<string | null>(null);
  const [voicePackWarning, setVoicePackWarning] = useState(false);

  // Seul l'identifiant est conservé en session, jamais l'audio ni sa transcription.
  useEffect(() => {
    if (!currentUserId) return;
    const key = `oria_audio_draft_v1_${currentUserId}`;
    const id = window.sessionStorage.getItem(key);
    if (!id) return;
    let closed = false;
    void apiFetch<VoiceNote>(`/ai/audio/${encodeURIComponent(id)}`)
      .then((result) => {
        if (closed) return;
        if (result.delivery_mode && result.delivery_mode !== "draft") {
          window.sessionStorage.removeItem(key);
          return;
        }
        const note = normalizeVoiceNote(result as unknown as Record<string, unknown>);
        if (note) setVoiceDraft((current) => current || {
          ...note, localUrl: result.playback_url || "",
          editedText: result.transcription || "", busy: false,
        });
      }).catch(() => { /* État indisponible : pas de second appel OpenAI. */ });
    return () => { closed = true; };
  }, [currentUserId]);

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
      // Ne pas conserver les capacités d'un éventuel ancien pack.
      setMediaCapabilities([]);
      setSelectedMediaAction("");

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

      // Une session sans wallet vérifié ne doit pas réutiliser des droits périmés.
      setWallet(null);
      setMediaCapabilities([]);
      setSelectedMediaAction("");

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
          loadPersistedArtifacts(),
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

      const remoteVoiceNotes = (data.voice_notes || [])
        .map(normalizeVoiceNote)
        .filter((note): note is VoiceNote => note !== null);
      setVoiceNotes((current) => mergeVoiceNotes(current, remoteVoiceNotes));

      const remoteArtifacts =
        (data.artifacts || [])
          .map((item) =>
            normalizeGeneratedArtifact(
              item,
            ),
          )
          .filter(
            (
              item,
            ): item is GeneratedArtifact =>
              item !== null,
          );

      setGeneratedArtifacts(
        (current) =>
          mergeGeneratedArtifacts(
            current,
            remoteArtifacts,
          ),
      );

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

  async function loadPersistedArtifacts(): Promise<void> {
    try {
      const data = await apiFetch<{
        success?: boolean;
        artifacts?: Array<Record<string, unknown>>;
      }>("/artifacts?limit=100");

      const restored =
        (data.artifacts ?? [])
          .map((item) =>
            normalizeGeneratedArtifact(
              item,
            ),
          )
          .filter(
            (
              item,
            ): item is GeneratedArtifact =>
              item !== null,
          );

      setGeneratedArtifacts(
        restored,
      );
    } catch (requestError) {
      console.error(
        "Erreur chargement fichiers Oria :",
        requestError,
      );
    }
  }

  function findArtifactsForMessage(
    item: ChatMessage,
  ): GeneratedArtifact[] {
    if (item.role !== "assistant") {
      return [];
    }

    const markerIds =
      extractArtifactIdsFromMessage(
        item.content || "",
      );

    const byMarker =
      markerIds
        .map((artifactId) =>
          generatedArtifacts.find(
            (artifact) =>
              artifact.id === artifactId,
          ),
        )
        .filter(
          (
            artifact,
          ): artifact is GeneratedArtifact =>
            Boolean(artifact),
        );

    if (byMarker.length > 0) {
      return byMarker;
    }

    // Pendant le streaming, le message n'a pas encore ses marqueurs persistés.
    return generatedArtifacts.filter(
      (artifact) =>
        artifact.messageId === item.id,
    );
  }

  async function downloadArtifact(
    artifact: GeneratedArtifact,
  ): Promise<void> {
    try {
      const response = await apiFetch<{
        success?: boolean;
        artifact?: Record<string, unknown>;
      }>(
        `/artifacts/${artifact.id}`,
      );

      const refreshed =
        response.artifact
          ? normalizeGeneratedArtifact(
              response.artifact,
              artifact.messageId,
            )
          : null;

      const downloadUrl =
        refreshed?.downloadUrl ||
        artifact.downloadUrl;

      if (!downloadUrl) {
        throw new Error(
          language === "en"
            ? "No download URL was returned."
            : "Aucune URL de téléchargement n'a été retournée.",
        );
      }

      setGeneratedArtifacts(
        (current) =>
          mergeGeneratedArtifacts(
            current,
            refreshed
              ? [refreshed]
              : [],
          ),
      );

      const fileResponse =
        await fetch(downloadUrl);

      if (!fileResponse.ok) {
        throw new Error(
          "Téléchargement impossible.",
        );
      }

      const blob =
        await fileResponse.blob();

      const objectUrl =
        URL.createObjectURL(blob);

      const anchor =
        document.createElement("a");

      anchor.href = objectUrl;
      anchor.download =
        artifact.filename ||
        `fichier-${artifact.id}`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(
        objectUrl,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Téléchargement impossible.",
      );
    }
  }

  async function openArtifactSource(artifact: GeneratedArtifact) {
    if (!CODE_PREVIEW_EXTENSIONS.has(artifact.extension.toLowerCase())) return;
    try {
      const response = await apiFetch<{artifact?: Record<string, unknown>}>(`/artifacts/${artifact.id}`);
      const renewed = response.artifact ? normalizeGeneratedArtifact(response.artifact) : null;
      const url = renewed?.downloadUrl || artifact.downloadUrl;
      if (!url) throw new Error("Fichier inaccessible.");
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) throw new Error("Fichier inaccessible.");
      const blob = await fileResponse.blob();
      if (blob.size > 2 * 1024 * 1024) {
        throw new Error(language === "fr" ? "Prévisualisation limitée à 2 Mo. Le téléchargement reste disponible." : "Preview limited to 2 MB. Download remains available.");
      }
      setCodePreview({ title: artifact.filename, language: artifact.extension, code: await blob.text() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d'ouvrir le fichier.");
    }
  }

  async function loadPrivateVoiceUrl(audioId: string): Promise<string> {
    const response = await apiFetch<VoiceNote>(`/ai/audio/${encodeURIComponent(audioId)}`);
    if (!response.playback_url) throw new Error("Lien vocal indisponible.");
    return response.playback_url;
  }

  function voiceNoteForMessage(item: ChatMessage): VoiceNote | null {
    if (item.role !== "user") return null;
    const markerId = extractAudioIdFromMessage(item.content || "");
    const stored = voiceNotes.find((note) => note.message_id === item.id ||
      (markerId && note.audio_id === markerId));
    // Le marqueur local permet la réécoute après un rechargement :
    // l'URL signée reste obtenue à la demande auprès du backend.
    return stored || (markerId ? {
      audio_id: markerId, transcription_status: "complete", billing_status: "settled",
      message_id: item.id, delivery_mode: "voice",
    } : null);
  }

  function stopRecorder() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    recordingIntervalRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    setRecording(false);
  }

  async function startVoiceRecording() {
    if (isThinking || recording || voiceDraft || audioUploadBusyRef.current) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error(language === "fr" ? "Le microphone n'est pas disponible sur ce navigateur." : "Microphone unavailable in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const bestMime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = bestMime ? new MediaRecorder(stream, { mimeType: bestMime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => { setError("Échec de l'enregistrement vocal."); stopRecorder(); };
      recorder.onstop = () => {
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        if (audio.size > 0) {
          localVoiceBlobRef.current = audio;
          localVoiceRequestIdRef.current = crypto.randomUUID();
          setVoicePackWarning(false);
          setVoiceDraft({
            audio_id: "", transcription_status: "local", billing_status: "none",
            localUrl: URL.createObjectURL(audio), editedText: "", busy: false,
          });
        } else {
          setError(language === "fr" ? "Enregistrement vocal vide." : "Empty voice recording.");
        }
      };
      recorder.start(250);
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
      recordingIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
        setRecordingSeconds(elapsed);
        if (elapsed >= 300) stopRecorder();
      }, 500);
      setError(null);
    } catch (cause) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setError(cause instanceof Error ? cause.message : "Microphone indisponible.");
    }
  }

  async function uploadVoiceDraft(blob: Blob) {
    if (audioUploadBusyRef.current || voiceDraft?.transcription_status !== "local") return;
    // La vérification n'empêche jamais d'enregistrer et de réécouter en local.
    // Le backend revalide indépendamment le pack avant toute transcription.
    if (!wallet?.is_pack_active) {
      setVoicePackWarning(true);
      setError(language === "fr"
        ? "Pack inactif : activez un pack ORIA pour envoyer ou transcrire ce vocal. L'enregistrement reste disponible ici."
        : "Inactive pack: activate an ORIA pack to send or transcribe this voice note. Your recording stays here.");
      return;
    }
    setVoicePackWarning(false);
    audioUploadBusyRef.current = true;
    const localUrl = voiceDraft.localUrl;
    setVoiceDraft((current) => current ? {
      ...current, transcription_status: "uploading", busy: true,
    } : current);
    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const created = await createConversationRemote(language === "fr" ? "Note vocale" : "Voice note");
        conversationId = created.id;
        setConversations((current) => [created, ...current]);
        setActiveConversationId(created.id);
      }
      const mime = blob.type.split(";", 1)[0] || "audio/webm";
      const ext = mime === "audio/mp4" ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", new File([blob], `oria-voice.${ext}`, { type: mime }));
      form.append("request_id", localVoiceRequestIdRef.current || crypto.randomUUID());
      form.append("conversation_id", conversationId);
      const response = await apiFetch<VoiceNote>("/ai/audio/prepare", { method: "POST", body: form });
      const note = normalizeVoiceNote(response as unknown as Record<string, unknown>);
      if (!note) throw new Error("Le serveur n'a pas retourné d'identifiant audio.");
      if (currentUserId) window.sessionStorage.setItem(`oria_audio_draft_v1_${currentUserId}`, note.audio_id);
      localVoiceBlobRef.current = null;
      localVoiceRequestIdRef.current = null;
      setVoiceDraft({ ...note, localUrl, editedText: "", busy: false });
    } catch (cause) {
      // Une erreur réseau ou un pack expiré ne fait pas perdre le brouillon local.
      setVoiceDraft((current) => current ? {
        ...current, transcription_status: "local", busy: false,
      } : current);
      setError(cause instanceof Error ? cause.message : "Échec du transfert audio.");
    } finally {
      audioUploadBusyRef.current = false;
    }
  }

  useEffect(() => {
    const id = voiceDraft?.audio_id;
    if (!id || voiceDraft?.busy || (voiceDraft.transcription_status === "complete" && voiceDraft.billing_status === "settled") ||
      voiceDraft?.transcription_status === "failed") return;
    let disposed = false;
    let polling = false;
    let elapsed = 0;
    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        let result = await apiFetch<VoiceNote>(`/ai/audio/${encodeURIComponent(id)}`);
        if (result.transcription_status === "complete" && result.billing_status === "settlement_pending") {
          result = await apiFetch<VoiceNote>(`/ai/audio/${encodeURIComponent(id)}/reconcile`, {method:"POST"});
        }
        if (!disposed) {
          setVoiceDraft((current) => current?.audio_id === id
            ? { ...current, ...normalizeVoiceNote(result as unknown as Record<string, unknown>),
                editedText: current.editedText || result.transcription || "" } : current);
        }
      } catch (cause) {
        console.warn("En attente du traitement vocal Oria :", cause);
      } finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => {
      elapsed += 4;
      if (elapsed <= 240) void poll();
    }, 4000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [voiceDraft?.audio_id, voiceDraft?.transcription_status, voiceDraft?.billing_status, voiceDraft?.busy]);

  async function discardVoiceDraft() {
    const draft = voiceDraft;
    if (!draft || draft.busy) return;
    try {
      if (draft.audio_id) await apiFetch(`/ai/audio/${encodeURIComponent(draft.audio_id)}`, {method:"DELETE"});
      if (draft.localUrl.startsWith("blob:")) URL.revokeObjectURL(draft.localUrl);
      localVoiceBlobRef.current = null;
      localVoiceRequestIdRef.current = null;
      setVoicePackWarning(false);
      if (currentUserId) window.sessionStorage.removeItem(`oria_audio_draft_v1_${currentUserId}`);
      setVoiceDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suppression momentanément indisponible.");
    }
  }

  async function retryVoiceDraft() {
    if (!voiceDraft?.audio_id) return;
    try {
      let result: VoiceNote;
      if (voiceDraft.billing_status === "release_pending") {
        result = await apiFetch<VoiceNote>(`/ai/audio/${voiceDraft.audio_id}/reconcile-release`, {method:"POST"});
      } else if (voiceDraft.billing_status === "settlement_pending") {
        result = await apiFetch<VoiceNote>(`/ai/audio/${voiceDraft.audio_id}/reconcile`, {method:"POST"});
      } else {
        result = await apiFetch<VoiceNote>(`/ai/audio/${voiceDraft.audio_id}/retry`, {method:"POST"});
      }
      setVoiceDraft((current) => current ? { ...current, ...normalizeVoiceNote(result as unknown as Record<string, unknown>) } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reprise indisponible.");
    }
  }

  async function deliverVoiceDraft(mode: "voice" | "text") {
    const draft = voiceDraft;
    if (!draft?.audio_id || draft.transcription_status !== "complete" || draft.billing_status !== "settled" || isThinking) return;
    if (draft.conversation_id !== activeConversationId) {
      setError(language === "fr" ? "Rouvrez la conversation où le vocal a été enregistré." : "Open the conversation where the voice note was recorded.");
      return;
    }
    try {
      setVoiceDraft((current) => current ? { ...current, busy: true } : current);
      const edited = draft.editedText.trim() || draft.transcription || "";
      await apiFetch(`/ai/audio/${draft.audio_id}/send`, {
        method: "POST", body: JSON.stringify({mode, edited_text: mode === "text" ? edited : null}),
      });
      const note = { ...draft, delivery_mode: mode };
      if (mode === "voice") setVoiceNotes((current) => mergeVoiceNotes(current, [note]));
      // L'IA lit le transcript ; le message utilisateur reste un vocal si mode=voice.
      await handleSendMessage({content: mode === "text" ? edited : (draft.transcription || edited),
        voice: mode === "voice" ? note : undefined});
      if (draft.localUrl.startsWith("blob:")) URL.revokeObjectURL(draft.localUrl);
      if (currentUserId) window.sessionStorage.removeItem(`oria_audio_draft_v1_${currentUserId}`);
      setVoiceDraft(null);
    } catch (cause) {
      setVoiceDraft((current) => current ? { ...current, busy: false } : current);
      setError(cause instanceof Error ? cause.message : "Envoi du vocal impossible.");
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
      // Une ancienne sélection ne doit pas rester utilisable pendant la requête.
      setMediaCapabilities([]);
      setSelectedMediaAction("");

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

      // Une liste vide fournie par le backend est une vraie réponse :
      // ne jamais réactiver les actions avec le fallback dans ce cas.
      // De même, ne rien afficher pour un pack inactif ou différent du wallet.
      const packIsActive =
        data.success === true &&
        data.pack_active === true &&
        wallet?.is_pack_active === true &&
        data.pack_id === wallet.pack_id;

      const next = packIsActive ? normalized : [];

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

      // Secours en cas d'erreur réseau uniquement, jamais en remplacement
      // d'une réponse valide (même vide) du backend.
      const fallback = wallet?.is_pack_active
        ? getLocalMediaCapabilities(wallet.pack_id)
        : [];

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

  function createPastedTextAttachment(
    pastedText: string,
  ): boolean {
    if (
      attachments.length >=
      MAX_ATTACHMENTS
    ) {
      setError(
        `Vous pouvez joindre au maximum ${MAX_ATTACHMENTS} éléments par message.`,
      );
      return false;
    }

    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          "-",
        );

    const file = new File(
      [pastedText],
      `texte-colle-${timestamp}.txt`,
      {
        type: "text/plain",
      },
    );

    addAttachments(
      [file],
      "file",
    );

    return true;
  }

  function handleComposerPaste(
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) {
    const pastedText =
      event.clipboardData.getData(
        "text/plain",
      );

    if (
      pastedText.length <
      LONG_PASTE_THRESHOLD
    ) {
      return;
    }

    event.preventDefault();

    const created =
      createPastedTextAttachment(
        pastedText,
      );

    if (created) {
      setError(null);
    }
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

    if (!wallet?.is_pack_active || isLoadingMediaCapabilities) {
      setError("Un pack actif est nécessaire pour créer un média.");
      return;
    }

    // Ne jamais envoyer une action absente des capacités réellement affichées.
    // En cas d'indisponibilité de l'API, celles-ci peuvent provenir du
    // fallback local restreint au pack actif ; le backend vérifie les droits.
    const capability = mediaCapabilities.find(
      (item) => item.action === selectedMediaAction,
    );

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

  async function selectReasoningMode(
    mode: ReasoningMode,
  ) {
    setReasoningMode(mode);
    setReasoningMenuOpen(false);
    setModelMenuOpen(false);

    if (
      !isThinking ||
      !activeGenerationId ||
      !canModifyActiveGeneration
    ) {
      return;
    }

    try {
      await apiFetch<{
        success?: boolean;
        accepted?: boolean;
        strategy?: string;
        reasoning_mode?: ReasoningMode;
      }>("/ai/chat/control", {
        method: "POST",
        body: JSON.stringify({
          generation_id: activeGenerationId,
          reasoning_mode: mode,
        }),
      });
    } catch (requestError) {
      console.error(
        "Modification du raisonnement impossible :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : language === "en"
            ? "Unable to change reasoning during this response."
            : "Impossible de changer la réflexion pendant cette réponse.",
      );
    }
  }

  async function sendActiveRequestModification(
    generationId: string,
    instruction: string,
  ) {
    return apiFetch<{
      success?: boolean;
      accepted?: boolean;
      strategy?: string;
      reasoning_mode?: ReasoningMode;
    }>("/ai/chat/control", {
      method: "POST",
      body: JSON.stringify({
        generation_id: generationId,
        instruction,
      }),
    });
  }

  async function handleApplyActiveRequestModification() {
    const instruction =
      modificationDraft.trim();

    if (
      !instruction ||
      !isThinking ||
      !activeGenerationId ||
      !activeRequestMessageId
    ) {
      return;
    }

    setIsApplyingModification(true);
    setError(null);

    try {
      /*
       * Le bouton « Modifier » est utilisable immédiatement après Envoyer.
       * Si le backend n'a pas encore envoyé l'événement SSE "start",
       * on garde l'instruction quelques millisecondes côté client puis
       * on l'envoie dès que la génération devient pilotable.
       */
      if (!activeGenerationStarted) {
        pendingModificationRef.current = {
          generationId: activeGenerationId,
          instruction,
        };

        setModificationStatus("queued");
        setModificationPanelOpen(false);
        setModificationDraft("");
        return;
      }

      if (!canModifyActiveGeneration) {
        throw new Error(
          language === "en"
            ? "Live modification is unavailable for this generation."
            : "La modification en direct n'est pas disponible pour cette génération.",
        );
      }

      await sendActiveRequestModification(
        activeGenerationId,
        instruction,
      );

      setModificationStatus("applied");
      setModificationPanelOpen(false);
      setModificationDraft("");
    } catch (requestError) {
      console.error(
        "Modification de la requête en cours impossible :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : language === "en"
            ? "Unable to modify the request during this response."
            : "Impossible de modifier la requête pendant cette réponse.",
      );
    } finally {
      setIsApplyingModification(false);
    }
  }

  async function handleSendMessage(options?: {content?: string; voice?: VoiceNote}) {
    const content =
      (options?.content ?? message).trim();

    // Garde-fou supplémentaire : même si un collage massif contourne
    // l'événement onPaste (autofill, extension navigateur, etc.),
    // il devient une pièce jointe avant tout envoi au backend.
    if (
      content.length >=
      LONG_PASTE_THRESHOLD
    ) {
      const created =
        createPastedTextAttachment(
          content,
        );

      if (created) {
        setMessage("");
        setError(
          language === "en"
            ? "Long pasted text was converted to a text file. You can now send it."
            : "Le texte long a été transformé en fichier texte. Vous pouvez maintenant l'envoyer.",
        );
      }

      return;
    }

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

    /*
     * L'identifiant de génération est créé AVANT l'appel réseau.
     * Le bouton « Modifier » peut donc apparaître dès que le message
     * utilisateur est affiché, même avant le premier token d'Oria.
     */
    const generationId =
      crypto.randomUUID();

    const userMessageId =
      crypto.randomUUID();

    const userMessage:
      ChatMessage = {
      id: userMessageId,
      conversationId,
      role: "user",
      content: `${content}${attachmentSummary}${options?.voice ? `\n[[ORIA_AUDIO_ID:${options.voice.audio_id}]]` : ""}`.trim(),
      createdAt: now,
    };

    setActiveGenerationId(
      generationId,
    );
    setActiveGenerationStarted(
      false,
    );
    setCanModifyActiveGeneration(
      false,
    );
    setActiveRequestMessageId(
      userMessageId,
    );
    setModificationPanelOpen(
      false,
    );
    setModificationDraft("");
    setModificationStatus(null);
    pendingModificationRef.current =
      null;

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
       * SAUVEGARDE MESSAGE UTILISATEUR — NON BLOQUANTE
       * ======================================================
       *
       * IMPORTANT PERFORMANCE :
       * le streaming IA ne doit plus attendre la requête de persistance.
       * Le message est déjà visible localement ; Supabase se synchronise
       * en parallèle pendant que /ai/chat/stream démarre.
       */

      const userMessageSavePromise =
        saveMessageRemote(
          userMessage,
        ).then(async (savedMessage) => {
          if (options?.voice && savedMessage?.id) {
            await apiFetch(`/ai/audio/${options.voice.audio_id}/attach-message`, {
              method: "POST", body: JSON.stringify({message_id: savedMessage.id}),
            });
            setVoiceNotes((current) => mergeVoiceNotes(current, [
              { ...options.voice!, message_id: savedMessage.id },
            ]));
          }
          return savedMessage;
        }).catch(
          (saveError) => {
            console.error(
              "Erreur sauvegarde message utilisateur :",
              saveError,
            );

            setError(
              "Message conservé localement. Synchronisation cloud en attente.",
            );

            return null;
          },
        );

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

      // Identifiant stable créé avant l'appel réseau afin que
      // « Modifier » soit disponible immédiatement.
      formData.append(
        "generation_id",
        generationId,
      );

      formData.append(
        "reasoning_mode",
        reasoningMode,
      );

      // ORIA Visual V1 : compatible avec le rendu visuel de ce Chat Web.
      // Le backend garde visual_mode=False pour les anciens clients Expo.
      formData.append(
        "visual_mode",
        "true",
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
      let streamedArtifacts: GeneratedArtifact[] = [];
      let streamedWebImages: WebIllustration[] = [];
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
            "start"
          ) {
            const liveModify =
              Boolean(
                eventData.live_modify,
              );

            const startedGenerationId =
              typeof eventData.generation_id ===
              "string"
                ? eventData.generation_id
                : generationId;

            setActiveGenerationStarted(
              true,
            );
            setCanModifyActiveGeneration(
              liveModify,
            );
            setActiveGenerationId(
              startedGenerationId,
            );

            /*
             * L'utilisateur peut avoir appuyé sur « Modifier » pendant
             * que le backend préparait encore la génération. Dans ce cas,
             * l'instruction est envoyée ici, avant que le frontend n'affiche
             * les prochains deltas du stream.
             */
            // TypeScript peut conserver un narrowing obsolète de la ref
            // depuis son reset précédent dans cette même fonction, alors
            // qu'un clic utilisateur peut l'avoir remplie pendant les await.
            // On rétablit explicitement le type réel lu au moment du SSE start.
            const pendingModification =
              pendingModificationRef.current as {
                generationId: string;
                instruction: string;
              } | null;

            if (
              pendingModification &&
              pendingModification.generationId ===
                startedGenerationId
            ) {
              pendingModificationRef.current =
                null;

              if (!liveModify) {
                setModificationStatus(
                  null,
                );
                setError(
                  language === "en"
                    ? "Live modification is unavailable for this generation."
                    : "La modification en direct n'est pas disponible pour cette génération.",
                );
              } else {
                try {
                  setIsApplyingModification(
                    true,
                  );

                  await sendActiveRequestModification(
                    startedGenerationId,
                    pendingModification.instruction,
                  );

                  setModificationStatus(
                    "applied",
                  );
                } catch (
                  modificationError
                ) {
                  console.error(
                    "Modification en attente impossible :",
                    modificationError,
                  );

                  setModificationStatus(
                    null,
                  );
                  setError(
                    modificationError instanceof Error
                      ? modificationError.message
                      : language === "en"
                        ? "Unable to apply the queued modification."
                        : "Impossible d'appliquer la modification en attente.",
                  );
                } finally {
                  setIsApplyingModification(
                    false,
                  );
                }
              }
            }

            continue;
          }

          if (
            eventName ===
            "generation_restarted"
          ) {
            assistantContent = "";
            streamedWebImages = [];
            setWebImagesByMessage((current) => ({ ...current, [assistantId]: [] }));

            setMessages(
              (current) =>
                current.map(
                  (item) =>
                    item.id ===
                    assistantId
                      ? {
                          ...item,
                          content: "",
                        }
                      : item,
                ),
            );

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

          if (eventName === "web_images") {
            streamedWebImages = normalizeWebImages(eventData.images);
            setWebImagesByMessage((current) => ({...current, [assistantId]: streamedWebImages}));
            continue;
          }

          if (
            eventName ===
            "artifact"
          ) {
            const artifact =
              normalizeGeneratedArtifact(
                eventData,
                assistantId,
              );

            if (artifact) {
              streamedArtifacts =
                mergeGeneratedArtifacts(
                  streamedArtifacts,
                  [artifact],
                );

              setGeneratedArtifacts(
                (current) =>
                  mergeGeneratedArtifacts(
                    current,
                    [artifact],
                  ),
              );
            }

            continue;
          }

          if (
            eventName ===
            "artifact_error"
          ) {
            if (
              typeof eventData.detail ===
              "string"
            ) {
              setError(
                eventData.detail,
              );
            }

            continue;
          }

          if (
            eventName ===
            "done"
          ) {
            if (Array.isArray(eventData.web_images)) {
              streamedWebImages = normalizeWebImages(eventData.web_images);
              setWebImagesByMessage((current) => ({...current, [assistantId]: streamedWebImages}));
            }
            const doneArtifacts =
              Array.isArray(
                eventData.artifacts,
              )
                ? eventData.artifacts
                    .map((item) =>
                      item &&
                      typeof item ===
                        "object"
                        ? normalizeGeneratedArtifact(
                            item as Record<
                              string,
                              unknown
                            >,
                            assistantId,
                          )
                        : null,
                    )
                    .filter(
                      (
                        item,
                      ): item is GeneratedArtifact =>
                        item !== null,
                    )
                : [];

            if (
              doneArtifacts.length > 0
            ) {
              streamedArtifacts =
                mergeGeneratedArtifacts(
                  streamedArtifacts,
                  doneArtifacts,
                );

              setGeneratedArtifacts(
                (current) =>
                  mergeGeneratedArtifacts(
                    current,
                    doneArtifacts,
                  ),
              );
            }

            setCanModifyActiveGeneration(
              false,
            );
            setActiveGenerationStarted(
              false,
            );
            setActiveGenerationId(
              null,
            );
            setActiveRequestMessageId(
              null,
            );
            setModificationPanelOpen(
              false,
            );
            setModificationDraft("");
            setModificationStatus(null);
            pendingModificationRef.current =
              null;

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

      const artifactMarkers =
        buildArtifactMessageMarkers(
          streamedArtifacts,
        );

      const webMarker = webImagesMarker(streamedWebImages);
      const persistedAssistantContent =
        [assistantContent, artifactMarkers, webMarker].filter(Boolean).join("\n\n");

      // On remplace le contenu live par sa version persistable contenant
      // les marqueurs invisibles qui permettront de retrouver les fichiers
      // après réouverture de la conversation.
      setMessages(
        (current) =>
          current.map(
            (item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content:
                      persistedAssistantContent,
                  }
                : item,
          ),
      );

      const assistantMessage:
        ChatMessage = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content:
          persistedAssistantContent,
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

      // On ne l'attend qu'ici, après la génération : aucun impact sur
      // le temps avant le premier token.
      await userMessageSavePromise;

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
      setCanModifyActiveGeneration(
        false,
      );
      setActiveGenerationStarted(
        false,
      );
      setActiveGenerationId(
        null,
      );
      setActiveRequestMessageId(
        null,
      );
      setModificationPanelOpen(
        false,
      );
      setModificationDraft("");
      setModificationStatus(null);
      pendingModificationRef.current =
        null;
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

  // Solde réellement disponible à afficher.
  // Un pack expiré/inactif doit toujours apparaître à 0 crédit,
  // même si un ancien solde reste encore stocké dans Supabase.
  // La navigation reste libre et la sécurité des actions IA
  // reste gérée par le backend et Supabase.
  const availableBalance =
    wallet?.is_pack_active
      ? wallet.balance
      : 0;

  /*
   * ==========================================================
   * AFFICHAGE
   * ==========================================================
   */

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      {codePreview ? <CodePreviewModal preview={codePreview} onClose={() => setCodePreview(null)} language={language}/> : null}
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
                  ? availableBalance.toLocaleString(language === "en" ? "en-US" : "fr-FR")
                  : "—"}
            </p>

            <p className="mt-1 text-[11px] text-muted">
              {wallet && !wallet.is_pack_active
                ? UI[language].packExpired
                : remainingDays !== null
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
            {(generatedMedia.length +
              generatedArtifacts.length) > 0 && (
              <span className="ml-auto rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] text-muted">
                {generatedMedia.length +
                  generatedArtifacts.length}
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
                    ? availableBalance.toLocaleString(language === "en" ? "en-US" : "fr-FR")
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
                            ? "flex flex-col items-end"
                            : "flex flex-col items-start"
                        }
                      >
                        <div
                          className={
                            item.role ===
                            "user"
                              ? "max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-5 py-3.5 text-sm leading-6 text-accent-foreground"
                              : "w-full text-foreground"
                          }
                        >
                          {item.role ===
                          "assistant" ? (
                            /*
                             * IMPORTANT :
                             *
                             * Les réponses IA utilisent le renderer Markdown
                             * existant, mais sont affichées sans bulle afin de
                             * conserver une lecture ouverte de type ChatGPT.
                             *
                             * Le Markdown, les blocs de code, les maths,
                             * la copie et les médias restent inchangés.
                             */
                            <>
                              <MarkdownMessage
                                language={language}
                                onOpenCode={setCodePreview}
                                webImages={webImagesByMessage[item.id] || extractWebImagesFromMessage(item.content || "")}
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
                            <>
                              {voiceNoteForMessage(item) ? (
                                <div className="flex flex-col gap-2">
                                  <VoiceMessageBubble
                                    note={voiceNoteForMessage(item)!}
                                    language={language}
                                    onLoad={loadPrivateVoiceUrl}
                                  />
                                  <details className="max-w-[310px] text-[11px] opacity-80">
                                    <summary className="cursor-pointer">{language === "fr" ? "Voir la transcription" : "View transcript"}</summary>
                                    <p className="pt-2 whitespace-pre-wrap">{getVisibleMessageContent(item.content)}</p>
                                  </details>
                                </div>
                              ) : (
                                <CollapsibleUserMessage
                                  content={getVisibleMessageContent(item.content)}
                                  language={language}
                                />
                              )}
                            </>
                          )}
                        </div>

                        {item.role === "user" ? (
                          <div className="mt-2 flex w-full max-w-sm flex-col items-end gap-2">
                            <div className="flex justify-end gap-1">
                              <MessageCopyButton
                                language={language}
                                value={item.content}
                              />

                              {isThinking &&
                              item.id ===
                                activeRequestMessageId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModificationPanelOpen(
                                      true,
                                    );
                                    setModificationDraft(
                                      "",
                                    );
                                    setModificationStatus(
                                      null,
                                    );
                                    setError(null);
                                  }}
                                  className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground"
                                >
                                  {language ===
                                  "en"
                                    ? "Modify"
                                    : "Modifier"}
                                </button>
                              ) : null}
                            </div>

                            {isThinking &&
                            item.id ===
                              activeRequestMessageId &&
                            modificationPanelOpen ? (
                              <div className="w-full rounded-2xl border border-border bg-surface p-3 text-foreground shadow-sm">
                                <p className="text-xs font-semibold">
                                  {language ===
                                  "en"
                                    ? "Modify the response in progress"
                                    : "Modifier la réponse en cours"}
                                </p>

                                <p className="mt-1 text-[11px] leading-4 text-muted">
                                  {language ===
                                  "en"
                                    ? "Tell Oria what to change without starting a new request."
                                    : "Dites à Oria ce qu'il faut changer sans lancer une nouvelle requête."}
                                </p>

                                <textarea
                                  autoFocus
                                  rows={3}
                                  value={
                                    modificationDraft
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    setModificationDraft(
                                      event
                                        .target
                                        .value,
                                    )
                                  }
                                  onKeyDown={(
                                    event,
                                  ) => {
                                    if (
                                      event.key ===
                                        "Enter" &&
                                      !event.shiftKey
                                    ) {
                                      event.preventDefault();

                                      void handleApplyActiveRequestModification();
                                    }
                                  }}
                                  placeholder={
                                    language ===
                                    "en"
                                      ? "E.g. make it shorter, show only the calculation, focus on part 2..."
                                      : "Ex. fais plus court, donne seulement le calcul, concentre-toi sur la partie 2..."
                                  }
                                  disabled={
                                    isApplyingModification
                                  }
                                  className="mt-3 w-full resize-none rounded-xl border border-border bg-surface-secondary px-3 py-2 text-sm leading-5 outline-none placeholder:text-muted focus:border-muted-strong disabled:opacity-60"
                                />

                                <div className="mt-3 flex items-center justify-between gap-3">
                                  <p className="text-[10px] leading-4 text-muted">
                                    {!activeGenerationStarted
                                      ? language ===
                                        "en"
                                        ? "If Oria is still preparing, the change will be sent as soon as the generation starts."
                                        : "Si Oria prépare encore la réponse, la modification sera envoyée dès le démarrage de la génération."
                                      : canModifyActiveGeneration
                                        ? language ===
                                          "en"
                                          ? "This changes the current generation, not a new message."
                                          : "Cela modifie la génération actuelle, sans créer un nouveau message."
                                        : language ===
                                          "en"
                                          ? "Live modification is unavailable for this generation."
                                          : "La modification en direct n'est pas disponible pour cette génération."}
                                  </p>

                                  <div className="flex shrink-0 items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModificationPanelOpen(
                                          false,
                                        );
                                        setModificationDraft(
                                          "",
                                        );
                                      }}
                                      disabled={
                                        isApplyingModification
                                      }
                                      className="rounded-lg px-3 py-2 text-xs font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground disabled:opacity-50"
                                    >
                                      {language ===
                                      "en"
                                        ? "Cancel"
                                        : "Annuler"}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleApplyActiveRequestModification()
                                      }
                                      disabled={
                                        !modificationDraft.trim() ||
                                        isApplyingModification ||
                                        (activeGenerationStarted &&
                                          !canModifyActiveGeneration)
                                      }
                                      className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
                                    >
                                      {isApplyingModification
                                        ? language ===
                                          "en"
                                          ? "Applying..."
                                          : "Application..."
                                        : language ===
                                          "en"
                                          ? "Apply"
                                          : "Appliquer"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {isThinking &&
                            item.id ===
                              activeRequestMessageId &&
                            modificationStatus ? (
                              <p className="text-right text-[10px] text-muted">
                                {modificationStatus ===
                                "queued"
                                  ? language ===
                                    "en"
                                    ? "Modification queued…"
                                    : "Modification en attente…"
                                  : language ===
                                    "en"
                                    ? "Modification applied to the current response."
                                    : "Modification appliquée à la réponse en cours."}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

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

                        {(() => {
                          const artifactsForMessage =
                            findArtifactsForMessage(
                              item,
                            );

                          if (
                            artifactsForMessage.length ===
                            0
                          ) {
                            return null;
                          }

                          return (
                            <div className="mt-3 grid w-full max-w-xl gap-2">
                              {artifactsForMessage.map(
                                (artifact) => (
                                  <div
                                    key={
                                      artifact.id
                                    }
                                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 shadow-sm"
                                  >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted-strong">
                                      <FileText
                                        size={18}
                                      />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">
                                        {
                                          artifact.filename
                                        }
                                      </p>

                                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted">
                                        {artifact.extension ||
                                          artifact.category}
                                        {" · "}
                                        {formatArtifactSize(
                                          artifact.sizeBytes,
                                          language,
                                        )}
                                      </p>
                                    </div>

                                    {CODE_PREVIEW_EXTENSIONS.has(artifact.extension.toLowerCase()) ? (
                                      <button type="button" onClick={() => void openArtifactSource(artifact)}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-xs font-medium hover:bg-surface-tertiary"
                                        title={language === "fr" ? "Lire le code" : "Read code"}>
                                        <Code2 size={14}/><span className="hidden sm:inline">{language === "fr" ? "Lire" : "View"}</span>
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void downloadArtifact(
                                          artifact,
                                        )
                                      }
                                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-xs font-medium transition hover:bg-surface-tertiary"
                                      title={
                                        UI[language]
                                          .download
                                      }
                                      aria-label={`${UI[language].download} ${artifact.filename}`}
                                    >
                                      <Download
                                        size={14}
                                      />
                                      <span className="hidden sm:inline">
                                        {
                                          UI[
                                            language
                                          ]
                                            .download
                                        }
                                      </span>
                                    </button>
                                  </div>
                                ),
                              )}
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
                MODÈLE + PUISSANCE DE RÉFLEXION
                ================================================== */}

            <div
              className={`mx-auto w-full max-w-3xl ${
                messages.length === 0
                  ? "mt-10"
                  : "mt-4"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative inline-block">
                  <button
                    type="button"
                    className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition ${
                      modelMenuOpen
                        ? "border-border-strong bg-surface-tertiary"
                        : "border-border bg-surface hover:bg-surface-secondary"
                    }`}
                    onClick={() => {
                      setReasoningMenuOpen(false);

                      if (
                        getSelectableModels(
                          wallet?.pack_id ?? null,
                          trials,
                        ).length > 1
                      ) {
                        setModelMenuOpen(
                          (current) => !current,
                        );
                      }
                    }}
                  >
                    <Sparkles size={16} />

                    {models.find(
                      (model) =>
                        model.id === selectedModel,
                    )?.name || "Modèle"}

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
                        wallet?.pack_id ?? null,
                        trials,
                      ).map((model) => (
                        <ModelOption
                          language={language}
                          key={model.id}
                          name={model.name}
                          description={
                            getModelDescription(
                              model.id,
                              language,
                            ) || model.description
                          }
                          active={
                            selectedModel ===
                            model.id
                          }
                          trial={trials[model.id]}
                          disabled={
                            Boolean(trials[model.id]) &&
                            trials[model.id].remaining <= 0
                          }
                          onClick={() => {
                            if (
                              trials[model.id] &&
                              trials[model.id].remaining <= 0
                            ) {
                              return;
                            }

                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                            setReasoningMenuOpen(false);
                          }}
                        />
                      ))}

                      {getSelectableModels(
                        wallet?.pack_id ?? null,
                        trials,
                      ).length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted">
                          {UI[language].noModel}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="relative inline-block">
                  <button
                    type="button"
                    className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition ${
                      reasoningMenuOpen
                        ? "border-border-strong bg-surface-tertiary"
                        : "border-border bg-surface hover:bg-surface-secondary"
                    }`}
                    onClick={() => {
                      setModelMenuOpen(false);
                      setReasoningMenuOpen(
                        (current) => !current,
                      );
                    }}
                  >
                    <span className="text-xs">
                      {reasoningMode === "fast"
                        ? "⚡"
                        : reasoningMode === "deep"
                          ? "◆"
                          : "◉"}
                    </span>

                    {
                      getReasoningOption(
                        reasoningMode,
                      ).label[language]
                    }

                    {isThinking &&
                      canModifyActiveGeneration && (
                        <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[9px] text-muted">
                          {language === "en"
                            ? "live"
                            : "en cours"}
                        </span>
                      )}

                    <ChevronDown
                      size={15}
                      className={`transition-transform ${
                        reasoningMenuOpen
                          ? "rotate-180"
                          : ""
                      }`}
                    />
                  </button>

                  {reasoningMenuOpen && (
                    <div className="absolute bottom-12 left-0 z-30 w-80 rounded-2xl border border-border bg-surface p-2 shadow-xl">
                      {REASONING_OPTIONS.map(
                        (option) => {
                          const active =
                            reasoningMode ===
                            option.id;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                void selectReasoningMode(
                                  option.id,
                                )
                              }
                              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                                active
                                  ? "bg-surface-tertiary"
                                  : "hover:bg-surface-secondary"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2 text-sm font-medium">
                                    <span>
                                      {option.id ===
                                      "fast"
                                        ? "⚡"
                                        : option.id ===
                                            "deep"
                                          ? "◆"
                                          : "◉"}
                                    </span>
                                    {
                                      option.label[
                                        language
                                      ]
                                    }
                                  </div>

                                  <p className="mt-0.5 text-xs text-muted">
                                    {
                                      option
                                        .description[
                                        language
                                      ]
                                    }
                                  </p>
                                </div>

                                {active && (
                                  <Check
                                    size={15}
                                    className="mt-0.5 text-muted-strong"
                                  />
                                )}
                              </div>
                            </button>
                          );
                        },
                      )}

                      {isThinking &&
                        canModifyActiveGeneration && (
                          <p className="px-3 pb-1 pt-2 text-[10px] text-muted">
                            {language === "en"
                              ? "Changing this now updates the active response."
                              : "Changer ce niveau maintenant met à jour la réponse en cours."}
                          </p>
                        )}
                    </div>
                  )}
                </div>
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
        // Une catégorie absente de la réponse serveur reste indisponible.
        const selectable = mediaCapabilities.filter((item) => item.type === type);

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

              const configurations = mediaCapabilities.filter(
                (item) => item.type === selectedType,
              );

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
          disabled={isThinking || isLoadingMediaCapabilities || !wallet?.is_pack_active}
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
              !wallet?.is_pack_active ||
              isLoadingMediaCapabilities ||
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
                {recording ? (
                  <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500"/>
                    <div className="min-w-0 flex-1 text-red-500"><AudioWaveBars active/></div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">{prettyDuration(recordingSeconds * 1000)}</span>
                    <button type="button" onClick={stopRecorder} className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white" aria-label="Stop recording"><Square size={15}/></button>
                  </div>
                ) : null}
                {voiceDraft ? (
                  <div className="mx-3 mt-3 rounded-2xl border border-border bg-surface-secondary/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-xs font-semibold"><Mic size={15}/>{language === "fr" ? "Votre note vocale" : "Your voice note"}</p>
                      <button type="button" onClick={() => void discardVoiceDraft()} disabled={voiceDraft.busy || ["reserved", "settlement_pending", "release_pending"].includes(voiceDraft.billing_status) || voiceDraft.transcription_status === "processing"}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-tertiary disabled:opacity-30" aria-label="Discard voice note"><X size={15}/></button>
                    </div>
                    <audio controls className="mt-3 h-10 w-full" src={voiceDraft.localUrl} preload="metadata"/>
                    <p className="mt-2 text-[11px] text-muted">
                      {voiceDraft.transcription_status === "local" ? (language === "fr" ? "Prêt à envoyer · enregistré uniquement sur cet appareil" : "Ready to send · stored only on this device") :
                       voiceDraft.transcription_status === "uploading" ? (language === "fr" ? "Transfert privé en cours…" : "Uploading privately…") :
                       voiceDraft.transcription_status === "failed" ? (language === "fr" ? "Transcription interrompue." : "Transcription interrupted.") :
                       voiceDraft.billing_status === "settlement_pending" ? (language === "fr" ? "Finalisation des crédits…" : "Settling credits…") :
                       voiceDraft.transcription_status === "complete" && voiceDraft.billing_status === "settled" ? (language === "fr" ? "Transcription prête · choisissez le format d’envoi" : "Transcript ready · choose how to send") :
                       (language === "fr" ? "Transcription en cours…" : "Transcribing…")}
                    </p>
                    {voiceDraft.transcription_status === "local" ? (
                      <>
                        <button type="button"
                          disabled={voiceDraft.busy || isThinking}
                          onClick={() => {
                            const audio = localVoiceBlobRef.current;
                            if (audio) void uploadVoiceDraft(audio);
                          }}
                          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                        ><ArrowUp size={14}/>{language === "fr" ? "Continuer vers l'envoi" : "Continue to send"}</button>
                        {voicePackWarning ? (
                          <p role="alert" className="mt-2 text-xs text-red-500">
                            {language === "fr" ? "Pack inactif : activez un pack pour envoyer ou transcrire ce vocal. Le brouillon reste disponible." : "Inactive pack: activate a pack to send or transcribe this note. Your draft is preserved."}
                            {" "}<Link href="/credits" className="font-semibold underline underline-offset-2">{language === "fr" ? "Voir les packs" : "View plans"}</Link>
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {voiceDraft.transcription_status === "complete" && voiceDraft.billing_status === "settled" ? (
                      <>
                        <textarea rows={3} className="mt-3 w-full resize-y rounded-xl border border-border bg-surface p-3 text-xs leading-5 outline-none focus:border-muted-strong"
                          value={voiceDraft.editedText} onChange={(event) => setVoiceDraft((current) => current ? {...current, editedText: event.target.value} : current)}
                          placeholder={language === "fr" ? "Corrigez le texte avant l'envoi…" : "Edit text before sending…"}/>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" disabled={voiceDraft.busy || isThinking} onClick={() => void deliverVoiceDraft("voice")}
                            className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"><Mic size={14}/>{language === "fr" ? "Envoyer en vocal" : "Send voice"}</button>
                          <button type="button" disabled={voiceDraft.busy || isThinking || !voiceDraft.editedText.trim()} onClick={() => void deliverVoiceDraft("text")}
                            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium disabled:opacity-40">{language === "fr" ? "Envoyer le texte corrigé" : "Send edited text"}</button>
                        </div>
                      </>
                    ) : null}
                    {voiceDraft.audio_id && !voiceDraft.busy && ["queued", "processing"].includes(voiceDraft.transcription_status) ? (
                      <button type="button" onClick={() => void apiFetch<VoiceNote>(`/ai/audio/${voiceDraft.audio_id}`)
                        .then((result) => setVoiceDraft((current) => current ? {
                          ...current, ...normalizeVoiceNote(result as unknown as Record<string, unknown>),
                          editedText: current.editedText || result.transcription || "",
                        } : current)).catch(() => setError(language === "fr" ? "Statut audio indisponible." : "Audio status unavailable."))}
                        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                        <RotateCcw size={13}/>{language === "fr" ? "Actualiser le statut" : "Refresh status"}
                      </button>
                    ) : null}
                    {(voiceDraft.transcription_status === "failed" || ["release_pending", "settlement_pending"].includes(voiceDraft.billing_status)) ? (
                      <button type="button" onClick={() => void retryVoiceDraft()} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"><RotateCcw size={13}/>{language === "fr" ? "Réparer / relancer" : "Repair / retry"}</button>
                    ) : null}
                  </div>
                ) : null}
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
                  onPaste={
                    handleComposerPaste
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

                  {!recording ? (
                    <button type="button" aria-label={language === "fr" ? "Enregistrer une note vocale" : "Record voice note"}
                      title={language === "fr" ? "Note vocale" : "Voice note"} onClick={() => void startVoiceRecording()}
                      disabled={isThinking || Boolean(voiceDraft) || audioUploadBusyRef.current}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface-secondary transition hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-30"><Mic size={18}/></button>
                  ) : (
                    <button type="button" onClick={stopRecorder} aria-label="Stop recording"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white"><Square size={17}/></button>
                  )}
                  <button
                    type="button"
                    aria-label={UI[language].send}
                    onClick={() => void handleSendMessage()}
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
                {language === "fr" ? (
                  <>
                    Jusqu&apos;à {MAX_ATTACHMENTS} {UI.fr.attachmentsHelp} Les collages très longs sont convertis automatiquement en fichier texte.
                  </>
                ) : (
                  <>
                    Up to {MAX_ATTACHMENTS} {UI.en.attachmentsHelp} Very long pasted text is automatically converted into a text file.
                  </>
                )}
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