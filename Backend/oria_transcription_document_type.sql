-- ORIA Transcription Chantier 1
-- Extension additive de la table ORIA Cours existante.
-- Les anciens brouillons et jobs restent de type `course`.

ALTER TABLE public.oria_courses
    ADD COLUMN IF NOT EXISTS document_type TEXT;

UPDATE public.oria_courses
SET document_type = 'course'
WHERE document_type IS NULL;

ALTER TABLE public.oria_courses
    ALTER COLUMN document_type SET DEFAULT 'course';

ALTER TABLE public.oria_courses
    ALTER COLUMN document_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.oria_courses'::regclass
          AND conname = 'oria_courses_document_type_check'
    ) THEN
        ALTER TABLE public.oria_courses
            ADD CONSTRAINT oria_courses_document_type_check
            CHECK (document_type IN ('course', 'meeting', 'speech', 'interview'));
    END IF;
END $$;
