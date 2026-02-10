import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

interface ImportVideosRequest {
  externalChannelId: string;
  limit?: number;
}

type VideoPayload = {
  external_video_id: string;
  url: string;
  source_url: string;
  source_video_id: string;
  canonical_source_video_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
};

serve(async (req) => {
  try {
    const { supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body: ImportVideosRequest = await req.json();
    const { externalChannelId, limit = 50 } = body;

    if (!externalChannelId || typeof externalChannelId !== "string") {
      return new Response(
        JSON.stringify({ error: "externalChannelId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const safeLimit = Math.min(Math.max(limit || 50, 1), 200);

    const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!youtubeApiKey) {
      return new Response(
        JSON.stringify({ error: "YOUTUBE_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: channel, error: channelError } = await supabaseService
      .from("external_channels")
      .select("id, partner_channel_id, platform, platform_channel_id, title")
      .eq("id", externalChannelId)
      .single();

    if (channelError || !channel) {
      return new Response(JSON.stringify({ error: "Channel not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (channel.platform !== "youtube") {
      return new Response(
        JSON.stringify({ error: "Only YouTube channels are supported right now" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "contentDetails");
    channelUrl.searchParams.set("id", channel.platform_channel_id);
    channelUrl.searchParams.set("key", youtubeApiKey);

    const channelRes = await fetch(channelUrl.toString());
    if (!channelRes.ok) {
      throw new Error(`YouTube API error: ${channelRes.statusText}`);
    }

    const channelData = await channelRes.json();
    if (!channelData.items || channelData.items.length === 0) {
      throw new Error(`Channel data not found: ${channel.platform_channel_id}`);
    }

    const uploadsPlaylistId =
      channelData.items[0].contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new Error("Uploads playlist not found for channel");
    }

    const playlistItems: any[] = [];
    let nextPageToken: string | undefined;
    let fetchedCount = 0;

    do {
      const playlistUrl = new URL(
        "https://www.googleapis.com/youtube/v3/playlistItems"
      );
      playlistUrl.searchParams.set("part", "snippet,contentDetails");
      playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
      playlistUrl.searchParams.set("maxResults", "50");
      playlistUrl.searchParams.set("key", youtubeApiKey);
      if (nextPageToken) {
        playlistUrl.searchParams.set("pageToken", nextPageToken);
      }

      const playlistRes = await fetch(playlistUrl.toString());
      if (!playlistRes.ok) {
        throw new Error(`YouTube API error: ${playlistRes.statusText}`);
      }

      const playlistData = await playlistRes.json();
      if (playlistData.items) {
        playlistItems.push(...playlistData.items);
        fetchedCount += playlistData.items.length;
      }

      nextPageToken = playlistData.nextPageToken;
    } while (nextPageToken && fetchedCount < safeLimit);

    const rawItems = playlistItems.slice(0, safeLimit);

    const payloadByExternalId = new Map<string, VideoPayload>();
    for (const item of rawItems) {
      const snippet = item.snippet;
      const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId;
      if (!videoId) {
        continue;
      }

      payloadByExternalId.set(videoId, {
        external_video_id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source_url: `https://www.youtube.com/watch?v=${videoId}`,
        source_video_id: videoId,
        canonical_source_video_id: videoId,
        title: snippet.title || "",
        description: snippet.description || null,
        thumbnail_url:
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.default?.url ||
          null,
        published_at: snippet.publishedAt
          ? new Date(snippet.publishedAt).toISOString()
          : null,
      });
    }

    const videoPayloads = Array.from(payloadByExternalId.values());
    if (videoPayloads.length === 0) {
      return new Response(
        JSON.stringify({
          imported: 0,
          updated: 0,
          skipped: 0,
          message: "No videos found to import",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const externalVideoIds = videoPayloads.map((video) => video.external_video_id);

    const { data: existingRows, error: existingRowsError } = await supabaseService
      .from("videos")
      .select("id, external_video_id")
      .eq("platform", "youtube")
      .in("external_video_id", externalVideoIds);

    if (existingRowsError) {
      return new Response(
        JSON.stringify({
          error: "Failed to inspect existing videos",
          details: existingRowsError.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const existingIdByExternalId = new Map<string, string>();
    for (const row of existingRows || []) {
      existingIdByExternalId.set(
        (row as { external_video_id: string }).external_video_id,
        (row as { id: string }).id
      );
    }

    const newRows = videoPayloads
      .filter((video) => !existingIdByExternalId.has(video.external_video_id))
      .map((video) => ({
        partner_channel_id: channel.partner_channel_id,
        external_channel_id: externalChannelId,
        platform: "youtube",
        external_video_id: video.external_video_id,
        url: video.url,
        title: video.title,
        description: video.description,
        thumbnail_url: video.thumbnail_url,
        published_at: video.published_at,
        indexing_status: "pending",
        transcript_status: "pending",
        verse_status: "pending",
        visibility: "private",
        listing_state: "draft",
        is_public: false,
        is_active: true,
        channel_id: channel.platform_channel_id,
        channel_title: channel.title,
        source_url: video.source_url,
        source_video_id: video.source_video_id,
        canonical_source_video_id: video.canonical_source_video_id,
      }));

    const updateRows = videoPayloads
      .filter((video) => existingIdByExternalId.has(video.external_video_id))
      .map((video) => ({
        id: existingIdByExternalId.get(video.external_video_id) as string,
        partner_channel_id: channel.partner_channel_id,
        external_channel_id: externalChannelId,
        url: video.url,
        title: video.title,
        description: video.description,
        thumbnail_url: video.thumbnail_url,
        published_at: video.published_at,
        channel_id: channel.platform_channel_id,
        channel_title: channel.title,
        source_url: video.source_url,
      }));

    if (newRows.length > 0) {
      const { error: insertError } = await supabaseService.from("videos").insert(newRows);

      if (insertError) {
        return new Response(
          JSON.stringify({
            error: "Failed to import videos",
            details: insertError.message,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (updateRows.length > 0) {
      const { error: updateError } = await supabaseService
        .from("videos")
        .upsert(updateRows, { onConflict: "id" });

      if (updateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to update existing videos",
            details: updateError.message,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        imported: newRows.length,
        updated: updateRows.length,
        skipped: rawItems.length - videoPayloads.length,
        total_fetched: rawItems.length,
        first_video_id: videoPayloads[0]?.external_video_id || null,
        last_video_id: videoPayloads[videoPayloads.length - 1]?.external_video_id || null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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
