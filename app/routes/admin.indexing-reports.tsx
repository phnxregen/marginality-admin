import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";
import {
  listIndexingBugReports,
  type IndexingBugReportKind,
  type IndexingBugReportRow,
  type IndexingBugReportStatus,
} from "~/lib/indexing-bug-reports.server";

type LoaderData = {
  reports: IndexingBugReportRow[];
  counts: {
    total: number;
    open: number;
    triaged: number;
    resolved: number;
    dismissed: number;
  };
  filters: {
    query: string;
    status: "" | IndexingBugReportStatus;
    reportKind: "" | IndexingBugReportKind;
  };
  error?: string;
};

const STATUS_OPTIONS: Array<{ label: string; value: "" | IndexingBugReportStatus }> = [
  { label: "All statuses", value: "" },
  { label: "Open", value: "open" },
  { label: "Triaged", value: "triaged" },
  { label: "Resolved", value: "resolved" },
  { label: "Dismissed", value: "dismissed" },
];

const REPORT_KIND_OPTIONS: Array<{ label: string; value: "" | IndexingBugReportKind }> = [
  { label: "All report types", value: "" },
  { label: "Wrong reference", value: "wrong_reference" },
  { label: "Missing reference", value: "missing_reference" },
];

function isStatus(value: string | null): value is IndexingBugReportStatus {
  return value === "open" || value === "triaged" || value === "resolved" || value === "dismissed";
}

function isReportKind(value: string | null): value is IndexingBugReportKind {
  return value === "wrong_reference" || value === "missing_reference";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => part.toString().padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((part) => part.toString().padStart(2, "0")).join(":");
}

function statusClasses(status: IndexingBugReportStatus): string {
  switch (status) {
    case "open":
      return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
    case "triaged":
      return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
    case "dismissed":
      return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
  }
}

function reportKindClasses(kind: IndexingBugReportKind): string {
  switch (kind) {
    case "missing_reference":
      return "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200";
    case "wrong_reference":
      return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  }
}

function reportKindLabel(kind: IndexingBugReportKind): string {
  return kind === "missing_reference" ? "Missing reference" : "Wrong reference";
}

function statCardClasses(accent: "rose" | "sky" | "emerald" | "slate"): string {
  switch (accent) {
    case "rose":
      return "border-rose-100 bg-rose-50";
    case "sky":
      return "border-sky-100 bg-sky-50";
    case "emerald":
      return "border-emerald-100 bg-emerald-50";
    default:
      return "border-slate-200 bg-white";
  }
}

