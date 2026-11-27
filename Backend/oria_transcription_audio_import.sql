-- ORIA Transcription — Chantier 3 : import audio long, privé et reprenable.
-- Migration additive : ne modifie ni oria_courses, ni le stockage des segments,
-- ni les devis/réservations/crédits. Aucun appel IA n'est déclenché ici.

CREATE TABLE IF NOT EXISTS public.oria_course_audio_imports (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    course_id UUID NOT NULL REFERENCES public.oria_courses(id) ON DELETE CASCADE,
    filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 180),
    mime_type TEXT NOT NULL,
    extension TEXT NOT NULL CHECK (extension IN ('webm','ogg','m4a','mp3','wav','aac','3gp')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 536870912),
    storage_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading','queued','processing','completed','failed')),
    phase TEXT NOT NULL DEFAULT 'uploading'
        CHECK (phase IN ('uploading','queued','downloading','verifying','splitting','uploading_segments','completed','failed')),
    progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms BETWEEN 400 AND 14400000),
    segment_count INTEGER CHECK (segment_count IS NULL OR segment_count BETWEEN 1 AND 120),
    error_code TEXT,
    worker_id UUID,
    lease_expires_at TIMESTAMPTZ,
    upload_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '23 hours'),
    source_deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oria_course_audio_import_path_matches_id
      CHECK (storage_path LIKE user_id::text || '/' || course_id::text || '/imports/' || id::text || '.%')
);

CREATE INDEX IF NOT EXISTS oria_course_audio_import_queue_idx
    ON public.oria_course_audio_imports(status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS oria_course_audio_import_course_idx
    ON public.oria_course_audio_imports(user_id, course_id, created_at DESC);

ALTER TABLE public.oria_course_audio_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oria_course_audio_imports FROM anon, authenticated;
GRANT ALL ON TABLE public.oria_course_audio_imports TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'oria-course-staging', 'oria-course-staging', false, 536870912,
  ARRAY['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/mp3','audio/wav',
        'audio/x-wav','audio/aac','audio/3gpp','audio/x-m4a','audio/m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 536870912,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_upload_allowed(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.oria_course_audio_imports AS i
    WHERE i.user_id = auth.uid()
      AND i.storage_path = p_object_name
      AND i.status = 'uploading'
      AND i.upload_expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_upload_allowed(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_upload_allowed(TEXT) TO authenticated;

DROP POLICY IF EXISTS oria_course_audio_import_upload_insert ON storage.objects;
CREATE POLICY oria_course_audio_import_upload_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'oria-course-staging'
  AND public.oria_course_audio_import_upload_allowed(name)
);

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_queue(
  p_user_id UUID, p_course_id UUID, p_import_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  SELECT * INTO v_row FROM public.oria_course_audio_imports
   WHERE id = p_import_id AND user_id = p_user_id AND course_id = p_course_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_not_found'; END IF;
  IF v_row.status IN ('queued','processing','completed') THEN RETURN to_jsonb(v_row); END IF;
  IF v_row.status <> 'uploading' OR v_row.upload_expires_at <= now() THEN
    RAISE EXCEPTION 'oria_course_audio_import_state_conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'oria-course-staging' AND name = v_row.storage_path
  ) THEN RAISE EXCEPTION 'oria_course_audio_import_object_missing'; END IF;
  UPDATE public.oria_course_audio_imports
     SET status = 'queued', phase = 'queued', progress_percent = 0,
         error_code = NULL, updated_at = now()
   WHERE id = p_import_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_claim(
  p_worker_id UUID, p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID; v_row public.oria_course_audio_imports;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_lease';
  END IF;
  SELECT id INTO v_id
    FROM public.oria_course_audio_imports
   WHERE status = 'queued'
      OR (status = 'processing' AND lease_expires_at < now())
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.oria_course_audio_imports
     SET status = 'processing', phase = CASE WHEN phase IN ('queued','uploading') THEN 'downloading' ELSE phase END,
         worker_id = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE id = v_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_heartbeat(
  p_import_id UUID, p_worker_id UUID, p_lease_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'oria_course_audio_import_invalid_lease'; END IF;
  UPDATE public.oria_course_audio_imports
     SET lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_progress(
  p_import_id UUID, p_worker_id UUID, p_phase TEXT, p_progress_percent INTEGER,
  p_duration_ms BIGINT DEFAULT NULL, p_segment_count INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_phase NOT IN ('downloading','verifying','splitting','uploading_segments')
     OR p_progress_percent < 0 OR p_progress_percent > 99 THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_progress';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET phase = p_phase, progress_percent = p_progress_percent,
         duration_ms = COALESCE(p_duration_ms, duration_ms),
         segment_count = COALESCE(p_segment_count, segment_count),
         lease_expires_at = now() + interval '5 minutes', updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_finish(
  p_import_id UUID, p_worker_id UUID, p_status TEXT,
  p_duration_ms BIGINT DEFAULT NULL, p_segment_count INTEGER DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  IF p_status NOT IN ('completed','failed') THEN RAISE EXCEPTION 'oria_course_audio_import_invalid_final_status'; END IF;
  IF p_status = 'completed' AND (p_duration_ms IS NULL OR p_segment_count IS NULL
      OR p_duration_ms < 400 OR p_duration_ms > 14400000
      OR p_segment_count < 1 OR p_segment_count > 120) THEN
    RAISE EXCEPTION 'oria_course_audio_import_invalid_result';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET status = p_status, phase = p_status,
         progress_percent = CASE WHEN p_status = 'completed' THEN 100 ELSE progress_percent END,
         duration_ms = COALESCE(p_duration_ms, duration_ms),
         segment_count = COALESCE(p_segment_count, segment_count),
         error_code = CASE WHEN p_status = 'failed' THEN left(COALESCE(p_error_code,'processing_failed'),80) ELSE NULL END,
         worker_id = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_import_id AND worker_id = p_worker_id AND status = 'processing'
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_lease_lost'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.oria_course_audio_import_retry(
  p_user_id UUID, p_course_id UUID, p_import_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp
AS $$
DECLARE v_row public.oria_course_audio_imports;
BEGIN
  SELECT * INTO v_row FROM public.oria_course_audio_imports
   WHERE id = p_import_id AND user_id = p_user_id AND course_id = p_course_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_course_audio_import_not_found'; END IF;
  IF v_row.status <> 'failed' THEN RAISE EXCEPTION 'oria_course_audio_import_state_conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='oria-course-staging' AND name=v_row.storage_path) THEN
    RAISE EXCEPTION 'oria_course_audio_import_object_missing';
  END IF;
  UPDATE public.oria_course_audio_imports
     SET status='queued', phase='queued', progress_percent=0, error_code=NULL,
         worker_id=NULL, lease_expires_at=NULL, updated_at=now()
   WHERE id=p_import_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.oria_course_audio_import_queue(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_claim(UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_heartbeat(UUID,UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_progress(UUID,UUID,TEXT,INTEGER,BIGINT,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_finish(UUID,UUID,TEXT,BIGINT,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oria_course_audio_import_retry(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_queue(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_claim(UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_heartbeat(UUID,UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_progress(UUID,UUID,TEXT,INTEGER,BIGINT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_finish(UUID,UUID,TEXT,BIGINT,INTEGER,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.oria_course_audio_import_retry(UUID,UUID,UUID) TO service_role;
