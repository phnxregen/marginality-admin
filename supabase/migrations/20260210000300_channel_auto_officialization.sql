-- Automatically move channels from invited -> official when publication state
-- indicates public visibility, and provide an RPC helper for purchase events.

CREATE OR REPLACE FUNCTION public.officialize_channel(
  p_external_channel_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_external_channel_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.external_channels
  SET
    channel_lifecycle_status = 'official',
    officialized_at = COALESCE(officialized_at, now()),
    updated_at = now()
  WHERE id = p_external_channel_id;
END;
$$;

REVOKE ALL ON FUNCTION public.officialize_channel(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.officialize_channel(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_officialize_channel_from_video_publish()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.external_channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_public, false)
     OR lower(COALESCE(NEW.visibility, '')) = 'public'
     OR lower(COALESCE(NEW.listing_state, '')) = 'published' THEN
    PERFORM public.officialize_channel(NEW.external_channel_id, 'video_publish');
  END IF;

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
  ) THEN
    DROP TRIGGER IF EXISTS trg_auto_officialize_channel_from_video_publish
      ON public.videos;

    CREATE TRIGGER trg_auto_officialize_channel_from_video_publish
      AFTER INSERT OR UPDATE OF is_public, visibility, listing_state
      ON public.videos
      FOR EACH ROW
      EXECUTE FUNCTION public.auto_officialize_channel_from_video_publish();
  END IF;
END $$;
