import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";
import Button from "~/components/Button";

export const meta: MetaFunction = () => {
  return [{ title: "Channels | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  
  // Fetch channels with video counts
  // Using a simple approach: fetch channels, then count videos per channel
  // TODO: If your schema supports it, use a SQL view or RPC function for better performance
  const supabase = getSupabaseClient();
  
  const { data: channels, error: channelsError } = await supabase
    .from("external_channels")
    .select("id, youtube_channel_id, title, handle, created_at")
    .order("created_at", { ascending: false });

  if (channelsError) {
    console.error("Error fetching channels:", channelsError);
    return { channels: [], error: channelsError.message };
  }

  // Fetch counts for each channel
  const channelsWithCounts = await Promise.all(
    (channels || []).map(async (channel) => {
      const { count: totalVideos } = await supabase
        .from("videos")
        .select("*", { count: "exact", head: true })
        .eq("external_channel_id", channel.id);

      const { count: unindexedVideos } = await supabase
        .from("videos")
        .select("*", { count: "exact", head: true })
        .eq("external_channel_id", channel.id)
        .in("indexing_status", ["not_indexed", "pending"]);

      return {
        ...channel,
        total_videos: totalVideos || 0,
        unindexed_videos: unindexedVideos || 0,
      };
    })
  );

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
                  YouTube ID
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
                    <div className="text-sm font-medium text-slate-900">{channel.title}</div>
                    {channel.handle && (
                      <div className="text-sm text-slate-500">@{channel.handle}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-500">{channel.youtube_channel_id}</div>
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
