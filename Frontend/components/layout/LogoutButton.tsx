"use client";

import { LogOut, Loader2 } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);

    const supabase = createClient();

    // ORIA_COLLAB_P16_LOGOUT_UNSUBSCRIBE : pas d'alertes pour l'ancien compte
    // sur un appareil prêté ou connecté à un autre utilisateur.
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const subscription = await reg?.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
      }
    } catch { /* La déconnexion reste possible si le navigateur refuse le Push. */ }

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("SUPABASE LOGOUT ERROR:", error);
      setLoading(false);
      return;
    }

    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <Loader2 size={17} className="animate-spin" />
      ) : (
        <LogOut size={17} />
      )}

      {loading ? "Déconnexion..." : "Se déconnecter"}
    </button>
  );
}