# Indexing V2 Design Package

Last updated: 2026-03-21

## Purpose

This document resolves the open Indexing V2 contracts into an implementation-ready first pass for the app and admin repos.

It is intentionally opinionated. The goal is to remove architectural ambiguity, not preserve optionality.

## Design Posture

- treat `indexing_runs` as the run anchor
- keep V2 storage relational for traceability
- keep `indexing_outputs` as a compatibility mirror during migration, not the primary V2 store
- make WhisperX admin-triggered and persisted as an async-style job record even when run on one local machine
- keep OCR conservative and deterministic
- keep Gemini constrained to structured extraction and fusion hints on a provided timeline only

## Shared Types

```ts
type TimingAuthority =
  | "whisperx_aligned"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";

type ExecutionMode =
  | "full_alignment"
  | "no_alignment"
  | "admin_forced_alignment"
  | "fallback_only";

type CandidateSourceType = "spoken_explicit" | "allusion" | "ocr";

type RunMode = "admin_test" | "public" | "personal";

type ArtifactType =
  | "raw_transcript_json"
  | "aligned_words_json"
  | "aligned_segments_json"
  | "alignment_metadata_json"
  | "ocr_detections_json"
  | "verse_candidates_json"
  | "resolved_occurrences_json"
  | "snippets_json"
  | "audio_input_file"
  | "manual_audio_override_request"
  | "admin_review_export";

type ArtifactStage =
  | "transcript_acquisition"
  | "alignment"
  | "ocr"
  | "semantic_analysis"
  | "resolution"
  | "review";

type StorageKind = "database_json" | "object_storage" | "external_url" | "local_file";
```

## 1. Audio Acquisition Contract

### Decision

Use a provider interface with a single normalized request/response contract and a fixed ladder.

### Ordering Policy

1. manual override for this run
2. run-scoped cached audio artifact
3. source-video-scoped cached audio artifact
4. upstream media/audio artifact already attached to the source video
5. Cobalt direct extraction
6. `yt-dlp` extractable audio URL
7. `yt-dlp` direct audio download
8. `yt-dlp` muxed download plus deterministic audio extraction
9. secondary extractor provider

Providers later in the ladder do not run after a success.

### Types

```ts
type ManualAudioOverride =
  | {
      override_type: "uploaded_file";
      artifact_id: string;
      provided_by_user_id: string | null;
    }
  | {
      override_type: "presigned_url";
      url: string;
      expires_at: string | null;
      provided_by_user_id: string | null;
    }
  | {
      override_type: "existing_artifact";
      artifact_id: string;
      provided_by_user_id: string | null;
    };

type AudioAcquisitionRequest = {
  run_id: string;
  youtube_video_id: string;
  youtube_url: string;
  source_video_id: string | null;
  manual_override: ManualAudioOverride | null;
  temp_dir: string;
  debug_retain_temps: boolean;
};

type AudioAcquisitionSuccess = {
  status: "success";
  media_kind: "stream_url" | "downloaded_file" | "cached_artifact" | "manual_override";
  audio_uri: string | null;
  local_file_path: string | null;
  storage_artifact_id: string | null;
  container: "m4a" | "mp4" | "webm" | "mp3" | "wav" | "ogg" | null;
  codec: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  cleanup_policy: "delete_on_finalize" | "retain_debug" | "none";
};

type AudioAcquisitionFailureCode =
  | "MANUAL_OVERRIDE_NOT_FOUND"
  | "MANUAL_OVERRIDE_UNREADABLE"
  | "CACHE_MISS"
  | "UPSTREAM_ARTIFACT_NOT_FOUND"
  | "PROVIDER_NOT_SUPPORTED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_GEO_BLOCKED"
  | "MEDIA_UNAVAILABLE"
  | "STREAM_URL_INVALID"
  | "DOWNLOAD_TIMEOUT"
  | "DOWNLOAD_FAILED"
  | "EXTRACTION_FAILED"
  | "INVALID_MEDIA"
  | "IO_ERROR"
  | "UNKNOWN";

type AudioAcquisitionFailure = {
  status: "failed" | "skipped";
  failure_code: AudioAcquisitionFailureCode;
  failure_message: string;
};

type AudioProviderResult = AudioAcquisitionSuccess | AudioAcquisitionFailure;

interface AudioAcquisitionProvider {
  provider_name: string;
  order_index: number;
  acquire(input: AudioAcquisitionRequest): Promise<AudioProviderResult>;
}

type AudioAcquisitionAttempt = {
  id: string;
  run_id: string;
  provider: string;
  order_index: number;
  status: "success" | "failed" | "skipped";
  media_kind: "stream_url" | "downloaded_file" | "cached_artifact" | "manual_override" | null;
  container: "m4a" | "mp4" | "webm" | "mp3" | "wav" | "ogg" | null;
  codec: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  artifact_id: string | null;
  temp_path: string | null;
  cleanup_policy: "delete_on_finalize" | "retain_debug" | "none" | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
};
```

