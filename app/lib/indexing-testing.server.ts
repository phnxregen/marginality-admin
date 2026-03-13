import { getServiceClient } from "~/lib/supabase.server";
import { assessIndexingTestRun } from "~/lib/indexing-test-qualification";
import {
  reconcileIndexingTestRun,
  reconcileIndexingTestRuns,
} from "~/lib/indexing-test-reconciliation.server";

export type IndexingTestRunRow = {
  id: string;
  created_at: string;
  updated_at: string;
  requested_by_user_id: string | null;
  youtube_url: string;
  youtube_video_id: string;
  source_video_id: string | null;
  run_mode: "admin_test" | "public" | "personal";
  status: "queued" | "processing" | "complete" | "failed";
  indexing_run_id: string | null;
  contract_version: string;
  pipeline_version: string | null;
  error_code: string | null;
  error_message: string | null;
  transcript_count: number;
  ocr_count: number;
  transcript_source: string | null;
  lane_used: string | null;
  duration_ms: number | null;
};

export type IndexingTestOutputRow = {
  test_run_id: string;
  created_at: string;
  transcript_json: unknown;
  ocr_json: unknown;
};

export type IndexingTestTranscriptDebugRow = {
  id: string;
  video_id: string;
  indexing_run_id: string;
  output_type: "transcript_debug";
  payload: unknown;
  created_at: string;
};

export type IndexingTestLogRow = {
  id: string;
  test_run_id: string;
  t: string;
  level: string;
  msg: string;
  data: Record<string, unknown> | null;
};

export type IndexingTestFixtureRow = {
  id: string;
  created_at: string;
  name: string;
  youtube_video_id: string;
  youtube_url: string;
  expected_transcript_json: unknown;
  expected_ocr_json: unknown;
  contract_version: string;
  pipeline_version: string | null;
  notes: string | null;
  tags: string[];
};

export type CreateIndexingFixtureInput = {
  testRunId: string;
  name: string;
  notes?: string | null;
  tags?: string[];
};

export type StartIndexingTestRunPayload = {
  youtubeUrl: string;
  sourceVideoId?: string;
  partnerChannelId?: string;
  runMode?: "admin_test" | "public" | "personal";
  requestedByUserId?: string;
  options?: Record<string, unknown>;
};

type StartIndexingTestRunResult = {
  testRunId: string;
  status: string;
  metrics?: Record<string, unknown>;
  error?: unknown;
};

function needsRunReconciliation(run: IndexingTestRunRow): boolean {
  if (run.status === "processing") {
    return true;
  }

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getSupabaseUrl(): string {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required for server-side indexing testing operations.");
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

async function resolveUpstreamVideoId(input: {
  youtubeVideoId: string;
  sourceVideoId: string | null;
}): Promise<string | null> {
  const supabase = getServiceClient();
  const findVideo = async (
    column: "source_video_id" | "external_video_id",
    value: string
  ): Promise<string | null> => {
    const { data, error } = await supabase
      .from("videos")
      .select("id")
      .eq(column, value)
      .limit(1);

    if (error) {
      throw new Error(`Failed to resolve upstream video: ${error.message}`);
    }

    const row = (data || [])[0] as { id: string } | undefined;
    return row?.id || null;
  };

  return (
    (input.sourceVideoId ? await findVideo("source_video_id", input.sourceVideoId) : null) ||
    (await findVideo("external_video_id", input.youtubeVideoId)) ||
    (await findVideo("source_video_id", input.youtubeVideoId))
  );
}

export async function listIndexingTestRuns(limit = 50): Promise<IndexingTestRunRow[]> {
  const supabase = getServiceClient();
  const safeLimit = Math.max(1, Math.min(limit, 200));

  const selectClause =
    "id, created_at, updated_at, requested_by_user_id, youtube_url, youtube_video_id, source_video_id, run_mode, status, indexing_run_id, contract_version, pipeline_version, error_code, error_message, transcript_count, ocr_count, transcript_source, lane_used, duration_ms";

  const fetchRuns = async () => {
    const { data, error } = await supabase
      .from("indexing_test_runs")
      .select(selectClause)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      throw new Error(`Failed to list indexing test runs: ${error.message}`);
    }

    return (data || []) as IndexingTestRunRow[];
  };

  const runs = await fetchRuns();
  const runIdsNeedingReconciliation = runs
    .filter((run) => needsRunReconciliation(run))
    .map((run) => run.id);
  if (runIdsNeedingReconciliation.length > 0) {
    await reconcileIndexingTestRuns(runIdsNeedingReconciliation);
    return await fetchRuns();
  }

  return runs;
}

export async function getIndexingTestRun(id: string): Promise<IndexingTestRunRow | null> {
  const supabase = getServiceClient();
  const runId = assertId(id, "run id");

  const selectClause =
    "id, created_at, updated_at, requested_by_user_id, youtube_url, youtube_video_id, source_video_id, run_mode, status, indexing_run_id, contract_version, pipeline_version, error_code, error_message, transcript_count, ocr_count, transcript_source, lane_used, duration_ms";

  const fetchRun = async () => {
    const { data, error } = await supabase
      .from("indexing_test_runs")
      .select(selectClause)
      .eq("id", runId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load indexing test run: ${error.message}`);
    }

    return (data as IndexingTestRunRow | null) || null;
  };

  const run = await fetchRun();
  if (run && needsRunReconciliation(run)) {
    await reconcileIndexingTestRun(run.id);
    return await fetchRun();
  }

  return run;
}

export async function getIndexingTestOutputs(
  testRunId: string
): Promise<IndexingTestOutputRow | null> {
  const supabase = getServiceClient();
  const runId = assertId(testRunId, "testRunId");

  const { data, error } = await supabase
    .from("indexing_test_outputs")
    .select("test_run_id, created_at, transcript_json, ocr_json")
    .eq("test_run_id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load indexing test outputs: ${error.message}`);
  }

  return (data as IndexingTestOutputRow | null) || null;
}

export async function getIndexingTestTranscriptDebug(
  run: Pick<IndexingTestRunRow, "indexing_run_id" | "youtube_video_id" | "source_video_id">
): Promise<IndexingTestTranscriptDebugRow | null> {
  const supabase = getServiceClient();

  if (run.indexing_run_id) {
    const { data, error } = await supabase
      .from("indexing_outputs")
      .select("id, video_id, indexing_run_id, output_type, payload, created_at")
      .eq("indexing_run_id", run.indexing_run_id)
      .eq("output_type", "transcript_debug")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Failed to load transcript debug output: ${error.message}`);
    }

    const byRunId = ((data || [])[0] as IndexingTestTranscriptDebugRow | undefined) || null;
    if (byRunId) {
      return byRunId;
    }
  }

  const upstreamVideoId = await resolveUpstreamVideoId({
    youtubeVideoId: run.youtube_video_id,
    sourceVideoId: run.source_video_id,
  });
  if (!upstreamVideoId) {
    return null;
  }

  const { data, error } = await supabase
    .from("indexing_outputs")
    .select("id, video_id, indexing_run_id, output_type, payload, created_at")
    .eq("video_id", upstreamVideoId)
    .eq("output_type", "transcript_debug")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load transcript debug output: ${error.message}`);
  }

  return ((data || [])[0] as IndexingTestTranscriptDebugRow | undefined) || null;
}

