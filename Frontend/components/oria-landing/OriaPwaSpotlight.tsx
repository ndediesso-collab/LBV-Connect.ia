import Link from "next/link";
import { ArrowUpRight, Download, PlayCircle, Smartphone } from "lucide-react";
import styles from "./OriaPwaSpotlight.module.css";

/** En tête de landing : explication PWA réelle, aucun Store ni installation automatique. */
export default function OriaPwaSpotlight() {
  return (
    <section className={styles.section} id="installation" aria-labelledby="pwa-spotlight-title">
      <div className={styles.topline}>
        <span><span className={styles.dot} /> ORIA SUR TON TÉLÉPHONE</span>
        <span>ACCÈS DIRECT · SANS STORE</span>
      </div>
      <div className={styles.layout}>
        <div className={styles.copy}>
          <span className={styles.kicker}><Smartphone size={16} aria-hidden="true" /> ORIA, À PORTÉE DE MAIN</span>
          <h2 id="pwa-spotlight-title">Tu veux ORIA<br />directement sur<br /><span>ton téléphone&nbsp;?</span></h2>
          <p className={styles.lead}>Regarde cette vidéo. En moins d’une minute, découvre comment ajouter ORIA à ton écran d’accueil comme une application.</p>
          <div className={styles.actions}>
            <a className={styles.videoCta} href="#oria-video-pwa">
              <PlayCircle size={20} aria-hidden="true" /> Regarder le tutoriel
            </a>
            <Link className={styles.openCta} href="/chat">
              Ouvrir ORIA <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.benefits}>
            <span><Download size={17} aria-hidden="true" /> Aucune boutique d’applications</span>
            <span><Smartphone size={17} aria-hidden="true" /> Une icône sur ton écran d’accueil</span>
          </div>
          <details className={styles.instructions}>
            <summary>Voir les étapes en texte</summary>
            <p><strong>iPhone :</strong> ouvre myoriaai.com dans Safari, touche Partager, puis « Sur l’écran d’accueil » et « Ajouter ».</p>
            <p><strong>Android :</strong> ouvre myoriaai.com dans Chrome, utilise le menu et choisis « Installer l’application » ou « Ajouter à l’écran d’accueil » selon ton navigateur.</p>
          </details>
        </div>
        <div className={styles.media} id="oria-video-pwa">
          <div className={styles.mediaHeader}>
            <span><PlayCircle size={17} aria-hidden="true" /> LE TUTORIEL EN VIDÉO</span>
            <span>00:39 · IPHONE &amp; ANDROID</span>
          </div>
          <div className={styles.videoShell}>
            <video
              className={styles.video}
              controls
              playsInline
              preload="none"
              poster="/oria/oria-pwa-poster.webp"
              aria-label="Tutoriel ORIA pour ajouter le site à l'écran d'accueil de son téléphone"
            >
              <source src="/oria/oria-installation-pwa.mp4" type="video/mp4" />
              Votre navigateur ne peut pas lire cette vidéo.
            </video>
          </div>
          <p className={styles.videoNote}>Tutoriel réalisé avec une ancienne capture du site. Les packs et conditions affichés dans la vidéo peuvent avoir changé ; consulte toujours les informations actuelles sur ORIA.</p>
        </div>
      </div>
    </section>
  );
}
