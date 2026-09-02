import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createClient } from "../../lib/supabase/client";

/**
 * ============================================================
 * TYPES
 * ============================================================
 *
 * Conversion React Native de la page Packs Web.
 *
 * La logique métier et les données du fichier source sont
 * conservées de manière explicite. Les éléments spécifiques
 * au navigateur (Next Link, window.location, table HTML,
 * classes Tailwind) sont remplacés par leurs équivalents
 * React Native / Expo Router.
 */

type PackId =
  | "light_pack"
  | "intermediate_pack"
  | "pro_pack"
  | "business_pack";

type PackModel = {
  name: string;
  description?: string;
  available: boolean;
};

type PackMedia = {
  name: string;
  available: boolean;
  cost: number;
  unit?: string;
};

type Pack = {
  id: PackId;
  name: string;
  price: string;
  credits: string;
  duration: string;
  description: string;
  popular?: boolean;
  features: string[];
  models: PackModel[];
  media: PackMedia[];
};

type CreditTopUp = {
  id: string;
  credits: number;
  price: string;
  description: string;
};

/**
 * ============================================================
 * PACKS Oria
 * ============================================================
 *
 * Cette configuration correspond à la logique actuellement
 * définie côté backend.
 *
 * Les crédits et les durées sont :
 *
 * Léger         : 3 000 crédits  / 35 jours
 * Intermédiaire : 28 500 crédits / 35 jours
 * Pro           : 45 000 crédits / 35 jours
 * Business      : 96 000 crédits / 35 jours
 *
 * Les prix correspondent aux prix actuellement définis
 * pour les offres.
 */

const complementaryCredits: CreditTopUp[] = [
  {
    id: "credits_1000_563",
    credits: 1_000,
    price: "563 XAF",
    description: "1 000 crédits supplémentaires",
  },
  {
    id: "credits_2000",
    credits: 2_000,
    price: "1 000 XAF",
    description: "2 000 crédits supplémentaires",
  },
  {
    id: "credits_4000",
    credits: 4_000,
    price: "2 000 XAF",
    description: "4 000 crédits supplémentaires",
  },
  {
    id: "credits_10000",
    credits: 10_000,
    price: "5 000 XAF",
    description: "10 000 crédits supplémentaires",
  },
];

const packs: Pack[] = [
  {
    id: "light_pack",

    name: "Léger",

    price: "4 000 XAF",

    credits: "3 000",

    duration: "35 jours",

    description:
      "L'accès essentiel à Oria pour les usages courants.",

    features: [
      "Chat avec Luna",
      "Recherche Web avec Luna",
      "Génération d'images",
      "Génération de vidéos courtes",
      "Analyse de fichiers",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: false,
      },
      {
        name: "GPT-5.6 Terra",
        available: false,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Images 480",
        available: true,
        cost: 50,
        unit: "génération",
      },
      {
        name: "Images 720",
        available: true,
        cost: 75,
        unit: "génération",
      },
      {
        name: "Vidéo 4 s",
        available: true,
        cost: 500,
        unit: "génération",
      },
      {
        name: "Vidéo 8 s",
        available: true,
        cost: 1_000,
        unit: "génération",
      },
    ],
  },

  {
    id: "intermediate_pack",

    name: "Intermédiaire",

    price: "8 000 XAF",

    credits: "28 500",

    duration: "35 jours",

    description:
      "Un niveau supérieur pour accéder à davantage de puissance et de capacités.",

    popular: true,

    features: [
      "Tout le pack Léger",
      "GPT-5.6",
      "Recherche Web avec GPT-5.6",
      "Génération d'images avancée",
      "Veo Lite",
      "Analyse avancée de fichiers",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: false,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Images 480",
        available: true,
        cost: 50,
        unit: "génération",
      },
      {
        name: "Images 720",
        available: true,
        cost: 75,
        unit: "génération",
      },
    ],
  },

  {
    id: "pro_pack",

    name: "Pro",

    price: "12 000 XAF",

    credits: "45 000",

    duration: "35 jours",

    description:
      "Pour les utilisateurs intensifs qui recherchent davantage de puissance, de médias et de possibilités.",

    features: [
      "Tout le pack Intermédiaire",
      "GPT-5.6 Terra",
      "Recherche Web avancée",
      "Images Pro",
      "Vidéos Pro",
      "Extension vidéo",
      "Accès aux capacités créatives avancées",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: true,
      },
      {
        name: "GPT-5.6 Sol",
        available: false,
      },
    ],

    media: [
      {
        name: "Image Pro",
        available: true,
        cost: 100,
        unit: "génération",
      },
      {
        name: "Image Pro Standard",
        available: true,
        cost: 180,
        unit: "génération",
      },
      {
        name: "Image Pro Ultra",
        available: true,
        cost: 270,
        unit: "génération",
      },
      {
        name: "Veo Pro Fast",
        available: true,
        cost: 1_500,
        unit: "génération",
      },
      {
        name: "Veo Pro Standard",
        available: true,
        cost: 3_000,
        unit: "génération",
      },
      {
        name: "Veo Pro Extension",
        available: true,
        cost: 1_500,
        unit: "génération",
      },
    ],
  },

  {
    id: "business_pack",

    name: "Business",

    price: "19 000 XAF",

    credits: "96 000",

    duration: "35 jours",

    description:
      "L'offre la plus complète pour les usages intensifs, professionnels et créatifs.",

    features: [
      "Tout le pack Pro",
      "GPT-5.6 Sol",
      "Recherche Web avec Sol",
      "Images Business",
      "Images HD et Ultra",
      "Vidéos Business",
      "Vidéos longues",
      "Capacités IA avancées",
    ],

    models: [
      {
        name: "Luna",
        available: true,
      },
      {
        name: "GPT-5.6",
        available: true,
      },
      {
        name: "GPT-5.6 Terra",
        available: true,
      },
      {
        name: "GPT-5.6 Sol",
        available: true,
      },
    ],

    media: [
      {
        name: "Image Business",
        available: true,
        cost: 250,
        unit: "génération",
      },
      {
        name: "Image Business HD",
        available: true,
        cost: 400,
        unit: "génération",
      },
      {
        name: "Image Business Ultra",
        available: true,
        cost: 600,
        unit: "génération",
      },
      {
        name: "Veo Business Fast",
        available: true,
        cost: 2_500,
        unit: "génération",
      },
      {
        name: "Veo Business Standard",
        available: true,
        cost: 5_000,
        unit: "génération",
      },
      {
        name: "Veo Business Long",
        available: true,
        cost: 10_000,
        unit: "génération",
      },
    ],
  },
];

