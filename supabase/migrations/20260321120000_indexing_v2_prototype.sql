-- Indexing V2 prototype schema.
-- Fully additive and isolated from V1 materialized indexing tables.

CREATE TABLE IF NOT EXISTS public.indexing_v2_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NULL REFERENCES public.indexing_test_runs(id) ON DELETE SET NULL,
  upstream_video_id uuid NULL REFERENCES public.videos(id) ON DELETE SET NULL,
  requested_by_user_id uuid NULL,
  source_video_id text NULL,
  youtube_video_id text NOT NULL,
  youtube_url text NOT NULL,
  run_mode text NOT NULL DEFAULT 'admin_test',
  status text NOT NULL DEFAULT 'queued',
  pipeline_version text NOT NULL DEFAULT 'indexing_v2',
  execution_mode text NOT NULL DEFAULT 'no_alignment',
  timing_authority text NOT NULL DEFAULT 'unavailable',
  timing_confidence numeric(5,4) NULL,
  transcript_source text NULL,
  lane_used text NULL,
  transcript_segment_count integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  occurrence_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_code text NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indexing_v2_runs_run_mode_check
    CHECK (run_mode IN ('admin_test', 'public', 'personal')),
  CONSTRAINT indexing_v2_runs_status_check
    CHECK (
      status IN (
        'queued',
        'transcribing',
        'alignment_pending',
        'aligning',
        'ocr_processing',
        'analyzing',
        'resolving',
        'complete',
        'complete_with_warnings',
        'failed'
      )
    ),
  CONSTRAINT indexing_v2_runs_pipeline_version_check
    CHECK (pipeline_version = 'indexing_v2'),
  CONSTRAINT indexing_v2_runs_execution_mode_check
    CHECK (execution_mode IN ('full_alignment', 'no_alignment', 'admin_forced_alignment', 'fallback_only')),
  CONSTRAINT indexing_v2_runs_timing_authority_check
    CHECK (timing_authority IN ('whisperx_aligned', 'original_transcript', 'approximate_proxy', 'unavailable')),
  CONSTRAINT indexing_v2_runs_timing_confidence_check
    CHECK (timing_confidence IS NULL OR (timing_confidence >= 0 AND timing_confidence <= 1)),
  CONSTRAINT indexing_v2_runs_transcript_segment_count_check
    CHECK (transcript_segment_count >= 0),
  CONSTRAINT indexing_v2_runs_candidate_count_check
    CHECK (candidate_count >= 0),
  CONSTRAINT indexing_v2_runs_occurrence_count_check
    CHECK (occurrence_count >= 0),
  CONSTRAINT indexing_v2_runs_warning_count_check
    CHECK (warning_count >= 0)
);

CREATE OR REPLACE FUNCTION public.set_indexing_v2_runs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_indexing_v2_runs_updated_at ON public.indexing_v2_runs;
CREATE TRIGGER trg_indexing_v2_runs_updated_at
  BEFORE UPDATE ON public.indexing_v2_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_indexing_v2_runs_updated_at();