### Cache Reuse Policy

- reuse only successful artifacts with a readable file or URL
- prefer run-local cache before source-video cache
- cache key should be `(source_video_id || youtube_video_id, artifact_role=alignment_audio_input)`
- never reuse failed attempts as cached candidates

### Temp File Policy

- failed provider temp files: delete immediately
- successful temp files: retain until WhisperX job reaches terminal state
- if `debug_retain_temps=true`, mark attempt `cleanup_policy="retain_debug"` and leave the file
- temp paths must never be the only persistent pointer to a successful artifact

### Timestamp Precision

- all stored seconds fields use `numeric(12,3)` semantics
- application values should be serialized as decimal seconds rounded to millisecond precision
- never mix integer seconds and millisecond integers in the same contract

### Manual Override Flow

1. admin submits uploaded file, presigned URL, or existing artifact reference
2. override is stored as a run artifact of type `manual_audio_override_request`
3. acquisition ladder treats it as provider order `0`
4. if override succeeds, downstream providers are skipped
5. if override fails, continue the ladder and retain the failure attempt row

## 2. WhisperX Service Contract

### Decision

Persist an async-style job record even though the first implementation runs on a single controlled worker.

This avoids redesigning the contract when execution later moves off-box.

### Types

```ts
type WhisperXAlignmentRequest = {
  job_id: string;
  run_id: string;
  audio_artifact_id: string;
  transcript_artifact_id: string;
  language_code: string | null;
  requested_by_user_id: string | null;
  force: boolean;
};

type WhisperXJobStatus = "queued" | "processing" | "complete" | "failed";

type WhisperXFailureCode =
  | "AUDIO_NOT_FOUND"
  | "TRANSCRIPT_NOT_FOUND"
  | "WORKER_UNAVAILABLE"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CRASH"
  | "OUTPUT_INVALID"
  | "LOW_CONFIDENCE"
  | "IO_ERROR"
  | "UNKNOWN";

type WhisperXAlignmentJob = {
  job_id: string;
  run_id: string;
  status: WhisperXJobStatus;
  timing_authority: "whisperx_aligned" | "unavailable";
  audio_artifact_id: string | null;
  transcript_artifact_id: string | null;
  aligned_words_artifact_id: string | null;
  aligned_segments_artifact_id: string | null;
  alignment_metadata_artifact_id: string | null;
  aligned_words_json: unknown | null;
  aligned_segments_json: unknown | null;
  confidence_score: number | null;
  failure_code: WhisperXFailureCode | null;
  failure_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};
```

### Timeout Behavior

- hard timeout: `min(max(video_duration_sec * 1.5, 300), 1800)` seconds
- timeout is terminal for the current attempt and records `PROCESS_TIMEOUT`
- timeout does not fail the whole indexing run by default; it downgrades timing authority

### Retry Policy

- no automatic retry for `LOW_CONFIDENCE` or `OUTPUT_INVALID`
- one automatic retry for `PROCESS_CRASH` or transient `IO_ERROR`
- no retry for missing inputs

### Lifecycle

1. create job row as `queued`
2. worker moves job to `processing`
3. on success, persist aligned artifacts and mark `complete`
4. on failure, mark `failed` and set run timing authority fallback

### Artifact Destination

Store WhisperX outputs as run artifacts:

- `aligned_words_json`
- `aligned_segments_json`
- `alignment_metadata_json`

Large JSON can live in object storage, but the artifact row remains the canonical pointer.

### Idempotency And Retry Identity

