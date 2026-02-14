-- Phase 1: Indexing Testing Center foundation (normalized + versioned).

CREATE TABLE IF NOT EXISTS public.indexing_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  requested_by_user_id uuid NULL,
  youtube_url text NOT NULL,
  youtube_video_id text NOT NULL,
  source_video_id text NULL,
  run_mode text NOT NULL DEFAULT 'admin_test',
  status text NOT NULL DEFAULT 'queued',
  indexing_run_id uuid NULL,
  contract_version text NOT NULL DEFAULT 'v1',
  pipeline_version text NULL,
  error_code text NULL,
  error_message text NULL,
  transcript_count integer NOT NULL DEFAULT 0,
  ocr_count integer NOT NULL DEFAULT 0,
  transcript_source text NULL,
  lane_used text NULL,
  duration_ms integer NULL,
  CONSTRAINT indexing_test_runs_run_mode_check
    CHECK (run_mode IN ('admin_test', 'public', 'personal')),
  CONSTRAINT indexing_test_runs_status_check
    CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
  CONSTRAINT indexing_test_runs_transcript_count_check
    CHECK (transcript_count >= 0),
  CONSTRAINT indexing_test_runs_ocr_count_check
    CHECK (ocr_count >= 0),
  CONSTRAINT indexing_test_runs_duration_ms_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE OR REPLACE FUNCTION public.set_indexing_test_runs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_indexing_test_runs_updated_at ON public.indexing_test_runs;
CREATE TRIGGER trg_indexing_test_runs_updated_at
  BEFORE UPDATE ON public.indexing_test_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_indexing_test_runs_updated_at();

CREATE TABLE IF NOT EXISTS public.indexing_test_outputs (
  test_run_id uuid PRIMARY KEY REFERENCES public.indexing_test_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  transcript_json jsonb NOT NULL,
  ocr_json jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.indexing_test_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES public.indexing_test_runs(id) ON DELETE CASCADE,
  t timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL,
  msg text NOT NULL,
  data jsonb NULL
);

CREATE TABLE IF NOT EXISTS public.indexing_test_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  youtube_video_id text NOT NULL,
  youtube_url text NOT NULL,
  expected_transcript_json jsonb NOT NULL,
  expected_ocr_json jsonb NOT NULL,
  contract_version text NOT NULL DEFAULT 'v1',
  pipeline_version text NULL,
  notes text NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE IF NOT EXISTS public.indexing_test_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  fixture_id uuid NOT NULL REFERENCES public.indexing_test_fixtures(id) ON DELETE CASCADE,
  test_run_id uuid NOT NULL REFERENCES public.indexing_test_runs(id) ON DELETE CASCADE,
  diff_algorithm_version text NOT NULL DEFAULT 'v1',
  result jsonb NOT NULL
);

ALTER TABLE public.indexing_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_test_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_test_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_test_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_test_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS indexing_test_runs_service_role_only ON public.indexing_test_runs;
CREATE POLICY indexing_test_runs_service_role_only
  ON public.indexing_test_runs
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_test_outputs_service_role_only ON public.indexing_test_outputs;
CREATE POLICY indexing_test_outputs_service_role_only
  ON public.indexing_test_outputs
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_test_logs_service_role_only ON public.indexing_test_logs;
CREATE POLICY indexing_test_logs_service_role_only
  ON public.indexing_test_logs
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_test_fixtures_service_role_only ON public.indexing_test_fixtures;
CREATE POLICY indexing_test_fixtures_service_role_only
  ON public.indexing_test_fixtures
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS indexing_test_comparisons_service_role_only ON public.indexing_test_comparisons;
CREATE POLICY indexing_test_comparisons_service_role_only
  ON public.indexing_test_comparisons
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE INDEX IF NOT EXISTS indexing_test_runs_youtube_video_id_created_at_idx
  ON public.indexing_test_runs (youtube_video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS indexing_test_logs_test_run_id_t_idx
  ON public.indexing_test_logs (test_run_id, t);

CREATE INDEX IF NOT EXISTS indexing_test_comparisons_fixture_id_idx
  ON public.indexing_test_comparisons (fixture_id);

CREATE INDEX IF NOT EXISTS indexing_test_comparisons_test_run_id_idx
  ON public.indexing_test_comparisons (test_run_id);
