import { getServiceClient } from "~/lib/supabase.server";
import type {
  IndexingV2Candidate,
  ResolvedOccurrence,
  TimingAuthority,
} from "~/lib/indexing-v2-resolver.server";
import type { ResolverValidationReport } from "~/lib/indexing-v2-validation.server";

export type IndexingV2RunRow = {
  id: string;
  test_run_id: string | null;
  upstream_video_id: string | null;
  requested_by_user_id: string | null;
  source_video_id: string | null;
  youtube_video_id: string;
  youtube_url: string;
  run_mode: "admin_test" | "public" | "personal";
  status:
    | "queued"
    | "transcribing"
    | "alignment_pending"
    | "aligning"
    | "ocr_processing"
    | "analyzing"
    | "resolving"
    | "complete"
    | "complete_with_warnings"
    | "failed";
  pipeline_version: "indexing_v2";
  execution_mode: "full_alignment" | "no_alignment" | "admin_forced_alignment" | "fallback_only";
  timing_authority: TimingAuthority;
  timing_confidence: number | null;
  transcript_source: string | null;
  lane_used: string | null;
  transcript_segment_count: number;
  candidate_count: number;
  occurrence_count: number;
  warning_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type IndexingV2ArtifactRow = {
  id: string;
  run_id: string;
  artifact_type: string;
  stage: string;
  storage_kind: string;
  mime_type: string | null;
  payload: unknown;
  size_bytes: number | null;
  created_at: string;
};

export type IndexingV2ValidationReportRow = {
  id: string;
  run_id: string;
  fixture_id: string;
  overall_status: "pass" | "pass_with_warnings" | "fail";
  warning_count: number;
  report: ResolverValidationReport;
  created_at: string;
  updated_at: string;
};

export type StartIndexingV2TestRunPayload = {
  youtubeUrl: string;
  sourceVideoId?: string;
  runMode?: "admin_test" | "public" | "personal";
  requestedByUserId?: string;
  transcriptOverrideText?: string;
  transcriptOverrideJson?: string;
  ignoreUpstreamTranscriptCache?: boolean;
};

export type StartIndexingV2TestRunResult = {
  runId: string;
  status: string;
};

function getSupabaseUrl(): string {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_DATABASE_URL;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required for V2 indexing test operations.");
  }

  return supabaseUrl;
}

