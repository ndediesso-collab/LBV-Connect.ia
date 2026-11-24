import { createClient } from "@/lib/supabase/client";

export const collabSupabase = createClient();
export const COLLAB_API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "https://lbv-connect-api.onrender.com"
).replace(/\/$/, "");

export type Profile = {
  id: string;
  user_id: string;
  role: "owner" | "member";
  status: "active" | "suspended" | "banned";
  first_name: string;
  last_name: string;
  avatar_key: string;
  phone_e164?: string | null;
  joined_at: string;
};
export type Invitation = {
  id: string;
  phone_e164: string;
  status: string;
  expires_at: string;
  created_at: string;
};
export type TeamData = {
  workspace_id: string;
  my_user_id: string;
  is_owner: boolean;
  eligible: boolean;
  pack_id: string | null;
  seat_limit: number;
  active_count: number;
  pending_count: number;
  profiles: Profile[];
  invitations: Invitation[];
};

export async function collabRequest<T>(
  path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown,
): Promise<T> {
  const { data: { session } } = await collabSupabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) {
    throw new Error("Connectez-vous à votre profil ORIA pour continuer.");
  }
  const response = await fetch(`${COLLAB_API_URL}${path}`, {
    method,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      "user-id": session.user.id,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403 && payload && typeof payload === "object" &&
        "code" in payload && (payload as { code?: string }).code === "COLLAB_OWNER_PACK_REQUIRED" &&
        typeof window !== "undefined") {
      window.dispatchEvent(new Event("oria-collab-entitlement-changed"));
    }
    const message = payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail : undefined;
    throw new Error(typeof message === "string" ? message : `Erreur serveur (${response.status}).`);
  }
  return payload as T;
}

export function profileLabel(profile: Profile) {
  const label = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  return label || (profile.role === "owner" ? "Administrateur" : "Collaborateur");
}

export const AVATARS: { key: string; label: string; className: string }[] = [
  { key: "ink", label: "Encre", className: "bg-neutral-900 text-white" },
  { key: "stone", label: "Pierre", className: "bg-neutral-700 text-white" },
  { key: "paper", label: "Papier", className: "bg-neutral-200 text-neutral-900" },
  { key: "slate", label: "Ardoise", className: "bg-neutral-500 text-white" },
  { key: "silver", label: "Argent", className: "bg-neutral-300 text-neutral-900" },
  { key: "carbon", label: "Carbone", className: "bg-black text-white" },
];
