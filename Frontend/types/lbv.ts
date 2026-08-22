/**
 * Types principaux de LBV-Connect.ia
 *
 * Ce fichier contient uniquement les structures de données
 * utilisées par le frontend.
 *
 * Les données réelles seront plus tard fournies par :
 * - Supabase
 * - Backend FastAPI
 * - API IA
 */

/* =========================================================
   CONVERSATIONS
   ========================================================= */

export type Conversation = {
  /**
   * Identifiant unique de la conversation.
   */
  id: string;

  /**
   * Titre affiché dans l'historique.
   */
  title: string;

  /**
   * Date de création de la conversation.
   */
  createdAt: string;

  /**
   * Date de dernière modification.
   */
  updatedAt: string;
};

/* =========================================================
   MESSAGES
   ========================================================= */

export type ChatMessage = {
  /**
   * Identifiant unique du message.
   */
  id: string;

  /**
   * Identifiant de la conversation
   * à laquelle appartient le message.
   */
  conversationId: string;

  /**
   * Auteur du message.
   *
   * user      → message envoyé par l'utilisateur
   * assistant → réponse de LBV-Connect.ia
   */
  role: "user" | "assistant";

  /**
   * Contenu textuel du message.
   */
  content: string;

  /**
   * Date de création du message.
   */
  createdAt: string;
};