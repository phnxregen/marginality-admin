ALTER TABLE public.indexing_v2_runs
  DROP CONSTRAINT IF EXISTS indexing_v2_runs_timing_authority_check;

ALTER TABLE public.indexing_v2_runs
  ADD CONSTRAINT indexing_v2_runs_timing_authority_check
  CHECK (
    timing_authority IN (
      'whisperx_aligned',
      'retimed_transcript',
      'original_transcript',
      'approximate_proxy',
      'unavailable'
    )
  );

ALTER TABLE public.indexing_v2_candidates
  DROP CONSTRAINT IF EXISTS indexing_v2_candidates_timing_authority_check;

ALTER TABLE public.indexing_v2_candidates
  ADD CONSTRAINT indexing_v2_candidates_timing_authority_check
  CHECK (
    timing_authority IN (
      'whisperx_aligned',
      'retimed_transcript',
      'original_transcript',
      'approximate_proxy',
      'unavailable'
    )
  );

ALTER TABLE public.indexing_v2_occurrences
  DROP CONSTRAINT IF EXISTS indexing_v2_occurrences_timing_authority_check;

ALTER TABLE public.indexing_v2_occurrences
  ADD CONSTRAINT indexing_v2_occurrences_timing_authority_check
  CHECK (
    timing_authority IN (
      'whisperx_aligned',
      'retimed_transcript',
      'original_transcript',
      'approximate_proxy',
      'unavailable'
    )
  );
