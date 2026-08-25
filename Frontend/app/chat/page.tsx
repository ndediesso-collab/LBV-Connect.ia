"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Image as ImageIcon,
  Lock,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import LogoutButton from "@/components/layout/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Conversation } from "@/types/lbv";

/*
 * ============================================================
 * CONFIGURATION API
 * ============================================================
 *
 * NEXT_PUBLIC_API_URL doit pointer vers le backend FastAPI.
 *
 * Exemple :
 *
 * NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
 *
 * Les routes peuvent être modifiées ici sans toucher
 * à l'interface.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

/*
 * ============================================================
 * TYPES FRONTEND
 * ============================================================
 */

type WalletData = {
  balance: number;
  initial_credits: number;
  pack_id: string | null;
  pack_activated_at: string | null;
  pack_expires_at: string | null;
};

type ChatResponse = {
  success: boolean;
  action: string;
  cost: number;
  previous_balance: number;
  new_balance: number;
  consumed_credits: number;
  consumed_percentage: number;
  remaining_percentage: number;
  requires_warning: boolean;
  requires_critical_warning: boolean;
  response?: string;
  message?: string;
};

type ConversationResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: ChatMessage[];
};

/*
 * ============================================================
 * CAPACITÉS
 * ============================================================
 */

const capabilities = [
  {
    label: "Fichier",
    icon: FileText,
    accept: null,
    disabled: true,
  },
  {
    label: "Image",
    icon: ImageIcon,
    accept: null,
    disabled: true,
  },
  {
    label: "Recherche Web",
    icon: Globe,
    accept: null,
    disabled: false,
  },
];

/*
 * ============================================================
 * MODÈLES
 * ============================================================
 *
 * Les noms sont désormais alignés sur les modèles du système.
 *
 * L'autorisation réelle du modèle doit être vérifiée par
 * le backend selon le pack de l'utilisateur.
 */

type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  packs: string[];
};

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

function getAvailableModels(packId: string | null): ModelDefinition[] {
  if (!packId) return [];
  return models.filter((model) => model.packs.includes(packId));
}

/*
 * ============================================================
 * API
 * ============================================================
 */

const supabase = createClient();

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || !session.access_token) {
    throw new Error(
      "Utilisateur non authentifié.",
    );
  }

  const headers = new Headers(
    options?.headers,
  );

  headers.set(
    "Content-Type",
    "application/json",
  );

  headers.set(
    "user-id",
    session.user.id,
  );

  headers.set(
    "authorization",
    `Bearer ${session.access_token}`,
  );

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers,
    },
  );

  if (!response.ok) {
    const error =
      await response.json().catch(
        () => null,
      );

    if (response.status === 401) {
      throw new Error(
        "Session expirée. Veuillez vous reconnecter.",
      );
    }

    throw new Error(
      error?.detail ||
        "Une erreur est survenue avec le serveur.",
    );
  }

  return response.json();
}

