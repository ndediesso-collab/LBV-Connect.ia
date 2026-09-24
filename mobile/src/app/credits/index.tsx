import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase/client";
import * as SecureStore from "expo-secure-store";

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

type CreditsResponse = { wallet: CreditWallet };
type TransactionsResponse = { transactions: CreditTransaction[] };

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

const PACK_CONFIG: Record<
  PackId,
  { name: string; credits: number; durationDays: number }
> = {
  light_pack: { name: "Léger", credits: 3000, durationDays: 35 },
  intermediate_pack: {
    name: "Intermédiaire",
    credits: 28500,
    durationDays: 35,
  },
  pro_pack: { name: "Pro", credits: 45000, durationDays: 35 },
  business_pack: { name: "Business", credits: 96000, durationDays: 35 },
};


type OriaLanguage = "fr" | "en";

const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

const UI = {
  fr: {
    getCredits: "Obtenir des crédits",
    consumption: "VOTRE CONSOMMATION",
    myCredits: "Mes crédits",
    description:
      "Suivez votre solde et comprenez comment vos crédits sont utilisés sur ORIA.",
    loadingWallet: "Chargement de votre portefeuille...",
    creditsLoadError: "Impossible de charger vos crédits.",
    retry: "Réessayer",
    availableBalance: "Solde disponible",
    credits: "crédits",
    consumed: "consommés",
    currentPack: "Pack actuel",
    initialCredits: "Crédits initiaux",
    expiration: "Expiration",
    active: "Actif",
    expired: "Expiré",
    yourPack: "Votre pack",
    packDescription:
      "Vos crédits restent utilisables jusqu'à la date d'expiration de votre pack.",
    remainingDay: "jour restant",
    remainingDays: "jours restants",
    expiresOn: "Expire le",
    viewPacks: "Voir les packs",
    creditsConsumed: "Crédits consommés",
    sincePackStart: "Depuis le début du pack",
    operations: "Opérations",
    actionsPerformed: "Actions effectuées",
    creditsPurchased: "Crédits achetés",
    packsAndTopups: "Packs et recharges",
    history: "Historique",
    historyDescription:
      "Les dernières opérations effectuées avec vos crédits.",
    noHistory: "Aucun historique",
    operationsAppearHere: "Vos opérations apparaîtront ici.",
    noPack: "Aucun pack",
    unknownPack: "Pack inconnu",
    packPurchase: "Achat de pack",
    creditUsage: "Utilisation de crédits",
    creditTopup: "Recharge de crédits",
    refund: "Remboursement",
    adjustment: "Ajustement de crédits",
    usage: "Utilisation",
    packActivation: "Activation d'un pack",
    refundedCredits: "Crédits remboursés",
    balanceChange: "Modification du solde",
    sessionExpired: "Session expirée ou authentification invalide.",
    serverError: "Une erreur est survenue avec le serveur.",
    loadFallback: "Impossible de charger les crédits.",
    packNames: {
      light_pack: "Léger",
      intermediate_pack: "Intermédiaire",
      pro_pack: "Pro",
      business_pack: "Business",
    },
  },
  en: {
    getCredits: "Get credits",
    consumption: "YOUR USAGE",
    myCredits: "My credits",
    description:
      "Track your balance and understand how your credits are used on ORIA.",
    loadingWallet: "Loading your wallet...",
    creditsLoadError: "Unable to load your credits.",
    retry: "Try again",
    availableBalance: "Available balance",
    credits: "credits",
    consumed: "used",
    currentPack: "Current pack",
    initialCredits: "Initial credits",
    expiration: "Expiration",
    active: "Active",
    expired: "Expired",
    yourPack: "Your pack",
    packDescription:
      "Your credits remain usable until your pack's expiration date.",
    remainingDay: "day remaining",
    remainingDays: "days remaining",
    expiresOn: "Expires on",
    viewPacks: "View packs",
    creditsConsumed: "Credits used",
    sincePackStart: "Since the start of the pack",
    operations: "Operations",
    actionsPerformed: "Actions performed",
    creditsPurchased: "Credits purchased",
    packsAndTopups: "Packs and top-ups",
    history: "History",
    historyDescription:
      "Your latest credit transactions.",
    noHistory: "No history",
    operationsAppearHere: "Your transactions will appear here.",
    noPack: "No pack",
    unknownPack: "Unknown pack",
    packPurchase: "Pack purchase",
    creditUsage: "Credit usage",
    creditTopup: "Credit top-up",
    refund: "Refund",
    adjustment: "Credit adjustment",
    usage: "Usage",
    packActivation: "Pack activation",
    refundedCredits: "Refunded credits",
    balanceChange: "Balance change",
    sessionExpired: "Session expired or authentication invalid.",
    serverError: "A server error occurred.",
    loadFallback: "Unable to load credits.",
    packNames: {
      light_pack: "Light",
      intermediate_pack: "Intermediate",
      pro_pack: "Pro",
      business_pack: "Business",
    },
  },
} as const;

