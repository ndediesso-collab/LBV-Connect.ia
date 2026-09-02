import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
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
 * Le cache navigateur localStorage est remplacé par SecureStore.
 */

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

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
  credits: number;
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
  { action: "image_480", type: "image", label: "Image 480", description: "Génération image légère", configuration: "480 px", credits: 50 },
  { action: "image_720", type: "image", label: "Image 720", description: "Génération image légère", configuration: "720 px", credits: 75 },
  { action: "image_pro", type: "image", label: "Image Pro", description: "Génération image professionnelle", configuration: "Pro", credits: 100 },
  { action: "image_pro_standard", type: "image", label: "Image Pro Standard", description: "Qualité professionnelle standard", configuration: "Standard", credits: 180 },
  { action: "image_pro_ultra", type: "image", label: "Image Pro Ultra", description: "Qualité professionnelle maximale", configuration: "Ultra", credits: 270 },
  { action: "image_business", type: "image", label: "Image Business", description: "Génération business", configuration: "Business", credits: 250 },
  { action: "image_business_hd", type: "image", label: "Image Business HD", description: "Génération business haute définition", configuration: "HD", credits: 400 },
  { action: "image_business_ultra", type: "image", label: "Image Business Ultra", description: "Génération business maximale", configuration: "Ultra", credits: 600 },
  { action: "video_4s", type: "video", label: "Vidéo 4 s", description: "Génération vidéo légère", configuration: "4 secondes", credits: 500 },
  { action: "video_8s", type: "video", label: "Vidéo 8 s", description: "Génération vidéo légère", configuration: "8 secondes", credits: 1000 },
  { action: "video_lite", type: "video", label: "Vidéo Lite", description: "Génération vidéo intermédiaire", configuration: "Lite", credits: 1500 },
  { action: "video_pro_fast", type: "video", label: "Vidéo Pro Fast", description: "Génération vidéo professionnelle rapide", configuration: "Fast", credits: 1500 },
  { action: "video_pro_standard", type: "video", label: "Vidéo Pro Standard", description: "Génération vidéo professionnelle standard", configuration: "Standard", credits: 3000 },
  { action: "video_pro_extension", type: "video", label: "Vidéo Pro Extension", description: "Extension d'une génération vidéo Pro", configuration: "Extension", credits: 1500 },
  { action: "video_business_fast", type: "video", label: "Vidéo Business Fast", description: "Génération vidéo business rapide", configuration: "Fast", credits: 2500 },
  { action: "video_business_standard", type: "video", label: "Vidéo Business Standard", description: "Génération vidéo business standard", configuration: "Standard", credits: 5000 },
  { action: "video_business_long", type: "video", label: "Vidéo Business Long", description: "Génération vidéo business longue", configuration: "Long", credits: 10000 },
] as const;

