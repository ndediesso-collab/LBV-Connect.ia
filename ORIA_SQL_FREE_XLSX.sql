-- ORIA : ajout sûr des actions « free_xlsx_luna » et « chat_haiku ».
-- Basé sur la migration image gratuite du 15/11/2026.
-- À lancer dans l'éditeur SQL Supabase, avant déploiement du nouveau backend.
-- AUCUN changement de soldes, aucun remboursement, aucune modification de règles de recharge.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $migration$
DECLARE
  v_table regclass;
  v_constraint record;
  v_count integer;
  v_definition text;
  v_old text := 'CHECK((action=ANY(ARRAY[''chat_luna''::text,''free_pdf_luna''::text,''free_docx_luna''::text,''free_image_recraft''::text])))';
  v_new text := 'CHECK((action=ANY(ARRAY[''chat_luna''::text,''free_pdf_luna''::text,''free_docx_luna''::text,''free_image_recraft''::text,''free_xlsx_luna''::text,''chat_haiku''::text])))';
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.oria_free_credit_reservations'::regclass,
    'public.oria_free_usage_events'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', v_table);
    SELECT count(*) INTO v_count FROM pg_catalog.pg_constraint
     WHERE conrelid=v_table AND contype='c'
       AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%action%'
       AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%chat_luna%';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'ORIA XLSX: contrainte action introuvable/ambigüe dans % : %',v_table,v_count;
    END IF;
    SELECT conname, pg_catalog.pg_get_constraintdef(oid) AS definition
      INTO v_constraint FROM pg_catalog.pg_constraint
     WHERE conrelid=v_table AND contype='c'
       AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%action%'
       AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%chat_luna%';
    v_definition := pg_catalog.regexp_replace(v_constraint.definition,'[[:space:]]+','','g');
    IF v_definition = v_old THEN
      EXECUTE pg_catalog.format('ALTER TABLE %s DROP CONSTRAINT %I',v_table,v_constraint.conname);
      EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (action = ANY(ARRAY[''chat_luna''::text,''free_pdf_luna''::text,''free_docx_luna''::text,''free_image_recraft''::text,''free_xlsx_luna''::text,''chat_haiku''::text]))',v_table,v_constraint.conname);
    ELSIF v_definition <> v_new THEN
      RAISE EXCEPTION 'ORIA XLSX: contrainte inattendue dans % : %. Aucun changement.',v_table,v_constraint.definition;
    END IF;
  END LOOP;
END $migration$;

DO $migration$
DECLARE
  v_function oid;
  v_definition text;
  v_old text := 'p_action NOT IN (''chat_luna'',''free_pdf_luna'',''free_docx_luna'',''free_image_recraft'')';
  v_new text := 'p_action NOT IN (''chat_luna'',''free_pdf_luna'',''free_docx_luna'',''free_image_recraft'',''free_xlsx_luna'',''chat_haiku'')';
BEGIN
  SELECT to_regprocedure('public.oria_free_reserve(uuid,uuid,integer,numeric,text,integer)')::oid INTO v_function;
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'ORIA XLSX: signature oria_free_reserve absente. Annulation.';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(v_new IN v_definition)=0 THEN
    IF position(v_old IN v_definition)=0 THEN
      RAISE EXCEPTION 'ORIA XLSX: liste des actions de réservation différente. Annulation.';
    END IF;
    EXECUTE pg_catalog.replace(v_definition,v_old,v_new);
  END IF;
END $migration$;

COMMIT;

-- Vérifications après validation de transaction (lecture seule).
SELECT conrelid::regclass AS table_name, conname,
       pg_catalog.pg_get_constraintdef(oid) AS rule
FROM pg_catalog.pg_constraint
WHERE conrelid IN ('public.oria_free_credit_reservations'::regclass,
                  'public.oria_free_usage_events'::regclass)
  AND contype='c' AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%action%';
SELECT position('free_xlsx_luna' IN pg_catalog.pg_get_functiondef(
    to_regprocedure('public.oria_free_reserve(uuid,uuid,integer,numeric,text,integer)'))) > 0
    AS free_xlsx_action_authorized;
