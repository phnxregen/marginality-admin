-- Consume free indexing quota only when a video actually reaches complete indexing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  ) THEN
    ALTER TABLE public.videos
      ADD COLUMN IF NOT EXISTS free_index_quota_consumed boolean;

    UPDATE public.videos
    SET free_index_quota_consumed = false
    WHERE free_index_quota_consumed IS NULL;

    ALTER TABLE public.videos
      ALTER COLUMN free_index_quota_consumed SET DEFAULT false,
      ALTER COLUMN free_index_quota_consumed SET NOT NULL;

    -- Mark existing completed videos as already consumed so future updates do not double-charge.
    UPDATE public.videos
    SET free_index_quota_consumed = true
    WHERE indexing_status = 'complete'
      AND free_index_quota_consumed = false;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
      AND column_name = 'free_index_quota'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
      AND column_name = 'free_indexes_used'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'external_channel_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'indexing_status'
  ) THEN
    -- If historical usage was overcounted, cap it at completed-video count and quota.
    WITH completed AS (
      SELECT external_channel_id, count(*)::integer AS completed_count
      FROM public.videos
      WHERE external_channel_id IS NOT NULL
        AND indexing_status = 'complete'
      GROUP BY external_channel_id
    )
    UPDATE public.external_channels ec
    SET free_indexes_used = LEAST(
      COALESCE(ec.free_index_quota, 0),
      COALESCE(c.completed_count, 0)
    )
    FROM completed c
    WHERE ec.id = c.external_channel_id
      AND ec.free_indexes_used > LEAST(
        COALESCE(ec.free_index_quota, 0),
        COALESCE(c.completed_count, 0)
      );

    UPDATE public.external_channels ec
    SET free_indexes_used = 0
    WHERE ec.free_indexes_used > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.videos v
        WHERE v.external_channel_id = ec.id
          AND v.indexing_status = 'complete'
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.consume_free_index_quota_on_video_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.external_channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.free_index_quota_consumed, false) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.indexing_status, '') <> 'complete' THEN
    RETURN NEW;
  END IF;

  UPDATE public.external_channels ec
  SET free_indexes_used = LEAST(
    COALESCE(ec.free_index_quota, 0),
    COALESCE(ec.free_indexes_used, 0) + 1
  )
  WHERE ec.id = NEW.external_channel_id
    AND COALESCE(ec.free_indexes_used, 0) < COALESCE(ec.free_index_quota, 0);

  NEW.free_index_quota_consumed = true;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'videos'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'free_index_quota_consumed'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
      AND column_name = 'free_index_quota'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
      AND column_name = 'free_indexes_used'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'external_channel_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'indexing_status'
  ) THEN
    DROP TRIGGER IF EXISTS consume_free_index_quota_on_video_complete
      ON public.videos;

    CREATE TRIGGER consume_free_index_quota_on_video_complete
      BEFORE INSERT OR UPDATE OF indexing_status, external_channel_id
      ON public.videos
      FOR EACH ROW
      EXECUTE FUNCTION public.consume_free_index_quota_on_video_complete();
  END IF;
END $$;
