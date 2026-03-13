import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";

import { requireAdmin } from "~/lib/admin.server";
import { assessIndexingTestRun } from "~/lib/indexing-test-qualification";
import {
  createIndexingFixtureFromRun,
  getIndexingTestLogs,
  getIndexingTestOutputs,
  getIndexingTestTranscriptDebug,
  getIndexingTestRun,
  type IndexingTestLogRow,
  type IndexingTestOutputRow,
  type IndexingTestTranscriptDebugRow,
  type IndexingTestRunRow,
} from "~/lib/indexing-testing.server";

type LoaderData = {
  run: IndexingTestRunRow;
  outputs: IndexingTestOutputRow | null;
  logs: IndexingTestLogRow[];
  transcriptDebug: IndexingTestTranscriptDebugRow | null;
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

function parseTags(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim().length === 0) return "—";
  return String(value);
}

function buildRunExportMarkdown(input: {
  run: IndexingTestRunRow;
  outputs: IndexingTestOutputRow | null;
  logs: IndexingTestLogRow[];
  transcriptDebug: IndexingTestTranscriptDebugRow | null;
}) {
  const { run, outputs, logs, transcriptDebug } = input;
  const assessment = assessIndexingTestRun(run);
  const transcriptJson = outputs?.transcript_json ?? { occurrences: [] };
  const ocrJson = outputs?.ocr_json ?? { occurrences: [] };
  const transcriptDebugJson = transcriptDebug?.payload ?? null;
  const logsMarkdown = logs.length
    ? logs
      .map((log, index) => {
        const lines = [
          `### ${index + 1}. ${new Date(log.t).toISOString()} | ${log.level.toUpperCase()} | ${log.msg}`,
        ];
        if (log.data) {
          lines.push("", "```json", prettyJson(log.data), "```");
        }
        return lines.join("\n");
      })
      .join("\n\n")
    : "_No logs found._";

  return [
    "# Indexing Test Run Export",
    "",
    "## Run",
    `- Run ID: ${run.id}`,
    `- Created At: ${new Date(run.created_at).toISOString()}`,
    `- Updated At: ${new Date(run.updated_at).toISOString()}`,
    `- Status: ${run.status}`,
    `- Run Mode: ${run.run_mode}`,
    `- YouTube URL: ${run.youtube_url}`,
    `- YouTube Video ID: ${run.youtube_video_id}`,
    `- Source Video ID: ${displayValue(run.source_video_id)}`,
    `- Requested By User ID: ${displayValue(run.requested_by_user_id)}`,
    `- Indexing Run ID: ${displayValue(run.indexing_run_id)}`,
    "",
    "## Metrics",
    `- Transcript Count: ${run.transcript_count}`,
    `- OCR Count: ${run.ocr_count}`,
    `- Transcript Source: ${displayValue(run.transcript_source)}`,
    `- Lane Used: ${displayValue(run.lane_used)}`,
    `- Duration (ms): ${displayValue(run.duration_ms)}`,
    `- Contract Version: ${displayValue(run.contract_version)}`,
    `- Pipeline Version: ${displayValue(run.pipeline_version)}`,
    "",
    "## Qualification",
    `- Result: ${assessment.label}`,
    `- Summary: ${assessment.summary}`,
    `- Fixture Eligible: ${assessment.canCreateFixture ? "yes" : "no"}`,
    ...assessment.reasons.map((reason) => `- Reason: ${reason}`),
    "",
    "## Error",
    `- Error Code: ${displayValue(run.error_code)}`,
    `- Error Message: ${displayValue(run.error_message)}`,
    "",
    "## Logs",
    logsMarkdown,
    "",
    "## Transcript JSON",
    "```json",
    prettyJson(transcriptJson),
    "```",
    "",
    "## OCR JSON",
    "```json",
    prettyJson(ocrJson),
    "```",
    ...(transcriptDebug
      ? [
        "",
        "## Transcript Debug",
        `- Artifact ID: ${transcriptDebug.id}`,
        `- Created At: ${new Date(transcriptDebug.created_at).toISOString()}`,
        `- Indexing Run ID: ${transcriptDebug.indexing_run_id}`,
        "",
        "```json",
        prettyJson(transcriptDebugJson),
        "```",
      ]
      : []),
  ].join("\n");
}

