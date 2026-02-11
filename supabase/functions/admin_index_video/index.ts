import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

interface AdminIndexVideoRequest {
  videoId?: string;
  ignoreQuota?: boolean;
  makePublic?: boolean;
  reason?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function triggerIndexVideo(
  supabaseUrl: string,
  supabaseServiceKey: string,
  videoId: string,
  youtubeUrl: string | null,
  partnerChannelId: string | null
) {
  const url = `${supabaseUrl}/functions/v1/index_video`;

  const candidatePayloads = [
    ...(youtubeUrl
      ? [
          {
            youtubeUrl,
            partnerChannelId,
            videoId,
            bypassPayment: true,
            source: "admin",
          },
        ]
      : []),
    {
      video_id: videoId,
      bypass_payment: true,
      source: "admin",
    },
    {
      videoId,
      bypassPayment: true,
      source: "admin",
    },
    {
      id: videoId,
      bypassPayment: true,
      source: "admin",
    },
  ];

  const attempts: Array<{
    payloadKeys: string[];
    status: number;
    body: unknown;
  }> = [];

  for (const payload of candidatePayloads) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
        apikey: supabaseServiceKey,
      },
      body: JSON.stringify(payload),
    });

    let parsedBody: unknown = null;
    const rawBody = await response.text();
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    attempts.push({
      payloadKeys: Object.keys(payload),
      status: response.status,
      body: parsedBody,
    });

    if (response.ok) {
      return {
        ok: true,
        attempts,
        responseBody: parsedBody,
      };
    }
  }

  return {
    ok: false,
    attempts,
    responseBody: attempts[attempts.length - 1]?.body || null,
  };
}

serve(async (req) => {
  try {
    const { user, supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body: AdminIndexVideoRequest = await req.json();
    const videoId =
      typeof body.videoId === "string" ? body.videoId.trim() : "";
    const makePublic = Boolean(body.makePublic);
    const ignoreQuota = Boolean(body.ignoreQuota);
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "admin_demo";

    if (!videoId) {
      return jsonResponse({ error: "videoId is required" }, 400);
    }

    const { data: video, error: videoError } = await supabaseService
      .from("videos")
      .select(
        "id, external_channel_id, external_video_id, source_url, title, indexing_status, visibility, listing_state, is_public"
      )
      .eq("id", videoId)
      .single();

    if (videoError || !video) {
      return jsonResponse(
        {
          error: "Video not found",
          details: videoError?.message,
        },
        404
      );
    }

    const externalChannelId = (
      video as { external_channel_id: string | null }
    ).external_channel_id;
    const sourceUrl = (video as { source_url: string | null }).source_url;
    const externalVideoId = (
      video as { external_video_id: string | null }
    ).external_video_id;

    const youtubeUrl =
      typeof sourceUrl === "string" && sourceUrl.trim().length > 0
        ? sourceUrl.trim()
        : typeof externalVideoId === "string" && externalVideoId.trim().length > 0
          ? `https://www.youtube.com/watch?v=${externalVideoId.trim()}`
          : null;

    if (!externalChannelId) {
      return jsonResponse(
        { error: "Video is missing external_channel_id" },
        400
      );
    }

    const { data: channel, error: channelError } = await supabaseService
      .from("external_channels")
      .select(
        "id, channel_lifecycle_status, free_index_quota, free_indexes_used"
      )
      .eq("id", externalChannelId)
      .single();

    if (channelError || !channel) {
      return jsonResponse(
        {
          error: "Channel not found for video",
          details: channelError?.message,
        },
        404
      );
    }

    const freeIndexQuota = Math.max(
      0,
      Number((channel as { free_index_quota?: number }).free_index_quota ?? 5)
    );
    const freeIndexesUsed = Math.max(
      0,
      Number((channel as { free_indexes_used?: number }).free_indexes_used ?? 0)
    );
    const channelWasInvited =
      (channel as { channel_lifecycle_status?: string | null })
        .channel_lifecycle_status !== "official";

    if (!ignoreQuota && freeIndexesUsed >= freeIndexQuota) {
      return jsonResponse(
        {
          error:
            "Free index quota reached for this channel. Use ignoreQuota=true or mark as official/purchased.",
          quota: {
            freeIndexQuota,
            freeIndexesUsed,
          },
        },
        409
      );
    }

    const updatePayload: Record<string, unknown> = {
      admin_unlocked: true,
      indexing_unlock_reason: reason,
      indexing_unlocked_at: new Date().toISOString(),
      unlocked_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    if (makePublic) {
      updatePayload.visibility = "public";
      updatePayload.listing_state = "published";
      updatePayload.is_public = true;
    } else {
      updatePayload.visibility = "private";
      updatePayload.listing_state = "draft";
      updatePayload.is_public = false;
    }

    const { data: updatedVideo, error: updateError } = await supabaseService
      .from("videos")
      .update(updatePayload)
      .eq("id", videoId)
      .select(
        "id, title, indexing_status, visibility, listing_state, is_public, admin_unlocked, indexing_unlock_reason"
      )
      .single();

    if (updateError || !updatedVideo) {
      return jsonResponse(
        {
          error: "Failed to update video unlock state",
          details: updateError?.message,
        },
        500
      );
    }

    // Usage is consumed by a DB trigger when indexing_status becomes "complete".
    const quotaUpdated = false;
    const quotaState = {
      freeIndexQuota,
      freeIndexesUsed,
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(
        {
          error:
            "Video unlocked, but index trigger skipped (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)",
          video: updatedVideo,
          quota: quotaState,
          quotaUpdated,
        },
        200
      );
    }

    const indexResult = await triggerIndexVideo(
      supabaseUrl,
      supabaseServiceKey,
      videoId,
      youtubeUrl,
      externalChannelId
    );

    const postIndexErrors: string[] = [];
    let finalVideo = updatedVideo;
    let finalChannel:
      | {
          id: string;
          channel_lifecycle_status: string | null;
          officialized_at: string | null;
        }
      | null = null;

    if (!makePublic) {
      const { data: relockedVideo, error: relockVideoError } = await supabaseService
        .from("videos")
        .update({
          visibility: "private",
          listing_state: "draft",
          is_public: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", videoId)
        .select(
          "id, title, indexing_status, visibility, listing_state, is_public, admin_unlocked, indexing_unlock_reason"
        )
        .single();

      if (relockVideoError || !relockedVideo) {
        postIndexErrors.push(
          `Failed to restore demo visibility: ${relockVideoError?.message || "unknown error"}`
        );
      } else {
        finalVideo = relockedVideo;
      }

      if (channelWasInvited) {
        const { data: revertedChannel, error: revertChannelError } =
          await supabaseService
            .from("external_channels")
            .update({
              channel_lifecycle_status: "invited",
              officialized_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", externalChannelId)
            .select("id, channel_lifecycle_status, officialized_at")
            .single();

        if (revertChannelError || !revertedChannel) {
          postIndexErrors.push(
            `Failed to restore invited lifecycle: ${revertChannelError?.message || "unknown error"}`
          );
        } else {
          finalChannel = revertedChannel;
        }
      }
    }

    return jsonResponse({
      video: finalVideo,
      channel: finalChannel,
      quota: quotaState,
      quotaUpdated,
      indexTriggered: indexResult.ok,
      indexResponse: indexResult.responseBody,
      indexAttempts: indexResult.attempts,
      demoProtectionApplied: !makePublic,
      demoProtectionErrors: postIndexErrors,
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
