-- Channel lifecycle and assignment controls for admin workflows.
-- Adds:
-- - invited/official lifecycle fields on external_channels
-- - free demo indexing quota tracking on external_channels
-- - admin unlock metadata on videos
-- - channel_assignments table for mapping channels to app users

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_channels'
        AND column_name = 'channel_lifecycle_status'
    ) THEN
      ALTER TABLE public.external_channels
      ADD COLUMN channel_lifecycle_status text NOT NULL DEFAULT 'invited';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_channels'
        AND column_name = 'officialized_at'
    ) THEN
      ALTER TABLE public.external_channels
      ADD COLUMN officialized_at timestamptz;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_channels'
        AND column_name = 'platform_video_count'
    ) THEN
      ALTER TABLE public.external_channels
      ADD COLUMN platform_video_count integer;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_channels'
        AND column_name = 'free_index_quota'
    ) THEN
      ALTER TABLE public.external_channels
      ADD COLUMN free_index_quota integer NOT NULL DEFAULT 5;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'external_channels'
        AND column_name = 'free_indexes_used'
    ) THEN
      ALTER TABLE public.external_channels
      ADD COLUMN free_indexes_used integer NOT NULL DEFAULT 0;
    END IF;

    UPDATE public.external_channels
    SET channel_lifecycle_status = 'invited'
    WHERE channel_lifecycle_status IS NULL;

    UPDATE public.external_channels
    SET free_index_quota = 5
    WHERE free_index_quota IS NULL;

    UPDATE public.external_channels
    SET free_indexes_used = 0
    WHERE free_indexes_used IS NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'external_channels_lifecycle_status_check'
    ) THEN
      ALTER TABLE public.external_channels
      ADD CONSTRAINT external_channels_lifecycle_status_check
      CHECK (channel_lifecycle_status IN ('invited', 'official'));
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'external_channels_free_index_quota_check'
    ) THEN
      ALTER TABLE public.external_channels
      ADD CONSTRAINT external_channels_free_index_quota_check
      CHECK (free_index_quota >= 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'external_channels_free_indexes_used_check'
    ) THEN
      ALTER TABLE public.external_channels
      ADD CONSTRAINT external_channels_free_indexes_used_check
      CHECK (free_indexes_used >= 0);
    END IF;
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
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'videos'
        AND column_name = 'admin_unlocked'
    ) THEN
      ALTER TABLE public.videos
      ADD COLUMN admin_unlocked boolean NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'videos'
        AND column_name = 'indexing_unlock_reason'
    ) THEN
      ALTER TABLE public.videos
      ADD COLUMN indexing_unlock_reason text;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'videos'
        AND column_name = 'indexing_unlocked_at'
    ) THEN
      ALTER TABLE public.videos
      ADD COLUMN indexing_unlocked_at timestamptz;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'videos'
        AND column_name = 'unlocked_by_user_id'
    ) THEN
      ALTER TABLE public.videos
      ADD COLUMN unlocked_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.channel_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_channel_id uuid NOT NULL REFERENCES public.external_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  role text NOT NULL DEFAULT 'viewer',
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_channel_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_assignments_role_check'
  ) THEN
    ALTER TABLE public.channel_assignments
    ADD CONSTRAINT channel_assignments_role_check
    CHECK (role IN ('owner', 'editor', 'viewer'));
  END IF;
END $$;

ALTER TABLE public.channel_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read channel assignments" ON public.channel_assignments;
CREATE POLICY "Authenticated can read channel assignments"
  ON public.channel_assignments
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Deny inserts for anon/authenticated" ON public.channel_assignments;
CREATE POLICY "Deny inserts for anon/authenticated"
  ON public.channel_assignments
  FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny updates for anon/authenticated" ON public.channel_assignments;
CREATE POLICY "Deny updates for anon/authenticated"
  ON public.channel_assignments
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny deletes for anon/authenticated" ON public.channel_assignments;
CREATE POLICY "Deny deletes for anon/authenticated"
  ON public.channel_assignments
  FOR DELETE
  USING (false);

CREATE INDEX IF NOT EXISTS channel_assignments_external_channel_idx
  ON public.channel_assignments (external_channel_id);

CREATE INDEX IF NOT EXISTS channel_assignments_user_id_idx
  ON public.channel_assignments (user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'external_channels'
  ) THEN
    CREATE INDEX IF NOT EXISTS external_channels_lifecycle_idx
      ON public.external_channels (channel_lifecycle_status);
  END IF;
END $$;
