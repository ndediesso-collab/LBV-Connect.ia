"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, LockKeyhole, Users, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Workspace = {
  id: string;
  owner_user_id: string;
  created_at: string;
};

type CollaboratifStatus = {
  success: boolean;
  enabled: boolean;
  phase: number;
  eligible: boolean;
  pack_id: string | null;
  seat_limit: number;
  is_owner?: boolean;
  member_status?: string | null;
  workspace: Workspace | null;
  active_profiles?: number;
  over_limit?: boolean;
  access_granted: boolean;
  can_create_workspace: boolean;
};

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "https://lbv-connect-api.onrender.com"
).replace(/\/$/, "");
const supabase = createClient();

async function authenticatedFetch(path: string, method: "GET" | "POST" = "GET") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) {
    throw new Error("Veuillez vous connecter à votre compte ORIA.");
  }
  const response = await fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    headers: {
      "user-id": session.user.id,
      authorization: `Bearer ${session.access_token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.detail === "string"
      ? payload.detail : "Opération indisponible.");
  }
  return payload;
}

export default function CollaboratifPage() {
  const [status, setStatus] = useState<CollaboratifStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const value = await authenticatedFetch("/collaboratif/status");
      setStatus(value as CollaboratifStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function activateWorkspace() {
    if (submitting || !status?.can_create_workspace) return;
    setSubmitting(true);
    setError(null);
    try {
      await authenticatedFetch("/collaboratif/workspace", "POST");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Activation impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  const packName = status?.pack_id === "business_pack"
    ? "Business" : status?.pack_id === "pro_pack" ? "Pro" : "Non éligible";

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <Link href="/chat" className="inline-flex items-center gap-2 rounded-lg text-sm text-muted hover:text-foreground">
          <ArrowLeft size={16} /> Retour au chat ORIA
        </Link>

        <header className="mt-9 border-b border-border pb-9">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted">
            <Building2 size={14} /> ORIA pour les équipes
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">ORIA Collaboratif</h1>
          <p className="mt-3 text-lg text-muted">Le travail d&apos;équipe, réinventé.</p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Un espace professionnel commun, des identités sécurisées et, bientôt,
            des groupes dans lesquels ORIA pourra travailler avec votre équipe.
          </p>
        </header>

        {loading ? (
          <p className="py-10 text-sm text-muted" role="status">Vérification de votre espace professionnel…</p>
        ) : (
          <div className="mt-8 space-y-6">
            {error && (
              <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm">
                <p>{error}</p>
                <button className="mt-3 underline" type="button" onClick={() => void refresh()}>
                  Réessayer
                </button>
              </div>
            )}

            {!status ? (
              <section className="rounded-2xl border border-border bg-surface p-6">
                <h2 className="text-lg font-semibold">État du module indisponible</h2>
                <p className="mt-2 text-sm text-muted">La connexion à ORIA Collaboratif n’a pas pu être vérifiée.</p>
              </section>
            ) : !status.enabled ? (
              <section className="rounded-2xl border border-border bg-surface p-6">
                <LockKeyhole className="mb-3" size={22} />
                <h2 className="text-xl font-semibold">Module en préparation</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  La fonctionnalité est désactivée sur ce serveur. Les conversations,
                  les crédits et les packs ORIA existants continuent de fonctionner normalement.
                </p>
              </section>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-surface p-5">
                    <Wallet size={19} className="text-muted" />
                    <p className="mt-4 text-xs text-muted">Abonnement du propriétaire</p>
                    <p className="mt-1 text-xl font-semibold">{packName}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface p-5">
                    <Users size={19} className="text-muted" />
                    <p className="mt-4 text-xs text-muted">Places autorisées</p>
                    <p className="mt-1 text-xl font-semibold">{status?.seat_limit ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface p-5">
                    <CheckCircle2 size={19} className="text-muted" />
                    <p className="mt-4 text-xs text-muted">Profils actifs</p>
                    <p className="mt-1 text-xl font-semibold">{status?.active_profiles ?? 0}</p>
                  </div>
                </div>

                {!status?.eligible ? (
                  <section className="rounded-2xl border border-border bg-surface p-6">
                    <h2 className="text-lg font-semibold">Un pack Pro ou Business actif est nécessaire</h2>
                    <p className="mt-2 text-sm text-muted">
                      Vos données collaboratives, lorsqu&apos;elles existent, sont conservées
                      même après un changement ou une expiration de pack.
                    </p>
                    <Link href="/packs" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline">
                      Consulter les packs <ArrowRight size={15} />
                    </Link>
                  </section>
                ) : status.workspace ? (
                  <section className="rounded-2xl border border-border bg-surface p-6">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={23} />
                      <div>
                        <h2 className="text-lg font-semibold">Espace professionnel enregistré</h2>
                        <p className="mt-2 text-sm leading-6 text-muted">
                          Votre espace est conservé indépendamment des changements de pack.
                          {status.access_granted
                            ? " Ses fondations sont prêtes pour les profils individuels."
                            : " Certaines opérations restent verrouillées jusqu'à régularisation."}
                        </p>
                      </div>
                    </div>
                    {status.over_limit && (
                      <p role="alert" className="mt-4 rounded-lg border border-border p-3 text-sm">
                        Le nombre de profils actifs dépasse la capacité du pack. Une sélection
                        des collaborateurs autorisés sera nécessaire.
                      </p>
                    )}
                    <Link href="/collaboratif/profils" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background">
                      Gérer les profils professionnels <ArrowRight size={17} />
                    </Link>
                    <p className="mt-4 text-xs text-muted">Le travail collaboratif se déroule dans les groupes. Les conversations personnelles restent dans ORIA classique.</p>
                  </section>
                ) : status.can_create_workspace ? (
                  <section className="rounded-2xl border border-border bg-surface p-6">
                    <h2 className="text-xl font-semibold">Créer votre espace professionnel</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                      Votre abonnement {packName} peut accueillir {status.seat_limit} profils,
                      administrateur compris. Cette activation ne débite aucun crédit et ne
                      modifie pas votre abonnement.
                    </p>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void activateWorkspace()}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-50"
                    >
                      {submitting ? "Activation en cours…" : "Activer mon espace"}
                      {!submitting && <ArrowRight size={17} />}
                    </button>
                  </section>
                ) : (
                  <section className="rounded-2xl border border-border bg-surface p-6">
                    <h2 className="text-lg font-semibold">Accès professionnel réservé</h2>
                    <p className="mt-2 text-sm text-muted">
                      Vous n&apos;êtes pas autorisé à créer un espace ici.
                      Les invitations des collaborateurs seront disponibles en phase 2.
                    </p>
                  </section>
                )}
              </>
            )}
            <p className="text-xs leading-5 text-muted">
              Vos conversations ORIA classiques, vos générations et votre portefeuille actuel
              ne sont pas déplacés par cette première phase.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
