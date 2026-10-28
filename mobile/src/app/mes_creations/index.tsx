import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";

type OriaLanguage = "fr" | "en";
type OriaTheme = "light" | "dark";
type CreationKind = "image" | "video" | "artifact";
type FilterType = "all" | CreationKind;

type CreationItem = {
  id: string;
  user_id?: string;
  conversation_id?: string | null;
  source_message_id?: string | null;

  creation_type?: string | null;
  media_type?: "image" | "video";
  type?: string | null;

  prompt?: string | null;
  action?: string | null;
  model?: string | null;
  credits_cost?: number | null;

  filename?: string | null;
  extension?: string | null;
  category?: string | null;
  sha256?: string | null;

  storage_path?: string | null;
  public_url?: string | null;
  media_url?: string | null;
  download_url?: string | null;
  preview_url?: string | null;
  preview_supported?: boolean;
  url?: string | null;

  mime_type?: string | null;
  size_bytes?: number | null;
  size?: number | null;

  metadata?: Record<string, unknown> | null;
  seconds?: number | string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

type ApiError = { detail?: string; message?: string };
type ArtifactListResponse = ApiError & { artifacts?: CreationItem[] };
type DocBlock = Record<string, unknown>;
type DocPreview = ApiError & {
  blocks?: DocBlock[];
  paragraphs?: DocBlock[];
  content?: { blocks?: DocBlock[] };
  truncated?: boolean;
};
type SpreadsheetPreview = ApiError & {
  sheets?: Array<{ name?: string; rows?: unknown[][]; truncated?: boolean }>;
  truncated?: boolean;
};
type PreviewKind = "pdf" | "docx" | "xlsx" | "text" | "unsupported";
type ArtifactPreview = {
  item: CreationItem;
  kind: PreviewKind;
  loading: boolean;
  error?: string;
  text?: string;
  document?: DocPreview;
  spreadsheet?: SpreadsheetPreview;
};

const TEXT_PREVIEW_TYPES = new Set([
  "txt", "md", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml",
  "xml", "log", "py", "js", "ts", "tsx", "jsx", "html", "css", "sql", "toml", "ini", "sh",
]);
const MAX_TEXT_PREVIEW_BYTES = 1_000_000;
const MAX_TEXT_PREVIEW_CHARS = 90_000;
const SYNC_INTERVAL_MS = 45_000;

function artifactExtension(item: CreationItem): string {
  return String(item.extension || item.filename?.split(".").pop() || "")
    .trim().toLowerCase().replace(/^\./, "");
}

function isCourseArtifact(item: CreationItem): boolean {
  return item.metadata?.source === "oria-course" ||
    /^oria-cours-(?:transcription-)?[a-f0-9]{16}\.(?:pdf|docx|txt)$/i.test(item.filename || "");
}

function isCourseTranscript(item: CreationItem): boolean {
  return item.metadata?.kind === "transcript" ||
    /^oria-cours-transcription-[a-f0-9]{16}\.txt$/i.test(item.filename || "");
}

function getPreviewKind(item: CreationItem): PreviewKind {
  const ext = artifactExtension(item);
  if (ext === "pdf" || ext === "docx" || ext === "xlsx") return ext;
  return TEXT_PREVIEW_TYPES.has(ext) ? "text" : "unsupported";
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // URLs non HTTPS (javascript:, file:, data:, etc.) interdites.
  if (!/^https:\/\/[^\s/]+/i.test(text)) return null;
  return text;
}

function mergeCreationLists(regular: CreationItem[], artifacts: CreationItem[]): CreationItem[] {
  const byId = new Map<string, CreationItem>();
  for (const item of regular) {
    if (item && typeof item.id === "string" && item.id.trim()) byId.set(item.id, item);
  }
  for (const item of artifacts) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
    const previous = byId.get(item.id);
    byId.set(item.id, {
      ...previous, ...item, creation_type: "artifact",
      metadata: item.metadata || previous?.metadata || null,
    });
  }
  return [...byId.values()].sort((a,b) =>
    (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));
}

function blockText(block: DocBlock): string {
  if (typeof block.text === "string") return block.text;
  if (Array.isArray(block.runs)) return block.runs.map((value: unknown) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "text" in value) {
      const part = (value as { text?: unknown }).text;
      return typeof part === "string" ? part : "";
    }
    return "";
  }).join("");
  return "";
}

function DocPreviewText({ block, color }: { block: DocBlock; color: string }) {
  if (!Array.isArray(block.runs)) return <Text style={{ color }}>{blockText(block)}</Text>;
  return <Text style={{ color }}>{block.runs.map((value: unknown, index: number) => {
    if (typeof value === "string") return <Text key={index}>{value}</Text>;
    if (!value || typeof value !== "object") return null;
    const run = value as Record<string, unknown>;
    const text = typeof run.text === "string" ? run.text : "";
    return <Text key={index} style={{
      fontWeight: run.bold ? "700" : "400",
      fontStyle: run.italic ? "italic" : "normal",
      textDecorationLine: run.underline ? "underline" : "none",
      fontSize: run.superscript || run.subscript ? 10 : 14,
      lineHeight: run.superscript || run.subscript ? 17 : 23,
    }}>{text}</Text>;
  })}</Text>;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "text" in value) return String((value as {text?: unknown}).text || "");
  return "";
}

type CreationsResponse = {
  success?: boolean;
  creations?: CreationItem[];
  detail?: string;
  message?: string;
};

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const OriaThemeContext =
  React.createContext<OriaTheme>("light");

