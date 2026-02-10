import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
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
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const supabase = getSupabaseClient();

  const { data: channels, error: channelsError } = await supabase
    .from("external_channels")
    .select("id, platform, platform_channel_id, title, created_at")
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
      total_videos: number;
      unindexed_videos: number;
    }
  >();

  for (const row of videoRows || []) {
    const externalChannelId = (row as { external_channel_id: string | null }).external_channel_id;
    if (!externalChannelId) {
      continue;
    }

    const stats = countsByChannelId.get(externalChannelId) || {
      total_videos: 0,
      unindexed_videos: 0,
    };

    stats.total_videos += 1;
    if ((row as { indexing_status: string }).indexing_status !== "complete") {
      stats.unindexed_videos += 1;
    }

    countsByChannelId.set(externalChannelId, stats);
  }

  const channelsWithCounts = channelRows.map((channel) => {
    const stats = countsByChannelId.get(channel.id) || {
      total_videos: 0,
      unindexed_videos: 0,
    };

    return {
      ...channel,
      ...stats,
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
                  Platform
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Channel ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Total Videos
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Unindexed
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
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-500">{channel.platform}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-500">{channel.platform_channel_id}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.total_videos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {channel.unindexed_videos}
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
