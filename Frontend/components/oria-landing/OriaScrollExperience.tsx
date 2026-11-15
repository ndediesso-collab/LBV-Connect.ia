"use client";

import Link from "next/link";
import {useEffect, useRef} from "react";
import {ArrowUpRight, ChevronDown, PlayCircle, Smartphone, Sparkles} from "lucide-react";
import styles from "./OriaScrollExperience.module.css";

/** Effet de perspective & depth au scroll, sans Three.js/WebGL pour préserver la performance mobile. */
export default function OriaScrollExperience() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = ref.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const range = Math.max(1, section.offsetHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(1, -rect.top / range));
      const properties: Record<string, string> = {
        "--grid-y": `${90 * progress}px`,
        "--orb-a": `${130 * progress}deg`, "--orb-b": `${-145 * progress}deg`,
        "--phone-y": `${-70 * progress}px`,
        "--phone-ry": `${-25 + 50 * progress}deg`,
        "--phone-rx": `${14 - 14 * progress}deg`,
        "--phone-scale": `${0.89 + .11 * progress}`,
        "--math-x": `${50 * progress}px`, "--math-y": `${-120 * progress}px`,
        "--math-z": `${120 + 70 * progress}px`, "--math-ry": `${11 + 24 * progress}deg`,
        "--files-x": `${-55 * progress}px`, "--files-y": `${115 * progress}px`,
        "--files-z": `${25 + 70 * progress}px`, "--files-ry": `${-14 - 27 * progress}deg`,
        "--ai-x": `${-65 * progress}px`, "--ai-y": `${-90 * progress}px`,
        "--ai-z": `${100 + 50 * progress}px`, "--ai-ry": `${-5 - 33 * progress}deg`,
      };
      for (const [name, value] of Object.entries(properties)) section.style.setProperty(name, value);
    };
    const onScroll = () => {if (!raf) raf = window.requestAnimationFrame(update);};
    onScroll();
    window.addEventListener("scroll", onScroll, {passive:true});
    window.addEventListener("resize", onScroll);
    return () => {window.removeEventListener("scroll", onScroll);window.removeEventListener("resize", onScroll);if(raf)cancelAnimationFrame(raf);};
  }, []);
  return (
    <section ref={ref} className={styles.scene} id="installation" aria-label="L'expérience ORIA en trois dimensions">
      <div className={styles.sticky}>
        <div className={styles.stage} aria-hidden="true">
          <span className={styles.gridPlane}/>
          <span className={`${styles.orb} ${styles.orbA}`}/>
          <span className={`${styles.orb} ${styles.orbB}`}/>
          <div className={`${styles.floatCard} ${styles.cardMath}`}><span>01 — APPRENDRE</span><strong>Mathématiques</strong><p>Comprendre, étape par étape.</p></div>
          <div className={`${styles.floatCard} ${styles.cardFiles}`}><span>02 — PRODUIRE</span><strong>PDF · Word · CV</strong><p>Des résultats concrets.</p></div>
          <div className={`${styles.floatCard} ${styles.cardAI}`}><span>03 — CRÉER</span><strong>Mini-Studio</strong><p>Images et vidéos selon l'offre.</p></div>
          <div className={styles.phoneWrap}>
            <div className={styles.phone}>
              <div className={styles.dynamicIsland}/>
              <div className={styles.phoneTop}><strong>ORIA.</strong><span>● EN LIGNE</span></div>
              <div className={styles.chatBubble}>Explique-moi cet exercice, étape par étape.</div>
              <div className={styles.answer}><Sparkles size={15}/><p>Bien sûr ! Commençons par identifier les données importantes...</p></div>
              <div className={styles.phoneFooter}>Écrivez à ORIA… <span>↑</span></div>
            </div>
          </div>
        </div>
        <div className={styles.overline}>ORIA · NÉE AU GABON POUR L'AFRIQUE</div>
        <div className={styles.scrollHint}><ChevronDown size={17}/> Faites défiler pour découvrir</div>
      </div>
      <div className={styles.steps}>
        <div className={styles.step}><p>01 / L'EXPÉRIENCE</p><h2>Une IA née ici.<br/><em>Pour aller plus loin.</em></h2><span>Une seule interface pour apprendre, créer et avancer.</span></div>
        <div className={styles.step}><p>02 / BÊTA PUBLIQUE</p><h2>Découvre ORIA.<br/><em>150 crédits offerts chaque jour.</em></h2><span>Un accès gratuit pendant la bêta, sous réserve de disponibilité.</span></div>
        <div className={styles.step}><p>03 / SUR TON TÉLÉPHONE</p><h2>Ton espace IA.<br/><em>À portée de main.</em></h2><span>Installe ORIA depuis Safari ou Chrome, sans boutique d'applications.</span></div>
      </div>
      <div className={styles.bottom} id="oria-video-pwa">
        <div className={styles.bottomCopy}><span className={styles.tutorialKicker}><Smartphone size={16}/> ACCÈS RAPIDE SUR MOBILE</span><h2>ORIA t'accompagne partout.</h2><p>Regarde comment ajouter ORIA à l'écran d'accueil de ton iPhone ou Android. Tu ouvriras ensuite directement la version web complète.</p><div className={styles.actions}><Link href="/chat">Découvrir ORIA <ArrowUpRight size={17}/></Link><a href="#oria-video-pwa"><PlayCircle size={17}/> Voir le tutoriel</a></div><details><summary>Étapes d'installation</summary><p><strong>iPhone :</strong> Safari → Partager → Sur l’écran d’accueil → Ajouter.</p><p><strong>Android :</strong> Chrome → Menu → Installer l’application ou Ajouter à l’écran d’accueil.</p></details></div>
        <div className={styles.videoCard}><div className={styles.videoTop}><span>GUIDE VIDÉO</span><span>IPHONE & ANDROID</span></div><video controls playsInline preload="none" poster="/oria/oria-pwa-poster.webp" aria-label="Tutoriel d'installation de la PWA ORIA"><source src="/oria/oria-installation-pwa.mp4" type="video/mp4"/>Lecture vidéo indisponible.</video><small>Les conditions et packs présentés dans d'anciennes captures peuvent avoir évolué.</small></div>
      </div>
    </section>
  );
}