const models: ModelDefinition[] = [
  {
    id: "luna",
    name: "Luna",
    description: "Modèle économique · Rapide pour les échanges courants",
    packs: ["light_pack", "intermediate_pack", "pro_pack", "business_pack"],
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    description: "Modèle polyvalent · Pour les tâches plus avancées",
    packs: ["intermediate_pack", "pro_pack", "business_pack"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Raisonnement avancé · Pour les problèmes complexes",
    packs: ["pro_pack", "business_pack"],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Puissance maximale · Pour les tâches les plus exigeantes",
    packs: ["business_pack"],
  },
];

const TRIAL_MODEL_BY_PACK: Record<string, string> = {
  light_pack: "gpt-5",
  intermediate_pack: "gpt-5.6-terra",
  pro_pack: "gpt-5.6-sol",
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

function formatCredits(value: number) {
  return value.toLocaleString("fr-FR");
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

  const response = await fetch(`${API_URL}${path}`, {
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

async function readLocalCache(userId: string): Promise<LocalChatCache | null> {
  try {
    const raw = await SecureStore.getItemAsync(cacheKey(userId));
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

    await SecureStore.setItemAsync(cacheKey(userId), JSON.stringify(payload));
  } catch (error) {
    console.error("Erreur sauvegarde cache Oria :", error);
  }
}

async function removeLocalCache(userId: string) {
  try {
    await SecureStore.deleteItemAsync(cacheKey(userId));
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

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let index = 0;

  const tokenRegex =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

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

function MarkdownMessage({ content }: { content: string }) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  let code: string[] = [];
  let language = "";
  let inCode = false;
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

  const flushCode = () => {
    if (!inCode) return;

    blocks.push(
      <CodeBlock key={`code-${index}`} language={language} value={code.join("\n")} />,
    );

    index++;
    code = [];
    language = "";
    inCode = false;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushLists();
        flushParagraph();
        inCode = true;
        language = trimmed.slice(3).trim();
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
  flushLists();
  flushParagraph();

  return <View style={styles.markdown}>{blocks}</View>;
}

function CodeBlock({
  language,
  value,
}: {
  language: string;
  value: string;
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
          <Text style={styles.copyText}>{copied ? "Copié" : "Copier"}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal>
        <Text style={styles.codeText}>{value}</Text>
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
}: {
  model: ModelDefinition;
  active: boolean;
  trial?: TrialInfo;
  disabled: boolean;
  onPress: () => void;
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
            Essai · {trial.remaining}/{trial.max}
          </Text>
        ) : active ? (
          <Ionicons name="checkmark" size={17} color="#111111" />
        ) : null}
      </View>
      <Text style={styles.modelDescription}>{model.description}</Text>
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
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
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
          {attachment.kind === "image" ? "Image" : "Fichier"}
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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("luna");
  const [message, setMessage] = useState("");
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

  const [mediaCapabilities, setMediaCapabilities] =
    useState<MediaCapability[]>(
      MEDIA_GENERATION_CONFIGS.map((item) => ({
        action: item.action,
        type: item.type,
        credits: item.credits,
      })),
    );
  const [selectedMediaAction, setSelectedMediaAction] = useState("");
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

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, [messages.length, isThinking]);

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

      const data =
        await apiFetch<{ success: boolean; media: MediaCapability[] }>(
          "/ai/media-capabilities",
        );

      const available = Array.isArray(data.media) ? data.media : [];

      if (available.length) {
        setMediaCapabilities(available);
        setSelectedMediaAction((current) =>
          current && available.some((item) => item.action === current)
            ? current
            : available[0]?.action ?? "",
        );
      } else {
        setMediaCapabilities(
          MEDIA_GENERATION_CONFIGS.map((item) => ({
            action: item.action,
            type: item.type,
            credits: item.credits,
          })),
        );
      }
    } catch (requestError) {
      console.warn("Capacités média indisponibles :", requestError);

      const fallback = MEDIA_GENERATION_CONFIGS.map((item) => ({
        action: item.action,
        type: item.type,
        credits: item.credits,
      }));

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
    setActiveCapability(null);
    setError(null);
    setSidebarOpen(false);

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
        "Conversation créée localement. Synchronisation cloud en attente.",
      );
    }
  }

  async function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setSidebarOpen(false);
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
          ? `${requestError.message} Les messages locaux restent affichés.`
          : "Impossible de charger les messages cloud.",
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

  async function pickImage() {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(
        `Vous pouvez joindre au maximum ${MAX_ATTACHMENTS} éléments par message.`,
      );
      return;
    }

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission requise",
        "Autorisez l'accès aux photos pour joindre une image.",
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
        `Vous pouvez joindre au maximum ${MAX_ATTACHMENTS} éléments par message.`,
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
        setError("Format de fichier non pris en charge.");
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
    const prompt = (promptOverride ?? mediaPrompt).trim();

    if (!prompt || isThinking) return;

    if (!selectedMediaAction) {
      setError("Aucune option de création n'est disponible.");
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
              credits: config.credits,
            }
          : undefined;
      })();

    if (!capability) {
      setError("Cette option de création n'existe pas.");
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
        throw new Error("La génération du média a échoué.");
      }

      const url = (
        response.public_url ||
        response.media_url ||
        response.url ||
        ""
      ).trim();

      if (!url) {
        throw new Error(
          "Le serveur a généré le média mais n'a retourné aucune URL exploitable.",
        );
      }

      const mediaId = response.media_id || response.id;

      if (!mediaId) {
        throw new Error(
          "Le serveur a généré le média mais n'a retourné aucun identifiant.",
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
          : "La création média a échoué.",
      );
    } finally {
      setIsThinking(false);
    }
  }

  async function handleSendMessage() {
    const content = message.trim();
    const selectedTrial = trials[selectedModel];

    if (selectedTrial && selectedTrial.remaining <= 0) {
      setError("Les essais gratuits de ce modèle sont épuisés.");
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

    const webEnabled = activeCapability === "Recherche Web";

    const attachmentSummary =
      attachments.length > 0
        ? `\n\n[Pièces jointes : ${attachments
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
        formData.append(
          "files",
          {
            uri: attachment.uri,
            type: attachment.mimeType,
            name: attachment.name,
          } as any,
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
                  : "Erreur pendant le streaming IA.",
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
          "Le service IA n'a retourné aucun contenu.",
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
          : "Impossible de contacter Oria.";

      const assistantMessage: ChatMessage = {
        id: uid(),
        conversationId,
        role: "assistant",
        content: `Erreur : ${errorMessage}`,
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
      void loadMediaCapabilities();
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
            />
          ) : (
            <Text style={styles.userText}>
              {item.content}
            </Text>
          )}
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
              <Text style={styles.openMediaText}>
                Ouvrir
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const activeTitle =
    conversations.find(
      (conversation) =>
        conversation.id === activeConversationId,
    )?.title || "Nouvelle conversation";

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable
              style={styles.headerButton}
              onPress={() => setSidebarOpen(true)}
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
                Comment puis-je{"\n"}vous aider ?
              </Text>

              <Text style={styles.emptyDescription}>
                Discutez avec les modèles disponibles et utilisez
                la recherche Web directement depuis votre espace.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
            />
          )}

          <View style={styles.bottomArea}>
            {modelMenuOpen ? (
              <View style={styles.modelMenu}>
                {availableModels.length === 0 ? (
                  <Text style={styles.emptyMenuText}>
                    Aucun modèle disponible avec ce pack.
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
                )?.name || "Modèle"}
              </Text>

              {trials[selectedModel] ? (
                <Text style={styles.trialBadge}>
                  Essai · {trials[selectedModel].remaining}/
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
                    Recherche Web activée
                  </Text>
                  <Text style={styles.capabilityDescription}>
                    Active pour les prochains messages.
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
                      Création média
                    </Text>
                    <Text style={styles.capabilityDescription}>
                      Choisissez Image ou Vidéo, puis la configuration.
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

                <View style={styles.mediaTypeRow}>
                  {(["image", "video"] as const).map((type) => {
                    const available = mediaCapabilities.filter(
                      (item) => item.type === type,
                    );
                    const selectedType = selectedMediaAction
                      ? getMediaGenerationConfig(
                          selectedMediaAction,
                        )?.type
                      : undefined;

                    return (
                      <Pressable
                        key={type}
                        disabled={!available.length}
                        onPress={() => {
                          if (available.length) {
                            setSelectedMediaAction(
                              available[0].action,
                            );
                          }
                        }}
                        style={[
                          styles.mediaTypeButton,
                          selectedType === type &&
                            styles.mediaTypeButtonActive,
                          !available.length &&
                            styles.disabled,
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
                            ? "Générer une image"
                            : "Générer une vidéo"}
                        </Text>
                        <Text style={styles.smallMuted}>
                          {available.length} configuration
                          {available.length > 1 ? "s" : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedMediaAction ? (
                  <>
                    <Text style={styles.mediaSectionLabel}>
                      Configuration de génération
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
                        .map((media) => {
                          const config =
                            getMediaGenerationConfig(
                              media.action,
                            );

                          if (!config) return null;

                          const selected =
                            selectedMediaAction ===
                            media.action;

                          return (
                            <Pressable
                              key={media.action}
                              onPress={() =>
                                setSelectedMediaAction(
                                  media.action,
                                )
                              }
                              style={[
                                styles.mediaOption,
                                selected &&
                                  styles.mediaOptionActive,
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

                              <Text
                                style={styles.smallMuted}
                              >
                                {config.description}
                              </Text>

                              <View style={styles.rowBetween}>
                                <Text
                                  style={styles.smallMuted}
                                >
                                  {config.configuration}
                                </Text>
                                <Text
                                  style={styles.smallMuted}
                                >
                                  {formatCredits(
                                    media.credits,
                                  )}{" "}
                                  crédits
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                    </ScrollView>

                    <TextInput
                      value={mediaPrompt}
                      onChangeText={setMediaPrompt}
                      placeholder={
                        getMediaGenerationConfig(
                          selectedMediaAction,
                        )?.type === "video"
                          ? "Décrivez précisément la vidéo à créer..."
                          : "Décrivez précisément l'image à créer..."
                      }
                      multiline
                      editable={!isThinking}
                      style={styles.mediaPrompt}
                    />

                    <View style={styles.rowBetween}>
                      <View style={styles.flex}>
                        {(() => {
                          const selected =
                            mediaCapabilities.find(
                              (item) =>
                                item.action ===
                                selectedMediaAction,
                            );

                          return selected ? (
                            <Text style={styles.smallMuted}>
                              Coût :{" "}
                              <Text style={styles.bold}>
                                {formatCredits(
                                  selected.credits,
                                )}{" "}
                                crédits
                              </Text>
                            </Text>
                          ) : null;
                        })()}
                        <Text style={styles.smallMuted}>
                          Le backend valide le pack et le débit.
                        </Text>
                      </View>

                      <Pressable
                        disabled={
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
                            ? "Génération..."
                            : getMediaGenerationConfig(
                                  selectedMediaAction,
                                )?.type === "video"
                              ? "Générer la vidéo"
                              : "Générer l'image"}
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
                    ? "Décrivez votre création..."
                    : "Écrivez à Oria..."
                }
                placeholderTextColor="#999999"
                editable={!isThinking}
                multiline
                textAlignVertical="top"
                style={styles.composerInput}
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
                      Fichier
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
                      Image
                    </Text>
                    {attachments.length > 0 ? (
                      <Text style={styles.smallMuted}>
                        {attachments.length}/{MAX_ATTACHMENTS}
                      </Text>
                    ) : null}
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
                      Recherche Web
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
                      Création
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
              Jusqu'à {MAX_ATTACHMENTS} fichiers ou images peuvent être
              joints. Les créations image et vidéo dépendent du pack actif.
            </Text>
          </View>

          <Modal
            visible={sidebarOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setSidebarOpen(false)}
          >
            <View style={styles.drawerOverlay}>
              <Pressable
                style={styles.drawerBackdrop}
                onPress={() => setSidebarOpen(false)}
              />

              <View style={styles.drawer}>
                <View style={styles.drawerHeader}>
                  <View>
                    <Text style={styles.drawerBrand}>Oria</Text>
                    <Text style={styles.drawerSubtitle}>
                      Intelligence workspace
                    </Text>
                  </View>

                  <Pressable
                    style={styles.closeButton}
                    onPress={() => setSidebarOpen(false)}
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
                      Nouvelle conversation
                    </Text>
                  </View>
                  <Text style={styles.plusText}>+</Text>
                </Pressable>

                <Text style={styles.historyLabel}>
                  Historique
                </Text>

                <FlatList
                  data={conversations}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.historyList}
                  ListEmptyComponent={
                    <Text style={styles.smallMuted}>
                      {isLoadingConversations
                        ? "Chargement..."
                        : "Aucune conversation pour le moment."}
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
                        {item.title}
                      </Text>
                    </Pressable>
                  )}
                />

                <View style={styles.walletCard}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.smallMuted}>
                      Crédits disponibles
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
                      ? `${remainingDays} jours restants`
                      : "Durée indisponible"}
                  </Text>
                </View>

                <View style={styles.drawerLinks}>
                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => {
                      setSidebarOpen(false);
                      router.push("/credits"as any);
                    }}
                  >
                    <Ionicons
                      name="wallet-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      Mes crédits
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.drawerLink}
                    onPress={() => {
                      setSidebarOpen(false);
                      router.push("/mes_creations" as any);
                    }}
                  >
                    <Ionicons
                      name="images-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      Mes créations
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
                      setSidebarOpen(false);
                      router.push("/settings" as any);
                    }}
                  >
                    <Ionicons
                      name="settings-outline"
                      size={18}
                      color="#555555"
                    />
                    <Text style={styles.drawerLinkText}>
                      Paramètres
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
                      Déconnexion
                    </Text>
                  </Pressable>
                </View>
              </View>
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
  messageList: {
    paddingHorizontal: 14,
    paddingVertical: 20,
    paddingBottom: 24,
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
    paddingHorizontal: 13,
    paddingBottom: Platform.OS === "ios" ? 6 : 10,
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
    minHeight: 90,
    maxHeight: 180,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 10,
    color: "#171715",
    fontSize: 14,
    lineHeight: 21,
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
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  drawer: {
    width: "84%",
    maxWidth: 340,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 12,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
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