// ORIA Collaboratif accueille uniquement des groupes de travail.
// Les anciens chats privés restent archivés en base pour audit financier.
// Une conversation personnelle est disponible sur ORIA classique.
import { redirect } from "next/navigation";

export default function ConversationsProfessionnellesRetirees() {
  redirect("/chat");
}
