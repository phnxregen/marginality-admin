import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { requireAdmin } from "~/lib/admin.server";
import { listIndexingFixtures, type IndexingTestFixtureRow } from "~/lib/indexing-testing.server";

type LoaderData = {
  fixtures: IndexingTestFixtureRow[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const fixtures = await listIndexingFixtures(50);
  return Response.json({ fixtures } as LoaderData);
}

export default function IndexingFixturesRoute() {
  const { fixtures } = useLoaderData<LoaderData>();

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Fixtures</h2>
        <span className="text-xs uppercase tracking-wide text-slate-500">Latest 50</span>
      </div>

      {fixtures.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No fixtures yet. Open a run and use “Save as Fixture.”
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Video ID</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fixtures.map((fixture) => (
                <tr key={fixture.id}>
                  <td className="px-3 py-2 text-slate-800">{fixture.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">
                    {fixture.youtube_video_id}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {new Date(fixture.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {fixture.tags.length ? fixture.tags.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/admin/indexing-testing/fixtures/${fixture.id}`}
                      className="text-cyan-700 hover:text-cyan-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
