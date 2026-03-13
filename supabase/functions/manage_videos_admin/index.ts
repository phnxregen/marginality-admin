import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

type ManageVideosAction = "clear_transcript_cache" | "delete_videos";

interface ManageVideosRequest {
  action?: ManageVideosAction;
  externalChannelId?: string;
  videoIds?: string[];
}

type VideoLookupRow = {
  id: string;
  title: string | null;
  external_video_id: string | null;
  external_channel_id: string | null;
  owner_user_id: string | null;
  source_video_id: string | null;
  canonical_source_video_id: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseVideoIds(videoIds: unknown): string[] {
  if (!Array.isArray(videoIds)) {
    return [];
  }

  const uniqueIds = new Set<string>();
  for (const value of videoIds) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    uniqueIds.add(trimmed);
  }

  return Array.from(uniqueIds);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

async function fetchRelatedVideos(
  supabaseService: any,
  seedVideo: VideoLookupRow,
): Promise<VideoLookupRow[]> {
  const lookupValues = uniqueNonEmpty([
    seedVideo.canonical_source_video_id,
    seedVideo.source_video_id,
    seedVideo.external_video_id,
  ]);

  if (lookupValues.length < 1) {
    return [seedVideo];
  }

  const [canonicalResult, sourceResult, externalResult] = await Promise.all([
    supabaseService
      .from("videos")
      .select(
        "id, title, external_video_id, external_channel_id, owner_user_id, source_video_id, canonical_source_video_id",
      )
      .in("canonical_source_video_id", lookupValues),
    supabaseService
      .from("videos")
      .select(
        "id, title, external_video_id, external_channel_id, owner_user_id, source_video_id, canonical_source_video_id",
      )
      .in("source_video_id", lookupValues),
    supabaseService
      .from("videos")
      .select(
        "id, title, external_video_id, external_channel_id, owner_user_id, source_video_id, canonical_source_video_id",
      )
      .in("external_video_id", lookupValues),
  ]);

  const firstError = [canonicalResult.error, sourceResult.error, externalResult.error].find(
    Boolean,
  );
  if (firstError) {
    throw new Error(`Failed to load related videos: ${firstError.message}`);
  }

  const rowsById = new Map<string, VideoLookupRow>();
  for (const row of [
    ...((canonicalResult.data || []) as VideoLookupRow[]),
    ...((sourceResult.data || []) as VideoLookupRow[]),
    ...((externalResult.data || []) as VideoLookupRow[]),
  ]) {
    rowsById.set(row.id, row);
  }

  rowsById.set(seedVideo.id, seedVideo);
  return Array.from(rowsById.values());
}

async function clearTableByVideoScope(
  supabaseService: any,
  table: "indexing_outputs" | "indexing_runs" | "verse_occurrences",
  videoIds: string[],
  sourceVideoIds: string[],
): Promise<void> {
  if (sourceVideoIds.length > 0) {
    const { error } = await supabaseService
      .from(table)
      .delete()
      .in("source_video_id", sourceVideoIds);

    if (error) {
      throw new Error(`Failed to clear ${table} by source video: ${error.message}`);
    }
  }

  if (videoIds.length > 0) {
    const { error } = await supabaseService.from(table).delete().in("video_id", videoIds);

    if (error) {
      throw new Error(`Failed to clear ${table} by video id: ${error.message}`);
    }
  }
}

serve(async (req) => {
  try {
    const { supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body: ManageVideosRequest = await req.json();
    const action = body.action;

    if (!action) {
      return jsonResponse({ error: "action is required" }, 400);
    }

    if (action !== "delete_videos" && action !== "clear_transcript_cache") {
      return jsonResponse({ error: `Unsupported action: ${action}` }, 400);
    }

    const externalChannelId =
      typeof body.externalChannelId === "string" ? body.externalChannelId.trim() : "";
    if (!externalChannelId) {
      return jsonResponse({ error: "externalChannelId is required" }, 400);
    }

    const videoIds = parseVideoIds(body.videoIds);
    if (videoIds.length < 1) {
      return jsonResponse({ error: "videoIds must include at least one id" }, 400);
    }

    if (videoIds.length > 500) {
      return jsonResponse(
        { error: "Bulk delete is limited to 500 videos per request" },
        400,
      );
    }

    if (action === "clear_transcript_cache") {
      if (videoIds.length !== 1) {
        return jsonResponse(
          { error: "clear_transcript_cache requires exactly one video id" },
          400,
        );
      }

      const targetVideoId = videoIds[0];

      const { data: seedVideo, error: seedVideoError } = await supabaseService
        .from("videos")
        .select(
          "id, title, external_video_id, external_channel_id, owner_user_id, source_video_id, canonical_source_video_id",
        )
        .eq("external_channel_id", externalChannelId)
        .eq("id", targetVideoId)
        .maybeSingle();

      if (seedVideoError) {
        return jsonResponse(
          {
            error: "Failed to load video for cache clearing",
            details: seedVideoError.message,
          },
          500,
        );
      }

      if (!seedVideo) {
        return jsonResponse({ error: "Video not found for this channel" }, 404);
      }

      const relatedVideos = await fetchRelatedVideos(
        supabaseService,
        seedVideo as VideoLookupRow,
      );
      const relatedVideoIds = uniqueNonEmpty(relatedVideos.map((video) => video.id));
      const relatedSourceVideoIds = uniqueNonEmpty(
        relatedVideos.flatMap((video) => [
          video.canonical_source_video_id,
          video.source_video_id,
          video.external_video_id,
        ]),
      );

      await clearTableByVideoScope(
        supabaseService,
        "verse_occurrences",
        relatedVideoIds,
        relatedSourceVideoIds,
      );
      await clearTableByVideoScope(
        supabaseService,
        "indexing_outputs",
        relatedVideoIds,
        relatedSourceVideoIds,
      );
      await clearTableByVideoScope(
        supabaseService,
        "indexing_runs",
        relatedVideoIds,
        relatedSourceVideoIds,
      );

      const distinctUserIds = uniqueNonEmpty(
        relatedVideos.map((video) => video.owner_user_id),
      );

      const { error: resetVideosError } = await supabaseService
        .from("videos")
        .update({
          indexing_status: "pending",
          transcript_status: "pending",
          verse_status: "pending",
          last_indexed_at: null,
          indexed_at: null,
          error_message: null,
          indexing_error: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", relatedVideoIds);

      if (resetVideosError) {
        return jsonResponse(
          {
            error: "Failed to reset video indexing state",
            details: resetVideosError.message,
          },
          500,
        );
      }

      return jsonResponse({
        success: true,
        action,
        sourceVideoId:
          seedVideo.canonical_source_video_id ||
          seedVideo.source_video_id ||
          seedVideo.external_video_id,
        clearedVideos: relatedVideoIds.length,
        affectedUsers: distinctUserIds.length,
        affectedUserOwnedVideos: relatedVideos.filter((video) => video.owner_user_id).length,
        clearedVideoIds: relatedVideoIds,
      });
    }

    const { data: existingRows, error: existingError } = await supabaseService
      .from("videos")
      .select("id, title, external_video_id, external_channel_id")
      .eq("external_channel_id", externalChannelId)
      .in("id", videoIds);

    if (existingError) {
      return jsonResponse(
        {
          error: "Failed to load videos for delete",
          details: existingError.message,
        },
        500,
      );
    }

    const matchedRows = (existingRows || []) as Array<{
      id: string;
      title: string | null;
      external_video_id: string | null;
      external_channel_id: string | null;
    }>;
    const matchedIds = matchedRows.map((row) => row.id);

    if (matchedIds.length < 1) {
      return jsonResponse({
        success: true,
        requested: videoIds.length,
        deleted: 0,
        skipped: videoIds.length,
        deletedVideos: [],
      });
    }

    const { data: deletedRows, error: deleteError } = await supabaseService
      .from("videos")
      .delete()
      .eq("external_channel_id", externalChannelId)
      .in("id", matchedIds)
      .select("id, title, external_video_id");

    if (deleteError) {
      return jsonResponse(
        {
          error: "Failed to delete videos",
          details: deleteError.message,
        },
        500,
      );
    }

    const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;

    return jsonResponse({
      success: true,
      requested: videoIds.length,
      deleted: deletedCount,
      skipped: Math.max(videoIds.length - deletedCount, 0),
      deletedVideos: deletedRows || [],
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not an admin")
      ? 403
      : message.includes("Invalid")
        ? 401
        : 500;

    return jsonResponse({ error: message }, status);
  }
});
