import React, { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
// ORIA : contenu integre dans ce fichier. Aucun legal-content.json requis.
type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalTab = {
  id: string;
  label: string;
  subtitle: string;
  icon?: string;
  sections: LegalSection[];
};

type LegalContent = {
  title: string;
  updated: string;
  email: string;
  intro: string;
  tabs: LegalTab[];
};

const content: LegalContent = {
  "title": "ORIA — Informations et politiques",
  "updated": "24 octobre 2026",
  "email": "lbv-connect01@gmail.com",
  "intro": "Découvrez notre vision, nos services et les engagements qui encadrent votre expérience avec ORIA.",
  "tabs": [
    {
      "id": "about",
      "label": "À propos",
      "subtitle": "Notre identité et notre ambition",
      "icon": "information-circle-outline",
      "sections": [
        {
          "title": "Notre vision",
          "paragraphs": [
            "ORIA est une plateforme d’intelligence artificielle conçue pour faciliter l’accès au savoir, à la création et aux outils numériques. Née au Gabon avec une vocation francophone, elle rassemble différents usages de l’IA dans un environnement pensé pour être simple, cohérent et accessible.",
            "Nous défendons une idée essentielle : chacun doit pouvoir apprendre, comprendre et créer avec davantage de liberté. Cette ambition guide nos choix de conception, notre façon de présenter les informations et notre volonté de proposer des solutions utiles au quotidien."
          ]
        },
        {
          "title": "Une intelligence artificielle au service des personnes",
          "paragraphs": [
            "ORIA accompagne les élèves, les étudiants, les enseignants, les créateurs et les professionnels dans leurs recherches, leurs projets et leurs activités. Elle intervient comme un outil d’assistance : elle aide à explorer des idées, structurer un raisonnement, produire du contenu et gagner du temps.",
            "Nous accordons une importance particulière à la compréhension. Une bonne réponse ne doit pas seulement apporter un résultat ; elle doit, lorsque cela est utile, permettre à la personne qui la reçoit de mieux maîtriser son sujet."
          ]
        },
        {
          "title": "Une expérience réunie dans un seul espace",
          "paragraphs": [
            "La plateforme associe conversation, assistance à la rédaction, compréhension de documents, programmation, recherche d’informations, traitement des contenus audio et création visuelle. Les outils accessibles dépendent de la version du service, du modèle choisi et du pack détenu.",
            "Cette organisation permet de passer naturellement d’une question à un document, d’une idée à un visuel ou d’un cours à des notes structurées, sans multiplier les interfaces."
          ]
        },
        {
          "title": "Une conception adaptée à nos utilisateurs",
          "paragraphs": [
            "ORIA est développée avec une attention particulière portée aux usages du Gabon et de l’Afrique francophone : clarté de l’interface, accompagnement pédagogique, modalités d’accès et simplicité des parcours.",
            "Notre ambition est de construire un service durable, capable d’évoluer avec les besoins de ses utilisateurs tout en conservant une identité propre."
          ]
        },
        {
          "title": "Notre manière de travailler",
          "paragraphs": [
            "Nous privilégions la lisibilité, la continuité du service, la protection des informations et la qualité des résultats. Les retours de la communauté orientent l’amélioration de l’expérience et la conception de nouvelles fonctions.",
            "Les services numériques évoluent. Nous pouvons donc ajuster les fonctionnalités, les modèles et les offres afin de maintenir une plateforme pertinente et fiable."
          ]
        },
        {
          "title": "L’essentiel de notre engagement",
          "bullets": [
            "Rendre les outils d’intelligence artificielle plus faciles à utiliser.",
            "Favoriser l’apprentissage, la créativité et l’autonomie.",
            "Présenter les coûts et les conditions d’accès avec clarté.",
            "Respecter la confidentialité et les droits des utilisateurs.",
            "Faire évoluer ORIA avec exigence et sens des responsabilités."
          ]
        },
        {
          "title": "Entrer en contact avec nous",
          "paragraphs": [
            "Une question, une suggestion ou un besoin d’assistance ? Notre équipe est joignable à l’adresse lbv-connect01@gmail.com. Nous attachons de l’importance aux échanges qui nous permettent d’améliorer concrètement ORIA."
          ]
        }
      ]
    },
    {
      "id": "working",
      "label": "Fonctionnement",
      "subtitle": "Comprendre les possibilités d’ORIA",
      "icon": "layers-outline",
      "sections": [
        {
          "title": "Le Chat ORIA",
          "paragraphs": [
            "Le Chat est le point de départ de nombreuses actions. Vous pouvez y poser une question, demander une explication, préparer un texte, résoudre un exercice, travailler sur un projet ou solliciter une aide technique.",
            "Les réponses peuvent être structurées avec des titres, des tableaux, des formules, du code ou des références lorsque la fonction utilisée le permet. Vous gardez la possibilité d’approfondir un sujet au fil de la conversation."
          ]
        },
        {
          "title": "Choix du modèle et du mode de réponse",
          "paragraphs": [
            "Selon votre offre, ORIA peut mettre plusieurs modèles d’intelligence artificielle à votre disposition, ainsi que différents niveaux de raisonnement. Chaque option répond à des besoins distincts, de la question courante à l’analyse plus exigeante.",
            "La disponibilité d’un modèle et les droits associés sont indiqués dans l’application. Les choix proposés tiennent compte du pack, des limites techniques et des règles d’utilisation du service."
          ]
        },
        {
          "title": "Conversations et continuité",
          "paragraphs": [
            "L’historique vous aide à retrouver vos échanges et à reprendre vos travaux. Pour les discussions longues, des mécanismes de gestion du contexte peuvent être utilisés afin de préserver les éléments utiles à la suite de la conversation.",
            "Vous pouvez organiser vos échanges selon les options offertes dans votre espace personnel. Une mémoire contextuelle ne remplace toutefois pas la conservation exhaustive de chaque détail d’une conversation."
          ]
        },
        {
          "title": "Documents et fichiers",
          "paragraphs": [
            "ORIA peut accompagner la lecture, la compréhension et la préparation de contenus tels que les PDF, documents texte, tableaux et présentations. Un fichier joint peut servir de support à une explication, une synthèse, une traduction ou un travail de reformulation.",
            "Lorsque la création de fichiers est proposée, les formats disponibles sont indiqués dans l’interface. Vous pouvez récupérer les documents effectivement générés au moyen des options de consultation ou de téléchargement prévues."
          ]
        },
        {
          "title": "Assistance au code",
          "paragraphs": [
            "ORIA aide à expliquer, écrire, organiser et corriger du code informatique. Elle peut proposer des exemples, détailler des erreurs et préparer des fichiers sources selon la demande.",
            "Le code produit doit être relu et testé dans l’environnement auquel il est destiné. Une suggestion générée ne constitue pas, à elle seule, une validation de sécurité ou de compatibilité."
          ]
        },
        {
          "title": "Recherche sur le Web",
          "paragraphs": [
            "Avec la recherche Web, ORIA peut compléter une réponse par des informations provenant de sources en ligne, des liens et, lorsqu’elles sont pertinentes, des illustrations.",
            "Les informations publiées sur Internet changent. Pour un sujet sensible ou dépendant de l’actualité, nous recommandons de consulter les sources d’origine et de vérifier les éléments déterminants."
          ]
        },
        {
          "title": "Compréhension des images",
          "paragraphs": [
            "Selon le modèle et les options disponibles, vous pouvez joindre une photographie, une capture d’écran, un schéma ou une illustration afin d’en demander l’analyse, une description ou une explication.",
            "La précision du résultat dépend notamment de la qualité de l’image, de sa lisibilité et du contexte fourni."
          ]
        },
        {
          "title": "Création d’images",
          "paragraphs": [
            "Le studio Image permet de décrire un visuel et de sélectionner les paramètres proposés pour votre offre. Les possibilités peuvent varier en matière de format, de qualité, de style et de coût en crédits.",
            "Une description claire, accompagnée des contraintes importantes, facilite l’obtention d’un résultat proche de votre intention créative."
          ]
        },
        {
          "title": "Création de vidéos",
          "paragraphs": [
            "Le studio Vidéo accompagne la production de séquences à partir d’instructions créatives. Les durées, résolutions, variantes et possibilités d’extension dépendent des options effectivement proposées.",
            "Avant de lancer une génération, prenez connaissance des paramètres et du coût affichés. Le traitement d’une vidéo peut nécessiter davantage de temps qu’une réponse textuelle."
          ]
        },
        {
          "title": "Notes vocales",
          "paragraphs": [
            "Sur les interfaces compatibles, les notes vocales permettent de s’exprimer sans saisir de texte. Il est possible de préparer un enregistrement, de le réécouter et d’utiliser les options de transcription ou d’envoi proposées.",
            "La qualité d’une transcription dépend de l’environnement sonore, de la prononciation et de la langue utilisée."
          ]
        },
        {
          "title": "ORIA Cours",
          "paragraphs": [
            "ORIA Cours est un espace destiné à transformer la parole en supports de révision et de compréhension. Selon les fonctions proposées, l’utilisateur peut enregistrer une séance, obtenir une transcription puis demander une organisation pédagogique du contenu dans un document.",
            "Le traitement peut comporter plusieurs étapes et une estimation de crédits avant confirmation. L’utilisateur reste responsable du respect des règles applicables à l’enregistrement des cours et de la vérification du document obtenu."
          ]
        },
        {
          "title": "Analyse et présentation de données",
          "paragraphs": [
            "Pour certains travaux, ORIA peut produire des tableaux, des calculs commentés, des graphiques, des schémas ou d’autres représentations visuelles. Ces supports servent à rendre les informations plus faciles à comprendre et à exploiter.",
            "Les résultats importants, notamment lorsqu’ils servent à une décision technique, financière ou scientifique, doivent être contrôlés à partir des données initiales."
          ]
        },
        {
          "title": "Accès Web et Mobile",
          "paragraphs": [
            "ORIA est pensée pour offrir une expérience cohérente sur le Web et sur mobile. La présentation peut varier pour s’adapter à la taille de l’écran, aux autorisations de l’appareil et aux possibilités de chaque plateforme.",
            "Certaines fonctions nécessitent une connexion Internet ou l’accès, avec votre accord, à des éléments comme le microphone, les fichiers ou la position de l’appareil."
          ]
        },
        {
          "title": "Résultats de l’intelligence artificielle",
          "paragraphs": [
            "Les systèmes d’IA peuvent produire des réponses incomplètes ou incorrectes. ORIA vise à faciliter votre travail, sans remplacer l’expertise humaine lorsque l’enjeu nécessite un avis professionnel, une source officielle ou une vérification indépendante."
          ]
        }
      ]
    },
    {
      "id": "privacy",
      "label": "Confidentialité",
      "subtitle": "Comment nous protégeons vos informations",
      "icon": "shield-checkmark-outline",
      "sections": [
        {
          "title": "Notre engagement",
          "paragraphs": [
            "La confidentialité fait partie de notre conception du service. Les informations que vous confiez à ORIA sont utilisées pour assurer votre accès, traiter vos demandes et améliorer la fiabilité de votre expérience.",
            "Nous ne vendons pas vos données personnelles. Nous ne publions pas vos conversations ni vos documents dans un espace accessible aux autres utilisateurs."
          ]
        },
        {
          "title": "Les informations que nous utilisons",
          "paragraphs": [
            "Selon votre utilisation, ORIA peut traiter les informations de création de compte, vos coordonnées, vos préférences, vos conversations, les fichiers que vous joignez, les contenus générés et les données nécessaires au fonctionnement des packs et des crédits.",
            "Lorsque vous utilisez une fonction audio, image ou géolocalisation, les informations correspondantes sont traitées dans le cadre de l’action que vous avez choisie. Vous restez libre de ne pas utiliser les fonctions qui nécessitent ces données."
          ]
        },
        {
          "title": "Pourquoi nous les utilisons",
          "paragraphs": [
            "Ces informations servent principalement à sécuriser votre compte, maintenir vos conversations, exécuter les fonctions demandées, suivre vos crédits, assurer l’assistance et prévenir les usages abusifs.",
            "Les données liées à une opération de paiement sont utilisées pour la prise en charge et la vérification de cette opération, ainsi que pour la gestion des éventuelles réclamations."
          ]
        },
        {
          "title": "Des partenaires techniques pour faire fonctionner ORIA",
          "paragraphs": [
            "Certaines opérations nécessitent l’intervention de prestataires d’hébergement, d’authentification, de paiement ou de modèles d’intelligence artificielle. Les informations utiles à l’opération peuvent leur être transmises dans le cadre de la fourniture du service.",
            "Cette intervention technique ne constitue pas une vente de vos données. Les services externes auxquels vous accédez par un lien disposent, pour leur part, de leurs propres règles de confidentialité."
          ]
        },
        {
          "title": "Vos conversations, documents et créations",
          "paragraphs": [
            "Les contenus que vous envoyez restent associés à votre utilisation du service, selon les fonctionnalités de votre compte. Un document privé ne devient pas public du seul fait de son analyse par ORIA.",
            "Évitez de transmettre des mots de passe, des informations bancaires complètes ou des données sensibles qui ne sont pas nécessaires à votre demande. Si un document contient des renseignements concernant un tiers, veillez à disposer des autorisations appropriées."
          ]
        },
        {
          "title": "Protection et sécurité",
          "paragraphs": [
            "Nous mettons en place des mesures de protection adaptées aux fonctions proposées, notamment l’authentification, le contrôle des accès, la gestion des fichiers et la sécurisation des échanges avec les services techniques.",
            "Aucun service numérique ne peut garantir l’absence totale de risque. Nous encourageons chacun à utiliser un mot de passe robuste et à signaler rapidement toute activité inhabituelle."
          ]
        },
        {
          "title": "Conservation et suppression",
          "paragraphs": [
            "Les informations sont conservées dans la mesure nécessaire à la fourniture du service, à la sécurité, au suivi des opérations et au respect des obligations applicables. Certaines données techniques ou transactionnelles peuvent devoir être maintenues au-delà de la suppression d’un contenu visible.",
            "Vous pouvez demander la suppression de données vous concernant en nous contactant. Nous examinons chaque demande selon sa nature et les obligations légales applicables."
          ]
        },
        {
          "title": "Vos droits",
          "paragraphs": [
            "Vous pouvez demander à accéder aux informations personnelles vous concernant, à les corriger ou à en solliciter la suppression, dans les conditions prévues par la réglementation applicable. Vous pouvez également nous contacter pour toute question sur un traitement ou sur l’utilisation de vos données.",
            "Pour protéger votre compte, nous pouvons demander les éléments nécessaires à la vérification de votre identité avant de donner suite à une demande."
          ]
        },
        {
          "title": "Mineurs et respect de la vie privée",
          "paragraphs": [
            "Nous accordons une attention particulière à la protection des personnes mineures. Leur utilisation d’ORIA doit respecter les autorisations et les règles de représentation légale applicables.",
            "Nous recommandons aux parents et responsables légaux d’accompagner les plus jeunes dans l’utilisation des outils d’intelligence artificielle et le partage de contenus."
          ]
        },
        {
          "title": "Cookies, sessions et préférences",
          "paragraphs": [
            "Sur le Web et sur mobile, ORIA utilise les mécanismes techniques nécessaires à la connexion, au maintien de la session et à l’enregistrement de certains choix, comme la langue ou l’apparence. Ces mécanismes participent au fonctionnement normal de l’application."
          ]
        },
        {
          "title": "Nous contacter au sujet de vos données",
          "paragraphs": [
            "Pour une demande de confidentialité, écrivez à lbv-connect01@gmail.com. Nous étudierons votre demande et vous répondrons selon les règles applicables. La présente politique pourra être mise à jour afin de refléter l’évolution des services et de leurs modalités de traitement."
          ]
        }
      ]
    },
    {
      "id": "terms",
      "label": "Conditions d’utilisation",
      "subtitle": "Le cadre d’utilisation de la plateforme",
      "icon": "document-text-outline",
      "sections": [
        {
          "title": "1. Objet des conditions",
          "paragraphs": [
            "Les présentes conditions encadrent l’accès et l’utilisation d’ORIA, une plateforme d’assistance et de création reposant sur l’intelligence artificielle. L’utilisation du service implique le respect de ces conditions et des règles présentées lors de l’accès aux différentes fonctionnalités.",
            "L’interface, les offres et les fonctions d’ORIA peuvent évoluer afin de répondre aux besoins des utilisateurs et aux contraintes techniques du service."
          ]
        },
        {
          "title": "2. Création et sécurité du compte",
          "paragraphs": [
            "Pour accéder à certaines fonctions, vous devez créer un compte et fournir des informations exactes. Votre compte est personnel. Vous êtes responsable de la confidentialité de vos identifiants et des actions effectuées depuis votre espace.",
            "En cas de suspicion d’accès non autorisé, changez votre mot de passe et contactez notre assistance."
          ]
        },
        {
          "title": "3. Utilisateurs mineurs",
          "paragraphs": [
            "L’utilisation d’ORIA par une personne mineure doit respecter la réglementation applicable, notamment les exigences d’autorisation ou d’accompagnement du représentant légal. Les responsables légaux sont invités à encadrer l’utilisation du service et le partage de données personnelles."
          ]
        },
        {
          "title": "4. Utilisation responsable",
          "paragraphs": [
            "Vous vous engagez à utiliser ORIA dans le respect des lois, des droits d’autrui et des règles de sécurité. Sont notamment interdits les usages visant la fraude, l’usurpation d’identité, la diffusion illicite de données personnelles, les intrusions informatiques non autorisées ou la production de contenus contraires à la loi.",
            "Nous pouvons limiter ou suspendre l’accès à une fonction ou à un compte en cas d’abus, de risque pour la sécurité ou de manquement grave aux présentes conditions."
          ]
        },
        {
          "title": "5. Vos contenus",
          "paragraphs": [
            "Vous restez responsable des informations, textes, images, fichiers et enregistrements que vous transmettez. Vous garantissez disposer des droits et autorisations nécessaires à leur utilisation et à leur traitement dans le cadre du service.",
            "Vous autorisez les traitements techniques nécessaires à l’exécution de vos demandes, conformément à notre Politique de confidentialité."
          ]
        },
        {
          "title": "6. Contenus générés",
          "paragraphs": [
            "Les contenus produits par l’intelligence artificielle peuvent être utilisés dans le respect du droit applicable et des droits de tiers. Il vous revient de contrôler leur exactitude, leur pertinence et leur conformité avant de les diffuser ou de vous en servir.",
            "Les résultats peuvent contenir des erreurs, présenter des similitudes avec d’autres contenus ou nécessiter des adaptations. La génération d’un résultat ne garantit pas l’existence de droits exclusifs sur celui-ci."
          ]
        },
        {
          "title": "7. Apprentissage et travaux scolaires",
          "paragraphs": [
            "ORIA accompagne la compréhension et la préparation des travaux. Son utilisation doit respecter les consignes des établissements d’enseignement, les règles des examens et les exigences d’intégrité académique.",
            "Les réponses apportées ne remplacent ni le travail personnel ni la validation d’un enseignant lorsque celle-ci est requise."
          ]
        },
        {
          "title": "8. Enregistrements et droits des personnes",
          "paragraphs": [
            "Avant d’enregistrer, de transmettre ou de faire transcrire la voix d’une personne, assurez-vous de disposer des autorisations nécessaires. Cette obligation vaut notamment pour les cours, réunions, conférences et conversations privées."
          ]
        },
        {
          "title": "9. Packs, crédits et commandes",
          "paragraphs": [
            "L’accès à certaines fonctions nécessite un pack actif ou un solde de crédits suffisant. Les caractéristiques, prix et limites applicables sont présentés dans l’espace de souscription ou avant l’opération concernée.",
            "Une commande n’est considérée comme réglée qu’après confirmation du paiement. Les modalités de consommation des crédits et de validité des packs sont détaillées dans la rubrique « Packs et crédits »."
          ]
        },
        {
          "title": "10. Paiements et réclamations",
          "paragraphs": [
            "Les paiements peuvent être exécutés par des partenaires spécialisés. En cas de paiement non reconnu, de débit contesté ou d’opération inachevée, contactez l’assistance en indiquant les références utiles, sans transmettre votre mot de passe ni vos codes secrets.",
            "Les demandes de correction, de remboursement ou de résolution sont examinées selon la situation, les conditions de l’offre et la réglementation applicable."
          ]
        },
        {
          "title": "11. Disponibilité et évolution",
          "paragraphs": [
            "Nous nous efforçons de maintenir une expérience stable. Toutefois, des opérations de maintenance, incidents techniques, limitations de capacité ou interruptions de prestataires peuvent affecter temporairement certaines fonctions.",
            "Nous pouvons faire évoluer les modèles, les interfaces et les modalités techniques du service. Lorsque cela est nécessaire, les utilisateurs sont informés des changements importants."
          ]
        },
        {
          "title": "12. Limites des résultats",
          "paragraphs": [
            "L’intelligence artificielle ne garantit pas l’exactitude absolue des réponses. Les contenus portant sur la santé, le droit, la finance, l’ingénierie ou la sécurité doivent être confrontés à des sources fiables et, le cas échéant, à l’avis de professionnels qualifiés."
          ]
        },
        {
          "title": "13. Protection de la plateforme",
          "paragraphs": [
            "Il est interdit de contourner les règles d’accès, de détourner les mécanismes de facturation, de perturber le fonctionnement du service ou de tenter d’accéder aux informations d’autres utilisateurs sans autorisation.",
            "Nous nous réservons la possibilité de prendre des mesures proportionnées pour protéger la plateforme et ses utilisateurs."
          ]
        },
        {
          "title": "14. Modifications des conditions",
          "paragraphs": [
            "Les présentes conditions peuvent être actualisées pour tenir compte de l’évolution des fonctionnalités, des offres ou du cadre réglementaire. La date de mise à jour figure sur cette page. Les changements importants peuvent faire l’objet d’une information spécifique."
          ]
        },
        {
          "title": "15. Assistance et différends",
          "paragraphs": [
            "Pour toute question relative à votre utilisation, à un paiement ou à votre compte, contactez lbv-connect01@gmail.com. Nous privilégions la recherche d’une solution amiable, sans préjudice des droits et recours prévus par la réglementation applicable."
          ]
        }
      ]
    },
    {
      "id": "credits",
      "label": "Packs et crédits",
      "subtitle": "Comprendre votre accès et votre consommation",
      "icon": "wallet-outline",
      "sections": [
        {
          "title": "Des offres adaptées à différents usages",
          "paragraphs": [
            "ORIA propose plusieurs formules d’accès : Léger, Intermédiaire, Pro et Business. Chaque pack donne accès à un ensemble déterminé de fonctions, de modèles et de capacités de création.",
            "Les fonctionnalités incluses et les éventuelles limites sont précisées dans la présentation de chaque offre. Une fonction non incluse dans votre pack peut nécessiter un changement d’offre ou ne pas être disponible."
          ]
        },
        {
          "title": "Une durée de validité définie",
          "paragraphs": [
            "Les packs ORIA sont organisés autour d’une période de validité de 35 jours, sauf indication différente clairement présentée pour une offre donnée. La période applicable et les informations de votre accès sont consultables depuis votre compte.",
            "La fin de validité d’un pack peut modifier les fonctionnalités accessibles et les conditions d’utilisation des crédits associés."
          ]
        },
        {
          "title": "Le principe des crédits",
          "paragraphs": [
            "Les crédits servent à mesurer la consommation de certaines actions : demandes aux modèles, analyse de documents, génération d’images ou de vidéos et autres traitements proposés. Le coût dépend de la fonction, de la configuration choisie et, dans certains cas, du volume traité.",
            "Votre solde et l’historique disponible dans l’application vous permettent de suivre votre consommation."
          ]
        },
        {
          "title": "Un coût présenté avant les opérations concernées",
          "paragraphs": [
            "Lorsque le service propose un devis ou une estimation, vous pouvez consulter le coût prévu avant de confirmer l’action. Pour les traitements variables, le montant final suit les règles affichées et les opérations réellement exécutées.",
            "Les réservations temporaires de crédits peuvent être utilisées pour sécuriser une opération en cours. Leur traitement dépend de l’issue de cette opération."
          ]
        },
        {
          "title": "Création d’images et de vidéos",
          "paragraphs": [
            "Les options de génération peuvent présenter des coûts distincts selon le format, la qualité, la durée et le niveau de service. Seules les configurations offertes par votre pack sont accessibles.",
            "Les informations de tarification affichées au moment de la demande font référence pour la configuration sélectionnée."
          ]
        },
        {
          "title": "Documents et enregistrements",
          "paragraphs": [
            "Certaines fonctions, notamment le traitement de contenus longs, peuvent comporter plusieurs étapes. Lorsque cela s’applique, une estimation précède le traitement payant afin de vous permettre de choisir de poursuivre ou non."
          ]
        },
        {
          "title": "Paiements",
          "paragraphs": [
            "Les moyens de paiement disponibles sont indiqués dans l’application et peuvent varier selon votre pays. Le règlement est pris en compte après confirmation de la transaction par le service de paiement.",
            "Les prix et les devises affichés au moment de la commande sont ceux applicables à l’achat envisagé."
          ]
        },
        {
          "title": "Accéder à votre suivi",
          "paragraphs": [
            "Votre espace Crédits vous permet de consulter les informations mises à disposition sur votre solde et vos opérations. Votre espace Packs présente les offres et les droits associés à votre accès.",
            "Si vous constatez une incohérence, transmettez à l’assistance les éléments permettant d’identifier l’opération."
          ]
        },
        {
          "title": "Incidents et corrections",
          "paragraphs": [
            "En cas de traitement interrompu, de paiement non confirmé ou de consommation contestée, nos mécanismes de suivi et notre assistance permettent d’examiner la situation.",
            "Une interruption technique ne donne pas automatiquement lieu à une facturation définitive ; l’issue dépend de l’état réel de l’opération et des règles applicables à la fonction concernée."
          ]
        },
        {
          "title": "Évolution des offres",
          "paragraphs": [
            "Les caractéristiques des packs et les coûts de certaines fonctions peuvent évoluer. Les informations présentées avant l’achat ou l’utilisation de la fonction permettent de connaître les conditions applicables à votre choix."
          ]
        },
        {
          "title": "Une question sur votre solde ?",
          "paragraphs": [
            "Notre assistance est accessible à lbv-connect01@gmail.com. Pour faciliter le traitement d’une demande, indiquez la date, la fonction concernée et, si possible, l’identifiant de l’opération, sans communiquer d’informations de connexion sensibles."
          ]
        }
      ]
    },
    {
      "id": "principles",
      "label": "Nos engagements",
      "subtitle": "Les principes qui orientent ORIA",
      "icon": "sparkles-outline",
      "sections": [
        {
          "title": "Clarté",
          "paragraphs": [
            "Nous voulons une intelligence artificielle compréhensible. Les interfaces, les explications et les étapes d’utilisation doivent aider chacun à savoir ce qu’il fait, ce qu’il obtient et les éventuelles limites du résultat."
          ]
        },
        {
          "title": "Liberté d’apprendre et de créer",
          "paragraphs": [
            "Nous croyons aux outils qui renforcent l’autonomie. ORIA accompagne la curiosité, le travail personnel, la maîtrise de nouvelles compétences et l’expression des idées."
          ]
        },
        {
          "title": "Respect de la vie privée",
          "paragraphs": [
            "Nous considérons les conversations, les documents et les informations de compte comme des éléments qui méritent protection et discrétion. Leur traitement est encadré par la fourniture du service et les engagements de confidentialité présentés sur cette page."
          ]
        },
        {
          "title": "Des coûts compréhensibles",
          "paragraphs": [
            "Nous cherchons à rendre les offres et la consommation de crédits lisibles, en privilégiant l’affichage des paramètres utiles avant les actions qui engagent des ressources."
          ]
        },
        {
          "title": "Responsabilité",
          "paragraphs": [
            "Les systèmes d’IA peuvent se tromper. Nous encourageons l’esprit critique, la vérification des informations et le recours à une expertise humaine lorsque les conséquences d’une décision le nécessitent."
          ]
        },
        {
          "title": "Amélioration continue",
          "paragraphs": [
            "La qualité d’un service numérique repose sur l’écoute, la correction des difficultés et la régularité des améliorations. Les retours de nos utilisateurs contribuent à faire progresser ORIA dans la durée."
          ]
        },
        {
          "title": "Accessibilité",
          "paragraphs": [
            "Nous développons ORIA avec l’objectif d’élargir l’accès à des outils numériques utiles, notamment pour les publics scolaires et universitaires d’Afrique francophone."
          ]
        }
      ]
    },
    {
      "id": "legal",
      "label": "Informations légales",
      "subtitle": "Édition du service et contact",
      "icon": "business-outline",
      "sections": [
        {
          "title": "ORIA",
          "paragraphs": [
            "ORIA est un service numérique d’assistance et de création par intelligence artificielle, destiné notamment aux utilisateurs du Gabon et de l’espace francophone. Il est présenté et exploité sous la marque ORIA."
          ]
        },
        {
          "title": "Contact",
          "paragraphs": [
            "Pour toute demande relative au service, à votre compte, à la confidentialité ou à une opération, vous pouvez joindre l’équipe ORIA à l’adresse lbv-connect01@gmail.com."
          ]
        },
        {
          "title": "Conditions et confidentialité",
          "paragraphs": [
            "Les rubriques « Conditions d’utilisation » et « Confidentialité » précisent les règles d’accès au service, les responsabilités des utilisateurs ainsi que les principes de traitement des informations personnelles.",
            "En cas d’évolution de ces textes, la date de mise à jour figurant dans le Centre d’informations est actualisée."
          ]
        },
        {
          "title": "Propriété intellectuelle",
          "paragraphs": [
            "Le nom ORIA, sa présentation, ses éléments distinctifs et les composants originaux de la plateforme sont protégés dans les conditions prévues par le droit applicable. Leur reproduction ou leur exploitation non autorisée n’est pas permise.",
            "Les droits relatifs aux contenus fournis par les utilisateurs et aux résultats générés sont traités conformément aux Conditions d’utilisation et aux droits des tiers."
          ]
        },
        {
          "title": "Fourniture du service",
          "paragraphs": [
            "ORIA s’appuie sur des technologies et des prestataires nécessaires à l’hébergement, à l’authentification, au traitement des demandes et aux paiements. Les règles propres aux services externes peuvent s’appliquer lorsqu’ils sont utilisés."
          ]
        },
        {
          "title": "Droit applicable et demandes",
          "paragraphs": [
            "Les relations liées à l’utilisation d’ORIA s’inscrivent dans le cadre des dispositions légales et réglementaires applicables, notamment au Gabon, sans préjudice des protections impératives dont bénéficient les utilisateurs selon leur situation.",
            "Pour signaler un contenu, exercer un droit ou soumettre une réclamation, contactez lbv-connect01@gmail.com."
          ]
        },
        {
          "title": "Mise à jour des informations",
          "paragraphs": [
            "Ces informations sont susceptibles d’être adaptées pour suivre l’évolution de la plateforme, de son organisation et des services proposés. La date affichée en haut de page permet d’identifier l’édition consultée."
          ]
        }
      ]
    }
  ]
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Tab = (typeof content.tabs)[number];
const ICONS: Record<string, IconName> = {
  about: "information-circle-outline", working: "layers-outline", privacy: "shield-checkmark-outline",
  terms: "document-text-outline", credits: "wallet-outline", principles: "sparkles-outline", legal: "business-outline",
};

export default function OriaLegalMobileScreen() {
  const router = useRouter();
  const { tab, from } = useLocalSearchParams<{ tab?: string | string[]; from?: string | string[] }>();
  const queryTab = Array.isArray(tab) ? tab[0] : tab;
  const cameFromSignup = (Array.isArray(from) ? from[0] : from) === "signup";
  const [manualTab, setManualTab] = useState<string | null>(null);
  const [scrollKey, setScrollKey] = useState(0);
  const activeId = manualTab ?? (content.tabs.some((entry) => entry.id === queryTab) ? queryTab : "about");
  const current = useMemo<Tab>(() => content.tabs.find((entry) => entry.id === activeId) ?? content.tabs[0], [activeId]);

  const goBack = () => {
    if (cameFromSignup) {
      if (router.canGoBack()) router.back();
      else router.replace("/register" as never);
    } else {
      router.replace("/settings" as never);
    }
  };
  const openEmail = () => { void Linking.openURL(`mailto:${content.email}`); };
  const choose = (value: string) => { setManualTab(value); setScrollKey((v) => v + 1); };

  return (
    <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor="#0b0d13" />
      <View style={s.topbar}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={cameFromSignup ? "Revenir à l'inscription" : "Revenir aux paramètres"} style={s.back}>
          <Ionicons name="arrow-back" size={20} color="#f5f6fa" />
          <Text style={s.backText}>{cameFromSignup ? "Inscription" : "Paramètres"}</Text>
        </Pressable>
        <Text style={s.wordmark}>ORIA<Text style={s.accent}>.</Text></Text>
      </View>
      <ScrollView key={scrollKey} showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>TRANSPARENCE & CONFIANCE</Text>
        <Text style={s.title}>Informations et politiques</Text>
        <Text style={s.intro}>{content.intro}</Text>
        <Text style={s.meta}>Mis à jour le {content.updated}</Text>

        <View style={s.nav} accessibilityRole="tablist">
          {content.tabs.map((item) => {
            const selected = item.id === current.id;
            return (
              <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => choose(item.id)} style={[s.navItem, selected && s.navSelected]}>
                <Ionicons name={ICONS[item.id] || "reader-outline"} size={19} color={selected ? "#d0c6ff" : "#a7aab6"} />
                <Text numberOfLines={2} style={[s.navLabel, selected && s.navLabelSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.panel}>
          <View style={s.panelTitleRow}>
            <View style={s.iconBox}><Ionicons name={ICONS[current.id] || "reader-outline"} size={24} color="#c0b4ff" /></View>
            <View style={s.titleWrap}><Text style={s.panelTitle}>{current.label}</Text><Text style={s.panelSubtitle}>{current.subtitle}</Text></View>
          </View>
          {current.sections.map((section, index) => (
            <View key={`${current.id}-${index}`} style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>{section.title}</Text>
              </View>
              {"paragraphs" in section && section.paragraphs?.map((value, i) => <Text key={i} style={s.paragraph}>{value}</Text>)}
              {"bullets" in section && section.bullets?.map((value, i) => (
                <View key={i} style={s.bulletRow}><Text style={s.bullet}>•</Text><Text style={s.bulletText}>{value}</Text></View>
              ))}
            </View>
          ))}
          <View style={s.contact}>
            <Text style={s.contactHeading}>Besoin d'aide ?</Text>
            <Pressable onPress={openEmail} accessibilityRole="link" style={s.emailRow}>
              <Ionicons name="mail-outline" color="#c0b4ff" size={19} />
              <Text style={s.email} selectable>{content.email}</Text>
              <Ionicons name="open-outline" color="#c0b4ff" size={16} />
            </Pressable>
          </View>
        </View>
        <Text style={s.footer}>© ORIA · Informations et politiques · {content.updated}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#0b0d13"},
  topbar:{paddingHorizontal:17,paddingVertical:11,borderBottomWidth:1,borderBottomColor:"#252731",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{flexDirection:"row",alignItems:"center",gap:9,borderWidth:1,borderColor:"#30323b",borderRadius:13,backgroundColor:"#171922",paddingHorizontal:13,paddingVertical:11},
  backText:{fontSize:13,color:"#f3f4f8",fontWeight:"600"},
  wordmark:{fontSize:19,fontWeight:"900",color:"#fff",letterSpacing:2},accent:{color:"#afa5ff"},
  content:{paddingHorizontal:18,paddingTop:30,paddingBottom:55},
  eyebrow:{color:"#b5aaff",fontSize:10,letterSpacing:2.5,fontWeight:"800",marginBottom:12},
  title:{color:"#fff",fontSize:29,letterSpacing:-.7,fontWeight:"800",lineHeight:35},
  intro:{color:"#b1b5c2",fontSize:14,lineHeight:23,marginTop:12},
  meta:{color:"#9da3b2",fontSize:12,marginTop:14},
  nav:{flexDirection:"row",flexWrap:"wrap",gap:9,marginTop:27,marginBottom:22},
  navItem:{width:"48%",minHeight:74,borderWidth:1,borderColor:"#282b34",backgroundColor:"#151821",borderRadius:16,padding:12,flexDirection:"row",gap:10,alignItems:"center"},
  navSelected:{borderColor:"#8576cc",backgroundColor:"#262139"},
  navLabel:{color:"#e0e2e9",fontSize:12,lineHeight:17,flexShrink:1,fontWeight:"600"},
  navLabelSelected:{color:"#fff"},
  panel:{borderRadius:24,backgroundColor:"#151821",borderWidth:1,borderColor:"#282b34",padding:19},
  panelTitleRow:{flexDirection:"row",alignItems:"center",gap:14,paddingBottom:20,borderBottomWidth:1,borderBottomColor:"#2d303b"},
  iconBox:{width:48,height:48,borderRadius:15,backgroundColor:"#2c2540",alignItems:"center",justifyContent:"center"},
  titleWrap:{flex:1},panelTitle:{fontSize:22,fontWeight:"800",color:"#fff",lineHeight:28},panelSubtitle:{fontSize:12,color:"#aeb0bd",marginTop:3},
  section:{paddingTop:23},sectionHeader:{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:12},
  sectionTitle:{color:"#f6f6f9",fontWeight:"700",fontSize:16,lineHeight:23,flexShrink:1},
  paragraph:{fontSize:13.5,lineHeight:23,color:"#c9ccd6",marginBottom:12},
  bulletRow:{flexDirection:"row",gap:10,marginBottom:10},bullet:{color:"#afa5ff",fontSize:16,lineHeight:22},bulletText:{color:"#c9ccd6",fontSize:13.5,lineHeight:22,flex:1},
  contact:{marginTop:28,paddingTop:20,borderTopWidth:1,borderTopColor:"#30333c"},contactHeading:{color:"#a7acba",fontSize:13,marginBottom:12},
  emailRow:{flexDirection:"row",gap:10,alignItems:"center",flexWrap:"wrap"},email:{color:"#c0b4ff",fontWeight:"700",fontSize:13.5},
  footer:{textAlign:"center",color:"#838997",fontSize:11,marginTop:28}
});
