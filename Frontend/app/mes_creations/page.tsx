"use client";

import {
  Download,
  Eye,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type OriaLanguage = "fr" | "en";
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
type DocumentPreview = ApiError & {
  blocks?: DocBlock[];
  paragraphs?: DocBlock[];
  content?: { blocks?: DocBlock[] };
  truncated?: boolean;
};
type SpreadsheetPreview = ApiError & {
  sheets?: Array<{ name?: string; rows?: unknown[][]; truncated?: boolean }>;
  truncated?: boolean;
};
type ArtifactPreview = {
  item: CreationItem;
  kind: "pdf" | "docx" | "xlsx" | "text" | "unsupported";
  loading: boolean;
  pdfUrl?: string;
  text?: string;
  document?: DocumentPreview;
  spreadsheet?: SpreadsheetPreview;
  error?: string;
};

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt", "md", "csv", "tsv", "json", "jsonl", "ndjson", "xml", "yaml", "yml",
  "py", "js", "ts", "tsx", "jsx", "css", "html", "sql", "log", "toml", "ini", "sh",
]);
const MAX_INLINE_TEXT_BYTES = 1_000_000;
const MAX_INLINE_TEXT_CHARS = 90_000;

function artifactExtension(item: CreationItem): string {
  return String(item.extension || item.filename?.split(".").pop() || "").toLowerCase().replace(/^\./, "");
}

function isCourseArtifact(item: CreationItem): boolean {
  if (item.metadata?.source === "oria-course") return true;
  // L'API de listing historique masque parfois metadata ; les noms Code-First
  // sont créés par course_service.py avec ce préfixe déterministe.
  return /^oria-cours-(?:transcription-)?[a-f0-9]{16}\.(?:pdf|docx|txt)$/i.test(item.filename || "");
}

function isCourseTranscript(item: CreationItem): boolean {
  return item.metadata?.kind === "transcript" ||
    /^oria-cours-transcription-[a-f0-9]{16}\.txt$/i.test(item.filename || "");
}

function previewKind(item: CreationItem): ArtifactPreview["kind"] {
  const ext = artifactExtension(item);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  return TEXT_PREVIEW_EXTENSIONS.has(ext) ? "text" : "unsupported";
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    // Ne jamais intégrer javascript:, data:, blob: ou file: dans l'aperçu.
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
      ? parsed.href : null;
  } catch { return null; }
}

function combineCreations(merged: CreationItem[], artifacts: CreationItem[]): CreationItem[] {
  const byId = new Map<string, CreationItem>();
  for (const entry of merged) {
    if (entry && typeof entry.id === "string" && entry.id.trim()) byId.set(entry.id, entry);
  }
  for (const entry of artifacts) {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim()) continue;
    const previous = byId.get(entry.id);
    // Un artifact provenant du catalogue dédié est toujours classé comme fichier.
    byId.set(entry.id, {
      ...previous, ...entry,
      creation_type: "artifact",
      metadata: entry.metadata || previous?.metadata || null,
    });
  }
  return [...byId.values()].sort((a, b) => {
    const at = Date.parse(a.created_at || "") || 0;
    const bt = Date.parse(b.created_at || "") || 0;
    return bt - at;
  });
}

function docBlockText(block: DocBlock): string {
  if (typeof block.text === "string") return block.text;
  if (Array.isArray(block.runs)) {
    return block.runs.map((run: unknown) => {
      if (typeof run === "string") return run;
      if (run && typeof run === "object" && "text" in run && typeof run.text === "string") return run.text;
      return "";
    }).join("");
  }
  return "";
}

// Les réponses DOCX peuvent fournir des runs typographiques ; ne pas les
// réduire à du texte brut quand la structure est disponible (maths inclus).
function DocText({ block }: { block: DocBlock }) {
  if (!Array.isArray(block.runs)) return <>{docBlockText(block)}</>;
  return <>{block.runs.map((value: unknown, index: number) => {
    if (typeof value === "string") return <span key={index}>{value}</span>;
    if (!value || typeof value !== "object") return null;
    const run = value as Record<string, unknown>;
    const text = typeof run.text === "string" ? run.text : "";
    const styled = <span className={`${run.bold ? "font-semibold" : ""} ${run.italic ? "italic" : ""} ${run.underline ? "underline" : ""}`}>{text}</span>;
    if (run.superscript) return <sup key={index}>{styled}</sup>;
    if (run.subscript) return <sub key={index}>{styled}</sub>;
    return <span key={index}>{styled}</span>;
  })}</>;
}

// Un ancien PDF peut ne pas recevoir preview_url (MIME historique erroné),
// tout en restant téléchargeable. Un Blob PDF local contourne le mode
// Content-Disposition: attachment du lien privé de téléchargement.
async function pdfBlobPreviewFromSignedDownload(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("Impossible de récupérer le PDF privé.");
  const MAX_PDF_PREVIEW_BYTES = 50 * 1024 * 1024;
  const reportedSize = Number(response.headers.get("content-length") || "0");
  if (reportedSize > MAX_PDF_PREVIEW_BYTES) throw new Error("PDF trop volumineux pour l’aperçu intégré.");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_PREVIEW_BYTES) {
    throw new Error("PDF absent ou trop volumineux pour l’aperçu intégré.");
  }
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error("Le fichier enregistré n’est pas un PDF valide.");
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

