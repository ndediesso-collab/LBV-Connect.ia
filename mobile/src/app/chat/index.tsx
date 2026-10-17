import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Stack, useFocusEffect, useNavigation, useRouter } from "expo-router";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";
import { File as ExpoFile, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

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
 *   GET  /artifacts
 *   GET  /artifacts/:id
 *   GET  /ai/media-capabilities
 *   POST /ai/image
 *   POST /ai/video
 *   POST /ai/chat/control
 *   POST /ai/chat/stream
 *
 * Le cache utilise localStorage sur Web et SecureStore sur Android/iOS.
 */

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";


type OriaLanguage = "fr" | "en";

type ReasoningMode = "fast" | "balanced" | "deep";

const REASONING_OPTIONS: Array<{
  id: ReasoningMode;
  label: Record<OriaLanguage, string>;
  description: Record<OriaLanguage, string>;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}> = [
  {
    id: "fast",
    label: { fr: "Rapide", en: "Fast" },
    description: {
      fr: "Réponse plus rapide",
      en: "Faster response",
    },
    icon: "flash-outline",
  },
  {
    id: "balanced",
    label: { fr: "Équilibré", en: "Balanced" },
    description: {
      fr: "Bon compromis vitesse / réflexion",
      en: "Balanced speed and reasoning",
    },
    icon: "options-outline",
  },
  {
    id: "deep",
    label: { fr: "Approfondi", en: "Deep" },
    description: {
      fr: "Plus de réflexion pour les tâches complexes",
      en: "More reasoning for complex tasks",
    },
    icon: "diamond-outline",
  },
];

function getReasoningOption(
  mode: ReasoningMode,
) {
  return (
    REASONING_OPTIONS.find(
      (item) => item.id === mode,
    ) ?? REASONING_OPTIONS[1]
  );
}

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

  // Preserve non-neutral semantic/accent colors.
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


const CHAT_TEXT = {
  fr: {
    newConversation: "Nouvelle conversation",
    copyMessage: "Copier le message",
    copied: "Copié",
    copy: "Copier",
    modify: "Modifier",
    modifyCurrentResponse: "Modifier la réponse en cours",
    modifyHelp:
      "Dites à Oria ce qu'il faut changer sans lancer une nouvelle requête.",
    modifyPlaceholder:
      "Ex. fais plus court, donne seulement le calcul, concentre-toi sur la partie 2...",
    cancel: "Annuler",
    apply: "Appliquer",
    applying: "Application...",
    modificationQueued: "Modification en attente…",
    modificationApplied: "Modification appliquée à la réponse en cours.",
    modificationWaitingStart:
      "Si Oria prépare encore la réponse, la modification sera envoyée dès le démarrage de la génération.",
    modificationLiveUnavailable:
      "La modification en direct n'est pas disponible pour cette génération.",
    modificationCurrentGeneration:
      "Cela modifie la génération actuelle, sans créer un nouveau message.",
    trial: "Essai",
    higherModelTrial: "Modèle supérieur · 5 essais maximum",
    image: "Image",
    file: "Fichier",
    open: "Ouvrir",
    download: "Télécharger",
    codePreview: "Lire le code",
    codeViewer: "Lecteur de code",
    vocal: "Note vocale",
    microphone: "Enregistrer une note vocale",
    recordStop: "Arrêter l'enregistrement",
    voiceUploading: "Envoi de l'enregistrement...",
    transcriptionWaiting: "Transcription en cours...",
    transcriptionFailed: "Transcription non terminée",
    sendAsVoice: "Envoyer le vocal",
    sendAsText: "Envoyer le texte",
    voiceEditHint: "Corrigez le texte avant de l'envoyer si nécessaire.",
    voiceRetry: "Réessayer / réparer",
    voiceDiscard: "Supprimer le brouillon",
    voiceLocalReady: "Votre note est prête. La transcription et l'envoi nécessitent un pack actif.",
    voicePrepareSend: "Continuer vers l'envoi",
    voicePackRequiredToSend: "Activez un pack ORIA pour envoyer et transcrire cette note vocale. L'enregistrement reste disponible ici.",
    audioPermission: "Autorisez le microphone dans les réglages pour enregistrer.",
    audioBusy: "Le message vocal est en cours de traitement.",
    webImageSource: "Source",
    showMore: "Afficher la suite",
    showLess: "Réduire",
    longPasteConverted:
      "Le texte long a été transformé en fichier texte. Vous pouvez maintenant l'envoyer.",
    longPasteFailed:
      "Impossible de transformer ce long texte en fichier.",
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
    packExpired: "Pack expiré",
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
    modify: "Modify",
    modifyCurrentResponse: "Modify the response in progress",
    modifyHelp:
      "Tell Oria what to change without starting a new request.",
    modifyPlaceholder:
      "E.g. make it shorter, show only the calculation, focus on part 2...",
    cancel: "Cancel",
    apply: "Apply",
    applying: "Applying...",
    modificationQueued: "Modification queued…",
    modificationApplied: "Modification applied to the current response.",
    modificationWaitingStart:
      "If Oria is still preparing, the change will be sent as soon as the generation starts.",
    modificationLiveUnavailable:
      "Live modification is unavailable for this generation.",
    modificationCurrentGeneration:
      "This changes the current generation, not a new message.",
    trial: "Trial",
    higherModelTrial: "Higher-tier model · 5 trials maximum",
    image: "Image",
    file: "File",
    open: "Open",
    download: "Download",
    codePreview: "Read code",
    codeViewer: "Code viewer",
    vocal: "Voice note",
    microphone: "Record a voice note",
    recordStop: "Stop recording",
    voiceUploading: "Uploading recording...",
    transcriptionWaiting: "Transcribing...",
    transcriptionFailed: "Transcription not finished",
    sendAsVoice: "Send voice note",
    sendAsText: "Send as text",
    voiceEditHint: "Edit the transcript before sending if needed.",
    voiceRetry: "Retry / recover",
    voiceDiscard: "Discard draft",
    voiceLocalReady: "Your recording is ready. Transcription and sending require an active pack.",
    voicePrepareSend: "Continue to send",
    voicePackRequiredToSend: "Activate an ORIA pack to send and transcribe this voice note. Your recording remains available here.",
    audioPermission: "Allow microphone access in settings to record.",
    audioBusy: "The voice note is being processed.",
    webImageSource: "Source",
    showMore: "Show more",
    showLess: "Show less",
    longPasteConverted:
      "Long pasted text was converted to a text file. You can now send it.",
    longPasteFailed:
      "Unable to convert this long text into a file.",
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
    packExpired: "Pack expired",
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
  is_pack_active: boolean;
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
  pack_active?: boolean;
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
  messageId?: string | null;
};

type WebIllustration = {
  image_url: string;
  source_url: string;
  alt: string;
  caption: string;
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
  localUri: string | null;
  editedText: string;
  busy: boolean;
};

// Un enregistrement non envoyé reste local, sans appel OpenAI ni réservation de crédits.
type LocalVoiceDraft = {
  uri: string;
  duration_ms: number;
};

type CodePreviewData = {
  title: string;
  language: string;
  code: string;
  downloadUrl?: string | null;
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

// Un collage massif devient automatiquement une pièce jointe texte.
// React Native n'expose pas un événement onPaste fiable sur toutes les
// plateformes : on détecte donc une insertion très importante dans onChangeText.
const LONG_PASTE_THRESHOLD = 6000;
const USER_MESSAGE_COLLAPSE_CHARACTERS = 700;
const USER_MESSAGE_COLLAPSE_LINES = 8;

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
const ORIA_ARTIFACT_MARKER_REGEX =
  /\[\[ORIA_ARTIFACT_ID:([^\]]+)\]\]/g;

function buildMediaMessageContent(
  type: "image" | "video",
  action: string,
  mediaId: string,
) {
  return `${type === "image" ? "Image" : "Vidéo"} générée · ${action}\n[[ORIA_MEDIA_ID:${mediaId}]]`;
}

function buildArtifactMessageMarkers(
  artifacts: GeneratedArtifact[],
) {
  return artifacts
    .map(
      (artifact) =>
        `[[ORIA_ARTIFACT_ID:${artifact.id}]]`,
    )
    .join("\n");
}

function getVisibleMessageContent(content: string) {
  return content
    .replace(/\s*\[\[ORIA_MEDIA_ID:[^\]]+\]\]\s*$/g, "")
    .replace(
      /\s*\[\[ORIA_ARTIFACT_ID:[^\]]+\]\]\s*/g,
      "\n",
    )
    .replace(/\s*\[\[ORIA_WEB_IMAGES:[A-Za-z0-9+/=]+\]\]/g, "")
    .replace(/\s*\[\[ORIA_AUDIO_ID:[^\]]+\]\]/g, "")
    .trimEnd();
}

function extractMediaIdFromMessage(content: string) {
  return content.match(ORIA_MEDIA_MARKER_REGEX)?.[1] ?? null;
}

function extractArtifactIdsFromMessage(
  content: string,
) {
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

// ORIA: métadonnées de recherche Web persistées avec le message assistant.
// Format Base64 compatible avec le Chat Web (UTF-8), sans nouvelle dépendance.
const ORIA_WEB_IMAGES_MARKER_REGEX = /\[\[ORIA_WEB_IMAGES:([A-Za-z0-9+/=]+)\]\]/;
const ORIA_AUDIO_MARKER_REGEX = /\[\[ORIA_AUDIO_ID:([^\]]+)\]\]/;
const CODE_PREVIEW_EXTENSIONS = new Set([
  "py", "js", "jsx", "ts", "tsx", "html", "css", "json", "sql", "xml",
  "yaml", "yml", "toml", "md", "sh", "ps1", "java", "c", "cpp",
  "cs", "go", "rs", "php", "rb", "svg", "env",
]);
const VOICE_DRAFT_CACHE_PREFIX = "oria_voice_draft_v1_";

function encodeBase64Utf8(value: string): string {
  const bytes = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, code: string) =>
    String.fromCharCode(parseInt(code, 16)));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
    encoded += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    encoded += i + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return encoded;
}

function decodeBase64Utf8(value: string): string | null {
  try {
    if (value.length > 20000 || value.length % 4 !== 0) return null;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let escaped = "";
    for (let i = 0; i < value.length; i += 4) {
      const a = alphabet.indexOf(value[i]);
      const b = alphabet.indexOf(value[i + 1]);
      const c = value[i + 2] === "=" ? 0 : alphabet.indexOf(value[i + 2]);
      const d = value[i + 3] === "=" ? 0 : alphabet.indexOf(value[i + 3]);
      if ([a, b, c, d].some((n) => n < 0)) return null;
      const triple = (a << 18) | (b << 12) | (c << 6) | d;
      const bytes = [(triple >> 16) & 255];
      if (value[i + 2] !== "=") bytes.push((triple >> 8) & 255);
      if (value[i + 3] !== "=") bytes.push(triple & 255);
      escaped += bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");
    }
    return decodeURIComponent(escaped);
  } catch {
    return null;
  }
}

function normalizeWebImages(raw: unknown): WebIllustration[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 12).flatMap((value): WebIllustration[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const image_url = typeof item.image_url === "string" ? item.image_url.trim() : "";
    const source_url = typeof item.source_url === "string" ? item.source_url.trim() : "";
    if (!/^https:\/\/[^/]+\.[^/]+/i.test(image_url) ||
        !/^https:\/\/[^/]+\.[^/]+/i.test(source_url) || seen.has(image_url)) return [];
    seen.add(image_url);
    return [{ image_url, source_url,
      alt: String(item.alt || item.caption || "Illustration Web").slice(0, 300),
      caption: String(item.caption || "").slice(0, 500),
      after_paragraph: typeof item.after_paragraph === "number" && Number.isFinite(item.after_paragraph)
        ? Math.max(0, Math.min(200, Math.floor(item.after_paragraph))) : 0,
    }];
  }).slice(0, 3);
}

function buildWebImageMarker(images: WebIllustration[]) {
  return images.length ? `[[ORIA_WEB_IMAGES:${encodeBase64Utf8(JSON.stringify(images))}]]` : "";
}

function extractWebImages(content: string): WebIllustration[] {
  const marker = content.match(ORIA_WEB_IMAGES_MARKER_REGEX)?.[1];
  if (!marker) return [];
  const decoded = decodeBase64Utf8(marker);
  if (!decoded) return [];
  try { return normalizeWebImages(JSON.parse(decoded)); } catch { return []; }
}

function extractAudioIdFromMessage(content: string): string | null {
  return content.match(ORIA_AUDIO_MARKER_REGEX)?.[1]?.trim() || null;
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
  for (const note of incoming) {
    notes.set(note.audio_id, { ...notes.get(note.audio_id), ...note });
  }
  return [...notes.values()];
}