export const meta: MetaFunction = () => {
  return [{ title: "Indexing Reports | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const statusValue = url.searchParams.get("status");
  const reportKindValue = url.searchParams.get("reportKind");
  const status = isStatus(statusValue) ? statusValue : "";
  const reportKind = isReportKind(reportKindValue) ? reportKindValue : "";

  const result = await listIndexingBugReports({
    query,
    status,
    reportKind,
  });

  return Response.json({
    reports: result.reports,
    counts: result.counts,
    filters: {
      query,
      status,
      reportKind,
    },
    error: result.error,
  } as LoaderData);
}

export default function AdminIndexingReportsRoute() {
  const { reports, counts, filters, error } = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();
  const isFiltered =
    searchParams.has("q") || searchParams.has("status") || searchParams.has("reportKind");

  return (
    <AdminShell maxWidthClassName="max-w-7xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Indexing Reports</h1>
          <p className="text-sm text-slate-600">
            Review tester-submitted wrong-reference and missing-reference reports from the app,
            including the captured snippet, tester note, latest run metadata, and full debug
            payload.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className={`rounded-lg border p-4 ${statCardClasses("slate")}`}>
            <p className="text-sm font-medium text-slate-500">Total reports</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {counts.total.toLocaleString()}
            </p>
          </div>
          <div className={`rounded-lg border p-4 ${statCardClasses("rose")}`}>
            <p className="text-sm font-medium text-rose-700">Open</p>
            <p className="mt-2 text-3xl font-semibold text-rose-900">
              {counts.open.toLocaleString()}
            </p>
          </div>
          <div className={`rounded-lg border p-4 ${statCardClasses("sky")}`}>
            <p className="text-sm font-medium text-sky-700">Triaged</p>
            <p className="mt-2 text-3xl font-semibold text-sky-900">
              {counts.triaged.toLocaleString()}
            </p>
          </div>
          <div className={`rounded-lg border p-4 ${statCardClasses("emerald")}`}>
            <p className="text-sm font-medium text-emerald-700">Resolved</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-900">
              {counts.resolved.toLocaleString()}
            </p>
          </div>
          <div className={`rounded-lg border p-4 ${statCardClasses("slate")}`}>
            <p className="text-sm font-medium text-slate-500">Dismissed</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {counts.dismissed.toLocaleString()}
            </p>
          </div>
        </div>

        <section className="rounded-lg bg-white p-6 shadow">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
              <p className="mt-1 text-sm text-slate-600">
                Search by reference, tester note, video, reporter, occurrence, or latest run
                fields.
              </p>
            </div>
            {isFiltered ? (
              <Link
                to="/admin/indexing-reports"
                className="text-sm font-medium text-cyan-700 hover:text-cyan-900"
              >
                Clear filters
              </Link>
            ) : null}
          </div>

          <Form
            method="get"
            className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px_auto]"
          >
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Search</span>
              <input
                type="text"
                name="q"
                defaultValue={filters.query}
                placeholder="john 3:16, missing note, reporter email, run id"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Status</span>
              <select
                name="status"
                defaultValue={filters.status}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Report type</span>
              <select
                name="reportKind"
                defaultValue={filters.reportKind}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              >
                {REPORT_KIND_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700"
            >
              Apply filters
            </button>
          </Form>
        </section>

        {error ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Reports unavailable</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2">
              Apply the `indexing_bug_reports` migration in the app project before expecting this
              page to populate.
            </p>
          </section>
        ) : null}

        <section className="space-y-4">
          {reports.length === 0 ? (
            <div className="rounded-lg bg-white p-8 text-sm text-slate-600 shadow">
              {isFiltered
                ? "No reports matched the current filters."
                : "No indexing bug reports have been submitted yet."}
            </div>
          ) : (
            reports.map((report) => (
              <article key={report.id} className="rounded-lg bg-white p-6 shadow">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold text-slate-900">
                        {report.report_kind === "missing_reference"
                          ? "Missing reference report"
                          : report.reference_label || "Wrong reference report"}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClasses(report.status)}`}
                      >
                        {report.status}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${reportKindClasses(report.report_kind)}`}
                      >
                        {reportKindLabel(report.report_kind)}
                      </span>
                      {report.reference_scope ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-700">
                          {report.reference_scope}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-3">
                      <p>
                        <span className="font-medium text-slate-900">Video</span>
                        {" · "}
                        {report.video_title || "Untitled video"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Reporter</span>
                        {" · "}
                        {report.reporter_email || report.reporter_user_id || "Unknown"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Reported</span>
                        {" · "}
                        {formatDateTime(report.created_at)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Timestamp</span>
                        {" · "}
                        {formatTimestamp(report.start_ms)}
                      </p>
                      {report.occurrence_id ? (
                        <p className="break-all">
                          <span className="font-medium text-slate-900">Occurrence</span>
                          {" · "}
                          {report.occurrence_id}
                        </p>
                      ) : null}
                      {report.target_verse_id ? (
                        <p className="break-all">
                          <span className="font-medium text-slate-900">Target verse</span>
                          {" · "}
                          {report.target_verse_id}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 lg:min-w-72">
                    <p className="font-medium text-slate-900">Latest run</p>
                    <p className="mt-1 break-all">
                      {report.latest_run_id || "No run metadata"}{" "}
                      {report.latest_run_phase ? `· ${report.latest_run_phase}` : ""}
                      {report.latest_run_status ? ` · ${report.latest_run_status}` : ""}
                    </p>
                    {(report.latest_run_engine ||
                      report.latest_run_progress_stage ||
                      report.latest_run_progress_state) && (
                      <p className="mt-1">
                        {report.latest_run_engine || "unknown engine"}
                        {report.latest_run_progress_stage
                          ? ` · ${report.latest_run_progress_stage}`
                          : ""}
                        {report.latest_run_progress_state
                          ? ` · ${report.latest_run_progress_state}`
                          : ""}
                      </p>
                    )}
                    {report.latest_run_created_at ? (
                      <p className="mt-1">{formatDateTime(report.latest_run_created_at)}</p>
                    ) : null}
                    {report.latest_run_error_message ? (
                      <p className="mt-2 rounded-md bg-rose-50 p-2 text-rose-700">
                        {report.latest_run_error_message}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">Tester note</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {report.report_message?.trim() || "No tester note attached."}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">Snippet</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {report.raw_snippet?.trim() || "No snippet captured."}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">Source context</p>
                    <div className="mt-2 space-y-2 text-sm text-slate-600">
                      <p className="break-all">
                        <span className="font-medium text-slate-900">Source video ID</span>
                        {" · "}
                        {report.source_video_id || "Unknown"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-slate-900">Video row</span>
                        {" · "}
                        {report.video_id || "Unknown"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-slate-900">Source URL</span>
                        {" · "}
                        {report.source_url ? (
                          <a
                            href={report.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-700 hover:text-cyan-900"
                          >
                            Open source
                          </a>
                        ) : (
                          "Unavailable"
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <details className="mt-4 rounded-lg border border-slate-200 bg-slate-950">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-100">
                    Debug payload
                  </summary>
                  <pre className="max-h-96 overflow-auto border-t border-slate-800 px-4 py-4 text-xs leading-6 text-slate-100">
                    {report.debug_payload}
                  </pre>
                </details>

                {report.reviewer_notes ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">Reviewer notes</p>
                    <p className="mt-2 whitespace-pre-wrap">{report.reviewer_notes}</p>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>
      </div>
    </AdminShell>
  );
}
