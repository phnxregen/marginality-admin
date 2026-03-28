# Indexing V2 Design Package

Last updated: 2026-03-26

## Purpose

This document converts the current Indexing V2 direction into implementation-ready contracts for the
admin repo.

The design posture is:

- transcript-driven
- occurrence-first
- order-first
- alignment-ready but not alignment-dependent

## Design Posture

- treat `indexing_v2_runs` as the run anchor
- treat `indexing_v2_occurrences` as the primary product output
- store order explicitly instead of inferring it from timestamps
- persist transcript linkage for every occurrence whenever transcript evidence exists
- keep timing metadata nullable and low-trust when alignment is absent
- keep OCR supportive and conservative
- keep future timing upgrades additive

## Shared Types

```ts
type TimingAuthority =
  | "whisperx_aligned"
  | "retimed_transcript"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";

type CandidateSourceType = "spoken_explicit" | "allusion" | "ocr";

type RunMode = "admin_test" | "public" | "personal";

type ExecutionMode =
  | "full_alignment"
  | "no_alignment"
  | "admin_forced_alignment"
  | "fallback_only";
```

Trust model:

- only `whisperx_aligned` is alignment-grade
- all other timing authorities must be treated as low-trust playback metadata

## Run Contract

`indexing_v2_runs` should continue to store:

- run identity and source metadata
- pipeline version
- execution mode
- run-level `timing_authority`
- run-level `timing_confidence`
- transcript source metadata
- counts and error state

Run-level timing fields describe the run basis, not guaranteed playback precision.

## Candidate Contract

Candidates remain additive evidence, not the product contract.

Recommended candidate shape:

```ts
type IndexingV2Candidate = {
  candidate_id: string;
  run_id: string;
  verse_ref: string;
  normalized_verse_ref: string;
  timestamp_sec: number | null;
  source_type: CandidateSourceType;
  confidence: number;
  timing_authority: TimingAuthority;
  context_key: string;
  transcript_span: {
    start_sec: number | null;
    end_sec: number | null;
    segment_ids: string[];
  } | null;
  ocr_span: {
    start_sec: number | null;
    end_sec: number | null;
    detection_ids: string[];
  } | null;
  evidence_payload: Record<string, unknown>;
};
```

Notes:

- candidate timestamps may be null if evidence is not time-grounded
- transcript lineage should survive even when timing is approximate

## Ordered Occurrence Contract

Ordered occurrences are the primary V2 contract.

```ts
type ResolvedOccurrence = {
  occurrence_id: string;
  run_id: string;
  occurrence_index: number;
  verse_ref: string;
  normalized_verse_ref: string;
  occurrence_type: CandidateSourceType;
  confidence: number;
  source_type: CandidateSourceType;
  transcript_segment_id: string | null;
  transcript_segment_ids: string[];
  canonical_timestamp_sec: number | null;
  timing_authority: TimingAuthority;
  canonical_candidate_id: string | null;
  snippet_text: string | null;
  snippet_start_sec: number | null;
  snippet_end_sec: number | null;
  snippet_source_segment_ids: string[];
  fused_candidate_ids: string[];
  evidence_summary: {
    transcript_candidate_count: number;
    ocr_candidate_count: number;
    primary_source_type: CandidateSourceType;
    fusion_rule: "single_candidate" | "spoken_priority" | "allusion_priority" | "ocr_only";
    notes: string[];
  };
};
```

Rules:

- `occurrence_index` is required and unique per run
- ordering is defined by `occurrence_index`, not by timestamp
- `canonical_timestamp_sec` is optional metadata
- `transcript_segment_id` should point at the primary transcript anchor when available
- `transcript_segment_ids` should retain full transcript lineage when available

## Schema Direction

`indexing_v2_occurrences` should support at least:

- `occurrence_index integer not null`
- `transcript_segment_id text null`
- `transcript_segment_ids text[] not null default '{}'::text[]`
- `canonical_timestamp_sec numeric(12,3) null`
- `timing_authority text not null`
- snippet fields

Recommended constraints:

- unique `(run_id, occurrence_index)`
- non-negative `occurrence_index`
- non-negative `canonical_timestamp_sec` only when not null

Recommended indexes:

- `(run_id, occurrence_index asc)`
- `(run_id, normalized_verse_ref, occurrence_index asc)`

Timestamp indexes may remain useful for debugging, but they are secondary.

## Resolver Contract

Resolver responsibilities:

1. reject invalid or low-confidence candidates
2. partition candidates into verse-specific contexts
3. resolve one ordered occurrence per accepted context
4. assign stable per-run `occurrence_index`
5. preserve candidate lineage and transcript linkage
6. attach snippets when transcript context exists

Resolver must not:

- require precise timing to emit an occurrence
- invent precise timestamps
- collapse ordering into timestamp sort order

## Review Payload Contract

Run detail payload should make order explicit:

```ts
type RunDetailOccurrence = {
  occurrence_id: string;
  occurrence_index: number;
  verse_ref: string;
  occurrence_type: CandidateSourceType;
  confidence: number;
  transcript_segment_id: string | null;
  transcript_segment_ids: string[];
  canonical_timestamp_sec: number | null;
  timing_authority: TimingAuthority;
  timing_is_low_trust: boolean;
  snippet_text: string | null;
  fused_candidate_ids: string[];
};
```

UI emphasis:

- show occurrence number first
- show verse identity second
- show timing trust state clearly
- disable or de-emphasize timestamp jump actions when timing is low-trust or absent

## Future Timing Upgrade Contract

When alignment is implemented later, it should update:

- `canonical_timestamp_sec`
- `timing_authority`
- optional timing-confidence metadata

It should not require:

- redefining `occurrence_index`
- redefining `occurrence_id`
- rebuilding candidate lineage from scratch by default
