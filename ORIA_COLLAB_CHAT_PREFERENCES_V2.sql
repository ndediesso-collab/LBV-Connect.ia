-- ORIA Collaboratif : préférences individuelles de chat (par utilisateur ET espace).
-- Exécuter dans Supabase SQL Editor une seule fois, AVANT le déploiement du backend.
-- Aucune table de messages/crédits modifiée ; aucune clé API ajoutée au navigateur.
BEGIN;
CREATE TABLE IF NOT EXISTS public.oria_collab_chat_preferences (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('openai','openrouter')),
    model text NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9.\-]{0,79}$'),
    reasoning_mode text NOT NULL CHECK (reasoning_mode IN ('fast','balanced','deep')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
ALTER TABLE public.oria_collab_chat_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oria_collab_chat_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.oria_collab_chat_preferences TO service_role;
COMMIT;
