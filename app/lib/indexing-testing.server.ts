import { getServiceClient } from "~/lib/supabase.server";

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

export async function listIndexingTestRuns(limit = 50): Promise<IndexingTestRunRow[]> {
  const supabase = getServiceClient();
  const safeLimit = Math.max(1, Math.min(limit, 200));

  const { data, error } = await supabase
    .from("indexing_test_runs")
    .select(
      "id, created_at, updated_at, requested_by_user_id, youtube_url, youtube_video_id, source_video_id, run_mode, status, indexing_run_id, contract_version, pipeline_version, error_code, error_message, transcript_count, ocr_count, transcript_source, lane_used, duration_ms"
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list indexing test runs: ${error.message}`);
  }

  return (data || []) as IndexingTestRunRow[];
}

export async function getIndexingTestRun(id: string): Promise<IndexingTestRunRow | null> {
  const supabase = getServiceClient();
  const runId = assertId(id, "run id");

  const { data, error } = await supabase
    .from("indexing_test_runs")
    .select(
      "id, created_at, updated_at, requested_by_user_id, youtube_url, youtube_video_id, source_video_id, run_mode, status, indexing_run_id, contract_version, pipeline_version, error_code, error_message, transcript_count, ocr_count, transcript_source, lane_used, duration_ms"
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load indexing test run: ${error.message}`);
  }

  return (data as IndexingTestRunRow | null) || null;
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