function assertId(id: string, fieldName: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function embedUrl(youtubeVideoId: string): string {
  return `https://www.youtube.com/embed/${youtubeVideoId}`;
}

function artifactDownloadUrl(runId: string, artifactType: string, stage: string): string | null {
  if (artifactType === "raw_transcript_json" && stage === "transcript_acquisition") {
    return `/admin/indexing-v2-testing/runs/${runId}/transcript.json`;
  }
  switch (artifactType) {
    case "verse_candidates_json":
      return `/admin/indexing-v2-testing/runs/${runId}/candidates.json`;
    case "resolved_occurrences_json":
      return `/admin/indexing-v2-testing/runs/${runId}/occurrences.json`;
    case "validation_report_json":
      return `/admin/indexing-v2-testing/runs/${runId}/validation.json`;
    default:
      return null;
  }
}

function artifactLabel(artifactType: string, stage: string): string {
  if (artifactType === "raw_transcript_json" && stage === "transcript_acquisition") {
    return "transcript segments json";
  }
  return artifactType.replace(/_/g, " ");
}

export async function listIndexingV2Runs(limit = 50): Promise<IndexingV2RunRow[]> {
  const supabase = getServiceClient();
  const safeLimit = Math.max(1, Math.min(limit, 200));

  const { data, error } = await supabase
    .from("indexing_v2_runs")
    .select(
      "id, test_run_id, upstream_video_id, requested_by_user_id, source_video_id, youtube_video_id, youtube_url, run_mode, status, pipeline_version, execution_mode, timing_authority, timing_confidence, transcript_source, lane_used, transcript_segment_count, candidate_count, occurrence_count, warning_count, error_code, error_message, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list V2 indexing runs: ${error.message}`);
  }

  return (data || []) as IndexingV2RunRow[];
}

export async function getIndexingV2Run(id: string): Promise<IndexingV2RunRow | null> {
  const supabase = getServiceClient();
  const runId = assertId(id, "runId");

  const { data, error } = await supabase
    .from("indexing_v2_runs")
    .select(
      "id, test_run_id, upstream_video_id, requested_by_user_id, source_video_id, youtube_video_id, youtube_url, run_mode, status, pipeline_version, execution_mode, timing_authority, timing_confidence, transcript_source, lane_used, transcript_segment_count, candidate_count, occurrence_count, warning_count, error_code, error_message, created_at, updated_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load V2 indexing run: ${error.message}`);
  }

  return (data as IndexingV2RunRow | null) || null;
}

export async function getIndexingV2Artifacts(runId: string): Promise<IndexingV2ArtifactRow[]> {
  const supabase = getServiceClient();
  const safeRunId = assertId(runId, "runId");

  const { data, error } = await supabase
    .from("indexing_v2_run_artifacts")
    .select("id, run_id, artifact_type, stage, storage_kind, mime_type, payload, size_bytes, created_at")
    .eq("run_id", safeRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load V2 artifacts: ${error.message}`);
  }

  return (data || []) as IndexingV2ArtifactRow[];
}

export async function getIndexingV2TranscriptArtifact(runId: string): Promise<IndexingV2ArtifactRow | null> {
  const artifacts = await getIndexingV2Artifacts(runId);
  return (
    artifacts.find(
      (artifact) =>
        artifact.artifact_type === "raw_transcript_json" && artifact.stage === "transcript_acquisition"
    ) || null
  );
}

export async function getIndexingV2Candidates(runId: string): Promise<
  Array<
    IndexingV2Candidate & {
      run_id: string;
      resolver_status: "accepted" | "rejected" | "pending";
      rejection_reason: string | null;
      pipeline_version: string;
      created_at: string;
    }
  >
> {
  const supabase = getServiceClient();
  const safeRunId = assertId(runId, "runId");

  const { data, error } = await supabase
    .from("indexing_v2_candidates")
    .select(
      "candidate_id, run_id, verse_ref, normalized_verse_ref, timestamp_sec, source_type, confidence, timing_authority, context_key, transcript_span, ocr_span, evidence_payload, source_artifact_id, resolver_status, rejection_reason, pipeline_version, created_at"
    )
    .eq("run_id", safeRunId)
    .order("timestamp_sec", { ascending: true });

  if (error) {
    throw new Error(`Failed to load V2 candidates: ${error.message}`);
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    candidate_id: String(row.candidate_id),
    run_id: String(row.run_id),
    verse_ref: String(row.verse_ref),
    normalized_verse_ref: String(row.normalized_verse_ref),
    timestamp_sec: Number(row.timestamp_sec),
    source_type: row.source_type as IndexingV2Candidate["source_type"],
    confidence: Number(row.confidence),
    timing_authority: row.timing_authority as TimingAuthority,
    context_key: String(row.context_key),
    transcript_span: (row.transcript_span as IndexingV2Candidate["transcript_span"]) || null,
    ocr_span: (row.ocr_span as IndexingV2Candidate["ocr_span"]) || null,
    evidence_payload: row.evidence_payload as IndexingV2Candidate["evidence_payload"],
    source_artifact_id: (row.source_artifact_id as string | null) || null,
    resolver_status: row.resolver_status as "accepted" | "rejected" | "pending",
    rejection_reason: (row.rejection_reason as string | null) || null,
    pipeline_version: String(row.pipeline_version),
    created_at: String(row.created_at),
  }));
}

export async function getIndexingV2Occurrences(runId: string): Promise<
  Array<
    ResolvedOccurrence & {
      run_id: string;
      pipeline_version: string;
      created_at: string;
    }
  >
> {
  const supabase = getServiceClient();
  const safeRunId = assertId(runId, "runId");

  const { data, error } = await supabase
    .from("indexing_v2_occurrences")
    .select(
      "occurrence_id, run_id, occurrence_index, verse_ref, normalized_verse_ref, canonical_timestamp_sec, occurrence_type, source_type, confidence, timing_authority, canonical_candidate_id, transcript_segment_id, transcript_segment_ids, snippet_text, snippet_start_sec, snippet_end_sec, snippet_source_artifact_id, snippet_source_segment_ids, evidence_summary, pipeline_version, created_at"
    )
    .eq("run_id", safeRunId)
    .order("occurrence_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to load V2 occurrences: ${error.message}`);
  }

  const occurrenceRows = (data || []) as Array<Record<string, unknown>>;
  const occurrenceIds = occurrenceRows.map((row) => String(row.occurrence_id));
  const occurrenceCandidates = await getIndexingV2OccurrenceCandidates(occurrenceIds);
  return occurrenceRows.map((row) => ({
    occurrence_id: String(row.occurrence_id),
    run_id: String(row.run_id),
    occurrence_index: Number(row.occurrence_index),
    verse_ref: String(row.verse_ref),
    normalized_verse_ref: String(row.normalized_verse_ref),
    canonical_timestamp_sec:
      row.canonical_timestamp_sec === null ? null : Number(row.canonical_timestamp_sec),
    occurrence_type: row.occurrence_type as ResolvedOccurrence["occurrence_type"],
    source_type: (row.source_type as ResolvedOccurrence["source_type"]) || (row.occurrence_type as ResolvedOccurrence["source_type"]),
    confidence: Number(row.confidence),
    timing_authority: row.timing_authority as TimingAuthority,
    canonical_candidate_id: (row.canonical_candidate_id as string | null) || null,
    transcript_segment_id: (row.transcript_segment_id as string | null) || null,
    transcript_segment_ids: (row.transcript_segment_ids as string[]) || [],
    snippet_text: (row.snippet_text as string | null) || null,
    snippet_start_sec:
      row.snippet_start_sec === null ? null : Number(row.snippet_start_sec),
    snippet_end_sec: row.snippet_end_sec === null ? null : Number(row.snippet_end_sec),
    snippet_source_artifact_id: (row.snippet_source_artifact_id as string | null) || null,
    snippet_source_segment_ids: (row.snippet_source_segment_ids as string[]) || [],
    evidence_summary: row.evidence_summary as ResolvedOccurrence["evidence_summary"],
    fused_candidate_ids: occurrenceCandidates.get(String(row.occurrence_id)) || [],
    pipeline_version: String(row.pipeline_version),
    created_at: String(row.created_at),
  }));
}

