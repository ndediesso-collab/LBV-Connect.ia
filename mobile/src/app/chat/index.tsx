import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
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
import { Stack, useFocusEffect, usePreventRemove, useRouter } from "expo-router";
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
import OriaVisualMobile from "@/components/oria-visual/OriaVisualMobile";
import OriaMiniStudio from "@/components/oria-mini-studio/OriaMiniStudio";
import OriaMathRenderer, { OriaMathInlineText } from "@/components/oria-math/OriaMathRenderer";

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
 *   GET  /ai/artifacts
 *   GET  /ai/artifacts/:id
 *   Studio externe : /ai/google-media/* (dans OriaMiniStudio.tsx)
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

// Une seule étape visible : les jalons précédents ne sont pas conservés.
// Seuls les codes reconnus par ORIA sont traduits ; un libellé arbitraire
// envoyé par le réseau n'est jamais affiché directement.
const ORIA_CHAT_STATUS_LABELS = {
  sending: { fr: "Envoi de la demande…", en: "Sending request…" },
  file_received: { fr: "Fichier reçu", en: "File received" },
  image_received: { fr: "Image reçue", en: "Image received" },
  attachments_received: { fr: "Pièces jointes reçues", en: "Attachments received" },
  preparing: { fr: "Préparation de la réponse…", en: "Preparing response…" },
  processing_file: { fr: "Traitement du fichier…", en: "Processing file…" },
  processing_image: { fr: "Traitement de l'image…", en: "Processing image…" },
  processing_attachments: { fr: "Traitement des pièces jointes…", en: "Processing attachments…" },
  processing: { fr: "Génération de la réponse…", en: "Generating response…" },
  restarting: { fr: "Ajustement de la réponse…", en: "Updating response…" },
  creating_artifact: { fr: "Création du document…", en: "Creating document…" },
  media_generation: { fr: "Création du média…", en: "Generating media…" },
} as const satisfies Record<string, Record<OriaLanguage, string>>;

type OriaChatStatusStep = keyof typeof ORIA_CHAT_STATUS_LABELS;

function readOriaChatStatusStep(value: unknown): OriaChatStatusStep | null {
  if (typeof value !== "string") return null;
  // Réservés à des actions confirmées côté application mobile.
  if (value === "sending" || value === "media_generation") return null;
  return Object.prototype.hasOwnProperty.call(ORIA_CHAT_STATUS_LABELS, value)
    ? (value as OriaChatStatusStep)
    : null;
}

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
    documentPreview: "Aperçu",
    documentUnavailable: "Aperçu momentanément indisponible. Le téléchargement reste possible.",
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
    documentPreview: "Preview",
    documentUnavailable: "Preview temporarily unavailable. Download remains available.",
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

type Role = "user" | "assistant";

type OriaRevision = {
  id: string;
  revision_no: number;
  user_content: string;
  assistant_content: string | null;
  status: string;
};

type OriaRevisionsResponse = {
  success: boolean;
  active_revision: number;
  original: { user_content: string; assistant_content: string | null };
  revisions: OriaRevision[];
  original_attachment_replay_supported: boolean;
};

type OriaPrepareRevisionResponse = {
  success: boolean;
  revision: OriaRevision;
  active_revision: number;
};

type OriaGenerateRevisionResponse = {
  success: boolean;
  active: boolean;
  revision_id: string;
  revision_no: number;
  message: string;
  artifacts?: Array<Record<string, unknown>>;
};

function oriaEditableUserText(value: string): string {
  return getVisibleMessageContent(value)
    .replace(/\n\n\[(?:Pièces jointes|Attachments)\s*:[^\]]*\]/i, "")
    .trim();
}
function oriaMessageHasFiles(value: string): boolean {
  return /\[(?:Pièces jointes|Attachments)\s*:/i.test(value);
}

// UUID requis par l'API de révision. Repli pour runtimes Expo sans randomUUID.
function oriaRevisionRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    return (char === "x" ? n : (n & 3) | 8).toString(16);
  });
}

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
  previewUrl?: string | null;
  previewSupported?: boolean;
  previewAvailable?: boolean;
  created_at?: string | null;
  messageId?: string | null;
};

type WordPreviewRun = { type: "text" | "image"; text?: string; src?: string;
  bold?: boolean; italic?: boolean; underline?: boolean };
type WordPreviewBlock = { type: "title" | "subtitle" | "heading" | "paragraph" | "bullet" | "number" | "table";
  level?: number; runs?: WordPreviewRun[]; rows?: string[][] };
type WordPreviewData = { id: string; filename: string; blocks: WordPreviewBlock[];
  truncated: boolean; image_count: number };

type SpreadsheetPreviewSheet = {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
  truncated: boolean;
};
type SpreadsheetPreviewData = {
  id: string;
  filename: string;
  sheets: SpreadsheetPreviewSheet[];
  truncated: boolean;
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
  mime_type?: string | null;
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
const COMPOSER_INPUT_MIN_HEIGHT = 44;
const COMPOSER_INPUT_MAX_HEIGHT = 140;

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
    mime_type: typeof raw.mime_type === "string" ? raw.mime_type : null,
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
    typeof raw.extension === "string" && raw.extension.trim()
      ? raw.extension.trim().replace(/^\./, "").toLowerCase()
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
      : typeof raw.downloadUrl === "string"
        ? raw.downloadUrl
        : typeof raw.url === "string"
          ? raw.url
          : null;

  const previewUrl =
    typeof raw.preview_url === "string"
      ? raw.preview_url
      : typeof raw.previewUrl === "string"
        ? raw.previewUrl
        : null;
  // Toujours proposer l'apercu des PDF; les liens signes et autorisations
  // se verifient au clic, jamais lors de l'affichage de la carte.
  const previewSupported = ["pdf", "docx", "xlsx"].includes(extension);
  const previewAvailable = raw.preview_available === true || raw.previewAvailable === true;

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
    previewUrl,
    previewSupported,
    previewAvailable,
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
              artifact.downloadUrl || previous.downloadUrl || null,
            previewUrl:
              artifact.previewUrl || previous.previewUrl || null,
            previewSupported:
              artifact.previewSupported || previous.previewSupported || false,
            previewAvailable:
              artifact.previewAvailable || previous.previewAvailable || false,
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

// Les URLs signées proviennent d'un accès authentifié ; elles expirent.
// Refuser les schémas d'URL actifs ou les URLs avec identifiants incorporés.
function safePrivateArtifactUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      Boolean(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

// Ne jamais utiliser le nom non assaini dans le chemin local mobile.
function safeLocalArtifactFilename(artifact: GeneratedArtifact): string {
  const cleanId = artifact.id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 42) || "file";
  const cleanName = artifact.filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 95);
  return `oria-${cleanId}-${cleanName || `document.${artifact.extension || "bin"}`}`;
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

  // Refresh before the access token expires. Supabase remains the authority;
  // never bypass authentication or silently replay a billable generation.
  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session?.access_token) {
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }
    return refreshed.data.session;
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

// Les fichiers du Chat mobile passent exclusivement par expo/fetch ;
// ne pas envoyer des `{ uri, type, name }` incompatibles avec SDK 58.
async function apiRevisionFormFetch<T>(path: string, form: FormData): Promise<T> {
  const session = await getSessionOrThrow();
  const response = await expoFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "user-id": session.user.id,
      authorization: `Bearer ${session.access_token}`,
    },
    body: form,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String(payload.detail) : "La régénération a échoué.";
    throw new Error(response.status === 401 ? "Session expirée. Veuillez vous reconnecter." : detail);
  }
  return (await response.json()) as T;
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

// Sur iOS/Android, une absence de 30 minutes peut rouvrir le Chat sur
// l'accueil. L'historique, son identifiant actif et la mémoire serveur
// restent inchangés : il ne s'agit que d'une préférence de présentation.
const ORIA_MOBILE_RETURN_HOME_AFTER_MS = 30 * 60 * 1000;
const ORIA_MOBILE_AWAY_PREFIX = "oria_mobile_last_background_v1";

function shouldShowMobileReturnHome(
  backgroundAt: number | null,
  now: number,
): boolean {
  return backgroundAt !== null &&
    Number.isFinite(backgroundAt) &&
    Number.isFinite(now) &&
    now >= backgroundAt &&
    now - backgroundAt >= ORIA_MOBILE_RETURN_HOME_AFTER_MS;
}

async function readMobileBackgroundAt(userId: string): Promise<number | null> {
  if (Platform.OS === "web") return null;
  try {
    const value = await SecureStore.getItemAsync(
      `${ORIA_MOBILE_AWAY_PREFIX}_${userId}`,
    );
    if (value === null) return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  } catch (error) {
    console.warn("Horodatage de retour ORIA indisponible :", error);
    return null;
  }
}

async function writeMobileBackgroundAt(
  userId: string,
  timestamp: number,
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(
      `${ORIA_MOBILE_AWAY_PREFIX}_${userId}`,
      String(timestamp),
    );
  } catch (error) {
    console.warn("Impossible d'enregistrer la mise en arrière-plan ORIA :", error);
  }
}

async function clearMobileBackgroundAt(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(`${ORIA_MOBILE_AWAY_PREFIX}_${userId}`);
  } catch (error) {
    console.warn("Impossible de nettoyer l'horodatage ORIA :", error);
  }
}

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
    // Compatibility: keep existing offline data until an idempotent server-side
    // outbox is installed. SecureStore size needs a dedicated cache migration.
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
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id) ? message.id : undefined,
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
  /(\\\([^\n]*?\\\)|\$(?!\s)[^$\n]*?\S\$|\b[A-Za-z](?:(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+)))+(?![A-Za-z0-9_])|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

const INLINE_MATH_TOKEN_REGEX =
  /(\\\([^\n]*?\\\)|\$(?!\s)[^$\n]*?\S\$|\b[A-Za-z](?:(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+)))+(?![A-Za-z0-9_]))/;

function MathRichText({ text, variant = "body" }: { text: string; variant?: MathTextVariant }) {
  const isDark = useIsDarkTheme();
  return <OriaMathInlineText text={text} variant={variant} isDark={isDark} />;
}

function MathExpression({ source }: { source: string }) {
  const isDark = useIsDarkTheme();
  return <OriaMathRenderer latex={source} isDark={isDark} />;
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
            onPress={() => {
              if (/^(https?:\/\/|mailto:)/i.test(url)) {
                void Linking.openURL(url).catch(() => undefined);
              }
            }}
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

/* ============================================================
 * ORIA VISUAL — PARITÉ WEB / MOBILE
 * Les 9 blocs oria-* sont envoyés au moteur partagé Next.js.
 * Le mobile n'exécute aucun code provenant des réponses IA.
 * Les tableaux Markdown classiques restent gérés par le chat.
 * ============================================================ */

const ORIA_VISUAL_FENCES = new Set([
  "oria-chart", "oria-grid", "oria-diagram",
  "oria-stats", "oria-geometry", "oria-table", "oria-callout",
  "oria-3d", "oria-map",
]);
const MAX_ORIA_VISUAL_RAW_LENGTH = 180_000;

