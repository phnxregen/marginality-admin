-- Create admin_users allowlist table
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on admin_users
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Allow admins to read the admin_users table (for checking their own status)
CREATE POLICY "Admins can read admin_users"
  ON public.admin_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE user_id = auth.uid()
    )
  );

-- Enable RLS on external_channels (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'external_channels') THEN
    ALTER TABLE public.external_channels ENABLE ROW LEVEL SECURITY;
    
    -- Deny all inserts for anon/authenticated users
    DROP POLICY IF EXISTS "Deny inserts for anon/authenticated" ON public.external_channels;
    CREATE POLICY "Deny inserts for anon/authenticated"
      ON public.external_channels
      FOR INSERT
      WITH CHECK (false);
    
    -- Allow authenticated users to read (adjust as needed for your use case)
    DROP POLICY IF EXISTS "Authenticated can read channels" ON public.external_channels;
    CREATE POLICY "Authenticated can read channels"
      ON public.external_channels
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Enable RLS on videos (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'videos') THEN
    ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
    
    -- Deny all inserts for anon/authenticated users
    DROP POLICY IF EXISTS "Deny inserts for anon/authenticated" ON public.videos;
    CREATE POLICY "Deny inserts for anon/authenticated"
      ON public.videos
      FOR INSERT
      WITH CHECK (false);
    
    -- Allow authenticated users to read (adjust as needed for your use case)
    DROP POLICY IF EXISTS "Authenticated can read videos" ON public.videos;
    CREATE POLICY "Authenticated can read videos"
      ON public.videos
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Add unique constraint on videos.youtube_video_id if column exists
-- TODO: Adjust if your schema uses composite key (external_channel_id + youtube_video_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'videos' 
    AND column_name = 'youtube_video_id'
  ) THEN
    -- Check if constraint already exists
    IF NOT EXISTS (
      SELECT FROM pg_constraint 
      WHERE conname = 'videos_youtube_video_id_key'
    ) THEN
      ALTER TABLE public.videos 
      ADD CONSTRAINT videos_youtube_video_id_key UNIQUE (youtube_video_id);
    END IF;
  END IF;
END $$;