const UI = {
  fr: {
    unknownDate: "Date inconnue",
    sessionExpired:
      "Votre session a expiré. Veuillez vous reconnecter.",
    backendMissing:
      "L'URL du backend n'est pas configurée dans l'application mobile.",
    loadFailed:
      "Impossible de récupérer vos créations.",
    loadError:
      "Une erreur est survenue pendant le chargement.",
    fileUnavailable:
      "Le fichier de cette création n'est plus disponible.",
    tempStorageUnavailable:
      "Espace de stockage temporaire indisponible.",
    downloadImpossible:
      "Téléchargement impossible.",
    saveOrShare:
      "Enregistrer ou partager votre création",
    downloadedTitle:
      "Création téléchargée",
    downloadedMessage:
      "Le fichier a été téléchargé dans l'espace local de l'application.",
    downloadTitle: "Téléchargement",
    downloadFailed:
      "Impossible de télécharger cette création.",
    deleteTitle:
      "Supprimer la création",
    deleteQuestion:
      "Supprimer définitivement cette création ?",
    cancel: "Annuler",
    delete: "Supprimer",
    deleteFailed:
      "Impossible de supprimer cette création.",
    backToChat: "Retour au chat",
    myCreations: "Mes créations",
    description:
      "Retrouvez ici vos images, vidéos et fichiers générés avec Oria.",
    refresh: "Actualiser",
    creationSingular: "création",
    creationPlural: "créations",
    imageSingular: "image",
    imagePlural: "images",
    videoSingular: "vidéo",
    videoPlural: "vidéos",
    fileSingular: "fichier",
    filePlural: "fichiers",
    all: "Toutes",
    images: "Images",
    videos: "Vidéos",
    files: "Fichiers",
    loading:
      "Chargement de vos créations…",
    emptyTitle:
      "Aucune création pour le moment",
    emptyDescription:
      "Vos images, vidéos et fichiers générés avec Oria apparaîtront automatiquement ici.",
    createSomething:
      "Créer quelque chose",
    emptyFilter:
      "Aucune création dans cette catégorie.",
    generatedCreation:
      "Création générée avec Oria",
    image: "Image",
    video: "Vidéo",
    file: "Fichier",
    noDescription:
      "Création sans description",
    open: "Ouvrir",
    download: "Télécharger",
    close: "Fermer",
    unavailable:
      "Ce fichier n'est plus disponible.",
    byte: "o",
    kilobyte: "Ko",
    megabyte: "Mo",
    preview: "Aperçu",
    previewFailed: "Aperçu indisponible. Vous pouvez toujours télécharger le fichier.",
    previewUnsupported: "Aperçu non disponible pour ce format. Vous pouvez télécharger le fichier.",
    noPreviewContent: "Aucun contenu lisible dans l’aperçu.",
    partialPreview: "Aperçu partiel : téléchargez le fichier pour voir tout le contenu.",
    partialLibrary: "Certaines créations n’ont pas pu être chargées. Actualisez pour réessayer.",
    course: "ORIA Cours",
    transcript: "Transcription",
    pdfNative: "Ouvrir le PDF dans le lecteur de l’appareil",
    previewLoading: "Préparation de l’aperçu…",
  },
  en: {
    unknownDate: "Unknown date",
    sessionExpired:
      "Your session has expired. Please sign in again.",
    backendMissing:
      "The backend URL is not configured in the mobile application.",
    loadFailed:
      "Unable to retrieve your creations.",
    loadError:
      "An error occurred while loading.",
    fileUnavailable:
      "The file for this creation is no longer available.",
    tempStorageUnavailable:
      "Temporary storage is unavailable.",
    downloadImpossible:
      "Download failed.",
    saveOrShare:
      "Save or share your creation",
    downloadedTitle:
      "Creation downloaded",
    downloadedMessage:
      "The file was downloaded to the app's local storage.",
    downloadTitle: "Download",
    downloadFailed:
      "Unable to download this creation.",
    deleteTitle:
      "Delete creation",
    deleteQuestion:
      "Permanently delete this creation?",
    cancel: "Cancel",
    delete: "Delete",
    deleteFailed:
      "Unable to delete this creation.",
    backToChat: "Back to chat",
    myCreations: "My creations",
    description:
      "Find your images, videos and files generated with Oria.",
    refresh: "Refresh",
    creationSingular: "creation",
    creationPlural: "creations",
    imageSingular: "image",
    imagePlural: "images",
    videoSingular: "video",
    videoPlural: "videos",
    fileSingular: "file",
    filePlural: "files",
    all: "All",
    images: "Images",
    videos: "Videos",
    files: "Files",
    loading:
      "Loading your creations…",
    emptyTitle:
      "No creations yet",
    emptyDescription:
      "Your images, videos and files generated with Oria will automatically appear here.",
    createSomething:
      "Create something",
    emptyFilter:
      "No creations in this category.",
    generatedCreation:
      "Creation generated with Oria",
    image: "Image",
    video: "Video",
    file: "File",
    noDescription:
      "Creation without description",
    open: "Open",
    download: "Download",
    close: "Close",
    unavailable:
      "This file is no longer available.",
    byte: "B",
    kilobyte: "KB",
    megabyte: "MB",
    preview: "Preview",
    previewFailed: "Preview unavailable. You can still download the file.",
    previewUnsupported: "Preview is not available for this format. You can download it.",
    noPreviewContent: "No readable content in the preview.",
    partialPreview: "Partial preview: download the file to see everything.",
    partialLibrary: "Some creations could not be loaded. Refresh to retry.",
    course: "ORIA Course",
    transcript: "Transcript",
    pdfNative: "Open PDF in the device viewer",
    previewLoading: "Preparing preview…",
  },
} as const;

