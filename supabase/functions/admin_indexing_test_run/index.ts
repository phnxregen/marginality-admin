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

async function callIndexer(input: {
  functionName: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  payloads: Record<string, unknown>[];
}) {
  const { functionName, supabaseUrl, supabaseServiceKey, payloads } = input;
  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const attempts: Array<{
    payloadKeys: string[];
    status: number;
    body: unknown;
  }> = [];

  for (const payload of payloads) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
        apikey: supabaseServiceKey,
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.text();
    let parsedBody: unknown = null;

    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    attempts.push({
      payloadKeys: Object.keys(payload),
      status: response.status,
      body: parsedBody,
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        body: parsedBody,
        attempts,
      };
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
    const { user } = adminContext;
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
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new HttpError(
        500,
        "MISSING_ENV",
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for indexer calls"
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
      supabaseServiceKey,
      payloads,
    });

    await appendLog(supabaseService, testRunId, "info", "indexer response received", {
      indexerStatus: indexerResult.status,
      attempts: indexerResult.attempts.length,
      successful: indexerResult.ok,
    });

    if (!indexerResult.ok) {
      const details = asRecord(indexerResult.body);
      const detailsMessage =
        normalizeString(details?.error) ||
        normalizeString(details?.message) ||
        normalizeString(details?.details) ||
        `Indexer call failed with status ${indexerResult.status}`;
      throw new HttpError(502, "INDEXER_CALL_FAILED", detailsMessage);
    }

    const responseBody = indexerResult.body;
    const transcriptJson =
      pickFirst(responseBody, [
        "transcript",
        "transcript_json",
        "transcriptJson",
        "outputs.transcript",
        "outputs.transcript_json",
        "outputs.transcriptJson",
      ]) ?? defaultOccurrencesJson(youtubeUrl);
    const ocrJson =
      pickFirst(responseBody, [
        "ocr",
        "ocr_json",
        "ocrJson",
        "outputs.ocr",
        "outputs.ocr_json",
        "outputs.ocrJson",
      ]) ?? defaultOccurrencesJson(youtubeUrl);

    const { error: upsertOutputsError } = await supabaseService
      .from("indexing_test_outputs")
      .upsert(
        {
          test_run_id: testRunId,
          transcript_json: transcriptJson,
          ocr_json: ocrJson,
        },
        { onConflict: "test_run_id" }
      );

    if (upsertOutputsError) {
      throw new HttpError(
        500,
        "OUTPUTS_STORE_FAILED",
        `Failed to store outputs: ${upsertOutputsError.message}`
      );
    }

    await appendLog(supabaseService, testRunId, "info", "stored outputs", {
      transcriptCount: countOccurrences(transcriptJson),
      ocrCount: countOccurrences(ocrJson),
    });

    const transcriptCount = countOccurrences(transcriptJson);
    const ocrCount = countOccurrences(ocrJson);
    const transcriptSource = normalizeString(
      pickFirst(responseBody, [
        "metrics.transcript_source",
        "metrics.transcriptSource",
        "transcript_source",
        "transcriptSource",
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
        "run_id",
        "runId",
        "indexingRun.id",
      ])
    );
    const indexingRunId =
      indexingRunIdCandidate && isUuid(indexingRunIdCandidate) ? indexingRunIdCandidate : null;

    const { error: updateRunError } = await supabaseService
      .from("indexing_test_runs")
      .update({
        indexing_run_id: indexingRunId,
        pipeline_version: pipelineVersion,
        transcript_count: transcriptCount,
        ocr_count: ocrCount,
        transcript_source: transcriptSource,
        lane_used: laneUsed,
        duration_ms: durationMs,
        status: "complete",
        error_code: null,
        error_message: null,
      })
      .eq("id", testRunId);

    if (updateRunError) {
      throw new HttpError(
        500,
        "RUN_UPDATE_FAILED",
        `Failed to update indexing_test_runs row: ${updateRunError.message}`
      );
    }

    const metrics = {
      transcriptCount,
      ocrCount,
      transcriptSource,
      laneUsed,
      durationMs,
      indexingRunId,
      pipelineVersion,
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
