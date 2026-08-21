"use client";

import {
  ArrowUp,
  ChevronDown,
  FileText,
  Globe,
  Image,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Video,
  Wallet,
} from "lucide-react";
import { useState } from "react";

const conversations = [
  "Nouvelle stratégie marketing",
  "Analyse de mon document",
  "Code Python",
  "Idées de business",
];

const capabilities = [
  { label: "Fichier", icon: FileText },
  { label: "Image", icon: Image },
  { label: "Recherche Web", icon: Globe },
  { label: "Vidéo", icon: Video },
];

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Standard");

  return (
    <main className="flex min-h-dvh overflow-hidden bg-white text-neutral-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          aria-label="Fermer le menu"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4">
          <span className="font-semibold tracking-tight">
            LBV-Connect.ia
          </span>

          <button
            aria-label="Fermer le menu"
            className="rounded-lg p-2 hover:bg-neutral-200 md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="p-3">
          <button className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium shadow-sm transition hover:bg-neutral-50">
            <Plus size={18} />
            Nouvelle conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-400">
            Conversations récentes
          </p>

          <div className="space-y-1">
            {conversations.map((conversation) => (
              <button
                key={conversation}
                className="w-full truncate rounded-xl px-3 py-2.5 text-left text-sm text-neutral-600 transition hover:bg-neutral-200 hover:text-neutral-950"
              >
                {conversation}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-200 p-3">
          <div className="mb-2 rounded-xl bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">Crédits</span>
              <Wallet size={16} className="text-neutral-500" />
            </div>

            <p className="mt-1 text-lg font-semibold">15 000</p>

            <p className="text-xs text-neutral-500">
              35 jours restants
            </p>
          </div>

          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-200 hover:text-neutral-950">
            <Wallet size={17} />
            Mes crédits
          </button>

          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-200 hover:text-neutral-950">
            <Settings size={17} />
            Paramètres
          </button>
        </div>
      </aside>

      {/* Main chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-neutral-200 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              aria-label="Ouvrir le menu"
              className="rounded-lg p-2 hover:bg-neutral-100 md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>

            <div className="relative">
              <button
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium hover:bg-neutral-100"
                onClick={() => setModelMenuOpen(!modelMenuOpen)}
              >
                <Sparkles size={17} />
                {selectedModel}
                <ChevronDown size={15} />
              </button>

              {modelMenuOpen && (
                <div className="absolute left-0 top-12 z-30 w-64 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
                  <ModelOption
                    name="Standard"
                    description="Rapide et économique"
                    active={selectedModel === "Standard"}
                    onClick={() => {
                      setSelectedModel("Standard");
                      setModelMenuOpen(false);
                    }}
                  />

                  <ModelOption
                    name="Raisonnement"
                    description="Pour les problèmes complexes"
                    active={selectedModel === "Raisonnement"}
                    onClick={() => {
                      setSelectedModel("Raisonnement");
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

          <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5">
            <span className="text-xs text-neutral-500">Crédits</span>
            <span className="text-sm font-semibold">15 000</span>
          </div>
        </header>

        {/* Conversation */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-12">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white">
              <Sparkles size={22} />
            </div>

            <h1 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              Comment puis-je vous aider ?
            </h1>

            <p className="mt-3 max-w-lg text-center text-sm leading-6 text-neutral-500">
              Discutez avec les modèles disponibles sur LBV-Connect.ia,
              analysez vos fichiers, utilisez la recherche Web et bien plus.
            </p>
          </div>

          {/* Input area */}
          <div className="mx-auto w-full max-w-3xl px-4 pb-5 sm:px-5">
            <div className="rounded-2xl border border-neutral-300 bg-white shadow-sm transition focus-within:border-neutral-500">
              <textarea
                rows={3}
                placeholder="Écrivez à LBV-Connect.ia..."
                className="w-full resize-none bg-transparent px-4 pt-4 text-sm outline-none placeholder:text-neutral-400"
              />

              <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-2">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {capabilities.map(({ label, icon: Icon }) => (
                    <button
                      key={label}
                      title={label}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 sm:px-2.5"
                    >
                      <Icon size={17} />
                      <span className="hidden text-xs sm:inline">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  aria-label="Envoyer"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white transition hover:bg-neutral-800"
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>

            <p className="mt-2 text-center text-[11px] text-neutral-400">
              Les crédits consommés dépendent du modèle et de l'opération.
            </p>
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
        <span className="text-sm font-medium">{name}</span>

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