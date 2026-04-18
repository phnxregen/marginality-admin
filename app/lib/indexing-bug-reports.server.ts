import { getServiceClient } from "~/lib/supabase.server";

export type IndexingBugReportStatus = "open" | "triaged" | "resolved" | "dismissed";
export type IndexingBugReportKind = "wrong_reference" | "missing_reference";

export type IndexingBugReportRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: IndexingBugReportStatus;
  report_kind: IndexingBugReportKind;
  video_id: string | null;
  occurrence_id: string | null;
  reference_label: string | null;
  target_verse_id: string | null;
  reference_scope: "chapter" | "verse" | null;
  start_ms: number;
  report_message: string | null;
  raw_snippet: string | null;
  debug_payload: string;
  reporter_user_id: string | null;
  reporter_email: string | null;
  video_title: string | null;
  source_video_id: string | null;
  source_url: string | null;
  latest_run_id: string | null;
  latest_run_phase: string | null;
  latest_run_engine: string | null;
  latest_run_status: string | null;
  latest_run_created_at: string | null;
  latest_run_error_message: string | null;
  latest_run_progress_stage: string | null;
  latest_run_progress_state: string | null;
  reviewer_notes: string | null;
  resolved_at: string | null;
};

export type IndexingBugReportCounts = Record<IndexingBugReportStatus, number> & {
  total: number;
};

export type IndexingBugReportFilters = {
  query?: string;
  status?: string;
  reportKind?: string;
};

export type IndexingBugReportListResult = {
  reports: IndexingBugReportRow[];
  counts: IndexingBugReportCounts;
  error?: string;
};

const REPORT_SELECT =
  "id, created_at, updated_at, status, report_kind, video_id, occurrence_id, reference_label, " +
  "target_verse_id, reference_scope, start_ms, report_message, raw_snippet, debug_payload, " +
  "reporter_user_id, reporter_email, video_title, source_video_id, source_url, " +
  "latest_run_id, latest_run_phase, latest_run_engine, latest_run_status, " +
  "latest_run_created_at, latest_run_error_message, latest_run_progress_stage, " +
  "latest_run_progress_state, reviewer_notes, resolved_at";

const LEGACY_REPORT_SELECT =
  "id, created_at, updated_at, status, video_id, occurrence_id, reference_label, " +
  "target_verse_id, reference_scope, start_ms, raw_snippet, debug_payload, " +
  "reporter_user_id, reporter_email, video_title, source_video_id, source_url, " +
  "latest_run_id, latest_run_phase, latest_run_engine, latest_run_status, " +
  "latest_run_created_at, latest_run_error_message, latest_run_progress_stage, " +
  "latest_run_progress_state, reviewer_notes, resolved_at";

const STATUS_ORDER: Record<IndexingBugReportStatus, number> = {
  open: 0,
  triaged: 1,
  resolved: 2,
  dismissed: 3,
};

function normalizeStatus(value: string | null | undefined): IndexingBugReportStatus {
  switch (value) {
    case "triaged":
    case "resolved":
    case "dismissed":
      return value;
    default:
      return "open";
  }
}

function normalizeReportKind(value: string | null | undefined): IndexingBugReportKind {
  return value === "missing_reference" ? "missing_reference" : "wrong_reference";
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isMissingColumnError(message: string | undefined, columnName: string): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes(`column indexing_bug_reports.${columnName} does not exist`) ||
    message.includes(`Could not find the '${columnName}' column`)
  );
}

async function fetchReportsWithCompatibility() {
  const supabase = getServiceClient();

  const reportsResult = await supabase
    .from("indexing_bug_reports")
    .select(REPORT_SELECT)
    .order("created_at", { ascending: false })
    .limit(250);

  if (
    reportsResult.error &&
    (isMissingColumnError(reportsResult.error.message, "report_kind") ||
      isMissingColumnError(reportsResult.error.message, "report_message"))
  ) {
    const legacyResult = await supabase
      .from("indexing_bug_reports")
      .select(LEGACY_REPORT_SELECT)
      .order("created_at", { ascending: false })
      .limit(250);

    if (legacyResult.error) {
      return legacyResult;
    }

    const upgradedRows = Array.isArray(legacyResult.data)
      ? legacyResult.data.map((row) => ({
          ...(row as unknown as Record<string, unknown>),
          report_kind: "wrong_reference",
          report_message: null,
        }))
      : [];

    return {
      ...legacyResult,
      data: upgradedRows,
      error: null,
    };
  }

  return reportsResult;
}

function matchesQuery(report: IndexingBugReportRow, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [
    report.reference_label,
    report.target_verse_id,
    report.occurrence_id,
    report.report_message,
    report.report_kind,
    report.raw_snippet,
    report.reporter_email,
    report.video_title,
    report.source_video_id,
    report.source_url,
    report.latest_run_id,
    report.latest_run_error_message,
  ];

  return haystacks.some((value) => value?.toLowerCase().includes(query));
}

export async function listIndexingBugReports(
  filters: IndexingBugReportFilters = {}
): Promise<IndexingBugReportListResult> {
  const supabase = getServiceClient();
  const counts: IndexingBugReportCounts = {
    total: 0,
    open: 0,
    triaged: 0,
    resolved: 0,
    dismissed: 0,
  };

  const [reportsResult, totalCountResult, openCountResult, triagedCountResult, resolvedCountResult, dismissedCountResult] =
    await Promise.all([
      fetchReportsWithCompatibility(),
      supabase
        .from("indexing_bug_reports")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("indexing_bug_reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("indexing_bug_reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "triaged"),
      supabase
        .from("indexing_bug_reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved"),
      supabase
        .from("indexing_bug_reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "dismissed"),
    ]);

  const countError =
    totalCountResult.error ||
    openCountResult.error ||
    triagedCountResult.error ||
    resolvedCountResult.error ||
    dismissedCountResult.error;

  if (countError) {
    return {
      reports: [],
      counts,
      error: `Failed to load indexing bug report counts: ${countError.message}`,
    };
  }

  counts.total = totalCountResult.count ?? 0;
  counts.open = openCountResult.count ?? 0;
  counts.triaged = triagedCountResult.count ?? 0;
  counts.resolved = resolvedCountResult.count ?? 0;
  counts.dismissed = dismissedCountResult.count ?? 0;

  if (reportsResult.error) {
    return {
      reports: [],
      counts,
      error: `Failed to load indexing bug reports: ${reportsResult.error.message}`,
    };
  }

  const normalizedStatus = normalizeStatus(filters.status);
  const normalizedReportKind = normalizeReportKind(filters.reportKind);
  const normalizedQuery = normalizeQuery(filters.query);

  const rawReports = Array.isArray(reportsResult.data)
    ? (reportsResult.data as unknown as IndexingBugReportRow[])
    : [];

  const reports = rawReports
    .map((report) => ({
      ...report,
      status: normalizeStatus(report.status),
      report_kind: normalizeReportKind(report.report_kind),
    }))
    .filter((report) =>
      (filters.status ? report.status === normalizedStatus : true) &&
      (filters.reportKind ? report.report_kind === normalizedReportKind : true) &&
      matchesQuery(report, normalizedQuery)
    )
    .sort((left, right) => {
      const leftOrder = STATUS_ORDER[left.status];
      const rightOrder = STATUS_ORDER[right.status];
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return right.created_at.localeCompare(left.created_at);
    });

  return { reports, counts };
}
