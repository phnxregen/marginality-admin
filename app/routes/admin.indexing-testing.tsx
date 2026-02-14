import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { NavLink, Outlet } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";

export const meta: MetaFunction = () => {
  return [{ title: "Indexing Testing Center | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}

export default function AdminIndexingTestingLayout() {
  const navClassName = (active: boolean) =>
    [
      "rounded-md px-3 py-2 text-sm font-medium",
      active ? "bg-cyan-500 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
    ].join(" ");

  return (
    <AdminShell maxWidthClassName="max-w-6xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Indexing Testing Center</h1>
          <p className="mt-2 text-sm text-slate-600">
            Run controlled indexing tests, inspect logs and outputs, and manage fixtures.
          </p>
        </div>

        <div className="flex gap-2">
          <NavLink to="/admin/indexing-testing" end>
            {({ isActive }) => <span className={navClassName(isActive)}>Runs</span>}
          </NavLink>
          <NavLink to="/admin/indexing-testing/fixtures">
            {({ isActive }) => <span className={navClassName(isActive)}>Fixtures</span>}
          </NavLink>
        </div>

        <Outlet />
      </div>
    </AdminShell>
  );
}
