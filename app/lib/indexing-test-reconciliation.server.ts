import { getServiceClient } from "~/lib/supabase.server";

type ReconcilableTestRunRow = {
  id: string;
  status: "queued" | "processing" | "complete" | "failed";
  youtube_url: string;
  youtube_video_id: string;
  source_video_id: string | null;
  indexing_run_id: string | null;
  transcript_count: number;
  ocr_count: number;
  transcript_source: string | null;
  lane_used: string | null;
};

type UpstreamVideoRow = {
  id: string;
  source_video_id: string | null;
  external_video_id: string | null;
  indexing_status: string | null;
  transcript_status: string | null;
  verse_status: string | null;
  error_message: string | null;
};

type UpstreamIndexingRunRow = {
  id: string;
  video_id: string;
  phase: string;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type UpstreamIndexingOutputRow = {
  id: string;
  video_id: string;
  indexing_run_id: string;
  output_type: string;
  payload: unknown;
  created_at: string;
};

type AuthoritativeResult = {
  status: "processing" | "failed" | "complete";
  indexingRunId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  transcriptJson: unknown;
  ocrJson: unknown;
  transcriptCount: number;
  ocrCount: number;
  transcriptSource: string | null;
  laneUsed: string | null;
  durationMs: number | null;
  pipelineVersion: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function valueAtPath(source: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    const asObj = asRecord(current);
    if (!asObj || !(part in asObj)) {
      return null;
    }
    current = asObj[part];
  }
  return current;
}

function pickFirst(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = valueAtPath(source, path);
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function defaultOccurrencesJson(youtubeUrl: string) {
  return { video_url: youtubeUrl, occurrences: [] };
}

function countOccurrences(jsonValue: unknown): number {
  const asObj = asRecord(jsonValue);
  if (Array.isArray(jsonValue)) {
    return jsonValue.length;
  }
  if (asObj && Array.isArray(asObj.occurrences)) {
    return asObj.occurrences.length;
  }
  const dataObj = asRecord(asObj?.data);
  if (dataObj && Array.isArray(dataObj.occurrences)) {
    return dataObj.occurrences.length;
  }
  return 0;
}

function hasStatus(value: string | null | undefined, status: string) {
  return (value || "").toLowerCase() === status;
}

function latestRunByPhase(runs: UpstreamIndexingRunRow[], phase: string) {
  return runs.find((run) => run.phase === phase) || null;
}

function metaString(run: UpstreamIndexingRunRow | null, paths: string[]) {
  if (!run?.meta) {
    return null;
  }
  return normalizeString(pickFirst(run.meta, paths));
}

function metaInteger(run: UpstreamIndexingRunRow | null, paths: string[]) {
  if (!run?.meta) {
    return null;
  }
  return normalizeInteger(pickFirst(run.meta, paths));
}

async function appendReconcileLog(testRunId: string, msg: string, data: Record<string, unknown>) {
  const supabase = getServiceClient();
  await supabase.from("indexing_test_logs").insert({
    test_run_id: testRunId,
    level: "info",
    msg,
    data,
  });
}

function needsContractRepair(run: ReconcilableTestRunRow): boolean {
  if (run.status !== "complete") {
    return false;
  }

  if (!run.indexing_run_id) {
    return true;
  }

  if (run.transcript_count > 0 && !run.transcript_source) {
    return true;
  }

  if (run.transcript_count > 0 && !run.lane_used) {
    return true;
  }

  return false;
}

async function loadAuthoritativeResult(run: ReconcilableTestRunRow): Promise<AuthoritativeResult | null> {
  const supabase = getServiceClient();

  const findVideo = async (
    column: "source_video_id" | "external_video_id",
    value: string
  ): Promise<UpstreamVideoRow | null> => {
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id, source_video_id, external_video_id, indexing_status, transcript_status, verse_status, error_message"
      )
      .eq(column, value)
      .limit(1);
    if (error) {
      throw new Error(`Failed to inspect videos: ${error.message}`);
    }
    return ((data || []) as UpstreamVideoRow[])[0] || null;
  };

  const video =
    (run.source_video_id ? await findVideo("source_video_id", run.source_video_id) : null) ||
    (await findVideo("external_video_id", run.youtube_video_id)) ||
    (await findVideo("source_video_id", run.youtube_video_id));

  if (!video) {
    return null;
  }

  const [{ data: runsData, error: runsError }, { data: outputsData, error: outputsError }] =
    await Promise.all([
      supabase
        .from("indexing_runs")
        .select("id, video_id, phase, status, error_message, duration_ms, meta, created_at")
        .eq("video_id", video.id)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("indexing_outputs")
        .select("id, video_id, indexing_run_id, output_type, payload, created_at")
        .eq("video_id", video.id)
        .order("created_at", { ascending: false }),
    ]);

  if (runsError) {
    throw new Error(`Failed to inspect indexing_runs: ${runsError.message}`);
  }
  if (outputsError) {
    throw new Error(`Failed to inspect indexing_outputs: ${outputsError.message}`);
  }

  const runs = (runsData || []) as UpstreamIndexingRunRow[];
  const outputs = (outputsData || []) as UpstreamIndexingOutputRow[];
  const latestTranscriptRun = latestRunByPhase(runs, "transcript_acquisition");
  const latestVerseRun = latestRunByPhase(runs, "verse_detection");
  const latestRun = runs[0] || latestVerseRun || latestTranscriptRun;
  const transcriptJson =
    outputs.find((output) => output.output_type === "transcript_occurrences")?.payload ??
    defaultOccurrencesJson(run.youtube_url);
  const ocrJson =
    outputs.find((output) => output.output_type === "ocr_occurrences")?.payload ??
    defaultOccurrencesJson(run.youtube_url);

  const baseResult = {
    indexingRunId: latestRun?.id || null,
    transcriptJson,
    ocrJson,
    transcriptCount: countOccurrences(transcriptJson),
    ocrCount: countOccurrences(ocrJson),
    transcriptSource:
      metaString(latestTranscriptRun, [
        "transcript_source",
        "transcriptSource",
        "transcript_matched_on",
        "transcriptMatchedOn",
      ]) || null,
    laneUsed:
      metaString(latestTranscriptRun, [
        "winning_lane",
        "winningLane",
        "lane",
        "lane_used",
        "laneUsed",
      ]) || null,
    durationMs:
      latestVerseRun?.duration_ms ||
      latestTranscriptRun?.duration_ms ||
      metaInteger(latestVerseRun, ["duration_ms", "durationMs"]) ||
      metaInteger(latestTranscriptRun, ["duration_ms", "durationMs"]),
    pipelineVersion:
      metaString(latestVerseRun, ["pipeline_version", "pipelineVersion"]) ||
      metaString(latestTranscriptRun, ["pipeline_version", "pipelineVersion"]),
  };

  if (
    runs.some((candidate) => hasStatus(candidate.status, "processing")) ||
    hasStatus(video.indexing_status, "processing") ||
    hasStatus(video.transcript_status, "processing") ||
    hasStatus(video.verse_status, "processing")
  ) {
    return {
      status: "processing",
      errorCode: null,
      errorMessage: null,
      ...baseResult,
    };
  }

  if (
    hasStatus(video.indexing_status, "failed") ||
    hasStatus(video.transcript_status, "failed") ||
    hasStatus(video.verse_status, "failed") ||
    hasStatus(latestVerseRun?.status, "failed") ||
    hasStatus(latestTranscriptRun?.status, "failed")
  ) {
    const failureRun =
      (latestVerseRun && hasStatus(latestVerseRun.status, "failed") ? latestVerseRun : null) ||
      (latestTranscriptRun && hasStatus(latestTranscriptRun.status, "failed")
        ? latestTranscriptRun
        : null) ||
      runs.find((candidate) => hasStatus(candidate.status, "failed")) ||
      null;

    return {
      ...baseResult,
      status: "failed",
      errorCode: metaString(failureRun, ["error_code", "errorCode", "code"]) || "UPSTREAM_INDEXING_FAILED",
      errorMessage:
        failureRun?.error_message ||
        video.error_message ||
        "Upstream indexing failed before producing a qualifying result.",
      indexingRunId: failureRun?.id || baseResult.indexingRunId,
    };
  }

  if (
    hasStatus(video.indexing_status, "complete") ||
    hasStatus(latestVerseRun?.status, "complete") ||
    (hasStatus(video.transcript_status, "complete") && hasStatus(video.verse_status, "complete"))
  ) {
    return {
      ...baseResult,
      status: "complete",
      errorCode: null,
      errorMessage: null,
      indexingRunId: latestVerseRun?.id || baseResult.indexingRunId,
    };
  }

  return {
    status: "processing",
    errorCode: null,
    errorMessage: null,
    ...baseResult,
  };
}

async function reconcileSingleRun(run: ReconcilableTestRunRow): Promise<boolean> {
  const repairingCompleteRun = needsContractRepair(run);
  if (run.status !== "processing" && !repairingCompleteRun) {
    return false;
  }

  const supabase = getServiceClient();
  const authoritative = await loadAuthoritativeResult(run);
  if (!authoritative) {
    return false;
  }

  if (authoritative.status === "processing") {
    if (repairingCompleteRun) {
      return false;
    }

    await supabase
      .from("indexing_test_runs")
      .update({
        indexing_run_id: authoritative.indexingRunId,
        transcript_count: authoritative.transcriptCount,
        ocr_count: authoritative.ocrCount,
        transcript_source: authoritative.transcriptSource,
        lane_used: authoritative.laneUsed,
        duration_ms: authoritative.durationMs,
        pipeline_version: authoritative.pipelineVersion,
      })
      .eq("id", run.id)
      .eq("status", "processing");
    return false;
  }

  if (repairingCompleteRun && authoritative.status !== "complete") {
    return false;
  }

  await supabase.from("indexing_test_outputs").upsert(
    {
      test_run_id: run.id,
      transcript_json: authoritative.transcriptJson,
      ocr_json: authoritative.ocrJson,
    },
    { onConflict: "test_run_id" }
  );

  await supabase
    .from("indexing_test_runs")
    .update({
      status: repairingCompleteRun ? "complete" : authoritative.status,
      indexing_run_id: authoritative.indexingRunId,
      pipeline_version: authoritative.pipelineVersion,
      transcript_count: authoritative.transcriptCount,
      ocr_count: authoritative.ocrCount,
      transcript_source: authoritative.transcriptSource,
      lane_used: authoritative.laneUsed,
      duration_ms: authoritative.durationMs,
      error_code: authoritative.errorCode,
      error_message: authoritative.errorMessage,
    })
    .eq("id", run.id)
    .eq("status", "processing");

  await appendReconcileLog(
    run.id,
    repairingCompleteRun
      ? "reconciled contract metadata"
      : authoritative.status === "failed"
        ? "reconciled upstream failure"
        : "reconciled run complete",
    {
      status: repairingCompleteRun ? "complete" : authoritative.status,
      indexingRunId: authoritative.indexingRunId,
      errorCode: authoritative.errorCode,
      errorMessage: authoritative.errorMessage,
      transcriptCount: authoritative.transcriptCount,
      ocrCount: authoritative.ocrCount,
    }
  );

  return true;
}

export async function reconcileIndexingTestRun(runId: string): Promise<void> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("indexing_test_runs")
    .select(
      "id, status, youtube_url, youtube_video_id, source_video_id, indexing_run_id, transcript_count, ocr_count, transcript_source, lane_used"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load run for reconciliation: ${error.message}`);
  }

  if (!data) {
    return;
  }

  await reconcileSingleRun(data as ReconcilableTestRunRow);
}

export async function reconcileIndexingTestRuns(runIds: string[]): Promise<void> {
  const uniqueRunIds = Array.from(new Set(runIds.filter(Boolean)));
  if (uniqueRunIds.length === 0) {
    return;
  }

  for (const runId of uniqueRunIds) {
    await reconcileIndexingTestRun(runId);
  }
}
