/**
 * ORIA Mobile — language de design monochrome.
 * Couleurs strictement neutres, surfaces semi-transparentes, rayons consistants.
 * N'altère ni la logique métier, ni les états, ni les appels réseau.
 * Expo / React Native : aucune dépendance supplémentaire.
 */
import type { ViewStyle, TextStyle, ImageStyle } from "react-native";

type Screen = "home" | "creations" | "packs" | "register" | "settings";
type Patch = ViewStyle & TextStyle & ImageStyle;
type Overrides = Record<string, Partial<Patch>>;

export const ORIA = {
  black: "#000000",
  white: "#ffffff",
  ink: "#111111",
  muted: "#747474",
  line: "#e9e9e9",
  paper: "#ffffff",
  soft: "#f6f6f6",
  darkSurface: "#121212",
  darkRaised: "#1a1a1a",
  darkLine: "rgba(255,255,255,0.12)",
  glass: "rgba(255,255,255,0.07)",
  glassLight: "rgba(255,255,255,0.86)",
} as const;

const shadowLight: Partial<Patch> = {
  shadowColor: "#000000", shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.06, shadowRadius: 24, elevation: 2,
};
const shadowDark: Partial<Patch> = {
  shadowColor: "#000000", shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.15, shadowRadius: 16, elevation: 0,
};

function sharedCard(dark: boolean): Partial<Patch> {
  return {
    backgroundColor: dark ? ORIA.darkSurface : ORIA.paper,
    borderColor: dark ? ORIA.darkLine : ORIA.line,
    borderWidth: 1,
    borderRadius: 24,
    ...(dark ? shadowDark : shadowLight),
  };
}
function secondary(dark: boolean): Partial<Patch> {
  return {
    backgroundColor: dark ? "rgba(255,255,255,0.065)" : ORIA.soft,
    borderColor: dark ? ORIA.darkLine : ORIA.line,
  };
}