function prettyAudioDuration(ms?: number | null) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function readVoiceDraftId(userId: string): Promise<string | null> {
  const key = VOICE_DRAFT_CACHE_PREFIX + userId;
  return Platform.OS === "web"
    ? getWebStorage()?.getItem(key) || null
    : SecureStore.getItemAsync(key);
}

async function writeVoiceDraftId(userId: string, id: string | null) {
  const key = VOICE_DRAFT_CACHE_PREFIX + userId;
  if (Platform.OS === "web") {
    if (id) getWebStorage()?.setItem(key, id);
    else getWebStorage()?.removeItem(key);
  } else if (id) {
    await SecureStore.setItemAsync(key, id);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
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

  if (!id) return null;

  const filename =
    typeof raw.filename === "string" &&
    raw.filename.trim()
      ? raw.filename.trim()
      : `fichier-${id}`;

  const extension =
    typeof raw.extension === "string"
      ? raw.extension.replace(/^\./, "").toLowerCase()
      : filename.includes(".")
        ? filename.split(".").pop()?.toLowerCase() || ""
        : "";

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
    mimeType:
      typeof raw.mime_type === "string"
        ? raw.mime_type
        : typeof raw.mimeType === "string"
          ? raw.mimeType
          : "application/octet-stream",
    category:
      typeof raw.category === "string"
        ? raw.category
        : "file",
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
) {
  const map =
    new Map<string, GeneratedArtifact>();

  for (const artifact of current) {
    map.set(
      artifact.id,
      artifact,
    );
  }

  for (const artifact of incoming) {
    const previous =
      map.get(artifact.id);

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
) {
  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0
  ) {
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

  return `${(
    sizeBytes /
    (1024 * 1024)
  ).toFixed(1)} Mo`;
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

function normalizeMediaCapability(item: unknown): MediaCapability | null {
  // Le backend actuel renvoie des identifiants : "image_480", "video_lite"...
  // Une future version peut aussi renvoyer des objets enrichis.
  const raw = typeof item === "string" ? { action: item } : item;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  const config = getMediaGenerationConfig(action);
  // Ne jamais proposer une action inconnue de l'interface.
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
      Number.isFinite(record.estimated_credits) && record.estimated_credits >= 0
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

    // Le modèle d'essai reste visible même si /ai/trials a temporairement
    // échoué. Le backend reste l'autorité finale au moment de l'envoi.
    if (trialModel && (!trial || trial.max > 0)) {
      selectable.push(trialModel);
    }
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
  reasoningMode?: ReasoningMode;
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
      reasoningMode:
        parsed?.reasoningMode === "fast" ||
        parsed?.reasoningMode === "balanced" ||
        parsed?.reasoningMode === "deep"
          ? parsed.reasoningMode
          : "balanced",
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


type MathTextVariant = "body" | "h1" | "h2" | "h3" | "quote";

const INLINE_MARKDOWN_TOKEN_REGEX =
  /(\\\([^\n]*?\\\)|\$[^$\n]+\$|\b[A-Za-z](?:(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+)))+(?![A-Za-z0-9_])|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

const INLINE_MATH_TOKEN_REGEX =
  /(\\\([^\n]*?\\\)|\$[^$\n]+\$|\b[A-Za-z](?:(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+)))+(?![A-Za-z0-9_]))/;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLinkUrl(value: string) {
  const url = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) {
    return url;
  }

  return "#";
}

function buildInlineMathHtml(text: string): string {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = remaining.match(INLINE_MARKDOWN_TOKEN_REGEX);

    if (!match || match.index === undefined) {
      parts.push(escapeHtml(remaining));
      break;
    }

    if (match.index > 0) {
      parts.push(escapeHtml(remaining.slice(0, match.index)));
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        `<strong>${buildInlineMathHtml(token.slice(2, -2))}</strong>`,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      parts.push(`\\(${escapeHtml(token.slice(2, -2))}\\)`);
    } else if (token.startsWith("$") && token.endsWith("$")) {
      parts.push(`\\(${escapeHtml(token.slice(1, -1))}\\)`);
    } else if (
      /^[A-Za-z](?:(?:_(?:\{[^{}]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}]+\}|[A-Za-z0-9+\-=()]+)))+$/.test(
        token,
      )
    ) {
      parts.push(`\\(${escapeHtml(token)}\\)`);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

      if (linkMatch) {
        const [, label, url] = linkMatch;
        const safeUrl = safeLinkUrl(url);
        parts.push(
          `<a href="${escapeHtml(safeUrl)}">${buildInlineMathHtml(label)}</a>`,
        );
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(`<em>${buildInlineMathHtml(token.slice(1, -1))}</em>`);
    } else {
      parts.push(escapeHtml(token));
    }

    remaining = remaining.slice(match.index + token.length);
  }

  return parts.join("");
}

function mathTypography(variant: MathTextVariant) {
  switch (variant) {
    case "h1":
      return { fontSize: 25, lineHeight: 31, fontWeight: 700 };
    case "h2":
      return { fontSize: 21, lineHeight: 27, fontWeight: 700 };
    case "h3":
      return { fontSize: 17, lineHeight: 23, fontWeight: 700 };
    case "quote":
      return { fontSize: 14, lineHeight: 22, fontWeight: 400 };
    default:
      return { fontSize: 14, lineHeight: 22, fontWeight: 400 };
  }
}

function buildMathJaxDocument({
  content,
  isDark,
  variant,
  displayMode,
}: {
  content: string;
  isDark: boolean;
  variant: MathTextVariant;
  displayMode: boolean;
}) {
  const typography = mathTypography(variant);
  const textColor =
    variant === "quote"
      ? isDark
        ? "#b7b7be"
        : "#686863"
      : isDark
        ? "#f3f3f5"
        : "#1b1b19";
  const linkColor = isDark ? "#d9d9df" : "#2d2d2a";
  const codeBackground = isDark ? "#242429" : "#eeeeeb";
  const codeColor = isDark ? "#f2f2f4" : "#222222";
  const displayClass = displayMode ? "display" : "inline";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
  />
  <style>
    :root {
      color-scheme: ${isDark ? "dark" : "light"};
    }

    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: transparent;
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: ${typography.fontSize}px;
      line-height: ${typography.lineHeight}px;
      font-weight: ${typography.fontWeight};
      -webkit-text-size-adjust: 100%;
    }

    body {
      overflow-x: ${displayMode ? "auto" : "hidden"};
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
    }

    #content {
      box-sizing: border-box;
      color: ${textColor};
    }

    #content.inline {
      width: 100%;
      min-height: ${typography.lineHeight}px;
      overflow-wrap: anywhere;
      word-break: normal;
    }

    #content.display {
      width: max-content;
      min-width: 100%;
      padding: 10px 16px;
      text-align: center;
      white-space: nowrap;
    }

    strong {
      font-weight: 700;
    }

    em {
      font-style: italic;
    }

    code {
      padding: 1px 4px;
      border-radius: 5px;
      background: ${codeBackground};
      color: ${codeColor};
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
    }

    a {
      color: ${linkColor};
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    mjx-container {
      color: ${textColor} !important;
    }

    mjx-container:not([display="true"]) {
      display: inline-block !important;
      margin: 0 0.08em !important;
      vertical-align: -0.08em;
    }

    mjx-container[display="true"] {
      display: inline-block !important;
      margin: 0 !important;
      text-align: center !important;
    }

    mjx-container svg {
      color: ${textColor} !important;
      fill: currentColor !important;
    }
  </style>

  <script>
    function reportSize() {
      try {
        var content = document.getElementById("content");
        if (!content || !window.ReactNativeWebView) return;

        var rect = content.getBoundingClientRect();
        var width = Math.ceil(Math.max(rect.width, content.scrollWidth, 1));
        var height = Math.ceil(
          Math.max(
            rect.height,
            content.scrollHeight,
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            1
          )
        );

        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: "math-size",
            width: width,
            height: height
          })
        );
      } catch (error) {
        // La WebView garde simplement sa hauteur initiale si la mesure échoue.
      }
    }

    window.MathJax = {
      tex: {
        processEscapes: true
      },
      svg: {
        fontCache: "local"
      },
      startup: {
        pageReady: function () {
          return MathJax.startup.defaultPageReady().then(function () {
            requestAnimationFrame(function () {
              requestAnimationFrame(reportSize);
            });

            if (window.ResizeObserver) {
              var observer = new ResizeObserver(reportSize);
              observer.observe(document.getElementById("content"));
            }
          });
        }
      }
    };

    document.addEventListener("DOMContentLoaded", function () {
      requestAnimationFrame(reportSize);
    });
  </script>

  <script
    defer
    src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"
    onerror="window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'math-error'}))"
  ></script>
</head>
<body>
  <div id="content" class="${displayClass}">${content}</div>
