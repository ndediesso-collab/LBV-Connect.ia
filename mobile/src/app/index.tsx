import { Link } from "expo-router";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Home() {
  return (
    <View style={styles.main}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ============================================================
            NAVIGATION
            ============================================================ */}

        <SafeAreaView edges={["top"]} style={styles.navigationSafeArea}>
          <View style={styles.nav}>
            <Link href="/" asChild>
              <Pressable style={styles.brandContainer}>
                <View style={styles.brandIcon}>
                  <Text style={styles.brandIconText}>N</Text>
                </View>

                <Text style={styles.brandText}>Oria</Text>
              </Pressable>
            </Link>

            <View style={styles.navActions}>
              <Link href={"/login" as any}  asChild>
                <Pressable
                  style={({ pressed }) => [
                    styles.loginButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.loginButtonText}>Connexion</Text>
                </Pressable>
              </Link>

              <Link href={"/packs" as any} asChild>
                <Pressable
                  style={({ pressed }) => [
                    styles.startButton,
                    pressed && styles.startButtonPressed,
                  ]}
                >
                  <Text style={styles.startButtonText}>Commencer</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </SafeAreaView>

        {/* ============================================================
            HERO SECTION
            ============================================================ */}

        <View style={styles.heroSection}>
          {/* ==========================================================
              BACKGROUND DECORATIONS
              ========================================================== */}

          <View
            pointerEvents="none"
            style={styles.backgroundDecorations}
          >
            {/* Grand cercle gauche */}
            <View style={styles.circleLeft} />

            {/* Grand cercle droit */}
            <View style={styles.circleRight} />

            {/* Carré incliné gauche */}
            <View style={styles.diamondLeft} />

            {/* Carré arrondi droit */}
            <View style={styles.roundedSquareRight} />

            {/* Forme en L bas gauche */}
            <View style={styles.cornerBottomLeft} />

            {/* Forme en L bas droite */}
            <View style={styles.cornerBottomRight} />

            {/* Ligne horizontale */}
            <View style={styles.horizontalLine} />

            {/* Ligne verticale centrale */}
            <View style={styles.verticalLine} />
          </View>

          {/* ==========================================================
              MAIN CONTENT
              ========================================================== */}

          <View style={styles.contentContainer}>
            {/* ========================================================
                HERO INTRO
                ======================================================== */}

            <View style={styles.heroContent}>
              {/* Badge */}
              <View style={styles.badge}>
                <View style={styles.badgeDot} />

                <Text style={styles.badgeText}>
                  Une intelligence pensée depuis l&apos;Afrique
                </Text>
              </View>

              {/* Titre principal */}
              <Text style={styles.heroTitle}>
                L&apos;IA pour
                {"\n"}
                <Text style={styles.heroTitleUnderlineContainer}>
                  comprendre, créer et avancer.
                </Text>
              </Text>

              {/* Trait sous le titre */}
              <View style={styles.titleUnderline} />

              {/* Description */}
              <Text style={styles.heroDescription}>
                Oria réunit plusieurs modèles d&apos;intelligence artificielle
                dans un seul espace pour discuter, raisonner, rechercher sur
                le Web, analyser vos fichiers et créer des images ou des
                vidéos.
              </Text>

              {/* Boutons */}
              <View style={styles.heroButtons}>
                <Link href={"/packs" as any} asChild>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryHeroButton,
                      pressed && styles.primaryHeroButtonPressed,
                    ]}
                  >
                    <Text style={styles.primaryHeroButtonText}>
                      Découvrir Oria
                    </Text>
                  </Pressable>
                </Link>

                <Link href={"/login" as any} asChild>
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryHeroButton,
                      pressed && styles.secondaryHeroButtonPressed,
                    ]}
                  >
                    <Text style={styles.secondaryHeroButtonText}>
                      Se connecter
                    </Text>
                  </Pressable>
                </Link>
              </View>

              {/* Séparateur */}
              <View style={styles.technologySeparator}>
                <View style={styles.separatorLine} />

                <Text style={styles.technologyText}>
                  Technologie · Créativité · Afrique
                </Text>

                <View style={styles.separatorLine} />
              </View>
            </View>

            {/* ========================================================
                FEATURES
                ======================================================== */}

            <View style={styles.featuresContainer}>
              <Feature
                number="01"
                title="Chat multi-IA"
                description="Discutez avec plusieurs modèles depuis une interface unique et choisissez la puissance adaptée à votre besoin."
              />

              <Feature
                number="02"
                title="Recherche Web"
                description="Explorez des informations disponibles sur le Web directement depuis votre espace de travail."
              />

              <Feature
                number="03"
                title="Raisonnement"
                description="Travaillez sur des problèmes complexes avec des modèles conçus pour l’analyse et la réflexion avancées."
              />

              <Feature
                number="04"
                title="Analyse de fichiers"
                description="Importez vos documents et utilisez l’IA pour comprendre, extraire et exploiter leur contenu."
              />

              <Feature
                number="05"
                title="Création d’images"
                description="Transformez vos idées en visuels générés par l’IA à partir de simples descriptions."
              />

              <Feature
                number="06"
                title="Création de vidéos"
                description="Donnez vie à vos concepts grâce aux capacités vidéo disponibles dans votre pack."
              />
            </View>

            {/* ========================================================
                CREDITS SECTION
                ======================================================== */}

            <View style={styles.creditsContainer}>
              <View style={styles.creditsCard}>
                {/* Décoration */}
                <View
                  pointerEvents="none"
                  style={styles.creditsDecoration}
                />

                <View style={styles.creditsContent}>
                  <Text style={styles.creditsEyebrow}>
                    Maîtrisez votre utilisation
                  </Text>

                  <Text style={styles.creditsTitle}>
                    Un système de crédits simple et transparent.
                  </Text>

                  <Text style={styles.creditsDescription}>
                    Chaque opération consomme un nombre de crédits adapté à
                    la capacité utilisée. Vous gardez le contrôle de votre
                    utilisation depuis votre espace.
                  </Text>
                </View>
              </View>
            </View>

            {/* ========================================================
                FINAL DESCRIPTION
                ======================================================== */}

            <View style={styles.finalDescriptionContainer}>
              <Text style={styles.finalDescription}>
                Une plateforme d&apos;intelligence artificielle conçue pour
                simplifier l&apos;accès à des outils puissants, sans
                multiplier les services et les interfaces.
              </Text>
            </View>
          </View>
        </View>

        {/* ============================================================
            BOTTOM SAFE AREA
            ============================================================ */}

        <SafeAreaView edges={["bottom"]} style={styles.bottomSafeArea} />
      </ScrollView>
    </View>
  );
}

