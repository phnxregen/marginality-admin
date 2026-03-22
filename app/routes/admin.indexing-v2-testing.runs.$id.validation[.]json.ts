import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingV2ValidationReport } from "~/lib/indexing-v2-testing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const validation = await getIndexingV2ValidationReport(runId);
  if (!validation) {
    throw new Response("Validation report not found for run", { status: 404 });
  }

  return new Response(JSON.stringify(validation.report, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-v2-run-${runId}-validation.json"`,
      "Cache-Control": "no-store",
    },
  });
}
