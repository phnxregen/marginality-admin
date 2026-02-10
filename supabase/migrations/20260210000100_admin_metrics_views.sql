-- Admin analytics helpers for Overview + Indexing Ops.
-- These objects are defensive: only created when required source tables exist.

CREATE OR REPLACE FUNCTION public.admin_normalize_error_code(error_message text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text;
BEGIN
  IF error_message IS NULL OR btrim(error_message) = '' THEN
    RETURN 'UNKNOWN';
  END IF;

  IF upper(error_message) LIKE '%NO_CAPTIONS%' OR upper(error_message) LIKE '%NO CAPTIONS%' THEN
    RETURN 'NO_CAPTIONS';
  END IF;

  IF upper(error_message) LIKE '%PROXY_TIMEOUT%' OR upper(error_message) LIKE '%PROXY TIMEOUT%' THEN
    RETURN 'PROXY_TIMEOUT';
  END IF;

  IF upper(error_message) LIKE '%WHISPER_FAILED%' OR upper(error_message) LIKE '%WHISPER FAILED%' THEN
    RETURN 'WHISPER_FAILED';
  END IF;

  normalized := regexp_replace(upper(error_message), '[^A-Z0-9]+', '_', 'g');
  normalized := regexp_replace(normalized, '^_+|_+$', '', 'g');

  IF normalized IS NULL OR normalized = '' THEN
    RETURN 'UNKNOWN';
  END IF;

  RETURN left(normalized, 64);
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  ) THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.admin_channel_video_counts AS
      SELECT
        external_channel_id,
        count(*)::bigint AS total_videos,
        count(*) FILTER (WHERE indexing_status <> 'complete')::bigint AS unindexed_videos
      FROM public.videos
      WHERE external_channel_id IS NOT NULL
      GROUP BY external_channel_id
    $view$;

    EXECUTE 'GRANT SELECT ON public.admin_channel_video_counts TO authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'indexing_runs'
  ) THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.admin_overview_metrics AS
      SELECT
        (SELECT count(*)::bigint FROM public.external_channels) AS total_channels,
        (SELECT count(*)::bigint FROM public.videos) AS total_videos,
        (SELECT count(*)::bigint FROM public.videos WHERE indexing_status = 'complete') AS indexed_videos,
        (
          SELECT count(*)::bigint
          FROM public.indexing_runs
          WHERE created_at >= now() - interval '24 hours'
        ) AS indexing_runs_24h
    $view$;

    EXECUTE 'GRANT SELECT ON public.admin_overview_metrics TO authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'indexing_runs'
  ) THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.admin_reindexed_videos AS
      SELECT
        count(*)::bigint AS reindexed_videos
      FROM (
        SELECT video_id
        FROM public.indexing_runs
        WHERE phase = 'transcript_acquisition'
          AND status = 'complete'
        GROUP BY video_id
        HAVING count(*) > 1
      ) AS repeated
    $view$;

    EXECUTE $view$
      CREATE OR REPLACE VIEW public.admin_indexing_failure_breakdown AS
      SELECT
        public.admin_normalize_error_code(error_message) AS error_code,
        count(*)::bigint AS failures
      FROM public.indexing_runs
      WHERE status = 'failed'
      GROUP BY 1
      ORDER BY failures DESC
    $view$;

    EXECUTE $view$
      CREATE OR REPLACE VIEW public.admin_lane_distribution AS
      WITH latest_runs AS (
        SELECT DISTINCT ON (video_id)
          video_id,
          coalesce(
            meta ->> 'lane',
            meta ->> 'winning_lane',
            meta -> 'transcript' ->> 'lane'
          ) AS lane
        FROM public.indexing_runs
        WHERE phase = 'transcript_acquisition'
          AND status = 'complete'
        ORDER BY video_id, created_at DESC
      )
      SELECT
        coalesce(nullif(btrim(lane), ''), 'unknown') AS lane,
        count(*)::bigint AS videos
      FROM latest_runs
      GROUP BY 1
      ORDER BY videos DESC
    $view$;

    EXECUTE 'GRANT SELECT ON public.admin_reindexed_videos TO authenticated';
    EXECUTE 'GRANT SELECT ON public.admin_indexing_failure_breakdown TO authenticated';
    EXECUTE 'GRANT SELECT ON public.admin_lane_distribution TO authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS videos_external_channel_indexing_status_idx ON public.videos (external_channel_id, indexing_status)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'indexing_runs'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS indexing_runs_status_created_idx ON public.indexing_runs (status, created_at DESC)';
  END IF;
END $$;
