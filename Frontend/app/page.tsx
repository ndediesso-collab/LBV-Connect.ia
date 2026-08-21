import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      <nav className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight"
        >
          LBV-Connect.ia
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
          >
            Connexion
          </Link>

          <Link
            href="/register"
            className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            Commencer
          </Link>
        </div>
      </nav>

      <section className="flex min-h-[calc(100dvh-73px)] items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-4xl text-center">
          <div className="mb-6 inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
            L'intelligence artificielle, réunie au même endroit.
          </div>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Plusieurs IA.
            <br />
            <span className="text-neutral-500">
              Une seule interface.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-neutral-600 sm:text-lg">
            LBV-Connect.ia rassemble différentes technologies d'intelligence
            artificielle dans une expérience unique, pensée pour les
            utilisateurs au Gabon.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="w-full rounded-xl bg-neutral-950 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 sm:w-auto"
            >
              Commencer gratuitement
            </Link>

            <Link
              href="/packs"
              className="w-full rounded-xl border border-neutral-200 px-6 py-3 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 sm:w-auto"
            >
              Voir les packs
            </Link>
          </div>

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
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">
        {description}
      </p>
    </div>
  );
}