async function readSmallText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("Lecture du fichier indisponible.");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_INLINE_TEXT_BYTES) throw new Error("Fichier trop volumineux pour un aperçu texte.");
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_INLINE_TEXT_BYTES) throw new Error("Fichier trop volumineux pour un aperçu texte.");
    return (await blob.text()).slice(0, MAX_INLINE_TEXT_CHARS);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INLINE_TEXT_BYTES) throw new Error("Fichier trop volumineux pour un aperçu texte.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8").decode(output).slice(0, MAX_INLINE_TEXT_CHARS);
}

type CreationsResponse = {
  success?: boolean;
  creations?: CreationItem[];
  count?: number;
  media_count?: number;
  artifact_count?: number;
  detail?: string;
  message?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    unknownDate: "Date inconnue",
    backToChat: "Retour au chat",
    myCreations: "Mes créations",
    description:
      "Retrouvez ici vos images, vidéos et fichiers générés avec Oria.",
    refresh: "Actualiser",
    creation: "création",
    creations: "créations",
    image: "image",
    images: "Images",
    video: "vidéo",
    videos: "Vidéos",
    file: "fichier",
    files: "Fichiers",
    all: "Toutes",
    close: "Fermer",
    loading: "Chargement de vos créations…",
    emptyTitle: "Aucune création pour le moment",
    emptyDescription:
      "Vos images, vidéos et fichiers générés avec Oria apparaîtront automatiquement ici.",
    createSomething: "Créer quelque chose",
    emptyFilter: "Aucune création dans cette catégorie.",
    generatedWithOria: "Création générée avec Oria",
    noDescription: "Création sans description",
    open: "Ouvrir",
    download: "Télécharger",
    delete: "Supprimer",
    fileUnavailable: "Ce fichier n'est plus disponible.",
    sessionExpired: "Votre session a expiré. Veuillez vous reconnecter.",
    backendMissing:
      "L'URL du backend n'est pas configurée dans le frontend.",
    loadFailed: "Impossible de récupérer vos créations.",
    loadError: "Une erreur est survenue pendant le chargement.",
    downloadError: "Téléchargement impossible.",
    deleteConfirm: "Supprimer définitivement cette création ?",
    deleteError: "Impossible de supprimer cette création.",
    document: "Fichier",
    preview: "Aperçu",
    previewFailed: "Impossible de prévisualiser ce fichier. Vous pouvez toujours le télécharger.",
    previewUnsupported: "L’aperçu intégré n’est pas encore disponible pour ce format.",
    noPreviewContent: "Aucun contenu lisible dans l’aperçu.",
    truncated: "Aperçu partiel : téléchargez le fichier pour consulter tout son contenu.",
    course: "ORIA Cours",
    transcript: "Transcription",
    partialLibrary: "Une partie de la bibliothèque n’a pas pu être chargée. Réessayez d’actualiser.",
  },
  en: {
    unknownDate: "Unknown date",
    backToChat: "Back to chat",
    myCreations: "My creations",
    description:
      "Find your images, videos and files generated with Oria.",
    refresh: "Refresh",
    creation: "creation",
    creations: "creations",
    image: "image",
    images: "Images",
    video: "video",
    videos: "Videos",
    file: "file",
    files: "Files",
    all: "All",
    close: "Close",
    loading: "Loading your creations…",
    emptyTitle: "No creations yet",
    emptyDescription:
      "Your images, videos and files generated with Oria will automatically appear here.",
    createSomething: "Create something",
    emptyFilter: "No creations in this category.",
    generatedWithOria: "Creation generated with Oria",
    noDescription: "Creation without description",
    open: "Open",
    download: "Download",
    delete: "Delete",
    fileUnavailable: "This file is no longer available.",
    sessionExpired: "Your session has expired. Please sign in again.",
    backendMissing:
      "The backend URL is not configured in the frontend.",
    loadFailed: "Unable to retrieve your creations.",
    loadError: "An error occurred while loading.",
    downloadError: "Download failed.",
    deleteConfirm: "Permanently delete this creation?",
    deleteError: "Unable to delete this creation.",
    document: "File",
    preview: "Preview",
    previewFailed: "Preview unavailable. You can still download this file.",
    previewUnsupported: "An inline preview is not yet available for this format.",
    noPreviewContent: "No readable content in the preview.",
    truncated: "Partial preview: download the file to see all content.",
    course: "ORIA Course",
    transcript: "Transcript",
    partialLibrary: "Part of your library could not be loaded. Please refresh.",
  },
} as const;

function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") return "fr";

  const saved = window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY);
  if (saved === "fr" || saved === "en") return saved;

  return window.navigator.language.toLowerCase().startsWith("en")
    ? "en"
    : "fr";
}

function getCreationKind(item: CreationItem): CreationKind {
  const explicit = String(item.creation_type || "").toLowerCase();
  const mediaType = String(item.media_type || item.type || "").toLowerCase();

  if (explicit === "video" || mediaType === "video") return "video";
  if (explicit === "image" || mediaType === "image") return "image";
  if (explicit === "artifact" || mediaType === "file" || Boolean(item.extension)) return "artifact";
  return "image";
}

