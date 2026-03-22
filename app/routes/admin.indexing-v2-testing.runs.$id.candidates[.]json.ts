import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingV2Candidates } from "~/lib/indexing-v2-testing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const candidates = await getIndexingV2Candidates(runId);
  return new Response(JSON.stringify(candidates, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-v2-run-${runId}-candidates.json"`,
      "Cache-Control": "no-store",
    },
  });
}
