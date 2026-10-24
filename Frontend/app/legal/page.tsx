"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, FileText, Layers3,
  Mail, ScrollText, ShieldCheck, Sparkles, Wallet,
} from "lucide-react";
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

const icons = {
  about: BookOpen,
  working: Layers3,
  privacy: ShieldCheck,
  terms: ScrollText,
  credits: Wallet,
  principles: Sparkles,
  legal: FileText,
} as const;

type TabId = keyof typeof icons;

function validTab(value: string | null): TabId | null {
  return value && Object.prototype.hasOwnProperty.call(icons, value)
    ? (value as TabId)
    : null;
}

export default function OriaLegalPage() {
  const [tab, setTab] = useState<TabId>("about");
  const [fromSignup, setFromSignup] = useState(false);

  useEffect(() => {
    const sync = () => {
      const q = new URLSearchParams(window.location.search);
      setTab(validTab(q.get("tab")) || "about");
      setFromSignup(q.get("from") === "signup");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const selected = useMemo(() => content.tabs.find((item) => item.id === tab) || content.tabs[0], [tab]);
  const Icon = icons[tab];
  const changeTab = (value: TabId) => {
    setTab(value);
    const q = new URLSearchParams(window.location.search);
    q.set("tab", value);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
    document.getElementById("oria-legal-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="min-h-dvh bg-[#0b0d13] text-[#f5f6fa] antialiased">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 pb-8 pt-5 sm:px-6 md:px-8">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 pb-5">
          <Link href={fromSignup ? "/register" : "/settings"}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b7a9ff]">
            <ArrowLeft size={18} aria-hidden /> {fromSignup ? "Retour à l'inscription" : "Retour aux paramètres"}
          </Link>
          <span className="text-base font-extrabold tracking-[.2em] text-white">ORIA<span className="text-[#aaa1ff]">.</span></span>
        </header>

        <section className="max-w-3xl pb-8 pt-9">
          <p className="text-xs font-semibold uppercase tracking-[.22em] text-[#b2a7ff]">Transparence & confiance</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Informations et politiques</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#abb0be] sm:text-base">{content.intro}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#a5abb9]">
            <span>Mis à jour le {content.updated}</span>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[290px_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Rubriques du centre d'informations" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:sticky lg:top-5 lg:flex lg:flex-col">
            {content.tabs.map((item) => {
              const RowIcon = icons[item.id as TabId];
              const active = item.id === tab;
              return (
                <button key={item.id} type="button" onClick={() => changeTab(item.id as TabId)} aria-current={active ? "page" : undefined}
                  className={`group flex min-h-[75px] items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b7a9ff] lg:min-h-[67px] ${active ? "border-[#8577dc]/60 bg-[#211e35]" : "border-white/[0.08] bg-[#161922] hover:border-white/20 hover:bg-[#1d202a]"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-[#4d416d] text-[#ded7ff]" : "bg-white/[0.05] text-[#a6aab5]"}`}>
                    <RowIcon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white">{item.label}</span>
                    <span className="mt-0.5 hidden text-xs leading-4 text-[#9fa4b3] lg:block">{item.subtitle}</span>
                  </span>
                  <ChevronRight size={15} className="hidden text-[#9da0aa] lg:block" aria-hidden />
                </button>
              );
            })}
          </nav>

          <article id="oria-legal-content" className="min-w-0 rounded-[25px] border border-white/[0.09] bg-[#151821] p-5 shadow-[0_20px_60px_rgba(0,0,0,.16)] sm:p-7 lg:min-h-[680px] lg:p-9">
            <div className="flex items-center gap-3 border-b border-white/[0.09] pb-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#29233d] text-[#c1b8ff]"><Icon size={23} aria-hidden /></span>
              <div>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{selected.label}</h2>
                <p className="mt-1 text-sm text-[#9ca4b4]">{selected.subtitle}</p>
              </div>
            </div>
            <div className="space-y-9 py-7">
              {selected.sections.map((section, index) => (
                <section key={`${selected.id}-${index}`} className="max-w-[75ch]">
                  <h3 className="mb-3 flex flex-wrap items-center gap-2 text-base font-semibold text-[#f7f7fb] sm:text-lg">
                    {section.title}
                  </h3>
                  {"paragraphs" in section && section.paragraphs?.map((text, i) => <p key={i} className="mb-3 text-sm leading-[1.9] text-[#c8cbd4]">{text}</p>)}
                  {"bullets" in section && section.bullets ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-[1.85] text-[#c8cbd4]">{section.bullets.map((value, i) => <li key={i}>{value}</li>)}</ul> : null}
                </section>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-sm text-[#a5adbb]">
              <span>Une question sur vos données ou votre compte ?</span>
              <a href={`mailto:${content.email}`} className="inline-flex items-center gap-2 font-semibold text-[#c2baff] hover:text-white"><Mail size={16} aria-hidden /> {content.email} <ArrowUpRight size={14} aria-hidden /></a>
            </div>
          </article>
        </div>
        <footer className="pt-8 text-center text-xs text-[#7e8493]">© ORIA · Informations et politiques · {content.updated}</footer>
      </div>
    </main>
  );
}
