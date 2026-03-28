import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";

import { requireAdmin } from "~/lib/admin.server";
import {
  listIndexingV2Runs,
  startIndexingV2TestRun,
  type IndexingV2RunRow,
} from "~/lib/indexing-v2-testing.server";

type LoaderData = {
  runs: IndexingV2RunRow[];
  currentUser: {
    id: string;
    email?: string;
  };
};

type ActionData = {
  error?: string;
};

function parseBoolean(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

function statusClasses(status: IndexingV2RunRow["status"]): string {
  switch (status) {
    case "complete":
      return "bg-emerald-50 text-emerald-700";
    case "complete_with_warnings":
      return "bg-amber-100 text-amber-900";
    case "failed":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-sky-50 text-sky-700";
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAdmin(request);
  const runs = await listIndexingV2Runs(50);
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
    runModeValue === "personal" || runModeValue === "public" ? runModeValue : "admin_test";
  const transcriptOverrideTextValue = formData.get("transcriptOverrideText");
  const transcriptOverrideJsonValue = formData.get("transcriptOverrideJson");
  const transcriptOverrideText =
    typeof transcriptOverrideTextValue === "string" && transcriptOverrideTextValue.trim()
      ? transcriptOverrideTextValue.trim()
      : undefined;
  const transcriptOverrideJson =
    typeof transcriptOverrideJsonValue === "string" && transcriptOverrideJsonValue.trim()
      ? transcriptOverrideJsonValue.trim()
      : undefined;
  const ignoreUpstreamTranscriptCache = parseBoolean(formData, "ignoreUpstreamTranscriptCache");

  if (transcriptOverrideText && transcriptOverrideJson) {
    return Response.json(
      { error: "Provide either transcript override text or transcript override JSON, not both." } as ActionData,
      { status: 400 }
    );
  }

  try {
    const result = await startIndexingV2TestRun(user.accessToken, {
      youtubeUrl,
      sourceVideoId,
      runMode,
      requestedByUserId: runMode === "personal" ? user.id : undefined,
      transcriptOverrideText,
      transcriptOverrideJson,
      ignoreUpstreamTranscriptCache,
    });

    return redirect(`/admin/indexing-v2-testing/runs/${result.runId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start V2 test run.";
    return Response.json({ error: message } as ActionData, { status: 500 });
  }
}

export default function IndexingV2TestingIndexRoute() {
  const { runs, currentUser } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";
  const hasActiveRuns = runs.some(
    (run) =>
      run.status === "queued" ||
      run.status === "transcribing" ||
      run.status === "analyzing" ||
      run.status === "resolving"
  );

  useEffect(() => {
    if (!hasActiveRuns) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [hasActiveRuns, revalidator]);

  return (
    <div className="space-y-8">
      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-slate-900">Create V2 Run</h2>
        <p className="mt-1 text-sm text-slate-600">
          This prototype reuses cached upstream transcript context read-only or accepts transcript
          overrides, persists only into V2 tables, and generates ordered occurrences plus a
          machine-readable validation report. Timing is optional review metadata unless real
          alignment exists.
        </p>

        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p className="font-medium">Current admin identity</p>
          <p className="mt-1">
            Personal mode tags the run to the signed-in admin user for attribution only. It does not
            mutate shared app visibility or V1 indexing state.
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
                placeholder="shared source_video_id"
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
                <option value="personal">personal</option>
                <option value="public">public</option>
              </select>
            </label>

            <div className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Transcript Source</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                Prefer cached upstream transcript reuse. If no shared transcript already exists for
                this video, paste a transcript override below. This route does not perform fresh
                lane 1 or lane 2 transcript acquisition.
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Transcript Override Text (optional)</span>
              <textarea
                name="transcriptOverrideText"
                rows={8}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Paste plain transcript text here when upstream transcript context does not exist."
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Transcript Override JSON (optional)</span>
              <textarea
                name="transcriptOverrideJson"
                rows={10}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                placeholder='Paste timed JSON such as [{"start_ms":1234,"end_ms":5678,"text":"..."}] or {"segments":[...]}'
              />
            </label>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              Use only one override field. JSON is preferred when you have segment timing. Plain
              text will be segmented deterministically with approximate timing for admin review only.
              Timed JSON is treated as retimed transcript input for V2 timing evaluation, but it is
              still low-trust timing unless true alignment exists.
            </div>

            <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <input
                name="ignoreUpstreamTranscriptCache"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block font-medium text-slate-800">Ignore cached transcript reuse</span>
                <span className="mt-1 block text-slate-600">
                  Skip read-only upstream transcript reuse for this V2 prototype run. This does not
                  trigger lane 1 or lane 2 acquisition in the shared pipeline. Use it when you want
                  to force an override-driven run.
                </span>
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
          >
            {isSubmitting ? "Starting…" : "Start V2 Run"}
          </button>
        </Form>
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent Runs</h2>
            <p className="mt-1 text-sm text-slate-600">
              Occurrence-first V2 runs only. Validation warnings are persisted per run.
            </p>
          </div>
        </div>

        {runs.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            No V2 runs yet.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Video</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Timing</th>
                  <th className="px-3 py-2 font-medium">Counts</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClasses(run.status)}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div className="font-medium">{run.youtube_video_id}</div>
                      <div className="max-w-md truncate text-xs text-slate-500">{run.youtube_url}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{run.run_mode}</td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{run.timing_authority}</div>
                      <div className="text-xs text-slate-500">
                        confidence {run.timing_confidence?.toFixed(2) || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{run.occurrence_count} occurrences</div>
                      <div className="text-xs text-slate-500">
                        {run.candidate_count} candidates · {run.warning_count} warnings
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        to={`/admin/indexing-v2-testing/runs/${run.id}`}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Review
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
