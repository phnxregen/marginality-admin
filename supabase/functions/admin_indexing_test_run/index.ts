import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { verifyAdmin } from "../_shared/admin_auth.ts";

type RunMode = "admin_test" | "public" | "personal";

interface OcrRawSegmentOverride {
  t: string;
  text: string;
  confidence?: number;
}

interface IndexingTestOptions {
  explicitReindex?: boolean;
  useCacheOnly?: boolean;
  enableOcr?: boolean;
  allowLanes?: Record<string, boolean>;
  chunkMinutes?: number;
  chunkOverlapSeconds?: number;
  ocrRawSegmentsOverride?: OcrRawSegmentOverride[];
  [key: string]: unknown;
}

interface AdminIndexingTestRunRequest {
  youtubeUrl?: string;
  sourceVideoId?: string;
  partnerChannelId?: string;
  partner_channel_id?: string;
  runMode?: RunMode;
  requestedByUserId?: string;
  options?: IndexingTestOptions;
}

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type SupabaseServiceClient = Awaited<
  ReturnType<typeof verifyAdmin>
>["supabaseService"];

type UpstreamVideoRow = {
  id: string;
  source_video_id: string | null;
  external_video_id: string | null;
  indexing_status: string | null;
  transcript_status: string | null;
  verse_status: string | null;
  error_message: string | null;
  updated_at: string | null;
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

type UpstreamTerminalResult = {
  status: "complete" | "failed" | "processing";
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
  video: UpstreamVideoRow | null;
  runs: UpstreamIndexingRunRow[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function readEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (!raw || !raw.trim()) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const directMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const segment = url.pathname.split("/").filter(Boolean)[0];
      if (segment && /^[A-Za-z0-9_-]{11}$/.test(segment)) {
        return segment;
      }
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        return v;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && (parts[0] === "shorts" || parts[0] === "embed")) {
        const candidate = parts[1];
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // Fall through to regex capture below.
  }

  const genericMatch = trimmed.match(/([A-Za-z0-9_-]{11})/);
  return genericMatch ? genericMatch[1] : null;
}

function countOccurrences(jsonValue: unknown): number {
  if (!jsonValue) {
    return 0;
  }

  if (Array.isArray(jsonValue)) {
    return jsonValue.length;
  }

  const asObj = asRecord(jsonValue);
  if (!asObj) {
    return 0;
  }

  if (Array.isArray(asObj.occurrences)) {
    return asObj.occurrences.length;
  }

  const dataObj = asRecord(asObj.data);
  if (dataObj && Array.isArray(dataObj.occurrences)) {
    return dataObj.occurrences.length;
  }

  return 0;
}

function defaultOccurrencesJson(youtubeUrl: string) {
  return {
    video_url: youtubeUrl,
    occurrences: [],
  };
}

function isProcessingStatus(value: string | null | undefined): boolean {
  return (value || "").toLowerCase() === "processing";
}

function isFailedStatus(value: string | null | undefined): boolean {
  return (value || "").toLowerCase() === "failed";
}

function isCompleteStatus(value: string | null | undefined): boolean {
  return (value || "").toLowerCase() === "complete";
}

function extractInlineOutput(body: unknown, youtubeUrl: string) {
  return {
    transcriptJson:
      pickFirst(body, [
        "transcript",
        "transcript_json",
        "transcriptJson",
        "transcript_occurrences_json",
        "transcriptOccurrencesJson",
        "outputs.transcript",
        "outputs.transcript_json",
        "outputs.transcriptJson",
        "outputs.transcript_occurrences_json",
        "outputs.transcriptOccurrencesJson",
      ]) ?? defaultOccurrencesJson(youtubeUrl),
    ocrJson:
      pickFirst(body, [
        "ocr",
        "ocr_json",
        "ocrJson",
        "ocr_occurrences_json",
        "ocrOccurrencesJson",
        "outputs.ocr",
        "outputs.ocr_json",
        "outputs.ocrJson",
        "outputs.ocr_occurrences_json",
        "outputs.ocrOccurrencesJson",
      ]) ?? defaultOccurrencesJson(youtubeUrl),
  };
}

function hasInlineOutputs(body: unknown): boolean {
  return (
    pickFirst(body, [
      "transcript",
      "transcript_json",
      "transcriptJson",
      "transcript_occurrences_json",
      "transcriptOccurrencesJson",
      "outputs.transcript",
      "outputs.transcript_json",
      "outputs.transcriptJson",
      "outputs.transcript_occurrences_json",
      "outputs.transcriptOccurrencesJson",
      "ocr",
      "ocr_json",
      "ocrJson",
      "ocr_occurrences_json",
      "ocrOccurrencesJson",
      "outputs.ocr",
      "outputs.ocr_json",
      "outputs.ocrJson",
      "outputs.ocr_occurrences_json",
      "outputs.ocrOccurrencesJson",
    ]) !== null
  );
}

function summarizeOptions(options: IndexingTestOptions) {
  const allowLanes = asRecord(options.allowLanes) || {};
  const enabledLaneKeys = Object.entries(allowLanes)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([lane]) => lane);

  const overrideCount = Array.isArray(options.ocrRawSegmentsOverride)
    ? options.ocrRawSegmentsOverride.length
    : 0;

  return {
    explicitReindex: Boolean(options.explicitReindex),
    useCacheOnly: Boolean(options.useCacheOnly),
    enableOcr: Boolean(options.enableOcr),
    chunkMinutes: normalizeInteger(options.chunkMinutes),
    chunkOverlapSeconds: normalizeInteger(options.chunkOverlapSeconds),
    enabledLaneKeys,
    ocrRawSegmentsOverrideCount: overrideCount,
  };
}

