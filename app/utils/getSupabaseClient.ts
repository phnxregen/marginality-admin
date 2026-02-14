import { getAnonClient } from "~/lib/supabase.server";

/**
 * Server-side Supabase client.
 * Uses server runtime env vars via app/lib/supabase.server.ts.
 */
export function getSupabaseClient(accessToken?: string) {
  return getAnonClient(accessToken);
}