</body>
</html>`;
}

function MathJaxWebView({
  html,
  displayMode,
  fallback,
}: {
  html: string;
  displayMode: boolean;
  fallback: string;
}) {
  const styles = useThemedStyles();
  const { width: windowWidth } = useWindowDimensions();
  const [height, setHeight] = useState(displayMode ? 72 : 24);
  const [failed, setFailed] = useState(false);

  const handleMessage = useCallback((event: any) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);

      if (payload?.type === "math-error") {
        setFailed(true);
        return;
      }

      if (payload?.type !== "math-size") return;

      const measuredHeight = Number(payload.height);
      if (!Number.isFinite(measuredHeight)) return;

      const maxHeight = displayMode ? 640 : 1200;
      const nextHeight = Math.min(
        Math.max(Math.ceil(measuredHeight) + 2, displayMode ? 54 : 22),
        maxHeight,
      );

      setHeight((current) =>
        Math.abs(current - nextHeight) >= 2 ? nextHeight : current,
      );
    } catch {
      // Message non reconnu : aucune action.
    }
  }, [displayMode]);

  const handleNavigation = useCallback((request: any) => {
    const url = String(request?.url ?? "");

    if (
      !url ||
      url === "about:blank" ||
      url.startsWith("data:") ||
      url.startsWith("https://cdn.jsdelivr.net/")
    ) {
      return true;
    }

    if (/^(https?:\/\/|mailto:)/i.test(url)) {
      Linking.openURL(url).catch(() => undefined);
    }

    return false;
  }, []);

  if (failed) {
    return (
      <Text style={styles.mathFallbackText}>
        {fallback}
      </Text>
    );
  }

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      style={[
        styles.mathWebView,
        {
          height,
          maxWidth: Math.max(windowWidth - 36, 220),
        },
      ]}
      containerStyle={styles.mathWebViewContainer}
      javaScriptEnabled
      scrollEnabled={displayMode}
      nestedScrollEnabled={displayMode}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      bounces={false}
      overScrollMode="never"
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={handleNavigation}
      onError={() => setFailed(true)}
    />
  );
}

function MathRichText({
  text,
  variant = "body",
}: {
  text: string;
  variant?: MathTextVariant;
}) {
  const isDark = useIsDarkTheme();

  const html = useMemo(
    () =>
      buildMathJaxDocument({
        content: buildInlineMathHtml(text),
        isDark,
        variant,
        displayMode: false,
      }),
    [isDark, text, variant],
  );

  return (
    <MathJaxWebView
      html={html}
      displayMode={false}
      fallback={text}
    />
  );
}

function MathExpression({ source }: { source: string }) {
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();

  const html = useMemo(
    () =>
      buildMathJaxDocument({
        content: `\\[${escapeHtml(source.trim())}\\]`,
        isDark,
        variant: "body",
        displayMode: true,
      }),
    [isDark, source],
  );

  return (
    <View style={styles.mathBlock}>
      <MathJaxWebView
        html={html}
        displayMode
        fallback={source}
      />
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
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();
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
        color={themedIconColor("#777771", isDark)}
      />
      <Text style={styles.messageCopyText}>
        {copied ? CHAT_TEXT[language].copied : CHAT_TEXT[language].copy}
      </Text>
    </Pressable>
  );
}

function CollapsibleUserMessage({
  content,
  language,
}: {
  content: string;
  language: OriaLanguage;
}) {
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();
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
    <View>
      <Text
        style={styles.userText}
        numberOfLines={
          collapsible && !expanded
            ? 7
            : undefined
        }
        ellipsizeMode="tail"
      >
        {content}
      </Text>

      {collapsible ? (
        <Pressable
          onPress={() =>
            setExpanded(
              (current) => !current,
            )
          }
          style={styles.userMessageExpandButton}
          accessibilityRole="button"
          accessibilityState={{
            expanded,
          }}
        >
          <Ionicons
            name={
              expanded
                ? "chevron-up"
                : "chevron-down"
            }
            size={14}
            color={themedIconColor("#ffffff", isDark)}
          />
          <Text
            style={
              styles.userMessageExpandText
            }
          >
            {expanded
              ? CHAT_TEXT[language]
                  .showLess
              : CHAT_TEXT[language]
                  .showMore}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InlineMarkdown({
  text,
  variant = "body",
}: {
  text: string;
  variant?: MathTextVariant;
}) {
  const styles = useThemedStyles();

  const hasMath = INLINE_MATH_TOKEN_REGEX.test(text);

  if (hasMath) {
    return <MathRichText text={text} variant={variant} />;
  }

  const textStyle =
    variant === "h1"
      ? styles.h1
      : variant === "h2"
        ? styles.h2
        : variant === "h3"
          ? styles.h3
          : variant === "quote"
            ? styles.quoteText
            : styles.messageText;

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let index = 0;

  while (remaining.length > 0) {
    const match = remaining.match(INLINE_MARKDOWN_TOKEN_REGEX);

    if (!match || match.index === undefined) {
      parts.push(
        <Text key={index} style={textStyle}>
          {remaining}
        </Text>,
      );
      break;
    }

    if (match.index > 0) {
      parts.push(
        <Text key={index} style={textStyle}>
          {remaining.slice(0, match.index)}
        </Text>,
      );
      index++;
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <Text key={index} style={[textStyle, styles.bold]}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <Text key={index} style={styles.inlineCode}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

      if (linkMatch) {
        const [, label, url] = linkMatch;
        parts.push(
          <Text
            key={index}
            style={[textStyle, styles.link]}
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
        <Text key={index} style={[textStyle, styles.italic]}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={index} style={textStyle}>
          {token}
        </Text>,
      );
    }

    remaining = remaining.slice(match.index + token.length);
    index++;
  }

  return <Text style={textStyle}>{parts}</Text>;
}

function MarkdownMessage({
  content,
  language: uiLanguage,
  onCodeOpen,
}: {
  content: string;
  language: OriaLanguage;
  onCodeOpen?: (code: string, language: string) => void;
}) {
  const styles = useThemedStyles();
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
      <InlineMarkdown
        key={`p-${index}`}
        text={paragraph.join(" ")}
      />,
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
            <View style={styles.listContent}>
              <InlineMarkdown text={item} />
            </View>
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
            <View style={styles.listContent}>
              <InlineMarkdown text={item} />
            </View>
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
      <CodeBlock key={`code-${index}`} language={codeLanguage} value={code.join("\n")}
        uiLanguage={uiLanguage} onExpand={onCodeOpen} />,
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
        <InlineMarkdown
          key={`h3-${index}`}
          text={trimmed.slice(4)}
          variant="h3"
        />,
      );
      index++;
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <InlineMarkdown
          key={`h2-${index}`}
          text={trimmed.slice(3)}
          variant="h2"
        />,
      );
      index++;
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushLists();
      flushParagraph();
      blocks.push(
        <InlineMarkdown
          key={`h1-${index}`}
          text={trimmed.slice(2)}
          variant="h1"
        />,
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
          <InlineMarkdown
            text={trimmed.slice(2)}
            variant="quote"
          />
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

  return <View style={styles.markdown}>{blocks}</View>;
}

function CodeBlock({
  language,
  value,
  uiLanguage,
  onExpand,
}: {
  language: string;
  value: string;
  uiLanguage: OriaLanguage;
  onExpand?: (code: string, language: string) => void;
}) {
  const styles = useThemedStyles();
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {onExpand ? (
            <Pressable onPress={() => onExpand(value, language)} style={styles.copyButton}
              accessibilityLabel={CHAT_TEXT[uiLanguage].codePreview}>
              <Ionicons name="expand-outline" size={16} color="#eeeeee" />
            </Pressable>
          ) : null}
          <Pressable onPress={copy} style={styles.copyButton}>
            <Text style={styles.copyText}>{copied ? CHAT_TEXT[uiLanguage].copied : CHAT_TEXT[uiLanguage].copy}</Text>
          </Pressable>
        </View>
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
  const styles = useThemedStyles();
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
  isTrial,
  disabled,
  onPress,
  language,
}: {
  model: ModelDefinition;
  active: boolean;
  trial?: TrialInfo;
  isTrial?: boolean;
  disabled: boolean;
  onPress: () => void;
  language: OriaLanguage;
}) {
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();

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
        {isTrial ? (
          <Text style={styles.trialBadge}>
            {CHAT_TEXT[language].trial}
            {trial ? ` · ${trial.remaining}/${trial.max}` : ""}
          </Text>
        ) : active ? (
          <Ionicons name="checkmark" size={17} color={themedIconColor("#111111", isDark)} />
        ) : null}
      </View>
      <Text style={styles.modelDescription}>{getModelDescription(model, language)}</Text>
      {isTrial ? (
        <Text style={styles.smallMuted}>
          {CHAT_TEXT[language].higherModelTrial}
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
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();

  return (
    <View style={styles.attachmentCard}>
      {attachment.kind === "image" ? (
        <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
      ) : (
        <View style={styles.fileIcon}>
          <Ionicons name="document-text-outline" size={22} color={themedIconColor("#666", isDark)} />
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
        <Ionicons name="close" size={16} color={themedIconColor("#666", isDark)} />
      </Pressable>
    </View>
  );
}

// === ORIA MOBILE : illustrations Web, lecteur de code, lecture vocale privée ===
function WebIllustratedMessage({
  content, images, language, onCodeOpen,
}: {
  content: string;
  images: WebIllustration[];
  language: OriaLanguage;
  onCodeOpen: (code: string, language: string) => void;
}) {
  if (!images.length) {
    return <MarkdownMessage content={content} language={language} onCodeOpen={onCodeOpen} />;
  }
  // Les paragraphes restent dans leur ordre, les illustrations se placent
  // selon after_paragraph. Le rendu Markdown original est préservé par bloc.
  const paragraphs = content.includes("```") ? [content] : content.split(/\n\s*\n/);
  const displayed = new Set<string>();
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].trim()) {
      nodes.push(<MarkdownMessage key={`web-text-${i}`} content={paragraphs[i]}
        language={language} onCodeOpen={onCodeOpen} />);
    }
    for (const image of images.filter((item) => item.after_paragraph === i)) {
      if (displayed.has(image.image_url)) continue;
      displayed.add(image.image_url);
      nodes.push(<View key={`web-img-${displayed.size}`} style={mobileExtras.webImageCard}>
        <Image source={{ uri: image.image_url }} style={mobileExtras.webImage} resizeMode="cover" />
        {image.caption ? <Text style={mobileExtras.webImageCaption}>{image.caption}</Text> : null}
        <Pressable onPress={() => void Linking.openURL(image.source_url).catch(() => undefined)}
          style={mobileExtras.webImageLink} accessibilityRole="link">
          <Ionicons name="link-outline" size={13} color="#666" />
          <Text style={mobileExtras.webImageLinkText}>{CHAT_TEXT[language].webImageSource}</Text>
        </Pressable>
      </View>);
    }
  }
  for (const image of images) {
    if (displayed.has(image.image_url)) continue;
    displayed.add(image.image_url);
    nodes.push(<View key={`web-img-${displayed.size}`} style={mobileExtras.webImageCard}>
      <Image source={{ uri: image.image_url }} style={mobileExtras.webImage} resizeMode="cover" />
      {image.caption ? <Text style={mobileExtras.webImageCaption}>{image.caption}</Text> : null}
      <Pressable onPress={() => void Linking.openURL(image.source_url).catch(() => undefined)}
        style={mobileExtras.webImageLink} accessibilityRole="link">
        <Ionicons name="link-outline" size={13} color="#666" />
        <Text style={mobileExtras.webImageLinkText}>{CHAT_TEXT[language].webImageSource}</Text>
      </Pressable>
    </View>);
  }
  return <View style={{ gap: 8 }}>{nodes}</View>;
}

