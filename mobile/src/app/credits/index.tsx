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



  consumed_credits: number;



  consumed_percentage: number;



  remaining_percentage: number;



  created_at: string;



  updated_at: string;



  pack_id: PackId | null;



  pack_activated_at: string | null;



  pack_expires_at: string | null;



  is_pack_active: boolean;



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

  light_pack: { name: "Léger", credits: 15_000, durationDays: 35 },

  intermediate_pack: {

    name: "Intermédiaire",

    credits: 27_000,

    durationDays: 35,

  },

  pro_pack: { name: "Pro", credits: 36_000, durationDays: 35 },

  business_pack: { name: "Business", credits: 120_000, durationDays: 35 },

};











type OriaLanguage = "fr" | "en";







const ORIA_LANGUAGE_STORAGE_KEY = "oria_language";

type OriaTheme = "light" | "dark";

const OriaThemeContext = React.createContext<OriaTheme>("light");

async function readOriaTheme(): Promise<OriaTheme> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return "light";
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("theme")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      return "light";
    }

    return data?.theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function normalizeHexColor(value: string) {
  const color = value.trim();

  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return null;
  }

  if (color.length === 4) {
    return {
      r: parseInt(color[1] + color[1], 16),
      g: parseInt(color[2] + color[2], 16),
      b: parseInt(color[3] + color[3], 16),
    };
  }

  if (color.length === 7 || color.length === 9) {
    return {
      r: parseInt(color.slice(1, 3), 16),
      g: parseInt(color.slice(3, 5), 16),
      b: parseInt(color.slice(5, 7), 16),
    };
  }

  return null;
}

function darkThemeNeutral(
  value: string,
  property:
    | "color"
    | "backgroundColor"
    | "borderColor"
    | "borderTopColor"
    | "borderBottomColor"
    | "borderLeftColor"
    | "borderRightColor",
) {
  const rgb = normalizeHexColor(value);

  if (!rgb) {
    return value;
  }

  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);

  if (max - min > 28) {
    return value;
  }

  const luminance =
    (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;

  if (property === "color") {
    if (luminance >= 0.82) {
      return value;
    }

    if (luminance >= 0.42) {
      return "#b7b7be";
    }

    return "#f3f3f5";
  }

  if (
    property === "borderColor" ||
    property === "borderTopColor" ||
    property === "borderBottomColor" ||
    property === "borderLeftColor" ||
    property === "borderRightColor"
  ) {
    return luminance >= 0.45 ? "#303036" : "#3a3a40";
  }

  if (luminance >= 0.94) {
    return "#101012";
  }

  if (luminance >= 0.78) {
    return "#17171a";
  }

  if (luminance >= 0.45) {
    return "#1d1d21";
  }

  if (luminance <= 0.12) {
    return "#222226";
  }

  return "#18181b";
}

function buildDarkStyleOverride(style: unknown) {
  const flattened = StyleSheet.flatten(style as any);

  if (!flattened) {
    return undefined;
  }

  const override: Record<string, unknown> = {};

  const themeColorProperties = [
    "color",
    "backgroundColor",
    "borderColor",
    "borderTopColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderRightColor",
  ] as const;

  for (const property of themeColorProperties) {
    const value = flattened[property];

    if (typeof value === "string" && value.startsWith("#")) {
      override[property] = darkThemeNeutral(value, property);
    }
  }

  return Object.keys(override).length > 0 ? override : undefined;
}

function getThemedStyles(theme: OriaTheme) {
  if (theme === "light") {
    return baseStyles;
  }

  const themed: Record<string, unknown> = {};

  for (const key of Object.keys(baseStyles)) {
    const style = baseStyles[key as keyof typeof baseStyles];

    themed[key] = [
      style,
      buildDarkStyleOverride(style),
    ];
  }

  return themed as unknown as typeof baseStyles;
}

function useThemedStyles() {
  const theme = React.useContext(OriaThemeContext);

  return useMemo(
    () => getThemedStyles(theme),
    [theme],
  );
}

function useIsDarkTheme() {
  return React.useContext(OriaThemeContext) === "dark";
}

function themedIconColor(value: string, isDark: boolean) {
  return isDark
    ? darkThemeNeutral(value, "color")
    : value;
}








