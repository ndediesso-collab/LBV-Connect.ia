import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Navigation */}

      <nav className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight transition-opacity hover:opacity-70"
        >
          LBV-Connect.ia
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted-strong transition hover:bg-surface-secondary hover:text-foreground"
          >
            Connexion
          </Link>

          <Link
            href="/packs"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-85"
          >
            Choisir un pack
          </Link>
        </div>
      </nav>

      {/* Hero */}

      <section className="flex min-h-[calc(100dvh-73px)] items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-4xl text-center">
          {/* Badge */}

          <div className="mb-6 inline-flex rounded-full border border-border bg-surface-secondary px-4 py-2 text-sm text-muted-strong">
            L&apos;intelligence artificielle, réunie
            au même endroit.
          </div>

          {/* Heading */}

          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Plusieurs IA.
            <br />

            <span className="text-muted">
              Une seule interface.
            </span>
          </h1>

          {/* Description */}

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-strong sm:text-lg">
            LBV-Connect.ia rassemble différentes
            technologies d&apos;intelligence artificielle
            dans une expérience unique, pensée pour
            les utilisateurs au Gabon.
          </p>

          {/* CTA */}

          <div className="mt-8 flex justify-center">
            <Link
              href="/packs"
              className="w-full rounded-xl bg-accent px-6 py-3 text-sm font-medium text-accent-foreground transition hover:opacity-85 sm:w-auto"
            >
              Choisir un pack
            </Link>
          </div>

          {/* Features */}

          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <Feature
              title="Chat IA"
              description="Discutez avec différents modèles depuis une seule interface."
            />

            <Feature
              title="Raisonnement"
              description="Accédez à des modèles adaptés aux problèmes complexes."
            />

            <Feature
              title="Crédits"
              description="Un système clair pour contrôler votre consommation."
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <h2 className="font-medium">
        {title}
      </h2>

      <p className="mt-2 text-sm leading-6 text-muted-strong">
        {description}
      </p>
    </div>
  );
}
