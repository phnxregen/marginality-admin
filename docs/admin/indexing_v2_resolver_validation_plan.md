# Indexing V2 Resolver Validation Plan

Last updated: 2026-03-26

## Purpose

This document defines the acceptance gate for the V2 resolver under the current order-first product
definition.

It validates the deterministic step that turns noisy candidate signals into reviewable, ordered verse
occurrences.

## Scope

This validation covers:

- candidate rejection
- context grouping
- fusion and split behavior
- occurrence ordering
- transcript linkage
- timing trust labeling
- snippet reviewability

It does not require:

- audio acquisition
- WhisperX
- playback-accurate timestamps

## Required Validation Input

```ts
type ResolverValidationInput = {
  run_id: string;
  youtube_video_id: string;
  youtube_url: string;
  pipeline_version: "indexing_v2";
  execution_mode: string;
  timing_authority:
    | "whisperx_aligned"
    | "retimed_transcript"
    | "original_transcript"
    | "approximate_proxy"
    | "unavailable";
  candidates: Array<{
    candidate_id: string;
    normalized_verse_ref: string;
    timestamp_sec: number | null;
    source_type: "spoken_explicit" | "allusion" | "ocr";
    confidence: number;
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
  }>;
  resolved_occurrences: Array<{
    occurrence_id: string;
    occurrence_index: number;
    verse_ref: string;
    canonical_timestamp_sec: number | null;
    occurrence_type: "spoken_explicit" | "allusion" | "ocr";
    confidence: number;
    timing_authority:
      | "whisperx_aligned"
      | "retimed_transcript"
      | "original_transcript"
      | "approximate_proxy"
      | "unavailable";
    transcript_segment_id: string | null;
    transcript_segment_ids: string[];
    fused_candidate_ids: string[];
    snippet_text: string | null;
  }>;
};
```

## Validation Output Contract

```ts
type ResolverValidationReport = {
  run_id: string;
  fixture_id: string;
  overall_status: "pass" | "pass_with_warnings" | "fail";
  invariant_results: Array<{
    code: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
  anchor_results: Array<{
    anchor_id: string;
    verse_ref: string;
    status: "pass" | "warning" | "fail";
    expected_timestamp_sec: number | null;
    actual_timestamp_sec: number | null;
    allowed_delta_sec: number;
    actual_occurrence_id: string | null;
    notes: string[];
  }>;
  metrics: {
    candidate_count: number;
    resolved_occurrence_count: number;
    orphan_candidate_count: number;
    multi_source_occurrence_count: number;
    ocr_only_occurrence_count: number;
    split_decision_count: number;
    fusion_decision_count: number;
    discarded_low_confidence_candidate_count: number;
  };
};
```

## Global Invariants

### 1. Verse Purity

One occurrence must never fuse candidates from different normalized verse refs.

### 2. Candidate Lineage

Every occurrence must retain at least one fused candidate id.

### 3. Ordered Occurrence Index

Every occurrence must have a unique `occurrence_index` within the run.

### 4. Order Monotonicity

Occurrences must be emitted in `occurrence_index` order. Timestamp sorting may agree, but it is not
the contract.

### 5. Spoken Priority

If a fused context contains `spoken_explicit`, the final occurrence type must be `spoken_explicit`.

### 6. Repetition Split

Repeated references that fall outside the context window and do not overlap by span must remain
separate occurrences.

### 7. Timing Authority Consistency

Occurrence timing authority must match the run-level basis semantics.

### 8. Low-Trust Timing Handling

If timing is `approximate_proxy` or `unavailable`, timestamp deltas may warn, but must not fail the
run on their own unless the run falsely claims higher timing authority.

### 9. Transcript Linkage

Occurrences with transcript-backed evidence should carry transcript segment linkage unless the input
itself lacks that information.

### 10. Snippet Reviewability

Occurrences with transcript-backed evidence should expose a snippet when transcript context makes that
possible.

## Timestamp Tolerance Policy

Timestamp anchors remain secondary checks.

Use these tolerances:

- direct spoken anchor: `±2.0 sec`
- spoken allusion anchor: `±4.0 sec`
- OCR-only anchor: `±5.0 sec`
- low-trust timing runs: anchor misses downgrade to warnings

`unavailable` timing should not fail purely on timestamp absence.

## Fixture Set

Keep using the current fixture set:

1. Clear Sermon
2. Spoken Heavy
3. Low Quality Audio
4. Hard Extraction Test
5. Repetition

Primary interpretation for fixtures:

- verify correct verse identity
- verify correct ordering
- verify repetition split behavior
- verify transcript linkage and snippets
- verify timestamp trust semantics

## Pass Criteria

Minimum pass bar for current V2:

- ordered occurrences are emitted
- `occurrence_index` is stable and reviewable
- verse purity and lineage invariants pass
- repeated references split when they should
- low-trust timing is labeled correctly
- approximate or missing timing does not break reviewability
