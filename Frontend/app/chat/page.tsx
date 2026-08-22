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
import LogoutButton from "@/components/layout/LogoutButton";

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
    <main className="min-h-dvh overflow-hidden bg-[#f7f7f5] text-neutral-950">
        {/* Mobile overlay */}
        {sidebarOpen && (
        <button
            aria-label="Fermer le menu"
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] md:hidden"
            onClick={() => setSidebarOpen(false)}
        />
        )}

        {/* Floating navigation */}
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
            aria-label="Fermer le menu"
            className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950 md:hidden"
            onClick={() => setSidebarOpen(false)}
            >
            ×
            </button>
        </div>

        {/* New conversation */}
        <div className="px-4 pt-2">
            <button className="flex w-full items-center justify-between rounded-2xl bg-neutral-950 px-4 py-3.5 text-sm font-medium text-white transition hover:bg-neutral-800">
            <span className="flex items-center gap-3">
                <Plus size={17} />
                Nouvelle conversation
            </span>

            <span className="text-xs text-neutral-400">
                +
            </span>
            </button>
        </div>

        {/* Conversations */}
        <div className="mt-6 flex-1 overflow-y-auto px-4">
            <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Historique
            </div>

            <div className="space-y-1">
            {conversations.map((conversation) => (
                <button
                key={conversation}
                className="w-full truncate rounded-xl px-3 py-2.5 text-left text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
                >
                {conversation}
                </button>
            ))}
            </div>
        </div>

        {/* Credits */}
        <div className="px-4 pb-3">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">
                Crédits disponibles
                </span>

                <Wallet size={15} className="text-neutral-400" />
            </div>

            <p className="mt-2 text-xl font-semibold tracking-tight">
                15 000
            </p>

            <p className="mt-1 text-[11px] text-neutral-400">
                35 jours restants
            </p>
            </div>
        </div>

        {/* Navigation */}
        <div className="space-y-1 border-t border-neutral-200 px-4 py-3">
            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950">
            <Wallet size={17} />
            Mes crédits
            </button>

            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950">
            <Settings size={17} />
            Paramètres
            </button>

            <LogoutButton />
        </div>
        </aside>

        {/* Main workspace */}
        <section className="flex min-h-dvh flex-col">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
            <button
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
                Nouvelle conversation
                </p>
            </div>
            </div>

            <div className="flex items-center gap-2">
            <div className="hidden rounded-full border border-neutral-200 bg-white px-3 py-1.5 sm:flex">
                <span className="text-xs text-neutral-500">
                Crédits
                </span>

                <span className="ml-2 text-sm font-semibold">
                15 000
                </span>
            </div>

            <button className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-medium shadow-sm">
                U
            </button>
            </div>
        </header>

        {/* Workspace */}
        <div className="flex flex-1 flex-col px-4 pb-4 sm:px-8">
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center">
            {/* Intro */}
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
                Discutez avec les modèles disponibles, analysez vos fichiers,
                utilisez la recherche Web et bien plus.
                </p>
            </div>

            {/* Model selector */}
            <div className="mx-auto mt-10 w-full max-w-3xl">
                <div className="relative inline-block">
                <button
                    className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-medium shadow-sm transition hover:bg-neutral-50"
                    onClick={() =>
                    setModelMenuOpen(!modelMenuOpen)
                    }
                >
                    <Sparkles size={16} />
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

            {/* Composer */}
            <div className="mx-auto mt-5 w-full max-w-3xl">
                <div className="overflow-hidden rounded-[28px] border border-neutral-300 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition focus-within:border-neutral-500">
                <textarea
                    rows={4}
                    placeholder="Écrivez à LBV-Connect.ia..."
                    className="w-full resize-none bg-transparent px-5 pt-5 text-sm leading-6 outline-none placeholder:text-neutral-400"
                />

                <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
                    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {capabilities.map(({ label, icon: Icon }) => (
                        <button
                        key={label}
                        title={label}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
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
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-white transition hover:bg-neutral-800"
                    >
                    <ArrowUp size={18} />
                    </button>
                </div>
                </div>

                <p className="mt-3 text-center text-[11px] text-neutral-400">
                Les crédits consommés dépendent du modèle et de l'opération.
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