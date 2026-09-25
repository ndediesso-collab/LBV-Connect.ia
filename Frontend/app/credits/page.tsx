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



import { createClient } from "@/lib/supabase/client";



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
  "https://lbv-connect-api.onrender.com";



const supabase = createClient();





type OriaLanguage = "fr" | "en";



const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";



const UI = {

  fr: {

    backToChat: "Retour au chat",

    getCredits: "Obtenir des crédits",

    credits: "Crédits",

    yourUsage: "Votre consommation",

    myCredits: "Mes crédits",

    creditsDescription:

      "Suivez votre solde et le coût réel de chaque utilisation. Oria réserve une estimation avant l’action, puis ne débite que le coût réellement consommé.",

    loadingWallet: "Chargement de votre portefeuille...",

    loadCreditsError: "Impossible de charger vos crédits.",

    retry: "Réessayer",

    availableBalance: "Solde disponible",

    consumed: "consommés",

    currentPack: "Pack actuel",

    initialCredits: "Crédits initiaux",

    expiration: "Expiration",

    day: "jour",

    days: "jours",

    active: "Actif",

    expired: "Expiré",

    yourPack: "Votre pack",

    packUsageUntil:

      "Vos crédits restent utilisables jusqu'à la date d'expiration de votre pack.",

    remaining: "restant",

    remainings: "restants",

    expiresOn: "Expire le",

    viewPacks: "Voir les packs",

    creditsConsumed: "Crédits réellement consommés",

    sincePackStart: "Depuis le début du pack",

    operations: "Opérations",

    actionsPerformed: "Actions effectuées",

    creditsPurchased: "Crédits achetés",

    packsAndRecharges: "Packs et recharges",

    history: "Historique",

    historyDescription:

      "Les dernières opérations et les coûts réellement débités de votre portefeuille.",

    noHistory: "Aucun historique",

    operationsWillAppear: "Vos opérations apparaîtront ici.",

    noPack: "Aucun pack",

    unknownPack: "Pack inconnu",

    packPurchase: "Achat de pack",

    creditUsage: "Utilisation de crédits",

    creditRecharge: "Recharge de crédits",

    refund: "Remboursement",

    creditAdjustment: "Ajustement de crédits",

    usage: "Coût réel",

    packActivation: "Activation d'un pack",

    refundedCredits: "Crédits remboursés",

    balanceChange: "Modification du solde",

  },

  en: {

    backToChat: "Back to chat",

    getCredits: "Get credits",

    credits: "Credits",

    yourUsage: "Your usage",

    myCredits: "My credits",

    creditsDescription:

      "Track your balance and the actual cost of each use. Oria reserves an estimate before an action, then charges only the amount actually consumed.",

    loadingWallet: "Loading your wallet...",

    loadCreditsError: "Unable to load your credits.",

    retry: "Try again",

    availableBalance: "Available balance",

    consumed: "used",

    currentPack: "Current pack",

    initialCredits: "Initial credits",

    expiration: "Expiration",

    day: "day",

    days: "days",

    active: "Active",

    expired: "Expired",

    yourPack: "Your pack",

    packUsageUntil:

      "Your credits remain available until your pack expires.",

    remaining: "remaining",

    remainings: "remaining",

    expiresOn: "Expires on",

    viewPacks: "View packs",

    creditsConsumed: "Credits actually used",

    sincePackStart: "Since the start of the pack",

    operations: "Operations",

    actionsPerformed: "Actions performed",

    creditsPurchased: "Credits purchased",

    packsAndRecharges: "Packs and top-ups",

    history: "History",

    historyDescription:

      "Your latest transactions and the actual amounts charged to your wallet.",

    noHistory: "No history",

    operationsWillAppear: "Your transactions will appear here.",

    noPack: "No pack",

    unknownPack: "Unknown pack",

    packPurchase: "Pack purchase",

    creditUsage: "Credit usage",

    creditRecharge: "Credit top-up",

    refund: "Refund",

    creditAdjustment: "Credit adjustment",

    usage: "Actual cost",

    packActivation: "Pack activation",

    refundedCredits: "Refunded credits",

    balanceChange: "Balance adjustment",

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

    "Session expirée ou authentification invalide.":

      "Session expired or authentication is invalid.",

    "Une erreur est survenue avec le serveur.":

      "A server error occurred.",

    "Impossible de charger les crédits.":

      UI.en.loadCreditsError,

  };



  return exact[message] ?? message;

}





