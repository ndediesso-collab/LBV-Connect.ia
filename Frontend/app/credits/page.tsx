"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock3,
  CreditCard,
  History,
  Plus,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PackId =
  | "light_pack"
  | "intermediate_pack"
  | "pro_pack"
  | "business_pack";

type CreditTransactionType =
  | "pack_purchase"
  | "usage"
  | "recharge"
  | "refund"
  | "adjustment";

type CreditTransaction = {
  id: string;
  user_id: string;
  transaction_type: CreditTransactionType;
  amount: number;
  balance_after: number;
  created_at: string;
  action?: string | null;
  reference_id?: string | null;
};

type CreditWallet = {
  user_id: string;
  balance: number;
  initial_credits: number;
  created_at: string;
  updated_at: string;
  pack_id: PackId | null;
  pack_activated_at: string | null;
  pack_expires_at: string | null;
};

type CreditsResponse = {
  wallet: CreditWallet;
};

type TransactionsResponse = {
  transactions: CreditTransaction[];
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

/*
 * ============================================================
 * CONFIGURATION DES PACKS
 * ============================================================
 *
 * Ces valeurs correspondent à la logique définie côté backend.
 *
 * Elles servent uniquement à l'affichage.
 * Le wallet Supabase reste la source de vérité pour le solde,
 * les dates et le pack réellement attribué.
 */

const PACK_CONFIG: Record<
  PackId,
  {
    name: string;
    credits: number;
    durationDays: number;
  }
> = {
  light_pack: {
    name: "Léger",
    credits: 3_000,
    durationDays: 35,
  },

  intermediate_pack: {
    name: "Intermédiaire",
    credits: 28_500,
    durationDays: 35,
  },

  pro_pack: {
    name: "Pro",
    credits: 45_000,
    durationDays: 35,
  },

  business_pack: {
    name: "Business",
    credits: 96_000,
    durationDays: 35,
  },
};

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
      credentials: "include",
    },
  );

  if (!response.ok) {
    const error =
      await response.json().catch(() => null);

    throw new Error(
      error?.detail ||
        "Une erreur est survenue avec le serveur.",
    );
  }

  return response.json();
}

/*
 * ============================================================
 * FORMATAGE
 * ============================================================
 */

function formatCredits(
  value: number,
): string {
  return value.toLocaleString("fr-FR");
}

function formatDate(
  value: string | null,
): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    "fr-FR",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  );
}

function formatDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString(
    "fr-FR",
    {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

function getRemainingDays(
  expirationDate: string | null,
): number {
  if (!expirationDate) {
    return 0;
  }

  const expiration =
    new Date(expirationDate).getTime();

  const now = Date.now();

  const difference =
    expiration - now;

  if (difference <= 0) {
    return 0;
  }

  return Math.ceil(
    difference /
      (1000 * 60 * 60 * 24),
  );
}

function getPackName(
  packId: PackId | null,
): string {
  if (!packId) {
    return "Aucun pack";
  }

  return (
    PACK_CONFIG[packId]?.name ||
    "Pack inconnu"
  );
}

function getTransactionTitle(
  transaction: CreditTransaction,
): string {
  if (
    transaction.transaction_type ===
    "pack_purchase"
  ) {
    return "Achat de pack";
  }

  if (
    transaction.transaction_type ===
    "usage"
  ) {
    return transaction.action
      ? getActionLabel(
          transaction.action,
        )
      : "Utilisation de crédits";
  }

  if (
    transaction.transaction_type ===
    "recharge"
  ) {
    return "Recharge de crédits";
  }

  if (
    transaction.transaction_type ===
    "refund"
  ) {
    return "Remboursement";
  }

  return "Ajustement de crédits";
}

function getActionLabel(
  action: string,
): string {
  const labels: Record<
    string,
    string
  > = {
    chat_luna: "Luna",
    chat_luna_web: "Luna + Web",

    chat_gpt5: "GPT-5.6",
    chat_gpt5_web: "GPT-5.6 + Web",

    chat_terra: "GPT-5.6 Terra",
    chat_terra_web:
      "GPT-5.6 Terra + Web",

    chat_sol: "GPT-5.6 Sol",
    chat_sol_web:
      "GPT-5.6 Sol + Web",

    image_480: "Image 480",
    image_720: "Image 720",

    video_5s: "Vidéo 5 s",
    video_10s: "Vidéo 10 s",
    video_lite: "Veo Lite",

    image_pro: "Image Pro",
    image_pro_standard:
      "Image Pro Standard",
    image_pro_ultra:
      "Image Pro Ultra",

    video_pro_fast:
      "Veo Pro Fast",
    video_pro_standard:
      "Veo Pro Standard",
    video_pro_extension:
      "Veo Pro Extension",

    image_business:
      "Image Business",
    image_business_hd:
      "Image Business HD",
    image_business_ultra:
      "Image Business Ultra",

    video_business_fast:
      "Veo Business Fast",
    video_business_standard:
      "Veo Business Standard",
    video_business_long:
      "Veo Business Long",
  };

  return (
    labels[action] ||
    action
  );
}

function getTransactionDescription(
  transaction: CreditTransaction,
): string {
  if (
    transaction.transaction_type ===
    "usage"
  ) {
    return transaction.action
      ? `Utilisation · ${getActionLabel(
          transaction.action,
        )}`
      : "Utilisation de crédits";
  }

  if (
    transaction.transaction_type ===
    "pack_purchase"
  ) {
    return (
      transaction.reference_id ||
      "Activation d'un pack"
    );
  }

  if (
    transaction.transaction_type ===
    "recharge"
  ) {
    return "Recharge de crédits";
  }

  if (
    transaction.transaction_type ===
    "refund"
  ) {
    return "Crédits remboursés";
  }

  return "Modification du solde";
}

/*
 * ============================================================
 * PAGE
 * ============================================================
 */

export default function CreditsPage() {
  const [
    wallet,
    setWallet,
  ] = useState<CreditWallet | null>(
    null,
  );

  const [
    transactions,
    setTransactions,
  ] = useState<
    CreditTransaction[]
  >([]);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  useEffect(() => {
    loadCredits();
  }, []);

  async function loadCredits() {
    setIsLoading(true);
    setError(null);

    try {
      const [
        walletResponse,
        transactionsResponse,
      ] = await Promise.all([
        apiFetch<CreditsResponse>(
          "/credits/me",
        ),
        apiFetch<TransactionsResponse>(
          "/credits/me/transactions",
        ),
      ]);

      setWallet(
        walletResponse.wallet,
      );

      setTransactions(
        transactionsResponse.transactions ||
          [],
      );
    } catch (requestError) {
      console.error(
        "Erreur chargement crédits :",
        requestError,
      );

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger les crédits.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  /*
   * ============================================================
   * CALCULS
   * ============================================================
   */

  const usedCredits = useMemo(() => {
    if (!wallet) {
      return 0;
    }

    return Math.max(
      0,
      wallet.initial_credits -
        wallet.balance,
    );
  }, [wallet]);

  const usagePercentage = useMemo(() => {
    if (
      !wallet ||
      wallet.initial_credits <= 0
    ) {
      return 0;
    }

    return Math.min(
      100,
      Math.round(
        (usedCredits /
          wallet.initial_credits) *
          100,
      ),
    );
  }, [wallet, usedCredits]);

  const remainingDays = useMemo(
    () =>
      getRemainingDays(
        wallet?.pack_expires_at ||
          null,
      ),
    [wallet],
  );

  const packName = getPackName(
    wallet?.pack_id || null,
  );

  const isPackActive =
    Boolean(
      wallet?.pack_expires_at &&
        new Date(
          wallet.pack_expires_at,
        ).getTime() > Date.now(),
    );

  const operationCount =
    transactions.filter(
      (transaction) =>
        transaction.transaction_type ===
        "usage",
    ).length;

  const purchasedCredits =
    transactions
      .filter(
        (transaction) =>
          transaction.transaction_type ===
            "pack_purchase" ||
          transaction.transaction_type ===
            "recharge",
      )
      .reduce(
        (total, transaction) =>
          total +
          Math.max(
            0,
            transaction.amount,
          ),
        0,
      );

  /*
   * ============================================================
   * RENDU
   * ============================================================
   */

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Header */}

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label="Retour au chat"
              className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
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

          <Link
            href="/packs"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-85"
          >
            <Plus size={17} />

            <span className="hidden sm:inline">
              Obtenir des crédits
            </span>

            <span className="sm:hidden">
              Crédits
            </span>
          </Link>
        </div>
      </header>

      {/* Main */}

      <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-muted">
            Votre consommation
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            Mes crédits
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Suivez votre solde et comprenez
            comment vos crédits sont utilisés
            sur LBV-Connect.ia.
          </p>
        </div>

        {/* Loading */}

        {isLoading && (
          <div className="mt-8 rounded-3xl border border-border bg-surface-secondary p-10 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />

            <p className="mt-4 text-sm text-muted">
              Chargement de votre portefeuille...
            </p>
          </div>
        )}

        {/* Error */}

        {!isLoading && error && (
          <div className="mt-8 rounded-3xl border border-border bg-surface-secondary p-6">
            <p className="text-sm font-medium">
              Impossible de charger vos crédits.
            </p>

            <p className="mt-2 text-sm text-muted">
              {error}
            </p>

            <button
              type="button"
              onClick={loadCredits}
              className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Content */}

        {!isLoading &&
          !error &&
          wallet && (
            <>
              {/* Main balance */}

              <div className="mt-8 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                {/* Balance */}

                <div className="rounded-3xl border border-border bg-accent p-6 text-accent-foreground sm:p-8">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm opacity-60">
                        Solde disponible
                      </p>

                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-4xl font-semibold tracking-tight sm:text-5xl">
                          {formatCredits(
                            wallet.balance,
                          )}
                        </span>

                        <span className="text-sm opacity-60">
                          crédits
                        </span>
                      </div>
                    </div>

                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-foreground/10">
                      <Wallet size={20} />
                    </div>
                  </div>

                  {/* Progression */}

                  <div className="mt-8">
                    <div className="flex items-center justify-between text-xs">
                      <span className="opacity-60">
                        {formatCredits(
                          usedCredits,
                        )}{" "}
                        consommés
                      </span>

                      <span className="opacity-60">
                        {usagePercentage} %
                      </span>
                    </div>

                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-accent-foreground/10">
                      <div
                        className="h-full rounded-full bg-accent-foreground transition-all"
                        style={{
                          width: `${usagePercentage}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Informations pack */}

                  <div className="mt-6 flex flex-wrap gap-3">
                    <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">
                      <p className="text-[11px] opacity-60">
                        Pack actuel
                      </p>

                      <p className="mt-0.5 text-sm font-medium">
                        {packName}
                      </p>
                    </div>

                    <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">
                      <p className="text-[11px] opacity-60">
                        Crédits initiaux
                      </p>

                      <p className="mt-0.5 text-sm font-medium">
                        {formatCredits(
                          wallet.initial_credits,
                        )}
                      </p>
                    </div>

                    <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">
                      <p className="text-[11px] opacity-60">
                        Expiration
                      </p>

                      <p className="mt-0.5 text-sm font-medium">
                        {remainingDays}{" "}
                        jour
                        {remainingDays !==
                        1
                          ? "s"
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Pack status */}

                <div className="rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8">
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface">
                      <CalendarDays
                        size={20}
                        className="text-muted-strong"
                      />
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        isPackActive
                          ? "bg-surface-tertiary text-muted-strong"
                          : "bg-surface text-muted"
                      }`}
                    >
                      {isPackActive
                        ? "Actif"
                        : "Expiré"}
                    </span>
                  </div>

                  <p className="mt-6 text-sm text-muted">
                    Votre pack
                  </p>

                  <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                    {packName}
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-muted">
                    Vos crédits restent
                    utilisables jusqu'à la date
                    d'expiration de votre pack.
                  </p>

                  <div className="mt-6 space-y-3 text-sm text-muted-strong">
                    <div className="flex items-center gap-2">
                      <Clock3 size={16} />

                      <span>
                        {remainingDays} jour
                        {remainingDays !==
                        1
                          ? "s"
                          : ""}{" "}
                        restant
                        {remainingDays !==
                        1
                          ? "s"
                          : ""}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <CalendarDays size={16} />

                      <span>
                        Expire le{" "}
                        {formatDate(
                          wallet.pack_expires_at,
                        )}
                      </span>
                    </div>
                  </div>

                  <Link
                    href="/packs"
                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:underline"
                  >
                    Voir les packs

                    <ArrowUpRight
                      size={15}
                    />
                  </Link>
                </div>
              </div>

              {/* Usage overview */}

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <StatCard
                  icon={
                    <BarChart3
                      size={18}
                    />
                  }
                  label="Crédits consommés"
                  value={formatCredits(
                    usedCredits,
                  )}
                  description="Depuis le début du pack"
                />

                <StatCard
                  icon={
                    <Sparkles
                      size={18}
                    />
                  }
                  label="Opérations"
                  value={formatCredits(
                    operationCount,
                  )}
                  description="Actions effectuées"
                />

                <StatCard
                  icon={
                    <CreditCard
                      size={18}
                    />
                  }
                  label="Crédits achetés"
                  value={formatCredits(
                    purchasedCredits,
                  )}
                  description="Packs et recharges"
                />
              </div>

              {/* Transactions */}

              <section className="mt-10">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <History size={18} />

                      <h2 className="text-lg font-semibold">
                        Historique
                      </h2>
                    </div>

                    <p className="mt-1 text-sm text-muted">
                      Les dernières opérations
                      effectuées avec vos crédits.
                    </p>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-border">
                  {transactions.length >
                  0 ? (
                    transactions.map(
                      (
                        transaction,
                        index,
                      ) => (
                        <TransactionItem
                          key={
                            transaction.id
                          }
                          transaction={
                            transaction
                          }
                          isLast={
                            index ===
                            transactions.length -
                              1
                          }
                        />
                      ),
                    )
                  ) : (
                    <div className="px-6 py-12 text-center">
                      <History
                        size={22}
                        className="mx-auto text-muted"
                      />

                      <p className="mt-3 text-sm font-medium">
                        Aucun historique
                      </p>

                      <p className="mt-1 text-xs text-muted">
                        Vos opérations apparaîtront
                        ici.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
      </section>
    </main>
  );
}

/*
 * ============================================================
 * STAT CARD
 * ============================================================
 */

function StatCard({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface">
        {icon}
      </div>

      <p className="mt-5 text-sm text-muted">
        {label}
      </p>

      <p className="mt-1 text-2xl font-semibold tracking-tight">
        {value}
      </p>

      <p className="mt-1 text-xs text-muted">
        {description}
      </p>
    </div>
  );
}

/*
 * ============================================================
 * TRANSACTION ITEM
 * ============================================================
 */

function TransactionItem({
  transaction,
  isLast,
}: {
  transaction: CreditTransaction;
  isLast: boolean;
}) {
  const isPositive =
    transaction.amount > 0;

  return (
    <div
      className={`flex items-center gap-4 bg-surface p-4 sm:p-5 ${
        !isLast
          ? "border-b border-border"
          : ""
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary">
        {transaction.transaction_type ===
        "usage" ? (
          <Sparkles
            size={17}
            className="text-muted-strong"
          />
        ) : (
          <CreditCard
            size={17}
            className="text-muted-strong"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium">
          {getTransactionTitle(
            transaction,
          )}
        </h3>

        <p className="mt-0.5 truncate text-xs text-muted">
          {getTransactionDescription(
            transaction,
          )}
        </p>

        <p className="mt-1 text-[11px] text-muted">
          {formatDateTime(
            transaction.created_at,
          )}
        </p>
      </div>

      <div
        className={`shrink-0 text-sm font-semibold ${
          isPositive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-foreground"
        }`}
      >
        {isPositive ? "+" : ""}

        {formatCredits(
          transaction.amount,
        )}
      </div>
    </div>
  );
}