async function getIndexingV2OccurrenceCandidates(occurrenceIds: string[]): Promise<Map<string, string[]>> {
  const supabase = getServiceClient();
  const byOccurrence = new Map<string, string[]>();
  if (occurrenceIds.length === 0) {
    return byOccurrence;
  }

  const { data, error } = await supabase
    .from("indexing_v2_occurrence_candidates")
    .select("occurrence_id, candidate_id")
    .in("occurrence_id", occurrenceIds);

  if (error) {
    throw new Error(`Failed to load V2 occurrence candidate links: ${error.message}`);
  }

  for (const row of (data || []) as Array<{ occurrence_id: string; candidate_id: string }>) {
    const existing = byOccurrence.get(row.occurrence_id) || [];
    existing.push(row.candidate_id);
    byOccurrence.set(row.occurrence_id, existing);
  }
  return byOccurrence;
}

export async function getIndexingV2ValidationReport(
  runId: string
): Promise<IndexingV2ValidationReportRow | null> {
  const supabase = getServiceClient();
  const safeRunId = assertId(runId, "runId");

  const { data, error } = await supabase
    .from("indexing_v2_validation_reports")
    .select("id, run_id, fixture_id, overall_status, warning_count, report, created_at, updated_at")
    .eq("run_id", safeRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load V2 validation report: ${error.message}`);
  }

  return (data as IndexingV2ValidationReportRow | null) || null;
}

export async function startIndexingV2TestRun(
  accessToken: string,
  payload: StartIndexingV2TestRunPayload
): Promise<StartIndexingV2TestRunResult> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error("Access token is required");
  }

  const response = await fetch(`${getSupabaseUrl()}/functions/v1/admin_indexing_v2_test_run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = { error: rawBody };
    }
  }

  if (!response.ok) {
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.code === "string" && body.code) ||
      `Function call failed (${response.status})`;
    throw new Error(message);
  }

  const runId = typeof body.runId === "string" ? body.runId : null;
  const status = typeof body.status === "string" ? body.status : "unknown";
  if (!runId) {
    throw new Error("admin_indexing_v2_test_run did not return runId");
  }

  return { runId, status };
}

