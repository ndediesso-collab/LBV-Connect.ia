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

// La landing est publique : le backend vérifie l'éligibilité au paiement.
// Le drapeau public ne débloque aucun droit ni aucun crédit.
const DISCOVERY_PUBLIC = process.env.NEXT_PUBLIC_ORIA_DISCOVERY_ENABLED === "1";

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
  { question: "Comment fonctionnent les crédits ORIA ?", answer: "Chaque action utilise des crédits selon le modèle et la fonctionnalité. Le solde et la consommation sont suivis dans votre espace ORIA." },
  { question: "Combien de temps un pack reste-t-il actif ?", answer: DISCOVERY_PUBLIC
    ? "Le Pack Découverte propose des crédits sans date d'expiration, jusqu'à épuisement du solde. Les packs Léger, Intermédiaire, Pro et Business restent valables 35 jours après activation."
    : "Les packs ORIA ont une validité de 35 jours à partir de leur activation. Le détail des conditions est présenté avant l'achat." },
  { question: "Puis-je utiliser plusieurs modèles d'IA ?", answer: "Oui. Le catalogue dépend du pack choisi et des fournisseurs disponibles dans ORIA à ce moment-là." },
  { question: "La génération d'images et de vidéos est-elle incluse ?", answer: "Ces fonctionnalités sont accessibles selon le pack et consomment des crédits. La génération vidéo peut représenter une consommation importante : vérifiez le coût affiché avant de confirmer." },
  { question: "ORIA est-elle gratuite ?", answer: "L'accès à l'interface peut être libre, mais l'utilisation des services IA nécessite un pack payant actif. ORIA ne propose pas de pack gratuit permanent." },
  ...(DISCOVERY_PUBLIC ? [{ question: "Qui peut acheter le Pack Découverte ?", answer: "Cette offre de bienvenue à 1 000 FCFA est réservée aux comptes éligibles et ne peut être achetée qu'une fois. Une seule recharge de 1 000 crédits à 600 FCFA est prévue pour les bénéficiaires." }] : []),
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
        .oria-discovery-hero {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          max-width: 620px; margin-top: 24px; padding: 15px 18px;
          border: 1px solid #dad9d4; border-radius: 16px;
          background: #efeee9; color: #151515; text-decoration: none;
          transition: border-color .18s ease, background .18s ease;
        }
        .oria-discovery-hero:hover, .oria-discovery-hero:focus-visible {
          background: #e8e7e1; border-color: #989892;
        }
        .oria-discovery-hero-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .oria-discovery-hero-label { font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
        .oria-discovery-hero-text strong { font-size: 14px; font-weight: 650; line-height: 1.4; }
        .oria-discovery-hero-price { display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; font-size: 14px; font-weight: 750; white-space: nowrap; }
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
        @media (max-width: 430px) {
          .oria-discovery-hero { flex-wrap: wrap; gap: 8px; padding: 13px 14px; }
          .oria-discovery-hero-price { width: 100%; justify-content: space-between; }
        }
      `}</style>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Brand />
          <nav className={styles.desktopNav} aria-label="Navigation principale">
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
              <a href="#fonctionnalites">Fonctionnalités</a>
              <a href="#fonctionnement">Comment ça marche</a>
              <a href="#offres">Les packs</a>
              <a href="#questions">FAQ</a>
              <Link href="/chat">Ouvrir ORIA <ArrowUpRight size={16}/></Link>
            </nav>
          </details>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroContent}>
          <span className={styles.eyebrow}><span className={styles.eyebrowLine}/> VOTRE ESPACE IA, À VOTRE RYTHME</span>
          <h1 id="hero-title">Plusieurs intelligences.<br/><span>Une seule expérience.</span></h1>
          <p className={styles.heroText}>Échangez, apprenez, créez et faites avancer vos projets. ORIA réunit différents modèles d’intelligence artificielle dans un espace simple, pensé pour passer de l’idée au résultat.</p>
          {DISCOVERY_PUBLIC && (
            <Link href="/packs" className="oria-discovery-hero" aria-label="Découvrir le Pack Découverte ORIA à 1 000 FCFA">
              <span className="oria-discovery-hero-text">
                <span className="oria-discovery-hero-label">NOUVEAU · PACK DÉCOUVERTE</span>
                <strong>8 000 crédits sans expiration · achat unique</strong>
              </span>
              <span className="oria-discovery-hero-price">1 000 FCFA <ArrowUpRight size={17} aria-hidden="true" /></span>
            </Link>
          )}
          <div className={styles.heroActions}>
            <Link href="/chat" className={styles.primaryButton}>Découvrir ORIA <ArrowUpRight size={19} strokeWidth={1.8}/></Link>
            <a href="#fonctionnalites" className={styles.secondaryButton}>Explorer les possibilités <ArrowRight size={18} strokeWidth={1.7}/></a>
          </div>
          <div className={styles.heroBottomNote}><span className={styles.noteDot}/><span>Chat · Documents · Images · Vidéos · Recherche Web</span></div>
        </div>
        <div className={styles.heroVisual} aria-label="Aperçu illustratif de l'interface ORIA">
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
          <div className={styles.howStep}><span>01</span><div><h3>Choisissez votre pack</h3><p>Sélectionnez l’offre qui correspond à vos besoins et à votre manière d’utiliser l’IA.</p></div><ArrowUpRight size={22}/></div>
          <div className={styles.howStep}><span>02</span><div><h3>Choisissez votre modèle</h3><p>Accédez aux modèles disponibles dans votre pack et ajustez la réflexion selon votre tâche.</p></div><ArrowUpRight size={22}/></div>
          <div className={styles.howStep}><span>03</span><div><h3>Passez à l'action</h3><p>Discutez, joignez un document, faites une recherche ou lancez une création.</p></div><ArrowUpRight size={22}/></div>
        </div>
      </section>

      <section className={styles.creditsSection} aria-labelledby="credit-title">
        <div className={styles.creditsMain}><p className={styles.sectionKicker}>03 — DES CRÉDITS, PAS DES SURPRISES</p><h2 id="credit-title">Vous créez.<br/><span>Vous gardez le contrôle.</span></h2><p>Avec ORIA, vos actions utilisent des crédits. Suivez votre solde, choisissez le modèle adapté et consultez les coûts avant les opérations les plus exigeantes.</p><div className={styles.creditPills}><span><Check size={15}/> {DISCOVERY_PUBLIC ? "35 jours pour les packs classiques" : "Validité de 35 jours"}</span>{DISCOVERY_PUBLIC && <span><Check size={15}/> Découverte : crédits sans expiration</span>}<span><Check size={15}/> Suivi du solde</span><span><Check size={15}/> Crédits complémentaires</span></div></div>
        <div className={styles.creditVisual} aria-label="Illustration du suivi des crédits"><div className={styles.creditVisualTop}><span>MON ESPACE</span><span className={styles.creditVisualDot}/></div><div className={styles.creditMetricLabel}>Utilisation des crédits</div><div className={styles.creditMetric}>À votre rythme<span>.</span></div><div className={styles.creditBar}><span/></div><div className={styles.creditVisualLine}><span>Un solde clair</span><ShieldCheck size={18}/></div><div className={styles.creditVisualLine}><span>Un coût adapté à l’action</span><Check size={18}/></div><div className={styles.creditVisualFooter}>Illustration de l'interface — valeurs non contractuelles</div></div>
      </section>

      <section className={styles.offersSection} id="offres" aria-labelledby="offers-title"><div className={styles.offersHeading}><div><p className={styles.sectionKicker}>04 — CHOISISSEZ VOTRE RYTHME</p><h2 id="offers-title">Un pack pour<br/>chaque ambition.</h2></div><p>{DISCOVERY_PUBLIC ? "Une offre de bienvenue à paiement unique, puis quatre niveaux d’accès. Les conditions et disponibilités sont vérifiées lors de la souscription." : "Quatre niveaux d’accès. Les modèles, crédits et tarifs exacts sont présentés dans votre espace ORIA au moment de la souscription."}</p></div>
        {DISCOVERY_PUBLIC && (
          <article className="oria-discovery-offer" aria-labelledby="discovery-offer-title">
            <div className="oria-discovery-copy">
              <span className="oria-discovery-kicker">OFFRE DE BIENVENUE · UNE SEULE FOIS PAR COMPTE</span>
              <h3 id="discovery-offer-title">Découvrez ORIA.<br/><span>Gardez votre temps.</span></h3>
              <p>Le Pack Découverte vous permet de commencer avec 8 000 crédits qui ne périment pas. Vous accédez à une sélection de fonctionnalités, avec des quotas spécifiques pour les modèles et les créations multimédias.</p>
              <div className="oria-discovery-chips" aria-label="Fonctions prévues dans le Pack Découverte">
                <span>GPT-6 Luna</span>
                <span>2 essais Terra</span>
                <span>1 image Recraft · 1K</span>
                <span>2 vidéos Grok · 4 s / 480p</span>
              </div>
            </div>
            <div className="oria-discovery-side">
              <span className="oria-discovery-volume">8 000<small>crédits sans expiration</small></span>
              <span className="oria-discovery-price">1 000 FCFA<small>Un paiement, pas d’abonnement</small></span>
              <Link href="/packs">Voir le Pack Découverte <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <span className="oria-discovery-fineprint">Offre soumise à éligibilité · Un achat par compte · Une recharge unique possible : 1 000 crédits pour 600 FCFA.</span>
            </div>
          </article>
        )}
        <div className={styles.offersGrid}>{offers.map((offer, index) => <div className={`${styles.offer} ${offer.accent ? styles.offerAccent : ""}`} key={offer.name}><div className={styles.offerTop}><span>{String(index+1).padStart(2,"0")}</span>{offer.accent && <span className={styles.offerPopular}>Plus de possibilités</span>}</div><h3>{offer.name}</h3><p className={styles.offerPosition}>{offer.position}</p><p className={styles.offerDescription}>{offer.description}</p><div className={styles.offerFooter}><span>{offer.models} au catalogue*</span><ArrowUpRight size={20}/></div></div>)}</div><div className={styles.offersBottom}><p>*Répartition prévue des modèles par pack, susceptible d’évoluer selon les disponibilités fournisseurs.</p><Link href="/chat" className={styles.blackButton}>Découvrir les packs dans ORIA <ArrowUpRight size={18}/></Link></div>
      </section>

      <section className={styles.faqSection} id="questions" aria-labelledby="faq-title"><div className={styles.faqIntro}><p className={styles.sectionKicker}>05 — QUESTIONS FRÉQUENTES</p><h2 id="faq-title">Tout ce que vous<br/>voulez savoir.</h2><p>Une question supplémentaire ? Consultez notre centre d’aide.</p><Link href="/help" className={styles.textLink}>Centre d’aide <ArrowUpRight size={17}/></Link></div><div className={styles.faqList}>{questions.map((item, i) => <details className={styles.faqItem} key={item.question}><summary><span className={styles.faqNumber}>{String(i+1).padStart(2,"0")}</span><span>{item.question}</span><span className={styles.faqPlus}>+</span></summary><p>{item.answer}</p></details>)}</div></section>

      <section className={styles.bottomCta}><span className={styles.bottomCtaIcon}><Sparkles size={24} strokeWidth={1.4}/></span><p>VOTRE PROCHAIN PROJET COMMENCE ICI</p><h2>Et si on allait<br/>plus loin ?</h2><Link href="/chat" className={styles.bottomCtaButton}>Entrer dans ORIA <ArrowUpRight size={20}/></Link><span className={styles.ctaDecoration} aria-hidden="true">O</span></section>

      <footer className={styles.footer}><div className={styles.footerTop}><div><Brand footer/><p>Une autre façon d’explorer l’intelligence artificielle.</p></div><nav aria-label="Navigation de pied de page"><a href="#fonctionnalites">Fonctionnalités</a><a href="#offres">Les packs</a><Link href="/help">Aide</Link><Link href="/legal">Informations légales</Link></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} ORIA. Tous droits réservés.</span><span>MYORIAAI.COM</span></div></footer>
    </main>
  );
}