async function readOriaLanguage(): Promise<OriaLanguage> {
  try {
    if (Platform.OS === "web") {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ORIA_LANGUAGE_STORAGE_KEY)
          : null;

      if (saved === "fr" || saved === "en") return saved;

      if (
        typeof navigator !== "undefined" &&
        navigator.language.toLowerCase().startsWith("en")
      ) {
        return "en";
      }

      return "fr";
    }

    const saved = await SecureStore.getItemAsync(ORIA_LANGUAGE_STORAGE_KEY);
    return saved === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}


async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  if (!supabase) {
    throw new Error(
      "Supabase n'est pas configuré. Vérifiez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error("Utilisateur non authentifié.");
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
    const error = await response.json().catch(() => null);

    if (response.status === 401) {
      throw new Error("Session expirée ou authentification invalide.");
    }

    throw new Error(
      error?.detail || "Une erreur est survenue avec le serveur."
    );
  }

  return response.json();
}

function formatCredits(value: number, language: OriaLanguage) {
  return value.toLocaleString(language === "en" ? "en-US" : "fr-FR");
}

function formatDate(value: string | null, language: OriaLanguage) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(language === "en" ? "en-US" : "fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(value: string, language: OriaLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(language === "en" ? "en-US" : "fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRemainingDays(expirationDate: string | null) {
  if (!expirationDate) return 0;

  const difference = new Date(expirationDate).getTime() - Date.now();
  if (difference <= 0) return 0;

  return Math.ceil(difference / (1000 * 60 * 60 * 24));
}

function getPackName(packId: PackId | null, language: OriaLanguage) {
  if (!packId) return UI[language].noPack;
  return UI[language].packNames[packId] || UI[language].unknownPack;
}

function getActionLabel(action: string, language: OriaLanguage) {
  const labels: Record<string, string> = {
    chat_luna: "Luna",
    chat_luna_web: "Luna + Web",
    chat_gpt5: "GPT-5.6",
    chat_gpt5_web: "GPT-5.6 + Web",
    chat_terra: "GPT-5.6 Terra",
    chat_terra_web: "GPT-5.6 Terra + Web",
    chat_sol: "GPT-5.6 Sol",
    chat_sol_web: "GPT-5.6 Sol + Web",
    image_480: "Image 480",
    image_720: "Image 720",
    video_5s: language === "en" ? "Video 5 s" : "Vidéo 5 s",
    video_10s: language === "en" ? "Video 10 s" : "Vidéo 10 s",
    video_lite: "Veo Lite",
    image_pro: "Image Pro",
    image_pro_standard: "Image Pro Standard",
    image_pro_ultra: "Image Pro Ultra",
    video_pro_fast: "Veo Pro Fast",
    video_pro_standard: "Veo Pro Standard",
    video_pro_extension: "Veo Pro Extension",
    image_business: "Image Business",
    image_business_hd: "Image Business HD",
    image_business_ultra: "Image Business Ultra",
    video_business_fast: "Veo Business Fast",
    video_business_standard: "Veo Business Standard",
    video_business_long: "Veo Business Long",
  };

  return labels[action] || action;
}

function getTransactionTitle(transaction: CreditTransaction, language: OriaLanguage) {
  const t = UI[language];
  switch (transaction.transaction_type) {
    case "pack_purchase":
      return t.packPurchase;
    case "usage":
      return transaction.action
        ? getActionLabel(transaction.action, language)
        : t.creditUsage;
    case "recharge":
      return t.creditTopup;
    case "refund":
      return t.refund;
    default:
      return t.adjustment;
  }
}

function getTransactionDescription(transaction: CreditTransaction, language: OriaLanguage) {
  const t = UI[language];
  if (transaction.transaction_type === "usage") {
    return transaction.action
      ? `${t.usage} · ${getActionLabel(transaction.action, language)}`
      : t.creditUsage;
  }

  if (transaction.transaction_type === "pack_purchase") {
    return transaction.reference_id || t.packActivation;
  }

  if (transaction.transaction_type === "recharge") {
    return t.creditTopup;
  }

  if (transaction.transaction_type === "refund") {
    return t.refundedCredits;
  }

  return t.balanceChange;
}

function StatCard({
  icon,
  label,
  value,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>
        <Ionicons name={icon} size={18} color="#55555f" />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statDescription}>{description}</Text>
    </View>
  );
}

