-- P8: affichage progressif durable et reprise du REGLEMENT, jamais de second appel fournisseur.
-- A installer AVANT d'activer P8. Cette table n'est jamais accessible aux clients Supabase.
BEGIN;
CREATE TABLE IF NOT EXISTS public.oria_collab_group_ai_delivery_progress (
  request_id uuid PRIMARY KEY REFERENCES public.oria_collab_group_ai_jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  group_id uuid NOT NULL,
  caller_user_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'running' CHECK (phase IN ('running','provider_complete','settled','uncertain')),
  seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0),
  preview text NOT NULL DEFAULT '' CHECK (char_length(preview) <= 4000),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oria_collab_p8_receipt_phase_check
    CHECK (phase NOT IN ('provider_complete','settled') OR receipt IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS oria_collab_p8_group_progress_idx
  ON public.oria_collab_group_ai_delivery_progress(workspace_id,group_id,updated_at DESC);
-- Defend against a wrong room, owner, replayed receipt or backwards revision.
CREATE OR REPLACE FUNCTION public.oria_collab_p8_progress_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
BEGIN
  PERFORM 1 FROM public.oria_collab_group_ai_jobs j
   WHERE j.id=NEW.request_id AND j.workspace_id=NEW.workspace_id
     AND j.group_id=NEW.group_id AND j.caller_user_id=NEW.caller_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'oria_collab_p8_wrong_job_scope'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.group_id IS DISTINCT FROM OLD.group_id
      OR NEW.caller_user_id IS DISTINCT FROM OLD.caller_user_id
      OR NEW.seq < OLD.seq
      OR (OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt)
    THEN RAISE EXCEPTION 'oria_collab_p8_immutable_receipt_or_scope'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS oria_collab_p8_progress_guard ON public.oria_collab_group_ai_delivery_progress;
CREATE TRIGGER oria_collab_p8_progress_guard
BEFORE INSERT OR UPDATE ON public.oria_collab_group_ai_delivery_progress
FOR EACH ROW EXECUTE FUNCTION public.oria_collab_p8_progress_guard_v1();
REVOKE ALL ON FUNCTION public.oria_collab_p8_progress_guard_v1() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.oria_collab_group_ai_delivery_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oria_collab_group_ai_delivery_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.oria_collab_group_ai_delivery_progress TO service_role;
COMMIT;
-- Lecture metadata uniquement, sans exposition des reçus financiers.
SELECT to_regclass('public.oria_collab_group_ai_delivery_progress') IS NOT NULL AS p8_table_installee;
