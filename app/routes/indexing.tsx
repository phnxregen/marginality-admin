import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireUser } from "~/lib/auth.server";
import { getSupabaseClient } from "~/utils/getSupabaseClient";

type IndexingRunRow = {
  id: string;
  video_id: string;
  phase: string;
  status: string;
  error_message: string | null;
  duration_ms: number;
  cost_cents: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type BreakdownRow = {
  code: string;
  count: number;
};

type LaneRow = {
  lane: string;
  count: number;
};

type LoaderData = {
  totalIndexedVideos: number | null;
  totalIndexedVideosError?: string;
  reindexedVideos: number | null;
  reindexedVideosError?: string;
  failureBreakdown: BreakdownRow[];
  failureBreakdownError?: string;
  laneDistribution: LaneRow[];
  laneDistributionError?: string;
  recentRuns: IndexingRunRow[];
  recentRunsError?: string;
};

function normalizeErrorCode(errorMessage: string | null): string {
  if (!errorMessage) {
    return "UNKNOWN";
  }

  const upper = errorMessage.toUpperCase();
  if (upper.includes("NO_CAPTIONS") || upper.includes("NO CAPTIONS")) {
    return "NO_CAPTIONS";
  }
  if (upper.includes("PROXY_TIMEOUT") || upper.includes("PROXY TIMEOUT")) {
    return "PROXY_TIMEOUT";
  }
  if (upper.includes("WHISPER_FAILED") || upper.includes("WHISPER FAILED")) {
    return "WHISPER_FAILED";
  }

  const explicitCode = upper.match(/\b[A-Z][A-Z0-9_]{2,}\b/);
  if (explicitCode) {
    return explicitCode[0];
  }

  const compact = upper
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return compact || "UNKNOWN";
}

function extractLane(meta: Record<string, unknown> | null): string | null {
  if (!meta) {
    return null;
  }

  const laneValue =
    meta.lane ??
    meta.winning_lane ??
    (typeof meta.transcript === "object" && meta.transcript !== null
      ? (meta.transcript as Record<string, unknown>).lane
      : null);

  if (typeof laneValue !== "string" || !laneValue.trim()) {
    return null;
  }

  return laneValue.trim();
}

export const meta: MetaFunction = () => {
  return [{ title: "Indexing Ops | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const supabase = getSupabaseClient();

  let totalIndexedVideos: number | null = null;
  let totalIndexedVideosError: string | undefined;
  const indexedResult = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("indexing_status", "complete");
  if (indexedResult.error) {
    totalIndexedVideosError = indexedResult.error.message;
  } else {
    totalIndexedVideos = indexedResult.count ?? 0;
  }

  let recentRuns: IndexingRunRow[] = [];
  let recentRunsError: string | undefined;
  const recentRunsResult = await supabase
    .from("indexing_runs")
    .select(
      "id, video_id, phase, status, error_message, duration_ms, cost_cents, meta, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(25);
  if (recentRunsResult.error) {
    recentRunsError = recentRunsResult.error.message;
  } else {
    recentRuns = (recentRunsResult.data as IndexingRunRow[]) || [];
  }

  let reindexedVideos: number | null = null;
  let reindexedVideosError: string | undefined;
  const transcriptRunsResult = await supabase
    .from("indexing_runs")
    .select("video_id, meta")
    .eq("phase", "transcript_acquisition")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(5000);

  const laneDistribution: LaneRow[] = [];
  let laneDistributionError: string | undefined;

  if (transcriptRunsResult.error) {
    reindexedVideosError = transcriptRunsResult.error.message;
    laneDistributionError = transcriptRunsResult.error.message;
  } else {
    const runs = (transcriptRunsResult.data || []) as Array<{
      video_id: string;
      meta: Record<string, unknown> | null;
    }>;

    const runCountByVideo = new Map<string, number>();
    const latestLaneByVideo = new Map<string, string>();

    for (const run of runs) {
      runCountByVideo.set(run.video_id, (runCountByVideo.get(run.video_id) || 0) + 1);

      if (!latestLaneByVideo.has(run.video_id)) {
        const lane = extractLane(run.meta);
        if (lane) {
          latestLaneByVideo.set(run.video_id, lane);
        }
      }
    }

    reindexedVideos = Array.from(runCountByVideo.values()).filter((count) => count > 1)
      .length;

    const laneCounts = new Map<string, number>();
    for (const lane of latestLaneByVideo.values()) {
      laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
    }

    const sortedLanes = Array.from(laneCounts.entries())
      .map(([lane, count]) => ({ lane, count }))
      .sort((a, b) => b.count - a.count);

    if (sortedLanes.length > 0) {
      laneDistribution.push(...sortedLanes);
    } else {
      laneDistributionError = "Lane data is not present in indexing_runs.meta";
    }
  }

  let failureBreakdown: BreakdownRow[] = [];
  let failureBreakdownError: string | undefined;
  const failedRunsResult = await supabase
    .from("indexing_runs")
    .select("error_message")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (failedRunsResult.error) {
    failureBreakdownError = failedRunsResult.error.message;
  } else {
    const counts = new Map<string, number>();
    for (const row of failedRunsResult.data || []) {
      const code = normalizeErrorCode((row as { error_message: string | null }).error_message);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    failureBreakdown = Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  return Response.json({
    totalIndexedVideos,
    totalIndexedVideosError,
    reindexedVideos,
    reindexedVideosError,
    failureBreakdown,
    failureBreakdownError,
    laneDistribution,
    laneDistributionError,
    recentRuns,
    recentRunsError,
  } as LoaderData);
}

export default function IndexingOpsPage() {
  const data = useLoaderData<LoaderData>();

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Indexing Ops</h1>
          <p className="text-sm text-slate-600">
            Monitor indexing throughput, quality, and failures.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="p-5 bg-white rounded-lg shadow">
            <p className="text-sm font-medium text-slate-500">Total Indexed Videos</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {data.totalIndexedVideos === null
                ? "N/A"
                : data.totalIndexedVideos.toLocaleString()}
            </p>
            {data.totalIndexedVideosError && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
                Data unavailable: {data.totalIndexedVideosError}
              </p>
            )}
          </div>

          <div className="p-5 bg-white rounded-lg shadow">
            <p className="text-sm font-medium text-slate-500">Reindexed Videos</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {data.reindexedVideos === null ? "N/A" : data.reindexedVideos.toLocaleString()}
            </p>
            {data.reindexedVideosError && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
                Data unavailable: {data.reindexedVideosError}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="p-5 bg-white rounded-lg shadow">
            <h2 className="text-lg font-semibold text-slate-900">Failure Breakdown</h2>
            {data.failureBreakdownError ? (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
                Data unavailable: {data.failureBreakdownError}
              </p>
            ) : data.failureBreakdown.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No failed runs recorded.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.failureBreakdown.map((row) => (
                  <div
                    key={row.code}
                    className="flex items-center justify-between p-2 rounded-md bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-700">{row.code}</span>
                    <span className="text-sm text-slate-600">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-5 bg-white rounded-lg shadow">
            <h2 className="text-lg font-semibold text-slate-900">Lane Distribution</h2>
            {data.laneDistributionError ? (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
                Data unavailable: {data.laneDistributionError}
              </p>
            ) : data.laneDistribution.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No lane values detected yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.laneDistribution.map((row) => (
                  <div
                    key={row.lane}
                    className="flex items-center justify-between p-2 rounded-md bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-700">{row.lane}</span>
                    <span className="text-sm text-slate-600">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 overflow-auto bg-white rounded-lg shadow">
          <h2 className="text-lg font-semibold text-slate-900">Recent Indexing Activity</h2>
          {data.recentRunsError ? (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-md p-2">
              Data unavailable: {data.recentRunsError}
            </p>
          ) : data.recentRuns.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No indexing activity found.</p>
          ) : (
            <table className="min-w-full mt-3 text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Created
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Video
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Phase
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Duration
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {run.video_id}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{run.phase}</td>
                    <td className="px-3 py-2 text-slate-700">{run.status}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {Math.round(run.duration_ms / 1000)}s
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {run.cost_cents === null ? "N/A" : `$${(run.cost_cents / 100).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
