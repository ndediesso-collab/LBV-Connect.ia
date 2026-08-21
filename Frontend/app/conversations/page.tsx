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
import { useMemo, useState } from "react";

type Conversation = {
  id: string;
  title: string;
  preview: string;
  date: string;
  model: string;
};

const conversations: Conversation[] = [
  {
    id: "1",
    title: "Nouvelle stratégie marketing",
    preview: "Comment développer une stratégie adaptée au marché gabonais...",
    date: "Aujourd'hui",
    model: "Standard",
  },
  {
    id: "2",
    title: "Analyse de mon document",
    preview: "Voici les principaux éléments que j'ai relevés dans votre document...",
    date: "Aujourd'hui",
    model: "Raisonnement",
  },
  {
    id: "3",
    title: "Code Python",
    preview: "Peux-tu m'aider à corriger cette fonction Python...",
    date: "Hier",
    model: "Standard",
  },
  {
    id: "4",
    title: "Idées de business",
    preview: "Voici plusieurs idées de projets numériques pouvant être développés...",
    date: "Hier",
    model: "Raisonnement",
  },
  {
    id: "5",
    title: "Analyse du marché",
    preview: "Résume-moi les principales tendances de ce marché...",
    date: "18 août",
    model: "Premium",
  },
];

export default function ConversationsPage() {
  const [search, setSearch] = useState("");

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(query) ||
        conversation.preview.toLowerCase().includes(query),
    );
  }, [search]);

  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label="Retour au chat"
              className="rounded-xl p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <span className="font-semibold tracking-tight">
                LBV-Connect.ia
              </span>
            </div>
          </div>

          <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5">
            <span className="text-xs text-neutral-500">Crédits</span>
            <span className="ml-2 text-sm font-semibold">15 000</span>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">
              Votre espace
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Conversations
            </h1>

            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
              Retrouvez vos conversations avec les différents modèles de
              LBV-Connect.ia.
            </p>
          </div>

          <Link
            href="/chat"
            className="inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            Nouvelle conversation
          </Link>
        </div>

        <div className="relative mt-8">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
          />

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher une conversation..."
            className="h-12 w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white"
          />
        </div>

        <div className="mt-8">
          {filteredConversations.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-200">
              {filteredConversations.map((conversation, index) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isLast={index === filteredConversations.length - 1}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-16 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100">
                <MessageSquare size={19} className="text-neutral-500" />
              </div>

              <h2 className="mt-4 text-sm font-medium">
                Aucune conversation trouvée
              </h2>

              <p className="mt-1 text-sm text-neutral-500">
                Essayez avec un autre terme de recherche.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function ConversationItem({
  conversation,
  isLast,
}: {
  conversation: Conversation;
  isLast: boolean;
}) {
  return (
    <div
      className={`group flex items-start gap-4 p-4 transition hover:bg-neutral-50 sm:p-5 ${
        !isLast ? "border-b border-neutral-200" : ""
      }`}
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
        <MessageSquare size={17} className="text-neutral-600" />
      </div>

      <Link href={`/chat?conversation=${conversation.id}`} className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="truncate text-sm font-medium">
            {conversation.title}
          </h2>

          <span className="shrink-0 text-xs text-neutral-400">
            {conversation.date}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-500">
          {conversation.preview}
        </p>

        <span className="mt-2 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500">
          {conversation.model}
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-1">
        <button
          aria-label={`Options pour ${conversation.title}`}
          className="rounded-lg p-2 text-neutral-400 opacity-100 transition hover:bg-neutral-100 hover:text-neutral-950 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <MoreHorizontal size={18} />
        </button>

        <button
          aria-label={`Supprimer ${conversation.title}`}
          className="hidden rounded-lg p-2 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 sm:block sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 size={17} />
        </button>
      </div>
    </div>
  );
}