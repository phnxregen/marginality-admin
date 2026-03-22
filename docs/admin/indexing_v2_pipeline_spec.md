# Indexing V2 Pipeline Specification

Last updated: 2026-03-20

## Purpose

This document records the target Indexing V2 pipeline for Marginality and the admin-side validation surface needed to review it.

Indexing V2 shifts the primary output from separate transcript/OCR artifacts to resolved verse occurrences with traceable evidence:

- transcript is the primary linguistic input
- OCR is an explicit visual supplement
- verse occurrence is the primary output artifact
- Gemini is the semantic reasoning and fusion layer
- WhisperX is the timing authority when alignment is available
- deterministic logic should own formatting, reconstruction, and non-semantic normalization

## Status

This is a target-state specification, not a claim that the work is nearly complete.

Known missing or unstable areas include some of the following, but this list is not exhaustive:

- stronger audio acquisition fallbacks
- no dedicated WhisperX server/worker yet
- older admin testing artifacts still reflect the previous transcript/OCR split contract
- admin review UI does not yet provide embedded video playback with clickable occurrence timestamps
- final V2 storage/versioning schema is not yet fully defined in code
- cross-repo implementation details still need to be gathered from the app repo before the implementation prompt is written there

## Scope

Indexing V2 covers:

1. ingest
2. transcript acquisition
3. timing alignment
4. OCR screen reading
5. semantic analysis and evidence fusion
6. snippet attachment
7. storage and versioning
8. admin/app rendering

## Primary Output

The primary output artifact is `resolved verse occurrences`.

Each occurrence should be traceable back to:

- its verse reference
- the timestamp chosen as canonical
- its source type
- its supporting evidence
- its snippet
- the pipeline version that produced it

Recommended normalized shape:

```ts
type VerseOccurrenceType = "spoken_explicit" | "allusion" | "ocr";

type TimingAuthority =
  | "whisperx_aligned"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";

type VerseOccurrence = {
  verse_ref: string;
  timestamp_sec: number;
  type: VerseOccurrenceType;
  confidence: number;
  snippet: string | null;
  context_key: string;
  evidence: {
    spoken_candidate_ids: string[];
    ocr_candidate_ids: string[];
    timing_authority: TimingAuthority;
  };
};
```

Every resolved occurrence must include the `timing_authority` used to produce its canonical timestamp.

Every indexing run must also store a run-level timing authority summary so the UI and debugging tools know whether timestamps are exact, fallback-derived, approximate, or unavailable.

Recommended run-level fields:

```ts
type IndexingExecutionMode =
  | "full_alignment"
  | "no_alignment"
  | "admin_forced_alignment"
  | "fallback_only";

type IndexingTimingState = {
  execution_mode: IndexingExecutionMode;
  timing_authority: TimingAuthority;
};
```

This execution mode is separate from product-facing run classification such as `personal` or `admin_test`.

## Pipeline

### 1. Ingest

Accept the video, extract core metadata, and register it for indexing.

Responsibilities:

- store `videoId`, `sourceVideoId`, and `youtubeUrl`
- capture duration, title, channel, and other source metadata
- initialize indexing job state
- stamp pipeline version as `indexing_v2`
- store indexing execution mode for the run

### 2. Transcribe

Generate a transcript for linguistic analysis using a multi-lane strategy.

Lanes:

- Lane 0: cache reuse if transcript already exists and is still valid
- Lane 1: official YouTube captions
- Lane 2: proxy transcript

Output:

- raw transcript
- segments and timestamps if the provider returns them
- source metadata such as lane used and provider confidence

Notes:

- proxy-estimated timing is recovery-only and must not be treated as sync-grade timing
- transcript quality and timing quality are separate concerns

### 3. Align Indexing V2

Validate and correct transcript timing so spoken content is anchored to the timeline as accurately as possible.

#### 3.1 Audio Acquisition

Retrieve audio using a hardened fallback ladder instead of treating Cobalt as the only serious option.

Required behavior:

- attempt providers in order
- log each provider attempt separately
- preserve the failure reason for each failed attempt
- stop early when a valid audio asset is acquired
- store whether the result is stream-only, downloaded, cached, or manually supplied

Recommended fallback ladder:

1. Reuse a cached audio artifact already associated with the same `youtubeVideoId` or `sourceVideoId`.
2. Reuse an existing upstream media/audio artifact if the app repo already has one for the source video.
3. Cobalt direct extraction.
4. `yt-dlp` extractable audio URL without full download.
5. `yt-dlp` direct audio download (`m4a`, `webm`, or bestaudio).
6. `yt-dlp` fallback to muxed media download followed by deterministic audio extraction.
7. Secondary extractor provider behind the same acquisition interface.
8. Admin manual override: provide an uploaded or pre-signed audio asset for difficult videos.

For each attempt store:

- provider name
- attempt order
- media kind returned
- container/codec if known
- size if known
- failure code/message if failed

#### 3.2 Alignment Eligibility Check

Confirm:

- audio is available
- transcript is non-empty
- format is compatible with WhisperX
- a usable alignment provider exists for the current environment

