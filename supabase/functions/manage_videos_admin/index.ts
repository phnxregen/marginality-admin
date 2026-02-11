import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

type ManageVideosAction = "delete_videos";

interface ManageVideosRequest {
  action?: ManageVideosAction;
  externalChannelId?: string;
  videoIds?: string[];
}

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

    if (action !== "delete_videos") {
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