function buildIndexerPayloads(input: {
  youtubeUrl: string;
  youtubeVideoId: string;
  sourceVideoId: string | null;
  partnerChannelId: string | null;
  runMode: RunMode;
  requestedByUserId: string | null;
  options: IndexingTestOptions;
}) {
  const {
    youtubeUrl,
    youtubeVideoId,
    sourceVideoId,
    partnerChannelId,
    runMode,
    requestedByUserId,
    options,
  } = input;

  const baseCamel: Record<string, unknown> = {
    youtubeUrl,
    youtubeVideoId,
    sourceVideoId,
    options,
    source: "admin_testing_center",
    bypassPayment: true,
    runMode,
  };

  const baseSnake: Record<string, unknown> = {
    youtube_url: youtubeUrl,
    youtube_video_id: youtubeVideoId,
    source_video_id: sourceVideoId,
    options,
    source: "admin_testing_center",
    bypass_payment: true,
    run_mode: runMode,
  };

  if (partnerChannelId) {
    baseCamel.partnerChannelId = partnerChannelId;
    baseSnake.partner_channel_id = partnerChannelId;
  }

  if (requestedByUserId) {
    baseCamel.requestedByUserId = requestedByUserId;
    baseCamel.userId = requestedByUserId;
    baseSnake.requested_by_user_id = requestedByUserId;
    baseSnake.user_id = requestedByUserId;
  }

  return [baseCamel, baseSnake];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractIndexerMessage(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return normalizeString(
    pickFirst(body, [
      "error",
      "message",
      "details",
      "error.message",
      "error.details",
      "raw.error",
      "raw.message",
      "raw.details",
    ])
  );
}

function extractIndexerCode(body: unknown): string | null {
  const direct = normalizeString(
    pickFirst(body, ["code", "errorCode", "error_code", "error.code", "error.status", "status"])
  );
  return direct ? direct.toUpperCase() : null;
}

function classifyRetryReason(status: number, body: unknown): string | null {
  const code = extractIndexerCode(body);
  const message = (extractIndexerMessage(body) || "").toLowerCase();

  const workerLimited =
    status === 429 ||
    code === "WORKER_LIMIT" ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "RATE_LIMIT" ||
    code === "TOO_MANY_REQUESTS" ||
    message.includes("worker_limit") ||
    message.includes("worker limit") ||
    message.includes("resource exhausted") ||
    message.includes("too many requests") ||
    message.includes("rate limit");

  if (workerLimited) {
    return "worker_limit";
  }

  if (status === 408 || status === 504) {
    return "timeout";
  }

  if (status >= 500) {
    return "server_error";
  }

  return null;
}

function buildIndexerErrorMessage(status: number, body: unknown): string {
  const retryReason = classifyRetryReason(status, body);
  if (retryReason === "worker_limit") {
    return "Indexer capacity reached (WORKER_LIMIT). Retry in about 30-90 seconds.";
  }
  if (retryReason === "timeout") {
    return extractIndexerMessage(body) || "Indexer call timed out before completion.";
  }

  return extractIndexerMessage(body) || `Indexer call failed with status ${status}`;
}

function isAuthoritativeResolutionCandidate(status: number, body: unknown): boolean {
  const code = extractIndexerCode(body);
  return (
    status === 202 ||
    code === "INDEXER_TIMEOUT" ||
    code === "INDEXER_NETWORK_ERROR" ||
    code === "WORKER_LIMIT" ||
    code === "RESOURCE_EXHAUSTED"
  );
}

function classifyIndexerNonOkPayload(body: unknown): {
  code: string;
  message: string;
  status: number;
} | null {
  const record = asRecord(body);
  if (!record || typeof record.ok !== "boolean" || record.ok) {
    return null;
  }

  const processing = Boolean(record.processing);
  const needsTranscript = Boolean(record.needsTranscript);
  const messageFromBody = extractIndexerMessage(body);

  if (processing) {
    return {
      code: "INDEXER_ALREADY_PROCESSING",
      message:
        messageFromBody ||
        "Indexer returned processing=true; the target video is already being indexed by another run.",
      status: 409,
    };
  }

  if (needsTranscript) {
    return {
      code: "INDEXER_NEEDS_TRANSCRIPT",
      message:
        messageFromBody ||
        "Indexer returned needsTranscript=true; transcript segments are required before verse detection.",
      status: 422,
    };
  }

  const payloadCode = extractIndexerCode(body);
  return {
    code: payloadCode ? `INDEXER_${payloadCode}` : "INDEXER_NON_OK_PAYLOAD",
    message: messageFromBody || "Indexer returned ok=false",
    status: 502,
  };
}

async function appendLog(
  supabaseService: SupabaseServiceClient,
  testRunId: string,
  level: "info" | "warn" | "error",
  msg: string,
  data?: Record<string, unknown>
) {
  const payload: Record<string, unknown> = {
    test_run_id: testRunId,
    level,
    msg,
  };

  if (data && Object.keys(data).length > 0) {
    payload.data = data;
  }

  const { error } = await supabaseService.from("indexing_test_logs").insert(payload);
  if (error) {
    console.error("Failed to append indexing_test_logs row:", error.message);
  }
}

async function upsertTestOutputs(
  supabaseService: SupabaseServiceClient,
  testRunId: string,
  transcriptJson: unknown,
  ocrJson: unknown
) {
  const { error } = await supabaseService
    .from("indexing_test_outputs")
    .upsert(
      {
        test_run_id: testRunId,
        transcript_json: transcriptJson,
        ocr_json: ocrJson,
      },
      { onConflict: "test_run_id" }
    );

  if (error) {
    throw new HttpError(500, "OUTPUTS_STORE_FAILED", `Failed to store outputs: ${error.message}`);
  }
}

async function updateTestRun(
  supabaseService: SupabaseServiceClient,
  testRunId: string,
  input: {
    status: "processing" | "complete" | "failed";
    indexingRunId: string | null;
    pipelineVersion: string | null;
    transcriptCount: number;
    ocrCount: number;
    transcriptSource: string | null;
    laneUsed: string | null;
    durationMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  }
) {
  const { error } = await supabaseService
    .from("indexing_test_runs")
    .update({
      indexing_run_id: input.indexingRunId,
      pipeline_version: input.pipelineVersion,
      transcript_count: input.transcriptCount,
      ocr_count: input.ocrCount,
      transcript_source: input.transcriptSource,
      lane_used: input.laneUsed,
      duration_ms: input.durationMs,
      status: input.status,
      error_code: input.errorCode,
      error_message: input.errorMessage,
    })
    .eq("id", testRunId);

  if (error) {
    throw new HttpError(
      500,
      "RUN_UPDATE_FAILED",
      `Failed to update indexing_test_runs row: ${error.message}`
    );
  }
}

function selectLatestRunByPhase(runs: UpstreamIndexingRunRow[], phase: string) {
  return runs.find((run) => run.phase === phase) || null;
}

function extractRunMetaString(
  run: UpstreamIndexingRunRow | null,
  paths: string[]
): string | null {
  if (!run?.meta) {
    return null;
  }
  return normalizeString(pickFirst(run.meta, paths));
}

function extractRunMetaInteger(
  run: UpstreamIndexingRunRow | null,
  paths: string[]
): number | null {
  if (!run?.meta) {
    return null;
  }
  return normalizeInteger(pickFirst(run.meta, paths));
}

function buildAuthoritativeResult(
  youtubeUrl: string,
  video: UpstreamVideoRow | null,
  runs: UpstreamIndexingRunRow[],
  outputs: UpstreamIndexingOutputRow[]
): UpstreamTerminalResult {
  const latestTranscriptRun = selectLatestRunByPhase(runs, "transcript_acquisition");
  const latestVerseRun = selectLatestRunByPhase(runs, "verse_detection");
  const latestRun = runs[0] || latestVerseRun || latestTranscriptRun;
  const transcriptOutput =
    outputs.find((output) => output.output_type === "transcript_occurrences")?.payload ??
    defaultOccurrencesJson(youtubeUrl);
  const ocrOutput =
    outputs.find((output) => output.output_type === "ocr_occurrences")?.payload ??
    defaultOccurrencesJson(youtubeUrl);
  const transcriptCount = countOccurrences(transcriptOutput);
  const ocrCount = countOccurrences(ocrOutput);
  const transcriptSource =
    extractRunMetaString(latestTranscriptRun, [
      "transcript_source",
      "transcriptSource",
      "transcript_matched_on",
      "transcriptMatchedOn",
    ]) || null;
  const laneUsed =
    extractRunMetaString(latestTranscriptRun, [
      "winning_lane",
      "winningLane",
      "lane",
      "lane_used",
      "laneUsed",
    ]) || null;
  const durationMs =
    latestVerseRun?.duration_ms ||
    latestTranscriptRun?.duration_ms ||
    extractRunMetaInteger(latestVerseRun, ["duration_ms", "durationMs"]) ||
    extractRunMetaInteger(latestTranscriptRun, ["duration_ms", "durationMs"]);
  const pipelineVersion =
    extractRunMetaString(latestVerseRun, ["pipeline_version", "pipelineVersion"]) ||
    extractRunMetaString(latestTranscriptRun, ["pipeline_version", "pipelineVersion"]);

  const hasProcessing =
    runs.some((run) => isProcessingStatus(run.status)) ||
    isProcessingStatus(video?.indexing_status) ||
    isProcessingStatus(video?.transcript_status) ||
    isProcessingStatus(video?.verse_status);

  if (hasProcessing) {
    return {
      status: "processing",
      indexingRunId: latestRun?.id || null,
      errorCode: null,
      errorMessage: null,
      transcriptJson: transcriptOutput,
      ocrJson: ocrOutput,
      transcriptCount,
      ocrCount,
      transcriptSource,
      laneUsed,
      durationMs,
      pipelineVersion,
      video,
      runs,
    };
  }

  if (
    isFailedStatus(latestVerseRun?.status) ||
    isFailedStatus(latestTranscriptRun?.status) ||
    isFailedStatus(video?.indexing_status) ||
    isFailedStatus(video?.verse_status) ||
    isFailedStatus(video?.transcript_status)
  ) {
    const failureRun =
      (latestVerseRun && isFailedStatus(latestVerseRun.status) ? latestVerseRun : null) ||
      (latestTranscriptRun && isFailedStatus(latestTranscriptRun.status) ? latestTranscriptRun : null) ||
      (runs.find((run) => isFailedStatus(run.status)) ?? null);
    const failureCode =
      extractRunMetaString(failureRun, ["error_code", "errorCode", "code"]) ||
      "UPSTREAM_INDEXING_FAILED";
    const failureMessage =
      failureRun?.error_message ||
      video?.error_message ||
      "Upstream indexing failed before producing a qualifying result.";

    return {
      status: "failed",
      indexingRunId: failureRun?.id || latestRun?.id || null,
      errorCode: failureCode,
      errorMessage: failureMessage,
      transcriptJson: transcriptOutput,
      ocrJson: ocrOutput,
      transcriptCount,
      ocrCount,
      transcriptSource,
      laneUsed,
      durationMs,
      pipelineVersion,
      video,
      runs,
    };
  }

  if (
    isCompleteStatus(latestVerseRun?.status) ||
    isCompleteStatus(video?.indexing_status) ||
    (isCompleteStatus(video?.transcript_status) && isCompleteStatus(video?.verse_status))
  ) {
    return {
      status: "complete",
      indexingRunId: latestVerseRun?.id || latestRun?.id || null,
      errorCode: null,
      errorMessage: null,
      transcriptJson: transcriptOutput,
      ocrJson: ocrOutput,
      transcriptCount,
      ocrCount,
      transcriptSource,
      laneUsed,
      durationMs,
      pipelineVersion,
      video,
      runs,
    };
  }

  return {
    status: "processing",
    indexingRunId: latestRun?.id || null,
    errorCode: null,
    errorMessage: null,
    transcriptJson: transcriptOutput,
    ocrJson: ocrOutput,
    transcriptCount,
    ocrCount,
    transcriptSource,
    laneUsed,
    durationMs,
    pipelineVersion,
    video,
    runs,
  };
}

async function loadAuthoritativeUpstreamResult(input: {
  supabaseService: SupabaseServiceClient;
  youtubeUrl: string;
  youtubeVideoId: string;
  sourceVideoId: string | null;
  indexerBody: unknown;
}): Promise<UpstreamTerminalResult> {
  const { supabaseService, youtubeUrl, youtubeVideoId, sourceVideoId, indexerBody } = input;
  const responseVideoId = normalizeString(
    pickFirst(indexerBody, ["videoId", "video_id", "id", "video.id"])
  );

  const findVideoByFilter = async (
    column: "id" | "source_video_id" | "external_video_id",
    value: string
  ): Promise<UpstreamVideoRow | null> => {
    const { data, error } = await supabaseService
      .from("videos")
      .select(
        "id, source_video_id, external_video_id, indexing_status, transcript_status, verse_status, error_message, updated_at"
      )
      .eq(column, value)
      .limit(2);

    if (error) {
      throw new HttpError(
        500,
        "UPSTREAM_VIDEO_LOOKUP_FAILED",
        `Failed to inspect videos: ${error.message}`
      );
    }

    const rows = (data || []) as UpstreamVideoRow[];
    return rows[0] || null;
  };

  const video =
    (responseVideoId ? await findVideoByFilter("id", responseVideoId) : null) ||
    (sourceVideoId ? await findVideoByFilter("source_video_id", sourceVideoId) : null) ||
    (await findVideoByFilter("external_video_id", youtubeVideoId)) ||
    (await findVideoByFilter("source_video_id", youtubeVideoId));

  if (!video) {
    return buildAuthoritativeResult(youtubeUrl, null, [], []);
  }

  const [{ data: runs, error: runsError }, { data: outputs, error: outputsError }] =
    await Promise.all([
      supabaseService
        .from("indexing_runs")
        .select("id, video_id, phase, status, error_message, duration_ms, meta, created_at")
        .eq("video_id", video.id)
        .order("created_at", { ascending: false })
        .limit(12),
      supabaseService
        .from("indexing_outputs")
        .select("id, video_id, indexing_run_id, output_type, payload, created_at")
        .eq("video_id", video.id)
        .order("created_at", { ascending: false }),
    ]);

  if (runsError) {
    throw new HttpError(
      500,
      "UPSTREAM_RUN_LOOKUP_FAILED",
      `Failed to inspect indexing_runs: ${runsError.message}`
    );
  }
  if (outputsError) {
    throw new HttpError(
      500,
      "UPSTREAM_OUTPUT_LOOKUP_FAILED",
      `Failed to inspect indexing_outputs: ${outputsError.message}`
    );
  }

  return buildAuthoritativeResult(
    youtubeUrl,
    video,
    ((runs || []) as UpstreamIndexingRunRow[]),
    ((outputs || []) as UpstreamIndexingOutputRow[])
  );
}

async function snapshotAuthoritativeUpstreamResult(input: {
  supabaseService: SupabaseServiceClient;
  testRunId: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  sourceVideoId: string | null;
  indexerBody: unknown;
}): Promise<UpstreamTerminalResult> {
  const result = await loadAuthoritativeUpstreamResult(input);
  await appendLog(input.supabaseService, input.testRunId, "info", "snapshot authoritative upstream state", {
    videoId: result.video?.id || null,
    indexingRunId: result.indexingRunId,
    resolvedStatus: result.status,
    indexingStatus: result.video?.indexing_status || null,
    transcriptStatus: result.video?.transcript_status || null,
    verseStatus: result.video?.verse_status || null,
  });
  return result;
}

async function resolveAndPersistAuthoritativeResult(input: {
  supabaseService: SupabaseServiceClient;
  testRunId: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  sourceVideoId: string | null;
  indexerBody: unknown;
  placeholderCode: string | null;
  placeholderMessage: string | null;
  placeholderStatus: number | null;
}) {
  const { supabaseService, testRunId, youtubeUrl, youtubeVideoId, sourceVideoId, indexerBody, placeholderCode, placeholderMessage, placeholderStatus } =
    input;

  await appendLog(supabaseService, testRunId, "info", "resolving authoritative upstream state", {
    placeholderCode,
    placeholderMessage,
    placeholderStatus,
  });

  const authoritativeResult = await snapshotAuthoritativeUpstreamResult({
    supabaseService,
    testRunId,
    youtubeUrl,
    youtubeVideoId,
    sourceVideoId,
    indexerBody,
  });

  if (authoritativeResult.status === "processing") {
    await updateTestRun(supabaseService, testRunId, {
      status: "processing",
      indexingRunId: authoritativeResult.indexingRunId,
      pipelineVersion: authoritativeResult.pipelineVersion,
      transcriptCount: authoritativeResult.transcriptCount,
      ocrCount: authoritativeResult.ocrCount,
      transcriptSource: authoritativeResult.transcriptSource,
      laneUsed: authoritativeResult.laneUsed,
      durationMs: authoritativeResult.durationMs,
      errorCode: null,
      errorMessage: null,
    });

    await appendLog(supabaseService, testRunId, "warn", "upstream result still processing", {
      indexingRunId: authoritativeResult.indexingRunId,
      videoId: authoritativeResult.video?.id || null,
      indexingStatus: authoritativeResult.video?.indexing_status || null,
      transcriptStatus: authoritativeResult.video?.transcript_status || null,
      verseStatus: authoritativeResult.video?.verse_status || null,
    });

    return jsonResponse({
      testRunId,
      status: "processing",
      metrics: {
        transcriptCount: authoritativeResult.transcriptCount,
        ocrCount: authoritativeResult.ocrCount,
        transcriptSource: authoritativeResult.transcriptSource,
        laneUsed: authoritativeResult.laneUsed,
        durationMs: authoritativeResult.durationMs,
        indexingRunId: authoritativeResult.indexingRunId,
        pipelineVersion: authoritativeResult.pipelineVersion,
      },
    });
  }

  await upsertTestOutputs(
    supabaseService,
    testRunId,
    authoritativeResult.transcriptJson,
    authoritativeResult.ocrJson
  );

  await appendLog(supabaseService, testRunId, "info", "stored outputs", {
    transcriptCount: authoritativeResult.transcriptCount,
    ocrCount: authoritativeResult.ocrCount,
  });

  if (authoritativeResult.status === "failed") {
    await updateTestRun(supabaseService, testRunId, {
      status: "failed",
      indexingRunId: authoritativeResult.indexingRunId,
      pipelineVersion: authoritativeResult.pipelineVersion,
      transcriptCount: authoritativeResult.transcriptCount,
      ocrCount: authoritativeResult.ocrCount,
      transcriptSource: authoritativeResult.transcriptSource,
      laneUsed: authoritativeResult.laneUsed,
      durationMs: authoritativeResult.durationMs,
      errorCode: authoritativeResult.errorCode,
      errorMessage: authoritativeResult.errorMessage,
    });

    await appendLog(supabaseService, testRunId, "error", "resolved upstream failure", {
      errorCode: authoritativeResult.errorCode,
      errorMessage: authoritativeResult.errorMessage,
      indexingRunId: authoritativeResult.indexingRunId,
      videoId: authoritativeResult.video?.id || null,
    });

    return jsonResponse({
      testRunId,
      status: "failed",
      metrics: {
        transcriptCount: authoritativeResult.transcriptCount,
        ocrCount: authoritativeResult.ocrCount,
        transcriptSource: authoritativeResult.transcriptSource,
        laneUsed: authoritativeResult.laneUsed,
        durationMs: authoritativeResult.durationMs,
        indexingRunId: authoritativeResult.indexingRunId,
        pipelineVersion: authoritativeResult.pipelineVersion,
      },
      error: {
        code: authoritativeResult.errorCode,
        message: authoritativeResult.errorMessage,
      },
    });
  }

  await updateTestRun(supabaseService, testRunId, {
    status: "complete",
    indexingRunId: authoritativeResult.indexingRunId,
    pipelineVersion: authoritativeResult.pipelineVersion,
    transcriptCount: authoritativeResult.transcriptCount,
    ocrCount: authoritativeResult.ocrCount,
    transcriptSource: authoritativeResult.transcriptSource,
    laneUsed: authoritativeResult.laneUsed,
    durationMs: authoritativeResult.durationMs,
    errorCode: null,
    errorMessage: null,
  });

  const metrics = {
    transcriptCount: authoritativeResult.transcriptCount,
    ocrCount: authoritativeResult.ocrCount,
    transcriptSource: authoritativeResult.transcriptSource,
    laneUsed: authoritativeResult.laneUsed,
    durationMs: authoritativeResult.durationMs,
    indexingRunId: authoritativeResult.indexingRunId,
    pipelineVersion: authoritativeResult.pipelineVersion,
  };

  await appendLog(supabaseService, testRunId, "info", "run complete", {
    status: "complete",
    metrics,
  });

  return jsonResponse({
    testRunId,
    status: "complete",
    metrics,
  });
}

async function callIndexer(input: {
  functionName: string;
  supabaseUrl: string;
  authToken: string;
  apiKey: string;
  payloads: Record<string, unknown>[];
}) {
  const { functionName, supabaseUrl, authToken, apiKey, payloads } = input;
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const requestTimeoutMs = readEnvInteger(
    "ADMIN_INDEXING_INDEXER_TIMEOUT_MS",
    25_000,
    5_000,
    600_000
  );
  const maxRetriesPerPayload = readEnvInteger("ADMIN_INDEXING_INDEXER_MAX_RETRIES", 2, 0, 6);
  const retryDelayMs = readEnvInteger(
    "ADMIN_INDEXING_INDEXER_RETRY_DELAY_MS",
    1_200,
    100,
    30_000
  );

  const attempts: Array<{
    payloadKeys: string[];
    status: number;
    body: unknown;
    retryAttempt: number;
    retryReason: string | null;
  }> = [];

  for (const payload of payloads) {
    for (let retryAttempt = 0; retryAttempt <= maxRetriesPerPayload; retryAttempt += 1) {
      let status = 500;
      let parsedBody: unknown = null;

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            apikey: apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        status = response.status;
        const rawBody = await response.text();
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }

        const retryReason = classifyRetryReason(status, parsedBody);
        attempts.push({
          payloadKeys: Object.keys(payload),
          status,
          body: parsedBody,
          retryAttempt,
          retryReason,
        });

        if (response.ok) {
          return {
            ok: true,
            status,
            body: parsedBody,
            attempts,
          };
        }

        if (retryReason && retryAttempt < maxRetriesPerPayload) {
          await sleep(retryDelayMs * (retryAttempt + 1));
          continue;
        }
      } catch (error) {
        const aborted =
          error instanceof DOMException
            ? error.name === "AbortError"
            : String(error).includes("AbortError");

        status = aborted ? 504 : 502;
        parsedBody = aborted
          ? {
              code: "INDEXER_TIMEOUT",
              error: `Indexer call timed out after ${requestTimeoutMs}ms`,
            }
          : {
              code: "INDEXER_NETWORK_ERROR",
              error: `Indexer network error: ${String(error)}`,
            };

        const retryReason = classifyRetryReason(status, parsedBody);
        attempts.push({
          payloadKeys: Object.keys(payload),
          status,
          body: parsedBody,
          retryAttempt,
          retryReason,
        });

        if (retryReason && retryAttempt < maxRetriesPerPayload) {
          await sleep(retryDelayMs * (retryAttempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timeoutHandle);
      }

      break;
    }
  }

  return {
    ok: false,
    status: attempts[attempts.length - 1]?.status || 500,
    body: attempts[attempts.length - 1]?.body || null,
    attempts,
  };
}

serve(async (req) => {
  let testRunId: string | null = null;
  let supabaseService: SupabaseServiceClient | null = null;

  try {
    const adminContext = await verifyAdmin(req);
    const { user, accessToken } = adminContext;
    supabaseService = adminContext.supabaseService;

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body: AdminIndexingTestRunRequest = {};
    try {
      body = (await req.json()) as AdminIndexingTestRunRequest;
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
    }

    const youtubeUrl = normalizeString(body.youtubeUrl);
    if (!youtubeUrl) {
      throw new HttpError(400, "YOUTUBE_URL_REQUIRED", "youtubeUrl is required");
    }

    const youtubeVideoId = extractYoutubeVideoId(youtubeUrl);
    if (!youtubeVideoId) {
      throw new HttpError(400, "INVALID_YOUTUBE_URL", "Unable to extract youtubeVideoId");
    }

    const sourceVideoId = normalizeString(body.sourceVideoId);
    const options = asRecord(body.options) ? (body.options as IndexingTestOptions) : {};
    const optionsRecord = asRecord(options) || {};
    const partnerChannelId =
      normalizeString(body.partnerChannelId) ||
      normalizeString(body.partner_channel_id) ||
      normalizeString(optionsRecord.partnerChannelId) ||
      normalizeString(optionsRecord.partner_channel_id);
    const requestedByUserIdRaw = normalizeString(body.requestedByUserId);
    const runMode: RunMode =
      body.runMode === "personal" || body.runMode === "public" || body.runMode === "admin_test"
        ? body.runMode
        : "admin_test";

    if (runMode === "personal") {
      if (!requestedByUserIdRaw) {
        throw new HttpError(
          400,
          "REQUESTED_BY_USER_ID_REQUIRED",
          "requestedByUserId is required when runMode is personal"
        );
      }
      if (!isUuid(requestedByUserIdRaw)) {
        throw new HttpError(
          400,
          "REQUESTED_BY_USER_ID_INVALID",
          "requestedByUserId must be a valid UUID"
        );
      }
      if (requestedByUserIdRaw !== user.id) {
        throw new HttpError(
          403,
          "REQUESTED_BY_USER_ID_MISMATCH",
          "requestedByUserId must match the authenticated admin user for personal runs"
        );
      }
    }

    const requestedByUserId = requestedByUserIdRaw || user.id;

    const { data: createdRun, error: createRunError } = await supabaseService
      .from("indexing_test_runs")
      .insert({
        requested_by_user_id: requestedByUserId,
        youtube_url: youtubeUrl,
        youtube_video_id: youtubeVideoId,
        source_video_id: sourceVideoId,
        run_mode: runMode,
        status: "processing",
      })
      .select("id")
      .single();

    if (createRunError || !createdRun) {
      throw new HttpError(
        500,
        "RUN_CREATE_FAILED",
        `Failed to create indexing_test_runs row: ${createRunError?.message || "unknown"}`
      );
    }

    testRunId = createdRun.id as string;

    await appendLog(supabaseService, testRunId, "info", "run started", {
      youtubeUrl,
      youtubeVideoId,
      sourceVideoId,
      partnerChannelId,
      runMode,
      requestedByUserId,
      options: summarizeOptions(options),
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new HttpError(
        500,
        "MISSING_ENV",
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for indexer calls"
      );
    }
    if (runMode === "personal" && !supabaseAnonKey) {
      throw new HttpError(
        500,
        "MISSING_ENV",
        "SUPABASE_ANON_KEY is required for personal indexer calls"
      );
    }

    const functionName = runMode === "personal" ? "index_personal_video" : "index_video";
    await appendLog(supabaseService, testRunId, "info", "calling indexer", {
      functionName,
      runMode,
    });

    const payloads = buildIndexerPayloads({
      youtubeUrl,
      youtubeVideoId,
      sourceVideoId,
      partnerChannelId,
      runMode,
      requestedByUserId: runMode === "personal" ? requestedByUserId : null,
      options,
    });

    const indexerResult = await callIndexer({
      functionName,
      supabaseUrl,
      authToken: runMode === "personal" ? accessToken : supabaseServiceKey,
      apiKey: runMode === "personal" ? (supabaseAnonKey as string) : supabaseServiceKey,
      payloads,
    });

    await appendLog(supabaseService, testRunId, "info", "indexer response received", {
      indexerStatus: indexerResult.status,
      attempts: indexerResult.attempts.length,
      successful: indexerResult.ok,
      lastAttempt:
        indexerResult.attempts.length > 0
          ? indexerResult.attempts[indexerResult.attempts.length - 1]
          : null,
    });

    if (!indexerResult.ok) {
      if (isAuthoritativeResolutionCandidate(indexerResult.status, indexerResult.body)) {
        return await resolveAndPersistAuthoritativeResult({
          supabaseService,
          testRunId,
          youtubeUrl,
          youtubeVideoId,
          sourceVideoId,
          indexerBody: indexerResult.body,
          placeholderCode: extractIndexerCode(indexerResult.body),
          placeholderMessage: buildIndexerErrorMessage(indexerResult.status, indexerResult.body),
          placeholderStatus: indexerResult.status,
        });
      }

      const detailsMessage = buildIndexerErrorMessage(indexerResult.status, indexerResult.body);
      throw new HttpError(502, "INDEXER_CALL_FAILED", detailsMessage);
    }

    const responseBody = indexerResult.body;
    const nonOkPayload = classifyIndexerNonOkPayload(indexerResult.body);
    const shouldResolveAuthoritativeState =
      nonOkPayload?.code === "INDEXER_ALREADY_PROCESSING" && !hasInlineOutputs(responseBody);

    if (shouldResolveAuthoritativeState) {
      return await resolveAndPersistAuthoritativeResult({
        supabaseService,
        testRunId,
        youtubeUrl,
        youtubeVideoId,
        sourceVideoId,
        indexerBody: responseBody,
        placeholderCode: nonOkPayload?.code || null,
        placeholderMessage: nonOkPayload?.message || null,
        placeholderStatus: nonOkPayload?.status || null,
      });
    }

    if (nonOkPayload) {
      await appendLog(supabaseService, testRunId, "error", "indexer returned non-ok payload", {
        code: nonOkPayload.code,
        message: nonOkPayload.message,
        status: nonOkPayload.status,
        raw: indexerResult.body,
      });
      throw new HttpError(nonOkPayload.status, nonOkPayload.code, nonOkPayload.message);
    }

    const directHasInlineOutputs = hasInlineOutputs(responseBody);
    const { transcriptJson, ocrJson } = extractInlineOutput(responseBody, youtubeUrl);
    const transcriptCount = countOccurrences(transcriptJson);
    const ocrCount = countOccurrences(ocrJson);
    const transcriptSource = normalizeString(
      pickFirst(responseBody, [
        "metrics.transcript_source",
        "metrics.transcriptSource",
        "transcript_source",
        "transcriptSource",
        "transcript_occurrences_json.transcript_source",
        "transcript_occurrences_json.transcriptSource",
        "transcriptOccurrencesJson.transcript_source",
        "transcriptOccurrencesJson.transcriptSource",
        "transcriptMatchedOn",
      ])
    );
    const laneUsed = normalizeString(
      pickFirst(responseBody, [
        "metrics.lane_used",
        "metrics.laneUsed",
        "lane_used",
        "laneUsed",
        "lane",
      ])
    );
    const durationMs = normalizeInteger(
      pickFirst(responseBody, [
        "metrics.duration_ms",
        "metrics.durationMs",
        "duration_ms",
        "durationMs",
      ])
    );
    const pipelineVersion = normalizeString(
      pickFirst(responseBody, [
        "pipeline_version",
        "pipelineVersion",
        "metrics.pipeline_version",
        "metrics.pipelineVersion",
      ])
    );
    const indexingRunIdCandidate = normalizeString(
      pickFirst(responseBody, [
        "indexing_run_id",
        "indexingRunId",
        "metrics.indexing_run_id",
        "metrics.indexingRunId",
        "run_id",
        "runId",
        "indexingRun.id",
      ])
    );
    const indexingRunId =
      indexingRunIdCandidate && isUuid(indexingRunIdCandidate) ? indexingRunIdCandidate : null;
    const shouldSupplementFromAuthoritative =
      !directHasInlineOutputs ||
      !indexingRunId ||
      (transcriptCount > 0 && (!transcriptSource || !laneUsed));

    let finalTranscriptJson = transcriptJson;
    let finalOcrJson = ocrJson;
    let finalTranscriptCount = transcriptCount;
    let finalOcrCount = ocrCount;
    let finalTranscriptSource = transcriptSource;
    let finalLaneUsed = laneUsed;
    let finalDurationMs = durationMs;
    let finalIndexingRunId = indexingRunId;
    let finalPipelineVersion = pipelineVersion;

    if (shouldSupplementFromAuthoritative) {
      const authoritativeResult = await snapshotAuthoritativeUpstreamResult({
        supabaseService,
        testRunId,
        youtubeUrl,
        youtubeVideoId,
        sourceVideoId,
        indexerBody: responseBody,
      });

      if (authoritativeResult.status === "complete") {
        if (!directHasInlineOutputs) {
          finalTranscriptJson = authoritativeResult.transcriptJson;
          finalOcrJson = authoritativeResult.ocrJson;
          finalTranscriptCount = authoritativeResult.transcriptCount;
          finalOcrCount = authoritativeResult.ocrCount;
        }
        finalTranscriptSource = finalTranscriptSource || authoritativeResult.transcriptSource;
        finalLaneUsed = finalLaneUsed || authoritativeResult.laneUsed;
        finalDurationMs = finalDurationMs ?? authoritativeResult.durationMs;
        finalIndexingRunId = finalIndexingRunId || authoritativeResult.indexingRunId;
        finalPipelineVersion = finalPipelineVersion || authoritativeResult.pipelineVersion;

        await appendLog(
          supabaseService,
          testRunId,
          "info",
          "supplemented successful response from authoritative upstream state",
          {
            indexingRunId: finalIndexingRunId,
            transcriptCount: finalTranscriptCount,
            ocrCount: finalOcrCount,
            transcriptSource: finalTranscriptSource,
            laneUsed: finalLaneUsed,
            usedInlineOutputs: directHasInlineOutputs,
          }
        );
      } else {
        await appendLog(
          supabaseService,
          testRunId,
          "warn",
          "authoritative supplement unavailable for successful response",
          {
            resolvedStatus: authoritativeResult.status,
            indexingRunId: authoritativeResult.indexingRunId,
            usedInlineOutputs: directHasInlineOutputs,
          }
        );
      }
    }

    await upsertTestOutputs(supabaseService, testRunId, finalTranscriptJson, finalOcrJson);

    await appendLog(supabaseService, testRunId, "info", "stored outputs", {
      transcriptCount: finalTranscriptCount,
      ocrCount: finalOcrCount,
    });

    await updateTestRun(supabaseService, testRunId, {
      status: "complete",
      indexingRunId: finalIndexingRunId,
      pipelineVersion: finalPipelineVersion,
      transcriptCount: finalTranscriptCount,
      ocrCount: finalOcrCount,
      transcriptSource: finalTranscriptSource,
      laneUsed: finalLaneUsed,
      durationMs: finalDurationMs,
      errorCode: null,
      errorMessage: null,
    });

    const metrics = {
      transcriptCount: finalTranscriptCount,
      ocrCount: finalOcrCount,
      transcriptSource: finalTranscriptSource,
      laneUsed: finalLaneUsed,
      durationMs: finalDurationMs,
      indexingRunId: finalIndexingRunId,
      pipelineVersion: finalPipelineVersion,
    };

    await appendLog(supabaseService, testRunId, "info", "run complete", {
      status: "complete",
      metrics,
    });

    return jsonResponse({
      testRunId,
      status: "complete",
      metrics,
    });
  } catch (error) {
    console.error("admin_indexing_test_run error:", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    const code = error instanceof HttpError ? error.code : "UNEXPECTED_ERROR";
    const status = error instanceof HttpError
      ? error.status
      : message.includes("not an admin")
        ? 403
        : message.includes("Invalid") || message.includes("Authorization")
          ? 401
          : 500;

    if (testRunId && supabaseService) {
      await appendLog(supabaseService, testRunId, "error", "run failed", {
        errorCode: code,
        errorMessage: message,
        httpStatus: status,
      });

      const { error: runFailUpdateError } = await supabaseService
        .from("indexing_test_runs")
        .update({
          status: "failed",
          error_code: code,
          error_message: message,
        })
        .eq("id", testRunId);

      if (runFailUpdateError) {
        console.error(
          "Failed to mark indexing_test_runs row as failed:",
          runFailUpdateError.message
        );
      }
    }

    return jsonResponse(
      {
        error: message,
        code,
        testRunId,
      },
      status
    );
  }
});
