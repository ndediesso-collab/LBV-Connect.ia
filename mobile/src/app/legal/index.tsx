import React, { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
// ORIA : contenu integre dans ce fichier. Aucun legal-content.json requis.
type LegalSection = {
  title: string;
  review?: boolean;
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
  version: string;
  updated: string;
  status: string;
  email: string;
  intro: string;
  tabs: LegalTab[];
};

const content: LegalContent = {
  "title": "ORIA — Informations et politiques",
  "version": "0.2 — Projet approfondi à valider",
  "updated": "24 octobre 2026",
  "status": "draft",
  "email": "lbv-connect01@gmail.com",
  "intro": "Comprendre ORIA, ses possibilités réelles, la gestion des crédits, nos engagements et vos droits sur vos données.",
  "tabs": [
    {
      "id": "about",
      "label": "À propos",
      "subtitle": "Notre mission et notre vision",
      "icon": "information-circle-outline",
      "sections": [
        {
          "title": "ORIA, pour apprendre et créer",
          "paragraphs": [
            "ORIA est une plateforme d’intelligence artificielle multifonctionnelle pensée d’abord pour les élèves, les étudiants et les créateurs au Gabon, puis plus largement pour l’Afrique francophone. Sa vision : rendre les outils d’IA plus accessibles, sans renoncer à la clarté ni à la responsabilité.",
            "Notre philosophie repose sur la liberté d’apprendre, de comprendre et de créer. ORIA ne remplace ni un enseignant, ni un professionnel, ni le jugement personnel de l’utilisateur."
          ]
        },
        {
          "title": "Les quatre piliers",
          "bullets": [
            "Apprendre : étudier, préparer ses exercices et organiser ses cours.",
            "Comprendre : obtenir des explications, analyser des fichiers et mobiliser différents modes de raisonnement.",
            "Créer : produire du texte, du code, des documents, des images et des vidéos lorsque les fonctions correspondantes sont disponibles.",
            "Rendre l’IA accessible : utiliser des packs et des crédits adaptés aux usages."
          ],
          "paragraphs": []
        },
        {
          "title": "Un service en développement",
          "paragraphs": [
            "Certaines fonctionnalités décrites dans le bilan fonctionnel d’ORIA sont développées mais encore en cours de validation technique. Leur présence dans l’interface ne garantit pas une disponibilité continue ni une réussite systématique."
          ]
        },
        {
          "title": "À qui s’adresse ORIA ?",
          "paragraphs": [
            "ORIA a été pensée en priorité pour les élèves et étudiants du Gabon, puis pour les utilisateurs d’Afrique francophone. Elle peut également accompagner d’autres profils : enseignants, développeurs, entrepreneurs, créateurs de contenus et professionnels recherchant un outil de rédaction ou d’analyse.",
            "Les outils pédagogiques ont pour vocation de soutenir le travail personnel. Ils ne remplacent pas les cours, les évaluations, l’encadrement d’un enseignant ou une démarche d’apprentissage autonome."
          ]
        },
        {
          "title": "Une seule interface pour plusieurs besoins",
          "paragraphs": [
            "Plutôt que multiplier les applications spécialisées, ORIA cherche à réunir conversation, analyse d’images, lecture de documents, code, recherche Web, création de fichiers, génération d’images et de vidéos, et outils de traitement des cours.",
            "Toutes ces possibilités ne sont pas disponibles avec chaque pack ni nécessairement ouvertes au même stade du développement. L’utilisateur doit se référer aux fonctions réellement proposées dans son application."
          ]
        },
        {
          "title": "Accessibilité locale et expansion progressive",
          "paragraphs": [
            "Le projet privilégie des parcours adaptés aux habitudes du marché gabonais et envisage le paiement par les moyens mobiles courants. L’ambition à plus long terme est de servir les utilisateurs francophones de plusieurs pays africains.",
            "La disponibilité territoriale des paiements, des modèles et de l’application peut varier selon les partenaires et leurs restrictions."
          ]
        },
        {
          "title": "Ce qu’ORIA ne prétend pas être",
          "paragraphs": [
            "ORIA n’est pas un établissement scolaire, un professeur agréé, un service de diagnostic médical, un cabinet juridique ou une institution financière. Ses réponses sont générées par des systèmes automatisés et doivent être contrôlées lorsque leur fiabilité est importante."
          ]
        },
        {
          "title": "Contact et amélioration continue",
          "paragraphs": [
            "Pour signaler une anomalie, demander de l’aide ou proposer une amélioration, vous pouvez écrire à lbv-connect01@gmail.com. Les signalements permettront de prioriser la stabilité, l’accessibilité et la clarté des fonctionnalités."
          ]
        }
      ]
    },
    {
      "id": "working",
      "label": "Fonctionnement",
      "subtitle": "Comment utiliser ORIA",
      "icon": "layers-outline",
      "sections": [
        {
          "title": "Discuter avec ORIA",
          "paragraphs": [
            "Le Chat permet de poser des questions, demander des explications, analyser des fichiers et obtenir du code. Selon le pack, l’utilisateur peut choisir un modèle et un mode de raisonnement (Rapide, Équilibré, Approfondi).",
            "L’interface peut afficher progressivement les réponses, conserver les conversations et proposer une fonction de modification d’une réponse en cours."
          ]
        },
        {
          "title": "Les documents et le code",
          "paragraphs": [
            "ORIA prévoit la lecture de fichiers PDF, Word, Excel, CSV, textes et présentations. Son moteur de création peut produire plusieurs familles de fichiers téléchargeables. Les formats disponibles dépendent de la configuration réelle du service.",
            "Le code généré n’est pas nécessairement exécuté, testé ou sécurisé. L’utilisateur doit le contrôler avant toute utilisation en production."
          ]
        },
        {
          "title": "Recherche Web, images et visuels",
          "paragraphs": [
            "La recherche Web est activable dans le Chat. Des liens et illustrations peuvent accompagner les réponses quand les sources le permettent. Les images jointes peuvent être analysées selon les capacités du modèle utilisé.",
            "Le mini-studio Image/Vidéo présente les configurations accessibles pour le pack actif. Le format, la durée, la qualité et le coût effectifs sont déterminés par les options et contrôles du service, et non par les illustrations d’interface."
          ]
        },
        {
          "title": "ORIA Cours et notes vocales",
          "paragraphs": [
            "ORIA Cours est conçu pour enregistrer des cours, préparer une transcription et produire un support pédagogique (PDF ou Word) après validation d’un devis. Le bilan technique prévoit des enregistrements découpés en segments, avec une durée maximale configurée de quatre heures par cours. Le traitement complet nécessite encore des tests de bout en bout.",
            "Les notes vocales du Chat constituent un parcours distinct : enregistrer, réécouter, transcrire, envoyer comme audio ou modifier le texte reconnu. Le traitement et la facturation dépendent de l’étape réellement déclenchée."
          ]
        },
        {
          "title": "Historique et mémoire",
          "paragraphs": [
            "Les conversations peuvent être conservées pour permettre leur reprise. Le backend possède un mécanisme de mémoire conversationnelle qui synthétise parfois les échanges anciens pour maintenir le contexte ; cela ne garantit pas que chaque détail soit mémorisé."
          ]
        },
        {
          "title": "Évolutions futures",
          "paragraphs": [
            "Les appels vocaux en temps réel, la transcription de discours en direct et certaines fonctions pédagogiques avancées sont des projets futurs. Elles ne doivent pas être considérées comme disponibles tant qu’ORIA ne les annonce pas explicitement."
          ]
        },
        {
          "title": "Modèles d’IA et accès selon le pack",
          "paragraphs": [
            "ORIA est conçue pour proposer plusieurs modèles de la famille GPT et des accès différenciés suivant le pack. Le bilan fonctionnel du 23 octobre 2026 mentionne notamment GPT-6 Luna, GPT-5, GPT-5.6 Terra, GPT-6 Sol et GPT-6 Astra comme configurations de l’application.",
            "Cette liste décrit une configuration de développement à une date donnée, non une garantie que chaque modèle sera disponible en permanence ou pour tous les utilisateurs. Les options autorisées doivent être confirmées par le serveur."
          ]
        },
        {
          "title": "Modes de raisonnement",
          "paragraphs": [
            "Les modes Rapide, Équilibré et Approfondi visent des besoins différents : réponse courante, explication structurée ou tâche complexe. Leur effet concret dépend des capacités du modèle sélectionné, de la demande et des limites techniques.",
            "Un niveau plus approfondi ne garantit ni exactitude absolue, ni réponse plus pertinente dans tous les cas."
          ]
        },
        {
          "title": "Conversations longues et modification des réponses",
          "paragraphs": [
            "Lorsqu’une discussion devient longue, ORIA peut s’appuyer sur une synthèse de contexte au lieu de renvoyer sans fin tous les anciens messages. Certains éléments peuvent ne pas être retenus dans cette synthèse.",
            "Le projet comprend aussi un mécanisme pour réorienter une réponse pendant sa génération. Cette capacité doit être vérifiée en conditions réelles, notamment lorsque plusieurs opérations ont lieu simultanément."
          ]
        },
        {
          "title": "Joindre des documents ou des images",
          "paragraphs": [
            "Le Chat peut recevoir des documents ou images pour en extraire des éléments, les expliquer ou répondre à des questions. La qualité de l’analyse dépend du format, de la lisibilité et des capacités du modèle.",
            "Des limites de nombre, de taille et de formats de fichiers sont appliquées par les interfaces et les services. Un fichier joint ne devient pas automatiquement un document public."
          ]
        },
        {
          "title": "Produire des fichiers et retrouver ses créations",
          "paragraphs": [
            "L’architecture comporte un moteur destiné à fabriquer de véritables fichiers : documents, tableaux, présentations, textes de programmation et archives. La prise en charge exacte de chaque extension dépend des modules installés et des tests de génération.",
            "Les créations peuvent être associées au compte et à une conversation et, lorsque le parcours fonctionne, consultées ou téléchargées depuis l’espace personnel. Aucun téléchargement ne doit être considéré comme garanti avant sa livraison effective."
          ]
        },
        {
          "title": "Aide à la programmation",
          "paragraphs": [
            "ORIA peut expliquer du code, proposer des correctifs, produire plusieurs fichiers sources et présenter de longs programmes dans un lecteur adapté. Les fichiers obtenus ne sont pas automatiquement exécutés, testés, audités ni exempts de failles de sécurité.",
            "Avant d’exécuter un programme, contrôlez ses dépendances, ses autorisations et son comportement, particulièrement s’il accède à des données privées ou à un système informatique."
          ]
        },
        {
          "title": "Génération d’images et mini-studio",
          "paragraphs": [
            "Le mini-studio Image permet de rédiger une description et de sélectionner une configuration autorisée par le pack actif. Les familles mentionnées dans le bilan sont Image Essentielle, Image Plus, Image Pro et Image Business, avec des variantes de qualité.",
            "Les images de présentation des cartes du mini-studio sont illustratives. Une illustration ne constitue pas une preuve du résultat ou de la qualité qui sera produit par un modèle."
          ]
        },
        {
          "title": "Génération de vidéos",
          "paragraphs": [
            "Le mini-studio Vidéo permet de choisir parmi des durées et qualités préconfigurées. Le bilan recense des variantes Léger, Intermédiaire, Pro et Business, dont des formats courts et une option d’extension vidéo.",
            "Chaque option dépend de la disponibilité effective du fournisseur vidéo et de l’action autorisée côté backend. Certaines variantes prévues peuvent rester temporairement indisponibles tant que leurs appels réels n’ont pas été validés."
          ]
        },
        {
          "title": "ORIA Cours : enregistrer et transformer un cours",
          "paragraphs": [
            "ORIA Cours constitue un espace distinct des notes vocales du Chat. Il est conçu pour donner un titre à une séance, choisir un format final PDF ou Word, enregistrer un cours, reprendre l’enregistrement et réécouter les segments.",
            "Le bilan technique prévoit jusqu’à quatre heures par séance, découpées en segments d’une durée maximale de cinq minutes. Ces limites sont des paramètres de développement qui doivent être confirmés par les tests réels et les capacités de l’appareil."
          ]
        },
        {
          "title": "ORIA Cours : étapes de traitement",
          "paragraphs": [
            "Après la soumission, le service prévoit un devis avant le traitement payant, une transcription automatique, puis une réécriture pédagogique section par section. Le bilan mentionne gpt-4o-mini-transcribe pour la transcription et GPT-6 Luna pour la structuration des cours.",
            "Le résultat envisagé comprend un document pédagogique téléchargeable et une transcription séparée. Le système conserve des états de travail pour mieux gérer l’attente de crédits, les reprises et les interruptions. Ce parcours complet doit encore être vérifié de bout en bout."
          ]
        },
        {
          "title": "Notes vocales du Chat",
          "paragraphs": [
            "Une note vocale courte peut être enregistrée et réécoutée avant envoi. Le parcours prévoit deux choix distincts : transmettre la note audio avec accès à sa transcription ou convertir les paroles reconnues en texte modifiable avant envoi.",
            "Un enregistrement conservé uniquement en brouillon ne devrait pas déclencher, à lui seul, une transcription payante ; la facturation dépend des actions réellement effectuées par le serveur."
          ]
        },
        {
          "title": "Recherche Web et sources",
          "paragraphs": [
            "Lorsque le mode Recherche Web est activé, ORIA peut chercher des informations externes et les compléter par des illustrations ou des liens utiles. Les résultats peuvent être incomplets, biaisés, indisponibles ou devenir obsolètes.",
            "L’utilisateur doit consulter les sources d’origine lorsque la date, les détails ou la fiabilité d’une information sont essentiels."
          ]
        },
        {
          "title": "Analyse de données et supports visuels",
          "paragraphs": [
            "ORIA peut présenter des tableaux, graphiques, indicateurs, équations, schémas, représentations géométriques, scènes tridimensionnelles et cartes lorsque l’interface et le modèle le permettent.",
            "Un visuel généré ne prouve pas qu’un calcul ou une analyse statistique a été exécuté par un moteur scientifique indépendant. Les résultats importants doivent être contrôlés."
          ]
        },
        {
          "title": "Plateformes et disponibilité",
          "paragraphs": [
            "Le projet prévoit une application Web Next.js et une application mobile Expo/React Native sur Android et iPhone, reposant sur un backend FastAPI. Selon le moment, certaines capacités peuvent être disponibles sur une plateforme avant l’autre.",
            "Une connexion Internet, un compte actif et les autorisations nécessaires (fichiers, caméra ou microphone selon l’action) peuvent être requis. Les traitements longs peuvent dépendre d’une file d’attente et des services externes."
          ]
        }
      ]
    },
    {
      "id": "privacy",
      "label": "Confidentialité",
      "subtitle": "Données personnelles et droits",
      "icon": "shield-checkmark-outline",
      "sections": [
        {
          "title": "1. Objet de cette politique",
          "paragraphs": [
            "Cette politique provisoire explique les catégories de données susceptibles d’être traitées dans ORIA, pourquoi elles sont utilisées et comment contacter l’équipe. Elle doit être complétée avant la publication officielle, en particulier avec l’identité du responsable de traitement et les durées de conservation."
          ]
        },
        {
          "title": "2. Qui est responsable ?",
          "paragraphs": [
            "Service concerné : ORIA. Contact relatif aux données personnelles : lbv-connect01@gmail.com.",
            "[À COMPLÉTER AVANT PUBLICATION] Nom ou raison sociale du responsable de traitement, statut juridique, adresse postale, éventuel représentant et délégué à la protection des données."
          ],
          "review": true
        },
        {
          "title": "3. Quelles données sont concernées ?",
          "bullets": [
            "Compte : identifiant de compte, adresse électronique et éléments nécessaires à l’authentification via Supabase.",
            "Conversations : messages envoyés, réponses, paramètres de discussion et historique associé.",
            "Contenus : fichiers, images, code, créations générées et pièces jointes fournies volontairement.",
            "Audio : notes vocales, segments d’enregistrement, transcriptions et métadonnées de traitement quand ces fonctionnalités sont utilisées.",
            "Service : pack actif, crédits, réservations, historique d’opérations, états de traitement et données techniques nécessaires à la sécurité.",
            "Interface : préférences de langue et d’apparence, données temporaires de cache local."
          ],
          "paragraphs": [
            "Les informations contenues dans un document, une photo ou un enregistrement peuvent elles-mêmes être personnelles ou sensibles. Évitez d’envoyer des données de tiers sans autorisation appropriée."
          ]
        },
        {
          "title": "4. Pourquoi ces données sont-elles traitées ?",
          "bullets": [
            "Créer le compte, authentifier l’utilisateur et protéger l’accès aux contenus.",
            "Fournir les réponses IA, analyser les fichiers et générer les médias demandés.",
            "Gérer l’historique, la continuité de conversation et, lorsque applicable, la mémoire contextuelle.",
            "Calculer les crédits, prévenir les doubles débits et rapprocher les opérations techniques.",
            "Traiter les demandes de support, sécuriser le service et diagnostiquer les incidents."
          ],
          "paragraphs": [
            "[À COMPLÉTER AVANT PUBLICATION] Pour chaque finalité, préciser la base juridique réellement applicable (contrat, consentement, obligation légale ou autre fondement prévu par la loi)."
          ],
          "review": true
        },
        {
          "title": "5. Prestataires et transferts",
          "paragraphs": [
            "Selon les fonctions, ORIA s’appuie sur Supabase (compte, données et stockage), des fournisseurs de modèles d’IA et des services d’hébergement ou de paiement. Des contenus envoyés par l’utilisateur peuvent être transmis aux prestataires nécessaires à l’exécution de l’action demandée.",
            "Les transferts hors du Gabon et le recours à des sous-traitants nécessitent un examen juridique et technique.",
            "[À COMPLÉTER AVANT PUBLICATION] Liste exacte des prestataires actifs, pays de destination, finalités, clauses contractuelles, garanties et formalités/autorisations exigées."
          ],
          "review": true
        },
        {
          "title": "6. Conservation et suppression",
          "paragraphs": [
            "Les durées de conservation ne sont pas encore confirmées dans le bilan du projet. Elles doivent être documentées séparément pour les comptes, conversations, fichiers, créations, audios, sauvegardes et journaux de facturation.",
            "Supprimer un élément dans une interface ne signifie pas nécessairement qu’il est immédiatement effacé de tous les systèmes, sauvegardes ou journaux imposés par la loi.",
            "[À COMPLÉTER AVANT PUBLICATION] Définir les durées, les critères, la suppression effective et la portée des sauvegardes."
          ],
          "review": true
        },
        {
          "title": "7. Vos droits",
          "paragraphs": [
            "Selon la loi applicable et les conditions de votre situation, vous pouvez demander des informations, l’accès, la rectification, l’effacement, l’opposition ou la portabilité de vos données, ainsi que retirer un consentement lorsqu’un traitement repose sur celui-ci.",
            "Pour faire une demande : lbv-connect01@gmail.com. Une vérification raisonnable de votre identité peut être nécessaire afin de protéger vos données. Vous pouvez également saisir l’autorité gabonaise compétente, l’APDPVP."
          ]
        },
        {
          "title": "8. Mineurs",
          "paragraphs": [
            "ORIA vise également un public scolaire. La loi gabonaise prévoit une autorisation parentale pour le traitement des données personnelles des moins de 18 ans.",
            "[À VALIDER AVANT OUVERTURE AUX MINEURS] Mettre en place et tester un parcours d’âge, d’autorisation parentale et de conservation de preuve approprié ; la présente page ne remplace pas ce mécanisme."
          ],
          "review": true
        },
        {
          "title": "9. Sécurité et incidents",
          "paragraphs": [
            "L’architecture prévoit une authentification des requêtes, un contrôle d’accès aux fichiers privés, des secrets conservés côté serveur et des mécanismes de suivi de crédits. Ces mesures doivent être contrôlées en conditions réelles.",
            "Aucun service connecté ne peut promettre une sécurité absolue. Tout incident sera évalué selon la réglementation applicable et les obligations de notification."
          ]
        },
        {
          "title": "10. Cookies et stockage local",
          "paragraphs": [
            "Les interfaces peuvent employer les mécanismes nécessaires au maintien de la session et des préférences ainsi que des caches locaux.",
            "[À COMPLÉTER AVANT PUBLICATION] Inventorier les cookies et traceurs Web réellement utilisés, leurs finalités et durées, les accès au stockage local et les choix disponibles à l’utilisateur."
          ],
          "review": true
        },
        {
          "title": "11. Contenus envoyés aux modèles",
          "paragraphs": [
            "Les requêtes, documents ou sons soumis à une fonction IA peuvent être traités par des services tiers pour produire une réponse. Les politiques de conservation et d’entraînement propres à ces services doivent être examinées contractuellement.",
            "ORIA n’affirme pas, à ce stade, que les fournisseurs n’utilisent jamais les données pour améliorer leurs modèles. Cette garantie devra être vérifiée pour chaque service et sa configuration effective."
          ]
        },
        {
          "title": "12. Mises à jour",
          "paragraphs": [
            "La version et la date de cette politique figurent dans cette page. Les changements substantiels devront être portés à la connaissance des utilisateurs selon les obligations applicables."
          ]
        },
        {
          "title": "13. Cheminement d’une demande envoyée à l’IA",
          "paragraphs": [
            "Une question soumise à ORIA peut être associée à une conversation, transmise au backend avec les paramètres du modèle et, selon l’action choisie, envoyée au prestataire IA nécessaire à sa réalisation.",
            "L’activation de la Recherche Web ou l’envoi de fichiers peut impliquer d’autres traitements que ceux d’un simple message texte. Le contenu transmis au fournisseur doit être limité à ce qui est nécessaire au service. Les données précises par fournisseur restent à documenter."
          ],
          "review": true
        },
        {
          "title": "14. Cas particulier des photographies et documents",
          "paragraphs": [
            "Les images d’identité, copies de devoirs, relevés, attestations ou documents médicaux peuvent contenir des données sensibles, même lorsque vous ne les avez pas désignés comme tels. Nous vous invitons à masquer les éléments sans rapport avec la demande.",
            "Les droits d’accès aux fichiers, les liens de téléchargement temporaires et les délais d’effacement effectifs doivent faire l’objet d’une vérification technique spécifique."
          ],
          "review": true
        },
        {
          "title": "15. Enregistrements audio et transcriptions",
          "paragraphs": [
            "Une note vocale ou un enregistrement de cours peut contenir la voix, l’identité ou les propos de plusieurs personnes. Avant d’enregistrer un cours ou une intervention, assurez-vous de respecter les règles de votre établissement et les droits des personnes concernées.",
            "L’audio peut nécessiter stockage, segmentation, transcription puis génération de documents. Les politiques de rétention doivent distinguer les fichiers audio bruts, les transcriptions, les documents produits et les copies techniques."
          ],
          "review": true
        },
        {
          "title": "16. Mémoire conversationnelle",
          "paragraphs": [
            "La fonctionnalité de mémoire peut condenser des échanges anciens pour aider ORIA à conserver le contexte utile. Une synthèse de conversation peut elle-même contenir des informations personnelles.",
            "[À COMPLÉTER AVANT PUBLICATION] Indiquer si l’utilisateur peut afficher, corriger, désactiver ou demander l’effacement de cette mémoire et comment ces actions se répercutent dans le stockage serveur."
          ],
          "review": true
        },
        {
          "title": "17. Facturation et informations de transaction",
          "paragraphs": [
            "La gestion des packs et des crédits peut nécessiter l’enregistrement d’un identifiant d’opération, d’un montant, d’un état de paiement, d’un solde et de traces techniques destinées à éviter les erreurs de débit.",
            "[À COMPLÉTER AVANT PUBLICATION] Vérifier quelles données bancaires ou de Mobile Money sont effectivement reçues ou conservées par ORIA plutôt que traitées uniquement par l’opérateur de paiement."
          ],
          "review": true
        },
        {
          "title": "18. Liens et services tiers",
          "paragraphs": [
            "Les liens fournis dans les réponses, les résultats de Recherche Web et certaines pages de paiement peuvent conduire à des services externes soumis à leurs propres conditions et politiques. ORIA ne contrôle pas l’ensemble de leur contenu.",
            "N’entrez pas d’identifiants ou d’informations financières sur une page dont vous n’avez pas vérifié l’origine."
          ]
        },
        {
          "title": "19. Journaux de sécurité et suivi des erreurs",
          "paragraphs": [
            "Pour assurer les opérations et diagnostiquer les incidents, le service peut devoir enregistrer des informations techniques : dates, événements, erreurs, résultats de facturation ou métadonnées de requêtes.",
            "[À COMPLÉTER AVANT PUBLICATION] Vérifier la présence éventuelle d’adresses IP, d’identifiants d’appareil ou de contenu de conversation dans les journaux, ainsi que les accès et durées de conservation."
          ],
          "review": true
        },
        {
          "title": "20. Traitement des demandes de confidentialité",
          "paragraphs": [
            "Pour exercer vos droits, écrivez à lbv-connect01@gmail.com en indiquant le droit concerné et les éléments permettant de retrouver votre compte. Il peut être nécessaire de vérifier votre identité sans exiger plus d’informations que nécessaire.",
            "[À COMPLÉTER AVANT PUBLICATION] Documenter la procédure interne, les délais légaux, la réponse aux demandes complexes et les restrictions applicables à certaines données conservées pour obligations légales."
          ],
          "review": true
        },
        {
          "title": "21. Mineurs et informations accessibles",
          "paragraphs": [
            "Les explications destinées aux adolescents doivent employer un langage compréhensible et ne pas dissimuler les conséquences de la collecte des données. La présence d’une simple politique de confidentialité ou d’une case cochée par un mineur ne remplace pas une autorisation parentale valable.",
            "Tant que le parcours d’âge et d’autorisation n’est pas réellement opérationnel, les modalités d’ouverture du service aux moins de 18 ans doivent être revues."
          ],
          "review": true
        },
        {
          "title": "22. Conformité et formalités avant lancement",
          "paragraphs": [
            "La réglementation gabonaise peut imposer des déclarations, avis ou autorisations pour des plateformes traitant des données personnelles et pour certains traitements d’intelligence artificielle. Ces obligations doivent être examinées auprès de l’autorité compétente.",
            "[À COMPLÉTER AVANT PUBLICATION] Déterminer les formalités applicables à ORIA, le registre des traitements, les éventuelles analyses d’impact et la documentation contractuelle des prestataires."
          ],
          "review": true
        }
      ]
    },
    {
      "id": "terms",
      "label": "Conditions d’utilisation",
      "subtitle": "Règles et responsabilités",
      "icon": "document-text-outline",
      "sections": [
        {
          "title": "1. Service et champ d’application",
          "paragraphs": [
            "Les présentes conditions sont une version de travail destinée à encadrer l’accès à ORIA, plateforme d’assistance et de création reposant sur l’intelligence artificielle. Elles ne constituent pas encore des conditions contractuelles définitives.",
            "[À COMPLÉTER AVANT PUBLICATION] Identité juridique et adresse de l’exploitant ; date d’entrée en vigueur ; droit applicable et dispositif de règlement des litiges."
          ],
          "review": true
        },
        {
          "title": "2. Compte et accès",
          "paragraphs": [
            "L’ouverture d’un compte permet de découvrir l’interface. Certaines fonctionnalités nécessitent un pack actif et des crédits suffisants. Les identifiants du compte doivent rester personnels et protégés.",
            "L’accès des mineurs suppose la mise en place de conditions adaptées et des autorisations légalement exigées."
          ]
        },
        {
          "title": "3. Utilisation autorisée",
          "paragraphs": [
            "L’utilisateur doit respecter la loi et les droits des autres personnes. Sont notamment exclus les usages visant la fraude, les violences, les intrusions informatiques non autorisées, la diffusion illicite de données personnelles ou l’atteinte aux droits de propriété intellectuelle.",
            "Le service peut appliquer des contrôles et restrictions pour prévenir les abus. Les modalités de suspension ou de contestation doivent être précisées dans la version définitive."
          ]
        },
        {
          "title": "4. Contenus et droits",
          "paragraphs": [
            "L’utilisateur reste responsable de la légalité des contenus qu’il transmet et de la vérification des résultats générés avant diffusion.",
            "[À COMPLÉTER AVANT PUBLICATION] Préciser les licences nécessaires pour traiter les contenus soumis, les droits relatifs aux résultats et les conditions imposées par chaque fournisseur."
          ],
          "review": true
        },
        {
          "title": "5. Fiabilité des résultats IA",
          "paragraphs": [
            "Les réponses peuvent être inexactes, incomplètes ou obsolètes. ORIA accompagne l’apprentissage et la création mais ne remplace pas les conseils d’un professionnel qualifié, notamment en médecine, en droit, en finance ou en matière de sécurité.",
            "La génération de code ne garantit ni l’exécution, ni l’absence de vulnérabilités, ni la compatibilité avec l’environnement de l’utilisateur."
          ]
        },
        {
          "title": "6. Disponibilité",
          "paragraphs": [
            "L’accès aux fonctions dépend du pack, du modèle, des prestataires et des conditions techniques. Certains outils peuvent évoluer, être temporairement indisponibles ou nécessiter une validation supplémentaire.",
            "[À COMPLÉTER AVANT PUBLICATION] Politique d’incident, support, suspension, résiliation et gestion des indisponibilités."
          ],
          "review": true
        },
        {
          "title": "7. Paiements et réclamations",
          "paragraphs": [
            "Les prix et les crédits applicables doivent être affichés avant la commande. Le paiement d’un pack n’est considéré comme confirmé qu’après une validation fiable de la transaction.",
            "[À COMPLÉTER AVANT PUBLICATION] Conditions de rétractation ou remboursement applicables, gestion des erreurs de paiement, devise, justificatifs, facturation et obligations des boutiques mobiles."
          ],
          "review": true
        },
        {
          "title": "8. Contact",
          "paragraphs": [
            "Pour toute difficulté liée au service : lbv-connect01@gmail.com."
          ]
        },
        {
          "title": "9. Règles d’inscription",
          "paragraphs": [
            "Le compte est personnel. Lorsqu’il crée son profil, l’utilisateur doit fournir les renseignements effectivement demandés par le service et éviter toute usurpation d’identité. Il est responsable de la protection de ses moyens d’accès.",
            "L’identité de l’exploitant et les règles de résiliation seront précisées avant l’entrée en vigueur définitive des conditions."
          ],
          "review": true
        },
        {
          "title": "10. Utilisation de contenus de tiers",
          "paragraphs": [
            "L’utilisateur ne doit pas soumettre un document, une image, une voix ou une vidéo lorsqu’il ne dispose pas des droits ou autorisations nécessaires à son utilisation. Un contenu provenant d’un cours peut être soumis à des règles particulières de reproduction ou de diffusion.",
            "Les fichiers générés ne confèrent pas automatiquement des droits d’auteur sur tous les éléments éventuellement reproduits depuis des sources extérieures."
          ]
        },
        {
          "title": "11. Images, vidéos et contenus synthétiques",
          "paragraphs": [
            "Lors de la génération ou de la publication de médias, l’utilisateur doit respecter le droit à l’image, les droits des tiers et la réglementation applicable. Les productions d’IA peuvent contenir des erreurs de représentation ou ressembler involontairement à des œuvres existantes.",
            "Les restrictions de contenu des fournisseurs et les contrôles d’ORIA peuvent conduire au refus d’une demande ou d’un résultat sans que cela constitue nécessairement un dysfonctionnement."
          ]
        },
        {
          "title": "12. Travail scolaire et intégrité académique",
          "paragraphs": [
            "ORIA peut expliquer un exercice, aider à réviser ou proposer une méthode de résolution. L’utilisateur reste responsable du respect des consignes de son établissement concernant l’utilisation de l’intelligence artificielle dans les devoirs, examens et travaux remis.",
            "Les réponses doivent favoriser la compréhension plutôt que remplacer systématiquement le travail personnel."
          ]
        },
        {
          "title": "13. Enregistrements de cours et paroles de tiers",
          "paragraphs": [
            "L’utilisateur qui lance un enregistrement doit respecter les règles de son établissement, informer les personnes lorsqu’une information est requise et disposer des autorisations nécessaires pour capter ou transmettre des voix.",
            "ORIA ne garantit pas qu’une transcription restitue parfaitement chaque parole : noms propres, accents, bruits et termes techniques peuvent provoquer des erreurs."
          ]
        },
        {
          "title": "14. Protection du compte et suspension",
          "paragraphs": [
            "L’exploitation abusive du service, la fraude aux paiements, les tentatives de contournement des crédits ou les accès non autorisés peuvent conduire à des mesures de sécurité proportionnées.",
            "[À COMPLÉTER AVANT PUBLICATION] Définir précisément les cas de suspension, les éventuels avertissements, la possibilité de recours et le sort des crédits restants."
          ],
          "review": true
        },
        {
          "title": "15. Interruptions et opérations inachevées",
          "paragraphs": [
            "Une génération peut échouer, être interrompue ou rester en attente. Le backend prévoit des mécanismes de réservation et de rapprochement destinés à éviter les doubles débits, mais le résultat doit être vérifié sur les opérations réelles.",
            "[À COMPLÉTER AVANT PUBLICATION] Décrire le traitement contractuel d’une génération échouée, le délai de contestation et la procédure de correction des crédits."
          ],
          "review": true
        },
        {
          "title": "16. Évolution du service et des conditions",
          "paragraphs": [
            "Les modèles, fonctionnalités, prestataires et prix peuvent évoluer. Les modifications contractuelles significatives devront être annoncées conformément aux exigences applicables, en distinguant les nouveaux achats des engagements déjà conclus.",
            "[À COMPLÉTER AVANT PUBLICATION] Définir les modalités de préavis et de conservation des anciennes versions acceptées."
          ],
          "review": true
        },
        {
          "title": "17. Réclamations et règlement des différends",
          "paragraphs": [
            "Un problème de compte, de média livré ou de débit doit d’abord pouvoir être signalé à lbv-connect01@gmail.com en décrivant le problème et, si nécessaire, l’identifiant de l’opération.",
            "[À COMPLÉTER AVANT PUBLICATION] Définir le canal de médiation ou de recours, la juridiction compétente, le droit applicable et les droits impératifs du consommateur."
          ],
          "review": true
        }
      ]
    },
    {
      "id": "credits",
      "label": "Packs et crédits",
      "subtitle": "Comprendre les coûts",
      "icon": "wallet-outline",
      "sections": [
        {
          "title": "Les packs ORIA",
          "paragraphs": [
            "ORIA utilise quatre familles de packs : Léger, Intermédiaire, Pro et Business. Le bilan fonctionnel du 23 octobre 2026 prévoit une durée de 35 jours et des volumes de crédits différenciés.",
            "Les prix et promotions peuvent évoluer. Seule la page « Packs » mise à jour et l’étape de confirmation de commande font foi pour un achat donné."
          ]
        },
        {
          "title": "À quoi servent les crédits ?",
          "paragraphs": [
            "Les actions IA consomment des crédits selon le service, le modèle et, pour les médias, la configuration retenue. Le backend peut estimer et réserver une provision avant d’exécuter l’action, puis calculer le coût final et gérer le solde conformément à ses règles.",
            "Une estimation n’est pas une garantie que le coût final sera identique. L’interface ne doit pas afficher un prix fixe inventé lorsque seul le backend peut établir le coût applicable."
          ]
        },
        {
          "title": "Paiements au Gabon",
          "paragraphs": [
            "ORIA souhaite faciliter les paiements locaux, notamment par Airtel Money et Moov Money. Le parcours technique de paiement doit être validé de bout en bout avant d’être annoncé comme pleinement opérationnel.",
            "Une commande ou une tentative de paiement ne suffit pas, à elle seule, à activer un pack : la confirmation de paiement est nécessaire."
          ]
        },
        {
          "title": "Durée, renouvellement et remboursements",
          "paragraphs": [
            "Le bilan décrit des packs d’une durée de 35 jours ; les modalités de renouvellement, d’expiration des crédits, de remboursement et de réclamation doivent être fixées et testées avant publication contractuelle."
          ],
          "review": true
        },
        {
          "title": "Répartition des droits entre packs",
          "paragraphs": [
            "Les packs Léger, Intermédiaire, Pro et Business proposent des allocations de crédits et des configurations IA différentes. Les modèles de raisonnement, générations d’images, vidéos et essais ne sont pas nécessairement ouverts de la même façon dans chaque formule.",
            "La liste des modèles et actions disponibles dans l’application doit correspondre aux capacités que le backend autorise pour le pack réellement actif."
          ]
        },
        {
          "title": "Valeur de référence des crédits",
          "paragraphs": [
            "Le bilan technique mentionne une valeur de référence interne de 0,10 F CFA par crédit ORIA. Il s’agit d’un paramètre de calcul décrit dans le projet, pas d’un engagement autonome sur le coût d’une action.",
            "Une demande peut coûter des quantités différentes de crédits selon le modèle, le volume traité, les fichiers, les opérations effectuées et les coûts calculés côté serveur."
          ]
        },
        {
          "title": "Estimation, provision et coût final",
          "paragraphs": [
            "Avant une action coûteuse, le backend peut estimer puis bloquer temporairement une provision de crédits. Après la réponse du fournisseur, il vise à rapprocher la consommation réelle et à libérer un éventuel surplus.",
            "En cas d’interruption ou d’incertitude, un contrôle de l’état de la transaction peut être nécessaire. Le détail exact de la réserve et du remboursement de crédits doit correspondre à l’implémentation effectivement testée."
          ]
        },
        {
          "title": "Achats complémentaires",
          "paragraphs": [
            "Le bilan prévoit des achats de crédits en complément des quatre packs. Leur disponibilité, leur compatibilité avec un abonnement, leur date de péremption et leurs modalités de remboursement doivent être confirmées par les conditions commerciales affichées."
          ],
          "review": true
        },
        {
          "title": "Affichage du prix et confirmation du paiement",
          "paragraphs": [
            "Le prix et les conditions applicables doivent être présentés avant validation. Une tentative de paiement ou une commande enregistrée ne vaut pas confirmation de versement.",
            "L’activation d’un pack doit intervenir après réception d’un résultat de paiement confirmé et vérifiable par le système."
          ]
        },
        {
          "title": "Erreurs de débit et contestations",
          "paragraphs": [
            "En cas d’écart entre une estimation et un solde débité, conservez l’heure de l’opération et toute référence de transaction affichée dans l’application. Le support pourra rechercher l’opération correspondante.",
            "[À COMPLÉTER AVANT PUBLICATION] Fixer la procédure et les délais de contrôle, de régularisation et de remboursement d’un éventuel débit indu."
          ],
          "review": true
        },
        {
          "title": "Offres de lancement",
          "paragraphs": [
            "Le bilan prévoit l’éventualité de tarifs promotionnels pour une première vague de clients. Une promotion n’existe contractuellement que si son prix, sa durée et ses conditions sont effectivement présentés dans l’application au moment de la commande.",
            "Aucune remise particulière n’est promise par la présente rubrique."
          ]
        }
      ]
    },
    {
      "id": "principles",
      "label": "Nos engagements",
      "subtitle": "Une IA responsable",
      "icon": "sparkles-outline",
      "sections": [
        {
          "title": "Transparence",
          "paragraphs": [
            "Distinguer les fonctions disponibles des fonctions annoncées ou en test. Expliquer les limites, coûts et prérequis sans présenter une démonstration comme un service déjà validé."
          ]
        },
        {
          "title": "Confidentialité et respect",
          "paragraphs": [
            "Limiter les traitements aux besoins du service, protéger les comptes et les contenus, documenter les prestataires et faciliter les demandes liées aux données personnelles. La politique finale précisera les engagements vérifiés."
          ]
        },
        {
          "title": "Contrôle humain",
          "paragraphs": [
            "Rappeler qu’une réponse d’IA peut être fausse, biaisée ou incomplète. Encourager la vérification des faits, des calculs, des références et des contenus générés."
          ]
        },
        {
          "title": "Amélioration continue",
          "paragraphs": [
            "Prioriser la stabilité du produit, la sécurité des données, la fiabilité de la facturation et les tests sur appareils réels plutôt que la multiplication de fonctions non éprouvées."
          ]
        },
        {
          "title": "Protéger les utilisateurs les plus jeunes",
          "paragraphs": [
            "Puisque ORIA vise notamment les élèves, son fonctionnement doit intégrer les règles de protection des mineurs et des explications adaptées à leur âge. Une politique écrite ne suffit pas sans mécanismes techniques appropriés."
          ],
          "review": true
        },
        {
          "title": "Favoriser l’esprit critique",
          "paragraphs": [
            "ORIA doit aider l’utilisateur à comprendre les raisonnements, trouver les limites d’une réponse et vérifier les sources, plutôt que demander une confiance aveugle dans un texte généré."
          ]
        },
        {
          "title": "Ne pas promettre des fonctions non testées",
          "paragraphs": [
            "Un parcours visible en interface n’est pas forcément disponible de bout en bout. Nous distinguons le développement, les essais, la stabilité et la mise à disposition réelle du service."
          ]
        },
        {
          "title": "Traiter les erreurs de manière vérifiable",
          "paragraphs": [
            "Lorsque des crédits, une livraison de fichier ou une tâche longue échouent, l’objectif est de retrouver l’opération, de comprendre son état et de corriger les incohérences constatées. L’effectivité de ces mécanismes doit être validée."
          ]
        }
      ]
    },
    {
      "id": "legal",
      "label": "Mentions légales",
      "subtitle": "Exploitant et contact",
      "icon": "business-outline",
      "sections": [
        {
          "title": "Éditeur du service",
          "paragraphs": [
            "Nom du service : ORIA.",
            "Adresse de contact : lbv-connect01@gmail.com.",
            "[À COMPLÉTER AVANT PUBLICATION] Nom légal, forme d’exploitation, numéro d’immatriculation s’il existe, siège ou adresse professionnelle, responsable de publication."
          ],
          "review": true
        },
        {
          "title": "Technologies et hébergement",
          "paragraphs": [
            "Le bilan technique décrit une application Web Next.js, une application mobile Expo/React Native, une API FastAPI ainsi que des services Supabase. La configuration d’hébergement effective, les entités contractantes et leur localisation doivent être confirmées."
          ],
          "review": true
        },
        {
          "title": "Textes de référence",
          "paragraphs": [
            "La rédaction définitive doit tenir compte notamment de la loi gabonaise n°025/2023 modifiant la loi n°001/2011 relative à la protection des données à caractère personnel, ainsi que des autres textes applicables aux transactions électroniques et à la consommation.",
            "Lien officiel : https://journal-officiel.ga/20085-025-2023-/"
          ]
        },
        {
          "title": "Contact et demandes",
          "paragraphs": [
            "Pour les questions sur ORIA, une demande relative à vos données ou une réclamation : lbv-connect01@gmail.com."
          ]
        },
        {
          "title": "Responsable du traitement et interlocuteur",
          "paragraphs": [
            "La politique définitive doit indiquer la personne physique ou morale qui détermine les finalités et les moyens du traitement des données. Le simple nom commercial ORIA ne suffit pas à établir cette responsabilité.",
            "[À COMPLÉTER AVANT PUBLICATION] Identité juridique, coordonnées professionnelles et, le cas échéant, personne désignée pour les demandes relatives aux données."
          ],
          "review": true
        },
        {
          "title": "Accès au droit gabonais de la protection des données",
          "paragraphs": [
            "La loi gabonaise n°025/2023 modifiant la loi n°001/2011 relative à la protection des données à caractère personnel contient notamment des dispositions sur la transparence, les droits des personnes, la protection des mineurs et certains traitements d’intelligence artificielle.",
            "Référence officielle à consulter : https://journal-officiel.ga/20085-025-2023-/. La conformité d’ORIA ne peut être déduite de la simple présence d’un lien vers la loi."
          ]
        },
        {
          "title": "Version et entrée en vigueur",
          "paragraphs": [
            "Cette page porte une version documentaire interne et une date de mise à jour. Le texte définitif devra mentionner sa date réelle d’entrée en vigueur et les modalités de consultation des versions antérieures.",
            "[À COMPLÉTER AVANT PUBLICATION] Procédure de notification des mises à jour importantes et, selon le cas, recueil de l’accord lorsque nécessaire."
          ],
          "review": true
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
        <Text style={s.meta}>Version {content.version} · {content.updated}</Text>

        <View style={s.warning}>
          <Ionicons name="alert-circle-outline" color="#f3d99d" size={21} />
          <Text style={s.warningText}>Brouillon de validation. Certaines mentions sont à compléter avant toute publication contractuelle et avant l’intégration à l’inscription.</Text>
        </View>

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
                {"review" in section && section.review ? <Text style={s.review}>À vérifier</Text> : null}
              </View>
              {"paragraphs" in section && section.paragraphs?.map((value, i) => <Text key={i} style={[s.paragraph, value.startsWith("[") && s.todo]}>{value}</Text>)}
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
        <Text style={s.footer}>ORIA · Version provisoire · {content.updated}</Text>
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
  warning:{marginTop:20,borderRadius:17,padding:15,borderWidth:1,borderColor:"#66512b",backgroundColor:"#292115",flexDirection:"row",gap:12},
  warningText:{color:"#ecd59c",fontSize:12,lineHeight:19,flex:1},
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
  review:{color:"#ead18e",backgroundColor:"#352b17",borderRadius:7,overflow:"hidden",paddingHorizontal:8,paddingVertical:4,fontSize:10},
  paragraph:{fontSize:13.5,lineHeight:23,color:"#c9ccd6",marginBottom:12},todo:{color:"#ead18e",fontWeight:"600"},
  bulletRow:{flexDirection:"row",gap:10,marginBottom:10},bullet:{color:"#afa5ff",fontSize:16,lineHeight:22},bulletText:{color:"#c9ccd6",fontSize:13.5,lineHeight:22,flex:1},
  contact:{marginTop:28,paddingTop:20,borderTopWidth:1,borderTopColor:"#30333c"},contactHeading:{color:"#a7acba",fontSize:13,marginBottom:12},
  emailRow:{flexDirection:"row",gap:10,alignItems:"center",flexWrap:"wrap"},email:{color:"#c0b4ff",fontWeight:"700",fontSize:13.5},
  footer:{textAlign:"center",color:"#838997",fontSize:11,marginTop:28}
});
