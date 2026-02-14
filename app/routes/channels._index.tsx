import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireAdmin } from "~/lib/admin.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";
import Button from "~/components/Button";

export const meta: MetaFunction = () => {
  return [{ title: "Channels | Marginality Admin" }];
};

type ChannelRow = {
  id: string;
  platform: string;
  platform_channel_id: string;
  title: string | null;
  created_at: string | null;
  channel_lifecycle_status: "invited" | "official" | null;
  platform_video_count: number | null;
};

type ChannelWithStats = ChannelRow & {
  total_videos: number;
  imported_videos: number;
  unimported_videos: number | null;
  unindexed_videos: number;
  assigned_users: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAdmin(request);
  const supabase = getSupabaseClient(user.accessToken);

  const { data: channels, error: channelsError } = await supabase
    .from("external_channels")
    .select(
      "id, platform, platform_channel_id, title, created_at, channel_lifecycle_status, platform_video_count"
    )
    .order("created_at", { ascending: false });

  if (channelsError) {
    console.error("Error fetching channels:", channelsError);
    return { channels: [], error: channelsError.message };
  }

  const channelRows = (channels || []) as ChannelRow[];
  if (channelRows.length === 0) {
    return { channels: [] };
  }

  const channelIds = channelRows.map((channel) => channel.id);
  const { data: videoRows, error: videosError } = await supabase
    .from("videos")
    .select("external_channel_id, indexing_status")
    .in("external_channel_id", channelIds);

  if (videosError) {
    console.error("Error fetching channel video counts:", videosError);
  }

  const countsByChannelId = new Map<
    string,
    {
      imported_videos: number;
      unindexed_videos: number;
    }
  >();

  for (const row of videoRows || []) {
    const externalChannelId = (row as { external_channel_id: string | null }).external_channel_id;
    if (!externalChannelId) {
      continue;
    }

    const stats = countsByChannelId.get(externalChannelId) || {
      imported_videos: 0,
      unindexed_videos: 0,
    };

    stats.imported_videos += 1;
    if ((row as { indexing_status: string }).indexing_status !== "complete") {
      stats.unindexed_videos += 1;
    }

    countsByChannelId.set(externalChannelId, stats);
  }

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("channel_assignments")
    .select("external_channel_id")
    .in("external_channel_id", channelIds);

  if (assignmentError) {
    console.error("Error fetching channel assignments:", assignmentError);
  }

  const assignmentCountsByChannelId = new Map<string, number>();
  for (const row of assignmentRows || []) {
    const externalChannelId = (row as { external_channel_id: string | null }).external_channel_id;
    if (!externalChannelId) {
      continue;
    }

    assignmentCountsByChannelId.set(
      externalChannelId,
      (assignmentCountsByChannelId.get(externalChannelId) || 0) + 1
    );
  }

  const channelsWithCounts: ChannelWithStats[] = channelRows.map((channel) => {
    const stats = countsByChannelId.get(channel.id) || {
      imported_videos: 0,
      unindexed_videos: 0,
    };
    const importedVideos = stats.imported_videos;
    const platformTotal =
      typeof channel.platform_video_count === "number"
        ? channel.platform_video_count
        : null;
    const totalVideos = platformTotal ?? importedVideos;
    const unimportedVideos =
      platformTotal === null ? null : Math.max(platformTotal - importedVideos, 0);

    return {
      ...channel,
      imported_videos: importedVideos,
      total_videos: totalVideos,
      unimported_videos: unimportedVideos,
      unindexed_videos: stats.unindexed_videos,
      assigned_users: assignmentCountsByChannelId.get(channel.id) || 0,
    };
  });

  return { channels: channelsWithCounts };
}

export default function ChannelsIndex() {
  const { channels } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Channels</h1>
        <Link to="/channels/new">
          <Button>Create Channel</Button>
        </Link>
      </div>

      {channels.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-lg shadow">
          <p className="text-slate-600">No channels yet. Create your first channel to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden bg-white shadow rounded-lg">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Channel
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Lifecycle
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Platform
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Total Videos
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Imported
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Unimported
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Unindexed
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Assigned Users
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">
                      {channel.title || "Untitled channel"}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {channel.platform_channel_id}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
                        channel.channel_lifecycle_status === "official"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800",
                      ].join(" ")}
                    >
                      {channel.channel_lifecycle_status === "official"
                        ? "Official"
                        : "Invited"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-500">{channel.platform}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.total_videos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.imported_videos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.unimported_videos === null ? "—" : channel.unimported_videos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.unindexed_videos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.assigned_users}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link
                      to={`/channels/${channel.id}`}
                      className="text-cyan-600 hover:text-cyan-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
