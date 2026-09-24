"use client";

import {
  ArrowLeft,
  MessageSquare,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

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
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const supabase = createClient();


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    backToChat: "Retour au chat",
    credits: "Crédits",
    yourSpace: "Votre espace",
    conversations: "Conversations",
    conversationsDescription:
      "Retrouvez vos conversations avec les différents modèles de Oria.",
    newConversation: "Nouvelle conversation",
    searchConversation: "Rechercher une conversation...",
    loadingConversations: "Chargement de vos conversations...",
    noConversationFound: "Aucune conversation trouvée",
    noConversation: "Aucune conversation",
    tryAnotherSearch: "Essayez avec un autre terme de recherche.",
    conversationsWillAppear: "Vos conversations apparaîtront ici.",
    startConversation: "Commencer une conversation",
    noPreview: "Aucun aperçu disponible.",
    optionsFor: "Options pour",
    delete: "Supprimer",
    deleteConfirm: "Supprimer définitivement cette conversation ?",
    loadError: "Impossible de charger vos conversations.",
    deleteError: "Impossible de supprimer la conversation.",
  },
  en: {
    backToChat: "Back to chat",
    credits: "Credits",
    yourSpace: "Your workspace",
    conversations: "Conversations",
    conversationsDescription:
      "Find your conversations with Oria's different models.",
    newConversation: "New conversation",
    searchConversation: "Search conversations...",
    loadingConversations: "Loading your conversations...",
    noConversationFound: "No conversations found",
    noConversation: "No conversations",
    tryAnotherSearch: "Try a different search term.",
    conversationsWillAppear: "Your conversations will appear here.",
    startConversation: "Start a conversation",
    noPreview: "No preview available.",
    optionsFor: "Options for",
    delete: "Delete",
    deleteConfirm: "Permanently delete this conversation?",
    loadError: "Unable to load your conversations.",
    deleteError: "Unable to delete the conversation.",
  },
} as const;

function getInitialOriaLanguage(): OriaLanguage {
  if (typeof window === "undefined") {
    return "fr";
  }

  const saved = window.localStorage.getItem(
    ORIA_LANGUAGE_STORAGE_KEY,
  );

  if (saved === "fr" || saved === "en") {
    return saved;
  }

  return window.navigator.language
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "fr";
}

function localizeFrontendError(
  message: string,
  language: OriaLanguage,
): string {
  if (language === "fr") {
    return message;
  }

  const exact: Record<string, string> = {
    "Utilisateur non authentifié.":
      "User not authenticated.",
    "Une erreur est survenue avec le serveur.":
      "A server error occurred.",
    "Impossible de charger vos conversations.":
      UI.en.loadError,
    "Impossible de supprimer la conversation.":
      UI.en.deleteError,
  };

  return exact[message] ?? message;
}

function getDisplayedConversationTitle(
  title: string,
  language: OriaLanguage,
): string {
  if (
    language === "en" &&
    title === "Nouvelle conversation"
  ) {
    return UI.en.newConversation;
  }

  return title;
}


async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error(
      "Utilisateur non authentifié.",
    );
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
    const error = await response.json().catch(
      () => null,
    );

    throw new Error(
      error?.detail ||
        "Une erreur est survenue avec le serveur.",
    );
  }

  return response.json();
}

