"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, KeyRound, Lock, Plus, Shield, UserRound, Users, X } from "lucide-react";
import { AVATARS, collabRequest, collabSupabase, profileLabel } from "@/lib/collaboratif-api";
import type { Profile, TeamData } from "@/lib/collaboratif-api";

const inputClass = "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-foreground/25";
const buttonClass = "rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50";

function ProfileAvatar({ profile, large = false }: { profile: Profile; large?: boolean }) {
  const avatar = AVATARS.find((a) => a.key === profile.avatar_key) || AVATARS[0];
  const initials = `${profile.first_name?.[0] || ""}${profile.last_name?.[0] || ""}`.toUpperCase()
    || (profile.role === "owner" ? "A" : "O");
  return (
    <div className={`flex items-center justify-center rounded-3xl border border-border font-bold tracking-widest ${avatar.className} ${large ? "h-24 w-24 text-3xl" : "h-20 w-20 text-2xl"}`}>
      {initials}
    </div>
  );
}

export default function CollaboratifProfilesPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("+241");
  const [invitationLink, setInvitationLink] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [avatar, setAvatar] = useState("ink");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await collabRequest<TeamData>("/collaboratif/profiles");
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d'afficher les profils.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function openProfile(profile: Profile) {
    setSelected(profile);
    setFirst(profile.first_name || "");
    setLast(profile.last_name || "");
    setAvatar(profile.avatar_key || "ink");
    setError("");
    setNotice("");
  }

  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action impossible."); }
    finally { setBusy(false); }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(async () => {
      const result = await collabRequest<{ token: string; expires_at: string }>(
        "/collaboratif/invitations", "POST", { phone_e164: phone });
      const url = `${window.location.origin}/collaboratif/rejoindre#invitation=${encodeURIComponent(result.token)}`;
      setInvitationLink(url);
      setPhone("+241");
      setNotice("Invitation créée. Copiez ce lien maintenant : il n'est affiché qu'une fois.");
    });
  }

  async function changeStatus(profile: Profile, status: "active" | "suspended" | "banned") {
    if (status === "banned" && !window.confirm(
      `Bannir ${profileLabel(profile)} ? L'accès professionnel sera bloqué immédiatement. Les quotas non consommés et les recharges personnelles disponibles seront repris par l'administrateur ; les réservations en cours restent à rapprocher. Cette opération est irréversible.`)) return;
    await action(async () => {
      await collabRequest(`/collaboratif/members/${profile.user_id}/status`, "PATCH", { status });
      setSelected(null);
      setNotice("Statut mis à jour. Les accès professionnels sont revérifiés à chaque requête.");
    });
  }

  async function saveSelf(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(async () => {
      await collabRequest("/collaboratif/profile/me", "PATCH", {
        first_name: first, last_name: last, avatar_key: avatar,
      });
      setSelected(null);
      setNotice("Profil mis à jour.");
    });
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) { setError("Le nouveau mot de passe doit contenir au moins 12 caractères."); return; }
    await action(async () => {
      const { data: { user } } = await collabSupabase.auth.getUser();
      if (!user) throw new Error("Session expirée.");
      const credentials = user.phone
        ? { phone: user.phone, password: currentPassword }
        : { email: user.email || "", password: currentPassword };
      const { error: signInError } = await collabSupabase.auth.signInWithPassword(credentials);
      if (signInError) throw new Error("Ancien mot de passe incorrect.");
      const { error: changeError } = await collabSupabase.auth.updateUser({ password: newPassword });
      if (changeError) throw changeError;
      setCurrentPassword(""); setNewPassword("");
      setNotice("Mot de passe modifié.");
    });
  }

  const current = data?.profiles.find((p) => p.user_id === data.my_user_id);
  const active = data?.active_count || 0;
  const pending = data?.pending_count || 0;
  const total = data?.seat_limit || 0;
  const seatsAvailable = Boolean(data?.is_owner && data.eligible && active + pending < total);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <Link href="/collaboratif" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={16} /> Espace Collaboratif
        </Link>
        <header className="mt-10 mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-muted">ORIA • PROFILS PROFESSIONNELS</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Qui travaille aujourd&apos;hui ?</h1>
          <p className="mt-3 text-sm text-muted">Chaque profil possède son identité et ses propres accès.</p>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-border p-4 text-sm">{error}</div>}
        {notice && <div role="status" className="mb-5 rounded-xl border border-border p-4 text-sm">{notice}</div>}
        {loading ? <p className="text-center text-sm text-muted">Chargement des profils…</p> : !data ? (
          <div className="rounded-2xl border border-border p-6 text-center">
            <Lock className="mx-auto mb-3" />
            <p className="text-sm">Aucun espace accessible. Vérifiez votre connexion ou votre abonnement.</p>
            <Link href="/collaboratif/connexion" className="mt-4 inline-block underline">Connexion collaborateur</Link>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-8 flex flex-wrap justify-center gap-6">
              {data.profiles.map((profile) => (
                <button key={profile.user_id} onClick={() => openProfile(profile)}
                  className={`group flex w-36 flex-col items-center gap-3 rounded-2xl border p-4 transition hover:border-foreground focus-visible:outline-2 ${selected?.user_id === profile.user_id ? "border-foreground" : "border-transparent"}`}>
                  <div className={profile.status === "active" ? "" : "opacity-45 grayscale"}>
                    <ProfileAvatar profile={profile} />
                  </div>
                  <span className="w-full truncate text-center text-sm font-semibold">{profileLabel(profile)}</span>
                  <span className="text-center text-xs text-muted">
                    {profile.role === "owner" ? "Administrateur" : profile.status === "active" ? "Actif" : profile.status === "banned" ? "Banni" : "Suspendu"}
                  </span>
                  {profile.user_id === data.my_user_id && <span className="text-xs underline">Mon profil</span>}
                </button>
              ))}
              {seatsAvailable && <div className="flex w-36 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-border"><Plus size={27} /></div>
                <span className="text-center text-sm">Ajouter une personne</span>
              </div>}
            </div>

            <div className="mb-8 flex flex-wrap items-center justify-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-2"><Users size={14} /> {active} actifs</span>
              <span>{pending} invitations réservées</span>
              <span>{total} places ({data.pack_id === "business_pack" ? "Business" : data.pack_id === "pro_pack" ? "Pro" : "Pack expiré"})</span>
              <Link href="/collaboratif/connexion" className="underline">Changer de profil</Link>
              {!data.is_owner && <Link href={`/collaboratif/espaces/${encodeURIComponent(data.workspace_id)}/actions`} className="underline">Mes recharges personnelles</Link>}
              <Link href="/collaboratif/mes-conversations" className="underline">{data.is_owner ? "Consulter les conversations" : "Mes conversations privées"}</Link>
              <Link href="/collaboratif/quotas" className="underline">{data.is_owner ? "Gérer les quotas" : "Mon quota professionnel"}</Link>
              <Link href="/collaboratif/groupes" className="underline">Salons de groupe</Link>
            </div>

            {selected && <section className="mx-auto mb-8 max-w-2xl rounded-2xl border border-border bg-surface p-5 sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><ProfileAvatar profile={selected} /><div>
                  <h2 className="font-semibold">{profileLabel(selected)}</h2>
                  <p className="text-xs text-muted">{selected.role === "owner" ? "Administrateur" : "Collaborateur"} • {selected.status}</p>
                </div></div>
                <button type="button" aria-label="Fermer" onClick={() => setSelected(null)}><X size={20} /></button>
              </div>
              {selected.user_id === data.my_user_id ? (
                <>
                  <p className="mb-4 text-sm text-muted">Vous êtes connecté à ce profil. Le chat privé textuel est disponible uniquement sur les environnements de test autorisés.</p>
                  <form onSubmit={(event) => void saveSelf(event)} className="space-y-3">
                    <label className="block text-xs">Prénom<input className={`mt-1 ${inputClass}`} value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} required /></label>
                    <label className="block text-xs">Nom<input className={`mt-1 ${inputClass}`} value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} required /></label>
                    <div className="flex flex-wrap gap-2" aria-label="Choisir un avatar">
                      {AVATARS.map((a) => <button type="button" key={a.key} onClick={() => setAvatar(a.key)}
                        className={`h-11 w-11 rounded-xl ${a.className} ${avatar === a.key ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`} aria-label={a.label}>{a.key[0].toUpperCase()}</button>)}
                    </div>
                    <button className={buttonClass} disabled={busy}>Enregistrer mon profil</button>
                  </form>
                  <form onSubmit={(event) => void updatePassword(event)} className="mt-7 space-y-3 border-t border-border pt-6">
                    <h3 className="flex items-center gap-2 font-medium"><KeyRound size={17} /> Changer mon mot de passe</h3>
                    <input type="password" className={inputClass} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Mot de passe actuel" required autoComplete="current-password" />
                    <input type="password" className={inputClass} minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nouveau mot de passe (12 caractères minimum)" required autoComplete="new-password" />
                    <button className={buttonClass} disabled={busy}>Modifier mon mot de passe</button>
                  </form>
                </>
              ) : (
                <div className="space-y-4 text-sm">
                  <p>Ce profil exige sa propre authentification. Son mot de passe n&apos;est pas accessible à l&apos;administrateur.</p>
                  <Link className="inline-flex items-center gap-2 underline" href="/collaboratif/connexion"><Lock size={16} /> Se connecter à ce profil</Link>
                  {data.is_owner && selected.role === "member" && <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                    {selected.status === "active" && <button type="button" className="rounded-xl border border-border px-4 py-2" disabled={busy}
                      onClick={() => void changeStatus(selected, "suspended")}>Suspendre</button>}
                    {selected.status === "suspended" && <button type="button" className="rounded-xl border border-border px-4 py-2" disabled={busy}
                      onClick={() => void changeStatus(selected, "active")}>Réactiver</button>}
                    {selected.status !== "banned" && <button type="button" className="rounded-xl border border-border px-4 py-2" disabled={busy}
                      onClick={() => void changeStatus(selected, "banned")}>Bannir</button>}
                  </div>}
                </div>
              )}
            </section>}

            {data.is_owner && <section className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface p-5 sm:p-7">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Shield size={19} /> Administration de l&apos;équipe</h2>
              <p className="mt-2 text-sm text-muted">Ouvrez une place à un collaborateur via son numéro de téléphone vérifié. Une invitation réserve une place pendant 72 heures.</p>
              <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void invite(event)}>
                <label className="flex-1 text-xs">Téléphone du collaborateur
                  <input className={`mt-1 ${inputClass}`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+241XXXXXXXX" required />
                </label>
                <button className={`${buttonClass} self-end`} disabled={busy || !seatsAvailable}>Créer une invitation</button>
              </form>
              {!data.eligible && <p className="mt-3 text-xs text-muted">Renouvelez le pack Pro ou Business pour inviter.</p>}
              {invitationLink && <div className="mt-5 rounded-xl border border-border p-4">
                <p className="mb-2 text-xs font-semibold">Lien à communiquer directement au collaborateur :</p>
                <p className="break-all text-xs text-muted">{invitationLink}</p>
                <button className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm"
                  type="button" onClick={() => { void navigator.clipboard.writeText(invitationLink).then(() => setNotice("Lien copié.")).catch(() => setError("Copie impossible : sélectionnez le lien manuellement.")); }}><Copy size={16} /> Copier</button>
              </div>}
              {data.invitations.length > 0 && <div className="mt-6 space-y-2">
                <h3 className="text-sm font-semibold">Invitations en attente</h3>
                {data.invitations.map((inv) => <div key={inv.id} className="flex items-center justify-between gap-4 rounded-xl border border-border p-3 text-xs">
                  <div><div className="font-medium">{inv.phone_e164}</div><div className="text-muted">Expire le {new Date(inv.expires_at).toLocaleString("fr-GA")}</div></div>
                  <button className="underline" type="button" disabled={busy} onClick={() => void action(async () => {
                    await collabRequest(`/collaboratif/invitations/${inv.id}/revoke`, "POST");
                    setNotice("Invitation révoquée.");
                  })}>Révoquer</button>
                </div>)}
              </div>}
              <p className="mt-5 text-xs leading-5 text-muted">Les conversations professionnelles seront supervisables en lecture seule par l&apos;administrateur à partir de la phase 3. Les collaborateurs en sont informés à l&apos;inscription.</p>
            </section>}
          </>
        )}
        <footer className="mx-auto mt-10 max-w-2xl border-t border-border pt-5 text-xs text-muted">
          <div className="flex items-center gap-2"><Check size={13} /> Les quotas sont attribués sur le pack existant et les recharges restent personnelles.</div>
          {current && <p className="mt-2">Session actuelle : {profileLabel(current)}.</p>}
        </footer>
      </div>
    </main>
  );
}
