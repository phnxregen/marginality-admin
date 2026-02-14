import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";

type MetricCard = {
  label: string;
  value: number | null;
  description: string;
  unavailableReason?: string;
};

type LoaderData = {
  metrics: MetricCard[];
};

async function loadCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<{ value: number | null; unavailableReason?: string }> {
  const { count, error } = await query;
  if (error) {
    return { value: null, unavailableReason: error.message };
  }
  return { value: count ?? 0 };
}

export const meta: MetaFunction = () => {
  return [{ title: "Overview | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAdmin(request);
  const supabase = getSupabaseClient(user.accessToken);
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [totalChannels, totalVideos, indexedVideos, recentRuns] = await Promise.all([
    loadCount(
      supabase
        .from("external_channels")
        .select("*", { count: "exact", head: true })
    ),
    loadCount(
      supabase
        .from("videos")
        .select("*", { count: "exact", head: true })
    ),
    loadCount(
      supabase
        .from("videos")
        .select("*", { count: "exact", head: true })
        .eq("indexing_status", "complete")
    ),
    loadCount(
      supabase
        .from("indexing_runs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", oneDayAgo)
    ),
  ]);

  return Response.json({
    metrics: [
      {
        label: "Total Channels",
        value: totalChannels.value,
        description: "External channels currently tracked",
        unavailableReason: totalChannels.unavailableReason,
      },
      {
        label: "Total Videos",
        value: totalVideos.value,
        description: "All videos in the catalog",
        unavailableReason: totalVideos.unavailableReason,
      },
      {
        label: "Indexed Videos",
        value: indexedVideos.value,
        description: "Videos with indexing_status = complete",
        unavailableReason: indexedVideos.unavailableReason,
      },
      {
        label: "Indexing Runs (24h)",
        value: recentRuns.value,
        description: "Runs created in the last 24 hours",
        unavailableReason: recentRuns.unavailableReason,
      },
    ],
  } as LoaderData);
}

export default function OverviewPage() {
  const { metrics } = useLoaderData<LoaderData>();

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
          <p className="text-sm text-slate-600">
            Core operational metrics for the admin control center.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="p-5 bg-white rounded-lg shadow">
              <p className="text-sm font-medium text-slate-500">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {metric.value === null ? "N/A" : metric.value.toLocaleString()}
              </p>
              <p className="mt-2 text-xs text-slate-500">{metric.description}</p>
              {metric.unavailableReason && (
                <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
                  Data unavailable: {metric.unavailableReason}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
