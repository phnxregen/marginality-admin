import { redirect } from "@remix-run/node";
import { getSession, commitSession, destroySession } from "~/session.server";
import { getAnonClient } from "~/lib/supabase.server";

export interface SessionUser {
  id: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Get the current session user from cookies.
 * Returns null if no valid session.
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const session = await getSession(request.headers.get("Cookie"));
  const accessToken = session.get("access_token");
  const refreshToken = session.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return null;
  }

  // Verify token is still valid by getting user from Supabase
  const supabase = getAnonClient();
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    accessToken,
    refreshToken,
  };
}

/**
 * Require a valid session user, redirecting to /login if not authenticated.
 */
export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}

/**
 * Set session data (access_token and refresh_token) in cookies.
 */
export async function setSession(
  response: Response,
  sessionData: { accessToken: string; refreshToken: string }
): Promise<Response> {
  const session = await getSession();
  session.set("access_token", sessionData.accessToken);
  session.set("refresh_token", sessionData.refreshToken);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      "Set-Cookie": await commitSession(session),
    },
  });
}

/**
 * Clear session (logout).
 */
export async function clearSession(response: Response): Promise<Response> {
  const session = await getSession();
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      "Set-Cookie": await destroySession(session),
    },
  });
}