function getMediaUrl(item: CreationItem): string | null {
  const value =
    item.public_url ||
    item.media_url ||
    item.url ||
    null;

  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
}

function getArtifactUrl(item: CreationItem): string | null {
  const value =
    item.download_url ||
    item.url ||
    null;

  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
}

function formatDate(
  value: string | null | undefined,
  language: OriaLanguage,
) {
  if (!value) return UI[language].unknownDate;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UI[language].unknownDate;

  return new Intl.DateTimeFormat(
    language === "en" ? "en-US" : "fr-FR",
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
  if (!value || value <= 0) return null;

  if (value < 1024) {
    return language === "en" ? `${value} B` : `${value} o`;
  }

  if (value < 1024 * 1024) {
    return language === "en"
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024).toFixed(1)} Ko`;
  }

  return language === "en"
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function getActionLabel(action?: string | null) {
  if (!action) return null;

  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getFileLabel(item: CreationItem, language: OriaLanguage) {
  const extension = item.extension?.replace(/^\./, "").toUpperCase();
  if (extension) return extension;

  const category = item.category?.trim();
  if (category) return category;

  return UI[language].document;
}

function safeFilename(item: CreationItem) {
  if (item.filename?.trim()) {
    return item.filename.trim();
  }

  const kind = getCreationKind(item);

  if (kind === "video") {
    return `oria-${item.id}.mp4`;
  }

  if (kind === "image") {
    return `oria-${item.id}.png`;
  }

  const extension = item.extension?.replace(/^\./, "") || "bin";
  return `oria-${item.id}.${extension}`;
}

export default function CreationsPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");
  const [creations, setCreations] =
    useState<CreationItem[]>([]);
  const [filter, setFilter] =
    useState<FilterType>("all");
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] =
    useState<CreationItem | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactPreview | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const pdfBlobUrlRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const supabase = useMemo(
    () => createClient(),
    [],
  );

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
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

  const getSession = useCallback(async () => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user?.id || !session.access_token) {
      throw new Error(UI[language].sessionExpired);
    }
    if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 90) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session?.access_token) {
        throw new Error(UI[language].sessionExpired);
      }
      return refreshed.data.session;
    }
    return session;
  }, [language, supabase]);

  const authenticatedFetch = useCallback(
    async (
      path: string,
      options: RequestInit = {},
    ) => {
      const session = await getSession();

      if (!API_BASE_URL) {
        throw new Error(UI[language].backendMissing);
      }

      const headers = new Headers(options.headers);
      headers.set(
        "Authorization",
        `Bearer ${session.access_token}`,
      );
      headers.set("user-id", session.user.id);

      if (
        options.body &&
        !(options.body instanceof FormData)
      ) {
        headers.set(
          "Content-Type",
          "application/json",
        );
      }

      return fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
        cache: "no-store",
      });
    },
    [getSession, language],
  );

  // Both the AI router and the legacy main router expose private artifacts.
  // Only GET 404/405 may trigger fallback. Never replay writes or billing calls.
  const fetchArtifactGet = useCallback(async (suffix: string) => {
    const primary = await authenticatedFetch(`/ai/artifacts${suffix}`);
    if (primary.ok || ![404, 405].includes(primary.status)) return primary;
    return authenticatedFetch(`/artifacts${suffix}`);
  }, [authenticatedFetch]);

  const loadCreations = useCallback(
    async (showRefreshState = false, silent = false) => {
      const requestId = ++loadRequestRef.current;
      if (showRefreshState) setRefreshing(true);
      else if (!silent) setLoading(true);
      if (!silent) { setError(null); setSyncWarning(null); }
      try {
        // La liste unifiée des créations peut être antérieure au module Cours.
        // La source de vérité pour les PDF/Word/TXT reste /artifacts.
        const parseResponse = async <T,>(response: Response): Promise<T> => {
          const data: T & ApiError = await response.json().catch(() => ({} as T & ApiError));
          if (!response.ok) throw new Error(data.detail || data.message || UI[language].loadFailed);
          return data;
        };
        const [allResult, fileResult] = await Promise.allSettled([
          authenticatedFetch("/creations?limit=100").then((response) => parseResponse<CreationsResponse>(response)),
          fetchArtifactGet("?limit=100&offset=0").then((response) => parseResponse<ArtifactListResponse>(response)),
        ]);
        if (allResult.status === "rejected" && fileResult.status === "rejected") {
          throw new Error(UI[language].loadFailed);
        }
        if (requestId !== loadRequestRef.current) return;
        const mediaItems = allResult.status === "fulfilled" && Array.isArray(allResult.value.creations)
          ? allResult.value.creations : [];
        const artifactItems = fileResult.status === "fulfilled" && Array.isArray(fileResult.value.artifacts)
          ? fileResult.value.artifacts : [];
        setCreations(combineCreations(mediaItems, artifactItems));
        setSyncWarning(allResult.status === "rejected" || fileResult.status === "rejected"
          ? UI[language].partialLibrary : null);
        setError(null);
      } catch (requestError) {
        if (requestId !== loadRequestRef.current) return;
        if (!silent) setError(requestError instanceof Error ? requestError.message : UI[language].loadError);
      } finally {
        if (requestId === loadRequestRef.current) { setLoading(false); setRefreshing(false); }
      }
    },
    [authenticatedFetch, fetchArtifactGet, language],
  );

  useEffect(() => {
    void loadCreations();
    // Nouveaux cours : synchronisation de la bibliothèque à la reprise de l'onglet
    // et périodiquement, sans WebSocket ni abonnement non autorisé.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadCreations(false, true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 45_000);
    return () => {
      ++loadRequestRef.current;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [loadCreations]);

  const counts = useMemo(() => {
    const result = {
      image: 0,
      video: 0,
      artifact: 0,
    };

    for (const item of creations) {
      result[getCreationKind(item)] += 1;
    }

    return result;
  }, [creations]);

  const filteredCreations = useMemo(() => {
    if (filter === "all") {
      return creations;
    }

    return creations.filter(
      (item) =>
        getCreationKind(item) === filter,
    );
  }, [creations, filter]);

  const resolveArtifact = useCallback(async (item: CreationItem): Promise<CreationItem> => {
    // Les URLs signées sont éphémères. On renouvelle toujours via une API
    // authentifiée avant toute ouverture ou téléchargement.
    const response = await fetchArtifactGet(`/${encodeURIComponent(item.id)}`);
    const payload: { artifact?: CreationItem } & ApiError = await response.json().catch(() => ({}));
    if (!response.ok || !payload.artifact?.id || payload.artifact.id !== item.id) {
      throw new Error(payload.detail || payload.message || UI[language].fileUnavailable);
    }
    const refreshed: CreationItem = { ...item, ...payload.artifact, creation_type: "artifact" };
    setCreations((current) => current.map((creation) => creation.id === item.id ? refreshed : creation));
    return refreshed;
  }, [fetchArtifactGet, language]);

  const closeArtifactPreview = useCallback(() => {
    ++previewRequestRef.current;
    if (pdfBlobUrlRef.current) {
      URL.revokeObjectURL(pdfBlobUrlRef.current);
      pdfBlobUrlRef.current = null;
    }
    setSelectedArtifact(null);
  }, []);

  useEffect(() => () => {
    if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
    pdfBlobUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (!selectedArtifact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeArtifactPreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedArtifact, closeArtifactPreview]);

  const handleDownload = useCallback(
    async (item: CreationItem) => {
      try {
        const kind = getCreationKind(item);

        const refreshed = kind === "artifact" ? await resolveArtifact(item) : item;
        const url = kind === "artifact"
          ? safeRemoteUrl(getArtifactUrl(refreshed))
          : getMediaUrl(refreshed);

        if (!url) {
          throw new Error(
            UI[language].fileUnavailable,
          );
        }

        // Si le navigateur bloque une lecture cross-origin, le lien signé
        // peut toujours être ouvert directement sans exposer le fichier.
        let response: Response;
        try {
          response = await fetch(url, { referrerPolicy: "no-referrer" });
        } catch {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        if (!response.ok) {
          window.open(
            url,
            "_blank",
            "noopener,noreferrer",
          );
          return;
        }

        const blob = await response.blob();
        const objectUrl =
          URL.createObjectURL(blob);

        const link =
          document.createElement("a");

        link.href = objectUrl;
        link.download = safeFilename(item);

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(objectUrl);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : UI[language].downloadError,
        );
      }
    },
    [language, resolveArtifact],
  );

  const handleOpen = useCallback(async (item: CreationItem) => {
    if (getCreationKind(item) !== "artifact") {
      setSelectedMedia(item);
      return;
    }
    const kind = previewKind(item);
    const requestId = ++previewRequestRef.current;
    setSelectedArtifact({ item, kind, loading: kind !== "unsupported" });
    if (kind === "unsupported") return;
    try {
      if (kind === "docx" || kind === "xlsx") {
        const endpoint = kind === "docx" ? "document-preview" : "spreadsheet-preview";
        const response = await fetchArtifactGet(
          `/${encodeURIComponent(item.id)}/${endpoint}`,
        );
        const data: (DocumentPreview & SpreadsheetPreview) = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || data.message || UI[language].previewFailed);
        if (requestId !== previewRequestRef.current) return;
        setSelectedArtifact({
          item, kind, loading: false,
          ...(kind === "docx" ? { document: data } : { spreadsheet: data }),
        });
        return;
      }
      const refreshed = await resolveArtifact(item);
      if (requestId !== previewRequestRef.current) return;
      if (kind === "pdf") {
        // Prefer a genuine inline signed URL. Older documents may only have
        // a signed download URL; download once to an in-memory PDF Blob.
        const signedPreview = safeRemoteUrl(refreshed.preview_url);
        const signedDownload = safeRemoteUrl(getArtifactUrl(refreshed));
        let previewUrl: string | null = null;
        let blobUrl: string | null = null;
        // PDF metadata may indicate "attachment"; use a local Blob if CORS
        // allows reading the signed resource, rather than embedding an attachment URL.
        for (const candidate of [signedPreview, signedDownload]) {
          if (!candidate) continue;
          try {
            blobUrl = await pdfBlobPreviewFromSignedDownload(candidate);
            previewUrl = blobUrl;
            break;
          } catch {
            // Some Storage deployments permit browser navigation but not CORS fetch.
            // We can still open the private signed URL in a separate tab.
          }
        }
        if (!previewUrl) previewUrl = signedPreview || signedDownload;
        if (!previewUrl) throw new Error(UI[language].previewFailed);
        if (requestId !== previewRequestRef.current) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
        pdfBlobUrlRef.current = blobUrl;
        setSelectedArtifact({ item: refreshed, kind, loading: false, pdfUrl: previewUrl });
        return;
      }
      if ((refreshed.size_bytes || 0) > MAX_INLINE_TEXT_BYTES) {
        throw new Error(UI[language].truncated);
      }
      const signed = safeRemoteUrl(getArtifactUrl(refreshed));
      if (!signed) throw new Error(UI[language].fileUnavailable);
      const text = await readSmallText(signed);
      if (requestId !== previewRequestRef.current) return;
      setSelectedArtifact({ item: refreshed, kind, loading: false, text });
    } catch (requestError) {
      if (requestId !== previewRequestRef.current) return;
      setSelectedArtifact({
        item, kind, loading: false,
        error: requestError instanceof Error ? requestError.message : UI[language].previewFailed,
      });
    }
  }, [fetchArtifactGet, language, resolveArtifact]);

  const handleDelete = useCallback(
    async (item: CreationItem) => {
      // Les documents de cours finalisés sont protégés côté SQL.
      if (isCourseArtifact(item)) return;
      if (
        !window.confirm(
          UI[language].deleteConfirm,
        )
      ) {
        return;
      }

      setDeletingId(item.id);
      setError(null);

      try {
        const kind = getCreationKind(item);

        const endpoint =
          kind === "artifact"
            ? `/artifacts/${encodeURIComponent(item.id)}`
            : `/media/${encodeURIComponent(item.id)}`;

        const response = await authenticatedFetch(
          endpoint,
          {
            method: "DELETE",
          },
        );

        let payload: {
          detail?: string;
          message?: string;
        } = {};

        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(
            payload.detail ||
              payload.message ||
              UI[language].deleteError,
          );
        }

        setCreations((current) =>
          current.filter(
            (creation) =>
              creation.id !== item.id,
          ),
        );

        setSelectedMedia((current) =>
          current?.id === item.id
            ? null
            : current,
        );
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : UI[language].deleteError,
        );
      } finally {
        setDeletingId(null);
      }
    },
    [authenticatedFetch, language],
  );

  const filters: Array<{
    value: FilterType;
    label: string;
    count: number;
  }> = [
    {
      value: "all",
      label: UI[language].all,
      count: creations.length,
    },
    {
      value: "image",
      label: UI[language].images,
      count: counts.image,
    },
    {
      value: "video",
      label: UI[language].videos,
      count: counts.video,
    },
    {
      value: "artifact",
      label: UI[language].files,
      count: counts.artifact,
    },
  ];

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#111111]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/chat"
              className="mb-5 inline-flex items-center text-sm font-medium text-black/55 transition hover:text-black"
            >
              ← {UI[language].backToChat}
            </Link>

            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-sm font-black tracking-tight text-white">
                N
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/40">
                  Oria
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {UI[language].myCreations}
                </h1>
              </div>
            </div>

            <p className="mt-3 max-w-xl text-sm leading-6 text-black/55">
              {UI[language].description}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadCreations(true)
            }
            disabled={loading || refreshing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold shadow-sm transition hover:border-black/20 hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                refreshing
                  ? "animate-spin"
                  : ""
              }`}
            />
            {UI[language].refresh}
          </button>
        </header>

        {!loading &&
          !error &&
          creations.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-black px-3 py-1.5 font-medium text-white">
                {creations.length}{" "}
                {creations.length === 1
                  ? UI[language].creation
                  : UI[language].creations}
              </span>

              <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-black/60">
                {counts.image}{" "}
                {counts.image === 1
                  ? UI[language].image
                  : UI[language].images.toLowerCase()}
              </span>

              <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-black/60">
                {counts.video}{" "}
                {counts.video === 1
                  ? UI[language].video
                  : UI[language].videos.toLowerCase()}
              </span>

              <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-black/60">
                {counts.artifact}{" "}
                {counts.artifact === 1
                  ? UI[language].file
                  : UI[language].files.toLowerCase()}
              </span>
            </div>
          )}

        {!loading &&
          creations.length > 0 && (
            <div className="mb-7 flex flex-wrap gap-2">
              {filters.map((item) => {
                const active =
                  filter === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() =>
                      setFilter(item.value)
                    }
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-black text-white"
                        : "border border-black/10 bg-white text-black/60 hover:border-black/20 hover:text-black"
                    }`}
                  >
                    {item.label}
                    <span
                      className={
                        active
                          ? "ml-1.5 opacity-60"
                          : "ml-1.5 opacity-40"
                      }
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

        {error && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded-lg p-1 hover:bg-red-100"
              aria-label={UI[language].close}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {syncWarning && !loading && (
          <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {syncWarning}
          </p>
        )}

        {loading && (
          <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-black/10 bg-white">
            <div className="flex flex-col items-center gap-3 text-black/45">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">
                {UI[language].loading}
              </p>
            </div>
          </div>
        )}

        {!loading &&
          !error &&
          creations.length === 0 && (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-black/15 bg-white px-6 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-black/[0.04]">
                <FileText className="h-7 w-7 text-black/40" />
              </div>

              <h2 className="text-xl font-semibold">
                {UI[language].emptyTitle}
              </h2>

              <p className="mt-2 max-w-md text-sm leading-6 text-black/50">
                {UI[language].emptyDescription}
              </p>

              <Link
                href="/chat"
                className="mt-6 inline-flex h-11 items-center rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85"
              >
                {UI[language].createSomething}
              </Link>
            </div>
          )}

        {!loading &&
          !error &&
          creations.length > 0 &&
          filteredCreations.length === 0 && (
            <div className="rounded-3xl border border-black/10 bg-white px-6 py-16 text-center">
              <p className="text-sm text-black/50">
                {UI[language].emptyFilter}
              </p>
            </div>
          )}

        {!loading &&
          !error &&
          filteredCreations.length > 0 && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredCreations.map(
                (item) => {
                  const kind =
                    getCreationKind(item);
                  const mediaUrl =
                    kind === "artifact"
                      ? null
                      : getMediaUrl(item);
                  const size = formatSize(
                    item.size_bytes ??
                      item.size,
                    language,
                  );
                  const action =
                    getActionLabel(
                      item.action,
                    );

                  if (kind === "artifact") {
                    return (
                      <article
                        key={item.id}
                        className="flex min-h-[245px] flex-col rounded-2xl border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-black/15 hover:shadow-md"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            void handleOpen(
                              item,
                            )
                          }
                          className="flex flex-1 flex-col items-start text-left"
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.05] text-black/60">
                            <FileText className="h-7 w-7" />
                          </div>

                          <p className="mt-5 line-clamp-2 break-all text-base font-semibold leading-6">
                            {safeFilename(
                              item,
                            )}
                          </p>

                          <p className="mt-2 text-xs text-black/40">
                            {formatDate(
                              item.created_at,
                              language,
                            )}
                          </p>

                          <div className="mt-4 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-black/[0.05] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/55">
                              {getFileLabel(
                                item,
                                language,
                              )}
                            </span>

                            {isCourseArtifact(item) && (
                              <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                                {UI[language].course}{isCourseTranscript(item) ? ` · ${UI[language].transcript}` : ""}
                              </span>
                            )}
                            {size && (
                              <span className="rounded-md bg-black/[0.04] px-2 py-1 text-[10px] font-medium text-black/45">
                                {size}
                              </span>
                            )}
                          </div>
                        </button>

                        <div className="mt-5 flex items-center justify-end gap-1 border-t border-black/5 pt-3">
                          <button
                            type="button"
                            onClick={() =>
                              void handleOpen(
                                item,
                              )
                            }
                            className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black"
                            aria-label={
                              UI[language].preview
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void handleDownload(
                                item,
                              )
                            }
                            className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black"
                            aria-label={
                              UI[language]
                                .download
                            }
                          >
                            <Download className="h-4 w-4" />
                          </button>

                          {!isCourseArtifact(item) && (
                            <button type="button" onClick={() => void handleDelete(item)}
                              disabled={deletingId === item.id}
                              className="rounded-lg p-2 text-black/35 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={UI[language].delete}>
                              {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article
                      key={item.id}
                      className="group overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-black/15 hover:shadow-md"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMedia(
                            item,
                          )
                        }
                        className="relative block aspect-square w-full overflow-hidden bg-black/[0.04] text-left"
                        aria-label={
                          UI[language].open
                        }
                      >
                        {mediaUrl ? (
                          kind === "image" ? (
                            <img
                              src={mediaUrl}
                              alt={
                                item.prompt ||
                                UI[
                                  language
                                ]
                                  .generatedWithOria
                              }
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                              loading="lazy"
                            />
                          ) : (
                            <>
                              <video
                                src={
                                  mediaUrl
                                }
                                className="h-full w-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                  <Play className="ml-0.5 h-5 w-5 fill-current" />
                                </span>
                              </span>
                            </>
                          )
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            {kind ===
                            "image" ? (
                              <ImageIcon className="h-8 w-8 text-black/25" />
                            ) : (
                              <Video className="h-8 w-8 text-black/25" />
                            )}
                          </div>
                        )}

                        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                          {kind ===
                          "image" ? (
                            <ImageIcon className="h-3 w-3" />
                          ) : (
                            <Video className="h-3 w-3" />
                          )}
                          {kind ===
                          "image"
                            ? "Image"
                            : language ===
                                "en"
                              ? "Video"
                              : "Vidéo"}
                        </span>
                      </button>

                      <div className="p-4">
                        <div className="min-h-[46px]">
                          <p className="line-clamp-2 text-sm font-medium leading-5 text-black/80">
                            {item.prompt ||
                              UI[language]
                                .noDescription}
                          </p>

                          <p className="mt-1 text-xs text-black/40">
                            {formatDate(
                              item.created_at,
                              language,
                            )}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/5 pt-3">
                          <div className="flex min-w-0 flex-wrap gap-1.5">
                            {action && (
                              <span className="max-w-[150px] truncate rounded-md bg-black/[0.04] px-2 py-1 text-[10px] font-medium text-black/50">
                                {action}
                              </span>
                            )}

                            {size && (
                              <span className="rounded-md bg-black/[0.04] px-2 py-1 text-[10px] font-medium text-black/40">
                                {size}
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedMedia(
                                  item,
                                )
                              }
                              className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black"
                              aria-label={
                                UI[language]
                                  .open
                              }
                            >
                              {kind ===
                              "image" ? (
                                <ImageIcon className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleDownload(
                                  item,
                                )
                              }
                              disabled={
                                !mediaUrl
                              }
                              className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
                              aria-label={
                                UI[language]
                                  .download
                              }
                            >
                              <Download className="h-4 w-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleDelete(
                                  item,
                                )
                              }
                              disabled={
                                deletingId ===
                                item.id
                              }
                              className="rounded-lg p-2 text-black/35 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={
                                UI[language]
                                  .delete
                              }
                            >
                              {deletingId ===
                              item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                },
              )}
            </section>
          )}
      </div>

       {selectedArtifact && (
         <div role="dialog" aria-modal="true" aria-label={`${UI[language].preview} : ${safeFilename(selectedArtifact.item)}`}
           className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
           onMouseDown={(event) => { if (event.target === event.currentTarget) closeArtifactPreview(); }}>
           <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
             <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-4 py-3 sm:px-5">
               <div className="min-w-0">
                 <p className="truncate text-sm font-semibold">{safeFilename(selectedArtifact.item)}</p>
                 <p className="mt-0.5 text-xs text-black/45">{UI[language].preview} · {getFileLabel(selectedArtifact.item, language)}
                   {isCourseArtifact(selectedArtifact.item) ? ` · ${UI[language].course}` : ""}
                 </p>
               </div>
               <div className="flex shrink-0 items-center gap-1">
                 <button type="button" onClick={() => void handleDownload(selectedArtifact.item)}
                   className="rounded-lg p-2 text-black/55 transition hover:bg-black/5 hover:text-black" aria-label={UI[language].download}>
                   <Download className="h-5 w-5" />
                 </button>
                 <button type="button" onClick={closeArtifactPreview}
                   className="rounded-lg p-2 text-black/55 transition hover:bg-black/5 hover:text-black" aria-label={UI[language].close}>
                   <X className="h-5 w-5" />
                 </button>
               </div>
             </header>
             <section className="min-h-0 flex-1 overflow-auto bg-[#f7f7f5]" aria-live="polite">
               {selectedArtifact.loading ? (
                 <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-black/45">
                   <Loader2 className="h-7 w-7 animate-spin" /><p className="text-sm">{UI[language].loading}</p>
                 </div>
               ) : selectedArtifact.error ? (
                 <div className="mx-auto flex min-h-[260px] max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
                   <FileText className="h-9 w-9 text-black/30" />
                   <p className="text-sm text-black/65">{selectedArtifact.error}</p>
                 </div>
               ) : selectedArtifact.kind === "pdf" && selectedArtifact.pdfUrl ? (
                 <iframe title={`${UI[language].preview} PDF`} src={selectedArtifact.pdfUrl}
                   className="h-[76vh] min-h-[360px] w-full border-0 bg-white" referrerPolicy="no-referrer" />
               ) : selectedArtifact.kind === "text" ? (
                 <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words bg-white p-5 font-mono text-xs leading-6 text-black/80 sm:my-5 sm:rounded-xl sm:p-8">
                   {selectedArtifact.text || UI[language].noPreviewContent}
                   {selectedArtifact.text && selectedArtifact.text.length >= MAX_INLINE_TEXT_CHARS
                     ? `\n\n[${UI[language].truncated}]` : ""}
                 </pre>
               ) : selectedArtifact.kind === "xlsx" ? (
                 <div className="space-y-6 p-4 sm:p-6">
                   {selectedArtifact.spreadsheet?.sheets?.length ? selectedArtifact.spreadsheet.sheets.map((sheet, sheetIndex) => (
                     <div key={`${sheet.name || "sheet"}-${sheetIndex}`} className="overflow-hidden rounded-xl border border-black/10 bg-white">
                       <h3 className="border-b border-black/10 px-4 py-3 text-sm font-semibold">{sheet.name || `Feuille ${sheetIndex + 1}`}</h3>
                       <div className="max-h-[480px] overflow-auto">
                         <table className="w-max min-w-full border-collapse text-left text-xs">
                           <tbody>{(sheet.rows || []).map((row, rowIndex) => (
                             <tr key={rowIndex}>{row.map((cell, colIndex) => (
                               <td key={colIndex} className="max-w-64 min-w-24 whitespace-pre-wrap break-words border-b border-r border-black/5 px-3 py-2 align-top">
                                 {cell === null || cell === undefined ? "" : String(cell)}
                               </td>
                             ))}</tr>
                           ))}</tbody>
                         </table>
                       </div>
                       {sheet.truncated && <p className="px-4 py-2 text-xs text-black/45">{UI[language].truncated}</p>}
                     </div>
                   )) : <p className="p-8 text-center text-sm text-black/50">{UI[language].noPreviewContent}</p>}
                   {selectedArtifact.spreadsheet?.truncated && <p className="text-xs text-black/50">{UI[language].truncated}</p>}
                 </div>
               ) : selectedArtifact.kind === "docx" ? (
                 <div className="mx-auto my-4 min-h-[70vh] max-w-[810px] rounded-xl bg-white px-5 py-8 shadow-sm sm:my-7 sm:px-12 sm:py-12">
                   {(() => {
                     const documentData = selectedArtifact.document;
                     const blocks = documentData?.blocks || documentData?.content?.blocks || documentData?.paragraphs || [];
                     return blocks.length ? blocks.map((block, index) => {
                       const kind = String(block.type || block.kind || "paragraph").toLowerCase();
                       if (kind.includes("table") && Array.isArray(block.rows)) {
                         return <div key={index} className="my-5 overflow-x-auto"><table className="w-full border-collapse text-sm">
                           <tbody>{block.rows.map((row: unknown, rowIndex: number) => (
                             <tr key={rowIndex}>{(Array.isArray(row) ? row : []).map((cell: unknown, cellIndex: number) => (
                               <td key={cellIndex} className="border border-black/15 px-3 py-2 align-top">
                                 {typeof cell === "string" || typeof cell === "number" ? String(cell) :
                                   cell && typeof cell === "object" && "text" in cell ? String(cell.text || "") : ""}
                               </td>
                             ))}</tr>
                           ))}</tbody>
                         </table></div>;
                       }
                       if (kind.includes("heading") || /^h[1-6]$/.test(kind) || kind === "title") {
                         return <h3 key={index} className="mb-3 mt-6 text-lg font-semibold leading-relaxed"><DocText block={block} /></h3>;
                       }
                       if (kind.includes("list") || kind.includes("bullet")) {
                         return <p key={index} className="my-2 pl-5 text-sm leading-7 text-black/80">• <DocText block={block} /></p>;
                       }
                       return <p key={index} className="my-3 whitespace-pre-wrap text-sm leading-7 text-black/80"><DocText block={block} /></p>;
                     }) : <p className="text-center text-sm text-black/50">{UI[language].noPreviewContent}</p>;
                   })()}
                   {selectedArtifact.document?.truncated && <p className="mt-6 text-xs text-black/50">{UI[language].truncated}</p>}
                 </div>
               ) : (
                 <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
                   <ExternalLink className="h-8 w-8 text-black/35" />
                   <p className="max-w-md text-sm text-black/60">{UI[language].previewUnsupported}</p>
                 </div>
               )}
             </section>
           </div>
         </div>
       )}

      {selectedMedia &&
        getCreationKind(
          selectedMedia,
        ) !== "artifact" && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setSelectedMedia(null);
              }
            }}
          >
            <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {getCreationKind(
                      selectedMedia,
                    ) === "image"
                      ? "Image"
                      : language === "en"
                        ? "Video"
                        : "Vidéo"}
                  </p>

                  <p className="truncate text-xs text-black/45">
                    {formatDate(
                      selectedMedia.created_at,
                      language,
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      void handleDownload(
                        selectedMedia,
                      )
                    }
                    className="rounded-lg p-2 text-black/50 transition hover:bg-black/[0.05] hover:text-black"
                    aria-label={
                      UI[language].download
                    }
                  >
                    <Download className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedMedia(
                        null,
                      )
                    }
                    className="rounded-lg p-2 text-black/50 transition hover:bg-black/[0.05] hover:text-black"
                    aria-label={
                      UI[language].close
                    }
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-5">
                {getMediaUrl(
                  selectedMedia,
                ) ? (
                  getCreationKind(
                    selectedMedia,
                  ) === "image" ? (
                    <img
                      src={
                        getMediaUrl(
                          selectedMedia,
                        ) || ""
                      }
                      alt={
                        selectedMedia.prompt ||
                        UI[language]
                          .generatedWithOria
                      }
                      className="max-h-[78vh] max-w-full object-contain"
                    />
                  ) : (
                    <video
                      src={
                        getMediaUrl(
                          selectedMedia,
                        ) || ""
                      }
                      className="max-h-[78vh] max-w-full"
                      controls
                      autoPlay
                      playsInline
                    />
                  )
                ) : (
                  <p className="py-20 text-sm text-white/60">
                    {
                      UI[language]
                        .fileUnavailable
                    }
                  </p>
                )}
              </div>

              {selectedMedia.prompt && (
                <div className="max-h-28 overflow-y-auto border-t border-black/10 px-4 py-3">
                  <p className="text-xs leading-5 text-black/55">
                    {selectedMedia.prompt}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
    </main>
  );
}