export default function ConversationsPage() {
  const [language, setLanguage] =
    useState<OriaLanguage>("fr");

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getInitialOriaLanguage());
    };

    syncLanguage();

    window.addEventListener(
      "storage",
      syncLanguage,
    );
    window.addEventListener(
      "oria-language-change",
      syncLanguage,
    );

    return () => {
      window.removeEventListener(
        "storage",
        syncLanguage,
      );
      window.removeEventListener(
        "oria-language-change",
        syncLanguage,
      );
    };
  }, []);

  const [search, setSearch] = useState("");

  const [
    conversations,
    setConversations,
  ] = useState<Conversation[]>([]);

  const [balance, setBalance] =
    useState<number | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [
    deletingConversationId,
    setDeletingConversationId,
  ] = useState<string | null>(null);

  /*
   * ============================================================
   * CHARGEMENT
   * ============================================================
   */

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const [
        conversationsResponse,
        walletResponse,
      ] = await Promise.all([
        apiFetch<ConversationResponse>(
          "/conversations",
        ),
        apiFetch<WalletData>(
          "/credits/me",
        ),
      ]);

      setConversations(
        conversationsResponse.conversations ||
          [],
      );

      setBalance(
        walletResponse.balance ?? null,
      );
    } catch (requestError) {
      console.error(
        "Erreur chargement conversations :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger vos conversations.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  /*
   * ============================================================
   * RECHERCHE
   * ============================================================
   */

  const filteredConversations =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      if (!query) {
        return conversations;
      }

      return conversations.filter(
        (conversation) =>
          conversation.title
            .toLowerCase()
            .includes(query) ||
          conversation.preview
            .toLowerCase()
            .includes(query) ||
          conversation.model
            .toLowerCase()
            .includes(query),
      );
    }, [search, conversations]);

  /*
   * ============================================================
   * SUPPRESSION
   * ============================================================
   */

  async function deleteConversation(
    conversationId: string,
  ) {
    if (deletingConversationId) {
      return;
    }

    const confirmed =
      window.confirm(
        UI[language].deleteConfirm,
      );

    if (!confirmed) {
      return;
    }

    setDeletingConversationId(
      conversationId,
    );

    try {
      await apiFetch(
        `/conversations/${conversationId}`,
        {
          method: "DELETE",
        },
      );

      setConversations(
        (current) =>
          current.filter(
            (conversation) =>
              conversation.id !==
              conversationId,
          ),
      );
    } catch (requestError) {
      console.error(
        "Erreur suppression conversation :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de supprimer la conversation.",
      );
    } finally {
      setDeletingConversationId(null);
    }
  }

  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      {/* Header */}

      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label={UI[language].backToChat}
              className="rounded-xl p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />

              <span className="font-semibold tracking-tight">
                Oria
              </span>
            </div>
          </div>

          <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5">
            <span className="text-xs text-neutral-500">
              {UI[language].credits}
            </span>

            <span className="ml-2 text-sm font-semibold">
              {balance === null
                ? "..."
                : balance.toLocaleString(
                    language === "en" ? "en-US" : "fr-FR",
                  )}
            </span>
          </div>
        </div>
      </header>

      {/* Contenu */}

      <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {/* En-tête */}

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">
              {UI[language].yourSpace}
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Conversations
            </h1>

            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
              {UI[language].conversationsDescription}
            </p>
          </div>

          <Link
            href="/chat"
            className="inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            {UI[language].newConversation}
          </Link>
        </div>

        {/* Recherche */}

        <div className="relative mt-8">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
          />

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder={UI[language].searchConversation}
            disabled={isLoading}
            className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {/* Erreur */}

        {error && (
          <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            {localizeFrontendError(error, language)}
          </div>
        )}

        {/* Liste */}

        <div className="mt-8">
          {isLoading ? (
            <div className="rounded-2xl border border-neutral-200 px-6 py-16 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-950" />

              <p className="mt-4 text-sm text-neutral-500">
                {UI[language].loadingConversations}
              </p>
            </div>
          ) : filteredConversations.length >
            0 ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-200">
              {filteredConversations.map(
                (
                  conversation,
                  index,
                ) => (
                  <ConversationItem
                    language={language}
                    key={
                      conversation.id
                    }
                    conversation={
                      conversation
                    }
                    isLast={
                      index ===
                      filteredConversations.length -
                        1
                    }
                    isDeleting={
                      deletingConversationId ===
                      conversation.id
                    }
                    onDelete={
                      deleteConversation
                    }
                  />
                ),
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-16 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100">
                <MessageSquare
                  size={19}
                  className="text-neutral-500"
                />
              </div>

              <h2 className="mt-4 text-sm font-medium">
                {search.trim()
                  ? UI[language].noConversationFound
                  : UI[language].noConversation}
              </h2>

              <p className="mt-1 text-sm text-neutral-500">
                {search.trim()
                  ? UI[language].tryAnotherSearch
                  : UI[language].conversationsWillAppear}
              </p>

              {!search.trim() && (
                <Link
                  href="/chat"
                  className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
                >
                  {UI[language].startConversation}
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/*
 * ============================================================
 * ITEM CONVERSATION
 * ============================================================
 */

function ConversationItem({
  language,
  conversation,
  isLast,
  isDeleting,
  onDelete,
}: {
  language: OriaLanguage;
  conversation: Conversation;
  isLast: boolean;
  isDeleting: boolean;
  onDelete: (
    conversationId: string,
  ) => void;
}) {
  return (
    <div
      className={`group flex items-start gap-4 p-4 transition hover:bg-neutral-50 sm:p-5 ${
        !isLast
          ? "border-b border-neutral-200"
          : ""
      }`}
    >
      {/* Icône */}

      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
        <MessageSquare
          size={17}
          className="text-neutral-600"
        />
      </div>

      {/* Conversation */}

      <Link
        href={`/chat?conversation=${conversation.id}`}
        className="min-w-0 flex-1"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="truncate text-sm font-medium">
            {getDisplayedConversationTitle(
              conversation.title,
              language,
            )}
          </h2>

          <span className="shrink-0 text-xs text-neutral-400">
            {conversation.date}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-500">
          {conversation.preview ||
            UI[language].noPreview}
        </p>

        <span className="mt-2 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500">
          {conversation.model}
        </span>
      </Link>

      {/* Actions */}

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`${UI[language].optionsFor} ${getDisplayedConversationTitle(conversation.title, language)}`}
          className="rounded-lg p-2 text-neutral-400 opacity-100 transition hover:bg-neutral-100 hover:text-neutral-950 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <MoreHorizontal size={18} />
        </button>

        <button
          type="button"
          aria-label={`${UI[language].delete} ${getDisplayedConversationTitle(conversation.title, language)}`}
          disabled={isDeleting}
          onClick={() =>
            onDelete(
              conversation.id,
            )
          }
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
        >
          {isDeleting ? (
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
          ) : (
            <Trash2 size={17} />
          )}
        </button>
      </div>
    </div>
  );
}