- uniqueness key: `(run_id, audio_artifact_id, transcript_artifact_id)`
- if a non-terminal job already exists for that key, return it instead of creating a new one
- if a terminal `complete` job exists for that key and `force=false`, return it
- if a terminal `failed` job exists for that key:
  - create one retry only when the failure code is retryable
  - set `retry_of_job_id` in job metadata
- changing either audio artifact or transcript artifact creates a new job identity

## 3. V2 Storage Schema

### Decision

Use normalized relational tables for runs, artifacts, attempts, candidates, and resolved occurrences.

`indexing_outputs` should remain as a compatibility export surface while admin routes migrate.

### Run Status Model

```ts
type RunStatus =
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
```

### Recommended Tables

```sql
indexing_runs
  id uuid pk
  video_id uuid
  source_video_id text null
  youtube_video_id text not null
  youtube_url text not null
  run_mode text not null -- RunMode
  status text not null
  pipeline_version text not null
  execution_mode text not null
  timing_authority text not null
  timing_confidence numeric null
  supersedes_run_id uuid null references indexing_runs(id)
  created_at timestamptz not null
  updated_at timestamptz not null

indexing_run_artifacts
  id uuid pk
  run_id uuid not null references indexing_runs(id) on delete cascade
  artifact_type text not null -- ArtifactType
  stage text not null -- ArtifactStage
  storage_kind text not null -- StorageKind
  mime_type text null
  payload jsonb null
  storage_path text null
  external_url text null
  size_bytes bigint null
  checksum_sha256 text null
  source_artifact_id uuid null references indexing_run_artifacts(id)
  pipeline_version text not null
  created_at timestamptz not null

indexing_audio_attempts
  id uuid pk
  run_id uuid not null references indexing_runs(id) on delete cascade
  provider text not null
  order_index int not null
  status text not null
  media_kind text null
  container text null
  codec text null
  size_bytes bigint null
  duration_sec numeric(12,3) null
  artifact_id uuid null references indexing_run_artifacts(id)
  temp_path text null
  cleanup_policy text null
  failure_code text null
  failure_message text null
  created_at timestamptz not null

indexing_alignment_jobs
  job_id uuid pk
  run_id uuid not null references indexing_runs(id) on delete cascade
  status text not null
  timing_authority text not null
  confidence_score numeric null
  failure_code text null
  failure_message text null
  metadata jsonb not null default '{}'::jsonb
  created_at timestamptz not null
  started_at timestamptz null
  completed_at timestamptz null

verse_candidates_v2
  candidate_id uuid pk
  run_id uuid not null references indexing_runs(id) on delete cascade
  verse_ref text not null
  normalized_verse_ref text not null
  timestamp_sec numeric(12,3) not null
  source_type text not null
  confidence numeric not null
  timing_authority text not null
  context_key text not null
  transcript_span jsonb null
  ocr_span jsonb null
  evidence_payload jsonb not null
  source_artifact_id uuid null references indexing_run_artifacts(id)
  pipeline_version text not null
  created_at timestamptz not null

resolved_occurrences_v2
  occurrence_id uuid pk
  run_id uuid not null references indexing_runs(id) on delete cascade
  verse_ref text not null
  canonical_timestamp_sec numeric(12,3) not null
  occurrence_type text not null
  confidence numeric not null
  timing_authority text not null
  canonical_candidate_id uuid null references verse_candidates_v2(candidate_id)
  snippet_text text null
  snippet_start_sec numeric(12,3) null
  snippet_end_sec numeric(12,3) null
  evidence_summary jsonb not null
  pipeline_version text not null
  created_at timestamptz not null

resolved_occurrence_candidates_v2
  occurrence_id uuid not null references resolved_occurrences_v2(occurrence_id) on delete cascade
  candidate_id uuid not null references verse_candidates_v2(candidate_id) on delete cascade
  role text not null
  primary key (occurrence_id, candidate_id)
```

### Reprocessing Strategy

- reprocessing creates a new `indexing_runs` row
- older runs remain immutable
- `supersedes_run_id` links lineage
- occurrence and candidate ids are run-scoped UUIDs and are never reused across reruns

### Mirror Policy

`indexing_outputs` should be write-through for:

- `verse_candidates_json`
- `resolved_occurrences_json`
- `ocr_detections_json`

It may remain best-effort for transitional legacy exports such as:

- `transcript_occurrences`
- `ocr_occurrences`

The source of truth is the V2 tables, not `indexing_outputs`.

