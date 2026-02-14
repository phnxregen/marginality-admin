import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { requireAdmin } from "~/lib/admin.server";
import {
  listIndexingTestRuns,
  startIndexingTestRun,
  type IndexingTestRunRow,
} from "~/lib/indexing-testing.server";

type LoaderData = {
  runs: IndexingTestRunRow[];
};

type ActionData = {
  error?: string;
};

function parseBoolean(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

function parseInteger(
  formData: FormData,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseOcrOverride(input: string): Array<{ t: string; text: string }> {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: Array<{ t: string; text: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(\d{1,2}:\d{2})\s*\|\s*(.+)$/);
    if (!match) {
      throw new Error(`Invalid OCR override format on line ${index + 1}`);
    }

    parsed.push({
      t: match[1],
      text: match[2].trim(),
    });
  }

  return parsed;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runs = await listIndexingTestRuns(50);
  return Response.json({ runs } as LoaderData);
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireAdmin(request);
  const formData = await request.formData();

  const youtubeUrlValue = formData.get("youtubeUrl");
  const youtubeUrl = typeof youtubeUrlValue === "string" ? youtubeUrlValue.trim() : "";
  if (!youtubeUrl) {
    return Response.json({ error: "youtubeUrl is required." } as ActionData, { status: 400 });
  }

  const sourceVideoIdValue = formData.get("sourceVideoId");
  const sourceVideoId =
    typeof sourceVideoIdValue === "string" && sourceVideoIdValue.trim()
      ? sourceVideoIdValue.trim()
      : undefined;

  const partnerChannelIdValue = formData.get("partnerChannelId");
  const partnerChannelId =
    typeof partnerChannelIdValue === "string" && partnerChannelIdValue.trim()
      ? partnerChannelIdValue.trim()
      : undefined;

  const runModeValue = formData.get("runMode");
  const runMode =
    runModeValue === "public" || runModeValue === "personal" || runModeValue === "admin_test"
      ? runModeValue
      : "admin_test";

  const enableOcr = parseBoolean(formData, "enableOcr");
  const explicitReindex = parseBoolean(formData, "explicitReindex");
  const useCacheOnly = parseBoolean(formData, "useCacheOnly");

  const options: Record<string, unknown> = {
    enableOcr,
    explicitReindex,
    useCacheOnly,
    allowLanes: {
      lane1: parseBoolean(formData, "lane1"),
      lane2: parseBoolean(formData, "lane2"),
      lane3: parseBoolean(formData, "lane3"),
      lane4: parseBoolean(formData, "lane4"),
    },
    chunkMinutes: parseInteger(formData, "chunkMinutes", 7, 1, 60),
    chunkOverlapSeconds: parseInteger(formData, "chunkOverlapSeconds", 15, 0, 120),
  };

  const ocrOverrideInput = formData.get("ocrOverride");
  if (enableOcr && typeof ocrOverrideInput === "string" && ocrOverrideInput.trim().length > 0) {
    try {
      const parsedOverride = parseOcrOverride(ocrOverrideInput);
      if (parsedOverride.length > 0) {
        options.ocrRawSegmentsOverride = parsedOverride;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid OCR override";
      return Response.json({ error: message } as ActionData, { status: 400 });
    }
  }

  try {
    const result = await startIndexingTestRun(user.accessToken, {
      youtubeUrl,
      sourceVideoId,
      partnerChannelId,
      runMode,
      requestedByUserId: runMode === "personal" ? user.id : undefined,
      options,
    });

    return redirect(`/admin/indexing-testing/runs/${result.testRunId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start test run.";
    return Response.json({ error: message } as ActionData, { status: 500 });
  }
}

export default function IndexingTestingIndexRoute() {
  const { runs } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="space-y-8">
      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-slate-900">Create Run</h2>
        <p className="mt-1 text-sm text-slate-600">
          Start a new indexing run with explicit options for lane and OCR behavior.
        </p>

        <Form method="post" className="mt-6 space-y-4">
          {actionData?.error && (
            <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{actionData.error}</div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">YouTube URL</span>
              <input
                name="youtubeUrl"
                required
                type="url"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Source Video ID (optional)</span>
              <input
                name="sourceVideoId"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="internal source video id"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Partner Channel ID (optional)</span>
              <input
                name="partnerChannelId"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="required by some index_video flows"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Run Mode</span>
              <select
                name="runMode"
                defaultValue="admin_test"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="admin_test">admin_test</option>
                <option value="public">public</option>
                <option value="personal">personal</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="enableOcr" defaultChecked className="h-4 w-4" />
              Enable OCR
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="explicitReindex" defaultChecked className="h-4 w-4" />
              Explicit Reindex
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="useCacheOnly" className="h-4 w-4" />
              Use Cache Only
            </label>
          </div>

          <div className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-4">
            <p className="md:col-span-4 text-sm font-medium text-slate-700">Allow Lanes</p>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="lane1" defaultChecked className="h-4 w-4" />
              lane1
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="lane2" defaultChecked className="h-4 w-4" />
              lane2
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="lane3" defaultChecked className="h-4 w-4" />
              lane3
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="lane4" defaultChecked className="h-4 w-4" />
              lane4
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Chunk Minutes</span>
              <input
                name="chunkMinutes"
                type="number"
                min={1}
                max={60}
                defaultValue={7}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Chunk Overlap Seconds</span>
              <input
                name="chunkOverlapSeconds"
                type="number"
                min={0}
                max={120}
                defaultValue={15}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">OCR Override (optional)</span>
            <textarea
              name="ocrOverride"
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder={"12:35 | ROMANS 8:1-4\n12:40 | John 3:16"}
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Starting..." : "Start Run"}
          </button>
        </Form>
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Runs</h2>
          <span className="text-xs uppercase tracking-wide text-slate-500">Latest 50</span>
        </div>

        {runs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No runs found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Video ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Transcript</th>
                  <th className="px-3 py-2">OCR</th>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 text-slate-600">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">
                      {run.youtube_video_id}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-700">{run.status}</td>
                    <td className="px-3 py-2 text-slate-700">{run.run_mode}</td>
                    <td className="px-3 py-2 text-slate-700">{run.transcript_count}</td>
                    <td className="px-3 py-2 text-slate-700">{run.ocr_count}</td>
                    <td className="px-3 py-2 text-slate-700">{run.lane_used || "—"}</td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/admin/indexing-testing/runs/${run.id}`}
                        className="text-cyan-700 hover:text-cyan-900"
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
      </section>
    </div>
  );
}
