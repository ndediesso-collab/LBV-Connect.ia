-- ORIA Collaboratif P7 : edition de messages HUMAINS du groupe (sans toucher aux jobs IA).
-- A appliquer dans Supabase SQL Editor AVANT d'activer le bouton Modifier.
-- Le script ne modifie aucun solde, aucune reservation et aucun achat.
BEGIN;

ALTER TABLE public.oria_collab_group_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE TABLE IF NOT EXISTS public.oria_collab_group_message_edits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id uuid NOT NULL,
  group_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  previous_content text NOT NULL,
  updated_content text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oria_collab_edits_message_idx
  ON public.oria_collab_group_message_edits(message_id,edited_at DESC);
ALTER TABLE public.oria_collab_group_message_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oria_collab_group_message_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.oria_collab_group_message_edits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.oria_collab_group_message_edits_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.oria_collab_chat_group_edit_v1(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_group_id uuid,
  p_message_id uuid,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_grant jsonb;
  v_write jsonb;
  v_row public.oria_collab_group_messages%ROWTYPE;
  v_edited_at timestamptz;
  v_content text;
BEGIN
  v_content := btrim(coalesce(p_content,''));
  IF p_actor_user_id IS NULL OR p_workspace_id IS NULL OR p_group_id IS NULL
     OR p_message_id IS NULL OR length(v_content) NOT BETWEEN 1 AND 4000
  THEN RAISE EXCEPTION 'collab_edit_invalid_input'; END IF;
  -- Les appels @ORIA sont une preuve de facturation : interdiction de changer leur texte.
  IF v_content ~* '(^|[^[:alnum:]_])@oria([^[:alnum:]_]|$)'
  THEN RAISE EXCEPTION 'collab_edit_ai_prompt_forbidden'; END IF;
  -- Autorisation serveur de lecture du groupe courant, pas d'ID fourni par le client seul.
  v_write := public.oria_collab_scope_write_auth_v5(
     p_actor_user_id, p_workspace_id, false);
  IF v_write->>'success' IS DISTINCT FROM 'true'
     OR v_write->>'member_user_id' IS DISTINCT FROM p_actor_user_id::text
     OR v_write->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
  THEN RAISE EXCEPTION 'collab_edit_write_forbidden'; END IF;
  v_grant := public.oria_collab_workspace_group_messages_v3(
     p_actor_user_id, p_workspace_id, p_group_id, NULL::uuid, 1);
  IF v_grant->>'success' IS DISTINCT FROM 'true'
     OR v_grant->>'group_id' IS DISTINCT FROM p_group_id::text
     OR v_grant->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
  THEN RAISE EXCEPTION 'collab_edit_group_forbidden'; END IF;

  SELECT m.* INTO v_row
  FROM public.oria_collab_group_messages m
  JOIN public.oria_collab_groups g ON g.id=m.group_id
  WHERE m.id=p_message_id AND m.group_id=p_group_id
        AND g.workspace_id=p_workspace_id
  FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'collab_edit_message_missing'; END IF;
  IF v_row.sender_user_id IS DISTINCT FROM p_actor_user_id
     OR v_row.sender_kind = 'oria'
     OR v_row.ai_request_id IS NOT NULL
     OR v_row.content ~* '(^|[^[:alnum:]_])@oria([^[:alnum:]_]|$)'
  THEN RAISE EXCEPTION 'collab_edit_not_owner_or_ai_message'; END IF;
  -- Ne pas modifier la legende d'un fichier ou d'une note vocale partagee.
  IF EXISTS (SELECT 1 FROM public.oria_collab_chat_files f WHERE f.group_message_id=p_message_id)
  THEN RAISE EXCEPTION 'collab_edit_attachment_message'; END IF;
  IF v_row.content = v_content THEN
     RETURN jsonb_build_object('success',true,'workspace_id',p_workspace_id,
       'group_id',p_group_id,'message_id',p_message_id,
       'content',v_content,'edited_at',v_row.edited_at);
  END IF;
  v_edited_at := now();
  UPDATE public.oria_collab_group_messages
    SET content=v_content, edited_at=v_edited_at
    WHERE id=p_message_id;
  INSERT INTO public.oria_collab_group_message_edits
    (message_id,group_id,workspace_id,actor_user_id,previous_content,updated_content,edited_at)
  VALUES (p_message_id,p_group_id,p_workspace_id,p_actor_user_id,v_row.content,v_content,v_edited_at);
  RETURN jsonb_build_object('success',true,'workspace_id',p_workspace_id,
     'group_id',p_group_id,'message_id',p_message_id,
     'content',v_content,'edited_at',v_edited_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.oria_collab_chat_group_edit_v1(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oria_collab_chat_group_edit_v1(uuid,uuid,uuid,uuid,text)
  TO service_role;

-- Optionnel : ne restreindre audio que si une allowlist MIME est deja en place.
-- ATTENTION : cette requete n'ouvre pas le bucket au public.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT x) FROM unnest(
    allowed_mime_types || ARRAY['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']::text[]
  ) AS x
)
WHERE id='oria-collab-private' AND allowed_mime_types IS NOT NULL;

COMMIT;

-- Controle :
SELECT
  to_regprocedure('public.oria_collab_chat_group_edit_v1(uuid,uuid,uuid,uuid,text)') IS NOT NULL AS edition_installee,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='oria_collab_group_messages' AND column_name='edited_at') AS date_edition_installee,
  (SELECT public FROM storage.buckets WHERE id='oria-collab-private') AS bucket_public;