/**
 * ============================================================
 * FAQ
 * ============================================================
 */

const faqs = [
  {
    question:
      "Combien de temps mes crédits sont-ils valables ?",

    answer:
      "Les crédits sont valables pendant la durée de votre pack. Tous les packs Oria sont actuellement configurés pour une durée de 35 jours.",
  },

  {
    question:
      "Que se passe-t-il lorsque mon pack expire ?",

    answer:
      "Le portefeuille associé au pack devient inactif à sa date d'expiration. Les crédits restants ne peuvent alors plus être consommés avec ce portefeuille.",
  },

  {
    question:
      "Les crédits sont-ils identiques entre les packs ?",

    answer:
      "Non. Chaque pack possède son propre volume de crédits et ses propres capacités. Le pack Léger contient 3 000 crédits, l'Intermédiaire 28 500, le Pro 45 000 et le Business 96 000.",
  },

  {
    question:
      "Toutes les actions consomment-elles le même nombre de crédits ?",

    answer:
      "Non. Le coût dépend du modèle et de l'opération effectuée. Les actions les plus avancées consomment davantage de crédits. Une génération d'image ou de vidéo affiche son coût directement dans le pack concerné.",
  },

  {
    question:
      "Puis-je acheter des crédits supplémentaires ?",

    answer:
      "Oui. Vous pouvez acheter des recharges complémentaires de 1 000 crédits pour 563 XAF, 2 000 crédits pour 1 000 XAF, 4 000 crédits pour 2 000 XAF ou 10 000 crédits pour 5 000 XAF. Le paiement est lancé depuis cette page et confirmé par le système de paiement Oria.",
  },

  {
    question:
      "Puis-je utiliser plusieurs modèles avec mon pack ?",

    answer:
      "Oui. Les modèles disponibles dépendent du pack. Luna est disponible sur tous les packs, GPT-5.6 à partir de l'Intermédiaire, GPT-5.6 Terra à partir du Pro et GPT-5.6 Sol avec le Business.",
  },

  {
    question:
      "Les vidéos sont-elles disponibles sur tous les packs ?",

    answer:
      "Les capacités vidéo évoluent selon le pack. Le pack Léger propose les vidéos courtes, l'Intermédiaire propose Veo Lite, le Pro propose les capacités vidéo Pro et le Business ajoute les capacités vidéo Business, notamment les vidéos longues.",
  },
];

/**
 * ============================================================
 * PAGE
 * ============================================================
 */