CREATE TABLE IF NOT EXISTS public.indexing_v2_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.indexing_v2_runs(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  stage text NOT NULL,
  storage_kind text NOT NULL,
  mime_type text NULL,
  payload jsonb NULL,
  storage_path text NULL,
  external_url text NULL,
  size_bytes bigint NULL,
  checksum_sha256 text NULL,
  source_artifact_id uuid NULL REFERENCES public.indexing_v2_run_artifacts(id) ON DELETE SET NULL,
  pipeline_version text NOT NULL DEFAULT 'indexing_v2',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indexing_v2_run_artifacts_type_check
    CHECK (
      artifact_type IN (
        'raw_transcript_json',
        'verse_candidates_json',
        'resolved_occurrences_json',
        'validation_report_json',
        'admin_review_export'
      )
    ),
  CONSTRAINT indexing_v2_run_artifacts_stage_check
    CHECK (stage IN ('transcript_acquisition', 'semantic_analysis', 'resolution', 'review')),
  CONSTRAINT indexing_v2_run_artifacts_storage_kind_check
    CHECK (storage_kind IN ('database_json', 'object_storage', 'external_url', 'local_file')),
  CONSTRAINT indexing_v2_run_artifacts_pipeline_version_check
    CHECK (pipeline_version = 'indexing_v2'),
  CONSTRAINT indexing_v2_run_artifacts_size_bytes_check
    CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS public.indexing_v2_candidates (
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.indexing_v2_runs(id) ON DELETE CASCADE,
  verse_ref text NOT NULL,
  normalized_verse_ref text NOT NULL,
  timestamp_sec numeric(12,3) NOT NULL,
  source_type text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  timing_authority text NOT NULL,
  context_key text NOT NULL,
  transcript_span jsonb NULL,
  ocr_span jsonb NULL,
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_artifact_id uuid NULL REFERENCES public.indexing_v2_run_artifacts(id) ON DELETE SET NULL,
  resolver_status text NOT NULL DEFAULT 'pending',
  rejection_reason text NULL,
  pipeline_version text NOT NULL DEFAULT 'indexing_v2',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indexing_v2_candidates_timestamp_sec_check
    CHECK (timestamp_sec >= 0),
  CONSTRAINT indexing_v2_candidates_source_type_check
    CHECK (source_type IN ('spoken_explicit', 'allusion', 'ocr')),
  CONSTRAINT indexing_v2_candidates_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT indexing_v2_candidates_timing_authority_check
    CHECK (timing_authority IN ('whisperx_aligned', 'original_transcript', 'approximate_proxy', 'unavailable')),
  CONSTRAINT indexing_v2_candidates_resolver_status_check
    CHECK (resolver_status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT indexing_v2_candidates_pipeline_version_check
    CHECK (pipeline_version = 'indexing_v2')
);

CREATE TABLE IF NOT EXISTS public.indexing_v2_occurrences (
  occurrence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.indexing_v2_runs(id) ON DELETE CASCADE,
  verse_ref text NOT NULL,
  normalized_verse_ref text NOT NULL,
  canonical_timestamp_sec numeric(12,3) NOT NULL,
  occurrence_type text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  timing_authority text NOT NULL,
  canonical_candidate_id uuid NULL REFERENCES public.indexing_v2_candidates(candidate_id) ON DELETE SET NULL,
  snippet_text text NULL,
  snippet_start_sec numeric(12,3) NULL,
  snippet_end_sec numeric(12,3) NULL,
  snippet_source_artifact_id uuid NULL REFERENCES public.indexing_v2_run_artifacts(id) ON DELETE SET NULL,
  snippet_source_segment_ids text[] NOT NULL DEFAULT '{}'::text[],
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_version text NOT NULL DEFAULT 'indexing_v2',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indexing_v2_occurrences_canonical_timestamp_sec_check
    CHECK (canonical_timestamp_sec >= 0),
  CONSTRAINT indexing_v2_occurrences_type_check
    CHECK (occurrence_type IN ('spoken_explicit', 'allusion', 'ocr')),
  CONSTRAINT indexing_v2_occurrences_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT indexing_v2_occurrences_timing_authority_check
    CHECK (timing_authority IN ('whisperx_aligned', 'original_transcript', 'approximate_proxy', 'unavailable')),
  CONSTRAINT indexing_v2_occurrences_snippet_start_sec_check
    CHECK (snippet_start_sec IS NULL OR snippet_start_sec >= 0),
  CONSTRAINT indexing_v2_occurrences_snippet_end_sec_check
    CHECK (
      snippet_end_sec IS NULL OR (
        snippet_end_sec >= 0
        AND (snippet_start_sec IS NULL OR snippet_end_sec >= snippet_start_sec)
      )
    ),
  CONSTRAINT indexing_v2_occurrences_pipeline_version_check
    CHECK (pipeline_version = 'indexing_v2')
);

CREATE TABLE IF NOT EXISTS public.indexing_v2_occurrence_candidates (
  occurrence_id uuid NOT NULL REFERENCES public.indexing_v2_occurrences(occurrence_id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.indexing_v2_candidates(candidate_id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (occurrence_id, candidate_id),
  CONSTRAINT indexing_v2_occurrence_candidates_role_check
    CHECK (role IN ('canonical', 'supporting'))
);

CREATE TABLE IF NOT EXISTS public.indexing_v2_validation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.indexing_v2_runs(id) ON DELETE CASCADE,
  artifact_id uuid NULL REFERENCES public.indexing_v2_run_artifacts(id) ON DELETE SET NULL,
  fixture_id text NOT NULL DEFAULT 'generic',
  overall_status text NOT NULL,
  warning_count integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indexing_v2_validation_reports_overall_status_check
    CHECK (overall_status IN ('pass', 'pass_with_warnings', 'fail')),
  CONSTRAINT indexing_v2_validation_reports_warning_count_check
    CHECK (warning_count >= 0)
);

CREATE OR REPLACE FUNCTION public.set_indexing_v2_validation_reports_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_indexing_v2_validation_reports_updated_at ON public.indexing_v2_validation_reports;
CREATE TRIGGER trg_indexing_v2_validation_reports_updated_at
  BEFORE UPDATE ON public.indexing_v2_validation_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_indexing_v2_validation_reports_updated_at();

ALTER TABLE public.indexing_v2_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_v2_run_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_v2_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_v2_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_v2_occurrence_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_v2_validation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS indexing_v2_runs_service_role_only ON public.indexing_v2_runs;
CREATE POLICY indexing_v2_runs_service_role_only
  ON public.indexing_v2_runs
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_v2_run_artifacts_service_role_only ON public.indexing_v2_run_artifacts;
CREATE POLICY indexing_v2_run_artifacts_service_role_only
  ON public.indexing_v2_run_artifacts
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_v2_candidates_service_role_only ON public.indexing_v2_candidates;
CREATE POLICY indexing_v2_candidates_service_role_only
  ON public.indexing_v2_candidates
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_v2_occurrences_service_role_only ON public.indexing_v2_occurrences;
CREATE POLICY indexing_v2_occurrences_service_role_only
  ON public.indexing_v2_occurrences
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_v2_occurrence_candidates_service_role_only ON public.indexing_v2_occurrence_candidates;
CREATE POLICY indexing_v2_occurrence_candidates_service_role_only
  ON public.indexing_v2_occurrence_candidates
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_v2_validation_reports_service_role_only ON public.indexing_v2_validation_reports;
CREATE POLICY indexing_v2_validation_reports_service_role_only
  ON public.indexing_v2_validation_reports
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE INDEX IF NOT EXISTS indexing_v2_runs_created_at_idx
  ON public.indexing_v2_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_v2_runs_youtube_video_id_idx
  ON public.indexing_v2_runs (youtube_video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_v2_runs_upstream_video_id_idx
  ON public.indexing_v2_runs (upstream_video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_v2_run_artifacts_run_id_idx
  ON public.indexing_v2_run_artifacts (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_v2_run_artifacts_type_idx
  ON public.indexing_v2_run_artifacts (run_id, artifact_type, created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_v2_candidates_run_id_idx
  ON public.indexing_v2_candidates (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS indexing_v2_candidates_ref_timestamp_idx
  ON public.indexing_v2_candidates (run_id, normalized_verse_ref, timestamp_sec);

CREATE INDEX IF NOT EXISTS indexing_v2_occurrences_run_id_idx
  ON public.indexing_v2_occurrences (run_id, canonical_timestamp_sec ASC);

CREATE INDEX IF NOT EXISTS indexing_v2_occurrences_ref_idx
  ON public.indexing_v2_occurrences (run_id, normalized_verse_ref, canonical_timestamp_sec ASC);

CREATE INDEX IF NOT EXISTS indexing_v2_validation_reports_status_idx
  ON public.indexing_v2_validation_reports (overall_status, created_at DESC);
