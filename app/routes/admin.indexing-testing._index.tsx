import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";

import { requireAdmin } from "~/lib/admin.server";
import { assessIndexingTestRun } from "~/lib/indexing-test-qualification";
import {
  listIndexingTestRuns,
  startIndexingTestRun,
  type IndexingTestRunRow,
} from "~/lib/indexing-testing.server";

type LoaderData = {
  runs: IndexingTestRunRow[];
  currentUser: {
    id: string;
    email?: string;
  };
};

type ActionData = {
  error?: string;
};

function assessmentClasses(state: ReturnType<typeof assessIndexingTestRun>["state"]): string {
  switch (state) {
    case "qualifying":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-rose-50 text-rose-700";
    case "stale_processing":
      return "bg-amber-100 text-amber-900";
    case "processing":
      return "bg-sky-50 text-sky-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

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
  const user = await requireAdmin(request);
  const runs = await listIndexingTestRuns(50);
  return Response.json({
    runs,
    currentUser: {
      id: user.id,
      email: user.email,
    },
  } as LoaderData);
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

  const runModeValue = formData.get("runMode");
  const runMode =
    runModeValue === "personal" || runModeValue === "admin_test"
      ? runModeValue
      : "personal";

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
  const { runs, currentUser } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";
  const assessedRuns = runs.map((run) => ({
    run,
    assessment: assessIndexingTestRun(run),
  }));
  const hasProcessingRuns = runs.some((run) => run.status === "processing");

  useEffect(() => {
    if (!hasProcessingRuns) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [hasProcessingRuns, revalidator]);

  return (
    <div className="space-y-8">
      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-slate-900">Create Run</h2>
        <p className="mt-1 text-sm text-slate-600">
          Personal indexing is the default path. Use `admin_test` only when you want pipeline
          diagnostics without treating the run as user-visible app content.
        </p>

        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p className="font-medium">Personal attribution</p>
          <p className="mt-1">
            Personal runs are attached to the currently signed-in admin user and are the main way to
            validate app-visible indexing.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-sky-800">
            {currentUser.email || currentUser.id}
          </p>
        </div>

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
              <span className="font-medium text-slate-700">Run Mode</span>
              <select
                name="runMode"
                defaultValue="personal"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="personal">personal (app-visible path)</option>
                <option value="admin_test">admin_test (diagnostics only)</option>
              </select>
            </label>

            <div className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Partner Channel</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                Legacy concept. Not used for the current personal-content strategy.
              </div>
            </div>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Operator guidance</p>
            <p className="mt-1">
              Use `personal` when you want to verify that a specific user should see the indexed
              video in the app. Use `admin_test` only to inspect pipeline behavior.
            </p>
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
                  <th className="px-3 py-2">Requested By</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Qualification</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Transcript</th>
                  <th className="px-3 py-2">OCR</th>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assessedRuns.map(({ run, assessment }) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 text-slate-600">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">
                      {run.youtube_video_id}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {run.requested_by_user_id || "—"}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-700">{run.status}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium ${assessmentClasses(assessment.state)}`}
                        >
                          {assessment.label}
                        </span>
                        <span className="text-xs text-slate-500">{assessment.summary}</span>
                      </div>
                    </td>
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
