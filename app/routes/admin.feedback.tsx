import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import AdminShell from "~/components/AdminShell";
import { requireAdmin } from "~/lib/admin.server";
import {
  listGeneralFeedbackMessages,
  type GeneralFeedbackAttachment,
  type GeneralFeedbackMessageRow,
  type GeneralFeedbackStatus,
} from "~/lib/general-feedback.server";

type LoaderData = {
  messages: GeneralFeedbackMessageRow[];
  counts: {
    total: number;
    open: number;
    triaged: number;
    resolved: number;
    dismissed: number;
  };
  sourceSurfaces: string[];
  filters: {
    query: string;
    status: "" | GeneralFeedbackStatus;
    sourceSurface: string;
  };
  error?: string;
};

const STATUS_OPTIONS: Array<{ label: string; value: "" | GeneralFeedbackStatus }> = [
  { label: "All statuses", value: "" },
  { label: "Open", value: "open" },
  { label: "Triaged", value: "triaged" },
  { label: "Resolved", value: "resolved" },
  { label: "Dismissed", value: "dismissed" },
];

function isStatus(value: string | null): value is GeneralFeedbackStatus {
  return value === "open" || value === "triaged" || value === "resolved" || value === "dismissed";
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

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClasses(status: GeneralFeedbackStatus): string {
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

function isImageAttachment(attachment: GeneralFeedbackAttachment): boolean {
  return attachment.contentType.startsWith("image/");
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
  return [{ title: "Feedback | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const statusValue = url.searchParams.get("status");
  const sourceSurface = url.searchParams.get("sourceSurface")?.trim() ?? "";
  const status = isStatus(statusValue) ? statusValue : "";

  const result = await listGeneralFeedbackMessages({
    query,
    status,
    sourceSurface,
  });

  return Response.json({
    messages: result.messages,
    counts: result.counts,
    sourceSurfaces: result.sourceSurfaces,
    filters: {
      query,
      status,
      sourceSurface,
    },
    error: result.error,
  } as LoaderData);
}

export default function AdminFeedbackRoute() {
  const { messages, counts, sourceSurfaces, filters, error } = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();
  const isFiltered =
    searchParams.has("q") || searchParams.has("status") || searchParams.has("sourceSurface");

  return (
    <AdminShell maxWidthClassName="max-w-7xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Feedback</h1>
          <p className="text-sm text-slate-600">
            Review freeform tester feedback submitted from the app settings flow, separate from
            verse-specific wrong-reference reports. Screenshot attachments are shown when testers
            include them.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className={`rounded-lg border p-4 ${statCardClasses("slate")}`}>
            <p className="text-sm font-medium text-slate-500">Total feedback</p>
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
                Search the message body, reporter identity, notes, or source surface.
              </p>
            </div>
            {isFiltered ? (
              <Link
                to="/admin/feedback"
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
                placeholder="encouragement, bug, reporter email"
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
              <span className="text-sm font-medium text-slate-700">Source surface</span>
              <select
                name="sourceSurface"
                defaultValue={filters.sourceSurface}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
              >
                <option value="">All surfaces</option>
                {sourceSurfaces.map((surface) => (
                  <option key={surface} value={surface}>
                    {surface}
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
            <p className="font-medium">Feedback unavailable</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : null}

        <section className="space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-lg bg-white p-8 text-sm text-slate-600 shadow">
              {isFiltered
                ? "No feedback matched the current filters."
                : "No tester feedback has been submitted yet."}
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className="rounded-lg bg-white p-6 shadow">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClasses(message.status)}`}
                      >
                        {message.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {message.source_surface}
                      </span>
                    </div>

                    <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-3">
                      <p>
                        <span className="font-medium text-slate-900">Reporter</span>
                        {" · "}
                        {message.reporter_email || message.reporter_user_id || "Unknown"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Submitted</span>
                        {" · "}
                        {formatDateTime(message.created_at)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Updated</span>
                        {" · "}
                        {formatDateTime(message.updated_at)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Attachments</span>
                        {" · "}
                        {message.attachments.length}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-900">Message</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {message.message}
                  </p>
                </div>

                {message.attachments.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">Screenshots</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {message.attachments.map((attachment) => (
                        <div
                          key={`${message.id}-${attachment.storagePath}`}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                        >
                          {attachment.signedUrl && isImageAttachment(attachment) ? (
                            <a
                              href={attachment.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block bg-slate-200"
                            >
                              <img
                                src={attachment.signedUrl}
                                alt={attachment.fileName}
                                className="h-48 w-full object-cover"
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <div className="flex h-48 items-center justify-center bg-slate-100 px-4 text-center text-sm text-slate-500">
                              Preview unavailable
                            </div>
                          )}

                          <div className="space-y-2 p-3 text-sm text-slate-600">
                            <p className="truncate font-medium text-slate-900" title={attachment.fileName}>
                              {attachment.fileName}
                            </p>
                            <p>{attachment.contentType}</p>
                            <p>{formatFileSize(attachment.sizeBytes)}</p>
                            <p className="truncate" title={attachment.storagePath}>
                              {attachment.storagePath}
                            </p>
                            {attachment.signedUrl ? (
                              <a
                                href={attachment.signedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex text-cyan-700 hover:text-cyan-900"
                              >
                                Open attachment
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {message.reviewer_notes ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">Reviewer notes</p>
                    <p className="mt-2 whitespace-pre-wrap">{message.reviewer_notes}</p>
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
