"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, LockKeyhole, PencilLine, RefreshCcw } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type Space = {
  id: string;
  name: string;
  owner_user_id: string;
  role: "owner" | "member";
  member_status: "active" | "suspended" | "banned";
  owner_pack_id: string | null;
  owner_pack_active: boolean;
  seat_limit: number;
  created_at: string;
};
type Directory = {
  success: boolean;
  workspaces: Space[];
  can_create_workspace: boolean;
};

function canOpenWorkspace(space: Space): boolean {
  return space.owner_pack_active === true &&
    (space.owner_pack_id === "pro_pack" || space.owner_pack_id === "business_pack");
}

const link = "rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-surface";
const primary = "rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50";

export default function EspacesCollaboratifs() {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const result = await collabRequest<Directory>("/collaboratif/workspaces");
    if (!result.success || !Array.isArray(result.workspaces)) {
      throw new Error("Répertoire des espaces invalide.");
    }
    setDirectory(result);
  }, []);

  useEffect(() => {
    let alive = true;
    void collabRequest<Directory>("/collaboratif/workspaces")
      .then((result) => {
        if (alive) {
          if (!result.success || !Array.isArray(result.workspaces)) {
            throw new Error("Répertoire des espaces invalide.");
          }
          setDirectory(result);
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function rename() {
    if (!renameId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await collabRequest<{success:boolean;name:string}>(
        "/collaboratif/workspaces/mine", "PATCH", { name: name.trim() },
      );
      if (!result.success) throw new Error("Renommage non confirmé.");
      setRenameId(null);
      setNotice(`Espace renommé : ${result.name}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Renommage impossible.");
    } finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-12">
      <Link href="/chat" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={16}/> Retour à mon ORIA personnel
      </Link>
      <div className="mt-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><Building2 size={29}/> Mes espaces collaboratifs</h1>
          <p className="mt-2 text-sm text-muted">Les espaces restent liés à votre compte ORIA, même après déconnexion.</p>
        </div>
        <button type="button" className={link} disabled={busy} onClick={() => {
          setLoading(true); setError("");
          void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Chargement impossible."))
            .finally(() => setLoading(false));
        }}><RefreshCcw className="mr-2 inline" size={15}/> Actualiser</button>
      </div>

      {loading && <p role="status" className="mt-8 text-sm text-muted">Chargement de vos espaces…</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl border border-border p-4 text-sm">{notice}</p>}

      {!loading && directory && <div className="mt-7 space-y-4">
        {directory.workspaces.length === 0 && <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="font-semibold">Aucun espace rattaché à votre compte.</p>
          <p className="mt-2 text-sm text-muted">Un propriétaire Pro ou Business peut créer un espace. Les collaborateurs y accèdent après acceptation d'une invitation.</p>
          {directory.can_create_workspace && <Link href="/collaboratif" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline">Créer mon espace <ArrowRight size={15}/></Link>}
        </div>}
        {directory.workspaces.map((space) => <article key={space.id} className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><Building2 size={19}/><h2 className="break-words text-lg font-semibold">{space.name}</h2></div>
              <p className="mt-2 text-xs text-muted">{space.role === "owner" ? "Propriétaire" : "Collaborateur"} · {space.seat_limit} profil(s) selon le pack du propriétaire</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
              {canOpenWorkspace(space) ? <CheckCircle2 size={14}/> : <LockKeyhole size={14}/>}
              {canOpenWorkspace(space) ? "Accès collaboratif actif" : "Espace suspendu"}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {/* 6B1 : les ecrans historiques sont encore mono-espace. */}
            <Link href={`/collaboratif/espaces/${encodeURIComponent(space.id)}/chat`} className={primary}>
              {canOpenWorkspace(space) ? "Ouvrir l’espace" : "Voir le statut de l’espace"} <ArrowRight className="ml-1 inline" size={15}/>
            </Link>
            {canOpenWorkspace(space) && space.role === "owner" && <Link href={`/collaboratif/invitations-email?workspace=${encodeURIComponent(space.id)}`} className={link}>Inviter par lien</Link>}
            {space.role === "owner" && canOpenWorkspace(space) && <button type="button" className={link}
              onClick={() => { setRenameId(space.id); setName(space.name); setError(""); }}>
              <PencilLine className="mr-2 inline" size={14}/> Renommer
            </button>}
          </div>
          {renameId === space.id && <div className="mt-5 rounded-xl border border-border p-4">
            <label className="block text-xs font-semibold" htmlFor="space-name">Nom de votre espace</label>
            <input id="space-name" type="text" maxLength={80} value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
            <div className="mt-3 flex gap-2">
              <button type="button" className={primary} disabled={busy || name.trim().length < 3}
                onClick={() => void rename()}>Enregistrer</button>
              <button type="button" className={link} disabled={busy} onClick={() => setRenameId(null)}>Annuler</button>
            </div>
          </div>}
        </article>)}
        <p className="rounded-xl border border-border p-4 text-xs text-muted">
          Architecture 6B1 : le répertoire et le renommage sont actifs après déploiement. L'ouverture de plusieurs espaces et les invitations e-mail seront activées seulement après le raccordement explicite de toutes les conversations, groupes et portefeuilles à l'espace sélectionné. Aucune donnée privée n'est partagée entre les espaces.
        </p>
      </div>}
    </div>
  </main>;
}
