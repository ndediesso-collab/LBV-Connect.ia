import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  FileText,
  Globe2,
  Image as ImageIcon,
  Layers3,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import styles from "./OriaLanding.module.css";
import OriaScrollExperience from "./OriaScrollExperience";

// La landing est publique : le backend vérifie l'éligibilité au paiement.
// Le drapeau public ne débloque aucun droit ni aucun crédit.
// Jamais d'annonce "150 crédits disponibles" avant activation côté serveur.
const FREE_PUBLIC = process.env.NEXT_PUBLIC_ORIA_FREE_PUBLIC_ENABLED === "1";

const features = [
  { number: "01", icon: MessageSquareText, title: "Réfléchir et comprendre", description: "Discutez avec différents modèles, explorez une idée et approfondissez vos questions.", tags: ["Chat", "Raisonnement"] },
  { number: "02", icon: FileText, title: "Lire et produire", description: "Analysez vos fichiers, reprenez une conversation et transformez vos idées en documents.", tags: ["Documents", "Fichiers"] },
  { number: "03", icon: ImageIcon, title: "Donner forme à vos idées", description: "Créez des images et des vidéos depuis le même espace, selon votre pack.", tags: ["Images", "Vidéo"] },
  { number: "04", icon: BookOpen, title: "Apprendre et construire", description: "Avancez dans vos cours, écrivez du code et appuyez-vous sur la recherche Web.", tags: ["Cours", "Code", "Web"] },
] as const;

const offers = [
  { name: "Light", position: "Pour commencer", description: "Les essentiels pour découvrir le travail avec l'IA.", models: "4 modèles", accent: false },
  { name: "Intermédiaire", position: "Pour aller plus loin", description: "Plus de choix pour des besoins réguliers.", models: "7 modèles", accent: false },
  { name: "Pro", position: "Pour créer davantage", description: "Un espace de travail plus polyvalent.", models: "11 modèles", accent: true },
  { name: "Business", position: "Pour les usages avancés", description: "Un catalogue élargi pour des projets exigeants.", models: "14 modèles", accent: false },
] as const;

const questions = [
  { question: "Comment fonctionnent les crédits ORIA ?", answer: "Chaque action consomme des crédits en fonction du modèle choisi. Le coût est contrôlé par le serveur ; les crédits des packs payants et les crédits gratuits sont suivis séparément." },
  { question: "ORIA propose-t-elle un accès gratuit ?", answer: FREE_PUBLIC
    ? "Oui. Les comptes éligibles peuvent recevoir jusqu’à 150 crédits ORIA gratuits par jour, selon les conditions du service. Le quota est recalculé côté serveur ; certaines fonctionnalités restent réservées aux packs."
    : "Un quota quotidien gratuit de 150 crédits ORIA est en préparation. Tant qu'il n'est pas activé, les services IA restent soumis aux conditions des packs payants actifs." },
  { question: "Combien de temps un pack reste-t-il actif ?", answer: "Les packs payants ont une validité de 35 jours à compter de leur activation, sous réserve des conditions propres à chaque offre. Les conditions exactes sont présentées avant achat." },
  { question: "Puis-je utiliser plusieurs modèles d'IA ?", answer: "Le catalogue dépend du pack actif et des fournisseurs disponibles. Le quota gratuit utilise Luna dans ses modes autorisés." },
  { question: "La génération d'images et de vidéos est-elle incluse ?", answer: "Les possibilités dépendent du pack, des crédits et des fonctionnalités effectivement activées. Le coût doit être vérifié avant toute création." },
] as const;

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link href="/" aria-label="ORIA — accueil" className={`${styles.brand} ${footer ? styles.footerBrand : ""}`}>
      <span className={styles.brandMark} aria-hidden="true"><span /></span>
      <span className={styles.brandWord}>ORIA<span className={styles.brandDot}>.</span></span>
    </Link>
  );
}