/* =====================================================================
   FEATURE COMPONENT
   ===================================================================== */

function Feature({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.featureCard,
        pressed && styles.featureCardPressed,
      ]}
    >
      <View style={styles.featureHeader}>
        <Text style={styles.featureNumber}>{number}</Text>

        <View style={styles.featureDiamond} />
      </View>

      <Text style={styles.featureTitle}>{title}</Text>

      <Text style={styles.featureDescription}>{description}</Text>
    </Pressable>
  );
}

/* =====================================================================
   STYLES
   ===================================================================== */

const styles = StyleSheet.create({
  /* ===================================================================
     MAIN
     =================================================================== */

  main: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  scrollView: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  scrollContent: {
    flexGrow: 1,
  },

  navigationSafeArea: {
    backgroundColor: "rgba(255,255,255,0.96)",
  },

  bottomSafeArea: {
    backgroundColor: "#FFFFFF",
  },

  /* ===================================================================
     NAVIGATION
     =================================================================== */

  nav: {
    minHeight: 73,
    width: "100%",
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
    backgroundColor: "rgba(255,255,255,0.94)",
  },

  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  brandIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F5F5F5",
  },

  brandIconText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111111",
  },

  brandText: {
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: "#111111",
  },

  navActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  loginButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
  },

  loginButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666666",
  },

  startButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#111111",
  },

  startButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
  },

  buttonPressed: {
    opacity: 0.7,
  },

  startButtonPressed: {
    opacity: 0.85,
    transform: [{ translateY: 1 }],
  },

  /* ===================================================================
     HERO
     =================================================================== */

  heroSection: {
    position: "relative",
    width: "100%",
    minHeight: Platform.OS === "web" ? 700 : 760,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 64,
    alignItems: "center",
    overflow: "hidden",
  },

  backgroundDecorations: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },

  /* ===================================================================
     BACKGROUND SHAPES
     =================================================================== */

  circleLeft: {
    position: "absolute",
    width: 384,
    height: 384,
    borderRadius: 192,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.6,
    left: -96,
    top: 80,
  },

  circleRight: {
    position: "absolute",
    width: 480,
    height: 480,
    borderRadius: 240,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.6,
    right: -112,
    top: 40,
  },

  diamondLeft: {
    position: "absolute",
    width: 128,
    height: 128,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.4,
    left: "8%",
    top: "14%",
    transform: [{ rotate: "45deg" }],
  },

  roundedSquareRight: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.4,
    right: "12%",
    top: "18%",
    transform: [{ rotate: "-12deg" }],
  },

  cornerBottomLeft: {
    position: "absolute",
    width: 160,
    height: 160,
    left: "16%",
    bottom: "9%",
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.5,
  },

  cornerBottomRight: {
    position: "absolute",
    width: 128,
    height: 128,
    right: "14%",
    bottom: "12%",
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderColor: "rgba(0,0,0,0.10)",
    opacity: 0.5,
  },

  horizontalLine: {
    position: "absolute",
    left: "5%",
    right: "5%",
    top: "21%",
    height: 1,
    backgroundColor: "rgba(0,0,0,0.10)",
    opacity: 0.5,
  },

  verticalLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 1,
    backgroundColor: "rgba(0,0,0,0.10)",
    opacity: 0.25,
  },

  /* ===================================================================
     CONTENT CONTAINER
     =================================================================== */

  contentContainer: {
    position: "relative",
    zIndex: 10,
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
  },

  /* ===================================================================
     HERO CONTENT
     =================================================================== */

  heroContent: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    alignItems: "center",
  },

  /* ===================================================================
     BADGE
     =================================================================== */

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "rgba(250,250,250,0.9)",
    marginBottom: 28,
  },

  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#111111",
  },

  badgeText: {
    fontSize: 14,
    color: "#666666",
  },

  /* ===================================================================
     HERO TITLE
     =================================================================== */

  heroTitle: {
    width: "100%",
    textAlign: "center",
    fontSize: 48,
    lineHeight: 56,
    fontWeight: "600",
    letterSpacing: -1.5,
    color: "#111111",
  },

  heroTitleUnderlineContainer: {
    position: "relative",
  },

  titleUnderline: {
    width: 80,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(17,17,17,0.8)",
    marginTop: 8,
  },

  /* ===================================================================
     HERO DESCRIPTION
     =================================================================== */

  heroDescription: {
    width: "100%",
    maxWidth: 760,
    marginTop: 32,
    textAlign: "center",
    fontSize: 17,
    lineHeight: 30,
    color: "#666666",
  },

  /* ===================================================================
     HERO BUTTONS
     =================================================================== */

  heroButtons: {
    width: "100%",
    marginTop: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },

  primaryHeroButton: {
    minWidth: 160,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
  },

  primaryHeroButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
  },

  primaryHeroButtonPressed: {
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },

  secondaryHeroButton: {
    minWidth: 160,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },

  secondaryHeroButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111111",
  },

  secondaryHeroButtonPressed: {
    backgroundColor: "#F5F5F5",
  },

  /* ===================================================================
     TECHNOLOGY SEPARATOR
     =================================================================== */

  technologySeparator: {
    width: "100%",
    maxWidth: 700,
    marginTop: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },

  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E5E5E5",
  },

  technologyText: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: "#999999",
    textAlign: "center",
  },

  /* ===================================================================
     FEATURES
     =================================================================== */

  featuresContainer: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    marginTop: 64,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
  },

  featureCard: {
    width: Platform.OS === "web" ? "32%" : "100%",
    minHeight: 210,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#FFFFFF",
  },

  featureCardPressed: {
    backgroundColor: "#F7F7F7",
    transform: [{ translateY: -1 }],
  },

  featureHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  featureNumber: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 2,
    color: "#999999",
  },

  featureDiamond: {
    width: 12,
    height: 12,
    borderWidth: 1,
    borderColor: "#999999",
    transform: [{ rotate: "45deg" }],
  },

  featureTitle: {
    marginTop: 36,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: "#111111",
  },

  featureDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 24,
    color: "#666666",
  },

  /* ===================================================================
     CREDITS
     =================================================================== */

  creditsContainer: {
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
    marginTop: 16,
  },

  creditsCard: {
    position: "relative",
    width: "100%",
    minHeight: 190,
    overflow: "hidden",
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F5F5F5",
  },

  creditsDecoration: {
    position: "absolute",
    width: 128,
    height: 128,
    right: -32,
    top: -32,
    borderWidth: 1,
    borderColor: "#D5D5D5",
    opacity: 0.4,
    transform: [{ rotate: "45deg" }],
  },

  creditsContent: {
    position: "relative",
    zIndex: 2,
    maxWidth: 760,
  },

  creditsEyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#999999",
  },

  creditsTitle: {
    marginTop: 8,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    letterSpacing: -0.5,
    color: "#111111",
  },

  creditsDescription: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 26,
    color: "#666666",
  },

  /* ===================================================================
     FINAL DESCRIPTION
     =================================================================== */

  finalDescriptionContainer: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    marginTop: 56,
    paddingHorizontal: 20,
    alignItems: "center",
  },

  finalDescription: {
    fontSize: 14,
    lineHeight: 24,
    textAlign: "center",
    color: "#999999",
  },
});