function isOriaVisualJson(raw: string): boolean {
  if (!raw || raw.length > MAX_ORIA_VISUAL_RAW_LENGTH) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function oriaMobileTableCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let pos = 0; pos < source.length; pos++) {
    if (source[pos] === "\\" && source[pos + 1] === "|") {
      cell += "|";
      pos++;
    } else if (source[pos] === "`") {
      inCode = !inCode;
      cell += "`";
    } else if (source[pos] === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += source[pos];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function oriaMobileIsTableDivider(line: string): boolean {
  const cells = oriaMobileTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

const oriaVisualStyles = StyleSheet.create({
  tableFrame: { borderWidth: 1, borderColor: "#dddddf", borderRadius: 13, overflow: "hidden", marginVertical: 5 },
  tableToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#f4f4f5" },
  tableRow: { flexDirection: "row", alignItems: "stretch" },
  tableCell: { width: 142, minHeight: 40, paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: "#e0e0e3", justifyContent: "center" },
  tableText: { fontSize: 12, lineHeight: 19, color: "#242428" },
  smallLabel: { fontSize: 11, fontWeight: "600", color: "#66666d" },
  actionText: { fontSize: 11, fontWeight: "600", color: "#2563eb" },
  callout: { borderLeftWidth: 4, borderRadius: 10, padding: 12, gap: 5, marginVertical: 4, backgroundColor: "#f5f5f7" },
  calloutHeading: { fontSize: 12, fontWeight: "700", color: "#25252a" },
  checklistRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  checkBox: { width: 17, height: 17, borderRadius: 4, borderWidth: 1.3, borderColor: "#888890", alignItems: "center", justifyContent: "center", marginTop: 2 },
});

function OriaMobileTable({ headers, rows, alignment, language }: {
  headers: string[]; rows: string[][];
  alignment: Array<"left" | "center" | "right">; language: OriaLanguage;
}) {
  const dark = useIsDarkTheme();
  const [copied, setCopied] = useState(false);
  const background = dark ? "#17171a" : "#ffffff";
  const headerBackground = dark ? "#242428" : "#f4f4f5";
  const textColor = dark ? "#f0f0f2" : "#242428";
  const borderColor = dark ? "#36363d" : "#e0e0e3";
  const tsv = [headers, ...rows].map((row) => headers.map((_, index) =>
    (row[index] ?? "").replace(/[\t\r\n]/g, " ")).join("\t")).join("\n");
  const renderRow = (row: string[], rowIndex: number, header: boolean) => (
    <View key={`${header ? "h" : "r"}-${rowIndex}`} style={oriaVisualStyles.tableRow}>
      {headers.map((_, col) => (
        <View key={col} style={[oriaVisualStyles.tableCell, { borderColor,
          backgroundColor: header ? headerBackground : background, width: 142 }]}>
          <Text style={[oriaVisualStyles.tableText, { color: textColor,
            fontWeight: header ? "700" : "400", textAlign: alignment[col] ?? "left" }]}
            selectable>{row[col] ?? ""}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <View style={[oriaVisualStyles.tableFrame, { borderColor, backgroundColor: background }]}>
      <View style={[oriaVisualStyles.tableToolbar, { backgroundColor: headerBackground }]}>
        <Text style={[oriaVisualStyles.smallLabel, { color: textColor }]}>
          {language === "fr" ? "Tableau" : "Table"} · {rows.length} {language === "fr" ? "lignes" : "rows"}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={language === "fr" ? "Copier le tableau" : "Copy table"}
          onPress={() => void Clipboard.setStringAsync(tsv).then(() => {
            setCopied(true); setTimeout(() => setCopied(false), 1400);
          }).catch(() => undefined)}>
          <Text style={oriaVisualStyles.actionText}>{copied ? (language === "fr" ? "Copié" : "Copied") : (language === "fr" ? "Copier" : "Copy")}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator
        contentContainerStyle={{ minWidth: headers.length * 142 }}>
        <View>
          {renderRow(headers, 0, true)}
          {rows.map((row, index) => renderRow(row, index, false))}
        </View>
      </ScrollView>
    </View>
  );
}

function OriaMobileCallout({ kind, lines, language }: {
  kind: string; lines: string[]; language: OriaLanguage;
}) {
  const dark = useIsDarkTheme();
  const entries: Record<string, [string, string, string]> = {
    NOTE: ["#0284c7", "Note", "Note"],
    TIP: ["#059669", "Conseil", "Tip"],
    IMPORTANT: ["#7c3aed", "Important", "Important"],
    WARNING: ["#d97706", "Attention", "Warning"],
    CAUTION: ["#dc2626", "Prudence", "Caution"],
  };
  const [color, fr, en] = entries[kind] ?? entries.NOTE;
  return <View style={[oriaVisualStyles.callout, {
    borderLeftColor: color, backgroundColor: dark ? "#242428" : "#f5f5f7" }]}>
    <Text style={[oriaVisualStyles.calloutHeading, { color: dark ? "#f4f4f5" : "#25252a" }]}>{language === "fr" ? fr : en}</Text>
    {lines.map((line, index) => <InlineMarkdown key={index} text={line} />)}
  </View>;
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
  let bareMathEnvironmentEnd: string | null = null;
  let index = 0;
  const consumedVisualLines = new Set<number>();

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
            {/^\[([ xX])\]\s+/.test(item) ? (
              <View style={[oriaVisualStyles.checkBox, /^\[[xX]\]/.test(item)
                ? { backgroundColor: "#2563eb", borderColor: "#2563eb" } : null]}>
                {/\[[xX]\]/.test(item) ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
              </View>
            ) : <Text style={styles.bullet}>•</Text>}
            <View style={styles.listContent}>
              <InlineMarkdown text={item.replace(/^\[[ xX]\]\s+/, "")} />
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
    bareMathEnvironmentEnd = null;
  };

  const flushCode = (complete = true) => {
    if (!inCode) return;
    const source = code.join("\n");
    const visualLanguage = codeLanguage.trim().toLowerCase().split(/\s+/)[0];
    // ORIA : seules les données JSON validées sont envoyées au moteur Web.
    // Les vrais fichiers de code gardent leur lecteur existant ; un JSON
    // incomplet, invalide ou trop long reste visible sous forme de code.
    if (new Set(["math", "latex", "tex"]).has(visualLanguage)) {
      if (complete) {
        blocks.push(<MathExpression key={`math-code-${index}`} source={source} />);
      } else {
        blocks.push(<Text key={`math-pending-${index}`} style={oriaVisualStyles.smallLabel}>
          {uiLanguage === "fr" ? "Composition de l’équation…" : "Typesetting equation…"}
        </Text>);
      }
    } else if (ORIA_VISUAL_FENCES.has(visualLanguage)) {
      if (!complete) {
        blocks.push(
          <Text key={`visual-pending-${index}`} style={oriaVisualStyles.smallLabel}>
            {uiLanguage === "fr" ? "Préparation du visuel…" : "Preparing visualization…"}
          </Text>,
        );
      } else if (isOriaVisualJson(source)) {
        blocks.push(
          <OriaVisualMobile
            key={`visual-${index}`}
            kind={visualLanguage}
            raw={source}
            language={uiLanguage}
            fallback={
              <CodeBlock
                language={codeLanguage}
                value={source}
                uiLanguage={uiLanguage}
                onExpand={onCodeOpen}
              />
            }
          />,
        );
      } else {
        blocks.push(
          <CodeBlock key={`code-${index}`} language={codeLanguage} value={source}
            uiLanguage={uiLanguage} onExpand={onCodeOpen} />,
        );
      }
    } else {
      blocks.push(
        <CodeBlock key={`code-${index}`} language={codeLanguage} value={source}
          uiLanguage={uiLanguage} onExpand={onCodeOpen} />,
      );
    }
    index++;
    code = [];
    codeLanguage = "";
    inCode = false;
  };

  lines.forEach((line, lineIndex) => {
    if (consumedVisualLines.has(lineIndex)) return;
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

    // Un environnement LaTeX autonome doit être traité comme une vraie formule,
    // même lorsqu'un modèle n'ajoute pas les délimiteurs \[ ... \].
    if (!inCode && !inMath) {
      const bareEnv = trimmed.match(/^\\begin\{(align\*?|aligned|gather\*?|gathered|equation\*?|multline\*?|split|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array)\}/);
      if (bareEnv) {
        flushLists();
        flushParagraph();
        bareMathEnvironmentEnd = `\\end{${bareEnv[1]}}`;
        math = [line];
        inMath = true;
        if (line.includes(bareMathEnvironmentEnd)) flushMath();
        return;
      }
    }

    if (inMath) {
      if (bareMathEnvironmentEnd) {
        math.push(line);
        if (line.includes(bareMathEnvironmentEnd)) flushMath();
      } else if (trimmed === "\\]" || trimmed === "$$") {
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

    // Tableaux GFM : en-tête + séparateurs + lignes délimitées par |.
    if (lineIndex + 1 < lines.length && trimmed.includes("|") &&
        oriaMobileIsTableDivider(lines[lineIndex + 1].trim())) {
      const headers = oriaMobileTableCells(trimmed);
      const separators = oriaMobileTableCells(lines[lineIndex + 1].trim());
      if (headers.length >= 2 && headers.length <= 16 && separators.length === headers.length) {
        flushLists(); flushParagraph();
        const alignment = separators.map((cell): "left" | "center" | "right" =>
          cell.startsWith(":") && cell.endsWith(":") ? "center" :
          cell.endsWith(":") ? "right" : "left");
        const rows: string[][] = [];
        consumedVisualLines.add(lineIndex + 1);
        for (let rowIndex = lineIndex + 2; rowIndex < lines.length && rows.length < 250; rowIndex++) {
          const row = lines[rowIndex].trim();
          if (!row || !row.includes("|") || row.startsWith("```")) break;
          rows.push(oriaMobileTableCells(row).slice(0, headers.length));
          consumedVisualLines.add(rowIndex);
        }
        blocks.push(<OriaMobileTable key={`table-${index++}`} headers={headers} rows={rows}
          alignment={alignment} language={uiLanguage}/>);
        return;
      }
    }

    // Encadrés GitHub-style : > [!TIP], > [!WARNING], etc.
    const admonition = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
    if (admonition) {
      flushLists(); flushParagraph();
      const calloutLines: string[] = [];
      for (let cursor = lineIndex + 1; cursor < lines.length; cursor++) {
        const next = lines[cursor].trim();
        if (!next.startsWith(">")) break;
        const body = next.replace(/^>\s?/, "").trim();
        if (body) calloutLines.push(body);
        consumedVisualLines.add(cursor);
      }
      blocks.push(<OriaMobileCallout key={`callout-${index++}`}
        kind={admonition[1].toUpperCase()} lines={calloutLines} language={uiLanguage}/>);
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

  if (inCode) flushCode(false);
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
  note, language, onLoad, transcript,
}: {
  note: VoiceNote;
  language: OriaLanguage;
  onLoad: (id: string) => Promise<string>;
  transcript?: string | null;
}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const signedAtRef = useRef(0);
  const privateDownloadedUriRef = useRef<string | null>(null);
  const text = (transcript || note.transcription || "").trim();

  // Do not leave private voice copies permanently in the phone cache.
  // Never delete the original recorder draft (only files we downloaded).
  useEffect(() => () => {
    const uri = privateDownloadedUriRef.current;
    if (Platform.OS !== "web" && uri?.includes("oria-voice-")) {
      try {
        const cached = new ExpoFile(uri);
        if (cached.exists) cached.delete();
      } catch { /* the OS may already have evicted the cache entry */ }
    }
  }, []);

  // Expo loads a newly-replaced remote source asynchronously. Never play it
  // before the native player reports isLoaded, especially on iOS.
  useEffect(() => {
    if (!pendingStart) return;
    if (status.error) {
      setPendingStart(false);
      setLoading(false);
      setError(true);
      setLoaded(false);
      setErrorDetail(String(status.error).slice(0, 250));
      return;
    }
    if (status.isLoaded) {
      setPendingStart(false);
      setLoading(false);
      setError(false);
      player.play();
    }
  }, [pendingStart, status.error, status.isLoaded, player]);

  async function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (loading) return;
    try {
      setLoading(true);
      setError(false);
      setErrorDetail(null);
      // Recording changes the global iOS audio session. Restore playback
      // explicitly before playing; do not route short voice notes to earpiece.
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      const mustRenew = !loaded || !signedAtRef.current || Boolean(status.error) ||
        // A signed link expires; a downloaded local copy does not.
        (Platform.OS === "web" && Date.now() - signedAtRef.current >= 12 * 60 * 1000);
      if (mustRenew) {
        const url = await onLoad(note.audio_id);
        if (Platform.OS !== "web" && url.startsWith("file:") && url.includes("oria-voice-")) {
          privateDownloadedUriRef.current = url;
        }
        if (!/^https:\/\//i.test(url) && !url.startsWith("file:")) {
          throw new Error("Source audio non autorisée.");
        }
        // Set the pending flag before replacing the source; isLoaded may be
        // emitted synchronously on some versions of expo-audio.
        setPendingStart(true);
        signedAtRef.current = Date.now();
        setLoaded(true);
        player.replace({ uri: url });
        return;
      }
      if (status.didJustFinish || status.currentTime >= Math.max(0, status.duration - 0.2)) {
        await player.seekTo(0);
      }
      if (status.isLoaded) {
        player.play();
        setLoading(false);
      } else {
        setPendingStart(true);
      }
    } catch (cause) {
      setError(true);
      setErrorDetail(cause instanceof Error ? cause.message.slice(0, 250) : "Erreur audio inconnue.");
      setLoaded(false);
      setPendingStart(false);
      setLoading(false);
    }
  }

  const duration = status.duration > 0 ? Math.ceil(status.duration * 1000) : note.duration_ms;
  return (
    <View style={mobileExtras.voiceCardOuter}>
      <View style={mobileExtras.voiceBubble}>
        <Pressable style={mobileExtras.voicePlay} onPress={() => void toggle()}
          disabled={loading} accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause" : "Play"}>
          {loading ? <ActivityIndicator size="small" color="#ffffff" /> :
            <Ionicons name={status.playing ? "pause" : "play"} size={20} color="#ffffff" />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={mobileExtras.waveBars}>
            {Array.from({ length: 28 }, (_, i) => (
              <View key={i} style={[mobileExtras.waveBar, {
                height: 6 + ((i * 17 + 9) % 18), opacity: status.playing ? 1 : .65,
              }]} />
            ))}
          </View>
          <View style={mobileExtras.voiceMetaRow}>
            <Text style={mobileExtras.voiceMeta}>{language === "fr" ? "Note vocale" : "Voice note"}</Text>
            <Text style={mobileExtras.voiceMeta}>{prettyAudioDuration(duration)}</Text>
          </View>
        </View>
      </View>
      {error || status.error ? (
        <Text style={mobileExtras.voicePlaybackError}>
          {language === "fr"
            ? `Lecture impossible. ${errorDetail || (status.error ? String(status.error) : "Vérifiez votre session et réessayez.")}`
            : `Playback failed. ${errorDetail || (status.error ? String(status.error) : "Check your session and retry.")}`}
        </Text>
      ) : null}
      {text ? (
        <>
          <Pressable onPress={() => setShowTranscript((current) => !current)}
            accessibilityRole="button" style={mobileExtras.voiceTranscriptButton}>
            <Ionicons name={showTranscript ? "chevron-up" : "chevron-down"}
              size={15} color="#f3f3f3" />
            <Text style={mobileExtras.voiceTranscriptLabel}>
              {language === "fr" ? "Voir la transcription" : "View transcript"}
            </Text>
          </Pressable>
          {showTranscript ? <Text selectable style={mobileExtras.voiceTranscriptText}>{text}</Text> : null}
        </>
      ) : null}
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
  voiceCardOuter: { maxWidth: 325, borderRadius: 20, backgroundColor: "#161616",
    padding: 11, alignSelf: "flex-end" },
  voiceBubble: { minHeight: 72, width: "100%", padding: 12, borderRadius: 16,
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", gap: 12 },
  voicePlay: { width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#222222", alignItems: "center", justifyContent: "center" },
  voiceMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  voiceMeta: { color: "#777", fontSize: 11 },
  waveBars: { height: 28, flexDirection: "row", alignItems: "center", gap: 2 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: "#5e6664" },
  voiceTranscriptButton: { flexDirection: "row", alignItems: "center", gap: 6,
    paddingTop: 12, paddingBottom: 6, paddingHorizontal: 3 },
  voiceTranscriptLabel: { color: "#eeeeee", fontSize: 12 },
  voiceTranscriptText: { color: "#eeeeee", lineHeight: 22, fontSize: 13,
    paddingTop: 8, paddingBottom: 10, paddingHorizontal: 4 },
  voicePlaybackError: { color: "#ffc4c4", fontSize: 11, paddingTop: 8 },
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


/* ============================================================
 * ORIA COURS — MOBILE iOS / ANDROID, SEGMENTS PRIVES
 * Contrat Backend/app/route/courses.py ; aucun debit avant devis confirme.
 * ============================================================ */
type CourseCapabilities = {
  pack_active: boolean;
  writing_models: string[];
  document_formats: string[];
  maximum_duration_ms: number;
  maximum_segment_duration_ms: number;
  maximum_segment_bytes: number;
  maximum_segments: number;
};
type CourseRecord = {
  id: string; title: string; document_format: "pdf" | "docx";
  status: string; submitted_duration_ms?: number | null;
  submitted_segment_count?: number | null;
};
type CourseSegment = { index: number; duration_ms: number; size_bytes: number; mime_type: string };
type CourseJob = {
  status: string; transcription_reservation_status?: string;
  document_reservation_status?: string; document_ready?: boolean;
  requires_manual_review?: boolean;
  awaiting_credits?: boolean;
  transcription_paid?: boolean;
  resume_available?: boolean;
  writing_reservation_required_credits?: number | null;
  next_action?: string;
};
type CourseQuote = {
  quote: { estimated_total_credits: number; maximum_reserved_credits: number;
    transcription_reservation_credits: number; document_reservation_credits: number;
    writing_model: string; duration_ms: number; segments: number;
    document_format: string; requires_confirmation: boolean; note?: string };
  quote_token: string; expires_at: string;
};
type CourseArtifact = {
  kind: "document" | "transcript"; id: string; filename: string;
  extension: string; size_bytes: number;
};
type PendingCourseSegment = {
  courseId: string; index: number; uri: string; filename: string;
  mimeType: string; size: number; durationMs: number;
};
const COURSE_SEGMENT_STOP_MS = 270_000; // < 300 000 ms serveur
const COURSE_MAX_DURATION_MS = 14_400_000;
const COURSE_MAX_BYTES = 20 * 1024 * 1024;
const COURSE_MIMES: Record<string, string> = {
  m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg",
  wav: "audio/wav", mp3: "audio/mpeg", aac: "audio/aac", "3gp": "audio/3gpp",
};
const COURSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const courseDraftKey = (id: string) => `oria_course_draft_v1_${id}`;
const courseHistoryKey = (id: string) => `oria_course_ids_v1_${id}`;
const coursePendingFile = (id: string) => new ExpoFile(Paths.document, `oria-course-${id}-pending.json`);
const courseClock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
};
const courseError = (cause: unknown) => cause instanceof Error ? cause.message : "Opération indisponible.";

async function readCoursePending(userId: string): Promise<PendingCourseSegment[]> {
  try {
    const file = coursePendingFile(userId);
    if (!file.exists) return [];
    const json = JSON.parse(await file.text()) as unknown;
    if (!Array.isArray(json)) return [];
    return json.filter((row): row is PendingCourseSegment => Boolean(
      row && typeof row === "object" &&
      COURSE_UUID_RE.test(String(row.courseId || "")) &&
      Number.isInteger(row.index) && row.index >= 0 && row.index < 120 &&
      typeof row.uri === "string" && row.uri.startsWith("file:") &&
      typeof row.filename === "string" && typeof row.mimeType === "string" &&
      typeof row.size === "number" && row.size > 0 && row.size <= COURSE_MAX_BYTES &&
      typeof row.durationMs === "number" && row.durationMs >= 0,
    ));
  } catch { return []; }
}
async function saveCoursePending(userId: string, rows: PendingCourseSegment[]) {
  coursePendingFile(userId).write(JSON.stringify(rows));
}
async function courseUploadMultipart(courseId: string, row: PendingCourseSegment): Promise<CourseSegment> {
  const session = await getSessionOrThrow();
  const file = new ExpoFile(row.uri);
  if (!file.exists || file.size <= 0 || file.size > COURSE_MAX_BYTES) {
    throw new Error("Fichier local manquant ou trop volumineux : vérifiez le segment enregistré.");
  }
  const multipart = new FormData();
  // Important: expo/fetch + ExpoFile : pas d'objet RN {uri,name,type}.
  multipart.append("file", file, row.filename);
  const response = await expoFetch(`${API_URL}/courses/${encodeURIComponent(courseId)}/segments/${row.index}`, {
    method: "PUT", headers: { "user-id": session.user.id,
      authorization: `Bearer ${session.access_token}` }, body: multipart,
  });
  const payload = await response.json().catch(() => null) as
    { detail?: unknown; segment?: CourseSegment } | null;
  if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : "Segment refusé par le serveur.");
  if (!payload?.segment || payload.segment.index !== row.index) {
    throw new Error("Confirmation du segment incohérente.");
  }
  return payload.segment;
}

function OriaCoursesMobilePanel({ language, wallet, userId, onClose, onWalletRefresh }: {
  language: OriaLanguage; wallet: WalletData | null; userId: string | null;
  onClose: () => void; onWalletRefresh: () => void;
}) {
  const isDark = useIsDarkTheme();
  const courseRouter = useRouter();
  const tr = (fr: string, en: string) => language === "en" ? en : fr;
  const bg = isDark ? "#101012" : "#ffffff";
  const card = isDark ? "#1b1b20" : "#f6f6f8";
  const ink = isDark ? "#f5f5f5" : "#17171b";
  const muted = isDark ? "#b4b4bd" : "#666671";
  const line = isDark ? "#3c3c44" : "#e4e4e8";
  const [capabilities, setCapabilities] = useState<CourseCapabilities | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [course, setCourse] = useState<CourseRecord | null>(null);
  const [segments, setSegments] = useState<CourseSegment[]>([]);
  const [job, setJob] = useState<CourseJob | null>(null);
  const writingModel = "luna"; // ORIA Cours uniquement ; Chat général inchangé.
  const [quote, setQuote] = useState<CourseQuote | null>(null);
  const [artifacts, setArtifacts] = useState<CourseArtifact[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUncertain, setConfirmUncertain] = useState(false);
  const [resumeUncertain, setResumeUncertain] = useState(false);
  const [loading, setLoading] = useState(true);
  const courseIdRef = useRef<string | null>(null);
  const nextIndexRef = useRef(0);
  const pendingRef = useRef<PendingCourseSegment[]>([]);
  const uploadLockRef = useRef(false);
  const uploadErrorRef = useRef(false);
  const segmentsRef = useRef<CourseSegment[]>([]);
  const recordLockRef = useRef(false);
  const recordingRef = useRef(false);
  const rollingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousMsRef = useRef(0);
  const recordingStartedRef = useRef(0);
  const liveRef = useRef(true);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderStatus = useAudioRecorderState(recorder);
  const [pendingCount, setPendingCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const blocked = Boolean(busy) || uploading || recording;
  const totalMs = segments.reduce((sum, segment) => sum + segment.duration_ms, 0);
  const hasQuote = Boolean(quote && Date.parse(quote.expires_at) > Date.now());
  const maxReserved = quote?.quote.maximum_reserved_credits || 0;
  const initialReserved = quote?.quote.transcription_reservation_credits ?? maxReserved;
  const awaitingCredits = job?.status === "awaiting_credits";
  const resumeRequired = job?.writing_reservation_required_credits;
  const resumeFunded = job?.document_reservation_status === "reserved" ||
    (typeof resumeRequired === "number" && resumeRequired > 0 &&
      (wallet?.balance ?? 0) >= resumeRequired);
  const isComplete = job?.status === "completed";
  const needsReview = job?.status === "reconciliation_required" || Boolean(job?.requires_manual_review);
  const working = job?.status === "processing" || job?.status === "queued";

  // Le retour ne doit pas interrompre un enregistrement ou abandonner un envoi.
  // Les segments sauvegardés et les cours confirmés restent récupérables après fermeture.
  const returnToChat = useCallback(() => {
    if (recordingRef.current || rollingRef.current || recording || uploading ||
        uploadLockRef.current || Boolean(busy)) {
      setNotice(language === "en"
        ? "Stop recording or wait for the upload to finish before returning to Chat."
        : "Terminez l'enregistrement ou l'envoi en cours avant de revenir au Chat.");
      return;
    }
    onClose();
  }, [recording, uploading, busy, language, onClose]);

  // Le bouton Retour Android suit la même règle que le bouton visible dans le panneau.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      returnToChat();
      return true;
    });
    return () => listener.remove();
  }, [returnToChat]);

  async function refreshCourse(cid: string, includeFiles = true) {
    const [result, parts] = await Promise.all([
      apiFetch<{ course: CourseRecord; job: CourseJob | null }>(`/courses/${encodeURIComponent(cid)}`),
      apiFetch<{ segments: CourseSegment[] }>(`/courses/${encodeURIComponent(cid)}/segments`),
    ]);
    if (!liveRef.current || cid !== courseIdRef.current) return;
    setCourse(result.course);
    setTitle(result.course.title);
    setFormat(result.course.document_format === "docx" ? "docx" : "pdf");
    setJob(result.job);
    const ordered = [...parts.segments].sort((a, b) => a.index - b.index);
    setSegments(ordered);
    segmentsRef.current = ordered;
    nextIndexRef.current = Math.max(nextIndexRef.current,
      ...ordered.map((part) => part.index + 1),
      ...pendingRef.current.filter((p) => p.courseId === cid).map((p) => p.index + 1), 0);
    if (includeFiles && result.job?.status === "completed") {
      const files = await apiFetch<{ ready: boolean; artifacts: CourseArtifact[] }>(
        `/courses/${encodeURIComponent(cid)}/artifacts`);
      if (liveRef.current && cid === courseIdRef.current) setArtifacts(files.ready ? files.artifacts : []);
    }
  }

  async function persistCourseId(cid: string) {
    courseIdRef.current = cid;
    if (!userId) return;
    await SecureStore.setItemAsync(courseDraftKey(userId), cid);
    const old = await SecureStore.getItemAsync(courseHistoryKey(userId));
    let ids: string[] = [];
    try { const data = JSON.parse(old || "[]"); if (Array.isArray(data)) ids = data.filter((x): x is string => typeof x === "string" && COURSE_UUID_RE.test(x)); }
    catch { /* Ignore an obsolete cache entry. */ }
    const updated = [cid, ...ids.filter((x) => x !== cid)].slice(0, 25);
    setRecent(updated);
    await SecureStore.setItemAsync(courseHistoryKey(userId), JSON.stringify(updated));
  }

  useEffect(() => {
    liveRef.current = true;
    let cancelled = false;
    (async () => {
      if (!userId) { setLoading(false); return; }
      try {
        const limits = await apiFetch<CourseCapabilities>("/courses/capabilities");
        if (cancelled) return;
        setCapabilities(limits);

        const pending = await readCoursePending(userId);
        pendingRef.current = pending;
        setPendingCount(pending.length);
        const saved = await SecureStore.getItemAsync(courseHistoryKey(userId));
        let ids: string[] = [];
        try { const rows = JSON.parse(saved || "[]");
          if (Array.isArray(rows)) ids = rows.filter((x): x is string => typeof x === "string" && COURSE_UUID_RE.test(x)).slice(0, 25);
        } catch { /* Local history is optional. */ }
        if (cancelled) return;
        setRecent(ids);
        // A saved segment takes precedence: never abandon it by opening another course.
        const draft = pending[0]?.courseId || await SecureStore.getItemAsync(courseDraftKey(userId));
        if (draft && COURSE_UUID_RE.test(draft)) {
          courseIdRef.current = draft;
          if (!ids.includes(draft)) setRecent([draft, ...ids].slice(0, 25));
          await refreshCourse(draft);
        }
      } catch (cause) { if (!cancelled) setError(courseError(cause)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; liveRef.current = false; };
  }, [userId]);

  useEffect(() => {
    if (!course?.id || !working) return;
    let active = true;
    const timer = setInterval(() => {
      if (active && AppState.currentState === "active" && !busy && !uploading) {
        void refreshCourse(course.id).catch((cause) => { if (active) setError(courseError(cause)); });
      }
    }, 7000);
    return () => { active = false; clearInterval(timer); };
  }, [course?.id, job?.status, busy, uploading]);

  async function createCourse() {
    if (blocked || !title.trim() || !capabilities?.pack_active || pendingRef.current.length) return;
    setBusy("create"); setError(null);
    try {
      const result = await apiFetch<{ course: CourseRecord }>("/courses", {
        method: "POST", body: JSON.stringify({ title: title.trim(), document_format: format }),
      });
      await persistCourseId(result.course.id);
      nextIndexRef.current = 0;
      previousMsRef.current = 0;
      setCourse(result.course); setSegments([]); segmentsRef.current = []; setArtifacts([]);
      setJob(null); setQuote(null); setConfirmUncertain(false); setResumeUncertain(false);
    } catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }
  async function selectCourse(cid: string) {
    if (blocked || pendingRef.current.length || recordingRef.current) return;
    setBusy("open"); setError(null); setQuote(null); setCourse(null); setSegments([]); segmentsRef.current = []; setJob(null); setArtifacts([]);
    setResumeUncertain(false); setConfirmUncertain(false);
    nextIndexRef.current = 0;
    try { await persistCourseId(cid); await refreshCourse(cid); setConfirmUncertain(false); }
    catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }
  async function savePending(rows: PendingCourseSegment[]) {
    pendingRef.current = rows;
    setPendingCount(rows.length);
    if (userId) await saveCoursePending(userId, rows);
  }
  async function removeFirstPending() {
    const item = pendingRef.current[0];
    if (!item) return;
    await savePending(pendingRef.current.slice(1));
    try {
      // Only remove our own persistent copy after the server confirmed it.
      const file = new ExpoFile(item.uri);
      if (file.exists && item.uri.includes("oria-course-recording-")) file.delete();
    } catch { /* Space cleanup is best-effort. */ }
  }
  async function uploadQueue() {
    if (uploadLockRef.current || !pendingRef.current.length) return;
    uploadLockRef.current = true; setUploading(true);
    try {
      while (pendingRef.current.length) {
        const item = pendingRef.current[0];
        let accepted: CourseSegment | undefined;
        try { accepted = await courseUploadMultipart(item.courseId, item); }
        catch (cause) {
          // A network timeout may happen AFTER the server inserted the segment.
          const data = await apiFetch<{ segments: CourseSegment[] }>(
            `/courses/${encodeURIComponent(item.courseId)}/segments`).catch(() => null);
          accepted = data?.segments.find((part) => part.index === item.index);
          if (!accepted) throw cause;
        }
        await removeFirstPending();
        const newSegments = [...segmentsRef.current.filter((x) => x.index !== accepted!.index), accepted!]
          .sort((a, b) => a.index - b.index);
        segmentsRef.current = newSegments;
        setSegments(newSegments);
        setQuote(null);
      }
      uploadErrorRef.current = false;
      setError(null);
    } catch (cause) {
      uploadErrorRef.current = true;
      setError(`${courseError(cause)} ${tr("Le segment est conservé sur l'appareil : réessayez l'envoi.",
        "The segment is saved on your phone: retry upload.")}`);
      // Stop ongoing recording if connection broke; don't accrue unbounded local audio.
      if (recordingRef.current) void stopRecording(false);
    } finally { uploadLockRef.current = false; setUploading(false); }
  }
  async function addAudioSegment(uri: string, filename: string, mimeType: string, durationMs = 0) {
    if (!courseIdRef.current || !userId) throw new Error("Créez d'abord un cours.");
    if (!course || course.status !== "uploading") throw new Error("Le cours n'accepte plus de segments.");
    const source = new ExpoFile(uri);
    const bytes = source.size;
    if (!source.exists || !bytes || bytes > Math.min(COURSE_MAX_BYTES, capabilities?.maximum_segment_bytes || COURSE_MAX_BYTES)) {
      throw new Error("Le segment audio doit être non vide et inférieur à 20 Mio.");
    }
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime = mimeType.split(";")[0].toLowerCase();
    const accepted = Object.values(COURSE_MIMES).includes(mime) && COURSE_MIMES[ext] === mime;
    if (!accepted) throw new Error("Format audio incompatible : M4A, MP3, WAV, OGG, WebM, AAC ou 3GP.");
    const index = nextIndexRef.current;
    if (index >= (capabilities?.maximum_segments || 120)) throw new Error("Nombre maximal de segments atteint.");
    const expected = segmentsRef.current.reduce((sum, x) => sum + x.duration_ms, 0) +
      pendingRef.current.reduce((sum, x) => sum + x.durationMs, 0) + durationMs;
    const expectedBytes = segmentsRef.current.reduce((sum, x) => sum + x.size_bytes, 0) +
      pendingRef.current.reduce((sum, x) => sum + x.size, 0) + bytes;
    if (expectedBytes > 512 * 1024 * 1024) throw new Error("Le cours dépasse la limite totale de 512 Mio.");
    if (expected > Math.min(COURSE_MAX_DURATION_MS, capabilities?.maximum_duration_ms || COURSE_MAX_DURATION_MS)) {
      throw new Error("La durée totale du cours dépasse quatre heures.");
    }
    // Recording chunks are already copied into Paths.document. Picker files remain
    // in picker cache until accepted; copy them into documents for offline retry.
    const dest = new ExpoFile(Paths.document, `oria-course-recording-${courseIdRef.current}-${index}.${ext}`);
    if (source.uri !== dest.uri) source.copy(dest);
    const storedUri = dest.uri;
    const item: PendingCourseSegment = { courseId: courseIdRef.current, index,
      uri: storedUri, filename: `oria-course-${index}.${ext}`, mimeType: mime,
      size: bytes, durationMs };
    await savePending([...pendingRef.current, item]);
    nextIndexRef.current = index + 1;
    setQuote(null);
    void uploadQueue();
  }
  async function chooseAudio() {
    if (!course || course.status !== "uploading" || blocked || pendingRef.current.length) return;
    setBusy("picker"); setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "audio/*",
        multiple: true, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      if (result.assets.length + nextIndexRef.current > (capabilities?.maximum_segments || 120)) {
        throw new Error("Trop de segments audio pour ce cours.");
      }
      for (const asset of result.assets) {
        const ext = asset.name.split(".").pop()?.toLowerCase() || "";
        const mime = COURSE_MIMES[ext];
        if (!mime) throw new Error(`Fichier non compatible : ${asset.name}.`);
        await addAudioSegment(asset.uri, asset.name, mime);
      }
    } catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }

  async function startRecording(continuation = false) {
    if (recordLockRef.current || recordingRef.current || !course || course.status !== "uploading"
        || busy || (!continuation && (pendingRef.current.length || uploading)) ||
        uploadErrorRef.current || !capabilities?.pack_active) return;
    const committedMs = segmentsRef.current.reduce((sum, x) => sum + x.duration_ms, 0) +
      pendingRef.current.reduce((sum, x) => sum + x.durationMs, 0);
    if (committedMs >= COURSE_MAX_DURATION_MS || nextIndexRef.current >= (capabilities.maximum_segments || 120)) {
      setError("Durée maximale ou nombre de segments atteint."); return;
    }
    recordLockRef.current = true;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Autorisez l'accès au microphone dans les réglages.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      previousMsRef.current = committedMs;
      recordingStartedRef.current = Date.now();
      recordingRef.current = true; setRecording(true); setElapsed(0); setError(null);
      recorder.record();
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => void stopRecording(true),
        Math.min(COURSE_SEGMENT_STOP_MS, Math.max(1000, COURSE_MAX_DURATION_MS - committedMs - 5000)));
    } catch (cause) { setError(courseError(cause)); recordingRef.current = false; setRecording(false); }
    finally { recordLockRef.current = false; }
  }
  async function stopRecording(continueWithNext: boolean) {
    if (!recordingRef.current || rollingRef.current) return;
    rollingRef.current = true;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const duration = Math.max(recorderStatus.durationMillis || 0, Date.now() - recordingStartedRef.current);
    recordingRef.current = false;
    setRecording(false);
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error("Enregistrement vide ou inaccessible.");
      const uri = recorder.uri;
      const ext = uri.split(".").pop()?.toLowerCase() || "m4a";
      const mime = COURSE_MIMES[ext];
      if (!mime) throw new Error("Format d'enregistrement non reconnu par le backend.");
      await addAudioSegment(uri, `cours.${ext}`, mime, duration);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      // Automatic continuation is safe only while the view is mounted, no upload
      // failure has been reported, and the next segment stays under 4 hours.
      const continueRecording = continueWithNext && liveRef.current &&
        AppState.currentState === "active" && !uploadErrorRef.current &&
        previousMsRef.current + duration < COURSE_MAX_DURATION_MS - 1000 &&
        nextIndexRef.current < (capabilities?.maximum_segments || 120);
      if (continueRecording) {
        // Queue upload is asynchronous; start the next native file independently.
        recordingRef.current = false;
        rollingRef.current = false;
        await startRecording(true);
        return;
      }
      setNotice(tr("Enregistrement terminé. Vérifiez que tous les segments sont envoyés.",
        "Recording stopped. Check that all segments were uploaded."));
    } catch (cause) { setError(courseError(cause)); }
    finally { rollingRef.current = false; }
  }
  // Expo records only while this screen is in the foreground. No hidden microphone.
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next !== "active" && recordingRef.current) void stopRecording(false);
    });
    return () => listener.remove();
  }, [recording]);
  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - recordingStartedRef.current) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [recording]);
  useEffect(() => {
    if (recording && recorderStatus.isRecording && recorderStatus.durationMillis >= COURSE_SEGMENT_STOP_MS) {
      void stopRecording(true);
    }
  }, [recording, recorderStatus.isRecording, recorderStatus.durationMillis]);
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    // If navigation destroys the panel, ensure the microphone is no longer active.
    if (recordingRef.current) void recorder.stop().catch(() => undefined);
  }, []);

  async function submitCourse() {
    if (!course || course.status !== "uploading" || blocked || pendingRef.current.length || !segments.length) return;
    setBusy("submit"); setError(null);
    try {
      const result = await apiFetch<{ course: CourseRecord }>(`/courses/${encodeURIComponent(course.id)}/submit`, { method: "POST" });
      setCourse(result.course); setQuote(null);
      setNotice(tr("Audio soumis. Calculez maintenant votre devis.", "Audio submitted. Request a quote."));
    } catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }
  async function requestQuote() {
    if (!course || course.status !== "queued" || busy || !writingModel || job) return;
    setBusy("quote"); setError(null); setQuote(null);
    try {
      const result = await apiFetch<CourseQuote>(`/courses/${encodeURIComponent(course.id)}/quote`, {
        method: "POST", body: JSON.stringify({ writing_model: writingModel }),
      });
      setQuote(result);
    } catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }
  async function confirmQuote() {
    if (!course || !quote || busy || confirmUncertain || !wallet?.is_pack_active ||
        wallet.balance < (quote.quote.transcription_reservation_credits ?? quote.quote.maximum_reserved_credits)) return;
    if (!Number.isFinite(Date.parse(quote.expires_at)) || Date.parse(quote.expires_at) <= Date.now()) {
      setQuote(null); setError("Devis expiré. Recalculez le montant."); return;
    }
    setBusy("confirm"); setError(null);
    try {
      const result = await apiFetch<{ status: string; message?: string }>(`/courses/${encodeURIComponent(course.id)}/confirm`, {
        method: "POST", body: JSON.stringify({ quote_token: quote.quote_token, approved: true }),
      });
      setQuote(null);
      setNotice(result.message || "Traitement accepté.");
      await refreshCourse(course.id);
      onWalletRefresh();
    } catch (cause) {
      // A timeout can occur AFTER a credit reservation was written. Never
      // retry automatically or silently release credits from the device.
      setConfirmUncertain(true);
      setError(`${courseError(cause)} ${tr("Vérifiez l'état du cours avant de confirmer à nouveau.",
        "Check course status before confirming again.")}`);
    } finally { setBusy(""); }
  }
  async function resumeCourse() {
    if (!course || !job || job.status !== "awaiting_credits" ||
        !job.resume_available || busy || resumeUncertain || !wallet?.is_pack_active) return;
    const alreadyReserved = job.document_reservation_status === "reserved";
    const required = job.writing_reservation_required_credits;
    if (!alreadyReserved && (typeof required !== "number" || required <= 0 || wallet.balance < required)) return;
    setBusy("resume"); setError(null);
    try {
      const result = await apiFetch<{ status: string; message?: string }>(
        `/courses/${encodeURIComponent(course.id)}/resume`,
        { method: "POST", body: JSON.stringify({ approved: true }) },
      );
      setNotice(result.message || tr("Reprise enregistrée.", "Resume submitted."));
      await refreshCourse(course.id);
      onWalletRefresh();
    } catch (cause) {
      // Toute erreur peut suivre une écriture SQL réussie : aucune répétition automatique.
      setResumeUncertain(true);
      setError(`${courseError(cause)} ${tr(
        "Actualisez le statut du cours avant toute nouvelle tentative.",
        "Refresh course status before trying again.")}`);
    } finally { setBusy(""); }
  }
  function confirmResume() {
    if (!job || !resumeFunded || resumeUncertain || busy) return;
    const required = job.writing_reservation_required_credits;
    const amount = typeof required === "number" ? formatCredits(required, language) : "—";
    Alert.alert(tr("Reprendre avec GPT-6 Luna", "Resume with GPT-6 Luna"),
      tr(`Réserver jusqu'à ${amount} crédits pour la rédaction uniquement ? La transcription déjà payée ne sera pas refacturée.`,
        `Reserve up to ${amount} credits for writing only? Your paid transcription will not be charged again.`),
      [{ text: tr("Annuler", "Cancel"), style: "cancel" },
       { text: tr("Confirmer", "Confirm"), onPress: () => void resumeCourse() }]);
  }
  async function verifyStatus() {
    if (!course || busy) return;
    setBusy("refresh"); setError(null);
    try {
      await refreshCourse(course.id);
      if (confirmUncertain || resumeUncertain) {
        const state = await apiFetch<{ job: CourseJob | null }>(`/courses/${encodeURIComponent(course.id)}`);
        if (state.job) { setConfirmUncertain(false); setResumeUncertain(false); }
        else setNotice(tr("Aucun job confirmé. En cas de réservation incertaine, contactez l'assistance avant de réessayer.",
          "No confirmed job. Contact support before retrying an uncertain reservation."));
      }
      onWalletRefresh();
    } catch (cause) { setError(courseError(cause)); }
    finally { setBusy(""); }
  }
  async function playSegment(index: number) {
    if (!course) return;
    try {
      const result = await apiFetch<{ playback_url: string }>(`/courses/${encodeURIComponent(course.id)}/segments/${index}/playback`);
      if (!result.playback_url?.startsWith("https://")) throw new Error("Lien privé indisponible.");
      await Linking.openURL(result.playback_url);
    } catch (cause) { setError(courseError(cause)); }
  }
  async function openArtifact(item: CourseArtifact) {
    setError(null);
    try {
      const result = await apiFetch<{ artifact: Record<string, unknown> }>(`/ai/artifacts/${encodeURIComponent(item.id)}`);
      const raw = result.artifact;
      const url = typeof raw?.download_url === "string" ? raw.download_url : raw?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Fichier privé non disponible.");
      await Linking.openURL(url);
    } catch (cause) { setError(courseError(cause)); }
  }
  const courseButton = (label: string, action: () => void, disabled = false, subtle = false) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
      style={[courseUi.button, { backgroundColor: subtle ? card : ink, borderColor: line, opacity: disabled ? .45 : 1 }]}>
      <Text style={[courseUi.buttonText, { color: subtle ? ink : bg }]}>{label}</Text>
    </Pressable>
  );
  const detail = (label: string, value: string) => (
    <View style={courseUi.detailRow}><Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: ink, fontSize: 13, fontWeight: "700" }}>{value}</Text></View>
  );

  return (
    <View style={[courseUi.screen, { backgroundColor: bg }]}>
      <View style={[courseUi.top, { borderBottomColor: line }]}>
        <Pressable accessibilityRole="button" onPress={returnToChat}
          style={[courseUi.back, { flexDirection: "row", alignItems: "center", gap: 5 }]}
          accessibilityLabel={tr("Retour au Chat", "Back to Chat")}>
          <Ionicons name="arrow-back" size={20} color={ink}/>
          <Text style={{ color: ink, fontSize: 12, fontWeight: "700" }}>
            {tr("Retour au Chat", "Back to Chat")}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }}><Text style={{ color: ink, fontWeight: "800", fontSize: 17 }}>ORIA Cours</Text>
          <Text style={{ color: muted, fontSize: 11 }}>{tr("Jusqu'à 4 h • PDF ou Word", "Up to 4 h • PDF or Word")}</Text></View>
        {Boolean(busy || uploading) && <ActivityIndicator color={ink} />}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={courseUi.content}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[courseUi.card, { backgroundColor: card, borderColor: line }]}>
          <Text style={{ color: ink, fontWeight: "700", fontSize: 15 }}>
            {tr("Votre professeur, clairement expliqué", "Your lecture, clearly explained")}
          </Text>
          <Text style={{ color: muted, lineHeight: 20, fontSize: 13, marginTop: 5 }}>
            {tr("Enregistrez ou importez des segments audio. ORIA prépare une transcription et un vrai document pédagogique, après votre accord sur le devis en crédits.",
              "Record or import audio segments. ORIA produces a transcript and structured notes after your credit quote approval.")}
          </Text>
        </View>
        {loading ? <ActivityIndicator color={ink}/> : null}
        {error ? <View style={[courseUi.note, { borderColor: "#b54444" }]}>
          <Text style={{ color: isDark ? "#ff9999" : "#b4232d" }}>{error}</Text></View> : null}
        {notice ? <View style={[courseUi.note, { borderColor: line }]}><Text style={{ color: ink }}>{notice}</Text></View> : null}
        {capabilities && !capabilities.pack_active ? (
          <Text style={{ color: muted, fontSize: 13 }}>
            {tr("Un pack actif est nécessaire. Aucun crédit n'est débité avant votre accord sur le devis.",
              "An active pack is required. Credits are not charged before quote approval.")}
          </Text>
        ) : null}
        {recent.length ? <View style={{ gap: 7 }}>
          <Text style={{ color: muted, fontSize: 12 }}>{tr("Cours récents", "Recent courses")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {recent.map((cid) => <Pressable key={cid}
              disabled={blocked || pendingCount > 0}
              onPress={() => void selectCourse(cid)}
              style={[courseUi.pill, { backgroundColor: course?.id === cid ? card : bg, borderColor: line }]}>
              <Text style={{ color: ink, fontSize: 12 }}>{tr("Cours", "Course")} {cid.slice(0, 8)}</Text>
            </Pressable>)}
          </ScrollView>
        </View> : null}
        {!course && !loading ? <View style={[courseUi.card, { backgroundColor: bg, borderColor: line }]}>
          <Text style={{ color: ink, fontWeight: "700" }}>{tr("Titre du cours", "Course title")}</Text>
          <TextInput value={title} maxLength={160} onChangeText={setTitle}
            placeholder={tr("Ex. Thermodynamique — transformations", "E.g. Thermodynamics")}
            placeholderTextColor={muted} style={[courseUi.input, { color: ink, borderColor: line }]}/>
          <Text style={{ color: ink, fontWeight: "700", marginTop: 9 }}>{tr("Format du document", "Document format")}</Text>
          <View style={courseUi.options}>{(["pdf", "docx"] as const).map((f) =>
            <Pressable key={f} onPress={() => setFormat(f)} style={[courseUi.option,
              { borderColor: f === format ? ink : line, backgroundColor: f === format ? card : bg }]}>
              <Text style={{ color: ink }}>{f === "pdf" ? "PDF" : "Word (.docx)"}</Text>
            </Pressable>)}</View>
          {courseButton(tr("Créer ce cours", "Create course"), () => void createCourse(),
            !title.trim() || !capabilities?.pack_active || Boolean(busy))}
        </View> : null}
        {course ? <View style={[courseUi.card, { backgroundColor: bg, borderColor: line }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, gap: 3 }}><Text style={{ color: ink, fontWeight: "800", fontSize: 16 }} numberOfLines={2}>{course.title}</Text>
              <Text style={{ color: muted, fontSize: 12 }}>{course.document_format.toUpperCase()} · {course.status} · {course.id.slice(0, 8)}</Text></View>
            <Pressable accessibilityRole="button" disabled={blocked || pendingCount > 0}
              onPress={() => {
                courseIdRef.current = null;
                nextIndexRef.current = 0;
                segmentsRef.current = [];
                setCourse(null); setSegments([]); setJob(null); setQuote(null); setArtifacts([]);
                setTitle(""); setError(null); setConfirmUncertain(false);
                if (userId) void SecureStore.deleteItemAsync(courseDraftKey(userId));
              }} style={[courseUi.pill, { borderColor: line, opacity: blocked || pendingCount ? .4 : 1 }]}>
              <Text style={{ color: ink, fontSize: 11 }}>{tr("Nouveau", "New")}</Text>
            </Pressable>
          </View>
          {detail(tr("Crédits disponibles", "Available credits"),
            formatCredits(wallet?.is_pack_active ? wallet.balance : 0, language))}
          {course.status === "uploading" ? <>
            {detail(tr("Durée des segments envoyés", "Uploaded audio duration"), courseClock(totalMs))}
            {detail(tr("Nombre de segments", "Segments"), `${segments.length} / ${capabilities?.maximum_segments || 120}`)}
            <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}>
              {tr("Chaque segment doit durer moins de cinq minutes et peser moins de 20 Mio. Les enregistrements sont envoyés sans transcription avant l'accord sur le devis.",
                "Each segment must be under five minutes and 20 MiB. Recording uploads do not start paid transcription before quote approval.")}
            </Text>
            {recording ? <View style={[courseUi.note, { borderColor: "#c53a48" }]}>
              <Text style={{ color: ink, fontWeight: "700" }}>
                🔴 {tr("Enregistrement", "Recording")} {courseClock(elapsed * 1000)}
              </Text><Text style={{ color: muted, fontSize: 12 }}>
                {tr("Découpage automatique toutes les 4 min 30 s.", "Auto-segments every 4 min 30 s.")}
              </Text></View> : null}
            <View style={courseUi.actionRow}>
              <View style={{ flex: 1 }}>
                {courseButton(recording ? tr("Arrêter", "Stop") : tr("Enregistrer", "Record"),
                  () => void (recording ? stopRecording(false) : startRecording()),
                  Boolean(busy) || (uploading && !recording) || (!recording && pendingCount > 0))}
              </View>
              <View style={{ flex: 1 }}>
                {courseButton(tr("Importer audio", "Import audio"), () => void chooseAudio(),
                  Boolean(busy) || recording || uploading || pendingCount > 0, true)}
              </View>
            </View>
            {pendingCount > 0 || uploading ? <View style={[courseUi.note, { borderColor: line }]}>
              <Text style={{ color: ink }}>{tr("Segments conservés sur l'appareil", "Segments saved on device")}: {pendingCount}</Text>
              <Text style={{ color: muted, fontSize: 12 }}>{tr("Ils ne sont pas comptés comme envoyés avant confirmation du serveur.",
                "They are not considered uploaded until the server confirms them.")}</Text>
              {courseButton(tr("Réessayer l'envoi", "Retry upload"), () => void uploadQueue(), uploading || recording || Boolean(busy), true)}
            </View> : null}
            {segments.map((part) => <View key={part.index} style={[courseUi.detailRow, { borderTopWidth: 1, borderTopColor: line }]}>
              <Text style={{ color: ink, fontSize: 12 }}>#{part.index + 1} · {courseClock(part.duration_ms)} · {(part.size_bytes / 1024 / 1024).toFixed(1)} Mio</Text>
              <Pressable onPress={() => void playSegment(part.index)}><Ionicons name="play-circle-outline" size={24} color={ink}/></Pressable>
            </View>)}
            {courseButton(tr("Terminer l'envoi audio", "Finish audio upload"), () => void submitCourse(),
              blocked || pendingCount > 0 || !segments.length || totalMs > COURSE_MAX_DURATION_MS)}
          </> : null}
          {course.status === "queued" && !job ? <>
            <View style={[courseUi.note, { borderColor: line, marginTop: 12 }]}>
              <Text style={{ color: ink, fontWeight: "700" }}>{tr("Modèle de rédaction pédagogique", "Pedagogical writing model")}</Text>
              <Text style={{ color: ink, fontWeight: "700", marginTop: 6 }}>GPT-6 Luna</Text>
              <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>
                {tr("Disponible pour ORIA Cours dans tous les packs actifs. Pour approfondir un sujet, importez votre document dans le Chat général avec un modèle autorisé par votre pack.",
                  "Available for ORIA Cours on every active pack. To explore a topic further, upload the document to general Chat using a model allowed by your pack.")}
              </Text>
            </View>
            {courseButton(tr("Calculer les crédits nécessaires", "Estimate credits"), () => void requestQuote(), !capabilities?.pack_active || !capabilities.writing_models.includes(writingModel) || Boolean(busy), true)}
            {quote ? <View style={[courseUi.card, { backgroundColor: card, borderColor: line, marginTop: 12 }]}>
              {detail(tr("Crédits estimés", "Estimated credits"), formatCredits(quote.quote.estimated_total_credits, language))}
              {detail(tr("Réservation initiale · transcription", "Initial reservation · transcription"), formatCredits(initialReserved, language))}
              {detail(tr("Réservation suivante · Luna", "Later reservation · Luna"), formatCredits(quote.quote.document_reservation_credits ?? 0, language))}
              <Text style={{ color: muted, fontSize: 12 }}>
                {tr("Réservations successives, jamais simultanées. Le coût audio est réglé avant la provision Luna. Si les crédits manquent, la transcription est conservée. Seul le coût réel est facturé.",
                  "Sequential, never simultaneous reservations. Audio settles before Luna is reserved. If credits run out, the transcript is kept. Only actual cost is charged.")}
              </Text>
              <Text style={{ color: muted, fontSize: 12 }}>
                {tr("Expiration", "Expires")}: {new Date(quote.expires_at).toLocaleTimeString(language === "en" ? "en-US" : "fr-FR")}
              </Text>
              {!hasQuote ? <Text style={{ color: "#ba2d3c" }}>{tr("Devis expiré, recalcul requis.", "Quote expired, request another.")}</Text> : null}
              {wallet && wallet.balance < initialReserved ? <Text style={{ color: "#ba2d3c" }}>
                {tr("Crédits insuffisants pour cette réservation.", "Insufficient credits for this reservation.")}</Text> : null}
              {courseButton(tr("J'accepte le devis et autorise le traitement", "Accept quote and authorize processing"),
                () => Alert.alert(tr("Confirmer la réservation", "Confirm reservation"),
                  tr(`ORIA réservera initialement jusqu'à ${formatCredits(initialReserved, language)} crédits pour la transcription. La rédaction Luna sera réservée ensuite. Continuer ?`,
                    `ORIA will initially reserve up to ${formatCredits(initialReserved, language)} credits for transcription. Luna writing is reserved later. Continue?`),
                  [{ text: tr("Annuler", "Cancel"), style: "cancel" },
                    { text: tr("Confirmer", "Confirm"), onPress: () => void confirmQuote() }]),
                !hasQuote || confirmUncertain || Boolean(busy) || !wallet?.is_pack_active || wallet.balance < initialReserved)}
            </View> : null}
          </> : null}
          {awaitingCredits ? <View style={[courseUi.card, { backgroundColor: card, borderColor: line, marginTop: 12, gap: 9 }] }>
            <Text style={{ color: ink, fontWeight: "800", fontSize: 15 }}>{tr("Cours en attente de crédits", "Course waiting for credits")}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>{tr(
              "La transcription est déjà terminée et payée. Elle reste disponible pour la reprise : aucun nouvel enregistrement ni deuxième facturation audio.",
              "Transcription is complete and paid. It is saved for resuming: no need to record or pay for audio again.")}</Text>
            {typeof resumeRequired === "number" && resumeRequired > 0 ?
              detail(tr("Réservation pour Luna", "Luna reservation"), formatCredits(resumeRequired, language)) : null}
            {detail(tr("Crédits disponibles", "Available credits"), formatCredits(wallet?.balance ?? 0, language))}
            {!resumeFunded ? <Text style={{ color: muted, fontSize: 12 }}>{tr(
              "Rechargez votre solde puis revenez à ce cours. Ce montant est une provision, pas un débit définitif.",
              "Top up and return to this course. This amount is a reservation, not a final charge.")}</Text> : null}
            {courseButton(tr("Voir mes crédits / Recharger", "Credits / Top up"),
              () => courseRouter.push("/credits" as any), Boolean(busy), true)}
            {courseButton(tr("Actualiser le solde et le statut", "Refresh balance and status"),
              () => void verifyStatus(), Boolean(busy), true)}
            {resumeUncertain ? <Text style={{ color: "#b54444", fontSize: 12 }}>{tr(
              "Reprise non confirmée : actualisez le statut avant de réessayer.",
              "Resume not confirmed: refresh status before retrying.")}</Text> : null}
            {courseButton(busy === "resume" ? tr("Reprise…", "Resuming…") : tr("Reprendre la rédaction avec Luna", "Resume writing with Luna"),
              () => confirmResume(), Boolean(busy) || resumeUncertain || !job?.resume_available ||
                !wallet?.is_pack_active || !resumeFunded)}
          </View> : null}
          {working || isComplete || needsReview || confirmUncertain ? <View style={[courseUi.card, { backgroundColor: card, borderColor: line, marginTop: 12 }]}>
            <Text style={{ color: ink, fontWeight: "700" }}>{isComplete ? tr("Cours terminé", "Course completed") :
              needsReview ? tr("Vérification manuelle", "Manual review") : tr("Traitement en cours", "Processing")}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>
              {tr("Transcription", "Transcription")}: {job?.transcription_reservation_status || "—"} · {tr("Document", "Document")}: {job?.document_reservation_status || "—"}
            </Text>
            {needsReview || confirmUncertain ? <Text style={{ color: "#b54444", fontSize: 12 }}>
              {tr("Ne relancez pas la confirmation : une opération peut déjà être facturée. Actualisez le statut.",
                "Do not reconfirm: a provider call may already have been billed. Refresh the status.")}
            </Text> : null}
            {courseButton(tr("Actualiser le statut", "Refresh status"), () => void verifyStatus(), Boolean(busy), true)}
          </View> : null}
          {isComplete ? <View style={[courseUi.card, { backgroundColor: card, borderColor: line, marginTop: 12 }]}>
            <Text style={{ color: ink, fontWeight: "700" }}>{tr("Documents privés", "Private files")}</Text>
            {artifacts.length === 0 ? courseButton(tr("Charger les documents", "Load documents"), () => void verifyStatus(), Boolean(busy), true) : null}
            {artifacts.map((item) => <View key={item.id} style={courseUi.detailRow}>
              <View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 13 }}>{item.filename}</Text>
                <Text style={{ color: muted, fontSize: 11 }}>{item.kind === "transcript" ? tr("Transcription", "Transcript") : tr("Cours rédigé", "Structured notes")}</Text></View>
              <Pressable accessibilityRole="button" onPress={() => void openArtifact(item)} style={[courseUi.pill, { borderColor: line }]}>
                <Ionicons name="open-outline" size={21} color={ink}/>
              </Pressable>
            </View>)}
          </View> : null}
        </View> : null}
        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
