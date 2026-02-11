import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

interface CreateChannelRequest {
  identifier: string;
  partnerChannelId: string;
}

/**
 * Resolves a YouTube identifier (channel ID, handle, or URL) to a channelId.
 */
async function resolveChannelId(
  identifier: string,
  youtubeApiKey: string
): Promise<string> {
  if (identifier.startsWith("UC") && identifier.length === 24) {
    return identifier;
  }

  let handle: string | null = null;
  let channelId: string | null = null;

  const handleMatch = identifier.match(/(?:youtube\.com\/@|^@)([^\/\s]+)/);
  if (handleMatch) {
    handle = handleMatch[1];
  }

  const channelMatch = identifier.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (channelMatch) {
    channelId = channelMatch[1];
    return channelId;
  }

  if (handle) {
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

  if (identifier.match(/^UC[a-zA-Z0-9_-]{22}$/)) {
    return identifier;
  }

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
    const { supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body: CreateChannelRequest = await req.json();
    const { identifier, partnerChannelId } = body;

    if (!identifier || typeof identifier !== "string") {
      return new Response(JSON.stringify({ error: "identifier is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!partnerChannelId || typeof partnerChannelId !== "string") {
      return new Response(
        JSON.stringify({ error: "partnerChannelId is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { data: partnerChannel, error: partnerChannelError } = await supabaseService
      .from("partner_channels")
      .select("id")
      .eq("id", partnerChannelId)
      .single();

    if (partnerChannelError || !partnerChannel) {
      return new Response(
        JSON.stringify({ error: "Invalid partnerChannelId" }),
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

    const channelId = await resolveChannelId(identifier, youtubeApiKey);

    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "snippet,statistics");
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
    const statistics = channelData.items[0].statistics || {};
    const title = snippet.title;
    const platformVideoCountRaw =
      typeof statistics.videoCount === "string"
        ? Number.parseInt(statistics.videoCount, 10)
        : Number(statistics.videoCount ?? 0);
    const platformVideoCount = Number.isFinite(platformVideoCountRaw)
      ? Math.max(0, platformVideoCountRaw)
      : null;

    const { data: channel, error: dbError } = await supabaseService
      .from("external_channels")
      .upsert(
        {
          partner_channel_id: partnerChannelId,
          platform: "youtube",
          platform_channel_id: channelId,
          title,
          description: snippet.description || null,
          url: `https://www.youtube.com/channel/${channelId}`,
          platform_video_count: platformVideoCount,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "platform,platform_channel_id",
        }
      )
      .select()
      .single();

    if (dbError) {
      console.error("Database error:", dbError);
      return new Response(
        JSON.stringify({
          error: "Failed to create channel",
          details: dbError.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ channel }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not an admin")
      ? 403
      : message.includes("Invalid")
        ? 401
        : 500;

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});