const UI = {



  fr: {



    getCredits: "Obtenir des crédits",



    consumption: "VOTRE CONSOMMATION",



    myCredits: "Mes crédits",



    description:



      "Suivez votre solde et le coût réel de chaque utilisation. Oria réserve une estimation avant l’action, puis ne débite que le coût réellement consommé.",



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



    packExpiredDescription:
      "Ce pack a expiré. Les crédits restants ne sont plus utilisables, mais vos conversations et vos créations restent accessibles.",



    yourPack: "Votre pack",



    packUsageUntil:



      "Vos crédits restent utilisables jusqu'à la date d'expiration de votre pack.",



    remainingDay: "jour restant",



    remainingDays: "jours restants",



    expiresOn: "Expire le",



    viewPacks: "Voir les packs",



    creditsConsumed: "Crédits réellement consommés",



    sincePackStart: "Depuis le début du pack",



    operations: "Opérations",



    actionsPerformed: "Actions effectuées",



    creditsPurchased: "Crédits achetés",



    packsAndTopups: "Packs et recharges",



    history: "Historique",



    historyDescription:



      "Les dernières opérations et les coûts réellement débités de votre portefeuille.",



    noHistory: "Aucun historique",



    operationsAppearHere: "Vos opérations apparaîtront ici.",



    noPack: "Aucun pack",



    unknownPack: "Pack inconnu",



    packPurchase: "Achat de pack",



    creditUsage: "Utilisation de crédits",



    creditTopup: "Recharge de crédits",



    refund: "Remboursement",



    adjustment: "Ajustement de crédits",



    usage: "Coût réel",



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



      "Track your balance and the actual cost of each use. Oria reserves an estimate before an action, then charges only the amount actually consumed.",



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



    packExpiredDescription:
      "This pack has expired. Remaining credits can no longer be used, but your conversations and creations remain accessible.",



    yourPack: "Your pack",



    packUsageUntil:



      "Your credits remain usable until your pack's expiration date.",



    remainingDay: "day remaining",



    remainingDays: "days remaining",



    expiresOn: "Expires on",



    viewPacks: "View packs",



    creditsConsumed: "Credits actually used",



    sincePackStart: "Since the start of the pack",



    operations: "Operations",



    actionsPerformed: "Actions performed",



    creditsPurchased: "Credits purchased",



    packsAndTopups: "Packs and top-ups",



    history: "History",



    historyDescription:



      "Your latest transactions and the actual amounts charged to your wallet.",



    noHistory: "No history",



    operationsAppearHere: "Your transactions will appear here.",



    noPack: "No pack",



    unknownPack: "Unknown pack",



    packPurchase: "Pack purchase",



    creditUsage: "Credit usage",



    creditTopup: "Credit top-up",



    refund: "Refund",



    adjustment: "Credit adjustment",



    usage: "Actual cost",



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











function localizeFrontendError(
  message: string,
  language: OriaLanguage,
): string {
  if (language === "fr") return message;

  const exact: Record<string, string> = {
    "Utilisateur non authentifié.": "User not authenticated.",
    "Session expirée ou authentification invalide.":
      "Session expired or authentication is invalid.",
    "Une erreur est survenue avec le serveur.": "A server error occurred.",
    "Impossible de charger les crédits.": UI.en.creditsLoadError,
  };

  return exact[message] ?? message;
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



    image_480:

      language === "en"

        ? "Essential image · GPT Image 2"

        : "Image Essentielle · GPT Image 2",

    image_720:

      language === "en"

        ? "Image Plus · GPT Image 2"

        : "Image Plus · GPT Image 2",

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



    video_4s:

      language === "en" ? "Video 4s · Sora 2" : "Vidéo 4 s · Sora 2",

    video_8s:

      language === "en" ? "Video 8s · Sora 2" : "Vidéo 8 s · Sora 2",

    video_lite:

      language === "en" ? "Lite video · Sora 2" : "Vidéo Lite · Sora 2",

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
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();



  return (



    <View style={styles.statCard}>



      <View style={styles.statIcon}>



        <Ionicons name={icon} size={18} color={themedIconColor("#55555f", isDark)} />



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
  const styles = useThemedStyles();
  const isDark = useIsDarkTheme();

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



          color={themedIconColor("#62626b", isDark)}



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
  const [theme, setTheme] = useState<OriaTheme>("light");
  const isDark = theme === "dark";
  const styles = useMemo(
    () => getThemedStyles(theme),
    [theme],
  );



  const t = UI[language];







  useFocusEffect(



    useCallback(() => {



      let active = true;







      void Promise.all([
        readOriaLanguage(),
        readOriaTheme(),
      ]).then(([savedLanguage, savedTheme]) => {
        if (active) {
          setLanguage(savedLanguage);
          setTheme(savedTheme);
        }
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



          : t.loadFallback



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



    return Math.max(0, wallet.consumed_credits);



  }, [wallet]);







  const usagePercentage = useMemo(() => {



    if (!wallet) return 0;



    return Math.max(



      0,



      Math.min(100, Math.round(wallet.consumed_percentage))



    );



  }, [wallet]);







  const remainingDays = useMemo(



    () => getRemainingDays(wallet?.pack_expires_at || null),



    [wallet]



  );







  const packName = getPackName(wallet?.pack_id || null, language);







  const isPackActive = wallet?.is_pack_active ?? false;



  // Même règle que le Web : un pack expiré/inactif affiche 0 crédit
  // sans modifier le solde historique conservé côté backend.
  const availableBalance =
    isPackActive && wallet
      ? wallet.balance
      : 0;







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
    <OriaThemeContext.Provider value={theme}>



    <SafeAreaView style={styles.safeArea}>



      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />







      <View style={styles.header}>



        <View style={styles.headerLeft}>



          <Pressable



            style={styles.backButton}



            onPress={() => router.push("/chat" as any)}



            hitSlop={8}



          >



            <Ionicons name="arrow-back" size={20} color={themedIconColor("#4f4f58", isDark)} />



          </Pressable>







          <View style={styles.brandIcon}>



            <Ionicons name="sparkles" size={15} color={themedIconColor("#15151a", isDark)} />



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



            tintColor={themedIconColor("#111114", isDark)}



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



            <ActivityIndicator color={themedIconColor("#111114", isDark)} />



            <Text style={styles.loadingText}>



              {t.loadingWallet}



            </Text>



          </View>



        ) : error ? (



          <View style={styles.errorBox}>



            <Ionicons



              name="alert-circle-outline"



              size={22}



              color={themedIconColor("#62626b", isDark)}



            />



            <Text style={styles.errorTitle}>



              {t.creditsLoadError}



            </Text>



            <Text style={styles.errorText}>{localizeFrontendError(error, language)}</Text>



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



                      {formatCredits(availableBalance, language)}



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



                    {isPackActive ? (
                      <>
                        {remainingDays}{" "}
                        {remainingDays === 1
                          ? language === "en" ? "day" : "jour"
                          : language === "en" ? "days" : "jours"}
                      </>
                    ) : (
                      t.expired
                    )}



                  </Text>



                </View>



              </View>



            </View>







            <View style={styles.packStatusCard}>



              <View style={styles.packStatusTop}>



                <View style={styles.calendarIcon}>



                  <Ionicons name="calendar-outline" size={20} color={themedIconColor("#5d5d66", isDark)} />



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
                {isPackActive
                  ? t.packUsageUntil
                  : t.packExpiredDescription}
              </Text>







              <View style={styles.packDetails}>



                <View style={styles.detailRow}>



                  <Ionicons name="time-outline" size={16} color={themedIconColor("#66666f", isDark)} />



                  <Text style={styles.detailText}>



                    {isPackActive ? (
                      <>
                        {remainingDays}{" "}
                        {remainingDays === 1 ? t.remainingDay : t.remainingDays}
                      </>
                    ) : (
                      t.expired
                    )}



                  </Text>



                </View>







                <View style={styles.detailRow}>



                  <Ionicons



                    name="calendar-outline"



                    size={16}



                    color={themedIconColor("#66666f", isDark)}



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



                <Ionicons name="arrow-forward" size={15} color={themedIconColor("#202025", isDark)} />



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



                  <Ionicons name="time-outline" size={18} color={themedIconColor("#4f4f58", isDark)} />



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



                      color={themedIconColor("#888891", isDark)}



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



    </OriaThemeContext.Provider>
  );



}







const baseStyles = StyleSheet.create({



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