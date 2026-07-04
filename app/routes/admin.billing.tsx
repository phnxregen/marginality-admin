import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";
import {
  manageSubscriptionEntitlement,
  type AdminEntitlementResponse,
  type ManualEntitlementAction,
} from "~/lib/entitlement-admin.server";

type LoaderData = {
  email: string;
  result: AdminEntitlementResponse | null;
  error: string | null;
};

type ActionData = {
  result: AdminEntitlementResponse | null;
  error: string | null;
};

const GRANT_DAYS_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "1 year", value: 365 },
];

export const meta: MetaFunction = () => {
  return [{ title: "Billing | Marginality Admin" }];
};

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusClasses(hasPlus: boolean): string {
  return hasPlus
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
    : "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
}

function actionClasses(action: ManualEntitlementAction): string {
  if (action === "grant") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }
  if (action === "revoke") {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }
  return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAdmin(request);
  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim() ?? "";

  if (!email) {
    return Response.json({ email, result: null, error: null } as LoaderData);
  }

  try {
    const result = await manageSubscriptionEntitlement(user, {
      action: "inspect",
      email,
    });
    return Response.json({ email, result, error: null } as LoaderData);
  } catch (error) {
    return Response.json({
      email,
      result: null,
      error: error instanceof Error ? error.message : "Lookup failed",
    } as LoaderData);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireAdmin(request);
  const formData = await request.formData();
  const actionType = readString(formData, "action") as ManualEntitlementAction;
  const email = readString(formData, "email");
  const reason = readString(formData, "reason");
  const daysRaw = readString(formData, "days");
  const days = Number.parseInt(daysRaw, 10);

  try {
    const result = await manageSubscriptionEntitlement(user, {
      action: actionType,
      email,
      reason,
      days: Number.isFinite(days) ? days : undefined,
    });
    return Response.json({ result, error: null } as ActionData);
  } catch (error) {
    return Response.json({
      result: null,
      error: error instanceof Error ? error.message : "Entitlement update failed",
    } as ActionData);
  }
}

export default function AdminBillingRoute() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const email = actionData?.result?.targetUser.email ?? loaderData.email;
  const result = actionData?.result ?? loaderData.result;
  const error = actionData?.error ?? loaderData.error;
  const isSubmitting = navigation.state !== "idle";

  return (
    <AdminShell maxWidthClassName="max-w-6xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Billing</h1>
          <p className="text-sm text-slate-600">
            Inspect Marginality+ state and issue audited manual support grants by account email.
          </p>
        </div>

        <section className="rounded-lg bg-white p-6 shadow">
          <Form method="get" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Account email</span>
              <input
                type="email"
                name="email"
                defaultValue={searchParams.get("email") ?? email}
                placeholder="user@example.com"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                required
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700"
            >
              Look up
            </button>
          </Form>
        </section>

        {error ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Billing request failed</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : null}

        {result ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg bg-white p-5 shadow">
                <p className="text-sm font-medium text-slate-500">Account</p>
                <p className="mt-2 break-all text-lg font-semibold text-slate-900">
                  {result.targetUser.email ?? result.targetUser.id}
                </p>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {result.targetUser.id}
                </p>
              </div>
              <div className="rounded-lg bg-white p-5 shadow">
                <p className="text-sm font-medium text-slate-500">Marginality+</p>
                <span
                  className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses(
                    result.state.effective.has_plus
                  )}`}
                >
                  {result.state.effective.has_plus ? "Active" : "Inactive"}
                </span>
                <p className="mt-3 text-sm text-slate-600">
                  {result.state.effective.status} via {result.state.effective.provider}
                </p>
              </div>
              <div className="rounded-lg bg-white p-5 shadow">
                <p className="text-sm font-medium text-slate-500">Period end</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatDateTime(result.state.effective.current_period_end)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {result.state.effective.cancel_at_period_end
                    ? "Access is set to end at period close"
                    : "No scheduled period-end cancellation"}
                </p>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg bg-white p-6 shadow">
                <h2 className="text-lg font-semibold text-slate-900">Grant access</h2>
                <Form method="post" className="mt-4 space-y-4">
                  <input type="hidden" name="action" value="grant" />
                  <input type="hidden" name="email" value={result.targetUser.email ?? email} />
                  <label className="space-y-2 block">
                    <span className="text-sm font-medium text-slate-700">Duration</span>
                    <select
                      name="days"
                      defaultValue="30"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                    >
                      {GRANT_DAYS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 block">
                    <span className="text-sm font-medium text-slate-700">Reason</span>
                    <textarea
                      name="reason"
                      rows={3}
                      placeholder="Support comp, production tester, billing recovery..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Grant Marginality+
                  </button>
                </Form>
              </div>

              <div className="rounded-lg bg-white p-6 shadow">
                <h2 className="text-lg font-semibold text-slate-900">Revoke access</h2>
                <Form method="post" className="mt-4 space-y-4">
                  <input type="hidden" name="action" value="revoke" />
                  <input type="hidden" name="email" value={result.targetUser.email ?? email} />
                  <label className="space-y-2 block">
                    <span className="text-sm font-medium text-slate-700">Reason</span>
                    <textarea
                      name="reason"
                      rows={5}
                      placeholder="Mistaken grant, support case resolved, abuse response..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Revoke manual access
                  </button>
                </Form>
              </div>
            </section>

            <section className="rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-900">Audit history</h2>
                <p className="text-sm text-slate-500">
                  {result.state.auditActions.length.toLocaleString()} recent actions
                </p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="py-3 pr-4">When</th>
                      <th className="py-3 pr-4">Action</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Period end</th>
                      <th className="py-3 pr-4">Admin</th>
                      <th className="py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.state.auditActions.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="py-3 pr-4 text-slate-600">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${actionClasses(
                              item.action
                            )}`}
                          >
                            {item.action}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-slate-700">
                          {item.status_before ?? "none"} {"->"} {item.status_after ?? "none"}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {formatDateTime(item.new_period_end)}
                        </td>
                        <td className="py-3 pr-4 break-all text-slate-600">
                          {item.actor_email ?? item.actor_user_id ?? "Unknown"}
                        </td>
                        <td className="py-3 text-slate-700">{item.reason}</td>
                      </tr>
                    ))}
                    {result.state.auditActions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No audit actions recorded for this account.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