## 4. Verse Candidate Schema

### Decision

Persist candidates as first-class rows, not only inside artifacts. That is the minimum needed for evidence auditability and later review tooling.

### Contract

```ts
type VerseCandidate = {
  candidate_id: string;
  run_id: string;
  verse_ref: string;
  normalized_verse_ref: string;
  timestamp_sec: number;
  source_type: "spoken_explicit" | "allusion" | "ocr";
  confidence: number;
  timing_authority: TimingAuthority;
  context_key: string;
  transcript_span: { start_sec: number; end_sec: number; segment_ids: string[] } | null;
  ocr_span: { start_sec: number; end_sec: number; detection_ids: string[] } | null;
  source_artifact_id: string | null;
  evidence_payload: {
    transcript_excerpt: string | null;
    ocr_excerpt: string | null;
    supporting_segment_ids: string[];
    supporting_detection_ids: string[];
    normalization_method: "deterministic" | "gemini";
    ambiguity_reason: string | null;
  };
  pipeline_version: "indexing_v2";
  created_at: string;
};
```

### Rules

- spoken candidates always use the run timeline
- OCR candidates always use raw video time
- `confidence` is always normalized to `0.0` through `1.0`
- `context_key` formula is `normalized_verse_ref + ":" + floor(timestamp_sec / 12)` using the candidate's own timestamp basis
- `transcript_span.end_sec` and `ocr_span.end_sec` are fusion aids, not button endpoints

### Confidence Guidance

- deterministic explicit reference with exact normalized verse: `0.9` to `1.0`
- strong allusion with direct surrounding support: `0.7` to `0.89`
- OCR-only explicit reference after clustering: `0.75` to `0.92`
- weak or ambiguous evidence should be `< 0.7` and is eligible for rejection by the resolver

## 5. Resolved Occurrence Schema

### Decision

Occurrence rows should carry both the final answer and the lineage required to explain it.

### Contract

```ts
type ResolvedOccurrence = {
  occurrence_id: string;
  run_id: string;
  verse_ref: string;
  canonical_timestamp_sec: number;
  occurrence_type: "spoken_explicit" | "allusion" | "ocr";
  confidence: number;
  timing_authority: TimingAuthority;
  canonical_candidate_id: string | null;
  snippet_text: string | null;
  snippet_start_sec: number | null;
  snippet_end_sec: number | null;
  fused_candidate_ids: string[];
  evidence_summary: {
    transcript_candidate_count: number;
    ocr_candidate_count: number;
    primary_source_type: CandidateSourceType;
    fusion_rule: "single_candidate" | "spoken_priority" | "allusion_priority" | "ocr_only";
    notes: string[];
  };
  pipeline_version: "indexing_v2";
  created_at: string;
};
```

### Canonical Timestamp Rule

Priority order inside one fused context:

1. earliest `spoken_explicit`
2. earliest `allusion`
3. earliest `ocr`

OCR may support a spoken occurrence. It must not pull the canonical timestamp earlier than the first accepted spoken evidence.

### Deterministic Resolver Rules

Use this exact sequence after candidate generation:

1. discard candidates with invalid normalized verse refs
2. discard candidates with `confidence < 0.55`
3. partition by `normalized_verse_ref`
4. within each partition, sort by `timestamp_sec`
5. start a new context when the next candidate begins more than `12.000` seconds after the current context anchor and does not overlap by span evidence
6. within one context, keep all candidates whose timestamps are within `12.000` seconds of the context anchor or whose transcript/OCR span overlaps an accepted candidate
7. resolve occurrence type by highest-priority surviving source:
   - any `spoken_explicit` => `spoken_explicit`
   - else any `allusion` => `allusion`
   - else `ocr`
8. resolve canonical timestamp:
   - earliest `spoken_explicit`
   - else earliest `allusion`
   - else earliest `ocr`
9. resolve confidence:
   - base = max candidate confidence in the fused set
   - add `0.03` if at least two independent candidates agree
   - add `0.02` if both transcript and OCR support the same verse
   - cap at `1.0`
10. split instead of fuse when the same verse reappears after the context window, even if the verse ref matches exactly
11. never merge different `normalized_verse_ref` values into one occurrence

### Span Overlap Rule

Two candidates overlap by evidence if either:

