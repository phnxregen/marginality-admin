import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";
import { formatDate } from "~/utils/formatDate";
import Button from "~/components/Button";

export const meta: MetaFunction = () => {
  return [{ title: "Channel Details | Marginality Admin" }];
};

type ChannelRecord = {
  id: string;
  platform: string;
  platform_channel_id: string;
  title: string | null;
  url: string | null;
  created_at: string | null;
  channel_lifecycle_status: "invited" | "official" | null;
  officialized_at: string | null;
  platform_video_count: number | null;
  free_index_quota: number | null;
  free_indexes_used: number | null;
};

type VideoRow = {
  id: string;
  title: string | null;
  external_video_id: string | null;
  published_at: string | null;
  indexing_status: string | null;
  error_message: string | null;
  visibility: string | null;
  listing_state: string | null;
  is_public: boolean | null;
  admin_unlocked: boolean | null;
  thumbnail_url: string | null;
};

type AssignmentRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  role: "owner" | "editor" | "viewer" | string;
  created_at: string;
};

type LoaderData = {
  channel: ChannelRecord;
  totalVideos: number;
  importedVideos: number;
  unimportedVideos: number | null;
  unindexedVideos: number;
  videos: VideoRow[];
  assignments: AssignmentRow[];
};

type ActionData = {
  success?: boolean;
  error?: string;
  message?: string;
  result?: unknown;
};

async function callEdgeFunction(
  functionName: string,
  payload: Record<string, unknown>,
  accessToken: string
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  let body: any = {};

  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = { message: rawBody };
    }
  }

  if (!response.ok) {
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      (typeof body.code === "string" && body.code) ||
      `Function call failed: ${response.status}`;
    const details =
      typeof body.details === "string" && body.details
        ? ` (${body.details})`
        : "";
    throw new Error(`${message}${details}`);
  }

  return body;
}

function getIndexTriggerFailureMessage(result: unknown): string | null {
  const resultRecord =
    result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const indexTriggered =
    typeof resultRecord?.indexTriggered === "boolean"
      ? (resultRecord.indexTriggered as boolean)
      : true;

  if (indexTriggered) {
    return null;
  }

  const attempts = Array.isArray(resultRecord?.indexAttempts)
    ? (resultRecord?.indexAttempts as Array<{ status?: number }>)
    : [];
  const lastAttemptStatus =
    attempts.length > 0 ? attempts[attempts.length - 1]?.status : undefined;

  const indexResponseRecord =
    resultRecord && typeof resultRecord.indexResponse === "object"
      ? (resultRecord.indexResponse as Record<string, unknown>)
      : null;
  const indexFailureMessage =
    (indexResponseRecord &&
      typeof indexResponseRecord.error === "string" &&
      indexResponseRecord.error) ||
    (indexResponseRecord &&
      typeof indexResponseRecord.message === "string" &&
      indexResponseRecord.message) ||
    null;
  const indexFailureDetails =
    (indexResponseRecord &&
      typeof indexResponseRecord.details === "string" &&
      indexResponseRecord.details) ||
    null;
  const combinedFailureMessage =
    indexFailureMessage && indexFailureDetails
      ? indexFailureMessage.includes(indexFailureDetails)
        ? indexFailureMessage
        : `${indexFailureMessage}: ${indexFailureDetails}`
      : indexFailureMessage || indexFailureDetails;

  if (typeof lastAttemptStatus === "number") {
    return `Index trigger failed (last attempt HTTP ${lastAttemptStatus})${combinedFailureMessage ? `: ${combinedFailureMessage}` : "."}`;
  }

  if (combinedFailureMessage) {
    return `Index trigger failed: ${combinedFailureMessage}`;
  }

  return "Index trigger failed.";
}

