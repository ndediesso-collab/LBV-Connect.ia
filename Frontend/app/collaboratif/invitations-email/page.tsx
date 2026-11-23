"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Link2, RotateCcw, Share2, Trash2 } from "lucide-react";
import { collabRequest } from "@/lib/collaboratif-api";

type Invite = {
  id: string;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};
type Listing = { success: boolean; invitations: Invite[] };
type Issued = { success: boolean; invite_id: string; expires_at: string; join_path: string };
const subtleButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-50";
const mainButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-50";

export default function InvitationsParLien() {
  const [workspace, setWorkspace] = useState("");
  const [entries, setEntries] = useState<Invite[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setWorkspace(new URLSearchParams(window.location.search).get("workspace") || "");
  }, []);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    const result = await collabRequest<Listing>(
      `/collaboratif/workspaces/${encodeURIComponent(workspace)}/share-invitations`,
    );
    if (!result.success || !Array.isArray(result.invitations)) throw new Error("Liste indisponible.");
    setEntries(result.invitations);
  }, [workspace]);

  useEffect(() => { if (workspace) void refresh().catch((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "Impossible de charger les invitations.");
  }); }, [workspace, refresh]);

  async function createLink() {
    if (busy || !workspace) return;
    setBusy(true); setError(""); setNotice(""); setGeneratedUrl("");
    try {
      const created = await collabRequest<Issued>(
        `/collaboratif/workspaces/${encodeURIComponent(workspace)}/share-invitations`, "POST",
      );
      if (!created.success || !created.join_path.startsWith("/collaboratif/rejoindre-lien#invitation=")) {
        throw new Error("Lien invalide retourné par le serveur.");
      }
      setGeneratedUrl(window.location.origin + created.join_path);
      setExpiresAt(created.expires_at);
      setNotice("Lien créé. Copiez-le et envoyez-le uniquement à la personne souhaitée.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Génération impossible."); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setNotice("Lien copié. Collez-le dans WhatsApp.");
    } catch { setError("Sélectionnez le lien puis copiez-le manuellement."); }
  }

  function shareWhatsApp() {
    if (!generatedUrl) return;
    const text = `Je t'invite à rejoindre notre espace ORIA Collaboratif :\n${generatedUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await collabRequest(
        `/collaboratif/workspaces/${encodeURIComponent(workspace)}/share-invitations/${encodeURIComponent(id)}/revoke`, "POST",
      );
      setGeneratedUrl("");
      setNotice("Invitation révoquée. Son lien ne permet plus de rejoindre l'équipe.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Révocation impossible."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/collaboratif/espaces" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"><ArrowLeft size={16}/> Mes espaces</Link>
      <h1 className="mt-8 flex items-center gap-3 text-3xl font-bold"><Link2 size={28}/> Inviter par lien</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Créez un lien unique, copiez-le et envoyez-le par WhatsApp. Aucun service e-mail payant n'est nécessaire. Chaque lien réserve une seule place pendant 72 heures.</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-border p-4 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl border border-border p-4 text-sm">{notice}</p>}
      {!workspace && <p className="mt-7 rounded-xl border border-border p-4 text-sm">Ouvrez cette page depuis un espace dont vous êtes propriétaire.</p>}
      {!!workspace && <>
        <section className="mt-7 rounded-2xl border border-border bg-surface p-5 sm:p-7">
          <button type="button" className={mainButton} onClick={() => void createLink()} disabled={busy}><Link2 size={17}/> {busy ? "Traitement…" : "Générer un lien d'invitation"}</button>
          {generatedUrl && <div className="mt-6 space-y-3">
            <label htmlFor="invite-url" className="block text-sm font-semibold">Lien à partager</label>
            <input id="invite-url" type="text" readOnly value={generatedUrl} onFocus={e => e.currentTarget.select()} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"/>
            <div className="flex flex-wrap gap-2">
              <button className={subtleButton} type="button" onClick={() => void copyLink()}><Copy size={16}/> Copier le lien</button>
              <button className={subtleButton} type="button" onClick={shareWhatsApp}><Share2 size={16}/> Partager sur WhatsApp</button>
            </div>
            <p className="text-xs text-muted">Expire le {new Date(expiresAt).toLocaleString("fr-FR")}. Ce lien n'est affiché qu'après sa création ; il ne pourra pas être récupéré depuis l'historique.</p>
          </div>}
          <p className="mt-5 text-xs leading-5 text-muted">Attention : le premier compte ORIA vérifié qui accepte ce lien rejoint votre équipe. Envoyez-le uniquement à un collaborateur de confiance, et révoquez-le en cas de partage accidentel.</p>
        </section>
        <div className="mt-8 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Invitations</h2>
          <button className={subtleButton} type="button" disabled={busy} onClick={() => void refresh()}><RotateCcw size={15}/> Actualiser</button>
        </div>
        <div className="mt-4 space-y-3">
          {!entries.length && <p className="rounded-xl border border-border p-5 text-sm text-muted">Aucune invitation générée.</p>}
          {entries.map(inv => <article key={inv.id} className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm font-semibold">{inv.status === "accepted" ? "Invitation acceptée" : inv.status === "revoked" ? "Invitation révoquée" : new Date(inv.expires_at).getTime() < Date.now() ? "Lien expiré" : "En attente d'adhésion"}</p>
                <p className="mt-1 text-xs text-muted">Créée le {new Date(inv.created_at).toLocaleString("fr-FR")}</p></div>
              {inv.status === "pending" && <button type="button" disabled={busy} className={subtleButton} onClick={() => void revoke(inv.id)}><Trash2 size={15}/> Révoquer</button>}
            </div>
          </article>)}
        </div>
      </>}
    </div>
  </main>;
}
