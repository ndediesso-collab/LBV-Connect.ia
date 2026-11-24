"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Maximize2, Play, Sparkles, Users, X } from "lucide-react";
import styles from "./CollabFeature.module.css";

type Props = {
  variant?: "hero" | "compact";
  hasAccess?: boolean;
  language?: "fr" | "en";
};

/** P17: one shared, editorial feature surface. No background autoplay or provider calls. */
export default function CollabFeature({ variant = "hero", hasAccess = false, language = "fr" }: Props) {
  const [open, setOpen] = useState<"image" | "video" | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const english = language === "en";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    const video = videoRef.current;
    if (open === "video" && video) void video.play().catch(() => {}); // iOS may demand an explicit play tap.
    return () => { window.removeEventListener("keydown", onKey); video?.pause(); };
  }, [open]);

  return (
    <>
      <section id={variant === "hero" ? "oria-collab-vitrine" : undefined} className={`${styles.wrap} ${variant === "compact" ? styles.compact : ""}`} aria-label={english ? "ORIA Collaborative workspace" : "Présentation ORIA Collaboratif"}>
        <div className={styles.ambient} aria-hidden="true" />
        <div className={styles.copy}>
          <div className={styles.eyebrow}><span className={styles.spark}><Sparkles size={14} /></span> ORIA COLLABORATIF <span className={styles.dot}>·</span> PRO & BUSINESS</div>
          <h2>{english ? <>Your team.<br /><em>One ORIA.</em></> : <>Votre équipe.<br /><em>Une seule ORIA.</em></>}</h2>
          <p className={styles.description}>{english
            ? "Create a shared workspace, invite your team, exchange files and bring ORIA into the conversation."
            : "Créez votre espace, réunissez votre équipe, partagez vos fichiers et faites intervenir ORIA directement dans vos conversations."}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setOpen("video")}><Play size={16} fill="currentColor" /> {english ? "Watch the demo" : "Voir la démonstration"}</button>
            <Link className={styles.secondary} href={hasAccess ? "/collaboratif/espaces" : "/packs#oria-packs-tabs"}>{hasAccess ? (english ? "Open my workspace" : "Ouvrir mon espace") : (english ? "Explore Pro & Business" : "Découvrir Pro et Business")} <ArrowUpRight size={16}/></Link>
          </div>
          <div className={styles.perks}>
            <span><Check size={13}/> {english ? "Group conversations" : "Discussions de groupe"}</span>
            <span><Check size={13}/> {english ? "AI in the conversation" : "@ORIA dans le groupe"}</span>
            <span><Check size={13}/> {english ? "Live notifications" : "Notifications réelles"}</span>
          </div>
        </div>
        <div className={styles.showcase}>
          <button type="button" className={styles.screen} onClick={() => setOpen("image")} aria-label={english ? "View full-size ORIA Collaboratif screenshot" : "Agrandir la capture d’écran ORIA Collaboratif"}>
            <div className={styles.topBar}><span className={styles.signal}/><span className={styles.signal}/><span className={styles.signal}/><span className={styles.topBarText}>ORIA / WORKSPACE PREVIEW</span></div>
            <Image src="/oria/promo/collab-capture.webp" alt={english ? "Actual ORIA Collaborative group chat interface" : "Capture réelle du chat de groupe ORIA Collaboratif"} width={1920} height={1080} sizes={variant === "hero" ? "(max-width: 800px) 100vw, 50vw" : "(max-width: 800px) 100vw, 38vw"} className={styles.image}/>
            <span className={styles.imageZoom}><Maximize2 size={15}/>{english ? "View image" : "Voir l’image"}</span>
            <span className={styles.screenFooter}><span>{english ? "REAL INTERFACE" : "INTERFACE RÉELLE"}</span><span>{english ? "ENLARGE IMAGE" : "AGRANDIR L’IMAGE"} <Maximize2 size={12}/></span></span>
          </button>
          <div className={styles.widget} aria-label={english ? "Animated demonstration" : "Mini-widget de démonstration"}>
            <div className={styles.widgetHeader}><span className={styles.teamIcon}><Users size={15}/></span><span><strong>{english ? "Project team" : "Équipe projet"}</strong><small>{english ? "Shared workspace" : "Espace partagé"}</small></span><span className={styles.live}><span/> LIVE</span></div>
            <div className={styles.bubbleHuman}>{english ? "@ORIA, can we structure this project?" : "@ORIA, on organise le projet ?"}</div>
            <div className={styles.bubbleAi}><span className={styles.aiMark}><Sparkles size={12}/> ORIA</span>{english ? "Let's make a clear action plan." : "Voici un plan d'action clair pour l'équipe."}</div>
            <div className={styles.widgetBottom}><span className={styles.faces}><i>A</i><i>B</i><i>C</i></span>{english ? "One space. Collective momentum." : "Un espace. Une équipe. Des idées."}</div>
          </div>
        </div>
      </section>
      {open && <div className={styles.backdrop} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={open === "image" ? (english ? "ORIA Collaboratif screenshot" : "Capture d’écran ORIA Collaboratif") : (english ? "ORIA Collaboratif demonstration" : "Démonstration ORIA Collaboratif")}>
          <div className={styles.dialogHeader}><span><Sparkles size={15}/> ORIA COLLABORATIF <span className={styles.muted}>{open === "image" ? "/ CAPTURE RÉELLE" : "/ MOTION DESIGN"}</span></span><button type="button" onClick={() => setOpen(null)} aria-label={english ? "Close preview" : "Fermer l’aperçu"}><X size={20}/></button></div>
          {open === "image" ? (
            <div className={styles.imageViewer}>
              <Image
                src="/oria/promo/collab-capture.webp"
                alt={english ? "Actual ORIA Collaboratif interface, enlarged" : "Vue agrandie de l’interface réelle ORIA Collaboratif"}
                width={1920}
                height={1080}
                sizes="(max-width: 1100px) 100vw, 1050px"
                className={styles.fullImage}
              />
            </div>
          ) : (
            <video ref={videoRef} src="/oria/promo/collab-demo.mp4" controls playsInline preload="metadata" className={styles.video} />
          )}
          <div className={styles.dialogFoot}><span>{open === "image" ? (english ? "Real interface · Screenshot" : "Interface réelle · Capture d’écran") : (english ? "Work together with ORIA" : "Travaillez ensemble avec ORIA")}</span><Link href={hasAccess ? "/collaboratif/espaces" : "/packs#oria-packs-tabs"} onClick={() => setOpen(null)}>{english ? "Explore" : "Découvrir"} <ArrowRight size={15}/></Link></div>
        </div>
      </div>}
    </>
  );
}
