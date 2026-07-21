import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";
import {
  listAdminUsers,
  type AdminUserBillingSummary,
  type AdminUserListItem,
} from "~/lib/admin-users.server";

type LoaderData = {
  users: AdminUserListItem[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
  query: string;
  error: string | null;
};

export const meta: MetaFunction = () => {
  return [{ title: "Users | Marginality Admin" }];
};

function readPositiveInteger(
  searchParams: URLSearchParams,
  name: string,
  fallback: number
): number {
  const value = Number.parseInt(searchParams.get(name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatActivityMeta(user: AdminUserListItem): string | null {
  const values = [
    user.activity.platform,
    user.activity.appVersion,
    user.activity.event,
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" · ") : null;
}

function billingStatusClasses(billing: AdminUserBillingSummary): string {
  if (billing.hasPlus) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }
  if (billing.status === "past_due" || billing.status === "billing_retry") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }
  if (billing.status === "revoked" || billing.status === "canceled") {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }
  return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
}

function pageLink(
  searchParams: URLSearchParams,
  page: number
): string {
  const nextParams = new URLSearchParams(searchParams);
  nextParams.set("page", String(page));
  return `/admin/users?${nextParams.toString()}`;
}

function billingHref(user: AdminUserListItem): string {
  const account = user.email ?? user.id;
  return `/admin/billing?email=${encodeURIComponent(account)}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const page = readPositiveInteger(url.searchParams, "page", 1);
  const perPage = readPositiveInteger(url.searchParams, "perPage", 25);
  const query = url.searchParams.get("q")?.trim() ?? "";

  const result = await listAdminUsers({ page, perPage, query });
  return Response.json(result as LoaderData);
}

export default function AdminUsersRoute() {
  const { users, page, perPage, hasNextPage, query, error } =
    useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();
  const previousPage = Math.max(1, page - 1);

  return (
    <AdminShell maxWidthClassName="max-w-7xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
          <p className="text-sm text-slate-600">
            Find app accounts, review Marginality+ state, and jump directly into billing for the
            selected user.
          </p>
        </div>

        <section className="rounded-lg bg-white p-6 shadow">
          <Form
            method="get"
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-end"
          >
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Search users</span>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="email or user id"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Rows</span>
              <select
                name="perPage"
                defaultValue={String(perPage)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              >
                {[25, 50, 100].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700"
            >
              Search
            </button>
          </Form>
        </section>

        {error ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">User data is incomplete</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : null}

        <section className="rounded-lg bg-white shadow">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <p className="text-sm text-slate-600">
              Page {page.toLocaleString()} · {users.length.toLocaleString()} users shown
            </p>
            <div className="flex items-center gap-2">
              <Link
                to={pageLink(searchParams, previousPage)}
                aria-disabled={page <= 1}
                className={`rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset ${
                  page <= 1
                    ? "pointer-events-none text-slate-400 ring-slate-200"
                    : "text-slate-700 ring-slate-300 hover:bg-slate-50"
                }`}
              >
                Previous
              </Link>
              <Link
                to={pageLink(searchParams, page + 1)}
                aria-disabled={!hasNextPage}
                className={`rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset ${
                  !hasNextPage
                    ? "pointer-events-none text-slate-400 ring-slate-200"
                    : "text-slate-700 ring-slate-300 hover:bg-slate-50"
                }`}
              >
                Next
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-4 pr-4">Account</th>
                  <th className="py-3 pr-4">Billing</th>
                  <th className="py-3 pr-4">Provider</th>
                  <th className="py-3 pr-4">Period end</th>
                  <th className="py-3 pr-4">Last active</th>
                  <th className="py-3 pr-4">Last auth sign-in</th>
                  <th className="py-3 pr-4">Created</th>
                  <th className="py-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => {
                  const activityMeta = formatActivityMeta(user);
                  return (
                    <tr key={user.id} className="align-top">
                      <td className="py-4 pl-4 pr-4">
                        <p className="break-all font-medium text-slate-900">
                          {user.email ?? "No email"}
                        </p>
                        <p className="mt-1 break-all text-xs text-slate-500">{user.id}</p>
                      </td>
                      <td className="py-4 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${billingStatusClasses(
                            user.billing
                          )}`}
                        >
                          {user.billing.hasPlus ? "Active" : user.billing.status}
                        </span>
                        {user.billing.cancelAtPeriodEnd ? (
                          <p className="mt-2 text-xs text-amber-700">
                            Cancels at period end
                          </p>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4 text-slate-700">{user.billing.provider}</td>
                      <td className="py-4 pr-4 text-slate-600">
                        {formatDateTime(user.billing.currentPeriodEnd)}
                      </td>
                      <td className="py-4 pr-4 text-slate-600">
                        <p>{formatDateTime(user.activity.lastSeenAt)}</p>
                        {activityMeta ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {activityMeta}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4 text-slate-600">
                        {formatDateTime(user.lastSignInAt)}
                      </td>
                      <td className="py-4 pr-4 text-slate-600">
                        {formatDateTime(user.createdAt)}
                      </td>
                      <td className="py-4 pr-4 text-right">
                        <Link
                          to={billingHref(user)}
                          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                        >
                          Manage billing
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No users found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