const courseUi = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", gap: 10,
    alignItems: "center", borderBottomWidth: 1 },
  back: { padding: 6 }, content: { padding: 16, gap: 14 },
  card: { padding: 15, borderRadius: 17, borderWidth: 1, gap: 10 },
  input: { paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderRadius: 10, marginTop: 8 },
  options: { flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 10 },
  option: { borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10, borderWidth: 1 },
  button: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 11, borderWidth: 1,
    alignItems: "center", justifyContent: "center", minHeight: 46 },
  buttonText: { fontWeight: "700", fontSize: 13, textAlign: "center" },
  pill: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  note: { borderRadius: 13, borderWidth: 1, padding: 12, gap: 8 },
  detailRow: { paddingVertical: 8, flexDirection: "row", gap: 10, justifyContent: "space-between", alignItems: "center" },
  actionRow: { flexDirection: "row", gap: 9, marginVertical: 8 },
});

export default function ChatPage() {
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // L'utilisateur peut lire l'historique sans que le streaming lui reprenne le scroll.
  const isNearLatestRef = useRef(true);
  const isUserScrollingRef = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [theme, setTheme] = useState<OriaTheme>("light");
  const isDark = theme === "dark";
  const styles = useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
  const t = CHAT_TEXT[language];

  // Expo Router SDK 58 n'émet plus beforeRemove.
  // Le Chat est la racine authentifiée : bloquer seulement les retours
  // qui dépileraient cette page. Les remplacements/redirections explicites
  // (notamment la déconnexion) restent autorisés via repeat().
  usePreventRemove(true, ({ data, repeat }) => {
    const actionType = data.action.type;
    if (actionType === "GO_BACK" || actionType === "POP" || actionType === "POP_TO_TOP") {
      return;
    }
    repeat();
  });

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

  // Rattacher l'ID optimiste du message à son véritable ID Supabase.
  // Sans cela, l'édition immédiate après la réponse aboutit à un 404.
  const persistedUserMessageIdsRef = useRef<Record<string, string>>({});
  const [editingCompletedId, setEditingCompletedId] = useState<string | null>(null);
  const [completedEditDraft, setCompletedEditDraft] = useState("");
  const [completedEditOriginal, setCompletedEditOriginal] = useState("");
  const [completedEditBaseRevision, setCompletedEditBaseRevision] = useState(0);
  const [completedEditFiles, setCompletedEditFiles] = useState<ChatAttachment[]>([]);
  const [completedEditOpening, setCompletedEditOpening] = useState(false);
  const [completedEditBusy, setCompletedEditBusy] = useState(false);
  const [completedEditError, setCompletedEditError] = useState<string | null>(null);
  const completedEditSubmittingRef = useRef(false);

  const [message, setMessage] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  // La hauteur est mesurée par un <Text> indépendant : jamais par le TextInput redimensionné.
  // Ainsi, la saisie ne provoque aucune boucle onContentSizeChange -> height -> onContentSizeChange.
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [chatStatusStep, setChatStatusStep] =
    useState<OriaChatStatusStep | null>(null);
  // Empêche un assistant vide d'apparaître pendant la préparation. Sa
  // réponse réapparaît dès le premier vrai fragment de texte.
  const activeStreamingAssistantIdRef = useRef<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);
  // Vue d'accueil uniquement : ne pas effacer la conversation sauvegardée.
  const [showReturnWelcome, setShowReturnWelcome] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const backgroundAtRef = useRef<number | null>(null);
  const backgroundWriteRef = useRef<Promise<void> | null>(null);
  const chatScreenFocusedRef = useRef(false);
  const chatViewActionRef = useRef(0);
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
          !coursesOpen &&
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
    [drawerVisible, coursesOpen, drawerTranslateX, drawerWidth, openDrawer],
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

  const [generatedMedia, setGeneratedMedia] =
    useState<GeneratedMedia[]>([]);
  const [generatedArtifacts, setGeneratedArtifacts] =
    useState<GeneratedArtifact[]>([]);
  // Le Studio est une interface indépendante, mais le Chat conserve les medias historiques.
  const [miniStudioOpen, setMiniStudioOpen] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [localVoiceDraft, setLocalVoiceDraft] = useState<LocalVoiceDraft | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [codePreview, setCodePreview] = useState<CodePreviewData | null>(null);
  const [wordPreview, setWordPreview] = useState<WordPreviewData | null>(null);
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<SpreadsheetPreviewData | null>(null);
  const [spreadsheetSheetIndex, setSpreadsheetSheetIndex] = useState(0);
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const audioBusyRef = useRef(false);
  const stoppingRecordingRef = useRef(false);
  const availableModels = useMemo(
    () => getSelectableModels(wallet?.pack_id ?? null, trials),
    [wallet?.pack_id, trials],
  );

  const hasActivePack = wallet?.is_pack_active === true;

  // Comme sur le Web, le solde affiché représente uniquement les crédits
  // réellement utilisables. Un ancien solde peut rester dans la base, mais
  // un pack expiré/inactif doit apparaître à 0 dans l'interface mobile.
  const availableBalance = wallet?.is_pack_active ? wallet.balance : 0;

  // Conditions à respecter avant un retour à l'accueil : aucune saisie,
  // génération, création ou note vocale ne doit être interrompue.
  const mobileReturnGuardRef = useRef(false);
  mobileReturnGuardRef.current = Boolean(
    !isInitialized || !activeConversationId ||
    isThinking || activeGenerationId || isApplyingModification ||
    editingCompletedId !== null || completedEditBusy || completedEditOpening ||
    message.trim() || attachments.length ||
    voiceDraft || localVoiceDraft || voiceUploading ||
    audioBusyRef.current || stoppingRecordingRef.current ||
    recorderState.isRecording || miniStudioOpen ||
    coursesOpen || drawerVisible || codePreview || wordPreview || artifactBusyId ||
    modificationPanelOpen
  );

  useFocusEffect(useCallback(() => {
    chatScreenFocusedRef.current = true;
    return () => { chatScreenFocusedRef.current = false; };
  }, []));

  // Une vraie transition de l'application vers l'arrière-plan déclenche le
  // compteur. Pas de minuterie active : une suspension de l'app n'efface rien.
  useEffect(() => {
    if (Platform.OS === "web" || !currentUserId) return;
    let disposed = false;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "inactive" || nextState === "background") {
        if (previous === "active" && backgroundAtRef.current === null) {
          const at = Date.now();
          backgroundAtRef.current = at;
          backgroundWriteRef.current = writeMobileBackgroundAt(currentUserId, at);
        }
        return;
      }

      if (nextState === "active" && previous !== "active") {
        const localAwayAt = backgroundAtRef.current;
        backgroundAtRef.current = null;
        const expectedAction = chatViewActionRef.current;
        void (async () => {
          // La transition inactive -> active peut être rapide : attendre la
          // sauvegarde pour éviter un ancien horodatage après le nettoyage.
          if (backgroundWriteRef.current) {
            await backgroundWriteRef.current;
            backgroundWriteRef.current = null;
          }
          const storedAwayAt = localAwayAt ??
            await readMobileBackgroundAt(currentUserId);
          // Ne jamais laisser un ancien horodatage provoquer un retour
          // inattendu à l'accueil pendant une session active.
          await clearMobileBackgroundAt(currentUserId);
          if (!disposed &&
              expectedAction === chatViewActionRef.current &&
              chatScreenFocusedRef.current &&
              !mobileReturnGuardRef.current &&
              shouldShowMobileReturnHome(storedAwayAt, Date.now())) {
            Keyboard.dismiss();
            setShowReturnWelcome(true);
          }
        })();
      }
    });
    return () => { disposed = true; subscription.remove(); };
  }, [currentUserId]);

  // Web and the App Store build share one cloud history. Re-read it on resume,
  // without resending any paid Chat request or touching a draft recording.
  useEffect(() => {
    if (!isInitialized || !currentUserId || isThinking || voiceDraft || localVoiceDraft || voiceUploading || recorderState.isRecording) return;
    let running = false;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || running) return;
      running = true;
      void (async () => {
        try {
          await loadConversations(await readLocalCache(currentUserId));
          if (activeConversationId) await selectConversation(activeConversationId);
        } finally { running = false; }
      })().catch((error) => console.warn("ORIA sync on resume unavailable", error));
    });
    return () => subscription.remove();
  }, [isInitialized, currentUserId, activeConversationId, isThinking,
      voiceDraft, localVoiceDraft, voiceUploading, recorderState.isRecording]);

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

        // Démarrage après fermeture complète : la date de dernier passage
        // en arrière-plan est conservée indépendamment du cache de messages.
        const [cache, storedAwayAt, persistedVoiceDraftId] = await Promise.all([
          readLocalCache(userId),
          readMobileBackgroundAt(userId),
          readVoiceDraftId(userId).catch(() => null),
        ]);
        if (cancelled) return;
        if (
          Platform.OS !== "web" &&
          cache?.activeConversationId &&
          !persistedVoiceDraftId &&
          shouldShowMobileReturnHome(storedAwayAt, Date.now())
        ) {
          setShowReturnWelcome(true);
        }
        // Pas de suppression de l'historique ; l'horodatage ne concerne
        // que le prochain retour à l'application.
        await clearMobileBackgroundAt(userId);
        if (cancelled) return;
        setCurrentUserId(userId);

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
        if (cache?.activeConversationId && !cancelled) {
          await selectConversation(cache.activeConversationId);
        }
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

  const handleListScroll = useCallback((contentHeight: number, viewportHeight: number, scrollY: number) => {
    const distance = Math.max(0, contentHeight - viewportHeight - scrollY);
    isNearLatestRef.current = distance <= 160;
    const shouldShow = distance > 160;
    setShowJumpToLatest((previous) => previous === shouldShow ? previous : shouldShow);
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    isUserScrollingRef.current = false;
    isNearLatestRef.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Ne suivre les réponses entrantes que si l'utilisateur est déjà près du bas.
  useEffect(() => {
    if (!messages.length || !isNearLatestRef.current) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, isThinking]);

  // Une autre conversation s'ouvre à son dernier message, sans héritage du scroll précédent.
  useEffect(() => {
    isNearLatestRef.current = true;
    isUserScrollingRef.current = false;
    setShowJumpToLatest(false);
  }, [activeConversationId]);

  // À l'ouverture/fermeture du clavier, ne PAS redimensionner le composer.
  // Écouter les événements DID évite les allers-retours pendant l'animation iOS.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

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
      }>("/ai/artifacts?limit=100");

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
    const startingFromWelcome = showReturnWelcome;
    let conversationId = startingFromWelcome ? null : activeConversationId;
    try {
      // Le lien conversation est obligatoire pour que l'audio puisse être
      // rattaché au futur message sans mélange entre conversations.
      if (!conversationId) {
        const remote = await createConversationRemote("Nouvelle conversation");
        conversationId = remote.id;
        if (startingFromWelcome) {
          chatViewActionRef.current += 1;
          setShowReturnWelcome(false);
          setMessages([]);
        }
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
    // For native Expo, request a *playable M4A* from the authenticated backend.
    // Older web uploads are often WebM/Opus: Safari/iOS native playback cannot
    // reliably decode them even if a Supabase signed URL is valid.
    if (Platform.OS !== "web") {
      const session = await getSessionOrThrow();
      const path = `/ai/audio/${encodeURIComponent(audioId)}/playback-compatible`;
      const response = await expoFetch(`${API_URL}${path}`, {
        method: "GET",
        headers: {
          "user-id": session.user.id,
          authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {detail?: string} | null;
        const detail = typeof payload?.detail === "string" ? payload.detail : "";
        if (response.status === 401) throw new Error("Session expirée. Reconnectez-vous à ORIA.");
        if (response.status === 404 && !detail) {
          throw new Error("Route audio compatible non installée sur le backend. Déployez le fichier ai.py corrigé.");
        }
        throw new Error(`Lecture vocale (HTTP ${response.status}) : ${detail || "service indisponible"}`);
      }
      const declaredSize = Number(response.headers.get("content-length") || 0);
      const MAX_PLAYBACK_BYTES = 20 * 1024 * 1024;
      if (declaredSize > MAX_PLAYBACK_BYTES) throw new Error("Vocal trop volumineux pour l'écoute.");
      const bytes = await response.bytes();
      if (!bytes.byteLength || bytes.byteLength > MAX_PLAYBACK_BYTES) {
        throw new Error("Le serveur a envoyé un fichier audio vide ou trop volumineux.");
      }
      // An authenticated response is stored only in Expo's private cache.
      // A fresh temporary filename avoids conflicting with an active player.
      const safeId = audioId.replace(/[^a-fA-F0-9-]/g, "").slice(0, 64);
      const target = new ExpoFile(Paths.cache, `oria-voice-${safeId}-${Date.now()}.m4a`);
      await target.write(bytes);
      if (!target.exists || target.size <= 0) throw new Error("Écriture du vocal impossible sur l'appareil.");
      return target.uri;
    }
    const result = await apiFetch<Record<string, unknown>>(`/ai/audio/${encodeURIComponent(audioId)}`);
    const metadata = normalizeVoiceNote(result);
    if (metadata) setVoiceNotes((current) => mergeVoiceNotes(current, [metadata]));
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
      // Relancer l'IA pour un vocal déjà sauvegardé pourrait débiter deux fois.
      // Sur un retry, ne synchroniser que son affichage depuis le cloud.
      if (mode === "voice") {
        const storedRaw = await apiFetch<Record<string, unknown>>(`/ai/audio/${encodeURIComponent(draft.audio_id)}`);
        const stored = normalizeVoiceNote(storedRaw);
        if (stored?.message_id) {
          setVoiceNotes((current) => mergeVoiceNotes(current, [stored]));
          if (currentUserId) await writeVoiceDraftId(currentUserId, null);
          setVoiceDraft(null);
          if (activeConversationId) await selectConversation(activeConversationId);
          return;
        }
      }
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
        `/ai/artifacts/${encodeURIComponent(artifact.id)}`);
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

    return generatedArtifacts.filter((artifact) =>
      artifact.messageId === item.id || artifact.source_message_id === item.id,
    );
  }

  // Accès privé : ne jamais se fier à une URL mise en cache, qui peut expirer.
  async function refreshArtifactAccess(artifact: GeneratedArtifact): Promise<GeneratedArtifact> {
    const response = await apiFetch<{ artifact?: Record<string, unknown> }>(
      `/ai/artifacts/${encodeURIComponent(artifact.id)}`,
    );
    const renewed = response.artifact
      ? normalizeGeneratedArtifact(response.artifact, artifact.messageId)
      : null;
    if (!renewed) throw new Error(language === "fr" ? "Fichier introuvable." : "File not found.");
    setGeneratedArtifacts((current) => mergeGeneratedArtifacts(current, [renewed]));
    return renewed;
  }

  // Écriture dans l'espace privé de l'app : aucun lien public créé.
  async function saveArtifactLocally(
    artifact: GeneratedArtifact,
    signedUrl: string,
  ): Promise<ExpoFile> {
    const safeUrl = safePrivateArtifactUrl(signedUrl);
    if (!safeUrl) throw new Error(language === "fr" ? "Lien privé invalide." : "Invalid private URL.");
    if (Platform.OS === "web") {
      throw new Error("Le téléchargement Web utilise directement le navigateur.");
    }
    const dest = new ExpoFile(Paths.document, safeLocalArtifactFilename(artifact));
    // Téléchargement natif, sans charger jusqu'à 50 Mo sur le fil JS.
    const file = await ExpoFile.downloadFileAsync(safeUrl, dest, { idempotent: true });
    if (!file.exists || file.size <= 0 || file.size > 50 * 1024 * 1024 ||
      (artifact.sizeBytes > 0 && file.size !== artifact.sizeBytes)) {
      throw new Error(language === "fr" ? "Le fichier reçu est incomplet ou invalide." : "Downloaded file is incomplete or invalid.");
    }
    return file;
  }

  // Quick Look iOS / application installée Android (selon SDK Expo).
  async function previewLocalArtifact(
    file: ExpoFile,
    artifact: GeneratedArtifact,
    fallbackUrl?: string | null,
  ): Promise<void> {
    // Détection de méthode : certaines versions d'expo-file-system
    // n'exposent pas encore File.preview / File.canPreview.
    const previewFile = file as ExpoFile & {
      canPreview?: (options?: { mimeType?: string }) => Promise<boolean>;
      preview?: (options?: { title?: string; mimeType?: string }) => Promise<void>;
    };
    if (typeof previewFile.canPreview === "function" &&
        typeof previewFile.preview === "function") {
      const canPreview = await previewFile.canPreview({ mimeType: artifact.mimeType.split(";")[0] });
      if (canPreview) {
        await previewFile.preview({ title: artifact.filename, mimeType: artifact.mimeType.split(";")[0] });
        return;
      }
    }
    // Fallback explicite : ouvrir l'URL privée temporaire dans une application
    // externe si le lecteur natif n'est pas disponible sur cet appareil.
    const url = safePrivateArtifactUrl(fallbackUrl);
    if (url && await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
    throw new Error(language === "fr"
      ? "Fichier conservé dans ORIA, mais aucun lecteur compatible n'est disponible."
      : "File saved in ORIA, but no compatible viewer is available.");
  }

  async function downloadArtifact(artifact: GeneratedArtifact): Promise<void> {
    if (artifactBusyId) return;
    setArtifactBusyId(artifact.id);
    try {
      const renewed = await refreshArtifactAccess(artifact);
      const url = safePrivateArtifactUrl(renewed.downloadUrl);
      if (!url) throw new Error(language === "fr"
        ? "Lien de téléchargement indisponible. Réessayez."
        : "Download link unavailable. Please retry.");
      if (Platform.OS === "web") {
        await Linking.openURL(url);
        return;
      }
      const file = await saveArtifactLocally(renewed, url);
      Alert.alert(
        language === "fr" ? "Document enregistré" : "File saved",
        language === "fr"
          ? "Le fichier est enregistré dans les documents privés d'ORIA. Ouvre-le pour le consulter ou l'exporter vers une autre application."
          : "Saved in ORIA's private documents. Open it to view or export it to another app.",
        [
          { text: "OK", style: "cancel" },
          { text: language === "fr" ? "Ouvrir" : "Open", onPress: () => {
            void previewLocalArtifact(file, renewed, renewed.previewUrl || renewed.downloadUrl)
              .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
          } },
        ],
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : language === "fr"
        ? "Téléchargement impossible." : "Download failed.");
    } finally {
      setArtifactBusyId(null);
    }
  }

  async function openWordPreview(artifact: GeneratedArtifact): Promise<void> {
    if (artifact.extension.toLowerCase() !== "docx" || artifactBusyId) return;
    setArtifactBusyId(artifact.id);
    try {
      const result = await apiFetch<{
        success: boolean; filename: string; artifact_id: string;
        blocks: WordPreviewBlock[]; truncated: boolean; image_count: number;
      }>(`/ai/artifacts/${encodeURIComponent(artifact.id)}/document-preview`);
      if (!result.success || !Array.isArray(result.blocks)) {
        throw new Error(language === "fr" ? "Aperçu Word indisponible." : "Word preview unavailable.");
      }
      setWordPreview({ id: artifact.id, filename: result.filename || artifact.filename,
        blocks: result.blocks, truncated: result.truncated, image_count: result.image_count });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :
        language === "fr" ? "Lecture du document Word impossible." : "Unable to preview Word document.");
    } finally { setArtifactBusyId(null); }
  }

  async function openSpreadsheetPreview(artifact: GeneratedArtifact): Promise<void> {
    if (artifact.extension.toLowerCase() !== "xlsx" || artifactBusyId) return;
    setArtifactBusyId(artifact.id);
    try {
      const result = await apiFetch<{
        success: boolean; filename: string; artifact_id: string;
        sheets: SpreadsheetPreviewSheet[]; truncated: boolean;
      }>(`/ai/artifacts/${encodeURIComponent(artifact.id)}/spreadsheet-preview`);
      if (!result.success || !Array.isArray(result.sheets)) {
        throw new Error(language === "fr" ? "Aperçu Excel indisponible." : "Spreadsheet preview unavailable.");
      }
      setSpreadsheetSheetIndex(0);
      setSpreadsheetPreview({id: artifact.id, filename: result.filename || artifact.filename,
        sheets: result.sheets, truncated: result.truncated});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :
        language === "fr" ? "Lecture du classeur impossible." : "Unable to read spreadsheet.");
    } finally { setArtifactBusyId(null); }
  }

  async function openArtifactPreview(artifact: GeneratedArtifact): Promise<void> {
    if (artifact.extension.toLowerCase() !== "pdf" || artifactBusyId) return;
    setArtifactBusyId(artifact.id);
    try {
      const renewed = await refreshArtifactAccess(artifact);
      const previewUrl = safePrivateArtifactUrl(renewed.previewUrl);
      if (!previewUrl) {
        throw new Error(CHAT_TEXT[language].documentUnavailable);
      }
      if (Platform.OS === "web") {
        await Linking.openURL(previewUrl);
        return;
      }
      const file = await saveArtifactLocally(renewed, previewUrl);
      await previewLocalArtifact(file, renewed, previewUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : CHAT_TEXT[language].documentUnavailable);
    } finally {
      setArtifactBusyId(null);
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

  async function createConversation() {
    chatViewActionRef.current += 1;
    setShowReturnWelcome(false);
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
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
    if (completedEditSubmittingRef.current) {
      // Une régénération peut être facturée ; elle poursuit côté serveur.
      // La vue ne basculera pas silencieusement pendant l'attente.
      return;
    }
    setEditingCompletedId(null);
    setCompletedEditFiles([]);
    setCompletedEditError(null);
    chatViewActionRef.current += 1;
    const readEpoch = chatViewActionRef.current;
    setShowReturnWelcome(false);
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

      if (readEpoch !== chatViewActionRef.current) return;
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

      // A local-only message must not be erased when the server has no copy.
      // A future idempotent outbox will reconcile it without charging again.
      const localOnly = currentUserId
        ? (await readLocalCache(currentUserId))?.messages[conversationId] || [] : [];
      if (remote.length === 0 && localOnly.length > 0) {
        setError(language === "fr"
          ? "Messages présents uniquement sur cet appareil : synchronisation cloud non confirmée."
          : "Local-only messages: cloud sync has not been confirmed.");
      }
      if (remote.length > 0 || localOnly.length === 0) {
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

    const now = new Date().toISOString();
    const startingFromWelcome = showReturnWelcome;
    let conversationId = startingFromWelcome ? null : activeConversationId;
    if (startingFromWelcome) {
      chatViewActionRef.current += 1;
      setShowReturnWelcome(false);
      setMessages([]);
    }

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
    const userMessageId = options?.voice?.audio_id || uid();

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

    // Un nouveau message de l'utilisateur doit toujours apparaître en bas.
    isNearLatestRef.current = true;
    setShowJumpToLatest(false);
    setMessages((current) => current.some((item) => item.id === userMessageId)
      ? current : [...current, userMessage]);
    if (options?.contentOverride === undefined) setMessage("");
    setComposerExpanded(false);
    setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setChatStatusStep("sending");
    setIsThinking(true);
    setError(null);

    try {
      // Ne pas bloquer le premier token sur l'écriture Supabase.
      // Le message est déjà visible localement et se synchronise en parallèle.
      const userMessageSavePromise =
        saveMessageRemote(
          userMessage,
        ).then(async (savedMessage) => {
          if (savedMessage?.id) {
            persistedUserMessageIdsRef.current[userMessage.id] = String(savedMessage.id);
          }
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

      // Pour un vocal, attendre la persistance et l'association AVANT le Chat.
      // Aucun appel IA payant n'est envoyé en cas d'échec de synchronisation.
      if (options?.voice && !(await userMessageSavePromise)?.id) {
        throw new Error("Vocal non sauvegardé sur le cloud : réessayez le même brouillon.");
      }

      const formData = new FormData();

      formData.append("model", selectedModel);
      formData.append("message", content);
      formData.append("web", String(webEnabled));
      formData.append("conversation_id", conversationId);
      formData.append("reasoning_mode", reasoningMode);
      formData.append("generation_id", generationId);
      // ORIA Visual V1 : le rendu Expo prend en charge les blocs déclaratifs.
      formData.append("visual_mode", "true");

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
      let hasVisibleDelta = false;
      let streamedArtifacts: GeneratedArtifact[] = [];
      let streamedWebImages: WebIllustration[] = [];
      activeStreamingAssistantIdRef.current = assistantId;

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

          const events = buffer.replace(/\r\n/g, "\n").split("\n\n");
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

            if (eventName === "status") {
              // Un événement d'une autre génération ne peut pas modifier la ligne.
              if (
                typeof eventData.generation_id === "string" &&
                eventData.generation_id !== generationId
              ) continue;

              if (eventData.active === false || eventData.step === "clear") {
                setChatStatusStep(null);
              } else if (!hasVisibleDelta) {
                const step = readOriaChatStatusStep(eventData.step);
                if (step) setChatStatusStep(step);
              }
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
              hasVisibleDelta = false;
              setChatStatusStep("restarting");
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

              hasVisibleDelta = true;
              setChatStatusStep(null);
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
              setChatStatusStep(null);
              throw new Error(
                typeof eventData.detail === "string"
                  ? eventData.detail
                  : t.aiStreamingError,
              );
            }

            if (eventName === "done") {
              setChatStatusStep(null);
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
          rawSse.replace(/\r\n/g, "\n").split("\n\n");

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

          if (eventName === "status") {
            if (
              typeof eventData.generation_id === "string" &&
              eventData.generation_id !== generationId
            ) continue;
            if (eventData.active === false || eventData.step === "clear") {
              setChatStatusStep(null);
            } else if (!hasVisibleDelta) {
              const step = readOriaChatStatusStep(eventData.step);
              if (step) setChatStatusStep(step);
            }
            continue;
          }

          if (eventName === "generation_restarted") {
            assistantContent = "";
            hasVisibleDelta = false;
            setChatStatusStep("restarting");
            streamedWebImages = [];
            continue;
          }

          if (eventName === "error") {
            setChatStatusStep(null);
            throw new Error(
              typeof eventData.detail === "string" ? eventData.detail : t.aiStreamingError,
            );
          }

          if (eventName === "delta") {
            const delta =
              typeof eventData.content ===
              "string"
                ? eventData.content
                : "";

            if (delta) {
              hasVisibleDelta = true;
              setChatStatusStep(null);
              assistantContent += delta;
            }
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

          if (eventName === "artifact_error" && typeof eventData.detail === "string") {
            setError(eventData.detail);
          }

          if (eventName === "done") setChatStatusStep(null);
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
      const persistedUserMessage = await userMessageSavePromise;
      let persistedAssistantMessage: ChatMessage | null = null;

      try {
        persistedAssistantMessage = await saveMessageRemote(assistantMessage);
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
      return Boolean(persistedUserMessage?.id && persistedAssistantMessage?.id);
    } catch (requestError) {
      setChatStatusStep(null);
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

      const emptyAssistantId = activeStreamingAssistantIdRef.current;
      setMessages((current) => [
        ...current.filter((item) =>
          item.id !== emptyAssistantId || Boolean(item.content?.trim()),
        ),
        assistantMessage,
      ]);
      return false;
    } finally {
      setChatStatusStep(null);
      activeStreamingAssistantIdRef.current = null;
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
      setActiveCapability((current) => current === label ? null : label);
      return;
    }

    if (label === "Création") {
      Keyboard.dismiss();
      setActiveCapability(null);
      setMiniStudioOpen(true);
    }
  }

  async function logout() {
    try {
      if (supabase) await supabase.auth.signOut();
    } finally {
      if (currentUserId) {
        await removeLocalCache(currentUserId);
        await clearMobileBackgroundAt(currentUserId);
      }
      router.replace("/login" as any);
    }
  }

  /* ============================================================
   * ORIA — Modifier une demande APRÈS sa réponse (Backend 2B)
   * Le mécanisme existant de modification en cours est inchangé.
   * ============================================================ */
  function cancelCompletedEdit() {
    if (completedEditBusy || completedEditOpening) return;
    setEditingCompletedId(null);
    setCompletedEditDraft("");
    setCompletedEditFiles([]);
    setCompletedEditError(null);
  }

  async function openCompletedEdit(item: ChatMessage) {
    if (!activeConversationId || isThinking || completedEditBusy ||
        completedEditOpening || editingCompletedId !== null) return;
    if (extractAudioIdFromMessage(item.content || "")) {
      setError(language === "fr"
        ? "La modification des notes vocales terminées n'est pas encore disponible."
        : "Editing completed voice notes is not supported yet.");
      return;
    }
    const conversationId = activeConversationId;
    const action = chatViewActionRef.current;
    const serverId = persistedUserMessageIdsRef.current[item.id] || item.id;
    setCompletedEditOpening(true);
    setCompletedEditError(null);
    try {
      const data = await apiFetch<OriaRevisionsResponse>(
        `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(serverId)}/revisions`,
      );
      if (chatViewActionRef.current !== action) return;
      const pending = data.revisions.some((rev) =>
        rev.status === "queued" || rev.status === "generating" ||
        (rev.status === "ready" && rev.revision_no > data.active_revision));
      if (pending) throw new Error(language === "fr"
        ? "Une modification précédente n'est pas encore résolue. Vérifie son état avant une autre génération."
        : "A previous edit is unresolved. Check its status before regenerating.");
      setCompletedEditBaseRevision(data.active_revision);
      setCompletedEditOriginal(data.original.user_content || item.content);
      setCompletedEditDraft(oriaEditableUserText(item.content));
      setCompletedEditFiles([]);
      setEditingCompletedId(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d'ouvrir la modification.");
    } finally {
      setCompletedEditOpening(false);
    }
  }

  async function pickCompletedEditFiles() {
    if (completedEditFiles.length >= MAX_ATTACHMENTS || completedEditBusy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true, copyToCacheDirectory: true, type: "*/*",
      });
      if (result.canceled) return;
      const incoming: ChatAttachment[] = [];
      for (const asset of result.assets.slice(0, MAX_ATTACHMENTS - completedEditFiles.length)) {
        const mime = asset.mimeType || "application/octet-stream";
        if (!ACCEPTED_FILE_TYPES.includes(mime) && !ACCEPTED_IMAGE_TYPES.includes(mime)) {
          setCompletedEditError(t.unsupportedFile);
          continue;
        }
        incoming.push({ id: uid(), uri: asset.uri, name: asset.name,
          mimeType: mime, kind: mime.startsWith("image/") ? "image" : "file", size: asset.size });
      }
      setCompletedEditFiles((previous) => [...previous, ...incoming].slice(0, MAX_ATTACHMENTS));
    } catch (cause) {
      setCompletedEditError(cause instanceof Error ? cause.message : t.unsupportedFile);
    }
  }

  async function applyCompletedEdit(item: ChatMessage) {
    const conversationId = activeConversationId;
    const serverId = persistedUserMessageIdsRef.current[item.id] || item.id;
    const content = completedEditDraft.trim();
    if (!conversationId || !content || isThinking || completedEditBusy || completedEditSubmittingRef.current) return;
    if (content.length > 24000) {
      setCompletedEditError(language === "fr" ? "Maximum 24 000 caractères." : "Maximum 24,000 characters.");
      return;
    }
    if (content === oriaEditableUserText(item.content)) return;
    if (oriaMessageHasFiles(completedEditOriginal) && completedEditFiles.length === 0) {
      setCompletedEditError(language === "fr"
        ? "Ce message utilisait des pièces jointes. Sélectionne à nouveau les fichiers d'origine."
        : "This message used attachments. Reattach the original files.");
      return;
    }
    const action = chatViewActionRef.current;
    completedEditSubmittingRef.current = true;
    setCompletedEditBusy(true);
    setCompletedEditError(null);
    try {
      const prepared = await apiFetch<OriaPrepareRevisionResponse>(
        `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(serverId)}/revisions`,
        { method: "POST", body: JSON.stringify({
          content, base_revision: completedEditBaseRevision, request_id: oriaRevisionRequestId(),
        }) },
      );
      const form = new FormData();
      form.append("conversation_id", conversationId);
      form.append("message_id", serverId);
      form.append("model", selectedModel);
      form.append("web", String(activeCapability === "Recherche Web"));
      form.append("visual_mode", "true");
      form.append("reasoning_mode", reasoningMode);
      for (const attachment of completedEditFiles) {
        // Même transport Expo File que l'envoi initial du Chat.
        form.append("files", new ExpoFile(attachment.uri), attachment.name);
      }
      const generated = await apiRevisionFormFetch<OriaGenerateRevisionResponse>(
        `/ai/chat/revisions/${encodeURIComponent(prepared.revision.id)}/generate`, form,
      );
      if (!generated.active) throw new Error(language === "fr"
        ? "Version non activée ; vérifie son état côté serveur."
        : "Revision not activated; check its server status.");
      // Recharger la projection officielle au lieu d'ajouter des messages.
      const data = await apiFetch<{
        messages: ChatMessage[];
        artifacts?: Array<Record<string, unknown>>;
        voice_notes?: Array<Record<string, unknown>>;
      }>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
      if (chatViewActionRef.current === action) {
        const remote = data.messages || [];
        setMessages(remote);
        const freshArtifacts = (data.artifacts || [])
          .map((raw) => normalizeGeneratedArtifact(raw))
          .filter((artifact): artifact is GeneratedArtifact => artifact !== null);
        setGeneratedArtifacts((current) => mergeGeneratedArtifacts(
          current.filter((artifact) => artifact.conversation_id !== conversationId), freshArtifacts,
        ));
        setVoiceNotes((current) => mergeVoiceNotes(current,
          (data.voice_notes || []).map(normalizeVoiceNote)
            .filter((note): note is VoiceNote => note !== null),
        ));
        setEditingCompletedId(null);
        setCompletedEditDraft("");
        setCompletedEditFiles([]);
        setCompletedEditError(null);
        scrollToBottom(false);
        if (currentUserId) {
          const cached = await readLocalCache(currentUserId);
          await writeLocalCache(currentUserId, {
            conversations: cached?.conversations || conversations,
            messages: { ...(cached?.messages || {}), [conversationId]: remote },
            activeConversationId: conversationId,
            selectedModel, reasoningMode, activeCapability,
          });
        }
        const latestTrials = await loadTrials();
        await loadWallet(latestTrials);
      }
    } catch (cause) {
      // Ne jamais relancer automatiquement : l'appel fournisseur peut déjà
      // avoir consommé des tokens si le réseau a perdu la confirmation.
      setCompletedEditError(cause instanceof Error ? cause.message : "La modification a échoué.");
    } finally {
      completedEditSubmittingRef.current = false;
      setCompletedEditBusy(false);
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
              onLoad={loadPrivateVoiceUrl}
              transcript={voice.transcription || getVisibleMessageContent(item.content)} />
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
          !isThinking && !completedEditBusy && !completedEditOpening &&
          editingCompletedId === null && !extractAudioIdFromMessage(item.content || "") ? (
            <Pressable
              onPress={() => void openCompletedEdit(item)}
              style={styles.modifyMessageButton}
              accessibilityRole="button"
              accessibilityLabel={t.modify}
            >
              <Ionicons name="create-outline" size={14}
                color={themedIconColor("#777771", isDark)} />
              <Text style={styles.modifyMessageButtonText}>{t.modify}</Text>
            </Pressable>
          ) : null}

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

        {item.role === "user" && editingCompletedId === item.id && !isThinking ? (
          <View style={styles.modificationCard}>
            <Text style={styles.modificationTitle}>
              {language === "fr" ? "Modifier la demande" : "Edit request"}
            </Text>
            <Text style={styles.modificationHelp}>
              {language === "fr"
                ? "Modifie directement ton message. ORIA remplacera la réponse affichée après génération."
                : "Edit your message directly. ORIA will replace the visible answer after generation."}
            </Text>
            <TextInput
              multiline autoFocus
              value={completedEditDraft}
              onChangeText={setCompletedEditDraft}
              editable={!completedEditBusy}
              style={styles.modificationInput}
              placeholder={language === "fr" ? "Modifie ton message..." : "Edit your request..."}
              placeholderTextColor={themedIconColor("#92928c", isDark)}
              textAlignVertical="top"
            />
            {oriaMessageHasFiles(completedEditOriginal) ? (
              <Text style={styles.modificationHint}>
                {language === "fr"
                  ? "Joins de nouveau les fichiers d'origine : ORIA ne peut pas les récupérer depuis l'ancien message."
                  : "Reattach the original files; they cannot be replayed from the previous message."}
              </Text>
            ) : null}
            {completedEditFiles.map((file) => (
              <View key={file.id} style={styles.completedEditFileRow}>
                <Ionicons name="document-attach-outline" size={15}
                  color={themedIconColor("#777771", isDark)}/>
                <Text style={styles.completedEditFileName} numberOfLines={1}>{file.name}</Text>
                <Pressable disabled={completedEditBusy} onPress={() =>
                  setCompletedEditFiles((current) => current.filter((selected) => selected.id !== file.id))}
                  accessibilityRole="button" accessibilityLabel={t.cancel}>
                  <Ionicons name="close-circle-outline" size={20}
                    color={themedIconColor("#777771", isDark)}/>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => void pickCompletedEditFiles()}
              disabled={completedEditBusy || completedEditFiles.length >= MAX_ATTACHMENTS}
              style={styles.completedEditAttachButton}
              accessibilityRole="button"
              accessibilityLabel={language === "fr" ? "Joindre un fichier" : "Attach a file"}>
              <Ionicons name="attach-outline" size={16}
                color={themedIconColor("#777771", isDark)}/>
              <Text style={styles.completedEditAttachText}>
                {language === "fr" ? "Ajouter un fichier ou une image" : "Add a file or image"}
              </Text>
            </Pressable>
            {completedEditError ? (
              <Text style={styles.completedEditError}>{completedEditError}</Text>
            ) : null}
            <View style={styles.modificationActions}>
              <Pressable onPress={cancelCompletedEdit} disabled={completedEditBusy}
                style={styles.modificationCancelButton} accessibilityRole="button">
                <Text style={styles.modificationCancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable
                onPress={() => void applyCompletedEdit(item)}
                disabled={completedEditBusy || !completedEditDraft.trim() ||
                  completedEditDraft.trim() === oriaEditableUserText(item.content)}
                style={[styles.modificationApplyButton,
                  (completedEditBusy || !completedEditDraft.trim() ||
                    completedEditDraft.trim() === oriaEditableUserText(item.content)) &&
                    styles.modificationApplyButtonDisabled]}
                accessibilityRole="button">
                {completedEditBusy ? <ActivityIndicator size="small" color="#ffffff"/> : null}
                <Text style={styles.modificationApplyText}>
                  {completedEditBusy ? t.applying : language === "fr" ? "Enregistrer et régénérer" : "Save and regenerate"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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

                  {artifact.extension.toLowerCase() === "pdf" ? (
                    <Pressable
                      onPress={() => void openArtifactPreview(artifact)}
                      disabled={Boolean(artifactBusyId)}
                      style={[styles.artifactDownloadButton, { opacity: artifactBusyId ? 0.6 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.documentPreview} ${artifact.filename}`}
                    >
                      {artifactBusyId === artifact.id ? (
                        <ActivityIndicator size="small" color={themedIconColor("#111111", isDark)} />
                      ) : (
                        <Ionicons name="eye-outline" size={18} color={themedIconColor("#111111", isDark)} />
                      )}
                    </Pressable>
                  ) : null}
                  {artifact.extension.toLowerCase() === "docx" ? (
                    <Pressable onPress={() => void openWordPreview(artifact)}
                      disabled={Boolean(artifactBusyId)}
                      style={[styles.artifactDownloadButton, { opacity: artifactBusyId ? 0.6 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${language === "fr" ? "Aperçu Word" : "Word preview"} ${artifact.filename}`}>
                      {artifactBusyId === artifact.id ? <ActivityIndicator size="small" color={themedIconColor("#111111", isDark)}/> :
                        <Ionicons name="eye-outline" size={18} color={themedIconColor("#111111", isDark)}/>}
                    </Pressable>
                  ) : null}
                  {artifact.extension.toLowerCase() === "xlsx" ? (
                    <Pressable onPress={() => void openSpreadsheetPreview(artifact)}
                      disabled={Boolean(artifactBusyId)}
                      style={[styles.artifactDownloadButton, { opacity: artifactBusyId ? 0.6 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${language === "fr" ? "Aperçu Excel" : "Spreadsheet preview"} ${artifact.filename}`}>
                      {artifactBusyId === artifact.id ? <ActivityIndicator size="small" color={themedIconColor("#111111", isDark)}/> :
                        <Ionicons name="eye-outline" size={18} color={themedIconColor("#111111", isDark)}/>}
                    </Pressable>
                  ) : null}
                  {CODE_PREVIEW_EXTENSIONS.has(artifact.extension.toLowerCase()) ? (
                    <Pressable
                      onPress={() => void previewCodeArtifact(artifact)}
                      style={styles.artifactDownloadButton}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.codePreview} ${artifact.filename}`}
                    >
                      <Ionicons name="code-slash-outline" size={18} color={themedIconColor("#111111", isDark)} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => void downloadArtifact(artifact)}
                    disabled={Boolean(artifactBusyId)}
                    style={[styles.artifactDownloadButton, { opacity: artifactBusyId ? 0.6 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.download} ${artifact.filename}`}
                  >
                    {artifactBusyId === artifact.id ? (
                      <ActivityIndicator size="small" color={themedIconColor("#111111", isDark)} />
                    ) : (
                      <Ionicons name="download-outline" size={18} color={themedIconColor("#111111", isDark)} />
                    )}
                  </Pressable>
                </View>
              ),
            )}
          </View>
        ) : null}
      </View>
    );
  }

  const lastConversationTitle = getDisplayConversationTitle(
    conversations.find(
      (conversation) => conversation.id === activeConversationId,
    )?.title || "Nouvelle conversation",
    language,
  );
  const activeTitle = showReturnWelcome
    ? t.newConversation
    : getDisplayConversationTitle(
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
          <StatusBar barStyle="light-content" />
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
      <Modal visible={Boolean(wordPreview)} animationType="slide"
        presentationStyle="fullScreen" onRequestClose={() => setWordPreview(null)}>
        <SafeAreaProvider style={{flex:1, backgroundColor:theme==="dark" ? "#101012" : "#fff"}}>
          <SafeAreaView edges={["top","bottom","left","right"]}
            style={{flex:1, backgroundColor:theme==="dark" ? "#101012" : "#fff"}}>
            <View style={{flexDirection:"row",alignItems:"center",padding:14,borderBottomWidth:1,
              borderColor:theme==="dark" ? "#303036" : "#e5e7eb"}}>
              <Pressable onPress={() => setWordPreview(null)} accessibilityRole="button"
                accessibilityLabel={language==="fr" ? "Fermer" : "Close"} style={{padding:7}}>
                <Ionicons name="close" size={24} color={theme==="dark" ? "#fff" : "#111"}/>
              </Pressable>
              <View style={{flex:1,marginLeft:10}}>
                <Text numberOfLines={1} style={{fontSize:15,fontWeight:"700",color:theme==="dark" ? "#fff" : "#111"}}>
                  {wordPreview?.filename}
                </Text>
                <Text style={{fontSize:11,color:theme==="dark" ? "#aaa" : "#667085"}}>
                  DOCX · {language==="fr" ? "Aperçu privé en lecture seule" : "Private read-only preview"}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={language==="fr" ? "Télécharger" : "Download"}
                style={{padding:7}} onPress={() => {
                  const artifact = generatedArtifacts.find((item) => item.id === wordPreview?.id);
                  if (artifact) void downloadArtifact(artifact);
                }}>
                <Ionicons name="download-outline" size={21} color={theme==="dark" ? "#fff" : "#111"}/>
              </Pressable>
            </View>
            <ScrollView style={{flex:1,backgroundColor:theme==="dark" ? "#18181b" : "#f0f2f5"}}
              contentContainerStyle={{paddingHorizontal:12,paddingVertical:18}}>
              <View style={{backgroundColor:"#fff",borderRadius:10,paddingHorizontal:21,
                paddingVertical:30,minHeight:500,maxWidth:850,alignSelf:"stretch"}}>
                {(wordPreview?.blocks || []).map((block,index) => {
                  if (block.type === "table") return <ScrollView horizontal key={`table-${index}`}
                    style={{marginVertical:11}}>
                    <View style={{borderWidth:1,borderColor:"#d5dee5"}}>
                      {(block.rows || []).map((row,ri)=><View key={ri} style={{flexDirection:"row"}}>
                        {row.map((cell,ci)=><View key={ci} style={{width:180,padding:9,borderBottomWidth:1,
                          borderRightWidth:1,borderColor:"#d5dee5",backgroundColor:ri===0?"#eaf2f7":"#fff"}}>
                          <Text selectable style={{fontSize:12,color:"#263346",fontWeight:ri===0?"700":"400"}}>{cell}</Text>
                        </View>)}
                      </View>)}
                    </View>
                  </ScrollView>;
                  const large = block.type === "title" || block.type === "heading";
                  const fontSize = block.type === "title" ? 27 : block.type === "subtitle" ? 17 :
                    block.type === "heading" ? ((block.level || 2) <= 2 ? 20 : 17) : 14;
                  let listNumber = 1;
                  if (block.type === "number") {
                    for (let prev = index - 1; prev >= 0 && wordPreview?.blocks[prev].type === "number"; prev--) listNumber++;
                  }
                  const runs = (block.runs || []).filter(run => run.type === "text");
                  const images = (block.runs || []).filter(run => run.type === "image" && run.src?.startsWith("data:image/"));
                  return <View key={`word-${index}`} style={{marginTop:large ? 18 : 5,marginBottom:large ? 9 : 6}}>
                    {runs.length ? <Text selectable style={{color:large ? "#153c5a" : "#283445",
                      fontSize,lineHeight:Math.round(fontSize*1.55),fontWeight:large ? "700" : "400"}}>
                      {block.type === "bullet" ? "•  " : block.type === "number" ? `${listNumber}.  ` : ""}
                      {runs.map((run,ri)=><Text key={ri} style={{fontWeight:run.bold ? "700" : undefined,
                        fontStyle:run.italic ? "italic" : undefined,
                        textDecorationLine:run.underline ? "underline" : "none"}}>{run.text || ""}</Text>)}
                    </Text> : null}
                    {images.map((run,ri)=><Image key={`img-${ri}`} source={{uri:run.src!}}
                      resizeMode="contain" accessibilityLabel={language==="fr" ? "Illustration du document" : "Document illustration"}
                      style={{width:"100%",height:215,marginTop:8,marginBottom:8,borderRadius:6}}/>)}
                  </View>;
                })}
              </View>
              <Text style={{padding:12,fontSize:11,textAlign:"center",color:theme==="dark" ? "#aaa" : "#667085"}}>
                {language==="fr" ? "Aperçu simplifié : pagination et certaines mises en page peuvent différer du fichier Word. Téléchargez le DOCX pour tout consulter." :
                  "Simplified preview: pagination and some Word layouts may differ. Download the DOCX for full fidelity."}
                {wordPreview?.truncated ? (language==="fr" ? " Aperçu tronqué." : " Preview truncated.") : ""}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      <Modal visible={Boolean(spreadsheetPreview)} animationType="slide"
        presentationStyle="fullScreen" onRequestClose={() => setSpreadsheetPreview(null)}>
        <SafeAreaProvider style={{flex:1, backgroundColor: theme === "dark" ? "#101012" : "#fff"}}>
          <SafeAreaView edges={["top","bottom","left","right"]} style={{flex:1, backgroundColor: theme === "dark" ? "#101012" : "#fff"}}>
            <View style={{flexDirection:"row", alignItems:"center", padding:14,
              borderBottomWidth:1, borderColor: theme === "dark" ? "#303036" : "#e5e7eb"}}>
              <Pressable onPress={() => setSpreadsheetPreview(null)} accessibilityRole="button"
                accessibilityLabel={language === "fr" ? "Fermer" : "Close"} style={{padding:7}}>
                <Ionicons name="close" size={24} color={theme === "dark" ? "#fff" : "#111"}/>
              </Pressable>
              <View style={{flex:1, marginLeft:10}}>
                <Text numberOfLines={1} style={{fontSize:15,fontWeight:"700", color:theme === "dark" ? "#fff" : "#111"}}>
                  {spreadsheetPreview?.filename}
                </Text>
                <Text style={{fontSize:11, color:theme === "dark" ? "#aaa" : "#667085"}}>
                  XLSX · {language === "fr" ? "Aperçu privé en lecture seule" : "Private read-only preview"}
                </Text>
              </View>
            </View>
            <ScrollView horizontal style={{flexGrow:0, borderBottomWidth:1,
              borderColor:theme === "dark" ? "#303036" : "#e5e7eb"}}
              contentContainerStyle={{padding:9, gap:7}}>
              {(spreadsheetPreview?.sheets || []).map((sheet, idx) => (
                <Pressable key={`${idx}-${sheet.name}`} onPress={() => setSpreadsheetSheetIndex(idx)}
                  style={{paddingHorizontal:13,paddingVertical:9,borderRadius:9,
                    backgroundColor:spreadsheetSheetIndex===idx ? (theme==="dark" ? "#fff" : "#111") : (theme==="dark" ? "#24242a" : "#f3f4f6")}}>
                  <Text style={{fontSize:12,fontWeight:"600",color:spreadsheetSheetIndex===idx ? (theme==="dark" ? "#111" : "#fff") : (theme==="dark" ? "#ddd" : "#333")}}>{sheet.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView style={{flex:1}} nestedScrollEnabled>
              <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{padding:12}}>
                <View style={{borderWidth:1,borderColor:theme==="dark" ? "#36363d" : "#d9dce1",borderRadius:10,overflow:"hidden"}}>
                  {(() => {
                    const sheet = spreadsheetPreview?.sheets[spreadsheetSheetIndex];
                    if (!sheet) return null;
                    const colCount = Math.min(16,Math.max(1,...sheet.rows.map((r)=>r.length)));
                    const valueText = (value: string | number | boolean | null | undefined) => value == null ? "" : typeof value === "number" ? value.toLocaleString(language === "fr" ? "fr-FR" : "en-US") : String(value);
                    const cell = (value: string, isHead:boolean, key:string) => <View key={key}
                      style={{width:170,paddingVertical:10,paddingHorizontal:9,borderRightWidth:1,borderBottomWidth:1,
                        borderColor:theme==="dark" ? "#36363d" : "#e5e7eb",backgroundColor:isHead ? (theme==="dark" ? "#232329" : "#edf2f7") : (theme==="dark" ? "#101012" : "#fff")}}>
                        <Text selectable numberOfLines={5} style={{fontSize:12,lineHeight:18,fontWeight:isHead ? "700" : "400",color:theme==="dark" ? "#eee" : "#263248"}}>{value}</Text>
                      </View>;
                    return <>
                      <View style={{flexDirection:"row"}}>
                        {cell("#",true,"row-heading")}
                        {Array.from({length:colCount},(_,i)=>cell(String.fromCharCode(65+i),true,`head-${i}`))}
                      </View>
                      {sheet.rows.map((row,index)=><View key={index} style={{flexDirection:"row"}}>
                        {cell(String(index+1),true,`r-${index}`)}
                        {Array.from({length:colCount},(_,i)=>cell(valueText(row[i]),index===0,`c-${index}-${i}`))}
                      </View>)}
                    </>;
                  })()}
                </View>
              </ScrollView>
            </ScrollView>
            <Text style={{padding:12,fontSize:11,textAlign:"center",color:theme==="dark" ? "#aaa" : "#667085"}}>
              {language === "fr" ? "Aperçu limité à 120 lignes, 16 colonnes et 10 feuilles. Téléchargez le classeur pour tout consulter." : "Preview limited to 120 rows, 16 columns and 10 sheets. Download for full content."}
            </Text>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      {miniStudioOpen ? (
        <OriaMiniStudio
          visible={miniStudioOpen}
          language={language}
          theme={theme}
          onClose={() => setMiniStudioOpen(false)}
          onWalletRefresh={() => {
            void loadWallet();
            void loadPersistedMedia();
          }}
        />
      ) : null}
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
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container} {...edgePanResponder.panHandlers}>
          {!coursesOpen ? <View style={styles.header}>
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
                accessibilityRole="button"
                accessibilityLabel={language === "en" ? "ORIA Courses" : "ORIA Cours"}
                style={[courseUi.pill, { borderColor: isDark ? "#555" : "#ddd", paddingHorizontal: 10, paddingVertical: 7 }]}
                onPress={() => {
                  if (recorderState.isRecording) {
                    Alert.alert("ORIA", language === "en" ? "Stop your voice note first." : "Arrêtez d'abord la note vocale.");
                    return;
                  }
                  setCoursesOpen((previous) => !previous);
                  Keyboard.dismiss();
                }}>
                <Ionicons name={coursesOpen ? "chatbubble-outline" : "school-outline"}
                  size={20} color={themedIconColor("#555555", isDark)} />
              </Pressable>
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
          </View> : null}

          {coursesOpen ? (
            <OriaCoursesMobilePanel language={language} wallet={wallet} userId={currentUserId}
              onWalletRefresh={() => { void loadWallet(); }} onClose={() => setCoursesOpen(false)} />
          ) : (
          <>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => setError(null)}>
                <Ionicons name="close" size={17} color={themedIconColor("#555555", isDark)} />
              </Pressable>
            </View>
          ) : null}

          {messages.length === 0 || showReturnWelcome ? (
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
              {showReturnWelcome && activeConversationId ? (
                <Pressable
                  onPress={() => void selectConversation(activeConversationId)}
                  style={styles.returnConversationCard}
                  accessibilityRole="button"
                  accessibilityLabel={language === "fr"
                    ? "Reprendre ma dernière discussion"
                    : "Resume my last conversation"}
                >
                  <View style={styles.returnConversationText}>
                    <Text style={styles.returnConversationHeading}>
                      {language === "fr" ? "Reprendre ma discussion" : "Resume my conversation"}
                    </Text>
                    <Text style={styles.returnConversationSubtitle} numberOfLines={1}>
                      {lastConversationTitle}
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward-outline" size={20}
                    color={themedIconColor("#555555", isDark)} />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.messageViewport}>
            <FlatList
              ref={listRef}
              style={styles.messageListContainer}
              data={messages.filter((item) => !(
                isThinking &&
                item.role === "assistant" &&
                item.id === activeStreamingAssistantIdRef.current &&
                !getVisibleMessageContent(item.content || "").trim()
              ))}
              extraData={chatStatusStep}
              ListFooterComponent={isThinking && chatStatusStep ? (
                <View style={styles.oriaStatusRow} accessibilityLiveRegion="polite">
                  <ActivityIndicator
                    size="small"
                    color={themedIconColor("#777771", isDark)}
                  />
                  <Text
                    style={styles.oriaStatusText}
                    numberOfLines={1}
                    accessibilityRole="text"
                  >
                    {ORIA_CHAT_STATUS_LABELS[chatStatusStep][language]}
                  </Text>
                </View>
              ) : undefined}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => { isUserScrollingRef.current = true; }}
              onMomentumScrollBegin={() => {
                if (!isNearLatestRef.current) isUserScrollingRef.current = true;
              }}
              onScroll={({ nativeEvent }) => {
                // Une arrivée de nouveaux tokens ne doit pas être prise pour un scroll manuel.
                if (!isUserScrollingRef.current) return;
                handleListScroll(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y);
              }}
              onScrollEndDrag={({ nativeEvent }) => {
                handleListScroll(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y);
                isUserScrollingRef.current = false;
              }}
              onMomentumScrollEnd={({ nativeEvent }) => {
                handleListScroll(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y);
                isUserScrollingRef.current = false;
              }}
              onContentSizeChange={() => {
                if (isNearLatestRef.current) {
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
            />
            {showJumpToLatest && messages.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={language === "fr" ? "Aller au dernier message" : "Jump to latest message"}
                accessibilityHint={language === "fr" ? "Descend en bas de la conversation" : "Scrolls to the newest messages"}
                onPress={() => scrollToBottom(true)}
                style={styles.jumpToLatestButton}
              >
                <Ionicons name="arrow-down" size={22} color={themedIconColor("#161616", isDark)} />
              </Pressable>
            ) : null}
            </View>
          )}

          <View
            style={[
              styles.bottomArea,
              {
                // Inset constant même pendant l'animation clavier : pas d'oscillation.
                paddingBottom: Math.max(safeAreaBottom, Platform.OS === "ios" ? 8 : 10),
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

            {/* Le mini-studio est désormais un écran natif dédié (Modal).
                Le Chat n’affiche plus de formulaire de création au-dessus du composer. */}

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

              {composerExpanded ? (
                <Text
                  pointerEvents="none"
                  accessible={false}
                  style={styles.composerTextMeasure}
                  onTextLayout={(event) => {
                    const lineCount = event.nativeEvent.lines.length;
                    if (lineCount < 1) return;
                    const nextHeight = Math.max(
                      COMPOSER_INPUT_MIN_HEIGHT,
                      Math.min(COMPOSER_INPUT_MAX_HEIGHT, 18 + lineCount * 23),
                    );
                    setComposerInputHeight((previous) => previous === nextHeight ? previous : nextHeight);
                  }}
                >
                  {message.length > 2000 ? message.slice(-2000) : (message || " ")}{"\u200b"}
                </Text>
              ) : null}
              <TextInput
                value={message}
                onChangeText={(value) =>
                  void handleComposerTextChange(
                    value,
                  )
                }
                placeholder={
                  t.messagePrompt
                }
                placeholderTextColor={themedIconColor("#999999", isDark)}
                editable={!isThinking}
                multiline
                textAlignVertical={composerExpanded ? "top" : "center"}
                scrollEnabled={composerExpanded && composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
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
                }}
                onBlur={() => undefined}
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
                      onPress={() => {
                        if (recorderState.isRecording) return;
                        Keyboard.dismiss(); setCoursesOpen(true);
                      }}>
                      <Ionicons name="school-outline" size={19} color={themedIconColor("#555555", isDark)} />
                      <Text style={styles.capabilityButtonText}>Cours</Text>
                    </Pressable>
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
                        miniStudioOpen &&
                          styles.capabilityActive,
                      ]}
                      onPress={() => selectCapability("Création")}
                    >
                      <Ionicons
                        name="videocam-outline"
                        size={19}
                        color={
                          miniStudioOpen
                            ? "#ffffff"
                            : themedIconColor("#555555", isDark)
                        }
                      />
                      <Text
                        style={[
                          styles.capabilityButtonText,
                          miniStudioOpen &&
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

            {composerExpanded && !keyboardVisible ? (
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

          </>
          )}
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
                        !showReturnWelcome && item.id === activeConversationId &&
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
                  <Pressable style={styles.drawerLink} onPress={() => {
                    if (recorderState.isRecording) {
                      Alert.alert("ORIA", "Arrêtez d'abord la note vocale."); return;
                    }
                    closeDrawer(); setCoursesOpen(true); Keyboard.dismiss();
                  }}>
                    <Ionicons name="school-outline" size={18} color={themedIconColor("#555555", isDark)} />
                    <Text style={styles.drawerLinkText}>ORIA Cours</Text>
                  </Pressable>
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
  messageViewport: {
    flex: 1,
    position: "relative",
    minHeight: 0,
  },
  messageListContainer: {
    flex: 1,
  },
  jumpToLatestButton: {
    position: "absolute",
    bottom: 13,
    right: 17,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "#d6d6d2",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
    elevation: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 18,
  },
  oriaStatusRow: {
    minHeight: 28,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  oriaStatusText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#777771",
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
  completedEditFileRow: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#deded9",
  },
  completedEditFileName: {
    flex: 1,
    color: "#777771",
    fontSize: 11,
  },
  completedEditAttachButton: {
    alignSelf: "flex-start",
    marginTop: 10,
    minHeight: 32,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 7,
  },
  completedEditAttachText: {
    color: "#777771",
    fontSize: 11,
  },
  completedEditError: {
    marginTop: 7,
    color: "#b91c1c",
    fontSize: 11,
    lineHeight: 17,
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
    // Ne s'étend jamais sur toute la hauteur disponible.
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 24,
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
    // Le champ n'influence jamais le calcul de sa propre hauteur.
    flex: 0,
    width: "100%",
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    paddingHorizontal: 17,
    paddingTop: 10,
    paddingBottom: 8,
  },
  composerTextMeasure: {
    // Mesure des lignes réelle, hors du flux et sans boucle de redimensionnement.
    position: "absolute",
    left: 17,
    right: 17,
    top: 8,
    color: "transparent",
    opacity: 0,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "400",
    zIndex: -1,
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
  returnConversationCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    marginTop: 28,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e0e0dc",
    backgroundColor: "#f7f7f5",
  },
  returnConversationText: { flex: 1, paddingRight: 12 },
  returnConversationHeading: {
    color: "#171715",
    fontSize: 14,
    fontWeight: "600",
  },
  returnConversationSubtitle: {
    color: "#777771",
    fontSize: 12,
    marginTop: 5,
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