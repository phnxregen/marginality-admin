-- Ensure admin demo indexing does not auto-officialize channels and
-- allow admin users to read indexing_runs in the Admin UI.

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
  ) THEN
    CREATE OR REPLACE FUNCTION public.auto_officialize_channel_from_video_publish()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public
    AS $fn$
    BEGIN
      IF NEW.external_channel_id IS NULL THEN
        RETURN NEW;
      END IF;

      -- Admin demo indexing should remain invited/private.
      IF lower(COALESCE(NEW.indexing_unlock_reason, '')) = 'admin_demo' THEN
        RETURN NEW;
      END IF;

      IF COALESCE(NEW.is_public, false)
         OR lower(COALESCE(NEW.visibility, '')) = 'public'
         OR lower(COALESCE(NEW.listing_state, '')) = 'published' THEN
        UPDATE public.external_channels
        SET
          channel_lifecycle_status = 'official',
          officialized_at = COALESCE(officialized_at, now())
        WHERE id = NEW.external_channel_id
          AND channel_lifecycle_status <> 'official';
      END IF;

      RETURN NEW;
    END;
    $fn$;

    -- Keep compatibility with projects that use this trigger function name.
    CREATE OR REPLACE FUNCTION public.auto_officialize_channel_from_video()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public
    AS $fn$
    BEGIN
      IF NEW.external_channel_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF lower(COALESCE(NEW.indexing_unlock_reason, '')) = 'admin_demo' THEN
        RETURN NEW;
      END IF;

      IF COALESCE(NEW.is_public, false)
         OR lower(COALESCE(NEW.visibility, '')) = 'public'
         OR lower(COALESCE(NEW.listing_state, '')) = 'published' THEN
        UPDATE public.external_channels
        SET
          channel_lifecycle_status = 'official',
          officialized_at = COALESCE(officialized_at, now())
        WHERE id = NEW.external_channel_id
          AND channel_lifecycle_status <> 'official';
      END IF;

      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS videos_auto_officialize_channel ON public.videos;
    DROP TRIGGER IF EXISTS trg_auto_officialize_channel_from_video_publish ON public.videos;

    CREATE TRIGGER trg_auto_officialize_channel_from_video_publish
      AFTER INSERT OR UPDATE OF is_public, visibility, listing_state, indexing_unlock_reason
      ON public.videos
      FOR EACH ROW
      EXECUTE FUNCTION public.auto_officialize_channel_from_video_publish();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'indexing_runs'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
  ) THEN
    ALTER TABLE public.indexing_runs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS indexing_runs_admin_read ON public.indexing_runs;
    CREATE POLICY indexing_runs_admin_read
      ON public.indexing_runs
      FOR SELECT
      USING (
        (auth.jwt() ->> 'role') = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.admin_users
          WHERE admin_users.user_id = auth.uid()
        )
      );
  END IF;
END $$;
