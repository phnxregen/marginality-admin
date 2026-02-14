import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingTestOutputs } from "~/lib/indexing-testing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const outputs = await getIndexingTestOutputs(runId);
  if (!outputs) {
    throw new Response("OCR output not found for run", { status: 404 });
  }

  return new Response(JSON.stringify(outputs.ocr_json ?? {}, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-test-run-${runId}-ocr.json"`,
      "Cache-Control": "no-store",
    },
  });
}
