import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

interface CreateChannelRequest {
  identifier: string;
}

/**
 * Resolves a YouTube identifier (channel ID, handle, or URL) to a channelId.
 * Returns the channelId string.
 */
async function resolveChannelId(
  identifier: string,
  youtubeApiKey: string
): Promise<string> {
  // If starts with "UC", treat as channelId
  if (identifier.startsWith("UC") && identifier.length === 24) {
    return identifier;
  }

  // Extract from URL patterns
  let handle: string | null = null;
  let channelId: string | null = null;

  // Pattern: youtube.com/@handle or @handle
  const handleMatch = identifier.match(/(?:youtube\.com\/@|^@)([^\/\s]+)/);
  if (handleMatch) {
    handle = handleMatch[1];
  }

  // Pattern: youtube.com/channel/UC...
  const channelMatch = identifier.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (channelMatch) {
    channelId = channelMatch[1];
    return channelId;
  }

  // If we have a handle, try to resolve it
  if (handle) {
    // Use search endpoint to find channel by handle
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "channel");
    searchUrl.searchParams.set("q", handle);
    searchUrl.searchParams.set("maxResults", "1");
    searchUrl.searchParams.set("key", youtubeApiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      throw new Error(`YouTube API error: ${searchRes.statusText}`);
    }

    const searchData = await searchRes.json();
    if (searchData.items && searchData.items.length > 0) {
      return searchData.items[0].snippet.channelId;
    }

    // Fallback: try channels.list with forHandle (if supported)
    // Note: forHandle parameter may not be available in all API versions
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "id");
    channelUrl.searchParams.set("forHandle", handle);
    channelUrl.searchParams.set("key", youtubeApiKey);

    const channelRes = await fetch(channelUrl.toString());
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      if (channelData.items && channelData.items.length > 0) {
        return channelData.items[0].id;
      }
    }
  }

  // If identifier looks like a channel ID, return it
  if (identifier.match(/^UC[a-zA-Z0-9_-]{22}$/)) {
    return identifier;
  }

  // Last resort: treat as handle and search
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "channel");
  searchUrl.searchParams.set("q", identifier);
  searchUrl.searchParams.set("maxResults", "1");
  searchUrl.searchParams.set("key", youtubeApiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    throw new Error(`YouTube API error: ${searchRes.statusText}`);
  }

  const searchData = await searchRes.json();
  if (!searchData.items || searchData.items.length === 0) {
    throw new Error(`Could not resolve channel identifier: ${identifier}`);
  }

  return searchData.items[0].snippet.channelId;
}

serve(async (req) => {
  try {
    // Verify admin
    const { supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    const body: CreateChannelRequest = await req.json();
    const { identifier } = body;

    if (!identifier || typeof identifier !== "string") {
      return new Response(
        JSON.stringify({ error: "identifier is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!youtubeApiKey) {
      return new Response(
        JSON.stringify({ error: "YOUTUBE_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resolve identifier to channelId
    const channelId = await resolveChannelId(identifier, youtubeApiKey);

    // Fetch channel metadata
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "snippet");
    channelUrl.searchParams.set("id", channelId);
    channelUrl.searchParams.set("key", youtubeApiKey);

    const channelRes = await fetch(channelUrl.toString());
    if (!channelRes.ok) {
      throw new Error(`YouTube API error: ${channelRes.statusText}`);
    }

    const channelData = await channelRes.json();
    if (!channelData.items || channelData.items.length === 0) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const snippet = channelData.items[0].snippet;
    const title = snippet.title;
    const handle = snippet.customUrl
      ? snippet.customUrl.replace("@", "")
      : null;
    const thumbnailUrl =
      snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null;

    // Upsert into external_channels
    // TODO: Adjust column names if your schema differs
    const { data: channel, error: dbError } = await supabaseService
      .from("external_channels")
      .upsert(
        {
          youtube_channel_id: channelId,
          title: title,
          handle: handle,
          thumbnail_url: thumbnailUrl, // TODO: Add this column if missing
        },
        {
          onConflict: "youtube_channel_id",
        }
      )
      .select()
      .single();

    if (dbError) {
      console.error("Database error:", dbError);
      return new Response(
        JSON.stringify({ error: "Failed to create channel", details: dbError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ channel }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const status = error.message.includes("not an admin") ? 403 :
                   error.message.includes("Invalid") ? 401 : 500;
    return new Response(
      JSON.stringify({ error: error.message }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
});