/*

 * ============================================================

 * CONFIGURATION DES PACKS

 * ============================================================

 *

 * Ces valeurs correspondent aux soldes actifs définis côté backend.

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
    credits: 20_000,
    durationDays: 35,
  },

  intermediate_pack: {
    name: "Intermédiaire",
    credits: 36_000,
    durationDays: 35,
  },

  pro_pack: {
    name: "Pro",
    credits: 48_000,
    durationDays: 35,
  },

  business_pack: {
    name: "Business",
    credits: 160_000,
    durationDays: 35,
  },
};

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

      await response.json().catch(() => null);



    if (response.status === 401) {

      throw new Error(

        "Session expirée ou authentification invalide.",

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

 * FORMATAGE

 * ============================================================

 */



function formatCredits(

  value: number,

  language: OriaLanguage,

): string {

  return value.toLocaleString(

    language === "en" ? "en-US" : "fr-FR",

  );

}



function formatDate(

  value: string | null,

  language: OriaLanguage,

): string {

  if (!value) {

    return "—";

  }



  const date = new Date(value);



  if (Number.isNaN(date.getTime())) {

    return "—";

  }



  return date.toLocaleDateString(

    language === "en" ? "en-US" : "fr-FR",

    {

      day: "numeric",

      month: "long",

      year: "numeric",

    },

  );

}