function TransactionItem({
  transaction,
  language,
}: {
  transaction: CreditTransaction;
  language: OriaLanguage;
}) {
  const isPositive = transaction.amount > 0;

  return (
    <View style={styles.transactionItem}>
      <View style={styles.transactionIcon}>
        <Ionicons
          name={
            transaction.transaction_type === "usage"
              ? "sparkles-outline"
              : "card-outline"
          }
          size={17}
          color="#62626b"
        />
      </View>

      <View style={styles.transactionContent}>
        <Text style={styles.transactionTitle} numberOfLines={1}>
          {getTransactionTitle(transaction, language)}
        </Text>
        <Text style={styles.transactionDescription} numberOfLines={1}>
          {getTransactionDescription(transaction, language)}
        </Text>
        <Text style={styles.transactionDate}>
          {formatDateTime(transaction.created_at, language)}
        </Text>
      </View>

      <Text
        style={[
          styles.transactionAmount,
          isPositive && styles.transactionAmountPositive,
        ]}
      >
        {isPositive ? "+" : ""}
        {formatCredits(transaction.amount, language)}
      </Text>
    </View>
  );
}

export default function CreditsPage() {
  const { top: safeAreaTop, bottom: safeAreaBottom } = useSafeAreaInsets();
  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const t = UI[language];

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void readOriaLanguage().then((savedLanguage) => {
        if (active) setLanguage(savedLanguage);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCredits = useCallback(async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    setError(null);

    try {
      const [walletResponse, transactionsResponse] = await Promise.all([
        apiFetch<CreditsResponse>("/credits/me"),
        apiFetch<TransactionsResponse>("/credits/me/transactions"),
      ]);

      setWallet(walletResponse.wallet);
      setTransactions(transactionsResponse.transactions || []);
    } catch (requestError) {
      console.error("Erreur chargement crédits :", requestError);

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Impossible de charger les crédits."
      );
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, [t.loadFallback]);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCredits(false);
    setRefreshing(false);
  }, [loadCredits]);

  const usedCredits = useMemo(() => {
    if (!wallet) return 0;
    return Math.max(0, wallet.initial_credits - wallet.balance);
  }, [wallet]);

  const usagePercentage = useMemo(() => {
    if (!wallet || wallet.initial_credits <= 0) return 0;

    return Math.min(
      100,
      Math.round((usedCredits / wallet.initial_credits) * 100)
    );
  }, [wallet, usedCredits]);

  const remainingDays = useMemo(
    () => getRemainingDays(wallet?.pack_expires_at || null),
    [wallet]
  );

  const packName = getPackName(wallet?.pack_id || null, language);

  const isPackActive = Boolean(
    wallet?.pack_expires_at &&
      new Date(wallet.pack_expires_at).getTime() > Date.now()
  );

  const operationCount = transactions.filter(
    (transaction) => transaction.transaction_type === "usage"
  ).length;

  const purchasedCredits = transactions
    .filter(
      (transaction) =>
        transaction.transaction_type === "pack_purchase" ||
        transaction.transaction_type === "recharge"
    )
    .reduce(
      (total, transaction) => total + Math.max(0, transaction.amount),
      0
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.push("/chat" as any)}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={20} color="#4f4f58" />
          </Pressable>

          <View style={styles.brandIcon}>
            <Ionicons name="sparkles" size={15} color="#15151a" />
          </View>
          <Text style={styles.brandText}>ORIA</Text>
        </View>

        <Pressable
          style={styles.buyButton}
          onPress={() => router.push("/packs" as any)}
        >
          <Ionicons name="add" size={17} color="#fff" />
          <Text style={styles.buyButtonText}>{t.getCredits}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#111114"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={styles.overline}>{t.consumption}</Text>
          <Text style={styles.pageTitle}>{t.myCredits}</Text>
          <Text style={styles.pageDescription}>
            {t.description}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#111114" />
            <Text style={styles.loadingText}>
              {t.loadingWallet}
            </Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons
              name="alert-circle-outline"
              size={22}
              color="#62626b"
            />
            <Text style={styles.errorTitle}>
              {t.creditsLoadError}
            </Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => loadCredits()}>
              <Text style={styles.retryButtonText}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : wallet ? (
          <>
            <View style={styles.balanceCard}>
              <View style={styles.balanceTop}>
                <View>
                  <Text style={styles.balanceLabel}>{t.availableBalance}</Text>
                  <View style={styles.balanceRow}>
                    <Text style={styles.balanceValue}>
                      {formatCredits(wallet.balance, language)}
                    </Text>
                    <Text style={styles.balanceUnit}>{t.credits}</Text>
                  </View>
                </View>

                <View style={styles.balanceIcon}>
                  <Ionicons name="wallet-outline" size={21} color="#fff" />
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressText}>
                    {formatCredits(usedCredits, language)} {t.consumed}
                  </Text>
                  <Text style={styles.progressText}>
                    {usagePercentage} %
                  </Text>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${usagePercentage}%` },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.packInfoRow}>
                <View style={styles.packInfo}>
                  <Text style={styles.packInfoLabel}>{t.currentPack}</Text>
                  <Text style={styles.packInfoValue}>{packName}</Text>
                </View>

                <View style={styles.packInfo}>
                  <Text style={styles.packInfoLabel}>{t.initialCredits}</Text>
                  <Text style={styles.packInfoValue}>
                    {formatCredits(wallet.initial_credits, language)}
                  </Text>
                </View>

                <View style={styles.packInfo}>
                  <Text style={styles.packInfoLabel}>{t.expiration}</Text>
                  <Text style={styles.packInfoValue}>
                    {remainingDays}{" "}
                    {remainingDays === 1
                      ? language === "en" ? "day" : "jour"
                      : language === "en" ? "days" : "jours"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.packStatusCard}>
              <View style={styles.packStatusTop}>
                <View style={styles.calendarIcon}>
                  <Ionicons name="calendar-outline" size={20} color="#5d5d66" />
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    isPackActive
                      ? styles.statusActive
                      : styles.statusExpired,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {isPackActive ? t.active : t.expired}
                  </Text>
                </View>
              </View>

              <Text style={styles.mutedLabel}>{t.yourPack}</Text>
              <Text style={styles.packTitle}>{packName}</Text>
              <Text style={styles.packDescription}>
{t.packDescription}
              </Text>

              <View style={styles.packDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="time-outline" size={16} color="#66666f" />
                  <Text style={styles.detailText}>
                    {remainingDays}{" "}
                    {remainingDays === 1 ? t.remainingDay : t.remainingDays}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Ionicons
                    name="calendar-outline"
                    size={16}
                    color="#66666f"
                  />
                  <Text style={styles.detailText}>
                    {t.expiresOn} {formatDate(wallet.pack_expires_at, language)}
                  </Text>
                </View>
              </View>

              <Pressable
                style={styles.packsLink}
                onPress={() => router.push("/packs" as any)}
              >
                <Text style={styles.packsLinkText}>{t.viewPacks}</Text>
                <Ionicons name="arrow-forward" size={15} color="#202025" />
              </Pressable>
            </View>

            <View style={styles.statsGrid}>
              <StatCard
                icon="bar-chart-outline"
                label={t.creditsConsumed}
                value={formatCredits(usedCredits, language)}
                description={t.sincePackStart}
              />
              <StatCard
                icon="sparkles-outline"
                label={t.operations}
                value={formatCredits(operationCount, language)}
                description={t.actionsPerformed}
              />
              <StatCard
                icon="card-outline"
                label={t.creditsPurchased}
                value={formatCredits(purchasedCredits, language)}
                description={t.packsAndTopups}
              />
            </View>

            <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <View style={styles.historyIcon}>
                  <Ionicons name="time-outline" size={18} color="#4f4f58" />
                </View>
                <View style={styles.historyHeaderText}>
                  <Text style={styles.historyTitle}>{t.history}</Text>
                  <Text style={styles.historyDescription}>
                    {t.historyDescription}
                  </Text>
                </View>
              </View>

              <View style={styles.transactionsBox}>
                {transactions.length > 0 ? (
                  transactions.map((transaction) => (
                    <TransactionItem
                      key={transaction.id}
                      transaction={transaction}
                      language={language}
                    />
                  ))
                ) : (
                  <View style={styles.noTransactions}>
                    <Ionicons
                      name="time-outline"
                      size={24}
                      color="#888891"
                    />
                    <Text style={styles.noTransactionsTitle}>
                      {t.noHistory}
                    </Text>
                    <Text style={styles.noTransactionsText}>
                      {t.operationsAppearHere}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dedee3",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7,
  },
  brandIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandText: {
    color: "#15151a",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  buyButton: {
    minHeight: 40,
    borderRadius: 11,
    backgroundColor: "#111114",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  buyButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 5,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 29,
    paddingBottom: 45,
  },
  intro: {
    marginBottom: 24,
  },
  overline: {
    color: "#777780",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.15,
    marginBottom: 5,
  },
  pageTitle: {
    color: "#15151a",
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  pageDescription: {
    color: "#777780",
    fontSize: 13.5,
    lineHeight: 21,
    marginTop: 8,
  },
  loadingBox: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: "#e3e3e7",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: "#777780",
    fontSize: 13,
    marginTop: 10,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: "#e1e1e5",
    backgroundColor: "#fafafa",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
  },
  errorTitle: {
    color: "#202025",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
  },
  errorText: {
    color: "#777780",
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: "#111114",
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "600",
  },
  balanceCard: {
    backgroundColor: "#111114",
    borderRadius: 22,
    padding: 21,
  },
  balanceTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  balanceLabel: {
    color: "#fff",
    opacity: 0.58,
    fontSize: 12,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 8,
  },
  balanceValue: {
    color: "#fff",
    fontSize: 37,
    lineHeight: 44,
    fontWeight: "600",
    letterSpacing: -1,
  },
  balanceUnit: {
    color: "#fff",
    opacity: 0.58,
    fontSize: 12,
    marginLeft: 7,
  },
  balanceIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  progressSection: {
    marginTop: 27,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    color: "#fff",
    opacity: 0.58,
    fontSize: 10.5,
  },
  progressTrack: {
    height: 7,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    marginTop: 8,
  },
  progressFill: {
    height: "100%",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  packInfoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 21,
    gap: 8,
  },
  packInfo: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minWidth: 100,
    flexGrow: 1,
  },
  packInfoLabel: {
    color: "#fff",
    opacity: 0.56,
    fontSize: 9.5,
  },
  packInfoValue: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  packStatusCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e3e3e7",
    backgroundColor: "#fafafa",
    borderRadius: 22,
    padding: 21,
  },
  packStatusTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calendarIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    borderRadius: 18,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statusActive: {
    backgroundColor: "#eeeeef",
  },
  statusExpired: {
    backgroundColor: "#f3f3f4",
  },
  statusText: {
    color: "#5d5d66",
    fontSize: 11,
    fontWeight: "600",
  },
  mutedLabel: {
    color: "#777780",
    fontSize: 12,
    marginTop: 21,
  },
  packTitle: {
    color: "#1b1b20",
    fontSize: 23,
    fontWeight: "700",
    marginTop: 4,
  },
  packDescription: {
    color: "#777780",
    fontSize: 12.5,
    lineHeight: 19,
    marginTop: 6,
  },
  packDetails: {
    marginTop: 18,
    gap: 11,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailText: {
    color: "#66666f",
    fontSize: 12.5,
    marginLeft: 8,
  },
  packsLink: {
    marginTop: 20,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  packsLinkText: {
    color: "#202025",
    fontSize: 12.5,
    fontWeight: "600",
    marginRight: 6,
  },
  statsGrid: {
    marginTop: 10,
    gap: 10,
  },
  statCard: {
    borderWidth: 1,
    borderColor: "#e3e3e7",
    borderRadius: 17,
    backgroundColor: "#fafafa",
    padding: 17,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    color: "#777780",
    fontSize: 12,
    marginTop: 14,
  },
  statValue: {
    color: "#1b1b20",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 3,
  },
  statDescription: {
    color: "#888891",
    fontSize: 10.5,
    marginTop: 3,
  },
  historySection: {
    marginTop: 29,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  historyIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  historyHeaderText: {
    flex: 1,
  },
  historyTitle: {
    color: "#1b1b20",
    fontSize: 17,
    fontWeight: "700",
  },
  historyDescription: {
    color: "#777780",
    fontSize: 11.5,
    marginTop: 2,
  },
  transactionsBox: {
    marginTop: 15,
    borderWidth: 1,
    borderColor: "#e3e3e7",
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  transactionItem: {
    minHeight: 82,
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e8e8eb",
    flexDirection: "row",
    alignItems: "center",
  },
  transactionIcon: {
    width: 39,
    height: 39,
    borderRadius: 11,
    backgroundColor: "#f0f0f2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  transactionContent: {
    flex: 1,
    minWidth: 0,
  },
  transactionTitle: {
    color: "#29292f",
    fontSize: 12.5,
    fontWeight: "600",
  },
  transactionDescription: {
    color: "#777780",
    fontSize: 10.5,
    marginTop: 2,
  },
  transactionDate: {
    color: "#9999a1",
    fontSize: 9.5,
    marginTop: 4,
  },
  transactionAmount: {
    color: "#29292f",
    fontSize: 12.5,
    fontWeight: "700",
    marginLeft: 7,
  },
  transactionAmountPositive: {
    color: "#3f7b55",
  },
  noTransactions: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  noTransactionsTitle: {
    color: "#29292f",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 10,
  },
  noTransactionsText: {
    color: "#888891",
    fontSize: 11,
    marginTop: 4,
  },
});