/*
 * ============================================================
 * PAGE CHAT
 * ============================================================
 */

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [modelMenuOpen, setModelMenuOpen] =
    useState(false);

  const [selectedModel, setSelectedModel] =
    useState("luna");

  const [message, setMessage] =
    useState("");

  const [messages, setMessages] =
    useState<ChatMessage[]>([]);

  const [isThinking, setIsThinking] =
    useState(false);

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [
    activeConversationId,
    setActiveConversationId,
  ] = useState<string | null>(null);

  const [
    activeCapability,
    setActiveCapability,
  ] = useState<string | null>(null);


  const [wallet, setWallet] =
    useState<WalletData | null>(null);

  const [isLoadingWallet, setIsLoadingWallet] =
    useState(true);

  const [
    isLoadingConversations,
    setIsLoadingConversations,
  ] = useState(true);

  const [error, setError] =
    useState<string | null>(null);


  /*
   * ==========================================================
   * CHARGEMENT DU WALLET
   * ==========================================================
   *
   * L'endpoint devra être relié à l'utilisateur connecté.
   *
   * Pour l'instant, la structure frontend est prête.
   */

  async function loadWallet() {
    try {
      setIsLoadingWallet(true);
      setError(null);

      const data =
        await apiFetch<{
          success: boolean;
          wallet: WalletData;
        }>(
          "/credits/me",
        );

      const walletData = data.wallet;

      setWallet(walletData);

      const availableModels =
        getAvailableModels(
          walletData.pack_id,
        );

      if (availableModels.length > 0) {
        setSelectedModel((current) =>
          availableModels.some((model) => model.id === current)
            ? current
            : availableModels[0].id,
        );
      } else {
        setSelectedModel("");
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement wallet :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger les crédits.",
      );
    } finally {
      setIsLoadingWallet(false);
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT DE L'HISTORIQUE
   * ==========================================================
   */

  async function loadConversations() {
    try {
      setIsLoadingConversations(true);

      const data =
        await apiFetch<ConversationResponse>(
          "/conversations",
        );

      setConversations(
        data.conversations || [],
      );
    } catch (requestError) {
      console.error(
        "Erreur chargement conversations :",
        requestError,
      );

      /*
       * L'absence d'historique ne doit pas
       * bloquer l'ouverture du chat.
       */
      setConversations([]);
    } finally {
      setIsLoadingConversations(false);
    }
  }

  /*
   * ==========================================================
   * INITIALISATION
   * ==========================================================
   */

  useEffect(() => {
    loadWallet();
    loadConversations();
  }, []);

  /*
   * ==========================================================
   * NOUVELLE CONVERSATION
   * ==========================================================
   */

  function createConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setMessage("");
    setActiveCapability(null);
    setError(null);
    setSidebarOpen(false);
  }

  /*
   * ==========================================================
   * SÉLECTION D'UNE CONVERSATION
   * ==========================================================
   */

  async function selectConversation(
    conversationId: string,
  ) {
    setActiveConversationId(
      conversationId,
    );

    setSidebarOpen(false);
    setError(null);

    try {
      const data =
        await apiFetch<MessagesResponse>(
          `/conversations/${conversationId}/messages`,
        );

      setMessages(
        data.messages || [],
      );
    } catch (requestError) {
      console.error(
        "Erreur chargement messages :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger la conversation.",
      );
    }
  }

  /*
   * ==========================================================
   * CAPACITÉS
   * ==========================================================
   */

  function handleCapabilityClick(label: string) {
    if (label === "Recherche Web") {
      setActiveCapability((current) =>
        current === label ? null : label,
      );
    }

    // Fichier et Image sont volontairement verrouillés en V1.
    // Ils seront activés dans une prochaine version.
  }

  /*
   * ==========================================================
   * ENVOI DU MESSAGE
   * ==========================================================
   */

  async function handleSendMessage() {
    const content = message.trim();

    if (!content || isThinking) {
      return;
    }

    const now = new Date().toISOString();

    let conversationId =
      activeConversationId;

    if (!conversationId) {
      const titleSource =
        content ||
        "Nouvelle conversation";

      const newConversation: Conversation = {
        id: crypto.randomUUID(),
        title:
          titleSource.length > 45
            ? `${titleSource.slice(0, 45)}...`
            : titleSource,
        createdAt: now,
        updatedAt: now,
      };

      conversationId = newConversation.id;

      setConversations((current) => [
        newConversation,
        ...current,
      ]);

      setActiveConversationId(
        conversationId,
      );
    } else {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId &&
          conversation.title === "Nouvelle conversation"
            ? {
                ...conversation,
                title:
                  content.length > 45
                    ? `${content.slice(0, 45)}...`
                    : content ||
                      "Nouvelle conversation",
                updatedAt: now,
              }
            : conversation,
        ),
      );
    }

    const messageContent = content;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: messageContent,
      createdAt: now,
    };

    setMessages((current) => [
      ...current,
      userMessage,
    ]);

    setMessage("");
    setActiveCapability(null);
    setIsThinking(true);

    try {
      const data =
        await apiFetch<ChatResponse>(
          "/ai/chat",
          {
            method: "POST",

            body: JSON.stringify({
              model: selectedModel,
              message: messageContent,
              web:
                activeCapability ===
                "Recherche Web",
              confirmed: true,
            }),
          },
        );

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content:
          data.message ||
          data.response ||
          "Aucune réponse reçue.",
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [
        ...current,
        assistantMessage,
      ]);

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                updatedAt:
                  new Date().toISOString(),
              }
            : conversation,
        ),
      );

      await loadWallet();

    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Impossible de contacter LBV-Connect.ia.";

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: `Erreur : ${errorMessage}`,
        createdAt:
          new Date().toISOString(),
      };

      setMessages((current) => [
        ...current,
        assistantMessage,
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  /*
   * ==========================================================
   * JOURS RESTANTS
   * ==========================================================
   */

  const remainingDays =
    wallet?.pack_expires_at
      ? Math.max(
          0,
          Math.ceil(
            (
              new Date(
                wallet.pack_expires_at,
              ).getTime() -
              Date.now()
            ) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  /*
   * ==========================================================
   * AFFICHAGE
   * ==========================================================
   */

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Overlay mobile */}

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] md:hidden"
          onClick={() =>
            setSidebarOpen(false)
          }
        />
      )}

      {/* Sidebar */}

      <aside
        className={`fixed bottom-4 left-4 top-4 z-50 flex w-[260px] flex-col rounded-3xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 md:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-[120%]"
        }`}
      >
        {/* Brand */}

        <div className="flex h-16 items-center justify-between px-5">
          <div>
            <div className="font-semibold tracking-tight">
              LBV-Connect.ia
            </div>

            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted">
              Intelligence workspace
            </div>
          </div>

          <button
            type="button"
            aria-label="Fermer le menu"
            className="rounded-xl p-2 text-muted transition hover:bg-surface-tertiary hover:text-foreground md:hidden"
            onClick={() =>
              setSidebarOpen(false)
            }
          >
            ×
          </button>
        </div>

        {/* Nouvelle conversation */}

        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={createConversation}
            className="flex w-full items-center justify-between rounded-2xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition hover:opacity-85"
          >
            <span className="flex items-center gap-3">
              <Plus size={17} />
              Nouvelle conversation
            </span>

            <span className="text-xs opacity-50">
              +
            </span>
          </button>
        </div>

        {/* Historique */}

        <div className="mt-6 flex-1 overflow-y-auto px-4">
          <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Historique
          </div>

          {isLoadingConversations ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              Chargement...
            </p>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              Aucune conversation pour le
              moment.
            </p>
          ) : (
            <div className="space-y-1">
              {conversations.map(
                (conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() =>
                      selectConversation(
                        conversation.id,
                      )
                    }
                    className={`w-full truncate rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      activeConversationId ===
                      conversation.id
                        ? "bg-surface-tertiary font-medium text-foreground"
                        : "text-muted-strong hover:bg-surface-tertiary hover:text-foreground"
                    }`}
                  >
                    {conversation.title}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {/* Crédits */}

        <div className="px-4 pb-3">
          <div className="rounded-2xl border border-border bg-surface-secondary p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                Crédits disponibles
              </span>

              <Wallet
                size={15}
                className="text-muted"
              />
            </div>

            <p className="mt-2 text-xl font-semibold tracking-tight">
              {isLoadingWallet
                ? "..."
                : wallet
                  ? wallet.balance.toLocaleString(
                      "fr-FR",
                    )
                  : "—"}
            </p>

            <p className="mt-1 text-[11px] text-muted">
              {remainingDays !== null
                ? `${remainingDays} jours restants`
                : "Durée indisponible"}
            </p>
          </div>
        </div>

        {/* Navigation basse */}

        <div className="space-y-1 border-t border-border px-4 py-3">
          <Link
            href="/credits"
            onClick={() =>
              setSidebarOpen(false)
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-strong transition hover:bg-surface-tertiary hover:text-foreground"
          >
            <Wallet size={17} />
            Mes crédits
          </Link>

          <Link
            href="/settings"
            onClick={() =>
              setSidebarOpen(false)
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-strong transition hover:bg-surface-tertiary hover:text-foreground"
          >
            <Settings size={17} />
            Paramètres
          </Link>

          <LogoutButton />
        </div>
      </aside>

      {/* Workspace principal */}

      <section className="flex min-h-dvh flex-col">
        {/* Header */}

        <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Ouvrir le menu"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface shadow-sm transition hover:bg-surface-secondary"
              onClick={() =>
                setSidebarOpen(true)
              }
            >
              <Menu size={19} />
            </button>

            <div className="hidden sm:block">
              <p className="text-xs text-muted">
                Workspace
              </p>

              <p className="text-sm font-medium">
                {activeConversationId
                  ? conversations.find(
                      (conversation) =>
                        conversation.id ===
                        activeConversationId,
                    )?.title ||
                    "Conversation active"
                  : "Nouvelle conversation"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/credits"
              className="hidden rounded-full border border-border bg-surface px-3 py-1.5 transition hover:bg-surface-secondary sm:flex"
            >
              <span className="text-xs text-muted">
                Crédits
              </span>

              <span className="ml-2 text-sm font-semibold">
                {isLoadingWallet
                  ? "..."
                  : wallet
                    ? wallet.balance.toLocaleString(
                        "fr-FR",
                      )
                    : "—"}
              </span>
            </Link>

            <Link
              href="/settings"
              aria-label="Profil"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-sm font-medium shadow-sm transition hover:bg-surface-secondary"
            >
              U
            </Link>
          </div>
        </header>

        {/* Workspace */}

        <div className="flex flex-1 flex-col px-4 pb-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {/* Erreur */}

            {error && (
              <div className="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-border bg-surface-secondary px-4 py-3 text-sm text-muted-strong">
                {error}
              </div>
            )}

            {/* Empty state */}

            {messages.length === 0 && (
              <div className="flex flex-1 flex-col justify-center">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
                      <Sparkles size={20} />
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">
                        LBV-Connect.ia
                      </p>

                      <p className="text-sm font-medium">
                        Intelligence workspace
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
                    Comment puis-je vous
                    aider ?
                  </h1>

                  <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
                    Discutez avec les modèles
                    disponibles et utilisez la recherche
                    Web directement depuis votre espace.
                  </p>
                </div>
              </div>
            )}

            {/* Messages */}

            {messages.length > 0 && (
              <div className="flex-1 overflow-y-auto py-8">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                  {messages.map((item) => (
                    <div
                      key={item.id}
                      className={
                        item.role === "user"
                          ? "flex justify-end"
                          : "flex justify-start"
                      }
                    >
                      <div
                        className={
                          item.role === "user"
                            ? "max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-5 py-3.5 text-sm leading-6 text-accent-foreground"
                            : "max-w-[85%] rounded-3xl rounded-bl-lg border border-border bg-surface px-5 py-3.5 text-sm leading-6 text-foreground shadow-sm"
                        }
                      >
                        {item.content}
                      </div>
                    </div>
                  ))}

                  {isThinking && (
                    <div className="flex justify-start">
                      <div className="rounded-3xl rounded-bl-lg border border-border bg-surface px-5 py-3.5 text-sm text-muted shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex gap-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                          </span>

                          LBV-Connect.ia réfléchit...
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Modèle */}

            <div
              className={`mx-auto w-full max-w-3xl ${
                messages.length === 0
                  ? "mt-10"
                  : "mt-4"
              }`}
            >
              <div className="relative inline-block">
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition ${
                    modelMenuOpen
                      ? "border-border-strong bg-surface-tertiary"
                      : "border-border bg-surface hover:bg-surface-secondary"
                  }`}
                  onClick={() => {
                    if (
                      getAvailableModels(wallet?.pack_id ?? null).length > 1
                    ) {
                      setModelMenuOpen((current) => !current);
                    }
                  }}
                >
                  <Sparkles size={16} />

                  {models.find(
                    (model) => model.id === selectedModel,
                  )?.name || "Modèle"}

                  <ChevronDown
                    size={15}
                    className={`transition-transform ${
                      modelMenuOpen
                        ? "rotate-180"
                        : ""
                    }`}
                  />
                </button>

                {modelMenuOpen && (
                  <div className="absolute bottom-12 left-0 z-30 w-80 rounded-2xl border border-border bg-surface p-2 shadow-xl">
                    {getAvailableModels(wallet?.pack_id ?? null).map((model) => (
                      <ModelOption
                        key={model.id}
                        name={model.name}
                        description={model.description}
                        active={selectedModel === model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setModelMenuOpen(false);
                        }}
                      />
                    ))}

                    {getAvailableModels(wallet?.pack_id ?? null).length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted">
                        Aucun modèle disponible avec ce pack.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Mode Web */}

            {activeCapability ===
              "Recherche Web" && (
              <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-tertiary">
                    <Globe size={17} />
                  </div>

                  <div>
                    <p className="text-sm font-medium">
                      Recherche Web activée
                    </p>

                    <p className="text-[11px] text-muted">
                      La recherche Web sera
                      exécutée par le backend.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveCapability(null)
                  }
                  className="rounded-lg p-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
                  aria-label="Désactiver la recherche Web"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Composer */}

            <div className="mx-auto mt-4 w-full max-w-3xl">
              <div className="overflow-hidden rounded-[28px] border border-border-strong bg-surface shadow-[0_12px_40px_var(--shadow-color)] transition focus-within:border-muted-strong">
                <textarea
                  rows={4}
                  value={message}
                  onChange={(event) =>
                    setMessage(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Écrivez à LBV-Connect.ia..."
                  disabled={isThinking}
                  className="w-full resize-none bg-transparent px-5 pt-5 text-sm leading-6 outline-none placeholder:text-muted disabled:opacity-60"
                />

                <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
                  <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {capabilities.map(
                      ({
                        label,
                        icon: Icon,
                        disabled,
                      }) => {
                        const isActive =
                          activeCapability ===
                          label;

                        return (
                          <button
                            key={label}
                            type="button"
                            title={
                              disabled
                                ? `${label} — Arrive bientôt`
                                : label
                            }
                            onClick={() =>
                              handleCapabilityClick(
                                label,
                              )
                            }
                            disabled={disabled}
                            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 transition ${
                              disabled
                                ? "cursor-not-allowed text-muted opacity-50"
                                : isActive
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-strong hover:bg-surface-tertiary hover:text-foreground"
                            }`}
                          >
                            <Icon size={17} />

                            <span className="hidden text-xs sm:inline">
                              {label}
                            </span>

                            {disabled && (
                              <Lock size={12} />
                            )}
                          </button>
                        );
                      },
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label="Envoyer"
                    onClick={handleSendMessage}
                    disabled={
                      !message.trim() ||
                      isThinking
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-muted">
                Les crédits consommés dépendent
                du modèle et de l&apos;opération.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/*
 * ============================================================
 * OPTION MODÈLE
 * ============================================================
 */

function ModelOption({
  name,
  description,
  active = false,
  onClick,
}: {
  name: string;
  description: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
        active
          ? "bg-surface-tertiary"
          : "hover:bg-surface-secondary"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {name}
        </span>

        {active && (
          <Check
            size={15}
            className="text-muted-strong"
          />
        )}
      </div>

      <p className="mt-0.5 text-xs text-muted">
        {description}
      </p>
    </button>
  );
}