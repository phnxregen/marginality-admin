import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

interface ImportVideosRequest {
  externalChannelId: string;
  limit?: number;
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

    const body: ImportVideosRequest = await req.json();
    const { externalChannelId, limit = 50 } = body;

    if (!externalChannelId || typeof externalChannelId !== "string") {
      return new Response(
        JSON.stringify({ error: "externalChannelId is required" }),
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

    // Lookup external_channels row to get youtube_channel_id
    const { data: channel, error: channelError } = await supabaseService
      .from("external_channels")
      .select("id, youtube_channel_id")
      .eq("id", externalChannelId)
      .single();

    if (channelError || !channel) {
      return new Response(
        JSON.stringify({ error: "Channel not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get uploads playlist ID
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "contentDetails");
    channelUrl.searchParams.set("id", channel.youtube_channel_id);
    channelUrl.searchParams.set("key", youtubeApiKey);

    const channelRes = await fetch(channelUrl.toString());
    if (!channelRes.ok) {
      throw new Error(`YouTube API error: ${channelRes.statusText}`);
    }

    const channelData = await channelRes.json();
    if (!channelData.items || channelData.items.length === 0) {
      throw new Error(`Channel data not found: ${channel.youtube_channel_id}`);
    }

    const uploadsPlaylistId =
      channelData.items[0].contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new Error("Uploads playlist not found for channel");
    }

    // Fetch videos from playlist
    const videos: any[] = [];
    let nextPageToken: string | undefined = undefined;
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
        videos.push(...playlistData.items);
        fetchedCount += playlistData.items.length;
      }

      nextPageToken = playlistData.nextPageToken;
    } while (nextPageToken && fetchedCount < limit);

    // Limit to requested amount
    const videosToProcess = videos.slice(0, limit);

    // Upsert videos into database
    const videoInserts = videosToProcess.map((item) => {
      const snippet = item.snippet;
      const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId;
      
      if (!videoId) {
        return null;
      }

      return {
        external_channel_id: externalChannelId,
        youtube_video_id: videoId,
        title: snippet.title || "",
        description: snippet.description || null,
        thumbnail_url:
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.default?.url ||
          null,
        published_at: snippet.publishedAt
          ? new Date(snippet.publishedAt).toISOString()
          : null,
        visibility: "private",
        indexing_status: "not_indexed",
      };
    }).filter(Boolean);

    if (videoInserts.length === 0) {
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

    // Upsert videos
    // TODO: Adjust column names and unique constraint if your schema differs
    // If unique constraint is on (external_channel_id, youtube_video_id), adjust accordingly
    const { data: insertedVideos, error: insertError } = await supabaseService
      .from("videos")
      .upsert(videoInserts, {
        onConflict: "youtube_video_id", // TODO: Adjust if composite key
        ignoreDuplicates: false,
      })
      .select();

    if (insertError) {
      console.error("Database error:", insertError);
      return new Response(
        JSON.stringify({
          error: "Failed to import videos",
          details: insertError.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Count new vs updated (simplified - assumes all returned are either new or updated)
    const imported = insertedVideos?.length || 0;

    return new Response(
      JSON.stringify({
        imported: imported,
        updated: 0, // TODO: Calculate if needed
        skipped: videoInserts.length - imported,
        total_fetched: videosToProcess.length,
        first_video_id: insertedVideos?.[0]?.youtube_video_id || null,
        last_video_id:
          insertedVideos?.[insertedVideos.length - 1]?.youtube_video_id || null,
      }),
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
