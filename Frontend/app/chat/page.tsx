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
  Wallet,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import LogoutButton from "@/components/layout/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Conversation } from "@/types/lbv";

/*
 * ============================================================
 * CONFIGURATION API
 * ============================================================
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

/*
 * ============================================================
 * TYPES
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

type MediaCapability = {
  action: string;
  type: "image" | "video";
  credits: number;
};

type MediaCapabilitiesResponse = {
  success: boolean;
  pack_id: string | null;
  media: MediaCapability[];
};

type GeneratedMedia = {
  id: string;
  type: "image" | "video";
  mimeType: string;
  url: string;
  action: string;
  model: string;
  cost: number;
  creditsRemaining: number;
  seconds?: string | null;
  size?: string | null;
};


type MediaPreset = {
  type: "image" | "video";
  label: string;
  description: string;
  configuration: string;
};

const MEDIA_PRESETS: Record<string, MediaPreset> = {
  image_480: { type: "image", label: "Image 480", description: "Génération image légère", configuration: "480 px" },
  image_720: { type: "image", label: "Image 720", description: "Génération image légère", configuration: "720 px" },
  image_pro: { type: "image", label: "Image Pro", description: "Génération image professionnelle", configuration: "Pro" },
  image_pro_standard: { type: "image", label: "Image Pro Standard", description: "Qualité professionnelle standard", configuration: "Standard" },
  image_pro_ultra: { type: "image", label: "Image Pro Ultra", description: "Qualité professionnelle maximale", configuration: "Ultra" },
  image_business: { type: "image", label: "Image Business", description: "Génération image business", configuration: "Business" },
  image_business_hd: { type: "image", label: "Image Business HD", description: "Génération image business haute définition", configuration: "HD" },
  image_business_ultra: { type: "image", label: "Image Business Ultra", description: "Génération image business maximale", configuration: "Ultra" },
  video_4s: { type: "video", label: "Vidéo 4 s", description: "Génération vidéo légère", configuration: "4 secondes" },
  video_8s: { type: "video", label: "Vidéo 8 s", description: "Génération vidéo légère", configuration: "8 secondes" },
  video_lite: { type: "video", label: "Vidéo Lite", description: "Génération vidéo intermédiaire", configuration: "Lite" },
  video_pro_fast: { type: "video", label: "Vidéo Pro Fast", description: "Génération vidéo professionnelle rapide", configuration: "Fast" },
  video_pro_standard: { type: "video", label: "Vidéo Pro Standard", description: "Génération vidéo professionnelle standard", configuration: "Standard" },
  video_pro_extension: { type: "video", label: "Vidéo Pro Extension", description: "Extension d'une génération vidéo Pro", configuration: "Extension" },
  video_business_fast: { type: "video", label: "Vidéo Business Fast", description: "Génération vidéo business rapide", configuration: "Fast" },
  video_business_standard: { type: "video", label: "Vidéo Business Standard", description: "Génération vidéo business standard", configuration: "Standard" },
  video_business_long: { type: "video", label: "Vidéo Business Long", description: "Génération vidéo business longue", configuration: "Long" },
};

function getMediaPreset(action: string): MediaPreset {
  return MEDIA_PRESETS[action] ?? {
    type: action.startsWith("video_") ? "video" : "image",
    label: action,
    description: "Configuration média disponible",
    configuration: action,
  };
}

type ConversationResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: ChatMessage[];
};

/**
 * Pièce jointe sélectionnée dans le composer.
 *
 * Le frontend accepte jusqu'à 3 fichiers/images par message.
 * Les vrais objets File sont transmis au backend en
 * multipart/form-data. Maximum : 3 pièces par message.
 */
type ChatAttachment = {
  id: string;
  file: File;
  kind: "image" | "file";
  previewUrl: string | null;
};

const MAX_ATTACHMENTS = 3;

const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isAcceptedAttachment(file: File) {
  return (
    ACCEPTED_FILE_TYPES.includes(file.type) ||
    ACCEPTED_IMAGE_TYPES.includes(file.type)
  );
}


/*
 * ============================================================
 * CACHE LOCAL
 * ============================================================
 */

type LocalChatCache = {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
  selectedModel: string;
  activeCapability: string | null;
  savedAt: string;
};

const LOCAL_CACHE_PREFIX =
  "lbv_connect_chat_cache_v1";

function getLocalCacheKey(userId: string) {
  return `${LOCAL_CACHE_PREFIX}_${userId}`;
}

function readLocalCache(
  userId: string,
): LocalChatCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(
      getLocalCacheKey(userId),
    );

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    return {
      conversations: Array.isArray(
        parsed?.conversations,
      )
        ? parsed.conversations
        : [],

      messages:
        parsed?.messages &&
        typeof parsed.messages === "object"
          ? parsed.messages
          : {},

      activeConversationId:
        typeof parsed?.activeConversationId ===
        "string"
          ? parsed.activeConversationId
          : null,

      selectedModel:
        typeof parsed?.selectedModel === "string"
          ? parsed.selectedModel
          : "luna",

      activeCapability:
        typeof parsed?.activeCapability ===
        "string"
          ? parsed.activeCapability
          : null,

      savedAt:
        typeof parsed?.savedAt === "string"
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      "Erreur lecture cache LBV-Connect :",
      error,
    );

    return null;
  }
}

function writeLocalCache(
  userId: string,
  cache: Omit<LocalChatCache, "savedAt">,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const payload: LocalChatCache = {
      ...cache,
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      getLocalCacheKey(userId),
      JSON.stringify(payload),
    );
  } catch (error) {
    console.error(
      "Erreur sauvegarde cache LBV-Connect :",
      error,
    );
  }
}

function removeLocalCache(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(
      getLocalCacheKey(userId),
    );
  } catch (error) {
    console.error(
      "Erreur suppression cache LBV-Connect :",
      error,
    );
  }
}

/*
 * ============================================================
 * CAPACITÉS
 * ============================================================
 */

const capabilities = [
  {
    label: "Fichier",
    icon: FileText,
    disabled: false,
  },
  {
    label: "Image",
    icon: ImageIcon,
    disabled: false,
  },
  {
    label: "Recherche Web",
    icon: Globe,
    disabled: false,
  },
  {
    label: "Création",
    icon: Video,
    disabled: false,
  },
];

/*
 * ============================================================
 * MODÈLES
 * ============================================================
 */

type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  packs: string[];
};

type TrialInfo = {
  used: number;
  max: number;
  remaining: number;
};

type TrialResponse = {
  success: boolean;
  pack_id: string | null;
  trials: Record<string, TrialInfo>;
};

const models: ModelDefinition[] = [
  {
    id: "luna",
    name: "Luna",
    description:
      "Modèle économique · Rapide pour les échanges courants",
    packs: [
      "light_pack",
      "intermediate_pack",
      "pro_pack",
      "business_pack",
    ],
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    description:
      "Modèle polyvalent · Pour les tâches plus avancées",
    packs: [
      "intermediate_pack",
      "pro_pack",
      "business_pack",
    ],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description:
      "Raisonnement avancé · Pour les problèmes complexes",
    packs: [
      "pro_pack",
      "business_pack",
    ],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description:
      "Puissance maximale · Pour les tâches les plus exigeantes",
    packs: ["business_pack"],
  },
];

function getAvailableModels(
  packId: string | null,
): ModelDefinition[] {
  if (!packId) {
    return [];
  }

  return models.filter((model) =>
    model.packs.includes(packId),
  );
}