function overrides(screen: Screen, dark: boolean): Overrides {
  const headline = dark ? ORIA.white : ORIA.ink;
  const detail = dark ? "#a4a4a4" : "#696969";
  const card = sharedCard(dark);
  const border = dark ? ORIA.darkLine : ORIA.line;
  const fill = dark ? ORIA.darkSurface : ORIA.white;
  switch (screen) {
    case "home":
      return {
        main: { backgroundColor: ORIA.black },
        scrollView: { backgroundColor: ORIA.black },
        bottomSafeArea: { backgroundColor: ORIA.black },
        navigationSafeArea: { backgroundColor: ORIA.black },
        nav: { backgroundColor: "rgba(0,0,0,0.95)", borderBottomColor: ORIA.darkLine, paddingHorizontal: 20 },
        brandIcon: { backgroundColor: ORIA.white, borderColor: ORIA.white, borderRadius: 13 },
        brandIconText: { color: ORIA.black },
        brandText: { color: ORIA.white, fontWeight: "800" },
        loginButton: { backgroundColor: ORIA.glass, borderColor: ORIA.darkLine, borderRadius: 14 },
        loginButtonText: { color: ORIA.white },
        startButton: { backgroundColor: ORIA.white, borderColor: ORIA.white, borderRadius: 14 },
        startButtonText: { color: ORIA.black, fontWeight: "800" },
        heroSection: { minHeight: 0, backgroundColor: ORIA.black, paddingTop: 64, paddingBottom: 78 },
        circleLeft: { borderColor: "rgba(255,255,255,0.13)", opacity: 0.55 },
        circleRight: { borderColor: "rgba(255,255,255,0.11)", opacity: 0.55 },
        diamondLeft: { borderColor: "rgba(255,255,255,0.12)", opacity: 0.3 },
        roundedSquareRight: { borderColor: "rgba(255,255,255,0.14)", opacity: 0.3 },
        cornerBottomLeft: { borderColor: "rgba(255,255,255,0.08)" },
        cornerBottomRight: { borderColor: "rgba(255,255,255,0.08)" },
        horizontalLine: { backgroundColor: "rgba(255,255,255,0.07)" },
        verticalLine: { backgroundColor: "rgba(255,255,255,0.07)" },
        badge: { backgroundColor: "rgba(255,255,255,0.075)", borderColor: ORIA.darkLine, marginBottom: 26 },
        badgeText: { color: "#d0d0d0", fontSize: 12, fontWeight: "600", letterSpacing: 0.2 },
        badgeDot: { backgroundColor: ORIA.white },
        heroTitle: { color: ORIA.white, fontSize: 43, lineHeight: 51, fontWeight: "800", letterSpacing: -1.9 },
        heroTitleUnderlineContainer: { color: ORIA.white },
        titleUnderline: { backgroundColor: ORIA.white, width: 48, height: 3, marginTop: 15 },
        heroDescription: { color: "#b0b0b0", fontSize: 15, lineHeight: 25, marginTop: 26 },
        heroButtons: { marginTop: 31 },
        primaryHeroButton: { backgroundColor: ORIA.white, minHeight: 54, borderRadius: 17 },
        primaryHeroButtonText: { color: ORIA.black, fontWeight: "800" },
        secondaryHeroButton: { backgroundColor: "rgba(255,255,255,0.065)", borderColor: ORIA.darkLine, minHeight: 54, borderRadius: 17 },
        secondaryHeroButtonText: { color: ORIA.white, fontWeight: "700" },
        separatorLine: { backgroundColor: ORIA.darkLine },
        technologyText: { color: "#898989", letterSpacing: 1.35, fontSize: 10 },
        featuresContainer: { marginTop: 50, gap: 12 },
        featureCard: { backgroundColor: "rgba(255,255,255,0.045)", borderColor: ORIA.darkLine, borderWidth: 1, borderRadius: 24, minHeight: 175, padding: 22 },
        featureNumber: { color: "#8c8c8c" },
        featureDiamond: { borderColor: "rgba(255,255,255,0.24)" },
        featureTitle: { color: ORIA.white, fontWeight: "800" },
        featureDescription: { color: "#a6a6a6", lineHeight: 23 },
        creditsContainer: { marginTop: 38 },
        creditsCard: { backgroundColor: ORIA.white, borderRadius: 28, borderWidth: 0, overflow: "hidden" },
        creditsDecoration: { borderColor: "rgba(0,0,0,0.07)" },
        creditsEyebrow: { color: "#696969" },
        creditsTitle: { color: ORIA.black, fontWeight: "800" },
        creditsDescription: { color: "#585858" },
        finalDescription: { color: "#959595" },
      };
    case "creations":
      return {
        safeArea: { backgroundColor: dark ? ORIA.black : ORIA.white },
        container: { paddingTop: 22, paddingBottom: 68 },
        title: { color: headline, fontSize: 31, fontWeight: "800", letterSpacing: -1.1 },
        eyebrow: { color: detail }, description: { color: detail, fontSize: 14, lineHeight: 22 },
        logo: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 16 },
        logoText: { color: dark ? ORIA.black : ORIA.white },
        refreshButton: { ...secondary(dark), borderRadius: 15, minHeight: 44 },
        refreshText: { color: headline }, backText: { color: detail },
        statDark: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 14 },
        statDarkText: { color: dark ? ORIA.black : ORIA.white },
        statLight: { ...secondary(dark), borderRadius: 14 },
        statLightText: { color: detail },
        filterButton: { ...secondary(dark), borderRadius: 14, minHeight: 42, justifyContent: "center" },
        filterActive: { backgroundColor: dark ? ORIA.white : ORIA.black, borderColor: dark ? ORIA.white : ORIA.black },
        filterText: { color: detail }, filterTextActive: { color: dark ? ORIA.black : ORIA.white },
        countActive: { color: dark ? "#555555" : "#cccccc" },
        card, fileCard: card,
        preview: { backgroundColor: dark ? "#202020" : "#f0f0f0" },
        cardBody: { padding: 16 }, prompt: { color: headline },
        date: { color: detail }, cardFooter: { borderTopColor: border },
        metaPill: { ...secondary(dark), borderRadius: 9 }, metaText: { color: detail },
        actionButton: { ...secondary(dark), borderRadius: 11, minHeight: 38, minWidth: 38 },
        fileIcon: { backgroundColor: dark ? "#252525" : "#f1f1f1", borderRadius: 18 },
        fileName: { color: headline }, fileActions: { borderTopColor: border },
        loadingBox: { minHeight: 270, backgroundColor: "transparent" },
        loadingText: { color: detail },
        emptyBox: { ...card, padding: 28 }, emptyTitle: { color: headline },
        emptyDescription: { color: detail },
        createButton: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 16, minHeight: 48 },
        createButtonText: { color: dark ? ORIA.black : ORIA.white },
        filterEmpty: card, filterEmptyText: { color: detail },
        modalBackdrop: { backgroundColor: "rgba(0,0,0,0.88)" },
        modalCard: { backgroundColor: dark ? ORIA.darkSurface : ORIA.white, borderRadius: 26 },
        modalHeader: { borderBottomColor: border }, modalTitle: { color: headline },
        modalDate: { color: detail }, modalPrompt: { color: detail },
        artifactModalSafe: { backgroundColor: dark ? ORIA.black : "#ededed" },
        artifactModalHeader: { backgroundColor: dark ? ORIA.darkSurface : ORIA.white, borderBottomColor: border, paddingVertical: 14 },
        artifactModalTitle: { color: headline, fontSize: 16 },
        artifactModalLabel: { color: detail, textTransform: "uppercase", letterSpacing: 1.2 },
        artifactModalAction: { backgroundColor: dark ? "#232323" : "#f3f3f3", borderRadius: 13, marginLeft: 8 },
        artifactModalMessage: { color: detail, lineHeight: 23 },
        artifactPrimaryButton: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 15, minHeight: 50, justifyContent: "center" },
        artifactPrimaryButtonText: { color: dark ? ORIA.black : ORIA.white },
        // White paper inside dark UI: readability and fidelity for DOCX/XLSX/text.
        artifactTextPage: { backgroundColor: ORIA.white, paddingHorizontal: 26, paddingTop: 34 },
        artifactDocumentPage: { backgroundColor: ORIA.white, borderRadius: 10, marginHorizontal: 14, marginVertical: 18, padding: 24, minHeight: 400, ...shadowLight },
        artifactText: { color: ORIA.ink, lineHeight: 23 },
        artifactParagraph: { color: ORIA.ink, lineHeight: 25 },
        artifactHeading: { color: ORIA.black },
        artifactTableCell: { borderColor: "#dddddd", backgroundColor: ORIA.white },
        artifactTableText: { color: ORIA.ink },
        artifactMuted: { color: "#777777" },
      };
    case "packs":
      return {
        safeArea: { backgroundColor: dark ? ORIA.black : ORIA.white },
        container: { backgroundColor: dark ? ORIA.black : ORIA.white },
        content: { paddingBottom: 80 },
        header: { borderBottomColor: border, backgroundColor: dark ? ORIA.black : ORIA.white },
        headerIconButton: { ...secondary(dark), borderRadius: 14 },
        brandText: { color: headline, fontWeight: "800" },
        creditsButton: { ...secondary(dark), borderRadius: 14 },
        creditsButtonText: { color: headline },
        heroEyebrow: { color: detail, letterSpacing: 1.4 },
        heroTitle: { color: headline, fontWeight: "800", letterSpacing: -1.25 },
        heroDescription: { color: detail, lineHeight: 23 },
        packTabs: { ...secondary(dark), borderRadius: 19, padding: 5 },
        packTab: { borderRadius: 15 },
        packTabActive: { backgroundColor: dark ? ORIA.white : ORIA.black },
        packTabTextActive: { color: dark ? ORIA.black : ORIA.white },
        launchBanner: { ...secondary(dark), borderRadius: 20, padding: 17 },
        launchBannerTitle: { color: headline }, launchBannerText: { color: detail },
        packCard: { ...card, borderRadius: 27, overflow: "hidden" },
        packCardPopular: { backgroundColor: dark ? "#191919" : "#111111", borderColor: dark ? "#686868" : "#111111", borderWidth: 1 },
        popularBadge: { backgroundColor: ORIA.white, borderRadius: 12 },
        popularBadgeText: { color: ORIA.black },
        packName: { fontWeight: "800", letterSpacing: -0.5 },
        packPurchaseButton: { minHeight: 49, borderRadius: 15 },
        packPurchaseButtonPopular: { backgroundColor: ORIA.white },
        topUpSection: { ...card, padding: 20, gap: 16 },
        sectionTitle: { color: headline }, sectionDescription: { color: detail },
        secondaryTabButton: { ...secondary(dark), borderRadius: 15 },
        secondaryTabButtonText: { color: headline },
        primaryButton: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 15, minHeight: 50 },
        primaryButtonText: { color: dark ? ORIA.black : ORIA.white },
        stepCard: card, modelComparisonCard: card, faqItem: card,
        topUpModal: { ...card, borderRadius: 28 }, modalBackdrop: { backgroundColor: dark ? ORIA.darkSurface : ORIA.white },
        modalOverlay: { backgroundColor: "rgba(0,0,0,0.72)" },
        modalTitle: { color: headline }, modalDescription: { color: detail },
        topUpOption: { ...secondary(dark), borderRadius: 16 },
        smallPrimaryButton: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 13 },
        smallPrimaryButtonText: { color: dark ? ORIA.black : ORIA.white },
        faqAnswer: { color: detail },
      };
    case "register":
      return {
        safeArea: { backgroundColor: dark ? ORIA.black : ORIA.white },
        scrollContent: { paddingBottom: 64 },
        brandText: { color: headline, fontWeight: "800" },
        registerArea: { paddingHorizontal: 16 },
        card: { ...card, borderRadius: 30, padding: 24 },
        title: { color: headline, fontWeight: "800", letterSpacing: -1.0 },
        description: { color: detail, lineHeight: 23 },
        introIcon: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 18 },
        label: { color: headline },
        input: { backgroundColor: dark ? "#1b1b1b" : ORIA.soft, borderColor: border, borderRadius: 15, minHeight: 51, color: headline },
        selectButton: { backgroundColor: dark ? "#1b1b1b" : ORIA.soft, borderColor: border, borderRadius: 15, minHeight: 51 },
        selectText: { color: headline },
        countryCodeBox: { backgroundColor: dark ? "#242424" : "#ededed", borderColor: border },
        helperText: { color: detail },
        submitButton: { backgroundColor: dark ? ORIA.white : ORIA.black, borderRadius: 16, minHeight: 54 },
        submitText: { color: dark ? ORIA.black : ORIA.white, fontWeight: "800" },
        googleButton: { ...secondary(dark), borderRadius: 16, minHeight: 53 },
        googleText: { color: headline },
        countryModal: { backgroundColor: dark ? ORIA.darkSurface : ORIA.white, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
        modalClose: { ...secondary(dark), borderRadius: 13 },
        countryItemSelected: { backgroundColor: dark ? "#292929" : "#f1f1f1" },
        countryName: { color: headline },
      };
    case "settings":
      return {
        page: { backgroundColor: ORIA.white }, pageDark: { backgroundColor: ORIA.black },
        header: { backgroundColor: "rgba(255,255,255,0.95)", borderBottomColor: ORIA.line },
        headerDark: { backgroundColor: ORIA.black, borderBottomColor: ORIA.darkLine },
        headerBackButton: { backgroundColor: ORIA.soft, borderRadius: 13 },
        headerCreditsButton: { backgroundColor: ORIA.soft, borderColor: ORIA.line, borderRadius: 13 },
        content: { paddingTop: 28, paddingBottom: 90 },
        pageTitle: { fontWeight: "800", letterSpacing: -1.2 },
        loadingCard: { ...card, borderRadius: 21 },
        settingsSection: { ...card, borderRadius: 25, overflow: "hidden", marginTop: 17 },
        settingsSectionDark: { ...sharedCard(true), borderRadius: 25 },
        sectionHeader: { backgroundColor: ORIA.white, borderBottomColor: ORIA.line, paddingVertical: 18 },
        sectionHeaderDark: { backgroundColor: ORIA.darkSurface, borderBottomColor: ORIA.darkLine },
        sectionBody: { backgroundColor: ORIA.white }, sectionBodyDark: { backgroundColor: ORIA.darkSurface },
        iconBox: { backgroundColor: "#f3f3f3", borderRadius: 13 },
        iconBoxDark: { backgroundColor: "#282828" },
        settingsActionRow: { borderBottomColor: ORIA.line, minHeight: 72 },
        settingsPreferenceRow: { borderBottomColor: ORIA.line, minHeight: 72 },
        settingsNavigationRow: { borderBottomColor: ORIA.line, minHeight: 72 },
        settingsPreferenceRowDark: { borderBottomColor: ORIA.darkLine },
        settingsNavigationRowDark: { borderBottomColor: ORIA.darkLine },
        textInput: { backgroundColor: ORIA.soft, borderColor: ORIA.line, borderRadius: 15, minHeight: 50 },
        textInputDark: { backgroundColor: "#1e1e1e", borderColor: ORIA.darkLine },
        selectButton: { backgroundColor: ORIA.soft, borderColor: ORIA.line, borderRadius: 15 },
        selectButtonDark: { backgroundColor: "#222222", borderColor: ORIA.darkLine },
        primaryAction: { backgroundColor: ORIA.black, borderRadius: 15, minHeight: 47 },
        primaryActionDark: { backgroundColor: ORIA.white },
        secondaryAction: { backgroundColor: ORIA.soft, borderRadius: 15 },
        secondaryActionDark: { backgroundColor: "#272727" },
        languageModal: { backgroundColor: ORIA.white, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
        languageModalDark: { backgroundColor: ORIA.darkSurface },
        languageOption: { borderRadius: 15 }, languageOptionDark: { backgroundColor: ORIA.darkSurface },
        languageOptionSelected: { backgroundColor: ORIA.soft },
      };
  }
}

export function polishOriaStyles<T extends Record<string, any>>(
  base: T, screen: Screen, dark: boolean,
): T {
  const map = overrides(screen, dark);
  const entries = Object.keys(base).map((key) => {
    const extra = map[key];
    return [key, extra ? [base[key], extra] : base[key]];
  });
  return Object.fromEntries(entries) as T;
}