function PrivateVoicePlayback({
  note, language, onLoad,
}: {
  note: VoiceNote;
  language: OriaLanguage;
  onLoad: (id: string) => Promise<string>;
}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function toggle() {
    if (status.playing) { player.pause(); return; }
    try {
      setLoading(true);
      if (!loaded || status.didJustFinish) {
        if (!loaded) {
          // Chaque lecture privée redemande un lien signé à durée limitée.
          const url = await onLoad(note.audio_id);
          player.replace({ uri: url });
          setLoaded(true);
        } else {
          await player.seekTo(0);
        }
      }
      player.play();
      setError(false);
    } catch {
      setError(true);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }
  const duration = status.duration > 0 ? Math.ceil(status.duration * 1000) : note.duration_ms;
  return (
    <View style={mobileExtras.voiceBubble}>
      <Pressable style={mobileExtras.voicePlay} onPress={() => void toggle()}
        disabled={loading} accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play"}>
        {loading ? <ActivityIndicator size="small" color="#ffffff" /> :
          <Ionicons name={status.playing ? "pause" : "play"} size={18} color="#ffffff" />}
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={mobileExtras.waveBars}>
          {Array.from({ length: 28 }, (_, i) => (
            <View key={i} style={[mobileExtras.waveBar, {
              height: 5 + ((i * 17 + 9) % 17), opacity: status.playing ? 1 : .65,
            }]} />
          ))}
        </View>
        <Text style={mobileExtras.voiceMeta}>
          {language === "fr" ? "Vocal" : "Voice"} · {prettyAudioDuration(duration)}
          {error ? (language === "fr" ? " · Lecture impossible" : " · Playback failed") : ""}
        </Text>
      </View>
    </View>
  );
}

function HighlightedCode({ code }: { code: string }) {
  // Coloration légère pure React Native, sans WebView distante ni paquet supplémentaire.
  const tokens = code.match(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(?:const|let|var|function|return|class|import|from|export|default|async|await|if|else|for|while|try|catch|def|self|True|False|None|public|private|interface|type|new|throw|switch|case|break|SELECT|INSERT|UPDATE|DELETE|CREATE|TABLE|WHERE|JOIN)\b|\b\d+(?:\.\d+)?\b|[\s\S])/g) || [];
  return <Text style={mobileExtras.codeText} selectable>{tokens.map((token, index) => {
    const color = /^(?:\/\*|\/\/|#)/.test(token) ? "#8a99a9" :
      /^["'`]/.test(token) ? "#a5e3c5" :
      /^\d/.test(token) ? "#f6ca88" :
      /^(?:[A-Za-z_]+)$/.test(token) && token.length > 1 ? "#99bffa" : "#e9e9ef";
    return <Text key={index} style={{ color }}>{token}</Text>;
  })}</Text>;
}

const mobileExtras = StyleSheet.create({
  webImageCard: { borderRadius: 14, overflow: "hidden", borderWidth: 1,
    borderColor: "#deded9", backgroundColor: "#f6f6f6", marginVertical: 6 },
  webImage: { width: "100%", height: 178, backgroundColor: "#ddd" },
  webImageCaption: { fontSize: 12, lineHeight: 17, color: "#555", paddingHorizontal: 11, paddingTop: 8 },
  webImageLink: { flexDirection: "row", gap: 5, alignItems: "center", padding: 11 },
  webImageLinkText: { fontSize: 12, fontWeight: "600", color: "#555" },
  voiceBubble: { minHeight: 64, maxWidth: 310, padding: 11, borderRadius: 18,
    backgroundColor: "#ecece9", flexDirection: "row", alignItems: "center", gap: 11 },
  voicePlay: { width: 39, height: 39, borderRadius: 20,
    backgroundColor: "#222222", alignItems: "center", justifyContent: "center" },
  voiceMeta: { color: "#777", fontSize: 11, marginTop: 5 },
  waveBars: { height: 25, flexDirection: "row", alignItems: "center", gap: 2 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: "#5e6664" },
  draftCard: { borderWidth: 1, borderColor: "#d7d7d2", backgroundColor: "#f7f7f5",
    borderRadius: 17, padding: 12, gap: 9, marginBottom: 10 },
  draftTitle: { fontSize: 13, color: "#252525", fontWeight: "700" },
  draftHint: { fontSize: 12, color: "#777", lineHeight: 18 },
  draftTextarea: { backgroundColor: "#fff", borderColor: "#deded9", borderWidth: 1,
    borderRadius: 11, padding: 10, color: "#222", minHeight: 65, maxHeight: 130,
    fontSize: 14, textAlignVertical: "top" },
  draftActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  draftAction: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#232323",
    borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  draftActionSecondary: { backgroundColor: "#e4e4e0" },
  draftActionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  draftActionTextSecondary: { color: "#333" },
  microphoneButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#ededeb",
    alignItems: "center", justifyContent: "center" },
  microphoneActive: { backgroundColor: "#c53a48" },
  codeModal: { flex: 1, backgroundColor: "#121318" },
  codeModalBar: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row",
    alignItems: "center", gap: 10, backgroundColor: "#202126" },
  codeModalTitle: { flex: 1, color: "#f5f5f5", fontWeight: "700", fontSize: 14 },
  codeModalButton: { padding: 7, borderRadius: 8, backgroundColor: "#34353a" },
  codeText: { fontSize: 12, lineHeight: 20, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
});

export default function ChatPage() {
  const router = useRouter();
  const navigation = useNavigation();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const [theme, setTheme] = useState<OriaTheme>("light");
  const isDark = theme === "dark";
  const styles = useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
  const t = CHAT_TEXT[language];

  // Le Chat est la racine authentifiée d'ORIA : un geste natif "retour"
  // ne doit jamais dépiler l'écran vers login / accueil. Les navigations
  // normales (Crédits, Paramètres, déconnexion via replace) restent autorisées.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      const actionType = event.data.action.type;

      if (
        actionType === "GO_BACK" ||
        actionType === "POP" ||
        actionType === "POP_TO_TOP"
      ) {
        event.preventDefault();
      }
    });

    return unsubscribe;
  }, [navigation]);

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
        }
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("luna");
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

  const [message, setMessage] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerInputHeight, setComposerInputHeight] = useState(112);
  const composerInputRef = useRef<TextInput>(null);
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
  const { top: safeAreaTop, bottom: safeAreaBottom } = useSafeAreaInsets();
  const drawerWidth = Math.min(324, Math.max(278, screenWidth * 0.79));
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
  const [generatedArtifacts, setGeneratedArtifacts] =
    useState<GeneratedArtifact[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [localVoiceDraft, setLocalVoiceDraft] = useState<LocalVoiceDraft | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [codePreview, setCodePreview] = useState<CodePreviewData | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const audioBusyRef = useRef(false);
  const stoppingRecordingRef = useRef(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [isLoadingMediaCapabilities, setIsLoadingMediaCapabilities] =
    useState(false);

  const availableModels = useMemo(
    () => getSelectableModels(wallet?.pack_id ?? null, trials),
    [wallet?.pack_id, trials],
  );

  const hasActivePack = wallet?.is_pack_active === true;

  // Comme sur le Web, le solde affiché représente uniquement les crédits
  // réellement utilisables. Un ancien solde peut rester dans la base, mais
  // un pack expiré/inactif doit apparaître à 0 dans l'interface mobile.
  const availableBalance = wallet?.is_pack_active ? wallet.balance : 0;

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
          setReasoningMode(
            cache.reasoningMode || "balanced",
          );
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
          loadPersistedArtifacts(),
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
        reasoningMode,
        activeCapability,
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [
    conversations,
    messages,
    activeConversationId,
    selectedModel,
    reasoningMode,
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
    if (!messages.length || composerExpanded) return;

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [messages.length, isThinking, composerExpanded]);

  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      if (
        !message.trim() &&
        attachments.length === 0 &&
        !activeCapability &&
        !modelMenuOpen &&
        !reasoningMenuOpen
      ) {
        setComposerExpanded(false);
        setComposerInputHeight(112);
      }
    });

    return () => subscription.remove();
  }, [
    message,
    attachments.length,
    activeCapability,
    modelMenuOpen,
    reasoningMenuOpen,
  ]);

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

  async function loadPersistedArtifacts() {
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

  // ORIA audio : les brouillons ne sont jamais mis dans le cache des messages.
  // Seul l'UUID est conservé, la transcription/audio reste dans Supabase privé.
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    void readVoiceDraftId(currentUserId).then(async (id) => {
      if (!id) return;
      try {
        const response = await apiFetch<Record<string, unknown>>(`/ai/audio/${encodeURIComponent(id)}`);
        const restored = normalizeVoiceNote(response);
        if (active && restored && restored.delivery_mode === "draft") {
          setVoiceDraft({ ...restored, localUri: null, editedText: restored.transcription || "", busy: false });
        } else if (active && (!restored || restored.delivery_mode !== "draft")) {
          await writeVoiceDraftId(currentUserId, null);
        }
      } catch (cause) {
        console.warn("Brouillon vocal non restauré", cause);
      }
    });
    return () => { active = false; };
  }, [currentUserId]);

  useEffect(() => {
    if (!voiceDraft?.audio_id || voiceDraft.busy ||
        !(["queued", "processing"].includes(voiceDraft.transcription_status) ||
          voiceDraft.billing_status === "settlement_pending")) return;
    let cancelled = false;
    const id = voiceDraft.audio_id;
    const poll = async () => {
      try {
        let response = await apiFetch<Record<string, unknown>>(`/ai/audio/${encodeURIComponent(id)}`);
        if (response.billing_status === "settlement_pending") {
          response = await apiFetch<Record<string, unknown>>(
            `/ai/audio/${encodeURIComponent(id)}/reconcile`, { method: "POST" });
        }
        const note = normalizeVoiceNote(response);
        if (!cancelled && note) {
          setVoiceDraft((current) => current?.audio_id === id ? {
            ...current, ...note,
            editedText: current.editedText || note.transcription || "",
          } : current);
        }
      } catch (cause) {
        console.warn("Statut vocal indisponible", cause);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [voiceDraft?.audio_id, voiceDraft?.transcription_status,
      voiceDraft?.billing_status, voiceDraft?.busy]);

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= 300000) {
      void stopVoiceRecording();
    }
  }, [recorderState.isRecording, recorderState.durationMillis]);

  async function startVoiceRecording() {
    if (isThinking || voiceDraft || localVoiceDraft || voiceUploading || audioBusyRef.current ||
        stoppingRecordingRef.current || recorderState.isRecording) return;
    // Le microphone reste utilisable sans pack ; seul l'envoi sera contrôlé.
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { setError(t.audioPermission); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setComposerExpanded(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.audioPermission);
    }
  }

  async function stopVoiceRecording() {
    if (!recorderState.isRecording || stoppingRecordingRef.current) return;
    stoppingRecordingRef.current = true;
    try {
      const duration_ms = recorderState.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error("Aucun enregistrement audio n'a été produit.");
      // Le fichier reste sur l'appareil : aucune requête serveur à cette étape.
      setLocalVoiceDraft({ uri: recorder.uri, duration_ms });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement audio impossible.");
    } finally {
      stoppingRecordingRef.current = false;
    }
  }

  async function submitLocalVoiceDraft() {
    if (!localVoiceDraft || isThinking || voiceUploading || audioBusyRef.current) return;
    if (!hasActivePack) {
      setError(t.voicePackRequiredToSend);
      return;
    }
    await uploadVoiceDraft(localVoiceDraft.uri);
  }

  async function uploadVoiceDraft(uri: string) {
    // Double contrôle : sans abonnement, aucun upload ni transcription payante.
    if (!hasActivePack) {
      setError(t.voicePackRequiredToSend);
      return;
    }
    if (audioBusyRef.current) return;
    audioBusyRef.current = true;
    setVoiceUploading(true);
    let conversationId = activeConversationId;
    try {
      // Le lien conversation est obligatoire pour que l'audio puisse être
      // rattaché au futur message sans mélange entre conversations.
      if (!conversationId) {
        const remote = await createConversationRemote("Nouvelle conversation");
        conversationId = remote.id;
        setConversations((current) => [remote, ...current]);
        setActiveConversationId(remote.id);
      }
      const filename = uri.split(/[\/?#]/).pop() || "oria-vocal.m4a";
      const extension = filename.split(".").pop()?.toLowerCase();
      if (!extension || !["m4a", "mp4", "webm", "ogg", "3gp", "wav", "mp3", "aac"].includes(extension)) {
        throw new Error("Ce format d'enregistrement n'est pas pris en charge.");
      }
      const form = new FormData();
      form.append("conversation_id", conversationId);
      const file = new ExpoFile(uri);
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("Le vocal dépasse la limite de 20 Mo.");
      }
      form.append("audio", file, filename);
      // expo/fetch sait envoyer un ExpoFile natif comme Blob multipart.
      // Il ne faut pas utiliser les objets {uri,type,name} classiques ici.
      const session = await getSessionOrThrow();
      const response = await expoFetch(`${API_URL}/ai/audio/prepare`, {
        method: "POST",
        headers: {
          "user-id": session.user.id,
          authorization: `Bearer ${session.access_token}`,
        },
        body: form,
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new Error(typeof payload?.detail === "string" ? payload.detail :
          "Envoi audio refusé par le serveur.");
      }
      const note = payload ? normalizeVoiceNote(payload) : null;
      if (!note) throw new Error("Le serveur n'a pas retourné d'identifiant audio.");
      // Expo Audio HIGH_QUALITY produit du m4a sur iOS/Android, webm sur Web.
      // Le MIME du Blob natif est défini par l'enregistreur Expo.
      if (currentUserId) await writeVoiceDraftId(currentUserId, note.audio_id);
      setVoiceDraft({ ...note, localUri: uri, editedText: note.transcription || "", busy: false });
      setLocalVoiceDraft(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Envoi audio impossible.");
    } finally {
      audioBusyRef.current = false;
      setVoiceUploading(false);
    }
  }

  async function loadPrivateVoiceUrl(audioId: string) {
    const result = await apiFetch<Record<string, unknown>>(`/ai/audio/${encodeURIComponent(audioId)}`);
    const url = result.playback_url;
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error("La lecture privée du vocal est indisponible.");
    }
    return url;
  }

  async function removeVoiceDraft() {
    const draft = voiceDraft;
    if (!draft || draft.busy) return;
    try {
      if (draft.audio_id) await apiFetch(`/ai/audio/${encodeURIComponent(draft.audio_id)}`, { method: "DELETE" });
      if (currentUserId) await writeVoiceDraftId(currentUserId, null);
      setVoiceDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suppression du brouillon impossible.");
    }
  }

  async function recoverVoiceDraft() {
    const draft = voiceDraft;
    if (!draft?.audio_id) return;
    try {
      const path = draft.billing_status === "release_pending" ? "reconcile-release" :
        draft.billing_status === "settlement_pending" ? "reconcile" : "retry";
      const result = await apiFetch<Record<string, unknown>>(
        `/ai/audio/${encodeURIComponent(draft.audio_id)}/${path}`, { method: "POST" });
      const note = normalizeVoiceNote(result);
      if (note) setVoiceDraft((current) => current ? { ...current, ...note } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reprise de la note vocale impossible.");
    }
  }

  async function deliverVoiceDraft(mode: "voice" | "text") {
    const draft = voiceDraft;
    if (!draft || draft.busy || isThinking || draft.transcription_status !== "complete" ||
        draft.billing_status !== "settled") return;
    if (!draft.conversation_id || draft.conversation_id !== activeConversationId) {
      setError(language === "fr" ? "Rouvrez la conversation de ce vocal avant de l'envoyer." :
        "Open the conversation for this voice note before sending.");
      return;
    }
    const edited = draft.editedText.trim() || draft.transcription?.trim() || "";
    if (!edited) { setError("La transcription ne contient aucun texte."); return; }
    try {
      setVoiceDraft((current) => current ? { ...current, busy: true } : current);
      await apiFetch(`/ai/audio/${encodeURIComponent(draft.audio_id)}/send`, {
        method: "POST", body: JSON.stringify({ mode, edited_text: mode === "text" ? edited : null }),
      });
      const note = { ...draft, delivery_mode: mode };
      if (mode === "voice") setVoiceNotes((current) => mergeVoiceNotes(current, [note]));
      const sent = await handleSendMessage({
        contentOverride: mode === "text" ? edited : (draft.transcription || edited),
        voice: mode === "voice" ? note : undefined,
      });
      if (sent !== true) throw new Error("Message non confirmé : le brouillon a été conservé.");
      if (currentUserId) await writeVoiceDraftId(currentUserId, null);
      setVoiceDraft(null);
    } catch (cause) {
      setVoiceDraft((current) => current ? { ...current, busy: false } : current);
      setError(cause instanceof Error ? cause.message : "Envoi vocal impossible.");
    }
  }

  function findVoiceForMessage(item: ChatMessage): VoiceNote | null {
    if (item.role !== "user") return null;
    const marker = extractAudioIdFromMessage(item.content || "");
    const found = voiceNotes.find((note) => note.message_id === item.id ||
      (marker && note.audio_id === marker));
    return found || (marker ? {
      audio_id: marker, billing_status: "settled", transcription_status: "complete", delivery_mode: "voice",
    } : null);
  }

  async function previewCodeArtifact(artifact: GeneratedArtifact) {
    try {
      const response = await apiFetch<{ artifact?: Record<string, unknown> }>(
        `/artifacts/${encodeURIComponent(artifact.id)}`);
      const refreshed = response.artifact ? normalizeGeneratedArtifact(response.artifact, artifact.messageId) : null;
      const url = refreshed?.downloadUrl || artifact.downloadUrl;
      if (!url) throw new Error("Lien de lecture introuvable.");
      const download = await fetch(url);
      if (!download.ok) throw new Error("Ce fichier ne peut pas être lu actuellement.");
      const size = Number(download.headers.get("content-length") || 0);
      if (size > 800000) throw new Error("Fichier trop volumineux pour la prévisualisation.");
      const code = await download.text();
      if (code.length > 800000) throw new Error("Prévisualisation limitée à 800 Ko.");
      setCodePreview({ title: artifact.filename, language: artifact.extension,
        code, downloadUrl: url });
      if (refreshed) setGeneratedArtifacts((current) => mergeGeneratedArtifacts(current, [refreshed]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lecture du code indisponible.");
    }
  }

  function findArtifactsForMessage(
    item: ChatMessage,
  ) {
    if (item.role !== "assistant") {
      return [] as GeneratedArtifact[];
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

    return generatedArtifacts.filter(
      (artifact) =>
        artifact.messageId === item.id,
    );
  }

  async function openArtifact(
    artifact: GeneratedArtifact,
  ) {
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

      if (refreshed) {
        setGeneratedArtifacts(
          (current) =>
            mergeGeneratedArtifacts(
              current,
              [refreshed],
            ),
        );
      }

      const supported =
        await Linking.canOpenURL(
          downloadUrl,
        );

      if (!supported) {
        throw new Error(
          language === "en"
            ? "This file cannot be opened on this device."
            : "Ce fichier ne peut pas être ouvert sur cet appareil.",
        );
      }

      await Linking.openURL(
        downloadUrl,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : language === "en"
            ? "Unable to open the generated file."
            : "Impossible d'ouvrir le fichier généré.",
      );
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
    setIsLoadingMediaCapabilities(true);
    // Aucune option locale ne doit rester sélectionnée pendant le chargement.
    setMediaCapabilities([]);
    setSelectedMediaAction("");

    try {
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

      // La réponse serveur prévaut, y compris lorsque "media" est vide.
      // Le pack doit être actif à la fois dans le wallet et sur le serveur.
      const packIsActive =
        data.success === true &&
        data.pack_active === true &&
        wallet?.is_pack_active === true &&
        data.pack_id === wallet.pack_id;

      const available = packIsActive ? normalized : [];

      setMediaCapabilities(available);
      setSelectedMediaAction((current) =>
        current && available.some((item) => item.action === current)
          ? current
          : available[0]?.action ?? "",
      );
    } catch (requestError) {
      console.warn("Capacités média indisponibles :", requestError);

      // Fallback uniquement si la requête a échoué : jamais après une
      // réponse valide indiquant 0 capacité ou un pack inactif.
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
    setComposerInputHeight(112);
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
      const data = await apiFetch<{
        messages: ChatMessage[];
        artifacts?: Array<Record<string, unknown>>;
        voice_notes?: Array<Record<string, unknown>>;
      }>(
        `/conversations/${conversationId}/messages`,
      );

      const remote = data.messages || [];
      const remoteVoiceNotes = (data.voice_notes ?? []).map(normalizeVoiceNote)
        .filter((note): note is VoiceNote => note !== null);
      setVoiceNotes((current) => mergeVoiceNotes(current, remoteVoiceNotes));

      const remoteArtifacts =
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
        (current) =>
          mergeGeneratedArtifacts(
            current,
            remoteArtifacts,
          ),
      );

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

  function getLargeInsertedText(
    previousValue: string,
    nextValue: string,
  ) {
    if (
      nextValue.length <=
      previousValue.length
    ) {
      return null;
    }

    let prefixLength = 0;

    while (
      prefixLength <
        previousValue.length &&
      prefixLength <
        nextValue.length &&
      previousValue[prefixLength] ===
        nextValue[prefixLength]
    ) {
      prefixLength++;
    }

    let suffixLength = 0;

    while (
      suffixLength <
        previousValue.length -
          prefixLength &&
      suffixLength <
        nextValue.length -
          prefixLength &&
      previousValue[
        previousValue.length -
          1 -
          suffixLength
      ] ===
        nextValue[
          nextValue.length -
            1 -
            suffixLength
        ]
    ) {
      suffixLength++;
    }

    const insertedEnd =
      nextValue.length -
      suffixLength;

    const insertedText =
      nextValue.slice(
        prefixLength,
        insertedEnd,
      );

    if (
      insertedText.length <
      LONG_PASTE_THRESHOLD
    ) {
      return null;
    }

    return {
      insertedText,
      remainingText:
        nextValue.slice(
          0,
          prefixLength,
        ) +
        nextValue.slice(
          insertedEnd,
        ),
    };
  }

  async function createPastedTextAttachment(
    pastedText: string,
  ) {
    if (
      attachments.length >=
      MAX_ATTACHMENTS
    ) {
      setError(
        interpolate(
          t.maxAttachments,
          {
            max: MAX_ATTACHMENTS,
          },
        ),
      );
      return false;
    }

    try {
      const filename =
        `texte-colle-${Date.now()}.txt`;

      const file =
        new ExpoFile(
          Paths.cache,
          filename,
        );

      file.create();

      await file.write(
        pastedText,
      );

      const attachment: ChatAttachment = {
        id: uid(),
        uri: file.uri,
        name: filename,
        mimeType: "text/plain",
        kind: "file",
        size: file.size || pastedText.length,
      };

      setAttachments(
        (current) => [
          ...current,
          attachment,
        ].slice(
          0,
          MAX_ATTACHMENTS,
        ),
      );

      setComposerExpanded(true);

      return true;
    } catch (pasteError) {
      console.error(
        "Erreur conversion collage en fichier :",
        pasteError,
      );

      setError(
        t.longPasteFailed,
      );

      return false;
    }
  }

  async function handleComposerTextChange(
    nextValue: string,
  ) {
    const largeInsert =
      getLargeInsertedText(
        message,
        nextValue,
      );

    if (!largeInsert) {
      setMessage(
        nextValue,
      );
      return;
    }

    const created =
      await createPastedTextAttachment(
        largeInsert.insertedText,
      );

    if (created) {
      setMessage(
        largeInsert.remainingText,
      );
      setError(
        t.longPasteConverted,
      );
    } else {
      // Ne jamais perdre le contenu si la conversion locale échoue.
      setMessage(
        nextValue,
      );
    }
  }

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
      }>(
        "/ai/chat/control",
        {
          method: "POST",
          body: JSON.stringify({
            generation_id:
              activeGenerationId,
            reasoning_mode: mode,
          }),
        },
      );
    } catch (requestError) {
      console.error(
        "Modification du raisonnement impossible :",
        requestError,
      );

      // Le mode choisi reste mémorisé pour le prochain message,
      // même si la génération actuelle n'est plus pilotable.
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
    }>(
      "/ai/chat/control",
      {
        method: "POST",
        body: JSON.stringify({
          generation_id: generationId,
          instruction,
        }),
      },
    );
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
       * Le bouton « Modifier » est disponible dès l'envoi.
       * Si le backend n'a pas encore émis l'événement SSE "start",
       * l'instruction est mise en attente côté client puis transmise
       * dès que la génération devient pilotable.
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
          t.modificationLiveUnavailable,
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
          : t.modificationLiveUnavailable,
      );
    } finally {
      setIsApplyingModification(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }

  async function handleGenerateMedia(promptOverride?: string) {
    if (!hasActivePack || isLoadingMediaCapabilities) {
      setError(t.activePackRequired);
      return;
    }
    const prompt = (promptOverride ?? mediaPrompt).trim();

    if (!prompt || isThinking) return;

    if (!selectedMediaAction) {
      setError(t.noCreationOption);
      return;
    }

    // Ne pas contourner les autorisations réellement chargées depuis l'API.
    const capability = mediaCapabilities.find(
      (item) => item.action === selectedMediaAction,
    );

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

  async function handleSendMessage(options?: { contentOverride?: string; voice?: VoiceNote }): Promise<boolean | undefined> {
    const content = (options?.contentOverride ?? message).trim();
    // L'envoi d'un vocal/transcrit ne consomme pas les pièces jointes ou le
    // brouillon texte que l'utilisateur a éventuellement déjà préparés.
    const outgoingAttachments = options?.contentOverride !== undefined ? [] : attachments;

    // Garde-fou : si un très long texte a contourné la détection de collage
    // (autofill, clavier tiers, etc.), il devient un fichier avant envoi.
    if (
      options?.contentOverride === undefined &&
      content.length >= LONG_PASTE_THRESHOLD
    ) {
      const created =
        await createPastedTextAttachment(
          content,
        );

      if (created) {
        setMessage("");
        setError(
          t.longPasteConverted,
        );
      }

      return;
    }

    const selectedTrial = trials[selectedModel];

    if (selectedTrial && selectedTrial.remaining <= 0) {
      setError(t.freeTrialsExhausted);
      return;
    }

    if (
      (!content && outgoingAttachments.length === 0) ||
      isThinking || recorderState.isRecording || voiceUploading
    ) {
      return;
    }

    if (activeCapability === "Création" && options?.contentOverride === undefined) {
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
      outgoingAttachments.length > 0
        ? `\n\n[${t.attachmentsSummary} : ${outgoingAttachments
            .map((attachment) => attachment.name)
            .join(", ")}]`
        : "";

    /*
     * Identifiant stable créé AVANT l'appel réseau :
     * le message utilisateur peut donc afficher « Modifier »
     * immédiatement, même avant le premier token d'Oria.
     */
    const generationId = uid();
    const userMessageId = uid();

    const userMessage: ChatMessage = {
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

    setMessages((current) => [
      ...current,
      userMessage,
    ]);
    if (options?.contentOverride === undefined) setMessage("");
    setComposerExpanded(false);
    setComposerInputHeight(112);
    setIsThinking(true);
    setError(null);

    try {
      // Ne pas bloquer le premier token sur l'écriture Supabase.
      // Le message est déjà visible localement et se synchronise en parallèle.
      const userMessageSavePromise =
        saveMessageRemote(
          userMessage,
        ).then(async (savedMessage) => {
          if (options?.voice && savedMessage?.id) {
            try {
              await apiFetch(`/ai/audio/${encodeURIComponent(options.voice.audio_id)}/attach-message`, {
                method: "POST", body: JSON.stringify({ message_id: savedMessage.id }),
              });
              setVoiceNotes((current) => mergeVoiceNotes(current, [
                { ...options.voice!, message_id: savedMessage.id },
              ]));
            } catch (cause) {
              console.warn("Association du vocal différée", cause);
            }
          }
          return savedMessage;
        }).catch(
          (saveError) => {
            console.error(
              "Erreur sauvegarde message utilisateur :",
              saveError,
            );
            return null;
          },
        );

      const formData = new FormData();

      formData.append("model", selectedModel);
      formData.append("message", content);
      formData.append("web", String(webEnabled));
      formData.append("conversation_id", conversationId);
      formData.append("reasoning_mode", reasoningMode);
      formData.append("generation_id", generationId);

      for (const attachment of outgoingAttachments) {
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
      let streamedArtifacts: GeneratedArtifact[] = [];
      let streamedWebImages: WebIllustration[] = [];

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

            if (eventName === "start") {
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
               * Une modification peut avoir été saisie avant que le backend
               * n'ait fini de préparer la génération. Elle est envoyée ici
               * dès que le stream annonce que la génération est active.
               */
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
                    t.modificationLiveUnavailable,
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
                        : t.modificationLiveUnavailable,
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

              setMessages(
                (current) =>
                  current.map((item) =>
                    item.id === assistantId
                      ? {
                          ...item,
                          content: "",
                        }
                      : item,
                  ),
              );

              continue;
            }

            if (eventName === "web_images") {
              streamedWebImages = normalizeWebImages(eventData.images);
              continue;
            }
            if (eventName === "artifact") {
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
              if (Array.isArray(eventData.web_images)) {
                streamedWebImages = normalizeWebImages(eventData.web_images);
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

              done = true;
              break;
            }
          }
        }
      } else {
        // Fallback pour les runtimes React Native qui ne donnent pas
        // accès à ReadableStream.getReader(). On parse tout de même le
        // corps SSE complet au lieu d'afficher "event: delta" brut.
        const rawSse =
          await streamResponse.text();

        const rawEvents =
          rawSse.split("\n\n");

        for (const rawEvent of rawEvents) {
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
                line
                  .slice(6)
                  .trim();
            }

            if (
              line.startsWith(
                "data:",
              )
            ) {
              dataText +=
                line
                  .slice(5)
                  .trim();
            }
          }

          if (!dataText) {
            continue;
          }

          let eventData:
            Record<string, unknown>;

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
            "generation_restarted"
          ) {
            assistantContent = "";
            streamedWebImages = [];
            continue;
          }

          if (eventName === "delta") {
            const delta =
              typeof eventData.content ===
              "string"
                ? eventData.content
                : "";

            assistantContent +=
              delta;
          }

          if (eventName === "artifact") {
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
            }
          }

          if (eventName === "done" && Array.isArray(eventData.web_images)) {
            streamedWebImages = normalizeWebImages(eventData.web_images);
          }
          if (
            eventName === "done" &&
            Array.isArray(
              eventData.artifacts,
            )
          ) {
            const doneArtifacts =
              eventData.artifacts
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
                );

            streamedArtifacts =
              mergeGeneratedArtifacts(
                streamedArtifacts,
                doneArtifacts,
              );
          }
        }

        if (
          streamedArtifacts.length > 0
        ) {
          setGeneratedArtifacts(
            (current) =>
              mergeGeneratedArtifacts(
                current,
                streamedArtifacts,
              ),
          );
        }
      }

      if (!assistantContent.trim()) {
        throw new Error(
          t.noAiContent,
        );
      }

      const artifactMarkers =
        buildArtifactMessageMarkers(
          streamedArtifacts,
        );

      const webImageMarker = buildWebImageMarker(streamedWebImages);
      const persistedAssistantContent = [assistantContent, artifactMarkers, webImageMarker]
        .filter(Boolean).join("\n\n");

      const assistantMessage: ChatMessage = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content:
          persistedAssistantContent,
        createdAt: assistantCreatedAt,
      };

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? assistantMessage
            : item,
        ),
      );

      // La sauvegarde utilisateur n'est attendue qu'après le streaming :
      // elle n'ajoute donc plus de latence avant le premier mot.
      await userMessageSavePromise;

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

      if (options?.contentOverride === undefined) setAttachments([]);

      const refreshedTrials = await loadTrials();
      await loadWallet(refreshedTrials);
      return true;
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
      return false;
    } finally {
      setIsThinking(false);
      setActiveGenerationId(null);
      setCanModifyActiveGeneration(false);
      setActiveGenerationStarted(false);
      setActiveRequestMessageId(null);
      setModificationPanelOpen(false);
      setModificationDraft("");
      setModificationStatus(null);
      pendingModificationRef.current =
        null;
    }
  }

  function selectCapability(label: string) {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);

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
      setMediaCapabilities([]);
      setSelectedMediaAction("");
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
    const voice = findVoiceForMessage(item);
    const webImages = item.role === "assistant" ? extractWebImages(item.content || "") : [];
    const media = findMediaForMessage(item);
    const artifactsForMessage =
      findArtifactsForMessage(item);
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
          style={
            item.role === "user"
              ? [styles.messageBubble, styles.userBubble]
              : styles.assistantMessageContent
          }
        >
          {item.role === "assistant" ? (
            <WebIllustratedMessage
              content={getVisibleMessageContent(item.content)}
              images={webImages}
              language={language}
              onCodeOpen={(code, codeLanguage) => setCodePreview({
                title: codeLanguage ? `${codeLanguage.toUpperCase()} · Code` : "Code ORIA",
                language: codeLanguage, code,
              })}
            />
          ) : voice ? (
            <PrivateVoicePlayback key={voice.audio_id} note={voice} language={language}
              onLoad={loadPrivateVoiceUrl} />
          ) : (
            <CollapsibleUserMessage
              content={getVisibleMessageContent(item.content)}
              language={language}
            />
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

          {item.role === "user" &&
          isThinking &&
          item.id === activeRequestMessageId ? (
            <Pressable
              onPress={() => {
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
              style={styles.modifyMessageButton}
              accessibilityRole="button"
              accessibilityLabel={t.modify}
            >
              <Ionicons
                name="create-outline"
                size={13}
                color={themedIconColor(
                  "#777771",
                  isDark,
                )}
              />
              <Text
                style={
                  styles.modifyMessageButtonText
                }
              >
                {t.modify}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {item.role === "user" &&
        isThinking &&
        item.id === activeRequestMessageId &&
        modificationPanelOpen ? (
          <View style={styles.modificationCard}>
            <Text
              style={
                styles.modificationTitle
              }
            >
              {t.modifyCurrentResponse}
            </Text>

            <Text
              style={
                styles.modificationHelp
              }
            >
              {t.modifyHelp}
            </Text>

            <TextInput
              autoFocus
              multiline
              value={modificationDraft}
              onChangeText={
                setModificationDraft
              }
              placeholder={
                t.modifyPlaceholder
              }
              placeholderTextColor={
                themedIconColor(
                  "#92928c",
                  isDark,
                )
              }
              editable={
                !isApplyingModification
              }
              style={
                styles.modificationInput
              }
              returnKeyType="default"
              textAlignVertical="top"
            />

            <Text
              style={
                styles.modificationHint
              }
            >
              {!activeGenerationStarted
                ? t.modificationWaitingStart
                : canModifyActiveGeneration
                  ? t.modificationCurrentGeneration
                  : t.modificationLiveUnavailable}
            </Text>

            <View
              style={
                styles.modificationActions
              }
            >
              <Pressable
                onPress={() => {
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
                style={
                  styles.modificationCancelButton
                }
              >
                <Text
                  style={
                    styles.modificationCancelText
                  }
                >
                  {t.cancel}
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  void handleApplyActiveRequestModification()
                }
                disabled={
                  !modificationDraft.trim() ||
                  isApplyingModification ||
                  (activeGenerationStarted &&
                    !canModifyActiveGeneration)
                }
                style={({ pressed }) => [
                  styles.modificationApplyButton,
                  (
                    !modificationDraft.trim() ||
                    isApplyingModification ||
                    (activeGenerationStarted &&
                      !canModifyActiveGeneration)
                  ) &&
                    styles.modificationApplyButtonDisabled,
                  pressed &&
                    styles.modificationApplyButtonPressed,
                ]}
              >
                {isApplyingModification ? (
                  <ActivityIndicator
                    size="small"
                    color="#ffffff"
                  />
                ) : null}

                <Text
                  style={
                    styles.modificationApplyText
                  }
                >
                  {isApplyingModification
                    ? t.applying
                    : t.apply}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {item.role === "user" &&
        isThinking &&
        item.id === activeRequestMessageId &&
        modificationStatus ? (
          <Text
            style={
              styles.modificationStatus
            }
          >
            {modificationStatus ===
            "queued"
              ? t.modificationQueued
              : t.modificationApplied}
          </Text>
        ) : null}

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

        {artifactsForMessage.length > 0 ? (
          <View style={styles.artifactList}>
            {artifactsForMessage.map(
              (artifact) => (
                <View
                  key={artifact.id}
                  style={styles.artifactCard}
                >
                  <View style={styles.artifactIcon}>
                    <Ionicons
                      name="document-text-outline"
                      size={20}
                      color={themedIconColor(
                        "#555555",
                        isDark,
                      )}
                    />
                  </View>

                  <View style={styles.artifactInfo}>
                    <Text
                      numberOfLines={1}
                      style={styles.artifactName}
                    >
                      {artifact.filename}
                    </Text>

                    <Text style={styles.artifactMeta}>
                      {(artifact.extension ||
                        artifact.category).toUpperCase()}
                      {" · "}
                      {formatArtifactSize(
                        artifact.sizeBytes,
                        language,
                      )}
                    </Text>
                  </View>

                  {CODE_PREVIEW_EXTENSIONS.has(artifact.extension.toLowerCase()) ? (
                    <Pressable onPress={() => void previewCodeArtifact(artifact)}
                      style={styles.artifactDownloadButton}
                      accessibilityRole="button" accessibilityLabel={t.codePreview}>
                      <Ionicons name="code-slash-outline" size={17}
                        color={themedIconColor("#111111", isDark)} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      void openArtifact(
                        artifact,
                      )
                    }
                    style={styles.artifactDownloadButton}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.download} ${artifact.filename}`}
                  >
                    <Ionicons
                      name="download-outline"
                      size={16}
                      color={themedIconColor(
                        "#111111",
                        isDark,
                      )}
                    />
                  </Pressable>
                </View>
              ),
            )}
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
    <OriaThemeContext.Provider value={theme}>
      <Modal
        visible={Boolean(codePreview)}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent={Platform.OS === "android"}
        navigationBarTranslucent={Platform.OS === "android"}
        onRequestClose={() => setCodePreview(null)}
      >
        {/* Une Modal ouvre une fenêtre native distincte. Son propre Provider
            mesure les vraies zones système sur iOS ET Android (encoche,
            barre d'état et navigation), sans marge fixe ni double padding. */}
        <SafeAreaProvider style={mobileExtras.codeModal}>
          <StatusBar barStyle="light-content" backgroundColor="#121318" />
          <SafeAreaView
            style={mobileExtras.codeModal}
            edges={["top", "bottom", "left", "right"]}
          >
            <View style={mobileExtras.codeModalBar}>
              <Pressable onPress={() => setCodePreview(null)} style={mobileExtras.codeModalButton}>
                <Ionicons name="close" size={21} color="#fff" />
              </Pressable>
              <Text style={mobileExtras.codeModalTitle} numberOfLines={1}>
                {codePreview?.title || t.codeViewer}
              </Text>
              <Pressable style={mobileExtras.codeModalButton} onPress={() =>
                void Clipboard.setStringAsync(codePreview?.code || "")}
                accessibilityLabel={t.copy}>
                <Ionicons name="copy-outline" size={19} color="#fff" />
              </Pressable>
              {codePreview?.downloadUrl ? (
                <Pressable style={mobileExtras.codeModalButton}
                  onPress={() => {
                    const url = codePreview?.downloadUrl;
                    if (url) void Linking.openURL(url).catch(() => undefined);
                  }}
                  accessibilityLabel={t.download}>
                  <Ionicons name="download-outline" size={19} color="#fff" />
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
              <ScrollView horizontal contentContainerStyle={{ padding: 17 }} nestedScrollEnabled>
                <HighlightedCode code={codePreview?.code || ""} />
              </ScrollView>
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      <SafeAreaView
        style={styles.safe}
        edges={["top", "left", "right"]}
      >
        <StatusBar
          barStyle={isDark ? "light-content" : "dark-content"}
        />
        <Stack.Screen options={{ gestureEnabled: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container} {...edgePanResponder.panHandlers}>
          <View style={styles.header}>
            <Pressable
              style={styles.headerButton}
              onPress={openDrawer}
            >
              <Ionicons name="menu" size={22} color={themedIconColor("#111111", isDark)} />
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
                  color={themedIconColor("#555555", isDark)}
                />
                <Text style={styles.creditText}>
                  {isLoadingWallet
                    ? "..."
                    : wallet
                      ? formatCredits(availableBalance)
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
                <Ionicons name="close" size={17} color={themedIconColor("#555555", isDark)} />
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
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={
                composerExpanded
                  ? "none"
                  : Platform.OS === "ios"
                    ? "interactive"
                    : "on-drag"
              }
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
              {
                paddingBottom: Math.max(
                  safeAreaBottom,
                  Platform.OS === "ios" ? 8 : 10,
                ),
              },
            ]}
          >
            {recorderState.isRecording ? (
              <View style={mobileExtras.draftCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                  <Ionicons name="radio-button-on" size={18} color="#c53a48" />
                  <Text style={mobileExtras.draftTitle}>
                    {t.vocal} · {prettyAudioDuration(recorderState.durationMillis)} / 5:00
                  </Text>
                </View>
                <Text style={mobileExtras.draftHint}>
                  {language === "fr" ? "Enregistrement en cours. Appuyez sur le bouton rouge pour terminer."
                    : "Recording. Tap the red button to finish."}
                </Text>
              </View>
            ) : null}
            {voiceUploading ? (
              <View style={[mobileExtras.draftCard, { flexDirection: "row", alignItems: "center" }]}>
                <ActivityIndicator size="small" color="#333" />
                <Text style={mobileExtras.draftHint}>{t.voiceUploading}</Text>
              </View>
            ) : null}
            {localVoiceDraft && !recorderState.isRecording && !voiceUploading ? (
              <View style={mobileExtras.draftCard}>
                <Text style={mobileExtras.draftTitle}>
                  {t.vocal} · {prettyAudioDuration(localVoiceDraft.duration_ms)}
                </Text>
                <PrivateVoicePlayback key={`local-draft-${localVoiceDraft.uri}`}
                  note={{
                    audio_id: "local-preview",
                    duration_ms: localVoiceDraft.duration_ms,
                    transcription_status: "local",
                    billing_status: "none",
                    delivery_mode: "draft",
                  }}
                  language={language}
                  onLoad={async () => localVoiceDraft.uri} />
                <Text style={mobileExtras.draftHint}>{t.voiceLocalReady}</Text>
                <View style={mobileExtras.draftActions}>
                  <Pressable style={mobileExtras.draftAction}
                    disabled={isThinking || voiceUploading}
                    onPress={() => void submitLocalVoiceDraft()}>
                    <Ionicons name="arrow-up" size={16} color="#fff" />
                    <Text style={mobileExtras.draftActionText}>{t.voicePrepareSend}</Text>
                  </Pressable>
                  <Pressable style={[mobileExtras.draftAction, mobileExtras.draftActionSecondary]}
                    onPress={() => { setLocalVoiceDraft(null); setError(null); }}>
                    <Text style={mobileExtras.draftActionTextSecondary}>{t.voiceDiscard}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {voiceDraft && !recorderState.isRecording ? (
              <View style={mobileExtras.draftCard}>
                <Text style={mobileExtras.draftTitle}>
                  {t.vocal} · {prettyAudioDuration(voiceDraft.duration_ms)}
                </Text>
                <PrivateVoicePlayback key={`draft-${voiceDraft.audio_id}`}
                  note={voiceDraft} language={language}
                  onLoad={async (id) => {
                    if (voiceDraft.localUri) return voiceDraft.localUri;
                    return loadPrivateVoiceUrl(id);
                  }} />
                {voiceDraft.transcription_status === "complete" &&
                 voiceDraft.billing_status === "settled" ? (
                  <>
                    <Text style={mobileExtras.draftHint}>{t.voiceEditHint}</Text>
                    <TextInput style={mobileExtras.draftTextarea} multiline
                      value={voiceDraft.editedText}
                      onChangeText={(text) => setVoiceDraft((current) =>
                        current ? { ...current, editedText: text } : current)}
                      editable={!voiceDraft.busy} />
                    <View style={mobileExtras.draftActions}>
                      <Pressable style={mobileExtras.draftAction} disabled={voiceDraft.busy || isThinking}
                        onPress={() => void deliverVoiceDraft("voice")}>
                        <Ionicons name="mic-outline" size={16} color="#fff" />
                        <Text style={mobileExtras.draftActionText}>{t.sendAsVoice}</Text>
                      </Pressable>
                      <Pressable style={mobileExtras.draftAction} disabled={voiceDraft.busy || isThinking}
                        onPress={() => void deliverVoiceDraft("text")}>
                        <Ionicons name="chatbubble-outline" size={16} color="#fff" />
                        <Text style={mobileExtras.draftActionText}>{t.sendAsText}</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={mobileExtras.draftHint}>
                      {["queued", "processing"].includes(voiceDraft.transcription_status) ?
                        t.transcriptionWaiting : voiceDraft.billing_status === "settlement_pending" ?
                          (language === "fr" ? "Finalisation des crédits..." : "Finalizing credits...") :
                          t.transcriptionFailed}
                    </Text>
                    {voiceDraft.transcription_status === "failed" ||
                      voiceDraft.billing_status === "settlement_pending" ? (
                      <Pressable style={[mobileExtras.draftAction, mobileExtras.draftActionSecondary]}
                        onPress={() => void recoverVoiceDraft()}>
                        <Text style={mobileExtras.draftActionTextSecondary}>{t.voiceRetry}</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
                {!voiceDraft.busy &&
                 voiceDraft.transcription_status !== "processing" &&
                 !["reserved", "settlement_pending", "release_pending"].includes(voiceDraft.billing_status) ? (
                  <Pressable onPress={() => void removeVoiceDraft()} style={{ alignSelf: "flex-start", padding: 4 }}>
                    <Text style={mobileExtras.draftHint}>{t.voiceDiscard}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.modelSelectorWrap}>
              {modelMenuOpen ? (
                <View style={styles.modelMenu}>
                  {availableModels.length === 0 ? (
                    <Text style={styles.emptyMenuText}>
                      {t.noModel}
                    </Text>
                  ) : (
                    availableModels.map((model) => {
                      const configuredTrialModelId = wallet?.pack_id
                        ? TRIAL_MODEL_BY_PACK[wallet.pack_id]
                        : undefined;
                      const isTrialModel =
                        configuredTrialModelId === model.id;
                      const trialInfo = trials[model.id];

                      return (
                        <ModelOption
                          key={model.id}
                          model={model}
                          active={selectedModel === model.id}
                          trial={trialInfo}
                          isTrial={isTrialModel}
                          disabled={
                            Boolean(isTrialModel && trialInfo) &&
                            trialInfo!.remaining <= 0
                          }
                          language={language}
                          onPress={() => {
                            if (
                              isTrialModel &&
                              trialInfo &&
                              trialInfo.remaining <= 0
                            ) {
                              return;
                            }

                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                            setReasoningMenuOpen(false);
                          }}
                        />
                      );
                    })
                  )}
                </View>
              ) : null}

              {reasoningMenuOpen ? (
                <View style={styles.reasoningMenu}>
                  {REASONING_OPTIONS.map((option) => {
                    const active =
                      reasoningMode === option.id;

                    return (
                      <Pressable
                        key={option.id}
                        onPress={() =>
                          void selectReasoningMode(
                            option.id,
                          )
                        }
                        style={[
                          styles.reasoningOption,
                          active &&
                            styles.reasoningOptionActive,
                        ]}
                      >
                        <View style={styles.reasoningOptionIcon}>
                          <Ionicons
                            name={option.icon}
                            size={17}
                            color={themedIconColor(
                              "#222222",
                              isDark,
                            )}
                          />
                        </View>

                        <View style={styles.flex}>
                          <Text style={styles.reasoningOptionTitle}>
                            {option.label[language]}
                          </Text>
                          <Text style={styles.reasoningOptionDescription}>
                            {option.description[language]}
                          </Text>
                        </View>

                        {active ? (
                          <Ionicons
                            name="checkmark"
                            size={17}
                            color={themedIconColor(
                              "#111111",
                              isDark,
                            )}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.modelControlsRow}>
                <Pressable
                  style={[
                    styles.modelSelector,
                    styles.modelSelectorFlexible,
                  ]}
                  onPress={() => {
                    setReasoningMenuOpen(false);

                    if (availableModels.length > 1) {
                      setModelMenuOpen(
                        (current) => !current,
                      );
                    }
                  }}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={17}
                    color={themedIconColor("#111111", isDark)}
                  />
                  <Text
                    numberOfLines={1}
                    style={styles.modelSelectorText}
                  >
                    {models.find(
                      (model) => model.id === selectedModel,
                    )?.name || t.model}
                  </Text>

                  {wallet?.pack_id &&
                  TRIAL_MODEL_BY_PACK[wallet.pack_id] === selectedModel ? (
                    <Text style={styles.trialBadge}>
                      {t.trial}
                      {trials[selectedModel]
                        ? ` · ${trials[selectedModel].remaining}/${trials[selectedModel].max}`
                        : ""}
                    </Text>
                  ) : null}

                  <Ionicons
                    name={
                      modelMenuOpen
                        ? "chevron-up"
                        : "chevron-down"
                    }
                    size={15}
                    color={themedIconColor("#555555", isDark)}
                  />
                </Pressable>

                <Pressable
                  style={styles.reasoningSelector}
                  onPress={() => {
                    setModelMenuOpen(false);
                    setReasoningMenuOpen(
                      (current) => !current,
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    getReasoningOption(
                      reasoningMode,
                    ).label[language]
                  }
                >
                  <Ionicons
                    name={
                      getReasoningOption(
                        reasoningMode,
                      ).icon
                    }
                    size={16}
                    color={themedIconColor(
                      "#555555",
                      isDark,
                    )}
                  />
                  <Text style={styles.reasoningSelectorText}>
                    {
                      getReasoningOption(
                        reasoningMode,
                      ).label[language]
                    }
                  </Text>
                  <Ionicons
                    name={
                      reasoningMenuOpen
                        ? "chevron-up"
                        : "chevron-down"
                    }
                    size={14}
                    color={themedIconColor(
                      "#777777",
                      isDark,
                    )}
                  />
                </Pressable>
              </View>
            </View>

            {activeCapability === "Recherche Web" ? (
              <View style={styles.capabilityBanner}>
                <View style={styles.capabilityIcon}>
                  <Ionicons
                    name="globe-outline"
                    size={18}
                    color={themedIconColor("#111111", isDark)}
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
                    color={themedIconColor("#666666", isDark)}
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
                      color={themedIconColor("#666666", isDark)}
                    />
                  </Pressable>
                </View>

                {!hasActivePack ? (
                  <View style={styles.mediaLockedBanner}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={17}
                      color={themedIconColor("#555555", isDark)}
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

                {hasActivePack &&
                (isLoadingMediaCapabilities || mediaCapabilities.length === 0) ? (
                  <Text style={styles.smallMuted}>
                    {isLoadingMediaCapabilities ? t.loading : t.noCreationOption}
                  </Text>
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
                        disabled={!hasActivePack || isLoadingMediaCapabilities || configurationsForType.length === 0}
                        onPress={() => {
                          if (hasActivePack && !isLoadingMediaCapabilities && configurationsForType.length > 0) {
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
                          (!hasActivePack || isLoadingMediaCapabilities || configurationsForType.length === 0) &&
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
                          color={themedIconColor("#111111", isDark)}
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
                              disabled={!hasActivePack || isLoadingMediaCapabilities}
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
                                    color={themedIconColor("#111111", isDark)}
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
                      editable={hasActivePack && !isThinking && !isLoadingMediaCapabilities}
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
                          isLoadingMediaCapabilities ||
                          !mediaPrompt.trim() ||
                          !selectedMediaAction ||
                          isThinking
                        }
                        onPress={() =>
                          void handleGenerateMedia()
                        }
                        style={[
                          styles.generateButton,
                          (!hasActivePack ||
                            isLoadingMediaCapabilities ||
                            !mediaPrompt.trim() ||
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

            <View
              style={[
                styles.composer,
                composerExpanded
                  ? styles.composerExpanded
                  : styles.composerResting,
              ]}
            >
              {composerExpanded && attachments.length > 0 ? (
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
                      onRemove={() => removeAttachment(attachment.id)}
                    />
                  ))}
                </ScrollView>
              ) : null}

              <TextInput
                ref={composerInputRef}
                value={message}
                onChangeText={(value) =>
                  void handleComposerTextChange(
                    value,
                  )
                }
                placeholder={
                  activeCapability === "Création"
                    ? t.creationPrompt
                    : t.messagePrompt
                }
                placeholderTextColor={themedIconColor("#999999", isDark)}
                editable={!isThinking}
                multiline
                textAlignVertical={composerExpanded ? "top" : "center"}
                scrollEnabled={composerExpanded && composerInputHeight >= 172}
                style={[
                  styles.composerInput,
                  composerExpanded
                    ? [
                        styles.composerInputExpanded,
                        { height: composerInputHeight },
                      ]
                    : styles.composerInputCompact,
                ]}
                onFocus={() => {
                  setComposerExpanded(true);
                  setModelMenuOpen(false);
                  setReasoningMenuOpen(false);
                  setComposerInputHeight((current) => Math.max(112, current));
                }}
                onBlur={() => undefined}
                onContentSizeChange={(event) => {
                  if (!composerExpanded) return;

                  const measuredHeight =
                    Math.ceil(event.nativeEvent.contentSize.height) + 22;
                  const nextHeight = Math.max(
                    112,
                    Math.min(176, measuredHeight),
                  );

                  setComposerInputHeight((current) =>
                    Math.abs(current - nextHeight) >= 6
                      ? nextHeight
                      : current,
                  );
                }}
                onSubmitEditing={(event) => {
                  if (Platform.OS === "ios") {
                    event.preventDefault();
                  }
                }}
              />

              {composerExpanded ? (
                <View style={styles.composerFooter}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.capabilityRow}
                  >
                    <Pressable
                      style={styles.capabilityButton}
                      onPress={() => selectCapability("Fichier")}
                    >
                      <Ionicons
                        name="document-text-outline"
                        size={19}
                        color={themedIconColor("#555555", isDark)}
                      />
                      <Text style={styles.capabilityButtonText}>
                        {t.file}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.capabilityButton}
                      onPress={() => selectCapability("Image")}
                    >
                      <Ionicons
                        name="image-outline"
                        size={19}
                        color={themedIconColor("#555555", isDark)}
                      />
                      <Text style={styles.capabilityButtonText}>
                        {t.image}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.capabilityButton}
                      onPress={() => void pickCamera()}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={19}
                        color={themedIconColor("#555555", isDark)}
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
                      onPress={() => selectCapability("Recherche Web")}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={19}
                        color={
                          activeCapability === "Recherche Web"
                            ? "#ffffff"
                            : themedIconColor("#555555", isDark)
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
                      onPress={() => selectCapability("Création")}
                    >
                      <Ionicons
                        name="videocam-outline"
                        size={19}
                        color={
                          activeCapability === "Création"
                            ? "#ffffff"
                            : themedIconColor("#555555", isDark)
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
                    style={[mobileExtras.microphoneButton,
                      recorderState.isRecording && mobileExtras.microphoneActive]}
                    disabled={isThinking || voiceUploading || (Boolean(voiceDraft || localVoiceDraft) && !recorderState.isRecording)}
                    onPress={() => void (recorderState.isRecording ? stopVoiceRecording() : startVoiceRecording())}
                    accessibilityLabel={recorderState.isRecording ? t.recordStop : t.microphone}>
                    <Ionicons name={recorderState.isRecording ? "stop" : "mic-outline"}
                      size={21} color={recorderState.isRecording ? "#fff" : themedIconColor("#444", isDark)} />
                  </Pressable>
                  <Pressable
                    style={[
                      styles.sendButton,
                      ((!message.trim() && attachments.length === 0) ||
                        isThinking) && styles.sendDisabled,
                    ]}
                    disabled={
                      (!message.trim() && attachments.length === 0) ||
                      isThinking
                    }
                    onPress={() => void handleSendMessage()}
                  >
                    {isThinking ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="arrow-up" size={22} color="#ffffff" />
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Pressable
                    style={[mobileExtras.microphoneButton,
                      recorderState.isRecording && mobileExtras.microphoneActive]}
                    disabled={isThinking || voiceUploading || (Boolean(voiceDraft || localVoiceDraft) && !recorderState.isRecording)}
                    onPress={() => void (recorderState.isRecording ? stopVoiceRecording() : startVoiceRecording())}
                    accessibilityLabel={recorderState.isRecording ? t.recordStop : t.microphone}>
                    <Ionicons name={recorderState.isRecording ? "stop" : "mic-outline"} size={21}
                      color={recorderState.isRecording ? "#fff" : themedIconColor("#444", isDark)} />
                  </Pressable>
                <Pressable
                  style={[
                    styles.restingSendButton,
                    ((!message.trim() && attachments.length === 0) ||
                      isThinking) && styles.sendDisabled,
                  ]}
                  disabled={
                    (!message.trim() && attachments.length === 0) ||
                    isThinking
                  }
                  onPress={() => void handleSendMessage()}
                >
                  {isThinking ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={22}
                      color="#ffffff"
                    />
                  )}
                </Pressable>
                </View>
              )}
            </View>

            {composerExpanded ? (
              <Text style={styles.disclaimer}>
                {interpolate(t.attachmentDisclaimer, {
                  max: MAX_ATTACHMENTS,
                })}{" "}
                {language === "en"
                  ? "Very long pasted text is automatically converted into a text file."
                  : "Les collages très longs sont automatiquement convertis en fichier texte."}
              </Text>
            ) : null}
          </View>

          <Modal
            visible={drawerVisible}
            transparent
            animationType="none"
            onRequestClose={closeDrawer}
          >
            <View style={styles.drawerOverlay}>
              <Pressable
                style={styles.drawerBackdrop}
                onPress={closeDrawer}
              />

              <Animated.View
                style={[
                  styles.drawer,
                  {
                    width: drawerWidth,
                    top: Math.max(safeAreaTop, 12) + 8,
                    bottom: Math.max(safeAreaBottom, 10) + 8,
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
                      color={themedIconColor("#555555", isDark)}
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
                  style={styles.historyScroller}
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
                      color={themedIconColor("#666666", isDark)}
                    />
                  </View>

                  <Text style={styles.walletBalance}>
                    {isLoadingWallet
                      ? "..."
                      : wallet
                        ? formatCredits(availableBalance)
                        : "—"}
                  </Text>

                  <Text style={styles.smallMuted}>
                    {wallet && !wallet.is_pack_active
                      ? t.packExpired
                      : remainingDays !== null
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
                      color={themedIconColor("#555555", isDark)}
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
                      color={themedIconColor("#555555", isDark)}
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.myCreations}
                    </Text>
                    {(generatedMedia.length +
                      generatedArtifacts.length) > 0 ? (
                      <Text style={styles.drawerCount}>
                        {generatedMedia.length +
                          generatedArtifacts.length}
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
                      color={themedIconColor("#555555", isDark)}
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
                      color={themedIconColor("#555555", isDark)}
                    />
                    <Text style={styles.drawerLinkText}>
                      {t.logout}
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            </View>
          </Modal>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </OriaThemeContext.Provider>
  );
}

const baseStyles = StyleSheet.create({
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
    paddingBottom: 20,
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
  modifyMessageButton: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  modifyMessageButtonText: {
    fontSize: 10,
    color: "#777771",
    fontWeight: "500",
  },
  modificationCard: {
    marginTop: 7,
    width: "94%",
    maxWidth: 520,
    borderWidth: 1,
    borderColor: "#deded9",
    borderRadius: 17,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  modificationTitle: {
    color: "#22221f",
    fontSize: 12,
    fontWeight: "700",
  },
  modificationHelp: {
    marginTop: 4,
    color: "#777771",
    fontSize: 10,
    lineHeight: 15,
  },
  modificationInput: {
    marginTop: 10,
    minHeight: 88,
    maxHeight: 150,
    borderWidth: 1,
    borderColor: "#deded9",
    borderRadius: 13,
    backgroundColor: "#f7f7f4",
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: "#171715",
    fontSize: 14,
    lineHeight: 20,
  },
  modificationHint: {
    marginTop: 8,
    color: "#777771",
    fontSize: 9,
    lineHeight: 14,
  },
  modificationActions: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  modificationCancelButton: {
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modificationCancelText: {
    color: "#666661",
    fontSize: 11,
    fontWeight: "600",
  },
  modificationApplyButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  modificationApplyButtonDisabled: {
    opacity: 0.35,
  },
  modificationApplyButtonPressed: {
    opacity: 0.82,
  },
  modificationApplyText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  modificationStatus: {
    marginTop: 4,
    maxWidth: "94%",
    color: "#777771",
    fontSize: 9,
    lineHeight: 13,
    textAlign: "right",
  },
  messageBubble: {
    maxWidth: "85%",
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: "#111111",
    borderBottomRightRadius: 7,
  },
  assistantMessageContent: {
    width: "100%",
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  userText: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 21,
  },
  userMessageExpandButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  userMessageExpandText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "600",
    opacity: 0.86,
  },
  messageText: {
    color: "#1b1b19",
    fontSize: 14,
    lineHeight: 22,
  },
  mathBlock: {
    width: "100%",
    marginVertical: 7,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  mathWebViewContainer: {
    width: "100%",
    backgroundColor: "transparent",
  },
  mathWebView: {
    width: "100%",
    backgroundColor: "transparent",
  },
  mathFallbackText: {
    color: "#1b1b19",
    fontSize: 15,
    lineHeight: 23,
    fontStyle: "italic",
    textAlign: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
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
  listContent: {
    flex: 1,
    minWidth: 0,
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
  artifactList: {
    marginTop: 9,
    width: "94%",
    gap: 7,
  },
  artifactCard: {
    minHeight: 64,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#deded9",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  artifactIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eeeeeb",
  },
  artifactInfo: {
    flex: 1,
    minWidth: 0,
  },
  artifactName: {
    color: "#22221f",
    fontSize: 12,
    fontWeight: "600",
  },
  artifactMeta: {
    marginTop: 3,
    color: "#777771",
    fontSize: 9,
    fontWeight: "500",
  },
  artifactDownloadButton: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#deded9",
    backgroundColor: "#f7f7f4",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomArea: {
    flexShrink: 0,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: 13,
    paddingTop: 6,
    backgroundColor: "#f8f8f6",
  },
  modelSelectorWrap: {
    position: "relative",
    width: "100%",
    zIndex: 60,
    elevation: 60,
  },
  modelControlsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  modelSelectorFlexible: {
    flex: 1,
    minWidth: 0,
  },
  reasoningSelector: {
    minHeight: 39,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  reasoningSelectorText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4c4c47",
  },
  reasoningMenu: {
    position: "absolute",
    right: 0,
    bottom: 55,
    width: 270,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    padding: 7,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 19,
  },
  reasoningOption: {
    minHeight: 58,
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  reasoningOptionActive: {
    backgroundColor: "#f0f0ed",
  },
  reasoningOptionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f3f0",
  },
  reasoningOptionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#22221f",
  },
  reasoningOptionDescription: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
    color: "#777771",
  },
  modelMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 55,
    maxHeight: 300,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ddddda",
    backgroundColor: "#ffffff",
    padding: 7,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 18,
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
    borderWidth: 1,
    borderColor: "#d2d2ce",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  composerResting: {
    minHeight: 62,
    borderRadius: 31,
    paddingLeft: 5,
    paddingRight: 7,
    flexDirection: "row",
    alignItems: "center",
  },
  composerExpanded: {
    borderRadius: 26,
    paddingTop: 3,
  },
  attachmentsRow: {
    paddingHorizontal: 13,
    paddingTop: 12,
    gap: 8,
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
    flex: 1,
    color: "#171715",
    fontSize: 16,
    lineHeight: 23,
  },
  composerInputCompact: {
    minHeight: 54,
    maxHeight: 54,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 12,
  },
  composerInputExpanded: {
    width: "100%",
    minHeight: 112,
    maxHeight: 176,
    paddingHorizontal: 17,
    paddingTop: 14,
    paddingBottom: 10,
  },
  composerFooter: {
    minHeight: 58,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 4,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  capabilityRow: {
    alignItems: "center",
    gap: 4,
    paddingRight: 5,
  },
  capabilityButton: {
    minHeight: 40,
    paddingHorizontal: 9,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  capabilityButtonText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#555550",
  },
  capabilityActive: {
    backgroundColor: "#111111",
  },
  capabilityActiveText: {
    color: "#ffffff",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  restingSendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sendDisabled: {
    opacity: 0.28,
  },
  disclaimer: {
    marginTop: 7,
    paddingHorizontal: 12,
    fontSize: 9,
    lineHeight: 14,
    color: "#8a8a85",
    textAlign: "center",
  },
  drawerOverlay: {
    flex: 1,
  },
  drawerBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.24)",
  },
  drawer: {
    position: "absolute",
    left: 8,
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 16,
    borderRadius: 26,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 4, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 14,
  },
  drawerHeader: {
    paddingHorizontal: 3,
    paddingBottom: 22,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  drawerBrand: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    color: "#111111",
  },
  drawerSubtitle: {
    marginTop: 5,
    fontSize: 9,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 1.8,
    color: "#888882",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  newConversationButton: {
    minHeight: 58,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  newConversationText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "500",
  },
  plusText: {
    color: "#ffffff",
    fontSize: 18,
    opacity: 0.55,
  },
  historyLabel: {
    marginTop: 28,
    marginBottom: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#888882",
  },
  historyScroller: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 88,
    maxHeight: 330,
  },
  historyList: {
    gap: 3,
    paddingBottom: 14,
  },
  conversationItem: {
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 14,
  },
  conversationItemActive: {
    backgroundColor: "#f0f0ed",
  },
  conversationTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "#565650",
  },
  walletCard: {
    marginTop: 10,
    padding: 16,
    borderRadius: 19,
    backgroundColor: "#f7f7f5",
    borderWidth: 1,
    borderColor: "#deded9",
  },
  walletBalance: {
    marginTop: 10,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "700",
    color: "#171715",
  },
  drawerLinks: {
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e1e1dc",
    gap: 3,
  },
  drawerLink: {
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  drawerLinkText: {
    flex: 1,
    fontSize: 14,
    color: "#555550",
  },
  drawerCount: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: "#e5e5e1",
    color: "#666660",
    fontSize: 10,
    textAlign: "center",
  },
});