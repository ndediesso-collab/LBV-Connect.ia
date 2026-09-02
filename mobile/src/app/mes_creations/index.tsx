import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createClient } from "@supabase/supabase-js";

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
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  "";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const createSupabaseClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const getMediaType = (media: MediaItem): MediaType => {
  if (media.media_type === "video" || media.type === "video") return "video";
  return "image";
};

const getMediaUrl = (media: MediaItem): string | null =>
  media.public_url || media.url || null;

const normalizeMediaUrl = (media: MediaItem): string | null => {
  const rawValue = getMediaUrl(media);

  if (!rawValue || typeof rawValue !== "string") return null;

  const value = rawValue.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);

    if (parsed.pathname.includes("/storage/v1/object/sign/")) {
      const publicPath = parsed.pathname.replace(
        "/storage/v1/object/sign/",
        "/storage/v1/object/public/"
      );
      return `${parsed.origin}${publicPath}`;
    }

    return value;
  } catch {
    return value;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return "Date inconnue";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";

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
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
};

const getActionLabel = (action?: string | null) => {
  if (!action) return null;
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function VideoPreview({
  uri,
  controls = false,
  autoPlay = false,
}: {
  uri: string;
  controls?: boolean;
  autoPlay?: boolean;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    if (autoPlay) instance.play();
  });

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
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { width } = useWindowDimensions();

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
      if (showRefreshState) setRefreshing(true);
      else setLoading(true);

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

        if (!API_BASE_URL) {
          throw new Error(
            "L'URL du backend n'est pas configurée dans l'application mobile."
          );
        }

        const response = await fetch(`${API_BASE_URL}/media`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            "user-id": session.user.id,
          },
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

        setMedia(Array.isArray(payload.media) ? payload.media : []);
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
      const extension =
        item.mime_type?.split("/")[1]?.split(";")[0] ||
        (getMediaType(item) === "video" ? "mp4" : "png");

      const filename = `oria-${item.id}.${extension}`;
      const baseDir =  FileSystem.Paths.cache;

      if (!baseDir) {
        throw new Error("Espace de stockage temporaire indisponible.");
      }

      const target = `${baseDir}${filename}`;
      const result = await FileSystem.downloadAsync(url, target);

      if (result.status < 200 || result.status >= 300) {
        throw new Error("Téléchargement impossible.");
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType:
            item.mime_type ||
            (getMediaType(item) === "video" ? "video/mp4" : "image/png"),
          dialogTitle: "Enregistrer ou partager votre création",
        });
      } else {
        Alert.alert(
          "Création téléchargée",
          "Le fichier a été téléchargé dans l'espace local de l'application."
        );
      }
    } catch (err) {
      Alert.alert(
        "Téléchargement",
        err instanceof Error
          ? err.message
          : "Impossible de télécharger cette création."
      );
    }
  }, []);

  const handleDelete = useCallback(
    async (item: MediaItem) => {
      Alert.alert(
        "Supprimer la création",
        "Supprimer définitivement cette création ?",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: async () => {
              setDeletingId(item.id);
              setError(null);

              try {
                const token = await getAccessToken();

                if (!token) {
                  throw new Error(
                    "Votre session a expiré. Veuillez vous reconnecter."
                  );
                }

                if (!API_BASE_URL) {
                  throw new Error(
                    "L'URL du backend n'est pas configurée dans l'application mobile."
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
          },
        ]
      );
    },
    [getAccessToken]
  );

  const columns = width >= 850 ? 3 : width >= 520 ? 2 : 1;
  const gap = 14;
  const cardWidth = (width - 40 - gap * (columns - 1)) / columns;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadMedia(true)}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => router.push("/chat" as any)}
              style={styles.backLink}
            >
              <Ionicons name="arrow-back" size={16} color="#6f6f77" />
              <Text style={styles.backText}>Retour au chat</Text>
            </Pressable>

            <View style={styles.titleRow}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>N</Text>
              </View>

              <View>
                <Text style={styles.eyebrow}>Oria</Text>
                <Text style={styles.title}>Mes créations</Text>
              </View>
            </View>

            <Text style={styles.description}>
              Retrouvez ici vos images et vidéos générées avec Oria.
            </Text>
          </View>

          <Pressable
            onPress={() => void loadMedia(true)}
            disabled={loading || refreshing}
            style={({ pressed }) => [
              styles.refreshButton,
              pressed && styles.pressed,
              (loading || refreshing) && styles.disabled,
            ]}
          >
            <Ionicons
              name="refresh-outline"
              size={17}
              color="#17171b"
            />
            <Text style={styles.refreshText}>Actualiser</Text>
          </Pressable>
        </View>

        {!loading && !error && media.length > 0 && (
          <View style={styles.stats}>
            <View style={styles.statDark}>
              <Text style={styles.statDarkText}>
                {media.length} création{media.length > 1 ? "s" : ""}
              </Text>
            </View>

            <View style={styles.statLight}>
              <Text style={styles.statLightText}>
                {imageCount} image{imageCount > 1 ? "s" : ""}
              </Text>
            </View>

            <View style={styles.statLight}>
              <Text style={styles.statLightText}>
                {videoCount} vidéo{videoCount > 1 ? "s" : ""}
              </Text>
            </View>
          </View>
        )}

        {!loading && media.length > 0 && (
          <View style={styles.filters}>
            {[
              { value: "all" as const, label: "Toutes", count: media.length },
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
                <Pressable
                  key={item.value}
                  onPress={() => setFilter(item.value)}
                  style={[styles.filterButton, active && styles.filterActive]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      active && styles.filterTextActive,
                    ]}
                  >
                    {item.label}{" "}
                    <Text style={active ? styles.countActive : styles.count}>
                      {item.count}
                    </Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {!!error && (
          <View style={styles.errorBox}>
            <View style={styles.errorContent}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color="#b42318"
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>

            <Pressable
              onPress={() => setError(null)}
              style={styles.errorClose}
            >
              <Ionicons name="close" size={18} color="#b42318" />
            </Pressable>
          </View>
        )}

        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#17171b" />
            <Text style={styles.loadingText}>
              Chargement de vos créations…
            </Text>
          </View>
        )}

        {!loading && !error && media.length === 0 && (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="images-outline"
                size={31}
                color="#777780"
              />
            </View>

            <Text style={styles.emptyTitle}>
              Aucune création pour le moment
            </Text>

            <Text style={styles.emptyDescription}>
              Vos images et vidéos générées avec Oria apparaîtront
              automatiquement ici.
            </Text>

            <Pressable
              onPress={() => router.push("/chat" as any)}
              style={styles.createButton}
            >
              <Text style={styles.createButtonText}>
                Créer quelque chose
              </Text>
            </Pressable>
          </View>
        )}

        {!loading && !error && media.length > 0 && filteredMedia.length === 0 && (
          <View style={styles.filterEmpty}>
            <Text style={styles.filterEmptyText}>
              Aucune création dans cette catégorie.
            </Text>
          </View>
        )}

        {!loading && !error && filteredMedia.length > 0 && (
          <View style={styles.gallery}>
            {filteredMedia.map((item) => {
              const type = getMediaType(item);
              const url = normalizeMediaUrl(item);
              const size = formatSize(item.size_bytes ?? item.size);
              const action = getActionLabel(item.action);

              return (
                <View
                  key={item.id}
                  style={[styles.card, { width: cardWidth }]}
                >
                  <Pressable
                    onPress={() => setSelectedMedia(item)}
                    style={({ pressed }) => [
                      styles.preview,
                      pressed && styles.previewPressed,
                    ]}
                  >
                    {url ? (
                      type === "image" ? (
                        <Image
                          source={{ uri: url }}
                          style={styles.mediaContent}
                          resizeMode="cover"
                          accessibilityLabel={
                            item.prompt ||
                            "Création générée avec Oria"
                          }
                        />
                      ) : (
                        <View style={styles.videoPreview}>
                          <VideoPreview uri={url} />
                          <View style={styles.playOverlay}>
                            <View style={styles.playCircle}>
                              <Ionicons
                                name="play"
                                size={21}
                                color="#17171b"
                              />
                            </View>
                          </View>
                        </View>
                      )
                    ) : (
                      <View style={styles.unavailable}>
                        <Ionicons
                          name={
                            type === "image"
                              ? "image-outline"
                              : "videocam-outline"
                          }
                          size={34}
                          color="#b0b0b7"
                        />
                      </View>
                    )}

                    <View style={styles.typeBadge}>
                      <Ionicons
                        name={
                          type === "image"
                            ? "image-outline"
                            : "videocam-outline"
                        }
                        size={12}
                        color="#fff"
                      />
                      <Text style={styles.typeBadgeText}>
                        {type === "image" ? "Image" : "Vidéo"}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.cardBody}>
                    <Text style={styles.prompt} numberOfLines={2}>
                      {item.prompt || "Création sans description"}
                    </Text>

                    <Text style={styles.date}>
                      {formatDate(item.created_at)}
                    </Text>

                    <View style={styles.cardFooter}>
                      <View style={styles.meta}>
                        {!!action && (
                          <View style={styles.metaPill}>
                            <Text
                              style={styles.metaText}
                              numberOfLines={1}
                            >
                              {action}
                            </Text>
                          </View>
                        )}

                        {!!size && (
                          <View style={styles.metaPill}>
                            <Text style={styles.metaText}>{size}</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => setSelectedMedia(item)}
                          style={styles.actionButton}
                          accessibilityLabel="Ouvrir"
                        >
                          <Ionicons
                            name={
                              type === "image"
                                ? "image-outline"
                                : "play-outline"
                            }
                            size={17}
                            color="#55555d"
                          />
                        </Pressable>

                        <Pressable
                          onPress={() => void handleDownload(item)}
                          disabled={!url}
                          style={[
                            styles.actionButton,
                            !url && styles.disabled,
                          ]}
                          accessibilityLabel="Télécharger"
                        >
                          <Ionicons
                            name="download-outline"
                            size={17}
                            color="#55555d"
                          />
                        </Pressable>

                        <Pressable
                          onPress={() => void handleDelete(item)}
                          disabled={deletingId === item.id}
                          style={[
                            styles.actionButton,
                            deletingId === item.id && styles.disabled,
                          ]}
                          accessibilityLabel="Supprimer"
                        >
                          {deletingId === item.id ? (
                            <ActivityIndicator
                              size="small"
                              color="#777780"
                            />
                          ) : (
                            <Ionicons
                              name="trash-outline"
                              size={17}
                              color="#777780"
                            />
                          )}
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!selectedMedia}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMedia(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>
                  {selectedMedia &&
                  getMediaType(selectedMedia) === "image"
                    ? "Image"
                    : "Vidéo"}
                </Text>
                <Text style={styles.modalDate}>
                  {formatDate(selectedMedia?.created_at)}
                </Text>
              </View>

              <View style={styles.modalActions}>
                {selectedMedia && (
                  <Pressable
                    onPress={() => void handleDownload(selectedMedia)}
                    style={styles.modalButton}
                    accessibilityLabel="Télécharger"
                  >
                    <Ionicons
                      name="download-outline"
                      size={21}
                      color="#55555d"
                    />
                  </Pressable>
                )}

                <Pressable
                  onPress={() => setSelectedMedia(null)}
                  style={styles.modalButton}
                  accessibilityLabel="Fermer"
                >
                  <Ionicons name="close" size={22} color="#55555d" />
                </Pressable>
              </View>
            </View>

            <View style={styles.modalMedia}>
              {selectedMedia &&
              normalizeMediaUrl(selectedMedia) ? (
                getMediaType(selectedMedia) === "image" ? (
                  <Image
                    source={{
                      uri: normalizeMediaUrl(selectedMedia) || "",
                    }}
                    style={styles.modalImage}
                    resizeMode="contain"
                  />
                ) : (
                  <VideoPreview
                    uri={normalizeMediaUrl(selectedMedia) || ""}
                    controls
                    autoPlay
                  />
                )
              ) : (
                <Text style={styles.unavailableText}>
                  Ce fichier n'est plus disponible.
                </Text>
              )}
            </View>

            {!!selectedMedia?.prompt && (
              <ScrollView
                style={styles.modalPromptContainer}
                contentContainerStyle={styles.modalPromptContent}
              >
                <Text style={styles.modalPrompt}>
                  {selectedMedia.prompt}
                </Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    gap: 20,
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
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17171b",
  },
  logoText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  eyebrow: {
    color: "#99999f",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    color: "#17171b",
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  description: {
    marginTop: 12,
    color: "#777780",
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 600,
  },
  refreshButton: {
    alignSelf: "flex-start",
    height: 44,
    paddingHorizontal: 15,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#dededb",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refreshText: {
    color: "#17171b",
    fontSize: 13,
    fontWeight: "700",
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  statDark: {
    backgroundColor: "#17171b",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statDarkText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  statLight: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dededb",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statLightText: {
    color: "#777780",
    fontSize: 12,
    fontWeight: "600",
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  filterButton: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dededb",
  },
  filterActive: {
    backgroundColor: "#17171b",
    borderColor: "#17171b",
  },
  filterText: {
    color: "#777780",
    fontSize: 12,
    fontWeight: "700",
  },
  filterTextActive: {
    color: "#fff",
  },
  count: {
    color: "#9999a2",
  },
  countActive: {
    color: "#aaaab0",
  },
  errorBox: {
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1c7c3",
    backgroundColor: "#fff3f1",
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
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
    fontSize: 13,
    lineHeight: 19,
  },
  errorClose: {
    padding: 2,
  },
  loadingBox: {
    minHeight: 360,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#dededb",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#777780",
    fontSize: 13,
  },
  emptyBox: {
    minHeight: 420,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cfcfca",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    textAlign: "center",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#f0f0ed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  emptyTitle: {
    color: "#17171b",
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyDescription: {
    marginTop: 8,
    maxWidth: 370,
    color: "#777780",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  createButton: {
    marginTop: 22,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 13,
    backgroundColor: "#17171b",
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  filterEmpty: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#dededb",
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 60,
    alignItems: "center",
  },
  filterEmptyText: {
    color: "#777780",
    fontSize: 13,
  },
  gallery: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  card: {
    overflow: "hidden",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#dededb",
    backgroundColor: "#fff",
  },
  preview: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#efefed",
    position: "relative",
    overflow: "hidden",
  },
  previewPressed: {
    opacity: 0.88,
  },
  mediaContent: {
    width: "100%",
    height: "100%",
  },
  videoPreview: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.08)",
  },
  playCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
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
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.72)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  typeBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  cardBody: {
    padding: 13,
  },
  prompt: {
    minHeight: 40,
    color: "#303036",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  date: {
    marginTop: 4,
    color: "#9999a2",
    fontSize: 10,
  },
  cardFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0ed",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  metaPill: {
    maxWidth: 140,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#f2f2f0",
  },
  metaText: {
    color: "#777780",
    fontSize: 9,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  actionButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.76)",
    justifyContent: "center",
    padding: 14,
  },
  modalCard: {
    width: "100%",
    maxHeight: "92%",
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#fff",
  },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e7e7e3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    color: "#17171b",
    fontSize: 14,
    fontWeight: "700",
  },
  modalDate: {
    marginTop: 2,
    color: "#9999a2",
    fontSize: 10,
  },
  modalActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  modalMedia: {
    height: 430,
    backgroundColor: "#080808",
    alignItems: "center",
    justifyContent: "center",
  },
  modalImage: {
    width: "100%",
    height: "100%",
  },
  unavailableText: {
    color: "#9999a2",
    fontSize: 13,
  },
  modalPromptContainer: {
    maxHeight: 120,
    borderTopWidth: 1,
    borderTopColor: "#e7e7e3",
  },
  modalPromptContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalPrompt: {
    color: "#777780",
    fontSize: 12,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.45,
  },
});