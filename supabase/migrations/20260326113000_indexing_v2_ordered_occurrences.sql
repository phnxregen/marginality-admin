ALTER TABLE public.indexing_v2_occurrences
  ALTER COLUMN canonical_timestamp_sec DROP NOT NULL;

ALTER TABLE public.indexing_v2_occurrences
  ADD COLUMN IF NOT EXISTS occurrence_index integer,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS transcript_segment_id text,
  ADD COLUMN IF NOT EXISTS transcript_segment_ids text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.indexing_v2_occurrences
SET source_type = occurrence_type
WHERE source_type IS NULL;

UPDATE public.indexing_v2_occurrences
SET transcript_segment_ids = COALESCE(snippet_source_segment_ids, '{}'::text[])
WHERE transcript_segment_ids = '{}'::text[];

UPDATE public.indexing_v2_occurrences
SET transcript_segment_id = transcript_segment_ids[1]
WHERE transcript_segment_id IS NULL
  AND array_length(transcript_segment_ids, 1) > 0;

WITH ranked_occurrences AS (
  SELECT
    occurrence_id,
    ROW_NUMBER() OVER (
      PARTITION BY run_id
      ORDER BY canonical_timestamp_sec ASC NULLS LAST, created_at ASC, occurrence_id ASC
    ) AS occurrence_index
  FROM public.indexing_v2_occurrences
)
UPDATE public.indexing_v2_occurrences AS occurrence
SET occurrence_index = ranked_occurrences.occurrence_index
FROM ranked_occurrences
WHERE occurrence.occurrence_id = ranked_occurrences.occurrence_id
  AND occurrence.occurrence_index IS NULL;

ALTER TABLE public.indexing_v2_occurrences
  ALTER COLUMN occurrence_index SET NOT NULL,
  ALTER COLUMN source_type SET NOT NULL;

ALTER TABLE public.indexing_v2_occurrences
  DROP CONSTRAINT IF EXISTS indexing_v2_occurrences_occurrence_index_check;

ALTER TABLE public.indexing_v2_occurrences
  ADD CONSTRAINT indexing_v2_occurrences_occurrence_index_check
  CHECK (occurrence_index > 0);

ALTER TABLE public.indexing_v2_occurrences
  DROP CONSTRAINT IF EXISTS indexing_v2_occurrences_source_type_check;

ALTER TABLE public.indexing_v2_occurrences
  ADD CONSTRAINT indexing_v2_occurrences_source_type_check
  CHECK (source_type IN ('spoken_explicit', 'allusion', 'ocr'));

CREATE UNIQUE INDEX IF NOT EXISTS indexing_v2_occurrences_run_order_idx
  ON public.indexing_v2_occurrences (run_id, occurrence_index ASC);

CREATE INDEX IF NOT EXISTS indexing_v2_occurrences_ref_order_idx
  ON public.indexing_v2_occurrences (run_id, normalized_verse_ref, occurrence_index ASC);