function parseSelectedVideoIds(values: FormDataEntryValue[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const channelId = params.id;

  if (!channelId) {
    throw new Response("Channel ID required", { status: 400 });
  }

  const supabase = getSupabaseClient(user.accessToken);

  const [
    channelResult,
    importedCountResult,
    unindexedCountResult,
    videosResult,
    assignmentsResult,
  ] = await Promise.all([
    supabase
      .from("external_channels")
      .select(
        "id, platform, platform_channel_id, title, url, created_at, channel_lifecycle_status, officialized_at, platform_video_count, free_index_quota, free_indexes_used"
      )
      .eq("id", channelId)
      .single(),
    supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("external_channel_id", channelId),
    supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("external_channel_id", channelId)
      .in("indexing_status", ["pending", "processing", "failed"]),
    supabase
      .from("videos")
      .select(
        "id, title, external_video_id, published_at, indexing_status, error_message, visibility, listing_state, is_public, admin_unlocked, thumbnail_url"
      )
      .eq("external_channel_id", channelId)
      .order("published_at", { ascending: false })
      .limit(200),
    supabase
      .from("channel_assignments")
      .select("id, user_id, user_email, role, created_at")
      .eq("external_channel_id", channelId)
      .order("created_at", { ascending: false }),
  ]);

  if (channelResult.error || !channelResult.data) {
    throw new Response("Channel not found", { status: 404 });
  }

  if (videosResult.error) {
    throw new Response(`Failed to load channel videos: ${videosResult.error.message}`, {
      status: 500,
    });
  }

  if (assignmentsResult.error) {
    throw new Response(
      `Failed to load channel assignments: ${assignmentsResult.error.message}`,
      {
        status: 500,
      }
    );
  }

  const importedVideos = importedCountResult.count || 0;
  const platformTotal =
    typeof channelResult.data.platform_video_count === "number"
      ? channelResult.data.platform_video_count
      : null;

  return Response.json({
    channel: channelResult.data as ChannelRecord,
    totalVideos: platformTotal ?? importedVideos,
    importedVideos,
    unimportedVideos:
      platformTotal === null ? null : Math.max(platformTotal - importedVideos, 0),
    unindexedVideos: unindexedCountResult.count || 0,
    videos: (videosResult.data || []) as VideoRow[],
    assignments: (assignmentsResult.data || []) as AssignmentRow[],
  } as LoaderData);
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (typeof intent !== "string" || !intent.trim()) {
    return Response.json({ error: "Action intent is required" }, { status: 400 });
  }

  try {
    if (intent === "import_videos") {
      const channelId = formData.get("channel_id");
      const limitRaw = formData.get("limit");

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "Channel ID is required" }, { status: 400 });
      }

      const parsedLimit =
        typeof limitRaw === "string" && limitRaw.trim().length > 0
          ? Number.parseInt(limitRaw, 10)
          : undefined;
      const safeLimit =
        parsedLimit && Number.isFinite(parsedLimit)
          ? Math.max(1, Math.min(parsedLimit, 1000))
          : undefined;

      const result = await callEdgeFunction(
        "import_channel_videos_admin",
        {
          externalChannelId: channelId,
          limit: safeLimit,
        },
        user.accessToken
      );

      return Response.json({
        success: true,
        message: "Import complete",
        result,
      } as ActionData);
    }

    if (intent === "set_lifecycle_status") {
      const channelId = formData.get("channel_id");
      const lifecycleStatus = formData.get("lifecycle_status");

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "Channel ID is required" }, { status: 400 });
      }

      if (lifecycleStatus !== "invited" && lifecycleStatus !== "official") {
        return Response.json(
          { error: "lifecycle_status must be invited or official" },
          { status: 400 }
        );
      }

      const result = await callEdgeFunction(
        "manage_channel_admin",
        {
          action: "set_lifecycle_status",
          externalChannelId: channelId,
          lifecycleStatus,
        },
        user.accessToken
      );

      return Response.json({
        success: true,
        message:
          lifecycleStatus === "official"
            ? "Channel marked as official"
            : "Channel marked as invited",
        result,
      } as ActionData);
    }

    if (intent === "assign_user") {
      const channelId = formData.get("channel_id");
      const userEmail = formData.get("user_email");
      const role = formData.get("role");

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "Channel ID is required" }, { status: 400 });
      }

      if (typeof userEmail !== "string" || !userEmail.trim()) {
        return Response.json({ error: "User email is required" }, { status: 400 });
      }

      const resolvedRole =
        role === "owner" || role === "editor" || role === "viewer"
          ? role
          : "viewer";

      const result = await callEdgeFunction(
        "manage_channel_admin",
        {
          action: "assign_user",
          externalChannelId: channelId,
          userEmail: userEmail.trim(),
          role: resolvedRole,
        },
        user.accessToken
      );

      return Response.json({
        success: true,
        message: `Assigned ${userEmail.trim()} as ${resolvedRole}`,
        result,
      } as ActionData);
    }

    if (intent === "unassign_user") {
      const channelId = formData.get("channel_id");
      const userId = formData.get("user_id");

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "Channel ID is required" }, { status: 400 });
      }

      if (typeof userId !== "string" || !userId.trim()) {
        return Response.json({ error: "User ID is required" }, { status: 400 });
      }

      const result = await callEdgeFunction(
        "manage_channel_admin",
        {
          action: "unassign_user",
          externalChannelId: channelId,
          userId,
        },
        user.accessToken
      );

      return Response.json({
        success: true,
        message: "User unassigned from channel",
        result,
      } as ActionData);
    }

    if (intent === "delete_video") {
      const channelId = formData.get("channel_id");
      const videoId = formData.get("video_id");

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "channel_id is required" }, { status: 400 });
      }
      if (typeof videoId !== "string" || !videoId.trim()) {
        return Response.json({ error: "video_id is required" }, { status: 400 });
      }

      const result = await callEdgeFunction(
        "manage_videos_admin",
        {
          action: "delete_videos",
          externalChannelId: channelId.trim(),
          videoIds: [videoId.trim()],
        },
        user.accessToken
      );

      const deleted =
        typeof (result as { deleted?: number }).deleted === "number"
          ? (result as { deleted: number }).deleted
          : 0;

      if (deleted < 1) {
        return Response.json(
          { error: "No video was removed. It may have already been deleted." } as ActionData,
          { status: 404 }
        );
      }

      return Response.json({
        success: true,
        message: "Video removed from imported videos",
        result,
      } as ActionData);
    }

    if (intent === "bulk_video_action") {
      const channelId = formData.get("channel_id");
      const bulkAction = formData.get("bulk_action");
      const selectedVideoIds = parseSelectedVideoIds(formData.getAll("video_ids"));

      if (typeof channelId !== "string" || !channelId.trim()) {
        return Response.json({ error: "channel_id is required" }, { status: 400 });
      }
      if (selectedVideoIds.length < 1) {
        return Response.json({ error: "Select at least one video." }, { status: 400 });
      }

      if (bulkAction === "remove") {
        const result = await callEdgeFunction(
          "manage_videos_admin",
          {
            action: "delete_videos",
            externalChannelId: channelId.trim(),
            videoIds: selectedVideoIds,
          },
          user.accessToken
        );

        const deleted =
          typeof (result as { deleted?: number }).deleted === "number"
            ? (result as { deleted: number }).deleted
            : 0;
        const skipped =
          typeof (result as { skipped?: number }).skipped === "number"
            ? (result as { skipped: number }).skipped
            : 0;

        return Response.json({
          success: true,
          message:
            deleted > 0
              ? `Removed ${deleted} video${deleted === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} skipped)` : ""}.`
              : "No videos were removed.",
          result,
        } as ActionData);
      }

      if (bulkAction === "index_demo" || bulkAction === "index_publish") {
        const maxBulkIndex = 25;
        if (selectedVideoIds.length > maxBulkIndex) {
          return Response.json(
            {
              error: `Bulk indexing is limited to ${maxBulkIndex} videos per request to avoid timeout.`,
            } as ActionData,
            { status: 400 }
          );
        }

        const makePublic = bulkAction === "index_publish";
        let succeeded = 0;
        const failures: Array<{ videoId: string; error: string }> = [];

        for (const videoId of selectedVideoIds) {
          try {
            const result = await callEdgeFunction(
              "admin_index_video",
              {
                videoId,
                makePublic,
                reason: makePublic ? "admin_manual_publish" : "admin_demo",
              },
              user.accessToken
            );

            const failureMessage = getIndexTriggerFailureMessage(result);
            if (failureMessage) {
              failures.push({ videoId, error: failureMessage });
              continue;
            }
            succeeded += 1;
          } catch (error: any) {
            failures.push({
              videoId,
              error: error?.message || "Bulk index request failed",
            });
          }
        }

        const failed = failures.length;
        const failurePreview = failures
          .slice(0, 3)
          .map((entry) => `${entry.videoId}: ${entry.error}`)
          .join(" | ");

        if (succeeded < 1) {
          return Response.json(
            {
              error: `Bulk indexing failed for all ${failed} selected videos${failurePreview ? ` (${failurePreview})` : "."}`,
              result: {
                requested: selectedVideoIds.length,
                succeeded,
                failed,
                failures,
              },
            } as ActionData,
            { status: 500 }
          );
        }

        return Response.json({
          success: true,
          message:
            failed > 0
              ? `Bulk indexing started for ${succeeded}/${selectedVideoIds.length} videos${failurePreview ? ` (${failurePreview})` : ""}.`
              : `Bulk indexing started for ${succeeded} video${succeeded === 1 ? "" : "s"}.`,
          result: {
            requested: selectedVideoIds.length,
            succeeded,
            failed,
            failures,
          },
        } as ActionData);
      }

      return Response.json(
        { error: `Unsupported bulk action: ${String(bulkAction)}` } as ActionData,
        { status: 400 }
      );
    }

    if (intent === "admin_index_video") {
      const videoId = formData.get("video_id");
      const makePublicRaw = formData.get("make_public");

      if (typeof videoId !== "string" || !videoId.trim()) {
        return Response.json({ error: "video_id is required" }, { status: 400 });
      }

      const makePublic =
        makePublicRaw === "1" ||
        makePublicRaw === "true" ||
        makePublicRaw === "on";

      const result = await callEdgeFunction(
        "admin_index_video",
        {
          videoId: videoId.trim(),
          makePublic,
          reason: makePublic ? "admin_manual_publish" : "admin_demo",
        },
        user.accessToken
      );

      const indexFailureMessage = getIndexTriggerFailureMessage(result);
      const demoProtectionErrors = Array.isArray(
        (result as { demoProtectionErrors?: string[] }).demoProtectionErrors
      )
        ? (result as { demoProtectionErrors: string[] }).demoProtectionErrors
        : [];

      if (indexFailureMessage) {
        return Response.json(
          {
            error: indexFailureMessage,
            result,
          } as ActionData,
          { status: 500 }
        );
      }

      return Response.json({
        success: true,
        message:
          demoProtectionErrors.length > 0
            ? `Video unlocked and indexing triggered (demo safeguards warning: ${demoProtectionErrors.join("; ")})`
            : "Video unlocked and indexing triggered",
        result,
      } as ActionData);
    }

    return Response.json(
      { error: `Unsupported action intent: ${intent}` },
      { status: 400 }
    );
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Action failed" } as ActionData,
      { status: 500 }
    );
  }
}

export default function ChannelDetail() {
  const {
    channel,
    totalVideos,
    importedVideos,
    unimportedVideos,
    unindexedVideos,
    videos,
    assignments,
  } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const lifecycleStatus =
    channel.channel_lifecycle_status === "official" ? "official" : "invited";
  const nextLifecycleStatus =
    lifecycleStatus === "official" ? "invited" : "official";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {channel.title || "Untitled channel"}
          </h1>
          <p className="text-sm text-slate-600">
            {channel.platform} / {channel.platform_channel_id}
          </p>
          <div className="mt-2">
            <span
              className={[
                "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
                lifecycleStatus === "official"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800",
              ].join(" ")}
            >
              {lifecycleStatus === "official" ? "Official" : "Invited (Demo)"}
            </span>
          </div>
        </div>
        <a href="/channels" className="text-sm text-cyan-600 hover:text-cyan-900">
          ← Back to Channels
        </a>
      </div>

      {actionData?.error && (
        <div className="p-3 text-sm rounded-md bg-rose-50 text-rose-700">
          {actionData.error}
        </div>
      )}

      {actionData?.success && actionData.message && (
        <div className="p-3 text-sm rounded-md bg-green-50 text-green-700">
          {actionData.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Platform Channel ID</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 break-all">
            {channel.platform_channel_id}
          </div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Total Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{totalVideos}</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Imported Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{importedVideos}</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Unimported Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {unimportedVideos === null ? "—" : unimportedVideos}
          </div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Unindexed Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{unindexedVideos}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="p-6 bg-white rounded-lg shadow space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Channel Lifecycle</h2>
          <p className="text-sm text-slate-600">
            Invited channels stay private for demo/testing. Move to official after paid
            conversion.
          </p>
          <p className="text-xs text-slate-500">
            Channels are auto-marked official when a video is published/public or when purchase
            flow calls `officialize_channel`.
          </p>
          <div className="text-sm text-slate-700">
            <span className="font-medium">Free Demo Index Quota:</span>{" "}
            {(channel.free_indexes_used || 0).toString()} / {(channel.free_index_quota || 5).toString()}
          </div>
          {channel.officialized_at && (
            <div className="text-sm text-slate-700">
              <span className="font-medium">Official Since:</span>{" "}
              {formatDate(channel.officialized_at)}
            </div>
          )}

          <Form method="POST" className="flex gap-3">
            <input type="hidden" name="intent" value="set_lifecycle_status" />
            <input type="hidden" name="channel_id" value={channel.id} />
            <input type="hidden" name="lifecycle_status" value={nextLifecycleStatus} />
            <Button type="submit" variant="outlined" loading={isSubmitting}>
              {lifecycleStatus === "official" ? "Mark Invited" : "Mark Official"}
            </Button>
          </Form>
        </div>

        <div className="p-6 bg-white rounded-lg shadow space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Assign Users</h2>
          <p className="text-sm text-slate-600">
            Assign this channel to one or more app users by email.
          </p>

          <Form method="POST" className="space-y-3">
            <input type="hidden" name="intent" value="assign_user" />
            <input type="hidden" name="channel_id" value={channel.id} />
            <div>
              <label htmlFor="user_email" className="block text-sm font-medium text-slate-700">
                User Email
              </label>
              <input
                id="user_email"
                name="user_email"
                type="email"
                required
                placeholder="creator@example.com"
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
              />
            </div>
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-slate-700">
                Role
              </label>
              <select
                id="role"
                name="role"
                defaultValue="viewer"
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <Button type="submit" loading={isSubmitting}>Assign User</Button>
          </Form>

          {assignments.length === 0 ? (
            <p className="text-sm text-slate-500">No users assigned yet.</p>
          ) : (
            <div className="overflow-hidden border border-slate-200 rounded-md">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      User
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Role
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Assigned
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {assignment.user_email || assignment.user_id}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 capitalize">
                        {assignment.role}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {formatDate(assignment.created_at)}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <Form method="POST">
                          <input type="hidden" name="intent" value="unassign_user" />
                          <input type="hidden" name="channel_id" value={channel.id} />
                          <input type="hidden" name="user_id" value={assignment.user_id} />
                          <Button type="submit" variant="outlined" loading={isSubmitting}>
                            Unassign
                          </Button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Import Videos</h2>
        <p className="mb-4 text-sm text-slate-600">
          Pull latest videos from YouTube into your catalog for this channel.
        </p>

        <Form method="POST" className="space-y-4">
          <input type="hidden" name="intent" value="import_videos" />
          <input type="hidden" name="channel_id" value={channel.id} />

          <div>
            <label htmlFor="limit" className="block text-sm font-medium text-slate-700">
              Import limit (1-1000)
            </label>
            <input
              type="number"
              id="limit"
              name="limit"
              min="1"
              max="1000"
              defaultValue="50"
              className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
            />
          </div>

          <Button type="submit" loading={isSubmitting}>
            Import Videos
          </Button>
        </Form>
      </div>

      <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Imported Videos</h2>
          <p className="text-sm text-slate-600">Latest {videos.length} videos shown</p>
        </div>

        {videos.length === 0 ? (
          <p className="text-sm text-slate-500">
            No imported videos yet. Run import first.
          </p>
        ) : (
          <>
            <Form
              id="bulk-video-form"
              method="POST"
              className="mb-4 p-3 border border-slate-200 rounded-md bg-slate-50 space-y-3"
            >
              <input type="hidden" name="intent" value="bulk_video_action" />
              <input type="hidden" name="channel_id" value={channel.id} />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="bulk_action"
                    className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                  >
                    Bulk Action
                  </label>
                  <select
                    id="bulk_action"
                    name="bulk_action"
                    defaultValue="index_demo"
                    className="mt-1 px-3 py-2 border border-slate-300 rounded-md bg-white text-sm text-slate-700 focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    <option value="index_demo">Index Demo (Selected)</option>
                    <option value="index_publish">Index + Publish (Selected)</option>
                    <option value="remove">Remove Imported (Selected)</option>
                  </select>
                </div>
                <Button type="submit" variant="outlined" loading={isSubmitting}>
                  Apply to Selected
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Bulk indexing is limited to 25 videos per request. Remove permanently deletes the
                selected video rows and cascades indexing artifacts.
              </p>
            </Form>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      <input
                        type="checkbox"
                        aria-label="Select all visible videos"
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          const checkboxes = document.querySelectorAll(
                            'input[data-bulk-video-checkbox="1"]'
                          );
                          checkboxes.forEach((checkbox) => {
                            if (checkbox instanceof HTMLInputElement) {
                              checkbox.checked = checked;
                            }
                          });
                        }}
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Video
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Published
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Indexing
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Visibility
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {videos.map((video) => (
                    <tr key={video.id}>
                      <td className="px-3 py-3 text-sm text-slate-700 align-top">
                        <input
                          type="checkbox"
                          name="video_ids"
                          value={video.id}
                          form="bulk-video-form"
                          data-bulk-video-checkbox="1"
                          aria-label={`Select ${video.title || video.external_video_id || video.id}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        <div className="font-medium text-slate-900">
                          {video.title || "Untitled video"}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {video.external_video_id || video.id}
                        </div>
                        {video.thumbnail_url && (
                          <a
                            href={video.thumbnail_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-cyan-600 hover:text-cyan-800"
                          >
                            thumbnail
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        {video.published_at ? formatDate(video.published_at) : "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        <div className="capitalize">{video.indexing_status || "unknown"}</div>
                        {video.error_message && (
                          <div className="text-xs text-rose-700 mt-1 max-w-xs break-words">
                            {video.error_message}
                          </div>
                        )}
                        {video.admin_unlocked && (
                          <div className="text-xs text-emerald-700 mt-1">Admin unlocked</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        <div className="capitalize">{video.visibility || "private"}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {video.listing_state || (video.is_public ? "published" : "draft")}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap gap-2">
                          <Form method="POST">
                            <input type="hidden" name="intent" value="admin_index_video" />
                            <input type="hidden" name="video_id" value={video.id} />
                            <Button
                              type="submit"
                              name="make_public"
                              value="0"
                              variant="outlined"
                              loading={isSubmitting}
                            >
                              Index Demo
                            </Button>
                          </Form>
                          <Form method="POST">
                            <input type="hidden" name="intent" value="admin_index_video" />
                            <input type="hidden" name="video_id" value={video.id} />
                            <Button
                              type="submit"
                              name="make_public"
                              value="1"
                              variant="outlined"
                              loading={isSubmitting}
                            >
                              Index + Publish
                            </Button>
                          </Form>
                          <Form method="POST">
                            <input type="hidden" name="intent" value="delete_video" />
                            <input type="hidden" name="channel_id" value={channel.id} />
                            <input type="hidden" name="video_id" value={video.id} />
                            <Button
                              type="submit"
                              variant="outlined"
                              className="text-rose-700 ring-rose-300 hover:bg-rose-50"
                              loading={isSubmitting}
                            >
                              Remove
                            </Button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
