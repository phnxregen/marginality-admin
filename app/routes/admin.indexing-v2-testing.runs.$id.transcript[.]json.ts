import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingV2TranscriptArtifact } from "~/lib/indexing-v2-testing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const transcriptArtifact = await getIndexingV2TranscriptArtifact(runId);
  if (!transcriptArtifact) {
    throw new Response("Transcript artifact not found for run", { status: 404 });
  }

  return new Response(JSON.stringify(transcriptArtifact.payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-v2-run-${runId}-transcript.json"`,
      "Cache-Control": "no-store",
    },
  });
}
