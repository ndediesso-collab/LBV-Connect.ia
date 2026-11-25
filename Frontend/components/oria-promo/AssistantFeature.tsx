"use client";

import Link from "next/link";
import { ArrowUpRight, Bot, Check, MessageCircle, Sparkles } from "lucide-react";
import styles from "./AssistantFeature.module.css";

type Props = {
  variant?: "hero" | "compact";
  hasAccess?: boolean;
  language?: "fr" | "en";
};

/** Vitrine produit Assistant ORIA. Démonstration illustrative, sans appel API. */
export default function AssistantFeature({ variant = "hero", hasAccess = false, language = "fr" }: Props) {
  const english = language === "en";
  const href = hasAccess ? "/assistant" : "/packs#oria-packs-tabs";

  return (
    <section
      id={variant === "hero" ? "oria-assistant-vitrine" : undefined}
      className={`${styles.wrap} ${variant === "compact" ? styles.compact : ""}`}
      aria-label={english ? "ORIA AI Assistant" : "Pr\u00e9sentation Assistant ORIA"}
    >
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.copy}>
        <div className={styles.eyebrow}>
          <span className={styles.mark}><Sparkles size={14} /></span>
          ORIA ASSISTANT <span className={styles.dot}>·</span> PRO &amp; BUSINESS
        </div>
        <h2>
          {english ? <>Your expertise.<br /><em>One shared link away.</em></> : <>Votre expertise.<br /><em>Au service de vos visiteurs.</em></>}
        </h2>
        <p className={styles.description}>
          {english
            ? "Create an AI assistant tailored to your business. Define its role, instructions and welcome message, then share its public link. Your visitors can ask questions without creating an ORIA account."
            : "Cr\u00e9ez un assistant IA sp\u00e9cialis\u00e9 dans votre activit\u00e9. D\u00e9finissez son r\u00f4le, ses consignes et son message d’accueil, puis partagez son lien public. Vos visiteurs peuvent poser leurs questions sans cr\u00e9er de compte ORIA."}
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href={href}>
            {hasAccess
              ? (english ? "Create my assistant" : "Cr\u00e9er mon assistant")
              : (english ? "Available with Pro or Business" : "Disponible avec Pro ou Business")}
            <ArrowUpRight size={16} />
          </Link>
          <span className={styles.availability}>{english ? "Active plan required" : "Pack actif requis"}</span>
        </div>
        <div className={styles.perks}>
          <span><Check size={14} /> {english ? "Custom instructions" : "Consignes personnalis\u00e9es"}</span>
          <span><Check size={14} /> {english ? "Shareable public link" : "Lien public \u00e0 partager"}</span>
          <span><Check size={14} /> {english ? "No ORIA account for visitors" : "Sans compte ORIA pour vos visiteurs"}</span>
        </div>
        <p className={styles.billing}>
          {english
            ? "Visitor conversations use credits from the owner's ORIA wallet."
            : "Les conversations des visiteurs utilisent les cr\u00e9dits du portefeuille ORIA du propri\u00e9taire."}
        </p>
      </div>

      <div className={styles.showcase}>
        <div className={styles.orbit} aria-hidden="true" />
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <span className={styles.avatar}><Bot size={18} /></span>
            <span className={styles.previewTitle}>
              <strong>{english ? "Your business assistant" : "Assistant de votre activit\u00e9"}</strong>
              <small>{english ? "Public assistant page" : "Page publique de l’assistant"}</small>
            </span>
            <span className={styles.online}><i /> {english ? "ONLINE" : "EN LIGNE"}</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.welcome}>
              <span className={styles.aiLabel}><Sparkles size={12} /> ORIA AI</span>
              {english
                ? "Hello! I can help you understand our services and find the information you need."
                : "Bonjour ! Je peux vous aider à comprendre nos services et à trouver les informations dont vous avez besoin."}
            </div>
            <div className={styles.visitor}>
              <span>{english ? "VISITOR" : "VISITEUR"}</span>
              {english ? "Can you help me choose the right offer?" : "Pouvez-vous m’aider à choisir la bonne offre ?"}
            </div>
            <div className={styles.answer}>
              <span className={styles.aiLabel}><Bot size={12} /> {english ? "ASSISTANT" : "ASSISTANT ORIA"}</span>
              {english
                ? "Of course. Tell me what you are looking for and I will guide you using the information provided by this business."
                : "Avec plaisir. Dites-moi ce que vous recherchez et je vous guiderai à partir des informations et consignes de cette activit\u00e9."}
            </div>
          </div>
          <div className={styles.previewFooter}>
            <span><MessageCircle size={13} /> {english ? "Example conversation" : "Exemple de conversation"}</span>
            <span className={styles.linkPill}>{english ? "SHAREABLE LINK" : "LIEN PARTAGEABLE"}</span>
          </div>
        </div>
        <div className={styles.floatingNote}>
          <span className={styles.floatingIcon}><Sparkles size={15} /></span>
          <span><strong>{english ? "Your rules, your assistant" : "Vos r\u00e8gles, votre assistant"}</strong><small>{english ? "Configured by you" : "Configur\u00e9 par vous"}</small></span>
          <Check size={16} className={styles.floatingCheck} />
        </div>
      </div>
    </section>
  );
}
