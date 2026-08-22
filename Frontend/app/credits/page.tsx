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

type CreditTransaction = {
  id: string;
  title: string;
  description: string;
  date: string;
  amount: number;
  type: "usage" | "purchase" | "refund";
};

/*
 * Données temporaires.
 *
 * Elles seront remplacées plus tard par les données
 * réelles provenant de Supabase après l'intégration
 * du système de crédits et des achats.
 */
const transactions: CreditTransaction[] = [
  {
    id: "1",
    title: "Raisonnement avancé",
    description: "Analyse d'un problème complexe",
    date: "Aujourd'hui · 19:42",
    amount: -128,
    type: "usage",
  },
  {
    id: "2",
    title: "Analyse de document",
    description: "PDF · 14 pages",
    date: "Aujourd'hui · 18:16",
    amount: -74,
    type: "usage",
  },
  {
    id: "3",
    title: "Chat IA",
    description: "Modèle Standard",
    date: "Aujourd'hui · 17:51",
    amount: -18,
    type: "usage",
  },
  {
    id: "4",
    title: "Crédits complémentaires",
    description: "Recharge de crédits",
    date: "18 août · 12:30",
    amount: 500,
    type: "purchase",
  },
];

/*
 * Données temporaires.
 *
 * Le solde réel, la consommation et le pack actif
 * seront branchés à Supabase lors de l'étape
 * d'intégration du système de crédits.
 */
const startingCredits = 15000;
const currentCredits = 14280;

const usedCredits =
  startingCredits - currentCredits;

const usagePercentage = Math.min(
  100,
  Math.round(
    (usedCredits / startingCredits) * 100,
  ),
);

export default function CreditsPage() {
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
                    {currentCredits.toLocaleString(
                      "fr-FR",
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
                  {usedCredits.toLocaleString(
                    "fr-FR",
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
                  Léger
                </p>
              </div>

              <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">
                <p className="text-[11px] opacity-60">
                  Expiration
                </p>

                <p className="mt-0.5 text-sm font-medium">
                  27 jours
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

              <span className="rounded-full bg-surface-tertiary px-3 py-1 text-xs font-medium text-muted-strong">
                Actif
              </span>
            </div>

            <p className="mt-6 text-sm text-muted">
              Votre pack
            </p>

            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Léger
            </h2>

            <p className="mt-2 text-sm leading-6 text-muted">
              Vos crédits restent utilisables
              jusqu'à la date d'expiration de
              votre pack.
            </p>

            <div className="mt-6 flex items-center gap-2 text-sm text-muted-strong">
              <Clock3 size={16} />

              <span>
                27 jours restants
              </span>
            </div>

            <Link
              href="/packs"
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:underline"
            >
              Voir les packs

              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>

        {/* Usage overview */}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={<BarChart3 size={18} />}
            label="Crédits consommés"
            value={usedCredits.toLocaleString(
              "fr-FR",
            )}
            description="Depuis le début du pack"
          />

          <StatCard
            icon={<Sparkles size={18} />}
            label="Opérations"
            value="38"
            description="Actions effectuées"
          />

          <StatCard
            icon={<CreditCard size={18} />}
            label="Crédits achetés"
            value="500"
            description="Crédits complémentaires"
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
            {transactions.map(
              (transaction, index) => (
                <TransactionItem
                  key={transaction.id}
                  transaction={transaction}
                  isLast={
                    index ===
                    transactions.length - 1
                  }
                />
              ),
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

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
        {transaction.type === "usage" ? (
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
          {transaction.title}
        </h3>

        <p className="mt-0.5 truncate text-xs text-muted">
          {transaction.description}
        </p>

        <p className="mt-1 text-[11px] text-muted">
          {transaction.date}
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

        {transaction.amount.toLocaleString(
          "fr-FR",
        )}
      </div>
    </div>
  );
}