async function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const run = await getIndexingTestRun(runId);

  if (!run) {
    throw new Response("Run not found", { status: 404 });
  }

  const [outputs, logs, transcriptDebug] = await Promise.all([
    getIndexingTestOutputs(runId),
    getIndexingTestLogs(runId),
    getIndexingTestTranscriptDebug(run),
  ]);

  return Response.json({ run, outputs, logs, transcriptDebug } as LoaderData);
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    return Response.json({ error: "Run ID is required." } as ActionData, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "save_fixture") {
    return Response.json({ error: "Unsupported action." } as ActionData, { status: 400 });
  }

  const nameValue = formData.get("name");
  const notesValue = formData.get("notes");
  const tagsValue = formData.get("tags");
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  const notes = typeof notesValue === "string" ? notesValue.trim() : "";

  if (!name) {
    return Response.json({ error: "Fixture name is required." } as ActionData, { status: 400 });
  }

  try {
    const run = await getIndexingTestRun(runId);
    if (!run) {
      return Response.json({ error: "Run not found." } as ActionData, { status: 404 });
    }

    const assessment = assessIndexingTestRun(run);
    if (!assessment.canCreateFixture) {
      return Response.json(
        { error: `Run is not fixture-eligible: ${assessment.summary}` } as ActionData,
        { status: 400 }
      );
    }

    const fixture = await createIndexingFixtureFromRun({
      testRunId: runId,
      name,
      notes: notes || null,
      tags: parseTags(typeof tagsValue === "string" ? tagsValue : null),
    });

    return redirect(`/admin/indexing-testing/fixtures/${fixture.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save fixture.";
    return Response.json({ error: message } as ActionData, { status: 500 });
  }
}

export default function IndexingTestRunDetailRoute() {
  const { run, outputs, logs, transcriptDebug } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";

  const transcriptJson = outputs?.transcript_json ?? { occurrences: [] };
  const ocrJson = outputs?.ocr_json ?? { occurrences: [] };
  const transcriptJsonText = prettyJson(transcriptJson);
  const ocrJsonText = prettyJson(ocrJson);
  const transcriptDebugText = transcriptDebug ? prettyJson(transcriptDebug.payload) : "";
  const runExportMarkdown = buildRunExportMarkdown({ run, outputs, logs, transcriptDebug });
  const assessment = assessIndexingTestRun(run);
  const fixtureBlocked = !assessment.canCreateFixture;

  useEffect(() => {
    if (run.status !== "processing") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [revalidator, run.status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Run Detail</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copyToClipboard(runExportMarkdown)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy Run
          </button>
          <Link
            to="/admin/indexing-testing"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back to Runs
          </Link>
          <a
            href={`/admin/indexing-testing/runs/${run.id}/transcript.json`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Download Transcript JSON
          </a>
          <a
            href={`/admin/indexing-testing/runs/${run.id}/ocr.json`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Download OCR JSON
          </a>
          {transcriptDebug && (
            <a
              href={`/admin/indexing-testing/runs/${run.id}/transcript-debug.json`}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Download Transcript Debug
            </a>
          )}
        </div>
      </div>

      <section className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Qualification</p>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${assessmentClasses(assessment.state)}`}
              >
                {assessment.label}
              </span>
              <p className="text-sm text-slate-700">{assessment.summary}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {run.run_mode === "personal"
            ? `This run targets personal app visibility for user ${run.requested_by_user_id || "—"}.`
            : "This run is diagnostic-only and should not be treated as a user-visible personal indexing result."}
        </div>
        {assessment.reasons.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            {assessment.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <p className="mt-2 text-lg font-semibold capitalize text-slate-900">{run.status}</p>
          <p className="mt-2 text-sm text-slate-600">Run mode: {run.run_mode}</p>
          <p className="mt-1 text-sm text-slate-600">Video ID: {run.youtube_video_id}</p>
          <p className="mt-1 break-all text-sm text-slate-600">
            Requested by: {run.requested_by_user_id || "—"}
          </p>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Metrics</p>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between">
              <dt>Transcript Count</dt>
              <dd>{run.transcript_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt>OCR Count</dt>
              <dd>{run.ocr_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Transcript Source</dt>
              <dd>{run.transcript_source || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Lane Used</dt>
              <dd>{run.lane_used || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Duration</dt>
              <dd>{run.duration_ms ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Error</p>
          <p className="mt-2 text-sm text-slate-700">{run.error_code || "—"}</p>
          <p className="mt-1 text-sm text-slate-700">{run.error_message || "—"}</p>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Logs</h3>
          <span className="text-xs uppercase tracking-wide text-slate-500">{logs.length} rows</span>
        </div>
        {logs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No logs found.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="uppercase">{log.level}</span>
                  <span>{new Date(log.t).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800">{log.msg}</p>
                {log.data && (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                    {prettyJson(log.data)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Transcript JSON</h3>
            <button
              type="button"
              onClick={() => copyToClipboard(transcriptJsonText)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
            {transcriptJsonText}
          </pre>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">OCR JSON</h3>
            <button
              type="button"
              onClick={() => copyToClipboard(ocrJsonText)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
            {ocrJsonText}
          </pre>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Transcript Debug</h3>
            <p className="mt-1 text-sm text-slate-600">
              Raw transcript segments and chunk-level upstream debug captured from the app pipeline.
            </p>
          </div>
          {transcriptDebug && (
            <button
              type="button"
              onClick={() => copyToClipboard(transcriptDebugText)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Copy
            </button>
          )}
        </div>
        {transcriptDebug ? (
          <>
            <dl className="mb-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Artifact ID</dt>
                <dd className="mt-1 break-all">{transcriptDebug.id}</dd>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Indexing Run ID</dt>
                <dd className="mt-1 break-all">{transcriptDebug.indexing_run_id}</dd>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Created</dt>
                <dd className="mt-1">{new Date(transcriptDebug.created_at).toLocaleString()}</dd>
              </div>
            </dl>
            <pre className="max-h-[32rem] overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
              {transcriptDebugText}
            </pre>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            No `transcript_debug` artifact was found for this run yet.
          </p>
        )}
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <h3 className="text-base font-semibold text-slate-900">Save as Fixture</h3>
        <p className="mt-1 text-sm text-slate-600">
          Persist this run&apos;s outputs as a golden fixture for future regression checks.
        </p>
        {fixtureBlocked && (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Fixture creation is disabled because this run is not qualifying. {assessment.summary}
          </div>
        )}

        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="save_fixture" />
          {actionData?.error && (
            <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{actionData.error}</div>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Fixture Name</span>
            <input
              name="name"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder={`Fixture ${run.youtube_video_id}`}
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Tags (comma-separated)</span>
            <input
              name="tags"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="sermon, regression, lane2"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea
              name="notes"
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting || fixtureBlocked}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Save Fixture"}
          </button>
        </Form>
      </section>
    </div>
  );
}
