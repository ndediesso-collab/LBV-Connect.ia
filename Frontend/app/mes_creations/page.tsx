"use client";

import {
  Download,
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

type MediaType = "image" | "video";
type FilterType = "all" | MediaType;

type MediaItem = {
  id: string;
  user_id?: string;
  media_type?: MediaType;
  type?: MediaType;
  prompt?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  size?: number | null;
  metadata?: Record<string, unknown> | null;
  action?: string | null;
  model?: string | null;
  credits_cost?: number | null;
  seconds?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "";

const getMediaType = (media: MediaItem): MediaType => {
  if (media.media_type === "video" || media.type === "video") {
    return "video";
  }

  return "image";
};

const getMediaUrl = (media: MediaItem): string | null =>
  media.public_url || media.url || null;

const normalizeMediaUrl = (media: MediaItem): string | null => {
  const value =
    media.public_url ||
    media.url ||
    null;

  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim() || null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "Date inconnue";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatSize = (value?: number | null) => {
  if (!value || value <= 0) return null;

  if (value < 1024) {
    return `${value} o`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} Ko`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
};

const getActionLabel = (action?: string | null) => {
  if (!action) return null;

  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

export default function CreationsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || null;
  }, [supabase]);

  const loadMedia = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          setMedia([]);
          setError("Votre session a expiré. Veuillez vous reconnecter.");
          return;
        }

        const token = session.access_token;

        if (!API_BASE_URL) {
          throw new Error(
            "L'URL du backend n'est pas configurée dans le frontend."
          );
        }

        const response = await fetch(`${API_BASE_URL}/media`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "user-id": session.user.id,
          },
          cache: "no-store",
        });

        let payload: {
          media?: MediaItem[];
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
              "Impossible de récupérer vos créations."
          );
        }

        const loadedMedia = Array.isArray(payload.media)
          ? payload.media
          : [];

        setMedia(loadedMedia);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Une erreur est survenue pendant le chargement."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const filteredMedia = useMemo(() => {
    if (filter === "all") return media;

    return media.filter((item) => getMediaType(item) === filter);
  }, [filter, media]);

  const imageCount = useMemo(
    () => media.filter((item) => getMediaType(item) === "image").length,
    [media]
  );

  const videoCount = useMemo(
    () => media.filter((item) => getMediaType(item) === "video").length,
    [media]
  );

  const handleDownload = useCallback(async (item: MediaItem) => {
    const url = normalizeMediaUrl(item);

    if (!url) {
      setError("Le fichier de cette création n'est plus disponible.");
      return;
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Téléchargement impossible.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const extension =
        item.mime_type?.split("/")[1]?.split(";")[0] ||
        (getMediaType(item) === "video" ? "mp4" : "png");

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `nkyel-${item.id}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback : le navigateur peut ouvrir directement l'URL signée.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const handleDelete = useCallback(
    async (item: MediaItem) => {
      const confirmed = window.confirm(
        "Supprimer définitivement cette création ?"
      );

      if (!confirmed) return;

      setDeletingId(item.id);
      setError(null);

      try {
        const token = await getAccessToken();

        if (!token) {
          throw new Error("Votre session a expiré. Veuillez vous reconnecter.");
        }

        if (!API_BASE_URL) {
          throw new Error(
            "L'URL du backend n'est pas configurée dans le frontend."
          );
        }

        const response = await fetch(
          `${API_BASE_URL}/media/${encodeURIComponent(item.id)}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        let payload: { detail?: string; message?: string } = {};

        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(
            payload.detail ||
              payload.message ||
              "Impossible de supprimer cette création."
          );
        }

        setMedia((current) =>
          current.filter((currentItem) => currentItem.id !== item.id)
        );

        setSelectedMedia((current) =>
          current?.id === item.id ? null : current
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de supprimer cette création."
        );
      } finally {
        setDeletingId(null);
      }
    },
    [getAccessToken]
  );

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#111111]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        {/* Header */}
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/chat"
              className="mb-5 inline-flex items-center text-sm font-medium text-black/55 transition hover:text-black"
            >
              ← Retour au chat
            </Link>

            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-sm font-black tracking-tight text-white">
                N
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/40">
                  NKYEL
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Mes créations
                </h1>
              </div>
            </div>

            <p className="mt-3 max-w-xl text-sm leading-6 text-black/55">
              Retrouvez ici vos images et vidéos générées avec NKYEL.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadMedia(true)}
            disabled={loading || refreshing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold shadow-sm transition hover:border-black/20 hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Actualiser
          </button>
        </header>

        {/* Stats */}
        {!loading && !error && media.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-black px-3 py-1.5 font-medium text-white">
              {media.length} création{media.length > 1 ? "s" : ""}
            </span>

            <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-black/60">
              {imageCount} image{imageCount > 1 ? "s" : ""}
            </span>

            <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-black/60">
              {videoCount} vidéo{videoCount > 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Filters */}
        {!loading && media.length > 0 && (
          <div className="mb-7 flex flex-wrap gap-2">
            {[
              {
                value: "all" as const,
                label: "Toutes",
                count: media.length,
              },
              {
                value: "image" as const,
                label: "Images",
                count: imageCount,
              },
              {
                value: "video" as const,
                label: "Vidéos",
                count: videoCount,
              },
            ].map((item) => {
              const active = filter === item.value;

              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-black text-white"
                      : "border border-black/10 bg-white text-black/60 hover:border-black/20 hover:text-black"
                  }`}
                >
                  {item.label}
                  <span className={active ? "ml-1.5 opacity-60" : "ml-1.5 opacity-40"}>
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded-lg p-1 hover:bg-red-100"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-black/10 bg-white">
            <div className="flex flex-col items-center gap-3 text-black/45">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">Chargement de vos créations…</p>
            </div>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && media.length === 0 && (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-black/15 bg-white px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-black/[0.04]">
              <ImageIcon className="h-7 w-7 text-black/40" />
            </div>

            <h2 className="text-xl font-semibold">Aucune création pour le moment</h2>

            <p className="mt-2 max-w-md text-sm leading-6 text-black/50">
              Vos images et vidéos générées avec NKYEL apparaîtront
              automatiquement ici.
            </p>

            <Link
              href="/chat"
              className="mt-6 inline-flex h-11 items-center rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85"
            >
              Créer quelque chose
            </Link>
          </div>
        )}

        {/* Filter empty */}
        {!loading && !error && media.length > 0 && filteredMedia.length === 0 && (
          <div className="rounded-3xl border border-black/10 bg-white px-6 py-16 text-center">
            <p className="text-sm text-black/50">
              Aucune création dans cette catégorie.
            </p>
          </div>
        )}

        {/* Gallery */}
        {!loading && !error && filteredMedia.length > 0 && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredMedia.map((item) => {
              const type = getMediaType(item);
              const url = normalizeMediaUrl(item);
              const size = formatSize(item.size_bytes ?? item.size);
              const action = getActionLabel(item.action);

              return (
                <article
                  key={item.id}
                  className="group overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-black/15 hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMedia(item);
                    }}
                    className="relative block aspect-square w-full overflow-hidden bg-black/[0.04] text-left"
                    aria-label={`Ouvrir la ${type === "image" ? "création image" : "vidéo"}`}
                  >
                    {url ? (
                      type === "image" ? (
                        <img
                          src={url}
                          alt={item.prompt || "Création générée avec NKYEL"}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                          loading="lazy"
                        />
                      ) : (
                        <>
                          <video
                            src={url}
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
                        {type === "image" ? (
                          <ImageIcon className="h-8 w-8 text-black/25" />
                        ) : (
                          <Video className="h-8 w-8 text-black/25" />
                        )}
                      </div>
                    )}

                    <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
                      {type === "image" ? (
                        <ImageIcon className="h-3 w-3" />
                      ) : (
                        <Video className="h-3 w-3" />
                      )}
                      {type === "image" ? "Image" : "Vidéo"}
                    </span>
                  </button>

                  <div className="p-4">
                    <div className="min-h-[46px]">
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-black/80">
                        {item.prompt || "Création sans description"}
                      </p>

                      <p className="mt-1 text-xs text-black/40">
                        {formatDate(item.created_at)}
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
                          onClick={() => setSelectedMedia(item)}
                          className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black"
                          aria-label="Ouvrir"
                        >
                          {type === "image" ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDownload(item)}
                          disabled={!url}
                          className="rounded-lg p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label="Télécharger"
                        >
                          <Download className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDelete(item)}
                          disabled={deletingId === item.id}
                          className="rounded-lg p-2 text-black/35 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Supprimer"
                        >
                          {deletingId === item.id ? (
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
            })}
          </section>
        )}
      </div>

      {/* Viewer */}
      {selectedMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedMedia(null);
            }
          }}
        >
          <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {getMediaType(selectedMedia) === "image"
                    ? "Image"
                    : "Vidéo"}
                </p>
                <p className="truncate text-xs text-black/45">
                  {formatDate(selectedMedia.created_at)}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleDownload(selectedMedia)}
                  className="rounded-lg p-2 text-black/50 transition hover:bg-black/[0.05] hover:text-black"
                  aria-label="Télécharger"
                >
                  <Download className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMedia(null)}
                  className="rounded-lg p-2 text-black/50 transition hover:bg-black/[0.05] hover:text-black"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-5">
              {normalizeMediaUrl(selectedMedia) ? (
                getMediaType(selectedMedia) === "image" ? (
                  <img
                    src={normalizeMediaUrl(selectedMedia) || ""}
                    alt={selectedMedia.prompt || "Création NKYEL"}
                    className="max-h-[78vh] max-w-full object-contain"
                  />
                ) : (
                  <video
                    src={normalizeMediaUrl(selectedMedia) || ""}
                    className="max-h-[78vh] max-w-full"
                    controls
                    autoPlay
                    playsInline
                  />
                )
              ) : (
                <p className="py-20 text-sm text-white/60">
                  Ce fichier n'est plus disponible.
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