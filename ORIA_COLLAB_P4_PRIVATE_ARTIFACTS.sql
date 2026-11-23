-- ORIA Collaboratif P4: privately generated artifacts in collaborator AI chats.
-- Requires the P2 storage bucket and the EXISTING private-chat v3 settlement.
-- NO replacement of the provider or chat billing engine.
-- Execute in Supabase SQL editor only after review of the function signatures.
BEGIN;

CREATE TABLE IF NOT EXISTS public.oria_collab_private_generated_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  private_message_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, id)
);
CREATE INDEX IF NOT EXISTS oria_collab_private_generated_files_list_idx
  ON public.oria_collab_private_generated_files(workspace_id,conversation_id,created_at);
ALTER TABLE public.oria_collab_private_generated_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oria_collab_private_generated_files FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.oria_collab_settle_private_chat_artifacts_v1(
  p_member_user_id uuid, p_request_id uuid, p_actual_credits bigint,
  p_provider_response_id text, p_provider_cost_usd numeric,
  p_response text, p_actual_api_cost_xaf numeric, p_workspace_id uuid,
  p_artifacts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE
  v_job public.oria_collab_private_chat_jobs%ROWTYPE;
  v_item jsonb;
  v_file_id uuid;
  v_storage_path text;
  v_filename text;
  v_mime text;
  v_size bigint;
  v_sha text;
  v_message_id uuid;
  v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_existing public.oria_collab_private_generated_files%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF p_member_user_id IS NULL OR p_workspace_id IS NULL OR p_request_id IS NULL
    OR p_artifacts IS NULL OR jsonb_typeof(p_artifacts) <> 'array'
    OR jsonb_array_length(p_artifacts) NOT BETWEEN 1 AND 3
  THEN RAISE EXCEPTION 'collab_private_doc_invalid_input'; END IF;
  PERFORM 1 FROM public.oria_collab_workspaces WHERE id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collab_private_doc_workspace_missing'; END IF;
  SELECT * INTO v_job FROM public.oria_collab_private_chat_jobs
    WHERE id=p_request_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND OR v_job.member_user_id IS DISTINCT FROM p_member_user_id
    OR v_job.state NOT IN ('reserved','settled')
  THEN RAISE EXCEPTION 'collab_private_doc_job_invalid'; END IF;

  -- Check exact private-conversation scope before settling anything.
  PERFORM 1 FROM public.oria_collab_private_conversations
    WHERE id=v_job.conversation_id AND workspace_id=p_workspace_id
      AND member_user_id=p_member_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collab_private_doc_conversation_invalid'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_artifacts)
  LOOP
    v_count := v_count + 1;
    IF jsonb_typeof(v_item)<>'object' OR
       (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 6 OR
       NOT (v_item ?& ARRAY['file_id','storage_path','original_name','mime_type','size_bytes','sha256'])
    THEN RAISE EXCEPTION 'collab_private_doc_file_fields_invalid'; END IF;
    IF (v_item->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'collab_private_doc_file_id_invalid'; END IF;
    v_file_id := (v_item->>'file_id')::uuid;
    v_storage_path := v_item->>'storage_path';
    v_filename := btrim(coalesce(v_item->>'original_name',''));
    v_mime := btrim(coalesce(v_item->>'mime_type',''));
    v_sha := v_item->>'sha256';
    IF (v_item->>'size_bytes') !~ '^[0-9]{1,8}$'
    THEN RAISE EXCEPTION 'collab_private_doc_file_size_invalid'; END IF;
    v_size := (v_item->>'size_bytes')::bigint;
    IF v_storage_path IS NULL OR length(v_storage_path)>300 OR
       left(v_storage_path,length(p_workspace_id::text||'/'||p_request_id::text||'/'||v_file_id::text||'/'))
         <> p_workspace_id::text||'/'||p_request_id::text||'/'||v_file_id::text||'/'
       OR length(v_filename) NOT BETWEEN 1 AND 150
       OR length(v_mime) NOT BETWEEN 4 AND 150
       OR v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$'
       OR v_size NOT BETWEEN 1 AND 8388608
    THEN RAISE EXCEPTION 'collab_private_doc_metadata_invalid'; END IF;
    PERFORM 1 FROM storage.objects o
      WHERE o.bucket_id='oria-collab-private' AND o.name=v_storage_path;
    IF NOT FOUND THEN RAISE EXCEPTION 'collab_private_doc_storage_missing'; END IF;
    SELECT * INTO v_existing FROM public.oria_collab_private_generated_files WHERE id=v_file_id;
    IF FOUND AND (v_existing.workspace_id IS DISTINCT FROM p_workspace_id
      OR v_existing.member_user_id IS DISTINCT FROM p_member_user_id
      OR v_existing.request_id IS DISTINCT FROM p_request_id
      OR v_existing.storage_path IS DISTINCT FROM v_storage_path
      OR v_existing.original_name IS DISTINCT FROM v_filename
      OR v_existing.size_bytes IS DISTINCT FROM v_size
      OR v_existing.sha256 IS DISTINCT FROM v_sha)
    THEN RAISE EXCEPTION 'collab_private_doc_collision'; END IF;
  END LOOP;

  -- Authoritative, existing v3 quota/wallet settlement in THIS transaction.
  v_result := public.oria_collab_settle_private_chat_v3(
    p_member_user_id => p_member_user_id,
    p_request_id => p_request_id,
    p_actual_credits => p_actual_credits,
    p_provider_response_id => p_provider_response_id,
    p_provider_cost_usd => p_provider_cost_usd,
    p_response => p_response,
    p_actual_api_cost_xaf => p_actual_api_cost_xaf,
    p_workspace_id => p_workspace_id
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'collab_private_doc_settlement_unconfirmed';
  END IF;
  SELECT id INTO v_message_id FROM public.oria_collab_private_messages
    WHERE conversation_id=v_job.conversation_id AND request_id=p_request_id
      AND role='assistant' ORDER BY created_at DESC LIMIT 1;
  IF v_message_id IS NULL THEN RAISE EXCEPTION 'collab_private_doc_message_missing'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_artifacts)
  LOOP
    v_file_id := (v_item->>'file_id')::uuid;
    v_storage_path := v_item->>'storage_path';
    v_filename := btrim(v_item->>'original_name');
    v_mime := btrim(v_item->>'mime_type');
    v_size := (v_item->>'size_bytes')::bigint;
    v_sha := v_item->>'sha256';
    INSERT INTO public.oria_collab_private_generated_files (
      id,workspace_id,member_user_id,conversation_id,request_id,private_message_id,
      storage_path,original_name,mime_type,size_bytes,sha256
    ) VALUES (
      v_file_id,p_workspace_id,p_member_user_id,v_job.conversation_id,
      p_request_id,v_message_id,v_storage_path,v_filename,v_mime,v_size,v_sha
    ) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_existing FROM public.oria_collab_private_generated_files WHERE id=v_file_id;
    IF NOT FOUND OR v_existing.private_message_id IS DISTINCT FROM v_message_id
      OR v_existing.storage_path IS DISTINCT FROM v_storage_path
    THEN RAISE EXCEPTION 'collab_private_doc_file_link_unconfirmed'; END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id',v_file_id,'message_id',v_message_id,'original_name',v_filename
    ));
  END LOOP;
  RETURN v_result || jsonb_build_object('artifact_count',v_count,
    'files',v_rows,'message_id',v_message_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.oria_collab_private_generated_files_v1(
  p_actor_user_id uuid,p_workspace_id uuid,p_conversation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE v_scope jsonb;
BEGIN
  v_scope:=public.oria_collab_ai_workspace_identity_v7(
    p_actor_user_id,p_workspace_id,p_conversation_id,'private');
  IF v_scope->>'success' IS DISTINCT FROM 'true'
     OR v_scope->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
  THEN RAISE EXCEPTION 'collab_private_doc_forbidden'; END IF;
  RETURN jsonb_build_object('success',true,'workspace_id',p_workspace_id,
    'conversation_id',p_conversation_id,'files',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',f.id,'message_id',f.private_message_id,'original_name',f.original_name,
      'mime_type',f.mime_type,'size_bytes',f.size_bytes
    ) ORDER BY f.created_at) FROM public.oria_collab_private_generated_files f
    WHERE f.workspace_id=p_workspace_id AND f.conversation_id=p_conversation_id),'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.oria_collab_private_generated_file_access_v1(
  p_actor_user_id uuid,p_workspace_id uuid,p_file_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE v_f public.oria_collab_private_generated_files%ROWTYPE;v_scope jsonb;
BEGIN
  SELECT * INTO v_f FROM public.oria_collab_private_generated_files
    WHERE id=p_file_id AND workspace_id=p_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collab_private_doc_not_found'; END IF;
  v_scope:=public.oria_collab_ai_workspace_identity_v7(
    p_actor_user_id,p_workspace_id,v_f.conversation_id,'private');
  IF v_scope->>'success' IS DISTINCT FROM 'true'
     OR v_scope->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
  THEN RAISE EXCEPTION 'collab_private_doc_forbidden'; END IF;
  RETURN jsonb_build_object('success',true,'workspace_id',p_workspace_id,
    'file_id',v_f.id,'storage_path',v_f.storage_path,
    'original_name',v_f.original_name);
END;
$fn$;

REVOKE ALL ON FUNCTION public.oria_collab_settle_private_chat_artifacts_v1(uuid,uuid,bigint,text,numeric,text,numeric,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_collab_private_generated_files_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_collab_private_generated_file_access_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oria_collab_settle_private_chat_artifacts_v1(uuid,uuid,bigint,text,numeric,text,numeric,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_collab_private_generated_files_v1(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_collab_private_generated_file_access_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