function formatDateTime(

  value: string,

  language: OriaLanguage,

): string {

  const date = new Date(value);



  if (Number.isNaN(date.getTime())) {

    return "—";

  }



  return date.toLocaleString(

    language === "en" ? "en-US" : "fr-FR",

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

  language: OriaLanguage,

): string {

  if (!packId) {

    return UI[language].noPack;

  }



  const packNames: Record<PackId, { fr: string; en: string }> = {

    light_pack: { fr: "Léger", en: "Light" },

    intermediate_pack: { fr: "Intermédiaire", en: "Intermediate" },

    pro_pack: { fr: "Pro", en: "Pro" },

    business_pack: { fr: "Business", en: "Business" },

  };



  return (

    packNames[packId]?.[language] ||

    UI[language].unknownPack

  );

}



function getTransactionTitle(

  transaction: CreditTransaction,

  language: OriaLanguage,

): string {

  if (

    transaction.transaction_type ===

    "pack_purchase"

  ) {

    return UI[language].packPurchase;

  }



  if (

    transaction.transaction_type ===

    "usage"

  ) {

    return transaction.action

      ? getActionLabel(

          transaction.action,

          language,

        )

      : UI[language].creditUsage;

  }



  if (

    transaction.transaction_type ===

    "recharge"

  ) {

    return UI[language].creditRecharge;

  }



  if (

    transaction.transaction_type ===

    "refund"

  ) {

    return UI[language].refund;

  }



  return UI[language].creditAdjustment;

}



function getActionLabel(
  action: string,
  language: OriaLanguage,
): string {
  const labels: Record<string, string> = {
    // Chat
    chat_luna: "GPT-6 Luna",
    chat_luna_web: "GPT-6 Luna + Web",

    chat_gpt5: "GPT-5",
    chat_gpt5_web: "GPT-5 + Web",

    chat_terra: "GPT-5.6 Terra",
    chat_terra_web: "GPT-5.6 Terra + Web",

    chat_sol: "GPT-6 Sol",
    chat_sol_web: "GPT-6 Sol + Web",

    chat_astra: "GPT-6 Astra",
    chat_astra_web: "GPT-6 Astra + Web",

    // Images — GPT Image 2
    image_480:
      language === "en"
        ? "Essential image · GPT Image 2"
        : "Image Essentielle · GPT Image 2",
    image_720:
      language === "en"
        ? "Image Plus · GPT Image 2"
        : "Image Plus · GPT Image 2",

    // Images — GPT Image 2.5 Flare
    image_pro:
      language === "en"
        ? "Pro image · GPT Image 2.5 Flare"
        : "Image Pro · GPT Image 2.5 Flare",
    image_pro_standard:
      language === "en"
        ? "Pro HD image · GPT Image 2.5 Flare"
        : "Image Pro HD · GPT Image 2.5 Flare",
    image_pro_ultra:
      language === "en"
        ? "Pro Ultra image · GPT Image 2.5 Flare"
        : "Image Pro Ultra · GPT Image 2.5 Flare",

    // Images — GPT Image 2.5 Sunburst
    image_business:
      language === "en"
        ? "Business image · GPT Image 2.5 Sunburst"
        : "Image Business · GPT Image 2.5 Sunburst",
    image_business_hd:
      language === "en"
        ? "Business HD image · GPT Image 2.5 Sunburst"
        : "Image Business HD · GPT Image 2.5 Sunburst",
    image_business_ultra:
      language === "en"
        ? "Business Max image · GPT Image 2.5 Sunburst"
        : "Image Business Max · GPT Image 2.5 Sunburst",

    // Vidéos — Sora 2
    video_4s:
      language === "en"
        ? "Video 4s · Sora 2"
        : "Vidéo 4 s · Sora 2",
    video_8s:
      language === "en"
        ? "Video 8s · Sora 2"
        : "Vidéo 8 s · Sora 2",
    video_lite:
      language === "en"
        ? "Lite video · Sora 2"
        : "Vidéo Lite · Sora 2",
    video_pro_fast:
      language === "en"
        ? "Pro Fast video · Sora 2"
        : "Vidéo Pro Fast · Sora 2",
    video_pro_standard:
      language === "en"
        ? "Pro Standard video · Sora 2"
        : "Vidéo Pro Standard · Sora 2",
    video_pro_extension:
      language === "en"
        ? "Pro Extension video · Sora 2"
        : "Vidéo Pro Extension · Sora 2",

    // Vidéos — Sora 2 Pro
    video_business_fast:
      language === "en"
        ? "Business Fast video · Sora 2 Pro"
        : "Vidéo Business Fast · Sora 2 Pro",
    video_business_standard:
      language === "en"
        ? "Business Standard video · Sora 2 Pro"
        : "Vidéo Business Standard · Sora 2 Pro",
    video_business_long:
      language === "en"
        ? "Business Long video · Sora 2 Pro"
        : "Vidéo Business Long · Sora 2 Pro",
  };

  return labels[action] || action;
}

function getTransactionDescription(

  transaction: CreditTransaction,

  language: OriaLanguage,

): string {

  if (

    transaction.transaction_type ===

    "usage"

  ) {

    return transaction.action

      ? `${UI[language].usage} · ${getActionLabel(

          transaction.action,

          language,

        )}`

      : UI[language].creditUsage;

  }



  if (

    transaction.transaction_type ===

    "pack_purchase"

  ) {

    return (

      transaction.reference_id ||

      UI[language].packActivation

    );

  }



  if (

    transaction.transaction_type ===

    "recharge"

  ) {

    return UI[language].creditRecharge;

  }



  if (

    transaction.transaction_type ===

    "refund"

  ) {

    return UI[language].refundedCredits;

  }



  return UI[language].balanceChange;

}



/*

 * ============================================================

 * PAGE

 * ============================================================

 */



export default function CreditsPage() {

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

    language,

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

              aria-label={UI[language].backToChat}

              className="rounded-xl p-2 text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"

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



          <Link

            href="/packs"

            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-85"

          >

            <Plus size={17} />



            <span className="hidden sm:inline">

              {UI[language].getCredits}

            </span>



            <span className="sm:hidden">

              {UI[language].credits}

            </span>

          </Link>

        </div>

      </header>



      {/* Main */}



      <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">

        <div>

          <p className="text-sm font-medium text-muted">

            {UI[language].yourUsage}

          </p>



          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">

            {UI[language].myCredits}

          </h1>



          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">

            {UI[language].creditsDescription}

          </p>

        </div>



        {/* Loading */}



        {isLoading && (

          <div className="mt-8 rounded-3xl border border-border bg-surface-secondary p-10 text-center">

            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />



            <p className="mt-4 text-sm text-muted">

              {UI[language].loadingWallet}

            </p>

          </div>

        )}



        {/* Error */}



        {!isLoading && error && (

          <div className="mt-8 rounded-3xl border border-border bg-surface-secondary p-6">

            <p className="text-sm font-medium">

              {UI[language].loadCreditsError}

            </p>



            <p className="mt-2 text-sm text-muted">

              {localizeFrontendError(error, language)}

            </p>



            <button

              type="button"

              onClick={loadCredits}

              className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"

            >

              {UI[language].retry}

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

                        {UI[language].availableBalance}

                      </p>



                      <div className="mt-3 flex items-baseline gap-2">

                        <span className="text-4xl font-semibold tracking-tight sm:text-5xl">

                          {formatCredits(

                            wallet.balance,

                            language,

                          )}

                        </span>



                        <span className="text-sm opacity-60">

                          {UI[language].credits.toLowerCase()}

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

                          language,

                        )}{" "}

                        {UI[language].consumed}

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

                        {UI[language].currentPack}

                      </p>



                      <p className="mt-0.5 text-sm font-medium">

                        {packName}

                      </p>

                    </div>



                    <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">

                      <p className="text-[11px] opacity-60">

                        {UI[language].initialCredits}

                      </p>



                      <p className="mt-0.5 text-sm font-medium">

                        {formatCredits(

                          wallet.initial_credits,

                          language,

                        )}

                      </p>

                    </div>



                    <div className="rounded-xl bg-accent-foreground/10 px-3 py-2">

                      <p className="text-[11px] opacity-60">

                        {UI[language].expiration}

                      </p>



                      <p className="mt-0.5 text-sm font-medium">

                        {remainingDays}{" "}

                        {remainingDays === 1

                          ? UI[language].day

                          : UI[language].days}

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

                        ? UI[language].active

                        : UI[language].expired}

                    </span>

                  </div>



                  <p className="mt-6 text-sm text-muted">

                    {UI[language].yourPack}

                  </p>



                  <h2 className="mt-1 text-2xl font-semibold tracking-tight">

                    {packName}

                  </h2>



                  <p className="mt-2 text-sm leading-6 text-muted">

                    {UI[language].packUsageUntil}

                  </p>



                  <div className="mt-6 space-y-3 text-sm text-muted-strong">

                    <div className="flex items-center gap-2">

                      <Clock3 size={16} />



                      <span>

                        {remainingDays}{" "}

                        {remainingDays === 1

                          ? UI[language].day

                          : UI[language].days}{" "}

                        {remainingDays === 1

                          ? UI[language].remaining

                          : UI[language].remainings}

                      </span>

                    </div>



                    <div className="flex items-center gap-2">

                      <CalendarDays size={16} />



                      <span>

                        {UI[language].expiresOn}{" "}

                        {formatDate(

                          wallet.pack_expires_at,

                          language,

                        )}

                      </span>

                    </div>

                  </div>



                  <Link

                    href="/packs"

                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:underline"

                  >

                    {UI[language].viewPacks}



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

                  label={UI[language].creditsConsumed}

                  value={formatCredits(

                    usedCredits,

                    language,

                  )}

                  description={UI[language].sincePackStart}

                />



                <StatCard

                  icon={

                    <Sparkles

                      size={18}

                    />

                  }

                  label={UI[language].operations}

                  value={formatCredits(

                    operationCount,

                    language,

                  )}

                  description={UI[language].actionsPerformed}

                />



                <StatCard

                  icon={

                    <CreditCard

                      size={18}

                    />

                  }

                  label={UI[language].creditsPurchased}

                  value={formatCredits(

                    purchasedCredits,

                    language,

                  )}

                  description={UI[language].packsAndRecharges}

                />

              </div>



              {/* Transactions */}



              <section className="mt-10">

                <div className="flex items-center justify-between">

                  <div>

                    <div className="flex items-center gap-2">

                      <History size={18} />



                      <h2 className="text-lg font-semibold">

                        {UI[language].history}

                      </h2>

                    </div>



                    <p className="mt-1 text-sm text-muted">

                      {UI[language].historyDescription}

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

                          language={language}

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

                        {UI[language].noHistory}

                      </p>



                      <p className="mt-1 text-xs text-muted">

                        {UI[language].operationsWillAppear}

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

  language,

  transaction,

  isLast,

}: {

  language: OriaLanguage;

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

            language,

          )}

        </h3>



        <p className="mt-0.5 truncate text-xs text-muted">

          {getTransactionDescription(

            transaction,

            language,

          )}

        </p>



        <p className="mt-1 text-[11px] text-muted">

          {formatDateTime(

            transaction.created_at,

            language,

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

          language,

        )}

      </div>

    </div>

  );

}