const TRIAL_MODEL_BY_PACK: Record<string, string> = {
  // Le pack inférieur peut essayer gratuitement le modèle
  // immédiatement supérieur, jusqu'à 5 utilisations.
  light_pack: "gpt-5",
  intermediate_pack: "gpt-5.6-terra",
  pro_pack: "gpt-5.6-sol",
};

function getSelectableModels(
  packId: string | null,
  trials: Record<string, TrialInfo>,
): ModelDefinition[] {
  const normalModels =
    getAvailableModels(packId);

  if (!packId) {
    return [];
  }

  const selectable = [...normalModels];
  const normalIds = new Set(
    normalModels.map(
      (model) => model.id,
    ),
  );

  // Un seul modèle supérieur est proposé en essai pour
  // chaque pack inférieur : 5 essais maximum.
  const trialModelId =
    TRIAL_MODEL_BY_PACK[packId];

  if (trialModelId && !normalIds.has(trialModelId)) {
    const trialModel = models.find(
      (model) =>
        model.id === trialModelId,
    );

    const trial = trials[trialModelId];

    if (trialModel && trial) {
      selectable.push(trialModel);
    }
  }

  return selectable;
}

/*
 * ============================================================
 * SUPABASE
 * ============================================================
 */

const supabase = createClient();

/*
 * ============================================================
 * API AUTHENTIFIÉE
 * ============================================================
 */

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

  if (
    options?.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

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

async function apiMediaFetch<T>(
  path: string,
  payload: { action: string; prompt: string },
): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/*
 * ============================================================
 * API STREAMING AUTHENTIFIÉE
 * ============================================================
 */

async function apiStreamFetch(
  path: string,
  formData: FormData,
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || !session.access_token) {
    throw new Error(
      "Utilisateur non authentifié.",
    );
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      method: "POST",
      headers: {
        "user-id": session.user.id,
        authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
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

  if (!response.body) {
    throw new Error(
      "Le serveur n'a pas fourni de flux de réponse.",
    );
  }

  return response;
}

/*
 * ============================================================
 * SYNCHRONISATION BACKEND
 * ============================================================
 */

async function createConversationRemote(
  title: string,
): Promise<Conversation> {
  const data =
    await apiFetch<
      Conversation | {
        conversation: Conversation;
      }
    >(
      "/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          title,
        }),
      },
    );

  if (
    "conversation" in data &&
    data.conversation
  ) {
    return data.conversation;
  }

  return data as Conversation;
}

async function saveMessageRemote(
  message: ChatMessage,
): Promise<ChatMessage | null> {
  const data =
    await apiFetch<
      ChatMessage | {
        message: ChatMessage;
      }
    >(
      `/conversations/${message.conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          role: message.role,
          content: message.content,
        }),
      },
    );

  if (
    "message" in data &&
    data.message
  ) {
    return data.message;
  }

  return data as ChatMessage;
}

/*
 * ============================================================
 * MARKDOWN INLINE
 * ============================================================
 *
 * Renderer volontairement léger et sans dépendance externe.
 *
 * Il permet notamment :
 *
 * **gras**
 * *italique*
 * `code`
 * [lien](https://...)
 */

function renderInlineMarkdown(
  text: string,
) {
  const parts: ReactNode[] = [];

  let remaining = text;
  let index = 0;

  const tokenRegex =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

  while (remaining.length > 0) {
    const match =
      remaining.match(tokenRegex);

    if (!match || match.index === undefined) {
      parts.push(
        <span key={index}>
          {remaining}
        </span>,
      );

      break;
    }

    if (match.index > 0) {
      parts.push(
        <span key={index}>
          {remaining.slice(
            0,
            match.index,
          )}
        </span>,
      );

      index++;
    }

    const token = match[0];

    /*
     * GRAS
     */

    if (
      token.startsWith("**") &&
      token.endsWith("**")
    ) {
      parts.push(
        <strong
          key={index}
          className="font-semibold"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    }

    /*
     * CODE INLINE
     */

    else if (
      token.startsWith("`") &&
      token.endsWith("`")
    ) {
      parts.push(
        <code
          key={index}
          className="rounded-md bg-surface-tertiary px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }

    /*
     * LIEN
     */

    else if (
      token.startsWith("[")
    ) {
      const linkMatch =
        token.match(
          /^\[([^\]]+)\]\(([^)]+)\)$/,
        );

      if (linkMatch) {
        const [, label, url] =
          linkMatch;

        parts.push(
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:opacity-70"
          >
            {label}
          </a>,
        );
      }
    }

    /*
     * ITALIQUE
     */

    else if (
      token.startsWith("*") &&
      token.endsWith("*")
    ) {
      parts.push(
        <em key={index}>
          {token.slice(1, -1)}
        </em>,
      );
    }

    remaining =
      remaining.slice(
        match.index +
          token.length,
      );

    index++;
  }

  return parts;
}

/*
 * ============================================================
 * MARKDOWN BLOCK RENDERER
 * ============================================================
 *
 * Transforme le texte brut de l'IA en vraie structure visuelle.
 *
 * Gestion :
 *
 * - paragraphes
 * - titres
 * - listes à puces
 * - listes numérotées
 * - blocs de code
 * - citations
 * - séparateurs
 * - Markdown inline
 */

