import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { requireAdmin } from "~/lib/admin.server";
import {
  createIndexingFixtureFromRun,
  getIndexingTestLogs,
  getIndexingTestOutputs,
  getIndexingTestRun,
  type IndexingTestLogRow,
  type IndexingTestOutputRow,
  type IndexingTestRunRow,
} from "~/lib/indexing-testing.server";

type LoaderData = {
  run: IndexingTestRunRow;
  outputs: IndexingTestOutputRow | null;
  logs: IndexingTestLogRow[];
};

type ActionData = {
  error?: string;
};

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

  const [run, outputs, logs] = await Promise.all([
    getIndexingTestRun(runId),
    getIndexingTestOutputs(runId),
    getIndexingTestLogs(runId),
  ]);

  if (!run) {
    throw new Response("Run not found", { status: 404 });
  }

  return Response.json({ run, outputs, logs } as LoaderData);
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
  const { run, outputs, logs } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const transcriptJson = outputs?.transcript_json ?? { occurrences: [] };
  const ocrJson = outputs?.ocr_json ?? { occurrences: [] };
  const transcriptJsonText = prettyJson(transcriptJson);
  const ocrJsonText = prettyJson(ocrJson);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Run Detail</h2>
        <div className="flex gap-2">
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
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <p className="mt-2 text-lg font-semibold capitalize text-slate-900">{run.status}</p>
          <p className="mt-2 text-sm text-slate-600">Run mode: {run.run_mode}</p>
          <p className="mt-1 text-sm text-slate-600">Video ID: {run.youtube_video_id}</p>
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

      <section className="rounded-lg bg-white p-6 shadow">
        <h3 className="text-base font-semibold text-slate-900">Save as Fixture</h3>
        <p className="mt-1 text-sm text-slate-600">
          Persist this run&apos;s outputs as a golden fixture for future regression checks.
        </p>

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
            disabled={isSubmitting}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Save Fixture"}
          </button>
        </Form>
      </section>
    </div>
  );
}