- transcript spans intersect
- OCR spans intersect
- one candidate timestamp falls inside the other's span

This overlap may preserve one context even when timestamp deltas alone are slightly above the nominal window.

## 6. Gemini Contract

### Decision

Gemini returns candidates, rejections, and fusion hints only. It does not return prose.

### Request

```ts
type GeminiVerseAnalysisRequest = {
  schema_version: "2026-03-21";
  run_id: string;
  pipeline_version: "indexing_v2";
  timing_authority: TimingAuthority;
  context_window_sec: 12;
  transcript_segments: Array<{
    segment_id: string;
    start_sec: number;
    end_sec: number;
    text: string;
  }>;
  ocr_detections: Array<{
    detection_id: string;
    start_sec: number;
    end_sec: number;
    text: string;
    confidence: number;
  }>;
  constraints: {
    allowed_candidate_types: ["spoken_explicit", "allusion", "ocr"];
    may_invent_timestamps: false;
    may_invent_verse_refs_without_support: false;
    must_reference_source_ids: true;
    output_json_only: true;
  };
};
```

### Response

```ts
type GeminiVerseAnalysisResponse = {
  schema_version: "2026-03-21";
  candidates: Array<{
    candidate_id: string;
    verse_ref: string;
    normalized_verse_ref: string;
    timestamp_sec: number;
    source_type: CandidateSourceType;
    confidence: number;
    timing_authority: TimingAuthority;
    transcript_span: { start_sec: number; end_sec: number; segment_ids: string[] } | null;
    ocr_span: { start_sec: number; end_sec: number; detection_ids: string[] } | null;
    evidence_payload: {
      transcript_excerpt: string | null;
      ocr_excerpt: string | null;
      supporting_segment_ids: string[];
      supporting_detection_ids: string[];
      ambiguity_reason: string | null;
    };
  }>;
  rejected_items: Array<{
    source_ids: string[];
    reason_code:
      | "NOT_BIBLE_REFERENCE"
      | "INSUFFICIENT_EVIDENCE"
      | "AMBIGUOUS_REFERENCE"
      | "TIMELINE_UNSUPPORTED"
      | "OCR_NOISE";
  }>;
  fusion_hints: Array<{
    context_key: string;
    candidate_ids: string[];
    recommended_timestamp_candidate_id: string | null;
    rationale_code:
      | "SAME_CONTEXT"
      | "SEPARATE_CONTEXT"
      | "OCR_SUPPORTS_SPOKEN"
      | "OCR_ONLY"
      | "CONFLICTING_REFERENCES";
  }>;
};
```

### Constraints

- candidate timestamps must come directly from provided segment or detection times
- Gemini must not create a new time basis
- if transcript and OCR disagree on the verse ref, emit separate candidates and mark a conflict in `fusion_hints`
- if evidence is ambiguous, reject it or emit a low-confidence candidate with `ambiguity_reason`

## 7. OCR Policy Contract

### Decision

Keep OCR conservative, cheap, and deterministic in V2 first pass.

### Constants

```ts
const OCR_FRAME_INTERVAL_SEC = 5;
const OCR_MIN_CONFIDENCE = 0.75;
const OCR_CLUSTER_GAP_SEC = 7.5;
const OCR_SINGLE_FRAME_HIGH_CONFIDENCE = 0.9;
```

### Detection Payload

```ts
type OcrDetection = {
  detection_id: string;
  run_id: string;
  start_sec: number;
  end_sec: number;
  raw_text: string;
  normalized_text: string;
  confidence_mean: number;
  confidence_max: number;
  frame_count: number;
  sampled_at_seconds: number[];
  verse_ref: string | null;
  normalized_verse_ref: string | null;
  source_artifact_id: string | null;
};
```

### Normalization Rules

- lowercase for parsing only; preserve original text for review
- normalize whitespace
- normalize dash variants to `-`
- support canonical book names and approved abbreviations
- require explicit chapter-and-verse syntax to emit a verse candidate
- chapter-only references may be kept as raw OCR detections but not promoted to verse candidates in V2 first pass

### Clustering Rules

- merge adjacent detections when:
  - `normalized_verse_ref` matches, or
  - `normalized_text` matches exactly after normalization