export default function OriaLanding() {
  return (
    <main className={styles.page} id="haut">
      {/* Styles additionnels isolés : aucune modification du CSS historique nécessaire. */}
      <style>{`
        /* Bandeau éditorial : visible dès l'arrivée, sans changer le héros historique. */
        .oria-discovery-announcement {
          width: 100%; background: #171717; color: #fff;
          border-bottom: 1px solid #2d2d2d;
        }
        .oria-discovery-announcement-inner {
          max-width: 1420px; margin: 0 auto; padding: 27px 5.2%;
          display: flex; align-items: center; justify-content: space-between;
          gap: clamp(24px, 4vw, 68px);
        }
        .oria-discovery-announcement-main { min-width: 0; }
        .oria-discovery-announcement-kicker {
          display: inline-flex; align-items: center; gap: 9px;
          color: #cccac5; font-size: 11px; letter-spacing: .14em;
          font-weight: 700; text-transform: uppercase;
        }
        .oria-discovery-announcement h2 {
          margin: 12px 0 7px; font-size: clamp(24px, 2.65vw, 37px);
          font-weight: 800; letter-spacing: -.045em; line-height: 1.13;
        }
        .oria-discovery-announcement h2 span { color: #a7a7a1; }
        .oria-discovery-announcement p {
          max-width: 700px; margin: 0; color: #cecec8;
          font-size: 14px; line-height: 1.5;
        }
        .oria-discovery-announcement-action {
          display: flex; align-items: center; gap: 26px; flex-shrink: 0;
        }
        .oria-discovery-announcement-price { display: flex; flex-direction: column; gap: 4px; }
        .oria-discovery-announcement-price strong {
          white-space: nowrap; font-size: clamp(29px, 2.55vw, 38px);
          line-height: 1; letter-spacing: -.05em;
        }
        .oria-discovery-announcement-price small {
          font-size: 14px; font-weight: 600; letter-spacing: 0;
        }
        .oria-discovery-announcement-price span {
          max-width: 195px; color: #b8b8b2; font-size: 11px; line-height: 1.35;
        }
        .oria-discovery-announcement-link {
          display: inline-flex; justify-content: center; align-items: center;
          gap: 11px; border-radius: 999px; padding: 14px 19px;
          background: #f8f8f5; color: #171717 !important;
          font-size: 13px; font-weight: 750; white-space: nowrap;
          transition: background .2s ease, transform .2s ease;
        }
        .oria-discovery-announcement-link:hover,
        .oria-discovery-announcement-link:focus-visible {
          background: #e3e3dc; transform: translateY(-1px);
        }
        @media (max-width: 1010px) {
          .oria-discovery-announcement-inner { align-items: flex-start; flex-direction: column; gap: 17px; }
          .oria-discovery-announcement-action { width: 100%; justify-content: space-between; }
        }
        @media (max-width: 600px) {
          .oria-discovery-announcement-inner { padding: 22px 5.2% 24px; }
          .oria-discovery-announcement h2 { font-size: clamp(24px, 6.2vw, 32px); }
          .oria-discovery-announcement-action { align-items: stretch; flex-wrap: wrap; gap: 14px; }
          .oria-discovery-announcement-price { flex: 1 1 130px; }
          .oria-discovery-announcement-link { flex: 1 1 auto; min-height: 48px; }
        }
        /* Flottement de la maquette du héros : aucune modification du design. */
        .oria-floating-preview {
          animation: oria-preview-float 5s ease-in-out infinite;
          will-change: translate;
        }
        @keyframes oria-preview-float {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -14px; }
        }
        @media (max-width: 530px) {
          .oria-floating-preview { animation-name: oria-preview-float-mobile; }
        }
        @keyframes oria-preview-float-mobile {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -9px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .oria-floating-preview { animation: none !important; will-change: auto; }
        }
        .oria-discovery-offer {
          display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(240px, .6fr);
          gap: 30px; align-items: stretch; margin: 32px 0 36px;
          border: 1px solid #d8d7d2; border-radius: 24px;
          background: #efeee9; color: #141414; overflow: hidden;
        }
        .oria-discovery-copy { padding: 33px 32px 34px; }
        .oria-discovery-kicker { display: block; margin-bottom: 20px; font-size: 11px; font-weight: 750; letter-spacing: .16em; }
        .oria-discovery-copy h3 { margin: 0; font-size: clamp(25px, 2.8vw, 39px); font-weight: 700; letter-spacing: -.045em; line-height: 1.12; }
        .oria-discovery-copy h3 span { color: #7f7f79; }
        .oria-discovery-copy p { margin: 17px 0 0; max-width: 580px; font-size: 14px; line-height: 1.75; color: #494944; }
        .oria-discovery-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 21px; }
        .oria-discovery-chips span { padding: 8px 11px; border: 1px solid #d5d4cf; border-radius: 8px; font-size: 12px; font-weight: 600; }
        .oria-discovery-side {
          display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
          padding: 34px 30px; background: #181818; color: #fff;
        }
        .oria-discovery-side .oria-discovery-volume { font-size: clamp(32px, 3.6vw, 52px); font-weight: 720; line-height: 1; letter-spacing: -.055em; }
        .oria-discovery-side .oria-discovery-volume small { display: block; margin-top: 10px; font-size: 12px; letter-spacing: .02em; color: #c5c5c5; font-weight: 500; }
        .oria-discovery-side .oria-discovery-price { margin-top: 24px; font-size: 22px; font-weight: 700; letter-spacing: -.035em; }
        .oria-discovery-side .oria-discovery-price small { display: block; margin-top: 5px; font-size: 12px; letter-spacing: 0; color: #bcbcbc; font-weight: 500; }
        .oria-discovery-side a { display: inline-flex; justify-content: space-between; align-items: center; gap: 14px; width: 100%; margin-top: 24px; padding: 13px 15px; background: #fff; color: #151515; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: 700; }
        .oria-discovery-side a:hover, .oria-discovery-side a:focus-visible { background: #e9e9e9; }
        .oria-discovery-side .oria-discovery-fineprint { margin-top: 14px; font-size: 11px; line-height: 1.6; color: #c1c1c1; }
        @media (max-width: 760px) {
          .oria-discovery-offer { grid-template-columns: 1fr; gap: 0; margin: 24px 0 28px; border-radius: 20px; }
          .oria-discovery-copy { padding: 25px 23px; }
          .oria-discovery-side { padding: 26px 23px; }
        }
      `}</style>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Brand />
          <nav className={styles.desktopNav} aria-label="Navigation principale">
            <a href="#installation">Installer ORIA</a>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#fonctionnement">Comment ça marche</a>
            <a href="#offres">Les packs</a>
            <a href="#questions">FAQ</a>
          </nav>
          <div className={styles.desktopActions}>
            <Link className={styles.navSignin} href="/chat">Se connecter</Link>
            <Link className={styles.navCta} href="/chat">Ouvrir ORIA <ArrowUpRight size={15} strokeWidth={1.8}/></Link>
          </div>
          <details className={styles.mobileNav}>
            <summary aria-label="Ouvrir le menu"><span /><span /><span /></summary>
            <nav aria-label="Navigation mobile" className={styles.mobileNavPanel}>
              <a href="#installation">Installer ORIA</a>
              <a href="#fonctionnalites">Fonctionnalités</a>
              <a href="#fonctionnement">Comment ça marche</a>
              <a href="#offres">Les packs</a>
              <a href="#questions">FAQ</a>
              <Link href="/chat">Ouvrir ORIA <ArrowUpRight size={16}/></Link>
            </nav>
          </details>
        </div>
      </header>

      <OriaScrollExperience />

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroContent}>
          <span className={styles.eyebrow}><span className={styles.eyebrowLine}/> VOTRE ESPACE IA, À VOTRE RYTHME</span>
          <h1 id="hero-title">Plusieurs intelligences.<br/><span>Une seule expérience.</span></h1>
          <p className={styles.heroText}>Échangez, apprenez, créez et faites avancer vos projets. ORIA réunit différents modèles d’intelligence artificielle dans un espace simple, pensé pour passer de l’idée au résultat.</p>
          <div className={styles.heroActions}>
            <Link href="/chat" className={styles.primaryButton}>Découvrir ORIA <ArrowUpRight size={19} strokeWidth={1.8}/></Link>
            <a href="#fonctionnalites" className={styles.secondaryButton}>Explorer les possibilités <ArrowRight size={18} strokeWidth={1.7}/></a>
          </div>
          <div className={styles.heroBottomNote}><span className={styles.noteDot}/><span>Chat · Documents · Images · Vidéos · Recherche Web</span></div>
        </div>
        <div className={`${styles.heroVisual} oria-floating-preview`} aria-label="Aperçu illustratif de l'interface ORIA">
          <div className={styles.visualTop}><span className={styles.visualLabel}>UN SEUL ESPACE POUR TOUT FAIRE</span><span>01 / 04</span></div>
          <div className={styles.mockApp}>
            <aside className={styles.mockSidebar}>
              <div className={styles.mockSidebarBrand}><span className={styles.mockMiniLogo}>O</span><b>ORIA</b></div>
              <div className={styles.mockSidebarItem}><MessageSquareText size={15}/> Nouvelle conversation</div>
              <div className={styles.mockSidebarSelected}><Layers3 size={15}/> Mon espace de travail</div>
              <div className={styles.mockSidebarBottom}><span className={styles.mockAvatar}>U</span> Mon compte</div>
            </aside>
            <div className={styles.mockConversation}>
              <div className={styles.mockConversationHeader}><span>Workspace</span><span className={styles.mockModel}>ORIA <span className={styles.mockChevron}>⌄</span></span></div>
              <div className={styles.mockConversationContent}>
                <div className={styles.mockBubble}>Explique-moi la relativité d’Einstein simplement.</div>
                <div className={styles.mockAssistant}><span className={styles.mockAssistantLogo}>✳</span><p>La relativité change notre manière de comprendre le temps, l’espace et la gravité.</p></div>
                <div className={styles.mockAssistantDetail}><span>01</span><div><strong>Le temps n’est pas absolu.</strong><p>Il peut s’écouler différemment selon le mouvement et la gravité.</p></div></div>
                <div className={styles.mockInput}><span>Demandez quelque chose à ORIA...</span><span className={styles.mockSend}><ArrowUpRight size={17}/></span></div>
              </div>
            </div>
          </div>
          <div className={styles.visualBottom}><span>UNE INTERFACE, PLUSIEURS POSSIBILITÉS</span><span className={styles.visualRing} aria-hidden="true">✳</span></div>
        </div>
      </section>

      <section className={styles.marquee} aria-label="Domaines d'utilisation"><div className={styles.marqueeInner}><span>DISCUTEZ</span><i/><span>ANALYSEZ</span><i/><span>APPRENEZ</span><i/><span>CRÉEZ</span><i/><span>AVANCEZ</span></div></section>

      <section className={styles.featuresSection} id="fonctionnalites" aria-labelledby="features-title">
        <div className={styles.sectionHeading}><p className={styles.sectionKicker}>01 — LES POSSIBILITÉS</p><div><h2 id="features-title">Vos idées ne rentrent<br/>pas dans une case.</h2><p>Votre outil non plus. Passez d’une simple question à un document, une création ou un nouveau projet sans changer d’univers.</p></div></div>
        <div className={styles.featuresGrid}>
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return <article className={`${styles.feature} ${index===1 ? styles.featureDark : ""}`} key={feature.number}>
              <div className={styles.featureTop}><span>{feature.number}</span><Icon size={26} strokeWidth={1.45}/></div>
              <div><h3>{feature.title}</h3><p>{feature.description}</p></div>
              <div className={styles.featureTags}>{feature.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            </article>;
          })}
        </div>
        <div className={styles.featureFootnote}><span><Globe2 size={17}/> Rechercher sur le Web</span><span><Code2 size={17}/> Écrire du code</span><span><Video size={17}/> Créer une vidéo</span><span><FileText size={17}/> Générer un document</span></div>
      </section>

      <section className={styles.howSection} id="fonctionnement" aria-labelledby="how-title">
        <div className={styles.howIntro}><p className={styles.sectionKicker}>02 — LE FONCTIONNEMENT</p><h2 id="how-title">L'essentiel,<br/><em>sans complication.</em></h2><p>Tout se passe dans un seul espace. Vous choisissez le bon outil, ORIA s’occupe de vous accompagner.</p><Link href="/chat" className={styles.textLink}>Accéder à mon espace <ArrowUpRight size={18}/></Link></div>
        <div className={styles.howSteps}>
          <div className={styles.howStep}><span>01</span><div><h3>Commencez à votre rythme</h3><p>{FREE_PUBLIC ? "Utilisez votre quota quotidien de 150 crédits ORIA selon vos droits, ou choisissez un pack pour aller plus loin." : "Créez votre compte et consultez les packs actuellement disponibles pour accéder aux services IA."}</p></div><ArrowUpRight size={22}/></div>
          <div className={styles.howStep}><span>02</span><div><h3>Choisissez votre modèle</h3><p>Accédez aux modèles disponibles dans votre pack et ajustez la réflexion selon votre tâche.</p></div><ArrowUpRight size={22}/></div>
          <div className={styles.howStep}><span>03</span><div><h3>Passez à l'action</h3><p>Discutez, joignez un document, faites une recherche ou lancez une création.</p></div><ArrowUpRight size={22}/></div>
        </div>
      </section>

      <section className={styles.creditsSection} aria-labelledby="credit-title">
        <div className={styles.creditsMain}><p className={styles.sectionKicker}>03 — DES CRÉDITS, PAS DES SURPRISES</p><h2 id="credit-title">Vous créez.<br/><span>Vous gardez le contrôle.</span></h2><p>Avec ORIA, vos actions utilisent des crédits. Suivez votre solde, choisissez le modèle adapté et consultez les coûts avant les opérations les plus exigeantes.</p><div className={styles.creditPills}><span><Check size={15}/> "Validité de 35 jours pour les packs payants"</span>{FREE_PUBLIC && <span><Check size={15}/> Jusqu’à 150 crédits gratuits par jour</span>}<span><Check size={15}/> Suivi du solde</span><span><Check size={15}/> Crédits complémentaires</span></div></div>
        <div className={styles.creditVisual} aria-label="Illustration du suivi des crédits"><div className={styles.creditVisualTop}><span>MON ESPACE</span><span className={styles.creditVisualDot}/></div><div className={styles.creditMetricLabel}>Utilisation des crédits</div><div className={styles.creditMetric}>À votre rythme<span>.</span></div><div className={styles.creditBar}><span/></div><div className={styles.creditVisualLine}><span>Un solde clair</span><ShieldCheck size={18}/></div><div className={styles.creditVisualLine}><span>Un coût adapté à l’action</span><Check size={18}/></div><div className={styles.creditVisualFooter}>Illustration de l'interface — valeurs non contractuelles</div></div>
      </section>

      <section className={styles.offersSection} id="offres" aria-labelledby="offers-title"><div className={styles.offersHeading}><div><p className={styles.sectionKicker}>04 — CHOISISSEZ VOTRE RYTHME</p><h2 id="offers-title">Un pack pour<br/>chaque ambition.</h2></div><p>"Les conditions, modèles, crédits et tarifs des packs payants sont présentés dans ORIA avant la souscription."</p></div>
        <div className={styles.offersGrid}>{offers.map((offer, index) => <div className={`${styles.offer} ${offer.accent ? styles.offerAccent : ""}`} key={offer.name}><div className={styles.offerTop}><span>{String(index+1).padStart(2,"0")}</span>{offer.accent && <span className={styles.offerPopular}>Plus de possibilités</span>}</div><h3>{offer.name}</h3><p className={styles.offerPosition}>{offer.position}</p><p className={styles.offerDescription}>{offer.description}</p><div className={styles.offerFooter}><span>{offer.models} au catalogue*</span><ArrowUpRight size={20}/></div></div>)}</div><div className={styles.offersBottom}><p>*Répartition prévue des modèles par pack, susceptible d’évoluer selon les disponibilités fournisseurs.</p><Link href="/chat" className={styles.blackButton}>Découvrir les packs dans ORIA <ArrowUpRight size={18}/></Link></div>
      </section>

      <section className={styles.faqSection} id="questions" aria-labelledby="faq-title"><div className={styles.faqIntro}><p className={styles.sectionKicker}>05 — QUESTIONS FRÉQUENTES</p><h2 id="faq-title">Tout ce que vous<br/>voulez savoir.</h2><p>Une question supplémentaire ? Consultez notre centre d’aide.</p><Link href="/help" className={styles.textLink}>Centre d’aide <ArrowUpRight size={17}/></Link></div><div className={styles.faqList}>{questions.map((item, i) => <details className={styles.faqItem} key={item.question}><summary><span className={styles.faqNumber}>{String(i+1).padStart(2,"0")}</span><span>{item.question}</span><span className={styles.faqPlus}>+</span></summary><p>{item.answer}</p></details>)}</div></section>

      <section className={styles.bottomCta}><span className={styles.bottomCtaIcon}><Sparkles size={24} strokeWidth={1.4}/></span><p>VOTRE PROCHAIN PROJET COMMENCE ICI</p><h2>Et si on allait<br/>plus loin ?</h2><Link href="/chat" className={styles.bottomCtaButton}>Entrer dans ORIA <ArrowUpRight size={20}/></Link><span className={styles.ctaDecoration} aria-hidden="true">O</span></section>

      <footer className={styles.footer}><div className={styles.footerTop}><div><Brand footer/><p>Une autre façon d’explorer l’intelligence artificielle.</p></div><nav aria-label="Navigation de pied de page"><a href="#fonctionnalites">Fonctionnalités</a><a href="#offres">Les packs</a><Link href="/help">Aide</Link><Link href="/legal">Informations légales</Link></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} ORIA. Tous droits réservés.</span><span>MYORIAAI.COM</span></div></footer>
    </main>
  );
}