export async function getIndexingTestLogs(testRunId: string): Promise<IndexingTestLogRow[]> {
  const supabase = getServiceClient();
  const runId = assertId(testRunId, "testRunId");

  const { data, error } = await supabase
    .from("indexing_test_logs")
    .select("id, test_run_id, t, level, msg, data")
    .eq("test_run_id", runId)
    .order("t", { ascending: true });

  if (error) {
    throw new Error(`Failed to load indexing test logs: ${error.message}`);
  }

  return (data || []) as IndexingTestLogRow[];
}

export async function listIndexingFixtures(limit = 50): Promise<IndexingTestFixtureRow[]> {
  const supabase = getServiceClient();
  const safeLimit = Math.max(1, Math.min(limit, 200));

  const { data, error } = await supabase
    .from("indexing_test_fixtures")
    .select(
      "id, created_at, name, youtube_video_id, youtube_url, expected_transcript_json, expected_ocr_json, contract_version, pipeline_version, notes, tags"
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list indexing fixtures: ${error.message}`);
  }

  return (data || []) as IndexingTestFixtureRow[];
}

export async function getIndexingFixture(id: string): Promise<IndexingTestFixtureRow | null> {
  const supabase = getServiceClient();
  const fixtureId = assertId(id, "fixture id");

  const { data, error } = await supabase
    .from("indexing_test_fixtures")
    .select(
      "id, created_at, name, youtube_video_id, youtube_url, expected_transcript_json, expected_ocr_json, contract_version, pipeline_version, notes, tags"
    )
    .eq("id", fixtureId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load fixture: ${error.message}`);
  }

  return (data as IndexingTestFixtureRow | null) || null;
}

export async function createIndexingFixtureFromRun(
  input: CreateIndexingFixtureInput
): Promise<IndexingTestFixtureRow> {
  const supabase = getServiceClient();
  const runId = assertId(input.testRunId, "testRunId");
  const fixtureName = assertId(input.name, "name");

  const [run, outputs] = await Promise.all([
    getIndexingTestRun(runId),
    getIndexingTestOutputs(runId),
  ]);

  if (!run) {
    throw new Error("Run not found");
  }

  if (!outputs) {
    throw new Error("Run outputs not found");
  }

  const assessment = assessIndexingTestRun(run);
  if (!assessment.canCreateFixture) {
    throw new Error(`Run is not fixture-eligible: ${assessment.summary}`);
  }

  const tags = Array.isArray(input.tags) ? input.tags.filter((tag) => tag.trim().length > 0) : [];

  const { data, error } = await supabase
    .from("indexing_test_fixtures")
    .insert({
      name: fixtureName,
      youtube_video_id: run.youtube_video_id,
      youtube_url: run.youtube_url,
      expected_transcript_json: outputs.transcript_json,
      expected_ocr_json: outputs.ocr_json,
      contract_version: run.contract_version || "v1",
      pipeline_version: run.pipeline_version,
      notes: input.notes ?? null,
      tags,
    })
    .select(
      "id, created_at, name, youtube_video_id, youtube_url, expected_transcript_json, expected_ocr_json, contract_version, pipeline_version, notes, tags"
    )
    .single();

  if (error || !data) {
    throw new Error(`Failed to create fixture: ${error?.message || "unknown error"}`);
  }

  return data as IndexingTestFixtureRow;
}

export async function startIndexingTestRun(
  accessToken: string,
  payload: StartIndexingTestRunPayload
): Promise<StartIndexingTestRunResult> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error("Access token is required");
  }

  const supabaseUrl = getSupabaseUrl();
  const response = await fetch(`${supabaseUrl}/functions/v1/admin_indexing_test_run`, {
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

  const testRunId = typeof body.testRunId === "string" ? body.testRunId : null;
  const status = typeof body.status === "string" ? body.status : "unknown";
  if (!testRunId) {
    throw new Error("admin_indexing_test_run did not return testRunId");
  }

  return {
    testRunId,
    status,
    metrics: asRecord(body.metrics) || undefined,
    error: body.error,
  };
}
