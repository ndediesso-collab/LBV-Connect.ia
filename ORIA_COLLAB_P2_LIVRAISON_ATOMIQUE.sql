-- ORIA Collaboratif P2: group artifact delivery + existing quota settlement.
-- Execute in Supabase SQL Editor BEFORE enabling ORIA_COLLAB_GROUP_DOCUMENTS_ENABLED.
-- Does not replace OR modify oria_collab_group_ai_settle_v3.
-- The single Postgres transaction creates the assistant message via v3 and links
-- ALL the private verified objects, or performs none of these operations.

CREATE OR REPLACE FUNCTION public.oria_collab_group_ai_settle_artifacts_v1(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_actual_credits bigint,
  p_provider_response_id text,
  p_provider_cost_usd numeric,
  p_actual_api_cost_xaf numeric,
  p_response text,
  p_workspace_id uuid,
  p_artifacts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_job public.oria_collab_group_ai_jobs%ROWTYPE;
  v_item jsonb;
  v_file_id uuid;
  v_object_path text;
  v_name text;
  v_mime text;
  v_size bigint;
  v_sha text;
  v_message_id uuid;
  v_settled jsonb;
  v_found public.oria_collab_chat_files%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_counter integer := 0;
BEGIN
  IF p_actor_user_id IS NULL OR p_workspace_id IS NULL OR p_request_id IS NULL
     OR p_artifacts IS NULL OR jsonb_typeof(p_artifacts) <> 'array'
     OR jsonb_array_length(p_artifacts) NOT BETWEEN 1 AND 3
  THEN RAISE EXCEPTION 'collab_doc_invalid_input'; END IF;

  -- Match v3 lock ordering: workspace first, then job.
  PERFORM 1 FROM public.oria_collab_workspaces
    WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collab_doc_workspace_missing'; END IF;
  SELECT * INTO v_job FROM public.oria_collab_group_ai_jobs
    WHERE id = p_request_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND OR v_job.caller_user_id IS DISTINCT FROM p_actor_user_id
     OR v_job.state NOT IN ('reserved', 'settled')
  THEN RAISE EXCEPTION 'collab_doc_job_forbidden_or_unsettleable'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_artifacts)
  LOOP
    v_counter := v_counter + 1;
    IF jsonb_typeof(v_item) <> 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 6 OR
       NOT (v_item ?& ARRAY['file_id','storage_path','original_name','mime_type','size_bytes','sha256'])
    THEN RAISE EXCEPTION 'collab_doc_artifact_fields_invalid'; END IF;
    IF (v_item->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'collab_doc_id_invalid'; END IF;
    v_file_id := (v_item->>'file_id')::uuid;
    v_object_path := v_item->>'storage_path';
    v_name := btrim(coalesce(v_item->>'original_name', ''));
    v_mime := btrim(coalesce(v_item->>'mime_type', ''));
    v_sha := v_item->>'sha256';
    IF (v_item->>'size_bytes') !~ '^[0-9]{1,8}$'
    THEN RAISE EXCEPTION 'collab_doc_size_invalid'; END IF;
    v_size := (v_item->>'size_bytes')::bigint;
    IF v_object_path IS NULL OR length(v_object_path) > 300
       OR left(v_object_path, length(p_workspace_id::text||'/'||p_request_id::text||'/'||v_file_id::text||'/'))
          <> p_workspace_id::text||'/'||p_request_id::text||'/'||v_file_id::text||'/'
       OR length(v_name) NOT BETWEEN 1 AND 150
       OR length(v_mime) NOT BETWEEN 4 AND 150
       OR v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$'
       OR v_size NOT BETWEEN 1 AND 8388608
    THEN RAISE EXCEPTION 'collab_doc_file_metadata_invalid'; END IF;

    -- Supabase Storage must contain the object (uploaded and hash-checked by
    -- the backend using the service-role before this function is invoked).
    -- No user-provided URLs or arbitrary bucket paths are accepted.
    PERFORM 1 FROM storage.objects o
      WHERE o.bucket_id = 'oria-collab-private' AND o.name = v_object_path;
    IF NOT FOUND THEN RAISE EXCEPTION 'collab_doc_storage_object_missing'; END IF;

    -- On idempotent retries, never link a different object to the same file ID.
    SELECT * INTO v_found FROM public.oria_collab_chat_files WHERE id = v_file_id;
    IF FOUND AND (v_found.workspace_id IS DISTINCT FROM p_workspace_id
        OR v_found.storage_path IS DISTINCT FROM v_object_path
        OR v_found.original_name IS DISTINCT FROM v_name
        OR v_found.size_bytes IS DISTINCT FROM v_size)
    THEN RAISE EXCEPTION 'collab_doc_file_id_collision'; END IF;
  END LOOP;

  -- Existing v3 handles real provider debit, group quota splitting,
  -- provider audit, and creates the ORIA assistant message atomically.
  v_settled := public.oria_collab_group_ai_settle_v3(
    p_actor_user_id, p_request_id, p_actual_credits,
    p_provider_response_id, p_provider_cost_usd,
    p_actual_api_cost_xaf, p_response, p_workspace_id
  );
  IF v_settled->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'collab_doc_settlement_unconfirmed';
  END IF;
  v_message_id := NULLIF(v_settled->>'message_id','')::uuid;
  IF v_message_id IS NULL THEN
    SELECT id INTO v_message_id FROM public.oria_collab_group_messages
    WHERE group_id = v_job.group_id AND ai_request_id = p_request_id
      AND sender_kind = 'oria'
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_message_id IS NULL THEN RAISE EXCEPTION 'collab_doc_assistant_message_missing'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_artifacts)
  LOOP
    v_file_id := (v_item->>'file_id')::uuid;
    v_object_path := v_item->>'storage_path';
    v_name := btrim(v_item->>'original_name');
    v_mime := btrim(v_item->>'mime_type');
    v_size := (v_item->>'size_bytes')::bigint;
    INSERT INTO public.oria_collab_chat_files (
      id, workspace_id, uploader_user_id, group_message_id, direct_message_id,
      storage_path, original_name, mime_type, size_bytes
    ) VALUES (
      v_file_id, p_workspace_id, p_actor_user_id, v_message_id, NULL,
      v_object_path, v_name, v_mime, v_size
    ) ON CONFLICT (id) DO NOTHING;
    -- Verify even if ON CONFLICT prevented a write.
    SELECT * INTO v_found FROM public.oria_collab_chat_files WHERE id=v_file_id;
    IF NOT FOUND OR v_found.group_message_id IS DISTINCT FROM v_message_id
      OR v_found.workspace_id IS DISTINCT FROM p_workspace_id
      OR v_found.storage_path IS DISTINCT FROM v_object_path
    THEN RAISE EXCEPTION 'collab_doc_link_unconfirmed'; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'file_id', v_file_id, 'message_id', v_message_id,
      'original_name', v_name
    ));
  END LOOP;
  RETURN v_settled || jsonb_build_object('files', v_results,
    'artifact_count', v_counter, 'message_id', v_message_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.oria_collab_group_ai_settle_artifacts_v1(
  uuid,uuid,bigint,text,numeric,numeric,text,uuid,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oria_collab_group_ai_settle_artifacts_v1(
  uuid,uuid,bigint,text,numeric,numeric,text,uuid,jsonb
) TO service_role;

-- Quick metadata validation (no credit movement):
SELECT proname AS installed FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND proname='oria_collab_group_ai_settle_artifacts_v1';
