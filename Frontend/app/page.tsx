import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <nav className="relative z-20 flex items-center justify-between border-b border-border bg-background/90 px-5 py-4 backdrop-blur sm:px-8">
        <Link
          href="/"
          className="group flex items-center gap-3 text-lg font-semibold tracking-tight"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-secondary text-sm font-bold transition-transform duration-300 group-hover:-rotate-3">
            N
          </span>
          <span>Oria</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
          >
            Connexion
          </Link>

          <Link
            href="/packs"
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-85"
          >
            Commencer
          </Link>
        </div>
      </nav>

      <section className="relative isolate flex min-h-[calc(100dvh-73px)] items-center px-5 py-16 sm:px-8 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute -left-24 top-20 h-72 w-72 rounded-full border border-border opacity-60 sm:h-96 sm:w-96" />
          <div className="absolute -right-28 top-10 h-80 w-80 rounded-full border border-border opacity-60 sm:h-[30rem] sm:w-[30rem]" />
          <div className="absolute left-[8%] top-[14%] h-24 w-24 rotate-45 border border-border opacity-40 sm:h-32 sm:w-32" />
          <div className="absolute right-[12%] top-[18%] h-20 w-20 -rotate-12 rounded-3xl border border-border opacity-40 sm:h-28 sm:w-28" />
          <div className="absolute bottom-[9%] left-[16%] hidden h-40 w-40 border-b-2 border-l-2 border-border opacity-50 sm:block" />
          <div className="absolute bottom-[12%] right-[14%] hidden h-32 w-32 border-r-2 border-t-2 border-border opacity-50 sm:block" />
          <div className="absolute inset-x-0 top-[21%] mx-auto hidden h-px max-w-6xl bg-border opacity-50 lg:block" />
          <div className="absolute left-1/2 top-0 h-[120%] w-px -translate-x-1/2 bg-border opacity-25" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-6xl">
          <div className="mx-auto max-w-5xl text-center">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-surface/85 px-4 py-2 text-sm text-muted-strong shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-foreground" />
              Une intelligence pensée depuis l&apos;Afrique
            </div>

            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
              L&apos;IA pour
              <br />
              <span className="relative inline-block">
                comprendre, créer et avancer.
                <span
                  aria-hidden="true"
                  className="absolute -bottom-2 left-1/2 h-1 w-20 -translate-x-1/2 rounded-full bg-foreground/80"
                />
              </span>
            </h1>

            <p className="mx-auto mt-8 max-w-3xl text-base leading-8 text-muted-strong sm:text-lg">
              Oria réunit plusieurs modèles d&apos;intelligence artificielle
              dans un seul espace pour discuter, raisonner, rechercher sur le
              Web, analyser vos fichiers et créer des images ou des vidéos.
            </p>

            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/packs"
                className="w-full rounded-xl bg-foreground px-6 py-3.5 text-sm font-medium text-background transition hover:-translate-y-0.5 hover:opacity-90 sm:w-auto"
              >
                Découvrir Oria
              </Link>

              <Link
                href="/login"
                className="w-full rounded-xl border border-border bg-surface px-6 py-3.5 text-sm font-medium transition hover:bg-surface-secondary sm:w-auto"
              >
                Se connecter
              </Link>
            </div>

            <div className="mx-auto mt-12 flex max-w-2xl items-center justify-center gap-4 text-xs uppercase tracking-[0.22em] text-muted">
              <span className="hidden h-px flex-1 bg-border sm:block" />
              <span>Technologie · Créativité · Afrique</span>
              <span className="hidden h-px flex-1 bg-border sm:block" />
            </div>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              number="01"
              title="Chat multi-IA"
              description="Discutez avec plusieurs modèles depuis une interface unique et choisissez la puissance adaptée à votre besoin."
            />

            <Feature
              number="02"
              title="Recherche Web"
              description="Explorez des informations disponibles sur le Web directement depuis votre espace de travail."
            />

            <Feature
              number="03"
              title="Raisonnement"
              description="Travaillez sur des problèmes complexes avec des modèles conçus pour l’analyse et la réflexion avancées."
            />

            <Feature
              number="04"
              title="Analyse de fichiers"
              description="Importez vos documents et utilisez l’IA pour comprendre, extraire et exploiter leur contenu."
            />

            <Feature
              number="05"
              title="Création d’images"
              description="Transformez vos idées en visuels générés par l’IA à partir de simples descriptions."
            />

            <Feature
              number="06"
              title="Création de vidéos"
              description="Donnez vie à vos concepts grâce aux capacités vidéo disponibles dans votre pack."
            />
          </div>

          <div className="mx-auto mt-4 max-w-5xl">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8">
              <div
                aria-hidden="true"
                className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rotate-45 border border-border opacity-40"
              />

              <div className="relative max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                  Maîtrisez votre utilisation
                </p>

                <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                  Un système de crédits simple et transparent.
                </h2>

                <p className="mt-2 text-sm leading-6 text-muted-strong sm:text-base">
                  Chaque opération consomme un nombre de crédits adapté à la
                  capacité utilisée. Vous gardez le contrôle de votre
                  utilisation depuis votre espace.
                </p>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-14 max-w-3xl text-center">
            <p className="text-sm leading-6 text-muted">
              Une plateforme d&apos;intelligence artificielle conçue pour
              simplifier l&apos;accès à des outils puissants, sans multiplier
              les services et les interfaces.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article className="group relative overflow-hidden rounded-3xl border border-border bg-surface p-6 transition duration-300 hover:-translate-y-1 hover:bg-surface-secondary">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.18em] text-muted">
          {number}
        </span>

        <span
          aria-hidden="true"
          className="h-3 w-3 rotate-45 border border-border transition-transform duration-300 group-hover:rotate-90"
        />
      </div>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">
        {title}
      </h2>

      <p className="mt-2 text-sm leading-6 text-muted-strong">
        {description}
      </p>
    </article>
  );
}
