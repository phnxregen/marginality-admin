import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { requireAdmin } from "~/lib/admin.server";
import {
  getIndexingFixture,
  startIndexingTestRun,
  type IndexingTestFixtureRow,
} from "~/lib/indexing-testing.server";

type LoaderData = {
  fixture: IndexingTestFixtureRow;
};

type ActionData = {
  error?: string;
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const fixtureId = params.id;
  if (!fixtureId) {
    throw new Response("Fixture ID is required", { status: 400 });
  }

  const fixture = await getIndexingFixture(fixtureId);
  if (!fixture) {
    throw new Response("Fixture not found", { status: 404 });
  }

  return Response.json({ fixture } as LoaderData);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireAdmin(request);
  const fixtureId = params.id;
  if (!fixtureId) {
    return Response.json({ error: "Fixture ID is required." } as ActionData, { status: 400 });
  }

  const fixture = await getIndexingFixture(fixtureId);
  if (!fixture) {
    return Response.json({ error: "Fixture not found." } as ActionData, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "run_fixture") {
    return Response.json({ error: "Unsupported action." } as ActionData, { status: 400 });
  }

  try {
    const result = await startIndexingTestRun(user.accessToken, {
      youtubeUrl: fixture.youtube_url,
      runMode: "admin_test",
      options: {
        explicitReindex: true,
        enableOcr: true,
        useCacheOnly: false,
        allowLanes: {
          lane1: true,
          lane2: true,
          lane3: true,
          lane4: true,
        },
        chunkMinutes: 7,
        chunkOverlapSeconds: 15,
      },
    });

    return redirect(`/admin/indexing-testing/runs/${result.testRunId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run fixture.";
    return Response.json({ error: message } as ActionData, { status: 500 });
  }
}

export default function IndexingFixtureDetailRoute() {
  const { fixture } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{fixture.name}</h2>
          <p className="mt-1 text-sm text-slate-600">
            YouTube ID: <span className="font-mono">{fixture.youtube_video_id}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/admin/indexing-testing/fixtures"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back to Fixtures
          </Link>
          <Form method="post">
            <input type="hidden" name="intent" value="run_fixture" />
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Running..." : "Run Against Fixture"}
            </button>
          </Form>
        </div>
      </div>

      {actionData?.error && (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{actionData.error}</div>
      )}

      <section className="rounded-lg bg-white p-4 shadow">
        <h3 className="text-base font-semibold text-slate-900">Fixture Metadata</h3>
        <dl className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Created</dt>
            <dd>{new Date(fixture.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Contract Version</dt>
            <dd>{fixture.contract_version}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Pipeline Version</dt>
            <dd>{fixture.pipeline_version || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Tags</dt>
            <dd>{fixture.tags.length ? fixture.tags.join(", ") : "—"}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">URL</dt>
            <dd className="break-all">{fixture.youtube_url}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Notes</dt>
            <dd>{fixture.notes || "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="text-base font-semibold text-slate-900">Expected Transcript JSON</h3>
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
            {prettyJson(fixture.expected_transcript_json)}
          </pre>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="text-base font-semibold text-slate-900">Expected OCR JSON</h3>
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
            {prettyJson(fixture.expected_ocr_json)}
          </pre>
        </div>
      </section>
    </div>
  );
}
