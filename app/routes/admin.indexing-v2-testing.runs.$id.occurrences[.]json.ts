import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingV2Occurrences } from "~/lib/indexing-v2-testing.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const occurrences = await getIndexingV2Occurrences(runId);
  return new Response(JSON.stringify(occurrences, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="indexing-v2-run-${runId}-occurrences.json"`,
      "Cache-Control": "no-store",
    },
  });
}