If no alignment provider exists yet, do not fail the whole indexing run by default. Continue with transcript-based downstream processing and mark alignment as unavailable.

#### 3.3 WhisperX Processing

Run WhisperX on the acquired audio when an alignment provider is available.

Produce:

- aligned words
- refined timestamps
- provider metadata
- execution metrics

#### 3.4 Segment Reconstruction

Rebuild transcript segments from aligned word timings using deterministic rules.

Rules should include:

- sentence boundary handling
- pause thresholds
- max segment length
- monotonic timestamp enforcement

#### 3.5 Alignment Confidence Scoring

Generate an alignment quality score using:

- word alignment coverage
- timing consistency
- missing or unmatched tokens
- validator output from the transcript timing policy

#### 3.6 Alignment Fallback Handling

If alignment fails, cannot run, or scores too low:

- retain the original transcript
- set run-level `timing_authority` to `original_transcript`, `approximate_proxy`, or `unavailable`, whichever accurately describes the fallback path
- keep the failure reason
- continue downstream unless the run specifically requires exact timing

#### 3.7 Alignment Output

Produce the final transcript used downstream:

- aligned transcript when confidence is acceptable
- otherwise original transcript as the fallback transcript
- stamp the run-level `timing_authority` before semantic analysis begins so all downstream timestamps share the same source of truth

### 4. Read the Screen

Extract on-screen text to identify explicit written verse references.

Responsibilities:

- sample frames at defined intervals
- run OCR
- filter out detections below the configured OCR confidence threshold
- keep only explicit verse references
- exclude allusions
- output timestamped OCR detections

OCR should be treated as visual evidence only. It should not be asked to infer or hallucinate references from vague text.

OCR deduplication requirements:

- collapse repeated adjacent frame detections into one detection window
- retain confidence statistics for the collapsed window
- avoid emitting duplicate OCR candidates for the same stationary on-screen reference

### 5. Semantic Analysis (Gemini)

A single structured model call family is responsible for semantic reasoning and evidence fusion.

Inputs:

- transcript, aligned when available
- OCR detections
- optional video metadata

Responsibilities:

#### 5.1 Detect Spoken References

Identify explicit spoken references.

Example:

- `John 3 verses 15 and 16`

#### 5.2 Detect Allusions

Identify implicit or quoted verse content.

Example:

- `For God so loved the world`

#### 5.3 Create Verse Candidates

Normalize all detections into structured candidates:

- verse reference
- timestamp
- type: `spoken_explicit`, `allusion`, or `ocr`
- confidence

Candidate timestamp normalization rule:

- all spoken candidate timestamps must originate from the active timing authority timeline for the run
- if the run timing authority is `whisperx_aligned`, spoken candidates use aligned timestamps
- if the run timing authority is `original_transcript`, spoken candidates use original transcript timestamps
- if the run timing authority is `approximate_proxy`, spoken candidates may use fallback timestamps but must remain labeled as approximate
- OCR candidates always originate from raw video time and are reconciled during fusion rather than being rewritten at OCR extraction time

Gemini should not invent an independent timestamp basis. Candidate timestamps must be anchored to the active timeline supplied to it.

#### 5.4 Fuse Contextual Instances

Group candidates that refer to the same verse within the same moment.

The fusion step should determine contextual boundaries, not merely dedupe strings.

Temporal fusion rule:

- candidates are eligible to fuse only when they fall inside a defined temporal proximity window
- recommended starting window: `8` to `15` seconds
- candidates outside that window must remain separate occurrences even if they point to the same verse reference

Recommended constant:

```ts
const CONTEXT_WINDOW_SEC = 12;
```

Context span rule:

- candidate or evidence `end_sec` values are primarily for contextual reasoning, not for declaring the semantic end of a verse reference in the video
- end timestamps help the fusion layer judge whether spoken references, allusions, and OCR detections belong to the same contextual instance
- the final resolved timestamp should still follow the priority rules, usually favoring the earliest direct spoken citation when that best represents the occurrence button location

Example:

- a pastor may say `John 3` at `1:00`
- begin alluding to `For God so loved the world...` at `1:20`
- have OCR visible across the full interval
- the end timestamps help determine that these signals belong to one contextual instance, while the resolved occurrence timestamp may still anchor near `1:00`

#### 5.5 Resolve Final Occurrences

Apply prioritization rules within each contextual instance.

Priority order:

1. spoken explicit reference
2. spoken quotation or allusion
3. OCR reference

Rules:

- prefer spoken timing when OCR appears earlier but speech occurs later
- allow multiple occurrences when context is meaningfully different
- preserve evidence lineage so the final occurrence can still show what was fused into it

### 6. Attach Snippets

Extract transcript segments aligned to resolved occurrence timestamps.

Responsibilities:

- select the best segment around the occurrence time
- ensure readability
- ensure the snippet actually helps a reviewer confirm why the occurrence exists
- attach the snippet to each resolved occurrence

Snippet selection rules:

