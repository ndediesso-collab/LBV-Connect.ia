"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Image as ImageIcon,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Video,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import LogoutButton from "@/components/layout/LogoutButton";
import type { ChatMessage, Conversation } from "@/types/lbv";

const capabilities = [
  { label: "Fichier", icon: FileText, accept: ".pdf,.doc,.docx,.txt,.csv,.xlsx" },
  { label: "Image", icon: ImageIcon, accept: "image/*" },
  { label: "Recherche Web", icon: Globe, accept: null },
  { label: "Vidéo", icon: Video, accept: "video/*" },
];

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Standard");

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  const [activeCapability, setActiveCapability] = useState<string | null>(
    null,
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  function createConversation() {
    const now = new Date().toISOString();

    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: "Nouvelle conversation",
      createdAt: now,
      updatedAt: now,
    };

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setMessage("");
    setSelectedFile(null);
    setActiveCapability(null);
    setSidebarOpen(false);
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setSidebarOpen(false);

    /*
     * Les conversations et messages sont encore conservés
     * côté frontend.
     *
     * La persistance Supabase viendra ensuite.
     */
  }

  function handleCapabilityClick(label: string) {
    if (label === "Recherche Web") {
      setActiveCapability((current) =>
        current === label ? null : label,
      );
      return;
    }

    if (label === "Fichier") {
      fileInputRef.current?.click();
      return;
    }

    if (label === "Image") {
      imageInputRef.current?.click();
      return;
    }

    if (label === "Vidéo") {
      videoInputRef.current?.click();
    }
  }

  function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSelectedFile(file);
    setActiveCapability(null);

    event.target.value = "";
  }

  function removeSelectedFile() {
    setSelectedFile(null);
  }

  function handleSendMessage() {
    const content = message.trim();

    if ((!content && !selectedFile) || isThinking) {
      return;
    }

    const now = new Date().toISOString();

    let conversationId = activeConversationId;

    if (!conversationId) {
      const titleSource =
        content ||
        selectedFile?.name ||
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

      setActiveConversationId(conversationId);
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
                      selectedFile?.name ||
                      "Nouvelle conversation",
                updatedAt: now,
              }
            : conversation,
        ),
      );
    }

    const messageContent = selectedFile
      ? content
        ? `${content}\n\n📎 ${selectedFile.name}`
        : `📎 ${selectedFile.name}`
      : content;

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
    setSelectedFile(null);
    setActiveCapability(null);
    setIsThinking(true);

    /*
     * Simulation temporaire.
     *
     * Cette partie sera remplacée par l'appel
     * au backend IA de LBV-Connect.ia.
     */
    window.setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content:
          "Votre message a bien été reçu. Le moteur IA de LBV-Connect.ia sera connecté prochainement.",
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
                updatedAt: new Date().toISOString(),
              }
            : conversation,
        ),
      );

      setIsThinking(false);
    }, 800);
  }

  return (
    <main className="min-h-dvh overflow-hidden bg-[#f7f7f5] text-neutral-950">
      {/* Inputs fichiers invisibles */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.csv,.xlsx"
        className="hidden"
        onChange={handleFileSelected}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Overlay mobile */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed bottom-4 left-4 top-4 z-50 flex w-[260px] flex-col rounded-3xl border border-neutral-200 bg-white/95 shadow-2xl shadow-neutral-900/10 backdrop-blur-xl transition-transform duration-300 md:translate-x-0 ${
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

            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
              Intelligence workspace
            </div>
          </div>

          <button
            type="button"
            aria-label="Fermer le menu"
            className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950 md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>

        {/* Nouvelle conversation */}
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={createConversation}
            className="flex w-full items-center justify-between rounded-2xl bg-neutral-950 px-4 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            <span className="flex items-center gap-3">
              <Plus size={17} />
              Nouvelle conversation
            </span>

            <span className="text-xs text-neutral-400">
              +
            </span>
          </button>
        </div>

        {/* Historique */}
        <div className="mt-6 flex-1 overflow-y-auto px-4">
          <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Historique
          </div>

          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-neutral-400">
              Aucune conversation pour le moment.
            </p>
          ) : (
            <div className="space-y-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() =>
                    selectConversation(conversation.id)
                  }
                  className={`w-full truncate rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    activeConversationId ===
                    conversation.id
                      ? "bg-neutral-100 font-medium text-neutral-950"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                  }`}
                >
                  {conversation.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Crédits */}
        <div className="px-4 pb-3">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">
                Crédits disponibles
              </span>

              <Wallet
                size={15}
                className="text-neutral-400"
              />
            </div>

            <p className="mt-2 text-xl font-semibold tracking-tight">
              15 000
            </p>

            <p className="mt-1 text-[11px] text-neutral-400">
              35 jours restants
            </p>
          </div>
        </div>

        {/* Navigation basse */}
        <div className="space-y-1 border-t border-neutral-200 px-4 py-3">
          <Link
            href="/credits"
            onClick={() => setSidebarOpen(false)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            <Wallet size={17} />
            Mes crédits
          </Link>

          <Link
            href="/settings"
            onClick={() => setSidebarOpen(false)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
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
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:bg-neutral-50"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </button>

            <div className="hidden sm:block">
              <p className="text-xs text-neutral-400">
                Workspace
              </p>

              <p className="text-sm font-medium">
                {activeConversationId
                  ? conversations.find(
                      (conversation) =>
                        conversation.id ===
                        activeConversationId,
                    )?.title || "Conversation active"
                  : "Nouvelle conversation"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/credits"
              className="hidden rounded-full border border-neutral-200 bg-white px-3 py-1.5 transition hover:bg-neutral-50 sm:flex"
            >
              <span className="text-xs text-neutral-500">
                Crédits
              </span>

              <span className="ml-2 text-sm font-semibold">
                15 000
              </span>
            </Link>

            <Link
              href="/settings"
              aria-label="Profil"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-medium shadow-sm transition hover:bg-neutral-50"
            >
              U
            </Link>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex flex-1 flex-col px-4 pb-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">

            {/* Empty state */}
            {messages.length === 0 && (
              <div className="flex flex-1 flex-col justify-center">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950 text-white shadow-sm">
                      <Sparkles size={20} />
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                        LBV-Connect.ia
                      </p>

                      <p className="text-sm font-medium">
                        Intelligence workspace
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
                    Comment puis-je vous aider ?
                  </h1>

                  <p className="mt-5 max-w-xl text-sm leading-6 text-neutral-500">
                    Discutez avec les modèles disponibles,
                    analysez vos fichiers, utilisez la
                    recherche Web et bien plus.
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
                            ? "max-w-[85%] rounded-3xl rounded-br-lg bg-neutral-950 px-5 py-3.5 text-sm leading-6 text-white"
                            : "max-w-[85%] rounded-3xl rounded-bl-lg border border-neutral-200 bg-white px-5 py-3.5 text-sm leading-6 text-neutral-800 shadow-sm"
                        }
                      >
                        {item.content}
                      </div>
                    </div>
                  ))}

                  {isThinking && (
                    <div className="flex justify-start">
                      <div className="rounded-3xl rounded-bl-lg border border-neutral-200 bg-white px-5 py-3.5 text-sm text-neutral-400 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex gap-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:150ms]" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:300ms]" />
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
                      ? "border-neutral-400 bg-neutral-100"
                      : "border-neutral-200 bg-white hover:bg-neutral-50"
                  }`}
                  onClick={() =>
                    setModelMenuOpen(
                      (current) => !current,
                    )
                  }
                >
                  <Sparkles size={16} />

                  {selectedModel}

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
                  <div className="absolute bottom-12 left-0 z-30 w-64 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
                    <ModelOption
                      name="Standard"
                      description="Rapide et économique"
                      active={
                        selectedModel ===
                        "Standard"
                      }
                      onClick={() => {
                        setSelectedModel(
                          "Standard",
                        );
                        setModelMenuOpen(false);
                      }}
                    />

                    <ModelOption
                      name="Raisonnement"
                      description="Pour les problèmes complexes"
                      active={
                        selectedModel ===
                        "Raisonnement"
                      }
                      onClick={() => {
                        setSelectedModel(
                          "Raisonnement",
                        );
                        setModelMenuOpen(false);
                      }}
                    />

                    <ModelOption
                      name="Premium"
                      description="Puissance maximale"
                      locked
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Fichier sélectionné */}
            {selectedFile && (
              <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
                    <FileText
                      size={17}
                      className="text-neutral-600"
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {selectedFile.name}
                    </p>

                    <p className="text-[11px] text-neutral-400">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Supprimer le fichier"
                  onClick={removeSelectedFile}
                  className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-950"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Mode Web */}
            {activeCapability === "Recherche Web" && (
              <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-100">
                    <Globe size={17} />
                  </div>

                  <div>
                    <p className="text-sm font-medium">
                      Recherche Web activée
                    </p>

                    <p className="text-[11px] text-neutral-400">
                      Le moteur Web sera connecté au backend.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveCapability(null)
                  }
                  className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950"
                  aria-label="Désactiver la recherche Web"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Composer */}
            <div className="mx-auto mt-4 w-full max-w-3xl">
              <div className="overflow-hidden rounded-[28px] border border-neutral-300 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition focus-within:border-neutral-500">
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
                  className="w-full resize-none bg-transparent px-5 pt-5 text-sm leading-6 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                />

                <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
                  <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {capabilities.map(
                      ({ label, icon: Icon }) => {
                        const isActive =
                          activeCapability ===
                          label;

                        return (
                          <button
                            key={label}
                            type="button"
                            title={label}
                            onClick={() =>
                              handleCapabilityClick(
                                label,
                              )
                            }
                            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 transition ${
                              isActive
                                ? "bg-neutral-950 text-white"
                                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
                            }`}
                          >
                            <Icon size={17} />

                            <span className="hidden text-xs sm:inline">
                              {label}
                            </span>
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
                      (!message.trim() &&
                        !selectedFile) ||
                      isThinking
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-neutral-400">
                Les crédits consommés dépendent du
                modèle et de l'opération.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ModelOption({
  name,
  description,
  active = false,
  locked = false,
  onClick,
}: {
  name: string;
  description: string;
  active?: boolean;
  locked?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
        locked
          ? "cursor-not-allowed opacity-45"
          : active
            ? "bg-neutral-100"
            : "hover:bg-neutral-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {name}
        </span>

        {active && !locked && (
          <Check
            size={15}
            className="text-neutral-700"
          />
        )}

        {locked && (
          <span className="text-[10px] uppercase tracking-wider text-neutral-400">
            Pro
          </span>
        )}
      </div>

      <p className="mt-0.5 text-xs text-neutral-500">
        {description}
      </p>
    </button>
  );
}