export async function getIndexingV2RunDetailPayload(runId: string) {
  const [run, artifacts, candidates, occurrences, validation] = await Promise.all([
    getIndexingV2Run(runId),
    getIndexingV2Artifacts(runId),
    getIndexingV2Candidates(runId),
    getIndexingV2Occurrences(runId),
    getIndexingV2ValidationReport(runId),
  ]);

  if (!run) {
    return null;
  }

  const warnings = [
    ...(validation?.report.invariant_results || []),
    ...(validation?.report.anchor_results || []),
  ]
    .filter((result) => result.status !== "pass")
    .map((result) => ({
      code: "code" in result ? result.code : result.anchor_id,
      severity:
        result.status === "fail"
          ? ("error" as const)
          : ("warning" as const),
      message: "message" in result ? result.message : result.notes.join(", ") || "Validation warning",
      artifact_id: null,
      candidate_id: null,
      occurrence_id: "actual_occurrence_id" in result ? result.actual_occurrence_id : null,
    }));

  return {
    run,
    player: {
      youtube_video_id: run.youtube_video_id,
      youtube_url: run.youtube_url,
      embed_url: embedUrl(run.youtube_video_id),
      duration_sec: null,
    },
    summary: {
      resolved_occurrence_count: occurrences.length,
      candidate_count: candidates.length,
      artifact_count: artifacts.length,
      warning_count: warnings.length,
    },
    warnings,
    filters: {
      available_occurrence_types: Array.from(
        new Set(occurrences.map((occurrence) => occurrence.occurrence_type))
      ),
      available_timing_authorities: Array.from(
        new Set(occurrences.map((occurrence) => occurrence.timing_authority))
      ),
      default_occurrence_types: ["spoken_explicit", "allusion", "ocr"] as const,
    },
    resolved_occurrences: occurrences,
    available_artifacts: artifacts.reduce<
      Array<{
        artifact_id: string;
        artifact_type: string;
        label: string;
        content_type: string | null;
        size_bytes: number | null;
        download_url: string;
      }>
    >((items, artifact) => {
      const downloadUrl = artifactDownloadUrl(run.id, artifact.artifact_type, artifact.stage);
      if (!downloadUrl) {
        return items;
      }
      items.push({
        artifact_id: artifact.id,
        artifact_type: artifact.artifact_type,
        label: artifactLabel(artifact.artifact_type, artifact.stage),
        content_type: artifact.mime_type,
        size_bytes: artifact.size_bytes,
        download_url: downloadUrl,
      });
      return items;
    }, []),
    evidence_index: Object.fromEntries(
      candidates.map((candidate) => [
        candidate.candidate_id,
        {
          candidate_id: candidate.candidate_id,
          source_type: candidate.source_type,
          verse_ref: candidate.verse_ref,
          timestamp_sec: candidate.timestamp_sec,
          confidence: candidate.confidence,
          transcript_span: candidate.transcript_span,
          ocr_span: candidate.ocr_span,
          evidence_payload: candidate.evidence_payload,
        },
      ])
    ),
    validation,
  };
}
