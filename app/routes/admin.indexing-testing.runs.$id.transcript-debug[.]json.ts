import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingTestRun, getIndexingTestTranscriptDebug } from "~/lib/indexing-testing.server";

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

  const transcriptDebug = await getIndexingTestTranscriptDebug(run);
  if (!transcriptDebug) {
    throw new Response("Transcript debug output not found for run", { status: 404 });
  }

  return new Response(JSON.stringify(transcriptDebug.payload ?? {}, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-test-run-${runId}-transcript-debug.json"`,
      "Cache-Control": "no-store",
    },
  });
}
