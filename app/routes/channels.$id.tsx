import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";
import Button from "~/components/Button";

export const meta: MetaFunction = () => {
  return [{ title: "Channel Details | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const channelId = url.pathname.split("/").pop();

  if (!channelId) {
    throw new Response("Channel ID required", { status: 400 });
  }

  const supabase = getSupabaseClient();
  
  // Fetch channel
  const { data: channel, error: channelError } = await supabase
    .from("external_channels")
    .select("*")
    .eq("id", channelId)
    .single();

  if (channelError || !channel) {
    throw new Response("Channel not found", { status: 404 });
  }

  // Fetch counts
  const { count: totalVideos } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("external_channel_id", channelId);

  const { count: unindexedVideos } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("external_channel_id", channelId)
    .in("indexing_status", ["not_indexed", "pending"]);

  return {
    channel,
    totalVideos: totalVideos || 0,
    unindexedVideos: unindexedVideos || 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const channelId = formData.get("channel_id");
  const limit = formData.get("limit");

  if (typeof channelId !== "string") {
    return Response.json(
      { error: "Channel ID is required" },
      { status: 400 }
    );
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
    }

    const url = `${supabaseUrl}/functions/v1/import_channel_videos_admin`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({
        externalChannelId: channelId,
        limit: limit ? parseInt(limit as string) : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      return Response.json(
        { error: error.error || "Failed to import videos" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return Response.json({ success: true, result: data });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to import videos" },
      { status: 500 }
    );
  }
}

export default function ChannelDetail() {
  const { channel, totalVideos, unindexedVideos } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; result?: any; error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{channel.title}</h1>
          {channel.handle && (
            <p className="text-sm text-slate-600">@{channel.handle}</p>
          )}
        </div>
        <a
          href="/channels"
          className="text-sm text-cyan-600 hover:text-cyan-900"
        >
          ← Back to Channels
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">YouTube Channel ID</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{channel.youtube_channel_id}</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Total Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{totalVideos}</div>
        </div>
        <div className="p-4 bg-white rounded-lg shadow">
          <div className="text-sm font-medium text-slate-500">Unindexed Videos</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{unindexedVideos}</div>
        </div>
      </div>

      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Import Videos</h2>
        
        {actionData?.error && (
          <div className="p-3 mb-4 text-sm rounded-md bg-rose-50 text-rose-700">
            {actionData.error}
          </div>
        )}

        {actionData?.success && actionData.result && (
          <div className="p-4 mb-4 rounded-md bg-green-50">
            <h3 className="mb-2 font-medium text-green-900">Import Complete</h3>
            <pre className="text-xs overflow-auto text-green-800">
              {JSON.stringify(actionData.result, null, 2)}
            </pre>
          </div>
        )}

        <Form method="POST" className="space-y-4">
          <input type="hidden" name="channel_id" value={channel.id} />
          
          <div>
            <label htmlFor="limit" className="block text-sm font-medium text-slate-700">
              Limit (optional, default: 50)
            </label>
            <input
              type="number"
              id="limit"
              name="limit"
              min="1"
              max="200"
              defaultValue="50"
              className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-cyan-500 focus:border-cyan-500"
            />
          </div>

          <Button type="submit" loading={isSubmitting}>
            Import Videos
          </Button>
        </Form>
      </div>
    </div>
  );
}
