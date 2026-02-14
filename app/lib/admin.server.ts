import type { SessionUser } from "~/lib/auth.server";
import { requireUser } from "~/lib/auth.server";
import { getAnonClient } from "~/lib/supabase.server";

/**
 * Require an authenticated user that is present in public.admin_users.
 * Must be called before any server-side privileged DB access.
 */
export async function requireAdmin(request: Request): Promise<SessionUser> {
  const user = await requireUser(request);
  const supabase = getAnonClient(user.accessToken);

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Response(`Admin authorization check failed: ${error.message}`, {
      status: 500,
    });
  }

  if (!data) {
    throw new Response("Forbidden", { status: 403 });
  }

  return user;
}