- the gap between adjacent sampled frames must be `<= OCR_CLUSTER_GAP_SEC`
- keep a single-frame cluster only when confidence is `>= OCR_SINGLE_FRAME_HIGH_CONFIDENCE`
- otherwise require at least two adjacent detections to emit a candidate

## 8. Snippet Policy Contract

### Decision

Optimize for reviewer confirmation, not quote completeness.

### Constants

```ts
const SNIPPET_SEARCH_WINDOW_BEFORE_SEC = 10;
const SNIPPET_SEARCH_WINDOW_AFTER_SEC = 18;
const SNIPPET_MAX_CHARS = 240;
const SNIPPET_MAX_SEGMENTS = 2;
```

### Rules

1. prefer the transcript segment containing the canonical timestamp
2. if the evidence phrase is split, merge at most one adjacent segment
3. if the merged text exceeds `SNIPPET_MAX_CHARS`, trim and add leading or trailing ellipsis as needed
4. if no supporting phrase exists near the timestamp, use the nearest readable segment within the search window
5. if no readable segment exists in that window, set snippet to `null`

### Formatting

- preserve original casing
- collapse internal whitespace to single spaces
- no markdown
- no Bible text enrichment

## 9. Admin Review Payload Contract

### Decision

The run-detail route should become occurrence-first while still exposing raw artifacts for download.

### Contract

```ts
type AdminRunDetailPayload = {
  run: {
    run_id: string;
    youtube_video_id: string;
    youtube_url: string;
    run_mode: RunMode;
    status: string;
    pipeline_version: "indexing_v2";
    execution_mode: ExecutionMode;
    timing_authority: TimingAuthority;
    timing_confidence: number | null;
    created_at: string;
    updated_at: string;
  };
  player: {
    youtube_video_id: string;
    youtube_url: string;
    embed_url: string;
    duration_sec: number | null;
  };
  summary: {
    resolved_occurrence_count: number;
    candidate_count: number;
    artifact_count: number;
    warning_count: number;
  };
  warnings: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    artifact_id: string | null;
    candidate_id: string | null;
    occurrence_id: string | null;
  }>;
  filters: {
    available_occurrence_types: CandidateSourceType[];
    available_timing_authorities: TimingAuthority[];
    default_occurrence_types: CandidateSourceType[];
  };
  resolved_occurrences: Array<{
    occurrence_id: string;
    verse_ref: string;
    canonical_timestamp_sec: number;
    occurrence_type: CandidateSourceType;
    confidence: number;
    timing_authority: TimingAuthority;
    snippet_text: string | null;
    snippet_start_sec: number | null;
    snippet_end_sec: number | null;
    snippet_source_artifact_id: string | null;
    snippet_source_segment_ids: string[];
    fused_candidate_ids: string[];
    evidence_summary: Record<string, unknown>;
  }>;
  available_artifacts: Array<{
    artifact_id: string;
    artifact_type: string;
    label: string;
    content_type: string | null;
    size_bytes: number | null;
    download_url: string;
  }>;
  evidence_index: Record<
    string,
    {
      candidate_id: string;
      source_type: CandidateSourceType;
      verse_ref: string;
      timestamp_sec: number;
      transcript_span: { start_sec: number; end_sec: number; segment_ids: string[] } | null;
      ocr_span: { start_sec: number; end_sec: number; detection_ids: string[] } | null;
      evidence_payload: Record<string, unknown>;
    }
  >;
};
```

### Migration Guidance

- first admin version may derive this payload from the new V2 tables plus compatibility artifacts
- keep transcript and OCR JSON downloads available during migration
- once admin review is stable, stop treating `transcript_occurrences` and `ocr_occurrences` as the primary review surface

### Active Run Selection Rule

For any review surface that needs one canonical run per video:

1. latest `complete` run with `pipeline_version='indexing_v2'`
2. if multiple, prefer `execution_mode='full_alignment'` or `execution_mode='admin_forced_alignment'`
3. if still tied, prefer highest `timing_confidence`
4. if no complete V2 run exists, fall back to latest `complete_with_warnings`
5. never auto-select a `failed` or non-terminal run for the primary review surface

## Recommended Immediate Follow-Ons

1. app repo prompt to design the actual SQL migrations for the V2 tables above
2. app repo prompt to define the local WhisperX runner and artifact persistence path
3. admin repo prompt to upgrade run detail from raw transcript/OCR JSON to `AdminRunDetailPayload`
