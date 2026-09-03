import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase/client";
import { AnyComponent } from "react-native-reanimated/lib/typescript/common";

type Conversation = {
  id: string;
  title: string;
  preview: string;
  date: string;
  model: string;
  updatedAt?: string;
};

type WalletData = {
  balance: number;
};

type ConversationResponse = {
  conversations: Conversation[];
};

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const CACHE_KEY = "oria_conversations_cache";

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return "Hier";

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (!supabase) {
    throw new Error(
      "Supabase n'est pas configuré. Vérifiez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error("Utilisateur non authentifié.");
  }

  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("user-id", session.user.id);
  headers.set("authorization", `Bearer ${session.access_token}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "Une erreur est survenue avec le serveur.";
    try {
      const error = await response.json();
      message = error?.detail || error?.message || message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

async function readCache(): Promise<Conversation[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(value: Conversation[]) {
  try {
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(value));
  } catch {}
}

function ConversationCard({
  conversation,
  isDeleting,
  onDelete,
  onOptions,
}: {
  conversation: Conversation;
  isDeleting: boolean;
  onDelete: (id: string) => void;
  onOptions: (conversation: Conversation) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={() =>
        router.push({
          pathname: "/chat" as any,
          params: { conversation: conversation.id },
        })
      }
    >
      <View style={styles.cardIcon}>
        <Ionicons name="chatbubble-outline" size={18} color="#55555f" />
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {conversation.title || "Nouvelle conversation"}
          </Text>
          <Text style={styles.cardDate}>
            {conversation.date ||
              formatDate(conversation.updatedAt) ||
              ""}
          </Text>
        </View>

        <Text style={styles.cardPreview} numberOfLines={2}>
          {conversation.preview || "Aucun aperçu disponible."}
        </Text>

        <View style={styles.modelBadge}>
          <Text style={styles.modelBadgeText}>
            {conversation.model || "Modèle IA"}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          hitSlop={8}
          style={styles.actionButton}
          onPress={(event) => {
            event.stopPropagation();
            onOptions(conversation);
          }}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={19}
            color="#8b8b95"
          />
        </Pressable>

        <Pressable
          hitSlop={8}
          disabled={isDeleting}
          style={styles.actionButton}
          onPress={(event) => {
            event.stopPropagation();
            onDelete(conversation.id);
          }}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#66666f" />
          ) : (
            <Ionicons name="trash-outline" size={18} color="#8b8b95" />
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function ConversationsPage() {
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingConversationId, setDeletingConversationId] =
    useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);

  const loadData = useCallback(async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    setError(null);

    try {
      const [conversationsResponse, walletResponse] = await Promise.all([
        apiFetch<ConversationResponse>("/conversations"),
        apiFetch<WalletData>("/credits/me"),
      ]);

      const nextConversations =
        conversationsResponse?.conversations ?? [];

      setConversations(nextConversations);
      setBalance(walletResponse?.balance ?? null);
      await writeCache(nextConversations);
    } catch (requestError) {
      console.error("Erreur chargement conversations :", requestError);

      const cached = await readCache();
      if (cached) {
        setConversations(cached);
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger vos conversations."
      );
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(false);
    setRefreshing(false);
  }, [loadData]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return conversations;

    return conversations.filter((conversation) =>
      [
        conversation.title,
        conversation.preview,
        conversation.model,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [search, conversations]);

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (deletingConversationId) return;

      Alert.alert(
        "Supprimer la conversation",
        "Cette conversation sera définitivement supprimée.",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: async () => {
              setDeletingConversationId(conversationId);
              setError(null);

              try {
                await apiFetch(
                  `/conversations/${conversationId}`,
                  { method: "DELETE" }
                );

                setConversations((current) =>
                  current.filter(
                    (conversation) => conversation.id !== conversationId
                  )
                );

                const cached = await readCache();
                if (cached) {
                  await writeCache(
                    cached.filter(
                      (conversation) =>
                        conversation.id !== conversationId
                    )
                  );
                }
              } catch (requestError) {
                console.error(
                  "Erreur suppression conversation :",
                  requestError
                );

                setError(
                  requestError instanceof Error
                    ? requestError.message
                    : "Impossible de supprimer la conversation."
                );
              } finally {
                setDeletingConversationId(null);
              }
            },
          },
        ]
      );
    },
    [deletingConversationId]
  );

  const openOptions = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setOptionsVisible(true);
  };

  const closeOptions = () => {
    setOptionsVisible(false);
    setSelectedConversation(null);
  };

  const startNewConversation = () => {
    router.push("/chat" as any);
  };

  const openSelectedConversation = () => {
    if (!selectedConversation) return;
    const id = selectedConversation.id;
    closeOptions();
    router.push({
      pathname: "/chat" as any,
      params: { conversation: id },
    });
  };

  const confirmSelectedDelete = () => {
    if (!selectedConversation) return;
    const id = selectedConversation.id;
    closeOptions();
    deleteConversation(id);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <Ionicons name="arrow-back" size={20} color="#4f4f58" />
            </Pressable>

            <View style={styles.brandIcon}>
              <Ionicons name="sparkles" size={15} color="#15151a" />
            </View>

            <Text style={styles.brandText}>ORIA</Text>
          </View>

          <Pressable
            style={styles.creditPill}
            onPress={() => router.push("/credits" as any)}
          >
            <Text style={styles.creditLabel}>Crédits</Text>
            <Text style={styles.creditValue}>
              {balance === null ? "..." : balance.toLocaleString("fr-FR")}
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            filteredConversations.length === 0 && styles.emptyListContent,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#111114"
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.pageHeader}>
                <View style={styles.pageHeaderText}>
                  <Text style={styles.overline}>VOTRE ESPACE</Text>
                  <Text style={styles.pageTitle}>Conversations</Text>
                  <Text style={styles.pageDescription}>
                    Retrouvez vos conversations avec les différents
                    modèles d&apos;Oria.
                  </Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.newButton,
                    pressed && styles.newButtonPressed,
                  ]}
                  onPress={startNewConversation}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.newButtonText}>
                    Nouvelle conversation
                  </Text>
                </Pressable>
              </View>

              <View style={styles.searchContainer}>
                <Ionicons
                  name="search"
                  size={18}
                  color="#9999a2"
                  style={styles.searchIcon}
                />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Rechercher une conversation..."
                  placeholderTextColor="#9999a2"
                  style={styles.searchInput}
                  editable={!isLoading}
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => setSearch("")}
                    style={styles.clearSearch}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color="#a0a0a8"
                    />
                  </Pressable>
                )}
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color="#66666f"
                  />
                  <Text style={styles.errorText}>{error}</Text>
                  <Pressable onPress={() => loadData()}>
                    <Text style={styles.retryText}>Réessayer</Text>
                  </Pressable>
                </View>
              ) : null}

              {isLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#111114" />
                  <Text style={styles.loadingText}>
                    Chargement de vos conversations...
                  </Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <ConversationCard
              conversation={item}
              isDeleting={deletingConversationId === item.id}
              onDelete={deleteConversation}
              onOptions={openOptions}
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyBox}>
                <View style={styles.emptyIcon}>
                  <Ionicons
                    name={search.trim() ? "search-outline" : "chatbubbles-outline"}
                    size={22}
                    color="#66666f"
                  />
                </View>

                <Text style={styles.emptyTitle}>
                  {search.trim()
                    ? "Aucune conversation trouvée"
                    : "Aucune conversation"}
                </Text>

                <Text style={styles.emptyDescription}>
                  {search.trim()
                    ? "Essayez avec un autre terme de recherche."
                    : "Vos conversations apparaîtront ici."}
                </Text>

                {!search.trim() ? (
                  <Pressable
                    style={styles.emptyButton}
                    onPress={startNewConversation}
                  >
                    <Text style={styles.emptyButtonText}>
                      Commencer une conversation
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color="#fff"
                    />
                  </Pressable>
                ) : null}
              </View>
            ) : null
          }
        />

        <Modal
          visible={optionsVisible}
          transparent
          animationType="fade"
          onRequestClose={closeOptions}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeOptions}>
            <Pressable style={styles.optionsSheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />

              <Text style={styles.sheetTitle} numberOfLines={1}>
                {selectedConversation?.title || "Conversation"}
              </Text>

              <Pressable
                style={styles.sheetAction}
                onPress={openSelectedConversation}
              >
                <View style={styles.sheetActionIcon}>
                  <Ionicons
                    name="chatbubble-outline"
                    size={19}
                    color="#33333a"
                  />
                </View>
                <Text style={styles.sheetActionText}>Ouvrir</Text>
              </Pressable>

              <Pressable
                style={styles.sheetAction}
                onPress={confirmSelectedDelete}
              >
                <View style={styles.sheetActionIcon}>
                  <Ionicons
                    name="trash-outline"
                    size={19}
                    color="#b23a3a"
                  />
                </View>
                <Text style={[styles.sheetActionText, styles.deleteText]}>
                  Supprimer
                </Text>
              </Pressable>

              <Pressable
                style={styles.cancelButton}
                onPress={closeOptions}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    height: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dedee3",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7,
  },
  brandIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandText: {
    color: "#15151a",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  creditPill: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: "#e2e2e6",
    backgroundColor: "#fafafa",
    borderRadius: 18,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  creditLabel: {
    color: "#7b7b84",
    fontSize: 11,
    marginRight: 7,
  },
  creditValue: {
    color: "#17171c",
    fontSize: 13,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 42,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  pageHeader: {
    marginBottom: 24,
  },
  pageHeaderText: {
    marginBottom: 18,
  },
  overline: {
    color: "#7c7c85",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  pageTitle: {
    color: "#15151a",
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  pageDescription: {
    color: "#777780",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 520,
  },
  newButton: {
    alignSelf: "flex-start",
    minHeight: 45,
    borderRadius: 12,
    backgroundColor: "#111114",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  newButtonPressed: {
    opacity: 0.82,
  },
  newButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 7,
  },
  searchContainer: {
    height: 49,
    borderWidth: 1,
    borderColor: "#dedee3",
    backgroundColor: "#fafafa",
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 17,
  },
  searchIcon: {
    marginLeft: 15,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 10,
    color: "#17171c",
    fontSize: 14,
  },
  clearSearch: {
    paddingHorizontal: 12,
  },
  errorBox: {
    minHeight: 49,
    borderWidth: 1,
    borderColor: "#e0e0e4",
    backgroundColor: "#fafafa",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 17,
  },
  errorText: {
    flex: 1,
    color: "#66666f",
    fontSize: 12,
    lineHeight: 18,
    marginHorizontal: 9,
  },
  retryText: {
    color: "#17171c",
    fontSize: 12,
    fontWeight: "700",
  },
  loadingBox: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: "#e5e5e8",
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  loadingText: {
    color: "#777780",
    fontSize: 13,
    marginTop: 9,
  },
  card: {
    minHeight: 105,
    borderWidth: 1,
    borderColor: "#e4e4e8",
    borderRadius: 15,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 9,
    backgroundColor: "#ffffff",
  },
  cardPressed: {
    backgroundColor: "#fafafa",
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#f1f1f3",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  cardTitle: {
    flex: 1,
    color: "#1a1a1f",
    fontSize: 14,
    fontWeight: "600",
    marginRight: 8,
  },
  cardDate: {
    color: "#9a9aa2",
    fontSize: 10.5,
  },
  cardPreview: {
    color: "#777780",
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 8,
  },
  modelBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#f2f2f4",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  modelBadgeText: {
    color: "#777780",
    fontSize: 10,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 5,
  },
  actionButton: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBox: {
    flex: 1,
    minHeight: 280,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d7d7dc",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 25,
    marginTop: 4,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: "#f1f1f3",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: "#202025",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 14,
  },
  emptyDescription: {
    color: "#81818a",
    fontSize: 12.5,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 5,
  },
  emptyButton: {
    marginTop: 17,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: "#111114",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  emptyButtonText: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "600",
    marginRight: 7,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "flex-end",
  },
  optionsSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 18,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#d3d3d7",
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTitle: {
    color: "#18181d",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  sheetAction: {
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ededf0",
    flexDirection: "row",
    alignItems: "center",
  },
  sheetActionIcon: {
    width: 35,
    height: 35,
    borderRadius: 10,
    backgroundColor: "#f2f2f4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  sheetActionText: {
    color: "#29292f",
    fontSize: 14,
    fontWeight: "500",
  },
  deleteText: {
    color: "#b23a3a",
  },
  cancelButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: "#f1f1f3",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 13,
  },
  cancelButtonText: {
    color: "#29292f",
    fontSize: 13,
    fontWeight: "600",
  },
});