export default function PacksPage() {
  const [
    openFaq,
    setOpenFaq,
  ] = useState<number | null>(null);

  const [
    showCreditTopUp,
    setShowCreditTopUp,
  ] = useState(false);

  const [
    isPaying,
    setIsPaying,
  ] = useState<string | null>(null);

  /**
   * Initialise un paiement auprès du backend.
   *
   * Le flux reste identique au Web :
   *
   * 1. vérifier la session Supabase ;
   * 2. rediriger vers Login si l'utilisateur n'est pas connecté ;
   * 3. appeler /payments/checkout ;
   * 4. transmettre payment_type ;
   * 5. transmettre product_id ;
   * 6. utiliser Chariow comme provider ;
   * 7. récupérer l'URL de paiement ;
   * 8. ouvrir cette URL dans l'environnement mobile.
   */
  async function startPayment(
    target: {
      type:
        | "primary_pack"
        | "addon";
      id: string;
    },
  ) {
    if (isPaying !== null) {
      return;
    }

    const supabase =
      createClient();

    const {
      data: {
        session,
      },
    } =
      await supabase.auth.getSession();

    /**
     * Si aucune session n'est disponible,
     * l'utilisateur doit d'abord se connecter.
     *
     * La version Web conservait l'identifiant
     * du produit dans la query string.
     */
    if (!session) {
      router.push({
        pathname: "/login",
        params: {
          redirect:
            `/packs?checkout=${encodeURIComponent(
              target.id,
            )}`,
        },
      } as any);

      return;
    }

    setIsPaying(
      target.id,
    );

    try {
      const apiUrl =
        process.env
          .EXPO_PUBLIC_API_URL ??
        process.env
          .EXPO_PUBLIC_BACKEND_URL ??
        "https://lbv-connect-api.onrender.com";

      const response =
        await fetch(
          `${apiUrl.replace(
            /\/$/,
            "",
          )}/payments/checkout`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${session.access_token}`,

              "user-id":
                session.user.id,
            },

            body: JSON.stringify({
              payment_type:
                target.type,

              product_id:
                target.id,

              /*
               * Chariow est l'unique passerelle de checkout.
               * Aucun opérateur Mobile Money n'est choisi ici.
               */
              provider: "chariow",
            }),
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (!response.ok) {
        throw new Error(
          typeof data?.detail ===
            "string"
            ? data.detail
            : typeof data?.error ===
                "string"
              ? data.error
              : "Impossible d'initialiser le paiement.",
        );
      }

      /**
       * Le backend peut renvoyer l'une des trois
       * propriétés prévues par la version Web.
       */
      const destination =
        data?.checkout_url ??
        data?.redirect_url ??
        data?.payment_url;

      if (
        typeof destination !==
          "string" ||
        !destination
      ) {
        throw new Error(
          "Chariow n'a fourni aucune URL de paiement.",
        );
      }

      /**
       * Sur mobile, window.location.href n'existe pas.
       *
       * Linking.openURL ouvre l'URL de checkout
       * dans le navigateur disponible sur l'appareil.
       */
      await Linking.openURL(
        destination,
      );
    } catch (error) {
      console.error(
        target.type ===
          "addon"
          ? "Initialisation recharge échouée :"
          : "Initialisation paiement pack échouée :",
        error,
      );

      Alert.alert(
        "Paiement",
        error instanceof Error
          ? error.message
          : "Impossible d'initialiser le paiement.",
      );
    } finally {
      setIsPaying(null);
    }
  }

  /**
   * Sélection d'un pack principal.
   */
  function handlePackSelection(
    pack: Pack,
  ) {
    void startPayment({
      type:
        "primary_pack",
      id: pack.id,
    });
  }

  /**
   * Sélection d'une recharge de crédits.
   */
  function handleCreditTopUp(
    topUp: CreditTopUp,
  ) {
    void startPayment({
      type: "addon",
      id: topUp.id,
    });
  }

  /**
   * Navigation retour vers le chat.
   */
  function handleBackToChat() {
    if (isPaying !== null) {
      return;
    }

    router.replace("/chat" as any);
  }

  /**
   * Navigation vers les crédits.
   */
  function handleCredits() {
    if (isPaying !== null) {
      return;
    }

    router.push("/credits" as any);
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <View
        style={styles.container}
      >
        {/* Header */}

        <View
          style={styles.header}
        >
          <View
            style={
              styles.headerLeft
            }
          >
            <Pressable
              onPress={
                handleBackToChat
              }
              accessibilityRole="button"
              accessibilityLabel="Retour au chat"
              style={({ pressed }) => [
                styles.headerIconButton,
                pressed &&
                  styles.pressed,
                isPaying !==
                  null &&
                  styles.disabled,
              ]}
            >
              <Ionicons
                name="arrow-back"
                size={20}
                color="#52525b"
              />
            </Pressable>

            <View
              style={
                styles.brandContainer
              }
            >
              <Ionicons
                name="sparkles"
                size={19}
                color="#18181b"
              />

              <Text
                style={
                  styles.brandText
                }
              >
                Oria
              </Text>
            </View>
          </View>

          <Pressable
            onPress={
              handleCredits
            }
            style={({ pressed }) => [
              styles.creditsButton,
              pressed &&
                styles.pressed,
              isPaying !==
                null &&
                styles.disabled,
            ]}
          >
            <Ionicons
              name="card-outline"
              size={17}
              color="#52525b"
            />

            <Text
              style={
                styles.creditsButtonText
              }
            >
              Mes crédits
            </Text>
          </Pressable>
        </View>

        {/* Contenu */}

        <ScrollView
          style={
            styles.scrollView
          }
          contentContainerStyle={
            styles.content
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* Hero */}

          <View
            style={styles.hero}
          >
            <Text
              style={
                styles.heroEyebrow
              }
            >
              Packs Oria
            </Text>

            <Text
              style={styles.heroTitle}
            >
              Choisissez votre accès
              à l'IA.
            </Text>

            <Text
              style={
                styles.heroDescription
              }
            >
              Chaque pack vous donne
              un volume de crédits
              utilisable pendant 35
              jours. Les modèles et
              capacités accessibles
              dépendent du pack choisi.
            </Text>
          </View>

          {/* Packs */}

          <View
            style={styles.packList}
          >
            {packs.map(
              (pack) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  onSelect={
                    handlePackSelection
                  }
                  isPaying={
                    isPaying
                  }
                />
              ),
            )}
          </View>

          {/* Crédits complémentaires */}

          <View
            style={
              styles.topUpSection
            }
          >
            <View
              style={
                styles.topUpTextArea
              }
            >
              <View
                style={
                  styles.sectionTitleRow
                }
              >
                <Ionicons
                  name="flash-outline"
                  size={19}
                  color="#18181b"
                />

                <Text
                  style={
                    styles.sectionTitle
                  }
                >
                  Besoin de crédits
                  supplémentaires ?
                </Text>
              </View>

              <Text
                style={
                  styles.sectionDescription
                }
              >
                Rechargez votre solde
                sans changer de pack.
                Les crédits
                complémentaires sont
                ajoutés directement à
                votre portefeuille.
              </Text>

              <Text
                style={
                  styles.topUpPriceText
                }
              >
                À partir de 563 XAF
                pour 1 000 crédits
              </Text>
            </View>

            <Pressable
              onPress={() =>
                setShowCreditTopUp(
                  true,
                )
              }
              disabled={
                isPaying !== null
              }
              style={({ pressed }) => [
                styles.primaryButton,
                pressed &&
                  styles.primaryButtonPressed,
                isPaying !==
                  null &&
                  styles.disabled,
              ]}
            >
              <Text
                style={
                  styles.primaryButtonText
                }
              >
                Acheter des crédits
              </Text>

              <Ionicons
                name="flash-outline"
                size={17}
                color="#ffffff"
              />
            </Pressable>
          </View>

          {/* Fonctionnement */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.centerHeading
              }
            >
              <Text
                style={
                  styles.sectionEyebrow
                }
              >
                Fonctionnement
              </Text>

              <Text
                style={
                  styles.sectionHeading
                }
              >
                Simple à comprendre
              </Text>
            </View>

            <View
              style={
                styles.stepsList
              }
            >
              <Step
                number="01"
                title="Choisissez un pack"
                description="Sélectionnez le niveau de puissance, les capacités et le volume de crédits adaptés à votre utilisation."
              />

              <Step
                number="02"
                title="Utilisez Oria"
                description="Utilisez les modèles, la recherche Web, les images, les vidéos et les autres capacités incluses dans votre pack."
              />

              <Step
                number="03"
                title="Suivez vos crédits"
                description="Votre solde évolue automatiquement après chaque opération et reste consultable depuis votre espace."
              />
            </View>
          </View>

          {/* Comparaison des modèles */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.centerHeading
              }
            >
              <Text
                style={
                  styles.sectionEyebrow
                }
              >
                Accès aux modèles
              </Text>

              <Text
                style={
                  styles.sectionHeading
                }
              >
                Comparez les niveaux
                d'IA
              </Text>
            </View>

            <View
              style={
                styles.modelComparisonCard
              }
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={
                  false
              }
              >
                <View
                  style={
                    styles.comparisonTable
                  }
                >
                  {/* Table header */}

                  <View
                    style={[
                      styles.tableRow,
                      styles.tableHeaderRow,
                    ]}
                  >
                    <View
                      style={[
                        styles.modelNameCell,
                        styles.tableHeaderCell,
                      ]}
                    >
                      <Text
                        style={
                          styles.tableHeaderText
                        }
                      >
                        Modèle
                      </Text>
                    </View>

                    {packs.map(
                      (pack) => (
                        <View
                          key={
                            pack.id
                          }
                          style={[
                            styles.packTableCell,
                            styles.tableHeaderCell,
                          ]}
                        >
                          <Text
                            style={
                              styles.tableHeaderText
                            }
                          >
                            {pack.name}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>

                  {/* Table rows */}

                  {[
                    "Luna",
                    "GPT-5.6",
                    "GPT-5.6 Terra",
                    "GPT-5.6 Sol",
                  ].map(
                    (
                      modelName,
                    ) => (
                      <View
                        key={
                          modelName
                        }
                        style={
                          styles.tableRow
                        }
                      >
                        <View
                          style={
                            styles.modelNameCell
                          }
                        >
                          <Text
                            style={
                              styles.modelNameText
                            }
                          >
                            {modelName}
                          </Text>
                        </View>

                        {packs.map(
                          (
                            pack,
                          ) => {
                            const model =
                              pack.models.find(
                                (
                                  item,
                                ) =>
                                  item.name ===
                                  modelName,
                              );

                            const available =
                              Boolean(
                                model?.available,
                              );

                            return (
                              <View
                                key={
                                  pack.id
                                }
                                style={
                                  styles.packTableCell
                                }
                              >
                                {available ? (
                                  <Ionicons
                                    name="checkmark"
                                    size={18}
                                    color="#52525b"
                                  />
                                ) : (
                                  <Ionicons
                                    name="lock-closed-outline"
                                    size={16}
                                    color="#a1a1aa"
                                  />
                                )}
                              </View>
                            );
                          },
                        )}
                      </View>
                    ),
                  )}
                </View>
              </ScrollView>
            </View>
          </View>

          {/* FAQ */}

          <View
            style={
              styles.contentSection
            }
          >
            <View
              style={
                styles.faqHeading
              }
            >
              <Ionicons
                name="help-circle-outline"
                size={19}
                color="#18181b"
              />

              <Text
                style={
                  styles.faqHeadingText
                }
              >
                Questions sur les
                packs
              </Text>
            </View>

            <View
              style={
                styles.faqContainer
              }
            >
              {faqs.map(
                (
                  faq,
                  index,
                ) => {
                  const isOpen =
                    openFaq ===
                    index;

                  return (
                    <View
                      key={
                        faq.question
                      }
                      style={[
                        styles.faqItem,
                        index ===
                          faqs.length -
                            1 &&
                          styles.faqItemLast,
                      ]}
                    >
                      <Pressable
                        onPress={() =>
                          setOpenFaq(
                            isOpen
                              ? null
                              : index,
                          )
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          expanded:
                            isOpen,
                        }}
                        style={({ pressed }) => [
                          styles.faqQuestionButton,
                          pressed &&
                            styles.faqPressed,
                        ]}
                      >
                        <Text
                          style={
                            styles.faqQuestion
                          }
                        >
                          {
                            faq.question
                          }
                        </Text>

                        <Ionicons
                          name={
                            isOpen
                              ? "chevron-up"
                              : "chevron-down"
                          }
                          size={18}
                          color="#71717a"
                        />
                      </Pressable>

                      {isOpen ? (
                        <View
                          style={
                            styles.faqAnswerContainer
                          }
                        >
                          <Text
                            style={
                              styles.faqAnswer
                            }
                          >
                            {
                              faq.answer
                            }
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                },
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Modal crédits complémentaires */}

      <Modal
        visible={
          showCreditTopUp
        }
        transparent
        animationType="slide"
        onRequestClose={() =>
          setShowCreditTopUp(
            false,
          )
        }
      >
        <View
          style={
            styles.modalOverlay
          }
        >
          <Pressable
            style={
              styles.modalBackdrop
            }
            onPress={() =>
              setShowCreditTopUp(
                false,
              )
            }
          />

          <View
            style={
              styles.topUpModal
            }
          >
            <View
              style={
                styles.modalHandle
              }
            />

            <View
              style={
                styles.modalHeader
              }
            >
              <View
                style={
                  styles.modalHeaderTextArea
                }
              >
                <Text
                  style={
                    styles.modalEyebrow
                  }
                >
                  Crédits complémentaires
                </Text>

                <Text
                  style={
                    styles.modalTitle
                  }
                >
                  Rechargez votre solde
                </Text>

                <Text
                  style={
                    styles.modalDescription
                  }
                >
                  Choisissez une recharge.
                  Vous serez redirigé vers
                  Chariow pour finaliser le
                  paiement avec les moyens
                  disponibles.
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setShowCreditTopUp(
                    false,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                style={
                  styles.modalCloseButton
                }
              >
                <Ionicons
                  name="close"
                  size={20}
                  color="#52525b"
                />
              </Pressable>
            </View>

            <ScrollView
              style={
                styles.topUpOptionsScroll
              }
              showsVerticalScrollIndicator={
                false
            }
              contentContainerStyle={
                styles.topUpOptions
              }
            >
              {complementaryCredits.map(
                (
                  topUp,
                ) => (
                  <View
                    key={
                      topUp.id
                    }
                    style={
                      styles.topUpOption
                    }
                  >
                    <View
                      style={
                        styles.topUpOptionInfo
                      }
                    >
                      <Text
                        style={
                          styles.topUpCredits
                        }
                      >
                        {topUp.credits.toLocaleString(
                          "fr-FR",
                        )}{" "}
                        crédits
                      </Text>

                      <Text
                        style={
                          styles.topUpDescription
                        }
                      >
                        {
                          topUp.description
                        }
                      </Text>
                    </View>

                    <View
                      style={
                        styles.topUpOptionAction
                      }
                    >
                      <Text
                        style={
                          styles.topUpOptionPrice
                        }
                      >
                        {
                          topUp.price
                        }
                      </Text>

                      <Pressable
                        onPress={() =>
                          handleCreditTopUp(
                            topUp,
                          )
                        }
                        disabled={
                          isPaying !==
                          null
                        }
                        style={({ pressed }) => [
                          styles.smallPrimaryButton,
                          pressed &&
                            styles.primaryButtonPressed,
                          isPaying !==
                            null &&
                            styles.disabled,
                        ]}
                      >
                        {isPaying ===
                        topUp.id ? (
                          <ActivityIndicator
                            size="small"
                            color="#ffffff"
                          />
                        ) : (
                          <Text
                            style={
                              styles.smallPrimaryButtonText
                            }
                          >
                            Acheter
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ),
              )}
            </ScrollView>

            <View
              style={
                styles.paymentNotice
              }
            >
              <Ionicons
                name="information-circle-outline"
                size={17}
                color="#71717a"
              />

              <Text
                style={
                  styles.paymentNoticeText
                }
              >
                Le montant sera débité
                uniquement après
                confirmation du paiement.
                Moov Money et Airtel Money
                seront connectés à cette
                étape.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * ============================================================
 * PACK CARD
 * ============================================================
 *
 * Carte détaillée d'un pack.
 *
 * La structure Web est conservée :
 * - badge "Le plus choisi" ;
 * - identité du pack ;
 * - prix ;
 * - durée ;
 * - crédits inclus ;
 * - modèles ;
 * - médias ;
 * - coûts des médias ;
 * - capacités incluses ;
 * - bouton d'achat.
 */

function PackCard({
  pack,
  onSelect,
  isPaying,
}: {
  pack: Pack;
  onSelect: (
    pack: Pack,
  ) => void;
  isPaying: string | null;
}) {
  const isPopular =
    Boolean(pack.popular);

  const isCurrentPackPaying =
    isPaying === pack.id;

  return (
    <View
      style={[
        styles.packCard,
        isPopular &&
          styles.packCardPopular,
      ]}
    >
      {/* Badge */}

      {isPopular ? (
        <View
          style={
            styles.popularBadge
          }
        >
          <Text
            style={
              styles.popularBadgeText
            }
          >
            Le plus choisi
          </Text>
        </View>
      ) : null}

      {/* Identité */}

      <View>
        <Text
          style={[
            styles.packEyebrow,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Pack
        </Text>

        <Text
          style={
            styles.packName
          }
        >
          {pack.name}
        </Text>

        <Text
          style={[
            styles.packDescription,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          {pack.description}
        </Text>
      </View>

      {/* Prix */}

      <View
        style={
          styles.priceBlock
        }
      >
        <Text
          style={
            styles.packPrice
          }
        >
          {pack.price}
        </Text>

        <View
          style={
            styles.durationRow
          }
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={
              isPopular
                ? "#ffffff"
                : "#71717a"
            }
          />

          <Text
            style={[
              styles.durationText,
              isPopular &&
                styles.popularMutedText,
            ]}
          >
            {pack.duration}
          </Text>
        </View>
      </View>

      {/* Séparateur */}

      <View
        style={[
          styles.cardDivider,
          isPopular &&
            styles.popularDivider,
        ]}
      />

      {/* Crédits */}

      <View>
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Crédits inclus
        </Text>

        <Text
          style={
            styles.creditsAmount
          }
        >
          {pack.credits}
        </Text>
      </View>

      {/* Modèles */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Modèles
        </Text>

        <View
          style={
            styles.listBlock
          }
        >
          {pack.models.map(
            (model) => (
              <View
                key={
                  model.name
                }
                style={
                  styles.listRow
                }
              >
                <View
                  style={
                    styles.listRowLeft
                  }
                >
                  {model.available ? (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={
                        isPopular
                          ? "#ffffff"
                          : "#52525b"
                      }
                    />
                  ) : (
                    <Ionicons
                      name="lock-closed-outline"
                      size={15}
                      color={
                        isPopular
                          ? "#ffffff"
                          : "#a1a1aa"
                      }
                    />
                  )}

                  <Text
                    style={[
                      styles.modelText,
                      model.available
                        ? styles.availableText
                        : styles.lockedText,
                      isPopular &&
                        styles.popularModelText,
                    ]}
                  >
                    {
                      model.name
                    }
                  </Text>
                </View>

                {!model.available ? (
                  <Text
                    style={[
                      styles.lockedLabel,
                      isPopular &&
                        styles.popularLockedLabel,
                    ]}
                  >
                    Verrouillé
                  </Text>
                ) : null}
              </View>
            ),
          )}
        </View>
      </View>

      {/* Médias */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Médias
        </Text>

        <View
          style={
            styles.listBlock
          }
        >
          {pack.media.map(
            (media) => (
              <View
                key={
                  media.name
                }
                style={
                  styles.mediaRow
                }
              >
                {media.available ? (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={
                      isPopular
                        ? "#ffffff"
                        : "#52525b"
                    }
                  />
                ) : (
                  <Ionicons
                    name="lock-closed-outline"
                    size={15}
                    color={
                      isPopular
                        ? "#ffffff"
                        : "#a1a1aa"
                    }
                  />
                )}

                <View
                  style={
                    styles.mediaInfo
                  }
                >
                  <Text
                    style={[
                      styles.mediaName,
                      media.available
                        ? styles.availableText
                        : styles.lockedText,
                      isPopular &&
                        styles.popularMediaText,
                    ]}
                  >
                    {
                      media.name
                    }
                  </Text>

                  {media.available ? (
                    <Text
                      style={[
                        styles.mediaCost,
                        isPopular &&
                          styles.popularMutedText,
                      ]}
                    >
                      {media.cost.toLocaleString(
                        "fr-FR",
                      )}{" "}
                      crédits
                      {media.unit
                        ? ` / ${media.unit}`
                        : ""}
                    </Text>
                  ) : null}
                </View>
              </View>
            ),
          )}
        </View>

        <Text
          style={[
            styles.mediaFootnote,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Le coût affiché correspond à
          une génération et est déduit de
          votre solde de crédits.
        </Text>
      </View>

      {/* Capacités */}

      <View
        style={
          styles.cardSection
        }
      >
        <Text
          style={[
            styles.subsectionLabel,
            isPopular &&
              styles.popularMutedText,
          ]}
        >
          Inclus
        </Text>

        <View
          style={
            styles.featuresList
          }
        >
          {pack.features.map(
            (feature) => (
              <View
                key={
                  feature
                }
                style={
                  styles.featureRow
                }
              >
                <Ionicons
                  name="checkmark"
                  size={17}
                  color={
                    isPopular
                      ? "#ffffff"
                      : "#52525b"
                  }
                  style={
                    styles.featureIcon
                  }
                />

                <Text
                  style={[
                    styles.featureText,
                    isPopular &&
                      styles.popularFeatureText,
                  ]}
                >
                  {feature}
                </Text>
              </View>
            ),
          )}
        </View>
      </View>

      {/* Achat */}

      <Pressable
        onPress={() =>
          onSelect(pack)
        }
        disabled={
          isPaying !== null
        }
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.packPurchaseButton,
          isPopular &&
            styles.packPurchaseButtonPopular,
          pressed &&
            styles.purchasePressed,
          isPaying !== null &&
            styles.disabled,
        ]}
      >
        {isCurrentPackPaying ? (
          <View
            style={
              styles.purchaseLoading
            }
          >
            <ActivityIndicator
              size="small"
              color={
                isPopular
                  ? "#111111"
                  : "#ffffff"
              }
            />

            <Text
              style={[
                styles.purchaseText,
                isPopular &&
                  styles.purchaseTextPopular,
              ]}
            >
              Redirection...
            </Text>
          </View>
        ) : (
          <Text
            style={[
              styles.purchaseText,
              isPopular &&
                styles.purchaseTextPopular,
            ]}
          >
            Choisir {pack.name}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * ============================================================
 * STEP
 * ============================================================
 *
 * Étape du bloc "Simple à comprendre".
 */

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <View
      style={
        styles.stepCard
      }
    >
      <Text
        style={
          styles.stepNumber
        }
      >
        {number}
      </Text>

      <Text
        style={
          styles.stepTitle
        }
      >
        {title}
      </Text>

      <Text
        style={
          styles.stepDescription
        }
      >
        {description}
      </Text>
    </View>
  );
}

/**
 * ============================================================
 * STYLES
 * ============================================================
 *
 * Le Web original utilisait des classes Tailwind.
 * React Native ne rend pas ces classes directement.
 *
 * Le StyleSheet ci-dessous transpose donc explicitement
 * l'organisation visuelle de la page :
 *
 * - header ;
 * - hero ;
 * - cartes de packs ;
 * - pack populaire ;
 * - recharge ;
 * - étapes ;
 * - comparaison ;
 * - FAQ ;
 * - modal ;
 * - états de paiement.
 *
 * Les styles sont volontairement détaillés et non compactés.
 */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  container: {
    flex: 1,
    backgroundColor: "#fafafa",
  },

  header: {
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  brandText: {
    color: "#18181b",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  creditsButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  creditsButtonText: {
    color: "#3f3f46",
    fontSize: 13,
    fontWeight: "500",
  },

  scrollView: {
    flex: 1,
  },

  content: {
    width: "100%",
    maxWidth: 1240,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 34,
    paddingBottom: 60,
  },

  hero: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 720,
    alignItems: "center",
    marginBottom: 32,
  },

  heroEyebrow: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "600",
  },

  heroTitle: {
    marginTop: 7,
    color: "#18181b",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
    textAlign: "center",
  },

  heroDescription: {
    marginTop: 14,
    color: "#71717a",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },

  packList: {
    width: "100%",
    gap: 14,
  },

  packCard: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 24,
    backgroundColor: "#ffffff",
    paddingHorizontal: 21,
    paddingVertical: 22,
  },

  packCardPopular: {
    borderColor: "#111111",
    backgroundColor: "#111111",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 7,
    },
    elevation: 4,
  },

  popularBadge: {
    position: "absolute",
    top: 18,
    right: 18,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    paddingHorizontal: 11,
    paddingVertical: 5,
  },

  popularBadgeText: {
    color: "#111111",
    fontSize: 10,
    fontWeight: "700",
  },

  packEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  popularMutedText: {
    color: "#ffffff",
    opacity: 0.62,
  },

  packName: {
    marginTop: 3,
    color: "#18181b",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
  },

  packDescription: {
    marginTop: 12,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
    minHeight: 60,
  },

  priceBlock: {
    marginTop: 23,
  },

  packPrice: {
    color: "#18181b",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  durationRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  durationText: {
    color: "#71717a",
    fontSize: 13,
  },

  cardDivider: {
    height: 1,
    backgroundColor: "#e4e4e7",
    marginVertical: 22,
  },

  popularDivider: {
    backgroundColor: "#ffffff",
    opacity: 0.12,
  },

  subsectionLabel: {
    color: "#71717a",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },

  creditsAmount: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  cardSection: {
    marginTop: 23,
  },

  listBlock: {
    marginTop: 11,
    gap: 10,
  },

  listRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  listRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  modelText: {
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },

  availableText: {
    color: "#52525b",
  },

  lockedText: {
    color: "#a1a1aa",
  },

  popularModelText: {
    color: "#ffffff",
  },

  lockedLabel: {
    color: "#a1a1aa",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  popularLockedLabel: {
    color: "#ffffff",
    opacity: 0.35,
  },

  mediaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  mediaInfo: {
    flex: 1,
    minWidth: 0,
  },

  mediaName: {
    fontSize: 13,
    lineHeight: 18,
  },

  popularMediaText: {
    color: "#ffffff",
  },

  mediaCost: {
    marginTop: 2,
    color: "#71717a",
    fontSize: 10,
    lineHeight: 15,
  },

  mediaFootnote: {
    marginTop: 10,
    color: "#71717a",
    fontSize: 10,
    lineHeight: 16,
  },

  featuresList: {
    marginTop: 11,
    gap: 9,
  },

  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },

  featureIcon: {
    marginTop: 1,
  },

  featureText: {
    flex: 1,
    color: "#52525b",
    fontSize: 13,
    lineHeight: 19,
  },

  popularFeatureText: {
    color: "#ffffff",
    opacity: 0.82,
  },

  packPurchaseButton: {
    minHeight: 49,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 25,
    paddingHorizontal: 15,
  },

  packPurchaseButtonPopular: {
    backgroundColor: "#ffffff",
  },

  purchasePressed: {
    opacity: 0.82,
  },

  purchaseLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  purchaseText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  purchaseTextPopular: {
    color: "#111111",
  },

  topUpSection: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 24,
    backgroundColor: "#f4f4f5",
    padding: 21,
    gap: 20,
  },

  topUpTextArea: {
    flex: 1,
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  sectionTitle: {
    flex: 1,
    color: "#18181b",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
  },

  sectionDescription: {
    marginTop: 8,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  topUpPriceText: {
    marginTop: 10,
    color: "#3f3f46",
    fontSize: 13,
    fontWeight: "600",
  },

  primaryButton: {
    minHeight: 47,
    borderRadius: 12,
    backgroundColor: "#111111",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  primaryButtonPressed: {
    opacity: 0.82,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  contentSection: {
    marginTop: 42,
  },

  centerHeading: {
    alignItems: "center",
  },

  sectionEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  sectionHeading: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.3,
    textAlign: "center",
  },

  stepsList: {
    marginTop: 18,
    gap: 12,
  },

  stepCard: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    backgroundColor: "#f4f4f5",
    padding: 18,
  },

  stepNumber: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
  },

  stepTitle: {
    marginTop: 13,
    color: "#18181b",
    fontSize: 14,
    fontWeight: "700",
  },

  stepDescription: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modelComparisonCard: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },

  comparisonTable: {
    minWidth: 720,
  },

  tableRow: {
    minHeight: 57,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },

  tableHeaderRow: {
    backgroundColor: "#f4f4f5",
  },

  tableHeaderCell: {
    justifyContent: "center",
  },

  tableHeaderText: {
    color: "#3f3f46",
    fontSize: 12,
    fontWeight: "600",
  },

  modelNameCell: {
    width: 170,
    paddingHorizontal: 17,
    justifyContent: "center",
  },

  modelNameText: {
    color: "#18181b",
    fontSize: 13,
    fontWeight: "600",
  },

  packTableCell: {
    width: 137,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  faqHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  faqHeadingText: {
    color: "#18181b",
    fontSize: 17,
    fontWeight: "700",
  },

  faqContainer: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },

  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },

  faqItemLast: {
    borderBottomWidth: 0,
  },

  faqQuestionButton: {
    minHeight: 57,
    paddingHorizontal: 17,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  faqPressed: {
    backgroundColor: "#f4f4f5",
  },

  faqQuestion: {
    flex: 1,
    color: "#27272a",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  faqAnswerContainer: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 17,
    paddingBottom: 17,
  },

  faqAnswer: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },

  modalBackdrop: {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "rgba(0, 0, 0, 0.50)",
  },

  topUpModal: {
    maxHeight: "88%",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 25,
  },

  modalHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d4d4d8",
    marginBottom: 17,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 15,
  },

  modalHeaderTextArea: {
    flex: 1,
  },

  modalEyebrow: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "600",
  },

  modalTitle: {
    marginTop: 4,
    color: "#18181b",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.4,
  },

  modalDescription: {
    marginTop: 7,
    color: "#71717a",
    fontSize: 13,
    lineHeight: 20,
  },

  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },

  topUpOptionsScroll: {
    marginTop: 18,
  },

  topUpOptions: {
    gap: 10,
    paddingBottom: 3,
  },

  topUpOption: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 17,
    backgroundColor: "#f4f4f5",
    padding: 15,
    gap: 13,
  },

  topUpOptionInfo: {
    flex: 1,
  },

  topUpCredits: {
    color: "#18181b",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },

  topUpDescription: {
    marginTop: 3,
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
  },

  topUpOptionAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 13,
  },

  topUpOptionPrice: {
    color: "#18181b",
    fontSize: 17,
    fontWeight: "700",
  },

  smallPrimaryButton: {
    minHeight: 42,
    minWidth: 91,
    borderRadius: 11,
    backgroundColor: "#111111",
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  smallPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  paymentNotice: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 15,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  paymentNoticeText: {
    flex: 1,
    color: "#71717a",
    fontSize: 11,
    lineHeight: 17,
  },

  pressed: {
    opacity: 0.72,
  },

  disabled: {
    opacity: 0.5,
  },
});