function CopyButton({
  value,
}: {
  value: string;
}) {
  const [copied, setCopied] =
    useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        value,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground"
      aria-label="Copier le code"
      title="Copier le code"
    >
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

/*
 * ============================================================
 * MARKDOWN MESSAGE
 * ============================================================
 */

function MarkdownMessage({
  content,
}: {
  content: string;
}) {
  const normalized =
    content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const lines =
    normalized.split("\n");

  const blocks: ReactNode[] =
    [];

  let paragraph: string[] = [];

  let bulletItems: string[] =
    [];

  let numberedItems: string[] =
    [];

  let codeLines: string[] =
    [];

  let codeLanguage = "";

  let inCodeBlock = false;

  let blockIndex = 0;

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    const text =
      paragraph.join(" ");

    blocks.push(
      <p
        key={`paragraph-${blockIndex}`}
        className="mb-4 last:mb-0"
      >
        {renderInlineMarkdown(
          text,
        )}
      </p>,
    );

    blockIndex++;
    paragraph = [];
  }

  function flushBulletList() {
    if (bulletItems.length === 0) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ul
        key={`bullet-${blockIndex}`}
        className="mb-4 list-disc space-y-2 pl-6 last:mb-0"
      >
        {bulletItems.map(
          (item, index) => (
            <li
              key={`bullet-item-${index}`}
              className="pl-1"
            >
              {renderInlineMarkdown(
                item,
              )}
            </li>
          ),
        )}
      </ul>,
    );

    blockIndex++;
    bulletItems = [];
  }

  function flushNumberedList() {
    if (
      numberedItems.length ===
      0
    ) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ol
        key={`numbered-${blockIndex}`}
        className="mb-4 list-decimal space-y-2 pl-6 last:mb-0"
      >
        {numberedItems.map(
          (item, index) => (
            <li
              key={`numbered-item-${index}`}
              className="pl-1"
            >
              {renderInlineMarkdown(
                item,
              )}
            </li>
          ),
        )}
      </ol>,
    );

    blockIndex++;
    numberedItems = [];
  }

  function flushAllLists() {
    flushBulletList();
    flushNumberedList();
  }

  function flushCodeBlock() {
    if (!inCodeBlock) {
      return;
    }

    blocks.push(
      <div
        key={`code-${blockIndex}`}
        className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-secondary last:mb-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            {codeLanguage || "Code"}
          </span>

          <CopyButton
            value={codeLines.join("\n")}
          />
        </div>

        <div className="max-h-[360px] overflow-auto">
          <pre className="min-w-max p-4 text-xs leading-6">
            <code>
              {codeLines.join("\n")}
            </code>
          </pre>
        </div>
      </div>,
    );

    blockIndex++;
    codeLines = [];
    codeLanguage = "";
    inCodeBlock = false;
  }

  lines.forEach(
    (line, index) => {
      const trimmed =
        line.trim();

      /*
       * BLOC DE CODE
       */

      if (
        trimmed.startsWith("```")
      ) {
        if (!inCodeBlock) {
          flushAllLists();
          flushParagraph();

          inCodeBlock = true;

          codeLanguage =
            trimmed
              .slice(3)
              .trim();

          return;
        }

        flushCodeBlock();
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      /*
       * LIGNE VIDE
       */

      if (trimmed === "") {
        flushAllLists();
        flushParagraph();
        return;
      }

      /*
       * SÉPARATEUR
       */

      if (
        /^(-{3,}|\*{3,}|_{3,})$/.test(
          trimmed,
        )
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <hr
            key={`hr-${blockIndex}`}
            className="my-6 border-border"
          />,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H2
       */

      if (
        trimmed.startsWith("## ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h2
            key={`h2-${blockIndex}`}
            className="mb-3 mt-7 text-xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(3),
            )}
          </h2>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H3
       */

      if (
        trimmed.startsWith("### ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h3
            key={`h3-${blockIndex}`}
            className="mb-2 mt-6 text-base font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(4),
            )}
          </h3>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H1
       */

      if (
        trimmed.startsWith("# ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h1
            key={`h1-${blockIndex}`}
            className="mb-4 mt-7 text-2xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(2),
            )}
          </h1>,
        );

        blockIndex++;
        return;
      }

      /*
       * LISTE À PUCES
       */

      const bulletMatch =
        trimmed.match(
          /^[-*•]\s+(.+)$/,
        );

      if (bulletMatch) {
        flushParagraph();
        flushNumberedList();

        bulletItems.push(
          bulletMatch[1],
        );

        return;
      }

      /*
       * LISTE NUMÉROTÉE
       */

      const numberedMatch =
        trimmed.match(
          /^\d+[.)]\s+(.+)$/,
        );

      if (numberedMatch) {
        flushParagraph();
        flushBulletList();

        numberedItems.push(
          numberedMatch[1],
        );

        return;
      }

      /*
       * CITATION
       */

      if (
        trimmed.startsWith("> ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <blockquote
            key={`quote-${blockIndex}`}
            className="mb-4 border-l-2 border-border-strong pl-4 text-muted-strong last:mb-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(2),
            )}
          </blockquote>,
        );

        blockIndex++;
        return;
      }

      /*
       * PARAGRAPHE
       *
       * On conserve les phrases d'une même ligne logique
       * ensemble, puis on les espace lors du rendu.
       */

      flushAllLists();

      paragraph.push(
        trimmed,
      );
    },
  );

  /*
   * Fermeture des éventuels blocs restants.
   */

  if (inCodeBlock) {
    flushCodeBlock();
  }

  flushAllLists();
  flushParagraph();

  /*
   * Si le modèle est encore en train de streamer et que le
   * contenu est vide, on évite un conteneur inutile.
   */

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="break-words text-[14px] leading-7">
      {blocks}
    </div>
  );
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

  const [attachments, setAttachments] =
    useState<ChatAttachment[]>([]);

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const imageInputRef =
    useRef<HTMLInputElement>(null);

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

  const [trials, setTrials] =
    useState<Record<string, TrialInfo>>({});

  const [isLoadingTrials, setIsLoadingTrials] =
    useState(true);

  const [isLoadingWallet, setIsLoadingWallet] =
    useState(true);

  const [
    isLoadingConversations,
    setIsLoadingConversations,
  ] = useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [
    isInitialized,
    setIsInitialized,
  ] = useState(false);

  const [
    currentUserId,
    setCurrentUserId,
  ] = useState<string | null>(null);

  const [mediaCapabilities, setMediaCapabilities] =
    useState<MediaCapability[]>([]);

  const [selectedMediaAction, setSelectedMediaAction] =
    useState<string>("");

  const [mediaPrompt, setMediaPrompt] =
    useState("");

  const [generatedMedia, setGeneratedMedia] =
    useState<GeneratedMedia[]>([]);

  const [isLoadingMediaCapabilities, setIsLoadingMediaCapabilities] =
    useState(false);

  const [mediaMenuOpen, setMediaMenuOpen] =
    useState(false);

  /*
   * ==========================================================
   * SAUVEGARDE LOCALE
   * ==========================================================
   */

  useEffect(() => {
    if (
      !isInitialized ||
      !currentUserId
    ) {
      return;
    }

    const timeout =
      window.setTimeout(() => {
        writeLocalCache(
          currentUserId,
          {
            conversations,
            messages: {
              ...(readLocalCache(
                currentUserId,
              )?.messages || {}),
              ...(activeConversationId
                ? {
                    [activeConversationId]:
                      messages,
                  }
                : {}),
            },
            activeConversationId,
            selectedModel,
            activeCapability,
          },
        );
      }, 300);

    return () =>
      window.clearTimeout(
        timeout,
      );
  }, [
    conversations,
    messages,
    activeConversationId,
    selectedModel,
    activeCapability,
    currentUserId,
    isInitialized,
  ]);

  /*
   * ==========================================================
   * CHARGEMENT WALLET
   * ==========================================================
   */

  async function loadWallet(
    trialState: Record<string, TrialInfo> = trials,
  ) {
    try {
      setIsLoadingWallet(true);
      setError(null);

      const data =
        await apiFetch<{
          success: boolean;
          wallet: WalletData;
        }>("/credits/me");

      const walletData =
        data.wallet;

      setWallet(walletData);

      const availableModels =
        getSelectableModels(
          walletData.pack_id,
          trialState,
        );

      if (
        availableModels.length > 0
      ) {
        setSelectedModel(
          (current) =>
            availableModels.some(
              (model) =>
                model.id === current,
            )
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
   * CHARGEMENT DES ESSAIS
   * ==========================================================
   *
   * Le backend est la source de vérité.
   * Le frontend récupère l'état réel via /ai/trials.
   */

  async function loadTrials(): Promise<
    Record<string, TrialInfo>
  > {
    try {
      setIsLoadingTrials(true);

      const data =
        await apiFetch<TrialResponse>(
          "/ai/trials",
        );

      const trialState =
        data.trials || {};

      setTrials(trialState);

      return trialState;
    } catch (requestError) {
      console.error(
        "Erreur chargement essais :",
        requestError,
      );

      setTrials({});

      return {};
    } finally {
      setIsLoadingTrials(false);
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT CLOUD DES CONVERSATIONS
   * ==========================================================
   */

  async function loadConversations(
    localCache?: LocalChatCache | null,
  ) {
    try {
      setIsLoadingConversations(
        true,
      );

      const data =
        await apiFetch<ConversationResponse>(
          "/conversations",
        );

      const remoteConversations =
        data.conversations || [];

      const remoteIds =
        new Set(
          remoteConversations.map(
            (conversation) =>
              conversation.id,
          ),
        );

      const unsyncedLocal =
        (
          localCache?.conversations ||
          []
        ).filter(
          (conversation) =>
            !remoteIds.has(
              conversation.id,
            ),
        );

      const merged = [
        ...unsyncedLocal,
        ...remoteConversations,
      ];

      setConversations(merged);

      if (
        !activeConversationId &&
        localCache?.activeConversationId
      ) {
        const localActive =
          merged.find(
            (conversation) =>
              conversation.id ===
              localCache.activeConversationId,
          );

        if (localActive) {
          setActiveConversationId(
            localActive.id,
          );
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement conversations :",
        requestError,
      );

      if (
        localCache?.conversations
      ) {
        setConversations(
          localCache.conversations,
        );
      } else {
        setConversations([]);
      }

      setError(
        requestError instanceof Error
          ? `${requestError.message} Les données locales restent disponibles.`
          : "Serveur indisponible. Les données locales restent disponibles.",
      );
    } finally {
      setIsLoadingConversations(
        false,
      );
    }
  }

  /*
   * ==========================================================
   * INITIALISATION
   * ==========================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const {
          data: { session },
        } =
          await supabase.auth.getSession();

        if (
          !session?.user?.id ||
          !session.access_token
        ) {
          throw new Error(
            "Utilisateur non authentifié.",
          );
        }

        if (cancelled) {
          return;
        }

        const userId =
          session.user.id;

        setCurrentUserId(userId);

        const localCache =
          readLocalCache(userId);

        if (localCache) {
          setConversations(
            localCache.conversations,
          );

          setActiveConversationId(
            localCache.activeConversationId,
          );

          if (
            localCache.selectedModel
          ) {
            setSelectedModel(
              localCache.selectedModel,
            );
          }

          setActiveCapability(
            localCache.activeCapability,
          );

          if (
            localCache.activeConversationId
          ) {
            const cachedMessages =
              localCache.messages[
                localCache
                  .activeConversationId
              ];

            if (
              Array.isArray(
                cachedMessages,
              )
            ) {
              setMessages(
                cachedMessages,
              );
            }
          }
        }

        setIsInitialized(true);

        const trialState =
          await loadTrials();

        await Promise.all([
          loadWallet(trialState),
          loadConversations(
            localCache,
          ),
          loadMediaCapabilities(),
        ]);
      } catch (requestError) {
        console.error(
          "Erreur initialisation Chat :",
          requestError,
        );

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Impossible d'initialiser le chat.",
        );

        setIsLoadingConversations(
          false,
        );

        setIsLoadingWallet(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ==========================================================
   * NOUVELLE CONVERSATION
   * ==========================================================
   */

  async function createConversation() {
    const now =
      new Date().toISOString();

    const localId =
      crypto.randomUUID();

    const newConversation:
      Conversation = {
      id: localId,
      title:
        "Nouvelle conversation",
      createdAt: now,
      updatedAt: now,
    };

    setConversations(
      (current) => [
        newConversation,
        ...current,
      ],
    );

    setActiveConversationId(
      localId,
    );

    setMessages([]);
    setMessage("");
    setAttachments([]);
    setActiveCapability(null);
    setError(null);
    setSidebarOpen(false);

    if (currentUserId) {
      writeLocalCache(
        currentUserId,
        {
          conversations: [
            newConversation,
            ...conversations,
          ],
          messages: {
            ...(readLocalCache(
              currentUserId,
            )?.messages || {}),
            [localId]: [],
          },
          activeConversationId:
            localId,
          selectedModel,
          activeCapability: null,
        },
      );
    }

    try {
      const remoteConversation =
        await createConversationRemote(
          "Nouvelle conversation",
        );

      setConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              localId
                ? remoteConversation
                : conversation,
          ),
      );

      setActiveConversationId(
        remoteConversation.id,
      );

      const localCache =
        currentUserId
          ? readLocalCache(
              currentUserId,
            )
          : null;

      if (
        localCache?.messages[
          localId
        ]
      ) {
        const cachedMessages =
          localCache.messages[
            localId
          ];

        for (const cachedMessage of cachedMessages) {
          await saveMessageRemote({
            ...cachedMessage,
            conversationId:
              remoteConversation.id,
          });
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur création conversation backend :",
        requestError,
      );

      setError(
        "Conversation créée localement. Synchronisation cloud en attente.",
      );
    }
  }

  /*
   * ==========================================================
   * SÉLECTION CONVERSATION
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

    if (currentUserId) {
      const cache =
        readLocalCache(
          currentUserId,
        );

      const localMessages =
        cache?.messages[
          conversationId
        ];

      if (
        Array.isArray(
          localMessages,
        )
      ) {
        setMessages(
          localMessages,
        );
      } else {
        setMessages([]);
      }
    }

    try {
      const data =
        await apiFetch<MessagesResponse>(
          `/conversations/${conversationId}/messages`,
        );

      const remoteMessages =
        data.messages || [];

      if (
        remoteMessages.length > 0
      ) {
        setMessages(
          remoteMessages,
        );

        if (currentUserId) {
          const cache =
            readLocalCache(
              currentUserId,
            );

          writeLocalCache(
            currentUserId,
            {
              conversations:
                cache?.conversations ||
                conversations,
              messages: {
                ...(cache?.messages ||
                  {}),
                [conversationId]:
                  remoteMessages,
              },
              activeConversationId:
                conversationId,
              selectedModel,
              activeCapability,
            },
          );
        }
      }
    } catch (requestError) {
      console.error(
        "Erreur chargement messages :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? `${requestError.message} Les messages locaux restent affichés.`
          : "Impossible de charger les messages cloud. Les données locales restent affichées.",
      );
    }
  }

  /*
   * ==========================================================
   * CHARGEMENT DES CAPACITÉS MÉDIA
   * ==========================================================
   */

  async function loadMediaCapabilities(): Promise<void> {
    try {
      setIsLoadingMediaCapabilities(true);

      const data = await apiFetch<MediaCapabilitiesResponse>(
        "/ai/media-capabilities",
      );

      const available = Array.isArray(data.media)
        ? data.media
        : [];

      setMediaCapabilities(available);

      setSelectedMediaAction((current) => {
        if (current && available.some((item) => item.action === current)) {
          return current;
        }
        return available[0]?.action ?? "";
      });
    } catch (requestError) {
      console.error(
        "Erreur chargement capacités média :",
        requestError,
      );
      setMediaCapabilities([]);
      setSelectedMediaAction("");
    } finally {
      setIsLoadingMediaCapabilities(false);
    }
  }

  /*
   * ==========================================================
   * CAPACITÉS
   * ==========================================================
   */

  function handleCapabilityClick(
    label: string,
  ) {
    if (label === "Fichier") {
      fileInputRef.current?.click();
      return;
    }

    if (label === "Image") {
      imageInputRef.current?.click();
      return;
    }

    if (label === "Recherche Web") {
      setActiveCapability(
        (current) =>
          current === label
            ? null
            : label,
      );
      setMediaMenuOpen(false);
      return;
    }

    if (label === "Création") {
      if (mediaCapabilities.length === 0) {
        setError(
          "Aucune création média n'est disponible avec votre pack.",
        );
        return;
      }

      setActiveCapability("Création");
      setMediaMenuOpen(true);
      setError(null);
    }
  }

  function addAttachments(
    fileList: FileList | File[],
    expectedKind?: "image" | "file",
  ) {
    const incoming = Array.from(fileList);

    if (incoming.length === 0) {
      return;
    }

    const remainingSlots =
      MAX_ATTACHMENTS - attachments.length;

    if (remainingSlots <= 0) {
      setError(
        `Vous pouvez joindre au maximum ${MAX_ATTACHMENTS} éléments par message.`,
      );
      return;
    }

    const selected = incoming.slice(
      0,
      remainingSlots,
    );

    const invalid = selected.find(
      (file) =>
        !isAcceptedAttachment(file) ||
        (expectedKind === "image" &&
          !isImageFile(file)) ||
        (expectedKind === "file" &&
          isImageFile(file)),
    );

    if (invalid) {
      setError(
        expectedKind === "image"
          ? "Format d'image non pris en charge."
          : "Format de fichier non pris en charge.",
      );
      return;
    }

    const newAttachments = selected.map(
      (file) => ({
        id: crypto.randomUUID(),
        file,
        kind: isImageFile(file)
          ? ("image" as const)
          : ("file" as const),
        previewUrl: isImageFile(file)
          ? URL.createObjectURL(file)
          : null,
      }),
    );

    setAttachments((current) => [
      ...current,
      ...newAttachments,
    ]);
    setError(null);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const attachment = current.find(
        (item) => item.id === id,
      );

      if (attachment?.previewUrl) {
        URL.revokeObjectURL(
          attachment.previewUrl,
        );
      }

      return current.filter(
        (item) => item.id !== id,
      );
    });
  }

  /*
   * ==========================================================
   * MISE À JOUR CONVERSATION
   * ==========================================================
   */

  function updateConversationLocally(
    conversationId: string,
    content: string,
    now: string,
  ) {
    setConversations(
      (current) =>
        current.map(
          (conversation) =>
            conversation.id ===
            conversationId
              ? {
                  ...conversation,
                  title:
                    conversation.title ===
                      "Nouvelle conversation" &&
                    content
                      ? content.length > 45
                        ? `${content.slice(
                            0,
                            45,
                          )}...`
                        : content
                      : conversation.title,
                  updatedAt: now,
                }
              : conversation,
        ),
    );
  }

  async function handleGenerateMedia(promptOverride?: string) {
    const prompt = (promptOverride ?? mediaPrompt).trim();

    if (!prompt || isThinking) {
      return;
    }

    if (!selectedMediaAction) {
      setError(
        "Aucune option de création n'est disponible.",
      );
      return;
    }

    const capability =
      mediaCapabilities.find(
        (item) =>
          item.action === selectedMediaAction,
      );

    if (!capability) {
      setError(
        "Cette option de création n'est plus disponible.",
      );
      await loadMediaCapabilities();
      return;
    }

    const now =
      new Date().toISOString();

    let conversationId =
      activeConversationId;

    setIsThinking(true);
    setError(null);

    try {
      if (!conversationId) {
        const localId =
          crypto.randomUUID();

        const title =
          prompt.length > 45
            ? `${prompt.slice(0, 45)}...`
            : prompt;

        const localConversation:
          Conversation = {
          id: localId,
          title,
          createdAt: now,
          updatedAt: now,
        };

        conversationId = localId;

        setConversations(
          (current) => [
            localConversation,
            ...current,
          ],
        );

        setActiveConversationId(localId);

        if (currentUserId) {
          const cache =
            readLocalCache(
              currentUserId,
            );

          writeLocalCache(
            currentUserId,
            {
              conversations: [
                localConversation,
                ...(cache?.conversations ||
                  conversations),
              ],
              messages: {
                ...(cache?.messages || {}),
                [localId]: [],
              },
              activeConversationId:
                localId,
              selectedModel,
              activeCapability: "Création",
            },
          );
        }

        try {
          const remoteConversation =
            await createConversationRemote(title);

          setConversations(
            (current) =>
              current.map(
                (conversation) =>
                  conversation.id === localId
                    ? remoteConversation
                    : conversation,
              ),
          );

          conversationId =
            remoteConversation.id;

          setActiveConversationId(
            remoteConversation.id,
          );
        } catch (requestError) {
          console.error(
            "Création conversation cloud échouée :",
            requestError,
          );
        }
      }

      const userMessage:
        ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "user",
        content:
          `[Création ${capability.type === "image" ? "image" : "vidéo"} · ${selectedMediaAction}]\n${prompt}`,
        createdAt: now,
      };

      setMessages(
        (current) => [
          ...current,
          userMessage,
        ],
      );

      try {
        await saveMessageRemote(
          userMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde prompt média :",
          saveError,
        );
      }

      const endpoint =
        capability.type === "image"
          ? "/ai/image"
          : "/ai/video";

      const response =
        await apiMediaFetch<{
          success: boolean;
          type: "image" | "video";
          action: string;
          model: string;
          cost: number;
          credits_remaining: number;
          mime_type: string;
          data: string;
          seconds?: string | null;
          size?: string | null;
        }>(
          endpoint,
          {
            action:
              selectedMediaAction,
            prompt,
          },
        );

      if (!response.success || !response.data) {
        throw new Error(
          "Le serveur n'a retourné aucun média.",
        );
      }

      const binaryString =
        window.atob(response.data);

      const bytes =
        new Uint8Array(
          binaryString.length,
        );

      for (
        let index = 0;
        index < binaryString.length;
        index++
      ) {
        bytes[index] =
          binaryString.charCodeAt(index);
      }

      const blob =
        new Blob(
          [bytes],
          {
            type:
              response.mime_type ||
              (response.type === "image"
                ? "image/png"
                : "video/mp4"),
          },
        );

      const url =
        URL.createObjectURL(blob);

      const mediaId =
        crypto.randomUUID();

      setGeneratedMedia(
        (current) => [
          ...current,
          {
            id: mediaId,
            type: response.type,
            mimeType: blob.type,
            url,
            action: response.action,
            model: response.model,
            cost: response.cost,
            creditsRemaining:
              response.credits_remaining,
            seconds: response.seconds,
            size: response.size,
          },
        ],
      );

      const assistantMessage:
        ChatMessage = {
        id: mediaId,
        conversationId,
        role: "assistant",
        content:
          response.type === "image"
            ? `Image générée · ${response.action}`
            : `Vidéo générée · ${response.action}`,
        createdAt:
          new Date().toISOString(),
      };

      setMessages(
        (current) => [
          ...current,
          assistantMessage,
        ],
      );

      try {
        await saveMessageRemote(
          assistantMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde résultat média :",
          saveError,
        );
      }

      setMediaPrompt("");
      setMediaMenuOpen(false);

      const refreshedTrials =
        await loadTrials();

      await loadWallet(
        refreshedTrials,
      );

      await loadMediaCapabilities();
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "La création média a échoué.";

      setError(errorMessage);
    } finally {
      setIsThinking(false);
    }
  }

  /*
   * ==========================================================
   * ENVOI MESSAGE
   * ==========================================================
   */

  async function handleSendMessage() {
    const content =
      message.trim();

    const selectedTrial =
      trials[selectedModel];

    if (
      selectedTrial &&
      selectedTrial.remaining <= 0
    ) {
      setError(
        "Les essais gratuits de ce modèle sont épuisés.",
      );
      return;
    }

    if (
      (!content && attachments.length === 0) ||
      isThinking
    ) {
      return;
    }

    if (activeCapability === "Création") {
      setMediaPrompt(content);
      await handleGenerateMedia(content);
      return;
    }

    const now =
      new Date().toISOString();

    let conversationId =
      activeConversationId;

    /*
     * ========================================================
     * CONVERSATION
     * ========================================================
     */

    if (!conversationId) {
      const localId =
        crypto.randomUUID();

      const localConversation:
        Conversation = {
        id: localId,
        title:
          content.length > 45
            ? `${content.slice(
                0,
                45,
              )}...`
            : content ||
              "Nouvelle conversation",
        createdAt: now,
        updatedAt: now,
      };

      conversationId =
        localId;

      setConversations(
        (current) => [
          localConversation,
          ...current,
        ],
      );

      setActiveConversationId(
        localId,
      );

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        writeLocalCache(
          currentUserId,
          {
            conversations: [
              localConversation,
              ...(cache?.conversations ||
                conversations),
            ],
            messages: {
              ...(cache?.messages ||
                {}),
              [localId]: [],
            },
            activeConversationId:
              localId,
            selectedModel,
            activeCapability,
          },
        );
      }

      try {
        const remoteConversation =
          await createConversationRemote(
            localConversation.title,
          );

        const oldLocalId =
          localId;

        conversationId =
          remoteConversation.id;

        setActiveConversationId(
          remoteConversation.id,
        );

        setConversations(
          (current) =>
            current.map(
              (conversation) =>
                conversation.id ===
                oldLocalId
                  ? remoteConversation
                  : conversation,
            ),
        );
      } catch (requestError) {
        console.error(
          "Création conversation cloud échouée :",
          requestError,
        );

        setError(
          "Conversation sauvegardée localement. La synchronisation cloud sera réessayée.",
        );
      }
    } else {
      updateConversationLocally(
        conversationId,
        content,
        now,
      );
    }

    /*
     * ========================================================
     * MESSAGE UTILISATEUR
     * ========================================================
     */

    const webEnabled =
      activeCapability ===
      "Recherche Web";

    const attachmentSummary =
      attachments.length > 0
        ? `\n\n[Pièces jointes : ${attachments
            .map((attachment) => attachment.file.name)
            .join(", ")}]`
        : "";

    const userMessage:
      ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: `${content}${attachmentSummary}`.trim(),
      createdAt: now,
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ],
    );

    if (currentUserId) {
      const cache =
        readLocalCache(
          currentUserId,
        );

      const existingMessages =
        cache?.messages[
          conversationId
        ] || [];

      writeLocalCache(
        currentUserId,
        {
          conversations:
            cache?.conversations ||
            conversations,
          messages: {
            ...(cache?.messages ||
              {}),
            [conversationId]: [
              ...existingMessages,
              userMessage,
            ],
          },
          activeConversationId:
            conversationId,
          selectedModel,
          activeCapability,
        },
      );
    }

    setMessage("");
    setIsThinking(true);

    /*
     * La recherche Web reste volontairement active.
     */

    try {
      /*
       * ======================================================
       * SAUVEGARDE MESSAGE UTILISATEUR
       * ======================================================
       */

      try {
        await saveMessageRemote(
          userMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde message utilisateur :",
          saveError,
        );

        setError(
          "Message conservé localement. Synchronisation cloud en attente.",
        );
      }

      /*
       * ======================================================
       * OPENAI — STREAMING + MULTIMODAL
       * ======================================================
       */

      const formData =
        new FormData();

      formData.append(
        "model",
        selectedModel,
      );

      formData.append(
        "message",
        content,
      );

      formData.append(
        "web",
        String(webEnabled),
      );

      // Identifie la conversation côté backend afin que l'IA
      // puisse recharger son historique persistant.
      formData.append(
        "conversation_id",
        conversationId,
      );

      for (
        const attachment of attachments
      ) {
        formData.append(
          "files",
          attachment.file,
          attachment.file.name,
        );
      }

      const streamResponse =
        await apiStreamFetch(
          "/ai/chat/stream",
          formData,
        );

      const reader =
        streamResponse.body!.getReader();

      const decoder =
        new TextDecoder();

      const assistantId =
        crypto.randomUUID();

      const assistantCreatedAt =
        new Date().toISOString();

      let assistantContent = "";
      let streamBuffer = "";
      let streamDone = false;
      setMessages(
        (current) => [
          ...current,
          {
            id: assistantId,
            conversationId,
            role: "assistant",
            content: "",
            createdAt:
              assistantCreatedAt,
          },
        ],
      );

      while (!streamDone) {
        const { value, done } =
          await reader.read();

        if (done) {
          break;
        }

        streamBuffer +=
          decoder.decode(
            value,
            { stream: true },
          );

        const events =
          streamBuffer.split(
            "\n\n",
          );

        streamBuffer =
          events.pop() || "";

        for (
          const rawEvent of events
        ) {
          if (!rawEvent.trim()) {
            continue;
          }

          let eventName =
            "message";
          let dataText = "";

          for (
            const line of rawEvent.split(
              "\n",
            )
          ) {
            if (
              line.startsWith(
                "event:",
              )
            ) {
              eventName =
                line.slice(6).trim();
            }

            if (
              line.startsWith(
                "data:",
              )
            ) {
              dataText +=
                line.slice(5).trim();
            }
          }

          if (!dataText) {
            continue;
          }

          let eventData:
            | Record<string, unknown>;

          try {
            eventData =
              JSON.parse(
                dataText,
              );
          } catch {
            continue;
          }

          if (
            eventName ===
            "delta"
          ) {
            const delta =
              typeof eventData.content ===
              "string"
                ? eventData.content
                : "";

            if (!delta) {
              continue;
            }

            assistantContent +=
              delta;

            setMessages(
              (current) =>
                current.map(
                  (item) =>
                    item.id ===
                    assistantId
                      ? {
                          ...item,
                          content:
                            assistantContent,
                        }
                      : item,
                ),
            );
          }

          if (
            eventName ===
            "done"
          ) {
            streamDone = true;
            break;
          }

          if (
            eventName ===
            "error"
          ) {
            throw new Error(
              typeof eventData.detail ===
              "string"
                ? eventData.detail
                : "Erreur pendant le streaming IA.",
            );
          }
        }
      }

      if (!assistantContent.trim()) {
        throw new Error(
          "Le service IA n'a retourné aucun contenu.",
        );
      }

      const assistantMessage:
        ChatMessage = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content:
          assistantContent,
        createdAt:
          assistantCreatedAt,
      };

      /*
       * ======================================================
       * MESSAGE IA
       * ======================================================
       */

      /*
       * ======================================================
       * SAUVEGARDE LOCALE
       * ======================================================
       */

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        const existingMessages =
          cache?.messages[
            conversationId
          ] || [];

        const hasUserMessage =
          existingMessages.some(
            (item) =>
              item.id ===
              userMessage.id,
          );

        const mergedMessages =
          hasUserMessage
            ? [
                ...existingMessages,
                assistantMessage,
              ]
            : [
                ...existingMessages,
                userMessage,
                assistantMessage,
              ];

        writeLocalCache(
          currentUserId,
          {
            conversations:
              cache?.conversations ||
              conversations,
            messages: {
              ...(cache?.messages ||
                {}),
              [conversationId]:
                mergedMessages,
            },
            activeConversationId:
              conversationId,
            selectedModel,
            activeCapability,
          },
        );
      }

      /*
       * ======================================================
       * SAUVEGARDE BACKEND
       * ======================================================
       */

      try {
        await saveMessageRemote(
          assistantMessage,
        );
      } catch (saveError) {
        console.error(
          "Erreur sauvegarde réponse IA :",
          saveError,
        );

        setError(
          "Réponse IA conservée localement. Synchronisation cloud en attente.",
        );
      }

      /*
       * ======================================================
       * CONVERSATION
       * ======================================================
       */

      const updatedAt =
        new Date().toISOString();

      setConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              conversationId
                ? {
                    ...conversation,
                    updatedAt,
                  }
                : conversation,
          ),
      );

      /*
       * ======================================================
       * WALLET
       * ======================================================
       */

      attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(
            attachment.previewUrl,
          );
        }
      });
      setAttachments([]);

      const refreshedTrials =
        await loadTrials();

      await loadWallet(
        refreshedTrials,
      );
    } catch (requestError) {
      const errorMessage =
        requestError instanceof
        Error
          ? requestError.message
          : "Impossible de contacter LBV-Connect.ia.";

      const assistantMessage:
        ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: `Erreur : ${errorMessage}`,
        createdAt:
          new Date().toISOString(),
      };

      setMessages(
        (current) => [
          ...current,
          assistantMessage,
        ],
      );

      if (currentUserId) {
        const cache =
          readLocalCache(
            currentUserId,
          );

        const existingMessages =
          cache?.messages[
            conversationId
          ] || [];

        writeLocalCache(
          currentUserId,
          {
            conversations:
              cache?.conversations ||
              conversations,
            messages: {
              ...(cache?.messages ||
                {}),
              [conversationId]: [
                ...existingMessages,
                assistantMessage,
              ],
            },
            activeConversationId:
              conversationId,
            selectedModel,
            activeCapability,
          },
        );
      }
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
              (1000 *
                60 *
                60 *
                24),
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

      {/* ======================================================
          SIDEBAR
          ====================================================== */}

      <aside
        className={`fixed bottom-4 left-4 top-4 z-50 flex w-[260px] flex-col rounded-3xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 md:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-[120%]"
        }`}
      >
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

        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={
              createConversation
            }
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

        <div className="mt-6 flex-1 overflow-y-auto px-4">
          <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Historique
          </div>

          {isLoadingConversations ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              Chargement...
            </p>
          ) : conversations.length ===
            0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted">
              Aucune conversation
              pour le moment.
            </p>
          ) : (
            <div className="space-y-1">
              {conversations.map(
                (conversation) => (
                  <button
                    key={
                      conversation.id
                    }
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
              {remainingDays !==
              null
                ? `${remainingDays} jours restants`
                : "Durée indisponible"}
            </p>
          </div>
        </div>

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

      {/* ======================================================
          WORKSPACE
          ====================================================== */}

      <section className="flex min-h-dvh flex-col">
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
                      (
                        conversation,
                      ) =>
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

        <div className="flex flex-1 flex-col px-4 pb-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {error && (
              <div className="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-border bg-surface-secondary px-4 py-3 text-sm text-muted-strong">
                {error}
              </div>
            )}

            {/* ==================================================
                EMPTY STATE
                ================================================== */}

            {messages.length ===
              0 && (
              <div className="flex flex-1 flex-col justify-center">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
                      <Sparkles
                        size={20}
                      />
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">
                        LBV-Connect.ia
                      </p>

                      <p className="text-sm font-medium">
                        Intelligence
                        workspace
                      </p>
                    </div>
                  </div>

                  <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
                    Comment puis-je
                    vous aider ?
                  </h1>

                  <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
                    Discutez avec les
                    modèles disponibles
                    et utilisez la
                    recherche Web
                    directement depuis
                    votre espace.
                  </p>
                </div>
              </div>
            )}

            {/* ==================================================
                MESSAGES
                ================================================== */}

            {messages.length >
              0 && (
              <div className="flex-1 overflow-y-auto py-8">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
                  {messages.map(
                    (item) => (
                      <div
                        key={
                          item.id
                        }
                        className={
                          item.role ===
                          "user"
                            ? "flex justify-end"
                            : "flex justify-start"
                        }
                      >
                        <div
                          className={
                            item.role ===
                            "user"
                              ? "max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-5 py-3.5 text-sm leading-6 text-accent-foreground"
                              : "max-w-[90%] rounded-3xl rounded-bl-lg border border-border bg-surface px-5 py-4 text-foreground shadow-sm"
                          }
                        >
                          {item.role ===
                          "assistant" ? (
                            /*
                             * IMPORTANT :
                             *
                             * Les réponses IA passent maintenant
                             * par le renderer Markdown.
                             */
                            <MarkdownMessage
                              content={
                                item.content
                              }
                            />
                          ) : (
                            /*
                             * Le message utilisateur reste simple
                             * et conserve les retours à la ligne.
                             */
                            <div className="whitespace-pre-wrap break-words">
                              {
                                item.content
                              }
                            </div>
                          )}
                        </div>

                        {item.role === "assistant" &&
                          generatedMedia.some(
                            (media) => media.id === item.id,
                          ) && (
                            <div className="mt-3 max-w-[90%]">
                              {generatedMedia
                                .filter(
                                  (media) =>
                                    media.id === item.id,
                                )
                                .map((media) =>
                                  media.type === "image" ? (
                                    <img
                                      key={media.id}
                                      src={media.url}
                                      alt="Image générée par LBV-Connect.ia"
                                      className="max-h-[620px] w-auto rounded-2xl border border-border shadow-sm"
                                    />
                                  ) : (
                                    <video
                                      key={media.id}
                                      src={media.url}
                                      controls
                                      playsInline
                                      className="max-h-[620px] w-full rounded-2xl border border-border bg-black shadow-sm"
                                    />
                                  ),
                                )}
                            </div>
                          )}
                      </div>
                    ),
                  )}

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

            {/* ==================================================
                MODÈLE
                ================================================== */}

            <div
              className={`mx-auto w-full max-w-3xl ${
                messages.length ===
                0
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
                      getSelectableModels(
                        wallet?.pack_id ??
                          null,
                        trials,
                      ).length >
                      1
                    ) {
                      setModelMenuOpen(
                        (current) =>
                          !current,
                      );
                    }
                  }}
                >
                  <Sparkles
                    size={16}
                  />

                  {models.find(
                    (model) =>
                      model.id ===
                      selectedModel,
                  )?.name ||
                    "Modèle"}

                  {trials[selectedModel] && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-accent-foreground">
                      Essai ·{" "}
                      {trials[selectedModel].remaining}/
                      {trials[selectedModel].max}
                    </span>
                  )}

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
                    {getSelectableModels(
                      wallet?.pack_id ??
                        null,
                      trials,
                    ).map(
                      (model) => (
                        <ModelOption
                          key={
                            model.id
                          }
                          name={
                            model.name
                          }
                          description={
                            model.description
                          }
                          active={
                            selectedModel ===
                            model.id
                          }
                          trial={
                            trials[model.id]
                          }
                          disabled={
                            Boolean(
                              trials[model.id],
                            ) &&
                            trials[model.id]
                              .remaining <= 0
                          }
                          onClick={() => {
                            if (
                              trials[model.id] &&
                              trials[model.id]
                                .remaining <= 0
                            ) {
                              return;
                            }

                            setSelectedModel(
                              model.id,
                            );

                            setModelMenuOpen(
                              false,
                            );
                          }}
                        />
                      ),
                    )}

                    {getSelectableModels(
                      wallet?.pack_id ??
                        null,
                      trials,
                    ).length ===
                      0 && (
                      <p className="px-3 py-2 text-xs text-muted">
                        Aucun modèle
                        disponible
                        avec ce
                        pack.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ==================================================
                MODE WEB
                ================================================== */}

            {activeCapability ===
              "Recherche Web" && (
              <div className="mx-auto mt-3 flex w-full max-w-3xl items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-tertiary">
                    <Globe
                      size={17}
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium">
                      Recherche Web
                      activée
                    </p>

                    <p className="text-[11px] text-muted">
                      La recherche Web
                      reste active pour
                      les prochains
                      messages jusqu'à
                      sa désactivation.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActiveCapability(
                      null,
                    )
                  }
                  className="rounded-lg p-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
                  aria-label="Désactiver la recherche Web"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {activeCapability === "Création" && (
              <div className="mx-auto mt-3 w-full max-w-3xl rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Création média</p>
                    <p className="mt-1 text-[11px] text-muted">
                      Choisissez le type, puis la configuration avant de générer.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCapability(null);
                      setMediaMenuOpen(false);
                    }}
                    className="rounded-lg p-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
                    aria-label="Fermer la création média"
                  >
                    <X size={16} />
                  </button>
                </div>

                {isLoadingMediaCapabilities ? (
                  <p className="mt-4 text-xs text-muted">Chargement des configurations disponibles...</p>
                ) : mediaCapabilities.length === 0 ? (
                  <p className="mt-4 text-xs text-muted">Aucune création média disponible avec votre pack.</p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {(["image", "video"] as const).map((type) => {
                        const options = mediaCapabilities.filter((item) => item.type === type);
                        const selectedType = selectedMediaAction
                          ? getMediaPreset(selectedMediaAction).type
                          : null;

                        return (
                          <button
                            key={type}
                            type="button"
                            disabled={options.length === 0}
                            onClick={() => {
                              if (options.length > 0) {
                                setSelectedMediaAction(options[0].action);
                              }
                            }}
                            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition ${
                              selectedType === type
                                ? "border-border-strong bg-surface-tertiary"
                                : "border-border hover:bg-surface-secondary"
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            {type === "image" ? <ImageIcon size={17} /> : <Video size={17} />}
                            {type === "image" ? "Image" : "Vidéo"}
                            <span className="text-[10px] text-muted">{options.length}</span>
                          </button>
                        );
                      })}
                    </div>

                    {selectedMediaAction && (
                      <>
                        <div className="mt-4">
                          <p className="mb-2 text-[11px] font-medium text-muted">Configurations disponibles</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {mediaCapabilities
                              .filter((media) => media.type === getMediaPreset(selectedMediaAction).type)
                              .map((media) => {
                                const preset = getMediaPreset(media.action);
                                const selected = selectedMediaAction === media.action;

                                return (
                                  <button
                                    key={media.action}
                                    type="button"
                                    onClick={() => setSelectedMediaAction(media.action)}
                                    className={`rounded-xl border px-3 py-3 text-left transition ${
                                      selected
                                        ? "border-border-strong bg-surface-tertiary"
                                        : "border-border hover:bg-surface-secondary"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium">{preset.label}</p>
                                        <p className="mt-1 text-[11px] text-muted">{preset.description}</p>
                                      </div>
                                      {selected && <Check size={15} className="mt-0.5 shrink-0" />}
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted">
                                      <span>{preset.configuration}</span>
                                      <span>{media.credits.toLocaleString("fr-FR")} crédits</span>
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>

                        <textarea
                          rows={3}
                          value={mediaPrompt}
                          onChange={(event) => setMediaPrompt(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void handleGenerateMedia();
                            }
                          }}
                          placeholder={
                            getMediaPreset(selectedMediaAction).type === "image"
                              ? "Décrivez l'image à créer..."
                              : "Décrivez la vidéo à créer..."
                          }
                          disabled={isThinking}
                          className="mt-4 w-full resize-none rounded-xl border border-border bg-transparent px-4 py-3 text-sm leading-6 outline-none placeholder:text-muted focus:border-muted-strong disabled:opacity-60"
                        />

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="min-w-0 text-[10px] text-muted">
                            <span>{getMediaPreset(selectedMediaAction).label}</span>
                            <span> · </span>
                            <span>
                              {mediaCapabilities
                                .find((item) => item.action === selectedMediaAction)
                                ?.credits.toLocaleString("fr-FR")} crédits
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { void handleGenerateMedia(); }}
                            disabled={!mediaPrompt.trim() || !selectedMediaAction || isThinking}
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-medium text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Sparkles size={14} />
                            {isThinking ? "Création..." : "Créer"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ==================================================
                COMPOSER
                ================================================== */}

            <div className="mx-auto mt-4 w-full max-w-3xl">
              <div className="overflow-hidden rounded-[28px] border border-border-strong bg-surface shadow-[0_12px_40px_var(--shadow-color)] transition focus-within:border-muted-strong">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-4 pt-4">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group relative flex max-w-[220px] items-center gap-2 rounded-2xl border border-border bg-surface-secondary p-2"
                      >
                        {attachment.previewUrl ? (
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.file.name}
                            className="h-12 w-12 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary">
                            <FileText size={18} />
                          </div>
                        )}

                        <div className="min-w-0 pr-6">
                          <p className="truncate text-xs font-medium">
                            {attachment.file.name}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted">
                            {attachment.kind === "image"
                              ? "Image"
                              : "Fichier"}
                          </p>
                        </div>

                        <button
                          type="button"
                          aria-label={`Supprimer ${attachment.file.name}`}
                          onClick={() =>
                            removeAttachment(attachment.id)
                          }
                          className="absolute right-1.5 top-1.5 rounded-full bg-surface p-1 text-muted shadow-sm transition hover:text-foreground"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  onChange={(event) => {
                    if (event.target.files) {
                      addAttachments(
                        event.target.files,
                        "file",
                      );
                    }
                    event.target.value = "";
                  }}
                />

                <input
                  ref={imageInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={(event) => {
                    if (event.target.files) {
                      addAttachments(
                        event.target.files,
                        "image",
                      );
                    }
                    event.target.value = "";
                  }}
                />

                <textarea
                  rows={4}
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();

                      handleSendMessage();
                    }
                  }}
                  placeholder={activeCapability === "Création" ? "Décrivez votre création..." : "Écrivez à LBV-Connect.ia..."}
                  disabled={
                    isThinking
                  }
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
                            key={
                              label
                            }
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
                            disabled={
                              disabled
                            }
                            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 transition ${
                              disabled
                                ? "cursor-not-allowed text-muted opacity-50"
                                : isActive
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-strong hover:bg-surface-tertiary hover:text-foreground"
                            }`}
                          >
                            <Icon
                              size={17}
                            />

                            <span className="hidden text-xs sm:inline">
                              {label}
                            </span>

                            {label !== "Recherche Web" &&
                              label !== "Création" &&
                              attachments.length > 0 && (
                                <span className="text-[10px] opacity-70">
                                  {attachments.length}/{MAX_ATTACHMENTS}
                                </span>
                              )}
                          </button>
                        );
                      },
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label="Envoyer"
                    onClick={
                      handleSendMessage
                    }
                    disabled={
                      (!message.trim() &&
                        attachments.length === 0) ||
                      isThinking
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp
                      size={18}
                    />
                  </button>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-muted">
                Jusqu&apos;à {MAX_ATTACHMENTS} fichiers ou images
                peuvent être joints à un message. Les créations
                image et vidéo dépendent du pack actif.
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

type ModelOptionProps = {
  name: string;
  description: string;
  active?: boolean;
  trial?: TrialInfo;
  disabled?: boolean;
  onClick?: () => void;
};

function ModelOption({
  name,
  description,
  active = false,
  trial,
  disabled = false,
  onClick,
}: ModelOptionProps) {
  const isTrial =
    Boolean(trial);

  const trialExhausted =
    isTrial &&
    (trial?.remaining ?? 0) <= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        trialExhausted
          ? "Les 5 essais de ce modèle sont épuisés."
          : undefined
      }
      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
        disabled
          ? "cursor-not-allowed opacity-45"
          : active
            ? "bg-surface-tertiary"
            : "hover:bg-surface-secondary"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {name}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {isTrial && (
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${
                trialExhausted
                  ? "bg-surface-tertiary text-muted"
                  : "bg-accent text-accent-foreground"
              }`}
            >
              Essai · {trial?.remaining ?? 0}/
              {trial?.max ?? 5}
            </span>
          )}

          {active && (
            <Check
              size={15}
              className="text-muted-strong"
            />
          )}
        </div>
      </div>

      <p className="mt-0.5 text-xs text-muted">
        {description}
      </p>

      {isTrial && (
        <p className="mt-1 text-[10px] text-muted">
          Modèle supérieur · 5 essais maximum
        </p>
      )}
    </button>
  );
}