async function readOriaLanguage(): Promise<OriaLanguage> {
  try {
    if (Platform.OS === "web") {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(
              ORIA_LANGUAGE_STORAGE_KEY,
            )
          : null;

      if (saved === "fr" || saved === "en") {
        return saved;
      }

      return typeof navigator !== "undefined" &&
        navigator.language
          .toLowerCase()
          .startsWith("en")
        ? "en"
        : "fr";
    }

    const saved =
      await SecureStore.getItemAsync(
        ORIA_LANGUAGE_STORAGE_KEY,
      );

    return saved === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

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

    return data?.theme === "dark"
      ? "dark"
      : "light";
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
      r: parseInt(
        color[1] + color[1],
        16,
      ),
      g: parseInt(
        color[2] + color[2],
        16,
      ),
      b: parseInt(
        color[3] + color[3],
        16,
      ),
    };
  }

  if (
    color.length === 7 ||
    color.length === 9
  ) {
    return {
      r: parseInt(
        color.slice(1, 3),
        16,
      ),
      g: parseInt(
        color.slice(3, 5),
        16,
      ),
      b: parseInt(
        color.slice(5, 7),
        16,
      ),
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
  if (!rgb) return value;

  const max = Math.max(
    rgb.r,
    rgb.g,
    rgb.b,
  );
  const min = Math.min(
    rgb.r,
    rgb.g,
    rgb.b,
  );

  if (max - min > 28) {
    return value;
  }

  const luminance =
    (0.2126 * rgb.r +
      0.7152 * rgb.g +
      0.0722 * rgb.b) /
    255;

  if (property === "color") {
    if (luminance >= 0.82) return value;
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
    return luminance >= 0.45
      ? "#303036"
      : "#3a3a40";
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

function buildDarkStyleOverride(
  style: unknown,
) {
  const flattened =
    StyleSheet.flatten(style as any);

  if (!flattened) return undefined;

  const override: Record<
    string,
    unknown
  > = {};

  const properties = [
    "color",
    "backgroundColor",
    "borderColor",
    "borderTopColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderRightColor",
  ] as const;

  for (const property of properties) {
    const value = flattened[property];

    if (
      typeof value === "string" &&
      value.startsWith("#")
    ) {
      override[property] =
        darkThemeNeutral(
          value,
          property,
        );
    }
  }

  return Object.keys(override).length > 0
    ? override
    : undefined;
}

function getThemedStyles(
  theme: OriaTheme,
) {
  if (theme === "light") {
    return baseStyles;
  }

  const themed: Record<
    string,
    unknown
  > = {};

  for (
    const key of Object.keys(
      baseStyles,
    )
  ) {
    const style =
      baseStyles[
        key as keyof typeof baseStyles
      ];

    themed[key] = [
      style,
      buildDarkStyleOverride(
        style,
      ),
    ];
  }

  return themed as unknown as typeof baseStyles;
}

function useThemedStyles() {
  const theme =
    React.useContext(
      OriaThemeContext,
    );

  return useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
}

function themedIconColor(
  value: string,
  isDark: boolean,
) {
  return isDark
    ? darkThemeNeutral(value, "color")
    : value;
}

function getCreationKind(item: CreationItem): CreationKind {
  const explicit = String(item.creation_type || "").toLowerCase();
  const type = String(item.media_type || item.type || "").toLowerCase();
  // Les médias peuvent eux aussi posséder une extension (.png, .mp4) :
  // un type explicite doit primer sur cette propriété.
  if (explicit === "video" || type === "video") return "video";
  if (explicit === "image" || type === "image") return "image";
  if (explicit === "artifact" || type === "file" || Boolean(item.extension)) return "artifact";
  return "image";
}

function getMediaUrl(
  item: CreationItem,
) {
  const value =
    item.public_url ||
    item.media_url ||
    item.url ||
    null;

  if (
    !value ||
    typeof value !== "string"
  ) {
    return null;
  }

  return value.trim() || null;
}

function getArtifactUrl(
  item: CreationItem,
) {
  const value =
    item.download_url ||
    item.url ||
    null;

  if (
    !value ||
    typeof value !== "string"
  ) {
    return null;
  }

  return value.trim() || null;
}

function formatDate(
  value: string | null | undefined,
  language: OriaLanguage,
) {
  if (!value) {
    return UI[language].unknownDate;
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return UI[language].unknownDate;
  }

  return new Intl.DateTimeFormat(
    language === "en"
      ? "en-US"
      : "fr-FR",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(date);
}

function formatSize(
  value: number | null | undefined,
  language: OriaLanguage,
) {
  if (!value || value <= 0) {
    return null;
  }

  if (value < 1024) {
    return `${value} ${
      UI[language].byte
    }`;
  }

  if (value < 1024 * 1024) {
    return `${(
      value / 1024
    ).toFixed(1)} ${
      UI[language].kilobyte
    }`;
  }

  return `${(
    value /
    (1024 * 1024)
  ).toFixed(1)} ${
    UI[language].megabyte
  }`;
}

function safeFilename(
  item: CreationItem,
) {
  if (item.filename?.trim()) {
    return item.filename.trim();
  }

  const kind =
    getCreationKind(item);

  if (kind === "video") {
    return `oria-${item.id}.mp4`;
  }

  if (kind === "image") {
    return `oria-${item.id}.png`;
  }

  const extension =
    item.extension
      ?.replace(/^\./, "") ||
    "bin";

  return `oria-${item.id}.${extension}`;
}

function getFileLabel(
  item: CreationItem,
  language: OriaLanguage,
) {
  const extension =
    item.extension
      ?.replace(/^\./, "")
      .toUpperCase();

  if (extension) {
    return extension;
  }

  return (
    item.category ||
    UI[language].file
  );
}

function getActionLabel(
  action?: string | null,
) {
  if (!action) return null;

  return action
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase(),
    );
}

function VideoPreview({
  uri,
  controls = false,
  autoPlay = false,
}: {
  uri: string;
  controls?: boolean;
  autoPlay?: boolean;
}) {
  const styles =
    useThemedStyles();

  const player = useVideoPlayer(
    uri,
    (instance) => {
      instance.loop = false;

      if (autoPlay) {
        instance.play();
      }
    },
  );

  return (
    <VideoView
      player={player}
      style={styles.mediaContent}
      contentFit="cover"
      nativeControls={controls}
    />
  );
}

export default function CreationsPage() {
  const { width } =
    useWindowDimensions();

  const [
    language,
    setLanguage,
  ] =
    useState<OriaLanguage>(
      "fr",
    );

  const [
    theme,
    setTheme,
  ] =
    useState<OriaTheme>(
      "light",
    );

  const isDark =
    theme === "dark";

  const styles =
    useMemo(
      () =>
        getThemedStyles(
          theme,
        ),
      [theme],
    );

  const t =
    UI[language];

  const [
    creations,
    setCreations,
  ] =
    useState<CreationItem[]>(
      [],
    );

  const [
    filter,
    setFilter,
  ] =
    useState<FilterType>(
      "all",
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    selectedMedia,
    setSelectedMedia,
  ] =
    useState<
      CreationItem | null
    >(null);

  const [
    deletingId,
    setDeletingId,
  ] =
    useState<
      string | null
    >(null);

  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreview | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [openingPdf, setOpeningPdf] = useState(false);
  const loadRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const initialLibraryLoaded = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void Promise.all([
        readOriaLanguage(),
        readOriaTheme(),
      ]).then(
        ([
          savedLanguage,
          savedTheme,
        ]) => {
          if (active) {
            setLanguage(
              savedLanguage,
            );
            setTheme(
              savedTheme,
            );
          }
        },
      );

      return () => {
        active = false;
      };
    }, []),
  );

  const getSession =
    useCallback(async () => {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (
        !session?.user?.id ||
        !session.access_token
      ) {
        throw new Error(
          t.sessionExpired,
        );
      }

      return session;
    }, [t.sessionExpired]);

  const authenticatedFetch =
    useCallback(
      async (
        path: string,
        options: RequestInit = {},
      ) => {
        const session =
          await getSession();

        if (!API_BASE_URL) {
          throw new Error(
            t.backendMissing,
          );
        }

        const headers =
          new Headers(
            options.headers,
          );

        headers.set(
          "Authorization",
          `Bearer ${session.access_token}`,
        );

        headers.set(
          "user-id",
          session.user.id,
        );

        if (
          options.body &&
          !(
            options.body instanceof
            FormData
          )
        ) {
          headers.set(
            "Content-Type",
            "application/json",
          );
        }

        return fetch(
          `${API_BASE_URL}${path}`,
          {
            ...options,
            headers,
          },
        );
      },
      [
        getSession,
        t.backendMissing,
      ],
    );

  const loadCreations = useCallback(async (showRefreshState = false, silent = false) => {
    const requestId = ++loadRequestId.current;
    if (showRefreshState) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) { setError(null); setSyncWarning(null); }
    try {
      // /creations garde la liste des médias ; /artifacts garantit la présence
      // des PDF, DOCX et TXT ORIA Cours même si la liste générale tarde à évoluer.
      const parseResponse = async <T extends ApiError>(response: Response): Promise<T> => {
        const payload = await response.json().catch(() => ({} as T)) as T;
        if (!response.ok) throw new Error(payload.detail || payload.message || t.loadFailed);
        return payload;
      };
      const [all, files] = await Promise.allSettled([
        authenticatedFetch("/creations?limit=100").then(r => parseResponse<CreationsResponse>(r)),
        authenticatedFetch("/artifacts?limit=100&offset=0").then(r => parseResponse<ArtifactListResponse>(r)),
      ]);
      if (all.status === "rejected" && files.status === "rejected") throw new Error(t.loadFailed);
      if (loadRequestId.current !== requestId) return;
      const regular = all.status === "fulfilled" && Array.isArray(all.value.creations) ? all.value.creations : [];
      const artifacts = files.status === "fulfilled" && Array.isArray(files.value.artifacts) ? files.value.artifacts : [];
      setCreations(mergeCreationLists(regular, artifacts));
      setSyncWarning(all.status === "rejected" || files.status === "rejected" ? t.partialLibrary : null);
      setError(null);
    } catch (requestError) {
      if (loadRequestId.current !== requestId) return;
      if (!silent) setError(requestError instanceof Error ? requestError.message : t.loadError);
    } finally {
      if (loadRequestId.current === requestId) {
        initialLibraryLoaded.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authenticatedFetch, t.loadError, t.loadFailed, t.partialLibrary]);

  useFocusEffect(useCallback(() => {
    // Synchronise à chaque retour sur la page, au retour au premier plan,
    // et toutes les 45 secondes pendant qu’elle est ouverte.
    void loadCreations(false, initialLibraryLoaded.current);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadCreations(false, true);
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void loadCreations(false, true);
    }, SYNC_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(interval);
      ++loadRequestId.current;
      ++previewRequestId.current;
    };
  }, [loadCreations]));

  const counts =
    useMemo(() => {
      const result = {
        image: 0,
        video: 0,
        artifact: 0,
      };

      for (
        const item of creations
      ) {
        result[
          getCreationKind(
            item,
          )
        ] += 1;
      }

      return result;
    }, [creations]);

  const filteredCreations =
    useMemo(() => {
      if (
        filter === "all"
      ) {
        return creations;
      }

      return creations.filter(
        (item) =>
          getCreationKind(
            item,
          ) === filter,
      );
    }, [creations, filter]);

  const resolveArtifact = useCallback(async (item: CreationItem): Promise<CreationItem> => {
    // Ne jamais réutiliser une URL signée provenant d’une ancienne session.
    const response = await authenticatedFetch(`/artifacts/${encodeURIComponent(item.id)}`);
    const payload = await response.json().catch(() => ({})) as { artifact?: CreationItem } & ApiError;
    if (!response.ok || !payload.artifact?.id || payload.artifact.id !== item.id) {
      throw new Error(payload.detail || payload.message || t.fileUnavailable);
    }
    const updated = { ...item, ...payload.artifact, creation_type: "artifact" as const };
    setCreations(current => current.map(entry => entry.id === item.id ? updated : entry));
    return updated;
  }, [authenticatedFetch, t.fileUnavailable]);

  const downloadToDevice = useCallback(async (item: CreationItem, url: string, share = true): Promise<File> => {
    const trustedUrl = safeRemoteUrl(url);
    if (!trustedUrl) throw new Error(t.fileUnavailable);
    // Expo FileSystem moderne : downloadAsync de l’ancien namespace peut lever
    // une exception au runtime sur SDK récents. Identifiants privés uniques.
    const filename = safeFilename(item).replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 100);
    const file = new File(Paths.cache, `oria-${item.id}-${filename || "fichier"}`);
    const result = await File.downloadFileAsync(trustedUrl, file, { idempotent: true });
    if (!result.exists || result.size <= 0 || result.size > 50 * 1024 * 1024) {
      throw new Error(t.downloadImpossible);
    }
    if (share) {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: item.mime_type || undefined, dialogTitle: t.saveOrShare,
        });
      } else {
        Alert.alert(t.downloadedTitle, t.downloadedMessage);
      }
    }
    return result;
  }, [t.downloadImpossible, t.downloadedMessage, t.downloadedTitle, t.fileUnavailable, t.saveOrShare]);

  const handleDownload = useCallback(async (item: CreationItem) => {
    try {
      const kind = getCreationKind(item);
      const updated = kind === "artifact" ? await resolveArtifact(item) : item;
      const url = kind === "artifact" ? getArtifactUrl(updated) : getMediaUrl(updated);
      if (!url) throw new Error(t.fileUnavailable);
      await downloadToDevice(updated, url);
    } catch (error) {
      Alert.alert(t.downloadTitle, error instanceof Error ? error.message : t.downloadFailed);
    }
  }, [downloadToDevice, resolveArtifact, t.downloadFailed, t.downloadTitle, t.fileUnavailable]);

  const closeArtifactPreview = useCallback(() => {
    ++previewRequestId.current;
    setArtifactPreview(null);
  }, []);

  const handleOpen = useCallback(async (item: CreationItem) => {
    if (getCreationKind(item) !== "artifact") {
      setSelectedMedia(item);
      return;
    }
    const kind = getPreviewKind(item);
    const id = ++previewRequestId.current;
    setArtifactPreview({ item, kind, loading: kind !== "unsupported" && kind !== "pdf" });
    if (kind === "unsupported" || kind === "pdf") return;
    try {
      if (kind === "docx" || kind === "xlsx") {
        const endpoint = kind === "docx" ? "document-preview" : "spreadsheet-preview";
        const response = await authenticatedFetch(`/artifacts/${encodeURIComponent(item.id)}/${endpoint}`);
        const data = await response.json().catch(() => ({})) as DocPreview & SpreadsheetPreview;
        if (!response.ok) throw new Error(data.detail || data.message || t.previewFailed);
        if (previewRequestId.current !== id) return;
        setArtifactPreview({ item, kind, loading: false,
          ...(kind === "docx" ? { document: data } : { spreadsheet: data }) });
        return;
      }
      // Pour le TXT, télécharger temporairement dans le cache privé, vérifier
      // la taille avant de décoder. Ne jamais passer par un visualiseur externe.
      const updated = await resolveArtifact(item);
      if (previewRequestId.current !== id) return;
      if (updated.size_bytes && updated.size_bytes > MAX_TEXT_PREVIEW_BYTES) {
        throw new Error(t.partialPreview);
      }
      const url = getArtifactUrl(updated);
      if (!url) throw new Error(t.fileUnavailable);
      const file = await downloadToDevice(updated, url, false);
      if (file.size > MAX_TEXT_PREVIEW_BYTES) throw new Error(t.partialPreview);
      const text = (await file.text()).slice(0, MAX_TEXT_PREVIEW_CHARS);
      try { file.delete(); } catch { /* Cache éphémère, suppression au nettoyage système. */ }
      if (previewRequestId.current !== id) return;
      setArtifactPreview({ item: updated, kind, loading: false, text });
    } catch (error) {
      if (previewRequestId.current !== id) return;
      setArtifactPreview({ item, kind, loading: false,
        error: error instanceof Error ? error.message : t.previewFailed });
    }
  }, [authenticatedFetch, downloadToDevice, resolveArtifact, t.fileUnavailable, t.partialPreview, t.previewFailed]);

  const openPdfPreview = useCallback(async (item: CreationItem) => {
    setOpeningPdf(true);
    try {
      const updated = await resolveArtifact(item);
      const url = safeRemoteUrl(updated.preview_url || getArtifactUrl(updated));
      if (!url) throw new Error(t.fileUnavailable);
      if (Platform.OS === "web") {
        await Linking.openURL(url);
        return;
      }
      const file = await downloadToDevice(updated, url, false);
      // SDK récents : iOS ouvre Quick Look, Android un lecteur PDF installé.
      // Ne jamais envoyer le lien privé vers Google Docs Viewer ou un CDN.
      const viewer = File as unknown as {
        canPreview?: (file: File, options?: { mimeType?: string }) => Promise<boolean>;
        preview?: (file: File, options?: { mimeType?: string; title?: string }) => Promise<void>;
      };
      if (typeof viewer.canPreview === "function" && typeof viewer.preview === "function"
          && await viewer.canPreview(file, { mimeType: "application/pdf" })) {
        await viewer.preview(file, { title: safeFilename(updated), mimeType: "application/pdf" });
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: t.preview });
        return;
      }
      throw new Error(t.previewFailed);
    } catch (error) {
      Alert.alert(t.preview, error instanceof Error ? error.message : t.previewFailed);
    } finally {
      setOpeningPdf(false);
    }
  }, [downloadToDevice, resolveArtifact, t.fileUnavailable, t.preview, t.previewFailed]);

  const handleDelete =
    useCallback(
      async (
        item: CreationItem,
      ) => {
        // Les fichiers pédagogiques achevés sont protégés côté PostgreSQL.
        if (isCourseArtifact(item)) return;
        Alert.alert(
          t.deleteTitle,
          t.deleteQuestion,
          [
            {
              text: t.cancel,
              style: "cancel",
            },
            {
              text: t.delete,
              style:
                "destructive",
              onPress:
                async () => {
                  setDeletingId(
                    item.id,
                  );
                  setError(null);

                  try {
                    const kind =
                      getCreationKind(
                        item,
                      );

                    const endpoint =
                      kind ===
                      "artifact"
                        ? `/artifacts/${encodeURIComponent(
                            item.id,
                          )}`
                        : `/media/${encodeURIComponent(
                            item.id,
                          )}`;

                    const response =
                      await authenticatedFetch(
                        endpoint,
                        {
                          method:
                            "DELETE",
                        },
                      );

                    let payload: {
                      detail?: string;
                      message?: string;
                    } = {};

                    try {
                      payload =
                        await response.json();
                    } catch {
                      payload =
                        {};
                    }

                    if (
                      !response.ok
                    ) {
                      throw new Error(
                        payload.detail ||
                          payload.message ||
                          t.deleteFailed,
                      );
                    }

                    setCreations(
                      (current) =>
                        current.filter(
                          (
                            creation,
                          ) =>
                            creation.id !==
                            item.id,
                        ),
                    );

                    setSelectedMedia(
                      (current) =>
                        current?.id ===
                        item.id
                          ? null
                          : current,
                    );
                  } catch (
                    requestError
                  ) {
                    setError(
                      requestError instanceof
                        Error
                        ? requestError.message
                        : t.deleteFailed,
                    );
                  } finally {
                    setDeletingId(
                      null,
                    );
                  }
                },
            },
          ],
        );
      },
      [
        authenticatedFetch,
        t.cancel,
        t.delete,
        t.deleteFailed,
        t.deleteQuestion,
        t.deleteTitle,
      ],
    );

  const columns =
    width >= 850
      ? 3
      : width >= 520
        ? 2
        : 1;

  const gap = 14;
  const cardWidth =
    (width -
      40 -
      gap *
        (columns - 1)) /
    columns;

  const filters: Array<{
    value: FilterType;
    label: string;
    count: number;
  }> = [
    {
      value: "all",
      label: t.all,
      count:
        creations.length,
    },
    {
      value: "image",
      label: t.images,
      count:
        counts.image,
    },
    {
      value: "video",
      label: t.videos,
      count:
        counts.video,
    },
    {
      value: "artifact",
      label: t.files,
      count:
        counts.artifact,
    },
  ];

  return (
    <OriaThemeContext.Provider
      value={theme}
    >
      <SafeAreaView
        style={
          styles.safeArea
        }
      >
        <StatusBar
          barStyle={
            isDark
              ? "light-content"
              : "dark-content"
          }
        />

        <ScrollView
          contentContainerStyle={
            styles.container
          }
          showsVerticalScrollIndicator={
            false
          }
          refreshControl={
            <RefreshControl
              refreshing={
                refreshing
              }
              onRefresh={() =>
                void loadCreations(
                  true,
                )
              }
              tintColor={themedIconColor(
                "#17171b",
                isDark,
              )}
              colors={[
                themedIconColor(
                  "#17171b",
                  isDark,
                ),
              ]}
            />
          }
        >
          <View
            style={styles.header}
          >
            <View
              style={
                styles.headerLeft
              }
            >
              <Pressable
                onPress={() =>
                  router.push(
                    "/chat" as any,
                  )
                }
                style={
                  styles.backLink
                }
              >
                <Ionicons
                  name="arrow-back"
                  size={16}
                  color={themedIconColor(
                    "#6f6f77",
                    isDark,
                  )}
                />
                <Text
                  style={
                    styles.backText
                  }
                >
                  {t.backToChat}
                </Text>
              </Pressable>

              <View
                style={
                  styles.titleRow
                }
              >
                <View
                  style={
                    styles.logo
                  }
                >
                  <Text
                    style={
                      styles.logoText
                    }
                  >
                    N
                  </Text>
                </View>

                <View>
                  <Text
                    style={
                      styles.eyebrow
                    }
                  >
                    Oria
                  </Text>
                  <Text
                    style={
                      styles.title
                    }
                  >
                    {t.myCreations}
                  </Text>
                </View>
              </View>

              <Text
                style={
                  styles.description
                }
              >
                {t.description}
              </Text>
            </View>

            <Pressable
              onPress={() =>
                void loadCreations(
                  true,
                )
              }
              disabled={
                loading ||
                refreshing
              }
              style={({
                pressed,
              }) => [
                styles.refreshButton,
                pressed &&
                  styles.pressed,
                (loading ||
                  refreshing) &&
                  styles.disabled,
              ]}
            >
              <Ionicons
                name="refresh-outline"
                size={17}
                color={themedIconColor(
                  "#17171b",
                  isDark,
                )}
              />
              <Text
                style={
                  styles.refreshText
                }
              >
                {t.refresh}
              </Text>
            </Pressable>
          </View>

          {!loading &&
            !error &&
            creations.length >
              0 && (
              <View
                style={
                  styles.stats
                }
              >
                <View
                  style={
                    styles.statDark
                  }
                >
                  <Text
                    style={
                      styles.statDarkText
                    }
                  >
                    {
                      creations.length
                    }{" "}
                    {creations.length >
                    1
                      ? t.creationPlural
                      : t.creationSingular}
                  </Text>
                </View>

                <View
                  style={
                    styles.statLight
                  }
                >
                  <Text
                    style={
                      styles.statLightText
                    }
                  >
                    {counts.image}{" "}
                    {counts.image >
                    1
                      ? t.imagePlural
                      : t.imageSingular}
                  </Text>
                </View>

                <View
                  style={
                    styles.statLight
                  }
                >
                  <Text
                    style={
                      styles.statLightText
                    }
                  >
                    {counts.video}{" "}
                    {counts.video >
                    1
                      ? t.videoPlural
                      : t.videoSingular}
                  </Text>
                </View>

                <View
                  style={
                    styles.statLight
                  }
                >
                  <Text
                    style={
                      styles.statLightText
                    }
                  >
                    {
                      counts.artifact
                    }{" "}
                    {counts.artifact >
                    1
                      ? t.filePlural
                      : t.fileSingular}
                  </Text>
                </View>
              </View>
            )}

          {!loading &&
            creations.length >
              0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={
                  false
                }
                contentContainerStyle={
                  styles.filters
                }
              >
                {filters.map(
                  (item) => {
                    const active =
                      filter ===
                      item.value;

                    return (
                      <Pressable
                        key={
                          item.value
                        }
                        onPress={() =>
                          setFilter(
                            item.value,
                          )
                        }
                        style={[
                          styles.filterButton,
                          active &&
                            styles.filterActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterText,
                            active &&
                              styles.filterTextActive,
                          ]}
                        >
                          {
                            item.label
                          }{" "}
                          <Text
                            style={
                              active
                                ? styles.countActive
                                : styles.count
                            }
                          >
                            {
                              item.count
                            }
                          </Text>
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </ScrollView>
            )}

          {!!syncWarning && !error && (
            <View style={styles.syncWarningBox}>
              <Ionicons name="information-circle-outline" size={18} color={isDark ? "#d1c8a1" : "#856719"} />
              <Text style={styles.syncWarningText}>{syncWarning}</Text>
            </View>
          )}
          {!!error && (
            <View
              style={
                styles.errorBox
              }
            >
              <View
                style={
                  styles.errorContent
                }
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={themedIconColor(
                    "#b42318",
                    isDark,
                  )}
                />
                <Text
                  style={
                    styles.errorText
                  }
                >
                  {error}
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setError(null)
                }
                style={
                  styles.errorClose
                }
              >
                <Ionicons
                  name="close"
                  size={18}
                  color={themedIconColor(
                    "#b42318",
                    isDark,
                  )}
                />
              </Pressable>
            </View>
          )}

          {loading && (
            <View
              style={
                styles.loadingBox
              }
            >
              <ActivityIndicator
                size="large"
                color={themedIconColor(
                  "#17171b",
                  isDark,
                )}
              />
              <Text
                style={
                  styles.loadingText
                }
              >
                {t.loading}
              </Text>
            </View>
          )}

          {!loading &&
            !error &&
            creations.length ===
              0 && (
              <View
                style={
                  styles.emptyBox
                }
              >
                <View
                  style={
                    styles.emptyIcon
                  }
                >
                  <Ionicons
                    name="folder-open-outline"
                    size={31}
                    color={themedIconColor(
                      "#777780",
                      isDark,
                    )}
                  />
                </View>

                <Text
                  style={
                    styles.emptyTitle
                  }
                >
                  {t.emptyTitle}
                </Text>

                <Text
                  style={
                    styles.emptyDescription
                  }
                >
                  {
                    t.emptyDescription
                  }
                </Text>

                <Pressable
                  onPress={() =>
                    router.push(
                      "/chat" as any,
                    )
                  }
                  style={
                    styles.createButton
                  }
                >
                  <Text
                    style={
                      styles.createButtonText
                    }
                  >
                    {
                      t.createSomething
                    }
                  </Text>
                </Pressable>
              </View>
            )}

          {!loading &&
            !error &&
            creations.length >
              0 &&
            filteredCreations.length ===
              0 && (
              <View
                style={
                  styles.filterEmpty
                }
              >
                <Text
                  style={
                    styles.filterEmptyText
                  }
                >
                  {t.emptyFilter}
                </Text>
              </View>
            )}

          {!loading &&
            !error &&
            filteredCreations.length >
              0 && (
              <View
                style={
                  styles.gallery
                }
              >
                {filteredCreations.map(
                  (item) => {
                    const kind =
                      getCreationKind(
                        item,
                      );

                    const url =
                      kind ===
                      "artifact"
                        ? null
                        : getMediaUrl(
                            item,
                          );

                    const size =
                      formatSize(
                        item.size_bytes ??
                          item.size,
                        language,
                      );

                    const action =
                      getActionLabel(
                        item.action,
                      );

                    if (
                      kind ===
                      "artifact"
                    ) {
                      return (
                        <View
                          key={
                            item.id
                          }
                          style={[
                            styles.fileCard,
                            {
                              width:
                                cardWidth,
                            },
                          ]}
                        >
                          <Pressable
                            onPress={() =>
                              void handleOpen(
                                item,
                              )
                            }
                            style={({
                              pressed,
                            }) => [
                              styles.fileCardMain,
                              pressed &&
                                styles.previewPressed,
                            ]}
                          >
                            <View
                              style={
                                styles.fileIcon
                              }
                            >
                              <Ionicons
                                name="document-text-outline"
                                size={30}
                                color={themedIconColor(
                                  "#55555d",
                                  isDark,
                                )}
                              />
                            </View>

                            <Text
                              style={
                                styles.fileName
                              }
                              numberOfLines={
                                2
                              }
                            >
                              {safeFilename(
                                item,
                              )}
                            </Text>

                            <Text
                              style={
                                styles.date
                              }
                            >
                              {formatDate(
                                item.created_at,
                                language,
                              )}
                            </Text>

                            <View
                              style={
                                styles.meta
                              }
                            >
                              <View
                                style={
                                  styles.metaPill
                                }
                              >
                                <Text
                                  style={
                                    styles.metaText
                                  }
                                >
                                  {getFileLabel(
                                    item,
                                    language,
                                  )}
                                </Text>
                              </View>

                              {isCourseArtifact(item) && (
                                <View style={styles.metaPill}>
                                  <Text style={styles.metaText}>{t.course}{isCourseTranscript(item) ? ` · ${t.transcript}` : ""}</Text>
                                </View>
                              )}
                              {!!size && (
                                <View
                                  style={
                                    styles.metaPill
                                  }
                                >
                                  <Text
                                    style={
                                      styles.metaText
                                    }
                                  >
                                    {size}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </Pressable>

                          <View
                            style={
                              styles.fileActions
                            }
                          >
                            <Pressable
                              onPress={() =>
                                void handleOpen(
                                  item,
                                )
                              }
                              style={
                                styles.actionButton
                              }
                              accessibilityLabel={
                                t.open
                              }
                            >
                              <Ionicons
                                name="eye-outline"
                                size={17}
                                color={themedIconColor(
                                  "#55555d",
                                  isDark,
                                )}
                              />
                            </Pressable>

                            <Pressable
                              onPress={() =>
                                void handleDownload(
                                  item,
                                )
                              }
                              style={
                                styles.actionButton
                              }
                              accessibilityLabel={
                                t.download
                              }
                            >
                              <Ionicons
                                name="download-outline"
                                size={17}
                                color={themedIconColor(
                                  "#55555d",
                                  isDark,
                                )}
                              />
                            </Pressable>

                            {!isCourseArtifact(item) && <Pressable
                              onPress={() =>
                                void handleDelete(
                                  item,
                                )
                              }
                              disabled={
                                deletingId ===
                                item.id
                              }
                              style={[
                                styles.actionButton,
                                deletingId ===
                                  item.id &&
                                  styles.disabled,
                              ]}
                              accessibilityLabel={
                                t.delete
                              }
                            >
                              {deletingId ===
                              item.id ? (
                                <ActivityIndicator
                                  size="small"
                                  color={themedIconColor(
                                    "#777780",
                                    isDark,
                                  )}
                                />
                              ) : (
                                <Ionicons
                                  name="trash-outline"
                                  size={17}
                                  color={themedIconColor(
                                    "#777780",
                                    isDark,
                                  )}
                                />
                              )}
                            </Pressable>}
                          </View>
                        </View>
                      );
                    }

                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.card,
                          {
                            width:
                              cardWidth,
                          },
                        ]}
                      >
                        <Pressable
                          onPress={() =>
                            setSelectedMedia(
                              item,
                            )
                          }
                          style={({
                            pressed,
                          }) => [
                            styles.preview,
                            pressed &&
                              styles.previewPressed,
                          ]}
                        >
                          {url ? (
                            kind ===
                            "image" ? (
                              <Image
                                source={{
                                  uri: url,
                                }}
                                style={
                                  styles.mediaContent
                                }
                                resizeMode="cover"
                                accessibilityLabel={
                                  item.prompt ||
                                  t.generatedCreation
                                }
                              />
                            ) : (
                              <View
                                style={
                                  styles.videoPreview
                                }
                              >
                                <VideoPreview
                                  uri={
                                    url
                                  }
                                />
                                <View
                                  style={
                                    styles.playOverlay
                                  }
                                >
                                  <View
                                    style={
                                      styles.playCircle
                                    }
                                  >
                                    <Ionicons
                                      name="play"
                                      size={
                                        21
                                      }
                                      color={themedIconColor(
                                        "#17171b",
                                        isDark,
                                      )}
                                    />
                                  </View>
                                </View>
                              </View>
                            )
                          ) : (
                            <View
                              style={
                                styles.unavailable
                              }
                            >
                              <Ionicons
                                name={
                                  kind ===
                                  "image"
                                    ? "image-outline"
                                    : "videocam-outline"
                                }
                                size={34}
                                color={themedIconColor(
                                  "#b0b0b7",
                                  isDark,
                                )}
                              />
                            </View>
                          )}

                          <View
                            style={
                              styles.typeBadge
                            }
                          >
                            <Ionicons
                              name={
                                kind ===
                                "image"
                                  ? "image-outline"
                                  : "videocam-outline"
                              }
                              size={12}
                              color="#fff"
                            />
                            <Text
                              style={
                                styles.typeBadgeText
                              }
                            >
                              {kind ===
                              "image"
                                ? t.image
                                : t.video}
                            </Text>
                          </View>
                        </Pressable>

                        <View
                          style={
                            styles.cardBody
                          }
                        >
                          <Text
                            style={
                              styles.prompt
                            }
                            numberOfLines={
                              2
                            }
                          >
                            {item.prompt ||
                              t.noDescription}
                          </Text>

                          <Text
                            style={
                              styles.date
                            }
                          >
                            {formatDate(
                              item.created_at,
                              language,
                            )}
                          </Text>

                          <View
                            style={
                              styles.cardFooter
                            }
                          >
                            <View
                              style={
                                styles.meta
                              }
                            >
                              {!!action && (
                                <View
                                  style={
                                    styles.metaPill
                                  }
                                >
                                  <Text
                                    style={
                                      styles.metaText
                                    }
                                    numberOfLines={
                                      1
                                    }
                                  >
                                    {action}
                                  </Text>
                                </View>
                              )}

                              {!!size && (
                                <View
                                  style={
                                    styles.metaPill
                                  }
                                >
                                  <Text
                                    style={
                                      styles.metaText
                                    }
                                  >
                                    {size}
                                  </Text>
                                </View>
                              )}
                            </View>

                            <View
                              style={
                                styles.actions
                              }
                            >
                              <Pressable
                                onPress={() =>
                                  setSelectedMedia(
                                    item,
                                  )
                                }
                                style={
                                  styles.actionButton
                                }
                                accessibilityLabel={
                                  t.open
                                }
                              >
                                <Ionicons
                                  name={
                                    kind ===
                                    "image"
                                      ? "image-outline"
                                      : "play-outline"
                                  }
                                  size={17}
                                  color={themedIconColor(
                                    "#55555d",
                                    isDark,
                                  )}
                                />
                              </Pressable>

                              <Pressable
                                onPress={() =>
                                  void handleDownload(
                                    item,
                                  )
                                }
                                disabled={
                                  !url
                                }
                                style={[
                                  styles.actionButton,
                                  !url &&
                                    styles.disabled,
                                ]}
                                accessibilityLabel={
                                  t.download
                                }
                              >
                                <Ionicons
                                  name="download-outline"
                                  size={17}
                                  color={themedIconColor(
                                    "#55555d",
                                    isDark,
                                  )}
                                />
                              </Pressable>

                              <Pressable
                                onPress={() =>
                                  void handleDelete(
                                    item,
                                  )
                                }
                                disabled={
                                  deletingId ===
                                  item.id
                                }
                                style={[
                                  styles.actionButton,
                                  deletingId ===
                                    item.id &&
                                    styles.disabled,
                                ]}
                                accessibilityLabel={
                                  t.delete
                                }
                              >
                                {deletingId ===
                                item.id ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={themedIconColor(
                                      "#777780",
                                      isDark,
                                    )}
                                  />
                                ) : (
                                  <Ionicons
                                    name="trash-outline"
                                    size={17}
                                    color={themedIconColor(
                                      "#777780",
                                      isDark,
                                    )}
                                  />
                                )}
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  },
                )}
              </View>
            )}
        </ScrollView>

         <Modal
           visible={!!artifactPreview}
           animationType="slide"
           onRequestClose={closeArtifactPreview}
         >
           <SafeAreaView style={styles.artifactModalSafe}>
             <View style={styles.artifactModalHeader}>
               <View style={{ flex: 1, paddingRight: 10 }}>
                 <Text style={styles.artifactModalLabel}>{t.preview}{artifactPreview && isCourseArtifact(artifactPreview.item) ? ` · ${t.course}` : ""}</Text>
                 <Text style={styles.artifactModalTitle} numberOfLines={2}>
                   {artifactPreview ? safeFilename(artifactPreview.item) : ""}
                 </Text>
               </View>
               {!!artifactPreview && (
                 <Pressable style={styles.artifactModalAction} accessibilityLabel={t.download}
                   onPress={() => void handleDownload(artifactPreview.item)}>
                   <Ionicons name="download-outline" size={22} color={isDark ? "#f3f3f5" : "#2c2c32"} />
                 </Pressable>
               )}
               <Pressable style={styles.artifactModalAction} accessibilityLabel={t.close}
                 onPress={closeArtifactPreview}>
                 <Ionicons name="close" size={24} color={isDark ? "#f3f3f5" : "#2c2c32"} />
               </Pressable>
             </View>
             {artifactPreview?.loading ? (
               <View style={styles.artifactModalCenter}>
                 <ActivityIndicator size="large" color="#23232b" />
                 <Text style={styles.artifactModalMessage}>{t.previewLoading}</Text>
               </View>
             ) : artifactPreview?.error ? (
               <View style={styles.artifactModalCenter}>
                 <Ionicons name="alert-circle-outline" size={30} color="#999" />
                 <Text style={styles.artifactModalMessage}>{artifactPreview.error}</Text>
               </View>
             ) : artifactPreview?.kind === "pdf" ? (
               <View style={styles.artifactModalCenter}>
                 <Ionicons name="document-outline" size={64} color="#787880" />
                 <Text style={styles.artifactModalMessage}>{t.pdfNative}</Text>
                 <Pressable disabled={openingPdf} style={styles.artifactPrimaryButton}
                   onPress={() => void openPdfPreview(artifactPreview.item)}>
                   {openingPdf ? <ActivityIndicator color="#fff" /> :
                     <Text style={styles.artifactPrimaryButtonText}>{t.preview}</Text>}
                 </Pressable>
               </View>
             ) : artifactPreview?.kind === "text" ? (
               <ScrollView style={styles.artifactScroll} contentContainerStyle={styles.artifactTextPage}>
                 <Text selectable style={styles.artifactText}>{artifactPreview.text || t.noPreviewContent}</Text>
                 {artifactPreview.text && artifactPreview.text.length >= MAX_TEXT_PREVIEW_CHARS ?
                   <Text style={styles.artifactMuted}>{t.partialPreview}</Text> : null}
               </ScrollView>
             ) : artifactPreview?.kind === "docx" ? (
               <ScrollView style={styles.artifactScroll} contentContainerStyle={styles.artifactDocumentPage}>
                 {(() => {
                   const doc = artifactPreview.document;
                   const blocks = doc?.blocks || doc?.content?.blocks || doc?.paragraphs || [];
                   return blocks.length ? blocks.map((block, index) => {
                     const kind = String(block.type || block.kind || "paragraph").toLowerCase();
                     if (kind.includes("table") && Array.isArray(block.rows)) return (
                       <ScrollView horizontal key={index} style={{ marginVertical: 12 }}>
                         <View>{block.rows.map((row: unknown, ri: number) => (
                           <View key={ri} style={{ flexDirection: "row" }}>
                             {(Array.isArray(row) ? row : []).slice(0, 24).map((cell, ci: number) => (
                               <View key={ci} style={styles.artifactTableCell}>
                                 <Text selectable style={styles.artifactTableText}>{cellText(cell)}</Text>
                               </View>
                             ))}
                           </View>
                         ))}</View>
                       </ScrollView>
                     );
                     const heading = kind.includes("heading") || /^h[1-6]$/.test(kind) || kind === "title";
                     return <View key={index} style={{ marginBottom: heading ? 16 : 10 }}>
                       <Text selectable style={heading ? styles.artifactHeading : styles.artifactParagraph}>
                         {kind.includes("bullet") || kind.includes("list") ? "•  " : ""}
                         <DocPreviewText block={block} color={isDark ? "#f3f3f5" : "#2a2a31"} />
                       </Text>
                     </View>;
                   }) : <Text style={styles.artifactMuted}>{t.noPreviewContent}</Text>;
                 })()}
                 {artifactPreview.document?.truncated ? <Text style={styles.artifactMuted}>{t.partialPreview}</Text> : null}
               </ScrollView>
             ) : artifactPreview?.kind === "xlsx" ? (
               <ScrollView style={styles.artifactScroll} contentContainerStyle={styles.artifactDocumentPage}>
                 {artifactPreview.spreadsheet?.sheets?.length ? artifactPreview.spreadsheet.sheets.map((sheet, i) => (
                   <View key={i} style={{ marginBottom: 24 }}>
                     <Text style={styles.artifactHeading}>{sheet.name || `Feuille ${i + 1}`}</Text>
                     <ScrollView horizontal>
                       <View>
                         {(sheet.rows || []).slice(0, 100).map((row, ri) => (
                           <View key={ri} style={{ flexDirection: "row" }}>
                             {(Array.isArray(row) ? row : []).slice(0, 30).map((cell, ci) => (
                               <View key={ci} style={styles.artifactTableCell}>
                                 <Text selectable style={styles.artifactTableText}>{cellText(cell)}</Text>
                               </View>
                             ))}
                           </View>
                         ))}
                       </View>
                     </ScrollView>
                     {sheet.truncated ? <Text style={styles.artifactMuted}>{t.partialPreview}</Text> : null}
                   </View>
                 )) : <Text style={styles.artifactMuted}>{t.noPreviewContent}</Text>}
                 {artifactPreview.spreadsheet?.truncated ? <Text style={styles.artifactMuted}>{t.partialPreview}</Text> : null}
               </ScrollView>
             ) : (
               <View style={styles.artifactModalCenter}>
                 <Ionicons name="document-outline" size={44} color="#777" />
                 <Text style={styles.artifactModalMessage}>{t.previewUnsupported}</Text>
               </View>
             )}
           </SafeAreaView>
         </Modal>

        <Modal
          visible={
            !!selectedMedia
          }
          transparent
          animationType="fade"
          onRequestClose={() =>
            setSelectedMedia(
              null,
            )
          }
        >
          <View
            style={
              styles.modalBackdrop
            }
          >
            <View
              style={
                styles.modalCard
              }
            >
              <View
                style={
                  styles.modalHeader
                }
              >
                <View
                  style={
                    styles.modalHeaderText
                  }
                >
                  <Text
                    style={
                      styles.modalTitle
                    }
                  >
                    {selectedMedia &&
                    getCreationKind(
                      selectedMedia,
                    ) ===
                      "image"
                      ? t.image
                      : t.video}
                  </Text>

                  <Text
                    style={
                      styles.modalDate
                    }
                  >
                    {formatDate(
                      selectedMedia?.created_at,
                      language,
                    )}
                  </Text>
                </View>

                <View
                  style={
                    styles.modalActions
                  }
                >
                  {selectedMedia && (
                    <Pressable
                      onPress={() =>
                        void handleDownload(
                          selectedMedia,
                        )
                      }
                      style={
                        styles.modalButton
                      }
                      accessibilityLabel={
                        t.download
                      }
                    >
                      <Ionicons
                        name="download-outline"
                        size={21}
                        color={themedIconColor(
                          "#55555d",
                          isDark,
                        )}
                      />
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() =>
                      setSelectedMedia(
                        null,
                      )
                    }
                    style={
                      styles.modalButton
                    }
                    accessibilityLabel={
                      t.close
                    }
                  >
                    <Ionicons
                      name="close"
                      size={22}
                      color={themedIconColor(
                        "#55555d",
                        isDark,
                      )}
                    />
                  </Pressable>
                </View>
              </View>

              <View
                style={
                  styles.modalMedia
                }
              >
                {selectedMedia &&
                getMediaUrl(
                  selectedMedia,
                ) ? (
                  getCreationKind(
                    selectedMedia,
                  ) ===
                  "image" ? (
                    <Image
                      source={{
                        uri:
                          getMediaUrl(
                            selectedMedia,
                          ) ||
                          "",
                      }}
                      style={
                        styles.modalImage
                      }
                      resizeMode="contain"
                    />
                  ) : (
                    <VideoPreview
                      uri={
                        getMediaUrl(
                          selectedMedia,
                        ) ||
                        ""
                      }
                      controls
                      autoPlay
                    />
                  )
                ) : (
                  <Text
                    style={
                      styles.unavailableText
                    }
                  >
                    {t.unavailable}
                  </Text>
                )}
              </View>

              {!!selectedMedia?.prompt && (
                <ScrollView
                  style={
                    styles.modalPromptContainer
                  }
                  contentContainerStyle={
                    styles.modalPromptContent
                  }
                >
                  <Text
                    style={
                      styles.modalPrompt
                    }
                  >
                    {
                      selectedMedia.prompt
                    }
                  </Text>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </OriaThemeContext.Provider>
  );
}

const baseStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f7f7f5",
  },

  container: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  header: {
    gap: 18,
    marginBottom: 22,
  },

  headerLeft: {
    flex: 1,
  },

  backLink: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 18,
    paddingVertical: 4,
  },

  backText: {
    color: "#6f6f77",
    fontSize: 13,
    fontWeight: "600",
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  logo: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#17171b",
  },

  logoText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },

  eyebrow: {
    color: "#8a8a90",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 2,
  },

  title: {
    marginTop: 2,
    color: "#17171b",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.8,
  },

  description: {
    marginTop: 12,
    maxWidth: 520,
    color: "#6f6f77",
    fontSize: 13,
    lineHeight: 20,
  },

  refreshButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#e2e2df",
    borderRadius: 13,
    backgroundColor: "#ffffff",
  },

  refreshText: {
    color: "#17171b",
    fontSize: 13,
    fontWeight: "700",
  },

  pressed: {
    opacity: 0.72,
  },

  disabled: {
    opacity: 0.4,
  },

  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },

  statDark: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#17171b",
  },

  statDarkText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },

  statLight: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#e2e2df",
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },

  statLightText: {
    color: "#68686f",
    fontSize: 12,
    fontWeight: "600",
  },

  filters: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 22,
  },

  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#e2e2df",
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },

  filterActive: {
    borderColor: "#17171b",
    backgroundColor: "#17171b",
  },

  filterText: {
    color: "#66666d",
    fontSize: 12,
    fontWeight: "700",
  },

  filterTextActive: {
    color: "#ffffff",
  },

  count: {
    color: "#9a9aa0",
  },

  countActive: {
    color: "#bfc0c4",
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 14,
    backgroundColor: "#fef2f2",
  },

  errorContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  errorText: {
    flex: 1,
    color: "#b42318",
    fontSize: 12,
    lineHeight: 18,
  },

  errorClose: {
    padding: 2,
  },

  loadingBox: {
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e2e2df",
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },

  loadingText: {
    color: "#777780",
    fontSize: 13,
  },

  emptyBox: {
    minHeight: 380,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 26,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d8d8d5",
    borderRadius: 24,
    backgroundColor: "#ffffff",
  },

  emptyIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    borderRadius: 20,
    backgroundColor: "#f1f1ee",
  },

  emptyTitle: {
    color: "#17171b",
    fontSize: 20,
    fontWeight: "700",
  },

  emptyDescription: {
    maxWidth: 380,
    marginTop: 8,
    color: "#74747b",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },

  createButton: {
    marginTop: 20,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#17171b",
  },

  createButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  filterEmpty: {
    paddingVertical: 50,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#e2e2df",
    borderRadius: 22,
    backgroundColor: "#ffffff",
  },

  filterEmptyText: {
    color: "#777780",
    fontSize: 13,
    textAlign: "center",
  },

  gallery: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },

  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e1e1de",
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },

  preview: {
    aspectRatio: 1,
    overflow: "hidden",
    backgroundColor: "#f0f0ed",
  },

  previewPressed: {
    opacity: 0.86,
  },

  mediaContent: {
    width: "100%",
    height: "100%",
    backgroundColor: "#09090b",
  },

  videoPreview: {
    width: "100%",
    height: "100%",
    backgroundColor: "#09090b",
  },

  playOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.10)",
  },

  playCircle: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.92)",
  },

  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  typeBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.68)",
  },

  typeBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },

  cardBody: {
    padding: 14,
  },

  prompt: {
    minHeight: 40,
    color: "#333338",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },

  date: {
    marginTop: 5,
    color: "#94949b",
    fontSize: 10,
  },

  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#efefec",
  },

  meta: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  metaPill: {
    maxWidth: 125,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "#f1f1ee",
  },

  metaText: {
    color: "#707077",
    fontSize: 9,
    fontWeight: "600",
  },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  actionButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },

  fileCard: {
    minHeight: 230,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e1e1de",
    borderRadius: 18,
    backgroundColor: "#ffffff",
  },

  fileCardMain: {
    flex: 1,
    padding: 16,
  },

  fileIcon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#f0f0ed",
  },

  fileName: {
    marginTop: 16,
    color: "#2b2b30",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },

  fileActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#efefec",
  },

  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.76)",
  },

  modalCard: {
    width: "100%",
    maxWidth: 980,
    maxHeight: "92%",
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ecece9",
  },

  modalHeaderText: {
    flex: 1,
  },

  modalTitle: {
    color: "#2b2b30",
    fontSize: 14,
    fontWeight: "700",
  },

  modalDate: {
    marginTop: 3,
    color: "#8e8e95",
    fontSize: 10,
  },

  modalActions: {
    flexDirection: "row",
    gap: 4,
  },

  modalButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },

  modalMedia: {
    width: "100%",
    minHeight: 260,
    maxHeight: 640,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#09090b",
  },

  modalImage: {
    width: "100%",
    height: 520,
  },

  unavailableText: {
    color: "#bcbcc2",
    fontSize: 13,
  },

  modalPromptContainer: {
    maxHeight: 110,
  },

  modalPromptContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  modalPrompt: {
    color: "#66666d",
    fontSize: 11,
    lineHeight: 17,
  },
  syncWarningBox: {
    flexDirection: "row", alignItems: "center", gap: 9, padding: 12,
    borderRadius: 12, backgroundColor: "#fff7dc", marginBottom: 12,
  },
  syncWarningText: { flex: 1, fontSize: 12, lineHeight: 18, color: "#72591b" },
  artifactModalSafe: { flex: 1, backgroundColor: "#f6f6f4" },
  artifactModalHeader: {
    backgroundColor: "#fff", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#ecece8",
  },
  artifactModalLabel: { color: "#777780", fontSize: 11, fontWeight: "600", marginBottom: 4 },
  artifactModalTitle: { color: "#232329", fontSize: 15, fontWeight: "700" },
  artifactModalAction: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  artifactModalCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: 26, gap: 16 },
  artifactModalMessage: { color: "#707077", fontSize: 13, lineHeight: 21, textAlign: "center" },
  artifactPrimaryButton: { backgroundColor: "#19191c", paddingHorizontal: 25, paddingVertical: 14, borderRadius: 12, marginTop: 6 },
  artifactPrimaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  artifactScroll: { flex: 1 },
  artifactTextPage: { backgroundColor: "#fff", padding: 20, flexGrow: 1 },
  artifactDocumentPage: {
    backgroundColor: "#fff", marginHorizontal: 12, marginVertical: 12,
    padding: 22, borderRadius: 14, minHeight: 300,
  },
  artifactText: { color: "#24242a", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 21 },
  artifactParagraph: { color: "#292930", fontSize: 14, lineHeight: 23 },
  artifactHeading: { color: "#202026", fontSize: 17, lineHeight: 26, fontWeight: "700", marginTop: 10, marginBottom: 10 },
  artifactMuted: { color: "#777780", fontSize: 12, lineHeight: 19, marginTop: 12 },
  artifactTableCell: {
    minWidth: 110, maxWidth: 190, minHeight: 38,
    borderWidth: 1, borderColor: "#e5e5e2", padding: 8,
  },
  artifactTableText: { color: "#3a3a41", fontSize: 11, lineHeight: 17 },

});
