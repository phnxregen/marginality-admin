-- Fix recursive admin_users SELECT policy that causes
-- "infinite recursion detected in policy for relation admin_users".

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
  ) THEN
    ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
    CREATE POLICY "Admins can read admin_users"
      ON public.admin_users
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR (auth.jwt() ->> 'role') = 'service_role'
      );
  END IF;
END $$;
