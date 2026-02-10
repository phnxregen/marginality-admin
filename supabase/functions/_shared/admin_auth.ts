import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AdminAuthResult {
  user: { id: string; email?: string };
  supabaseService: ReturnType<typeof createClient>;
}

/**
 * Verifies the Authorization header, checks admin_users allowlist,
 * and returns the user and a service-role Supabase client for DB writes.
 */
export async function verifyAdmin(
  req: Request
): Promise<AdminAuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables");
  }

  // Create user-scoped client to verify JWT
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    throw new Error("Invalid or expired token");
  }

  // Check admin_users allowlist
  const { data: adminCheck, error: adminError } = await supabaseUser
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (adminError || !adminCheck) {
    throw new Error("User is not an admin");
  }

  // Create service-role client for privileged DB writes
  const supabaseService = createClient(
    supabaseUrl,
    supabaseServiceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    supabaseService,
  };
}
