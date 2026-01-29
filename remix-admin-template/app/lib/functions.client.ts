/**
 * Call a Supabase Edge Function with admin authentication.
 * Uses the access token from the session.
 */
export async function callFunction<T = any>(
  name: string,
  body: any,
  accessToken: string
): Promise<T> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set");
  }

  const url = `${supabaseUrl}/functions/v1/${name}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `Function call failed: ${response.statusText}`);
  }

  return response.json();
}
