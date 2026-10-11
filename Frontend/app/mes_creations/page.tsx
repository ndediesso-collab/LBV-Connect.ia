"use client";

import {
  Download,
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
import { useCallback, useEffect, useMemo, useState } from "react";

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
  url?: string | null;

  mime_type?: string | null;
  size_bytes?: number | null;
  size?: number | null;

  metadata?: Record<string, unknown> | null;
  seconds?: number | string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

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
  "";

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

  if (explicit === "artifact" || mediaType === "file") {
    return "artifact";
  }

  if (explicit === "video" || mediaType === "video") {
    return "video";
  }

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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user?.id || !session.access_token) {
      throw new Error(UI[language].sessionExpired);
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

  const loadCreations = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const response = await authenticatedFetch(
          "/creations?limit=100",
        );

        let payload: CreationsResponse = {};

        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(
            payload.detail ||
              payload.message ||
              UI[language].loadFailed,
          );
        }

        setCreations(
          Array.isArray(payload.creations)
            ? payload.creations
            : [],
        );
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : UI[language].loadError,
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authenticatedFetch, language],
  );

  useEffect(() => {
    void loadCreations();
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

  const resolveArtifactDownloadUrl = useCallback(
    async (item: CreationItem) => {
      const existing = getArtifactUrl(item);

      if (existing) {
        return existing;
      }

      const response = await authenticatedFetch(
        `/artifacts/${encodeURIComponent(item.id)}`,
      );

      let payload: {
        artifact?: CreationItem;
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
            UI[language].downloadError,
        );
      }

      const refreshed = payload.artifact;
      const url = refreshed
        ? getArtifactUrl(refreshed)
        : null;

      if (!url) {
        throw new Error(
          UI[language].fileUnavailable,
        );
      }

      setCreations((current) =>
        current.map((creation) =>
          creation.id === item.id
            ? {
                ...creation,
                ...refreshed,
              }
            : creation,
        ),
      );

      return url;
    },
    [authenticatedFetch, language],
  );

  const handleDownload = useCallback(
    async (item: CreationItem) => {
      try {
        const kind = getCreationKind(item);

        const url =
          kind === "artifact"
            ? await resolveArtifactDownloadUrl(item)
            : getMediaUrl(item);

        if (!url) {
          throw new Error(
            UI[language].fileUnavailable,
          );
        }

        const response = await fetch(url);

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
    [language, resolveArtifactDownloadUrl],
  );

  const handleOpen = useCallback(
    async (item: CreationItem) => {
      const kind = getCreationKind(item);

      if (kind !== "artifact") {
        setSelectedMedia(item);
        return;
      }

      try {
        const url =
          await resolveArtifactDownloadUrl(item);

        window.open(
          url,
          "_blank",
          "noopener,noreferrer",
        );
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : UI[language].fileUnavailable,
        );
      }
    },
    [language, resolveArtifactDownloadUrl],
  );

  const handleDelete = useCallback(
    async (item: CreationItem) => {
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
                              UI[language].open
                            }
                          >
                            <FileText className="h-4 w-4" />
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