- if timing authority is `whisperx_aligned`, use a precise word-aligned segment window
- if timing authority is `original_transcript` or `approximate_proxy`, use the nearest transcript segment by timestamp
- when possible, the snippet must contain the evidence phrase that justified the occurrence
- if the evidence phrase cannot be captured cleanly, prefer the smallest readable surrounding segment that still supports review

### 7. Store and Version

Persist all outputs with traceability and support reprocessing.

Store:

- raw transcript
- aligned transcript when it exists
- OCR detections
- verse candidates
- resolved occurrences
- snippets
- alignment metadata and confidence
- audio acquisition attempts
- pipeline version

Versioning requirements:

- support reprocessing
- keep artifact-level traceability
- distinguish between original transcript timing and aligned timing
- record whether the run used fallback timing

Recommended admin-facing artifact set:

```ts
type IndexingV2Artifacts = {
  pipeline_version: "indexing_v2";
  execution_mode: IndexingExecutionMode;
  timing_authority: TimingAuthority;
  raw_transcript_json: unknown;
  aligned_transcript_json: unknown | null;
  ocr_detections_json: unknown;
  verse_candidates_json: unknown;
  resolved_occurrences_json: unknown;
  snippets_json: unknown;
  alignment_metadata_json: unknown | null;
  audio_acquisition_json: unknown;
};
```

### 8. Render in App

Deliver structured verse occurrences to the UI.

Each rendered occurrence should include:

- verse reference
- timestamp
- timing authority
- snippet preview
- interaction to jump to time

## Admin Review UX

The admin repo should provide a stronger run-detail review surface than raw JSON blobs.

Preferred validation experience:

- embedded video player on the run detail page, not only a first-click external link
- occurrence list beside or below the player
- each occurrence shows:
  - verse reference
  - timestamp
  - timing authority
  - type
  - confidence
  - snippet
- clicking a timestamp should seek the embedded player directly to that moment
- reviewers should be able to filter by occurrence type
- OCR-only occurrences should be visibly distinct from spoken references
- fused occurrences should still expose evidence details for auditability

Minimum admin-side rendering states:

- `spoken_explicit`
- `allusion`
- `ocr`

Recommended technical direction:

- use the YouTube embed/player API in the run detail route
- render a normalized occurrence timeline derived from `resolved_occurrences_json`
- keep raw artifacts downloadable for debugging, but make the player view the primary review surface

## Audio Acquisition Requirements

Audio acquisition must become a first-class subsystem instead of a hidden precondition.

Minimum requirements:

- provider abstraction
- ordered fallback policy
- per-attempt logs
- cached artifact reuse
- deterministic extraction after download
- manual override path for admin testing

Do not make Cobalt a single point of failure.

## Alignment Infrastructure Reality

There is not yet a dedicated WhisperX server/worker. That should be treated as one missing dependency, not the only missing dependency.

Until WhisperX infrastructure exists:

- allow the pipeline to continue without exact alignment
- mark transcript timing clearly as `approximate_timing` or `unavailable`
- store the reason alignment did not run
- avoid presenting approximate timing as precise synced timing

Possible future alignment provider shapes:

- dedicated remote worker
- admin-invoked local worker for controlled testing
- queue-based offline alignment job

## Deterministic vs Model Responsibilities

Deterministic logic should own:

- segment reconstruction
- timestamp ordering
- candidate grouping mechanics
- formatting and schema normalization
- snippet extraction
- version stamping
- fallback selection

Model reasoning should own:

- spoken explicit reference detection
- allusion detection
- semantic grouping support
- ambiguity resolution when context is genuinely linguistic

## Compliance Note

Indexing V2 should center on verse references, timestamps, and transcript-derived snippets from the indexed media.

If the app repo later attaches licensed Bible text, verse text previews, or enrichment from API.Bible, that implementation must comply with the applicable API.Bible legal agreements. This spec should not be interpreted as approval to persist or display licensed Bible text outside those terms.

## Implementation Sequencing

Recommended rollout order:

1. finalize V2 artifact contract
2. harden audio acquisition fallback ladder
3. add alignment availability states and logging
4. wire semantic fusion to emit resolved occurrences
5. attach snippets
6. upgrade admin run detail UI to embedded video plus occurrence timeline
7. add regression fixtures against resolved occurrences, not only split transcript/OCR outputs

## Cross-Repo Follow-Up

After Indexing V2 is implemented to a stable point, the admin repo should do two follow-up tasks for the app repo:

1. create a context-gathering prompt to inspect the app repo's current indexing implementation and storage contracts
2. after that context is gathered, create a focused implementation prompt for the app repo to solidify Indexing V2 there

That cross-repo prompt work should happen after the actual V2 implementation is materially in place, not before.

## User Actions

Only do these if you want me to unblock the corresponding implementation path:

1. Decide whether WhisperX should first run as a local controlled tool, a remote worker, or stay deferred while the rest of V2 ships.
2. Confirm whether admin manual audio override is acceptable for hard-to-extract videos.
3. Provide a small validation set of real videos you trust for V2 review, ideally including clean sermons and difficult edge cases.
4. When you want the app repo handoff, have me generate the context-gathering prompt from this admin-side spec plus the app repo's current state.
