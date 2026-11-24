"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, LockKeyhole, RefreshCcw } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type Space = {
  id: string;
  name?: string;
  owner_user_id: string;
  role: "owner" | "member";
  owner_pack_id: string | null;
  owner_pack_active: boolean;
};
type Directory = { success: boolean; workspaces: Space[] };
type Access = "loading" | "allowed" | "locked" | "missing" | "error";

function eligible(space: Space): boolean {
  return space.owner_pack_active === true &&
    (space.owner_pack_id === "pro_pack" || space.owner_pack_id === "business_pack");
}

export default function WorkspaceEntitlementLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const [access, setAccess] = useState<Access>("loading");
  const [workspace, setWorkspace] = useState<Space | null>(null);
  const [checking, setChecking] = useState(false);

  const verify = useCallback(async () => {
    if (!workspaceId) { setAccess("missing"); return; }
    try {
      const directory = await collabRequest<Directory>("/collaboratif/workspaces");
      if (!directory.success || !Array.isArray(directory.workspaces)) {
        setAccess("error"); return;
      }
      const current = directory.workspaces.find(space => space.id === workspaceId) ?? null;
      setWorkspace(current);
      setAccess(!current ? "missing" : eligible(current) ? "allowed" : "locked");
    } catch {
      // Jamais afficher des messages deja charges sans validation du pack.
      setAccess("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    setAccess("loading"); setWorkspace(null);
    void verify();
    const timer = window.setInterval(() => void verify(), 30_000);
    const onFocus = () => { void verify(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void verify(); };
    const onRevoked = () => { setAccess("locked"); void verify(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("oria-collab-entitlement-changed", onRevoked);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("oria-collab-entitlement-changed", onRevoked);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [verify]);

  if (access === "allowed" && workspace?.id === workspaceId) return <>{children}</>;

  const owner = workspace?.role === "owner";
  const locked = access === "locked";
  return (
    <main className="min-h-dvh bg-background px-5 py-12 text-foreground">
      <div className="mx-auto max-w-lg">
        <Link href="/collaboratif/espaces" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={17} /> Mes espaces collaboratifs
        </Link>
        <section className="mt-12 rounded-2xl border border-border bg-surface p-7 sm:p-9" aria-live="polite">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-border">
            <LockKeyhole size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {locked ? "Espace collaboratif temporairement suspendu" :
             access === "loading" ? "Vérification de l'abonnement…" :
             access === "missing" ? "Espace inaccessible" : "Vérification indisponible"}
          </h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            {locked && owner
              ? "Votre pack Pro ou Business n'est plus actif, ou a été remplacé par un pack inférieur. Renouvelez un pack éligible pour retrouver votre espace."
              : locked
              ? "Le propriétaire de cet espace doit disposer d'un pack Pro ou Business actif. Contactez l'administrateur pour retrouver l'accès."
              : access === "loading"
              ? "Nous vérifions les droits du propriétaire avant d'ouvrir les conversations."
              : access === "missing"
              ? "Cet espace n'est pas rattaché à votre profil professionnel actif."
              : "Impossible de confirmer l'abonnement pour le moment. Par sécurité, l'accès aux conversations est suspendu."}
          </p>
          {locked && <p className="mt-4 rounded-xl border border-border p-4 text-sm leading-6">
            Aucune donnée n'est supprimée : groupes, messages, pièces jointes et profils seront retrouvés après réactivation du pack éligible.
          </p>}
          <div className="mt-7 flex flex-wrap gap-3">
            {locked && owner && <Link href="/packs" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background">
              Voir les packs Pro et Business <ArrowRight size={16} />
            </Link>}
            <button type="button" disabled={checking} onClick={() => {
              setChecking(true);
              void verify().finally(() => setChecking(false));
            }} className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-semibold disabled:opacity-50">
              <RefreshCcw size={16} /> {checking ? "Vérification…" : "Réessayer"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
