# Indexing V2 Resolver Validation Plan

Last updated: 2026-03-21

## Purpose

This document turns the Indexing V2 resolver from a design idea into a validation gate.

It defines:

- what a resolver run must output for review
- what invariants must always hold
- which fixture behaviors must pass before broad rollout
- what counts as a pass, warning, or failure

This is not the resolver implementation. It is the acceptance policy for that implementation.

## Scope

This validation covers the deterministic step that turns many candidate signals into resolved occurrences.

It validates:

- candidate rejection
- candidate grouping into contexts
- fusion and split behavior
- canonical timestamp selection
- occurrence type selection
- confidence aggregation
- lineage preservation
- snippet attachment readiness

It does not validate:

- transcript acquisition quality by itself
- WhisperX alignment quality by itself
- OCR extraction quality by itself

Those upstream systems are inputs to this gate.

## Required Inputs For Validation

Each validation run must provide:

- run metadata
- active timing authority
- verse candidates
- resolved occurrences
- snippet payload or snippet fields
- source transcript artifact
- OCR detections artifact when OCR is enabled

Minimum machine-readable validation input:

```ts
type ResolverValidationInput = {
  run_id: string;
  youtube_video_id: string;
  youtube_url: string;
  pipeline_version: "indexing_v2";
  execution_mode: string;
  timing_authority:
    | "whisperx_aligned"
    | "original_transcript"
    | "approximate_proxy"
    | "unavailable";
  candidates: Array<{
    candidate_id: string;
    normalized_verse_ref: string;
    timestamp_sec: number;
    source_type: "spoken_explicit" | "allusion" | "ocr";
    confidence: number;
    transcript_span: { start_sec: number; end_sec: number } | null;
    ocr_span: { start_sec: number; end_sec: number } | null;
  }>;
  resolved_occurrences: Array<{
    occurrence_id: string;
    verse_ref: string;
    canonical_timestamp_sec: number;
    occurrence_type: "spoken_explicit" | "allusion" | "ocr";
    confidence: number;
    timing_authority:
      | "whisperx_aligned"
      | "original_transcript"
      | "approximate_proxy"
      | "unavailable";
    fused_candidate_ids: string[];
    snippet_text: string | null;
  }>;
};
```

## Validation Output Contract

Every validation pass should emit a structured report instead of prose-only notes.

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
  };
};
```

## Global Invariants

These are hard requirements for every fixture.

### 1. Verse Purity

One resolved occurrence must never fuse candidates from different `normalized_verse_ref` values.

Result:

- fail if one occurrence contains mixed verse refs

### 2. Candidate Lineage

Every resolved occurrence must have at least one `fused_candidate_id`.

Result:

- fail if any occurrence lacks candidate lineage

### 3. No Orphan Resolved Timestamps

The canonical timestamp must be explainable by one fused candidate of the same occurrence.

Result:

- fail if canonical timestamp is not equal to or credibly derived from one fused candidate under resolver rules

### 4. Spoken Priority

If a fused context contains any accepted `spoken_explicit` candidate, the final occurrence type must be `spoken_explicit`.

Result:

- fail if OCR or allusion wins over direct speech in the same fused context

### 5. OCR Support Only

OCR may support a spoken occurrence, but it must not move the canonical timestamp earlier than the first accepted spoken candidate in the same fused context.

Result:

- fail if OCR pulls the occurrence earlier than direct speech

### 6. Repetition Split

Repeated references to the same verse must remain separate occurrences when they fall outside the context window and do not overlap by span.

Result:

- fail if clearly separate repetitions collapse into one occurrence

### 7. Confidence Range

All candidate and occurrence confidence values must remain within `0.0` to `1.0`.

Result:

- fail if any confidence leaves that range

### 8. Timing Authority Consistency

Every resolved occurrence must carry the same run timing basis semantics used during candidate generation.

Result:

- fail if occurrence timing authority contradicts run-level timing authority without an explicit allowed reason

### 9. Snippet Reviewability

Any occurrence with transcript-backed evidence should have a non-null snippet unless the run timing authority or transcript quality makes snippet extraction impossible.

Result:

- warning if missing
- fail only when systematic across otherwise healthy transcript-backed occurrences

## Timestamp Tolerance Policy

Use these tolerances during validation:

- direct spoken anchor: `±2.0 sec`
- spoken allusion anchor: `±4.0 sec`
- OCR-only anchor: `±5.0 sec`
- approximate timing runs: add `+2.0 sec`

The goal is not frame-perfect playback. The goal is reviewer-correct button placement.

## Fixture Set Acceptance Cases

## 1. Clear Sermon

Fixture:

- URL: `https://www.youtube.com/watch?v=3Hk-scIE6fw`
- Video ID: `3Hk-scIE6fw`

This fixture is the primary resolver benchmark because it exercises direct speech, allusion, OCR overlap, and scope expansion.

### Required Anchor Checks

1. `John 7:37-39`
   - expected canonical timestamp: `108.0`
   - allowed delta: `2.0`
   - required result:
     - one resolved occurrence for `John 7:37-39`
     - type must be `spoken_explicit`
     - occurrence must not drift to the later allusion or OCR window center

2. `John 16:7`
   - expected canonical timestamp: `264.0`
   - allowed delta: `2.0`
   - required result:
     - one resolved occurrence for `John 16:7`
     - type must be `spoken_explicit`

3. `Acts 2:1-4`
   - expected canonical timestamp: `1298.0`
   - allowed delta: `2.0`
   - required result:
     - one resolved occurrence for `Acts 2:1-4`
     - type must be `spoken_explicit`
     - later verse-reading/allusion/OCR evidence must fuse into the same occurrence rather than creating a second near-duplicate inside the same context

4. `1 Corinthians 12:13-14`
   - expected canonical timestamp: `1553.0`
   - allowed delta: `2.0`
   - required result:
     - one resolved occurrence for `1 Corinthians 12:13-14`
     - repetition of verse `13` must not explode into many near-identical occurrences

5. `Ephesians 1:13-14`
   - expected canonical timestamp: `2269.0`
   - allowed delta: `2.0`
   - required result:
     - one resolved occurrence for `Ephesians 1:13-14`
     - OCR and allusion should support, not replace, the spoken anchor

### Clear Sermon Fail Conditions

- any anchor lands on the OCR midpoint instead of the direct spoken start
- the same contextual verse becomes multiple near-duplicate occurrences within `12` seconds
- a direct spoken citation is downgraded to `allusion` or `ocr`

## 2. Spoken Heavy

Fixture:

- URL: `https://www.youtube.com/watch?v=1j_nSyh0HOI`
- Video ID: `1j_nSyh0HOI`

This fixture checks that the resolver does not depend on OCR and does not over-merge weak spoken evidence.

### Required Anchor Checks

1. `Colossians 1`
   - expected canonical timestamp: `787.0`
   - allowed delta: `4.0`
   - required result:
     - at least one resolved occurrence near the cited moment
     - no OCR dependency
     - if the reference is chapter-only upstream and V2 first pass refuses chapter-only normalization, this must surface as a documented warning rather than silent disappearance

### Spoken Heavy Fail Conditions

- resolver requires OCR support to emit a spoken occurrence
- weak but valid spoken evidence is merged into unrelated nearby references

## 3. Low Quality Audio

Fixture:

- URL: `https://www.youtube.com/watch?v=UFsdJJiq6WI`
- Video ID: `UFsdJJiq6WI`

This fixture checks degraded transcript conditions.

### Required Checks

- resolver should still preserve lineage and stable occurrence typing even when confidence is lower
- if occurrences are dropped for insufficient evidence, the run should emit warnings rather than presenting unjustified precision
- approximate timing runs should still respect split/fuse rules

### Low Quality Audio Fail Conditions

- low-quality transcript evidence produces overconfident `0.95+` occurrences without supporting lineage
- the resolver fuses distant weak candidates only because the verse ref string matches

## 4. Hard Extraction Test

Fixture:

- URL: `https://www.youtube.com/watch?v=b1kbLwvqugk`
- Video ID: `b1kbLwvqugk`

This fixture is an extraction stress test, not a primary verse-quality benchmark.

### Required Checks

- if upstream acquisition/transcript/OCR produce poor evidence, the resolver should fail gracefully
- no fabricated high-confidence resolved occurrences
- warnings should make the degraded evidence obvious

### Hard Extraction Fail Conditions

- resolver invents confident verse occurrences from weak or absent evidence
- resolver returns many OCR-only noise occurrences from non-sermon media

## 5. Repetition

Fixture:

- URL: `https://www.youtube.com/watch?v=g_fIYuY1VEI&t=113s`
- Video ID: `g_fIYuY1VEI`

This fixture is the primary split-vs-fuse benchmark.

### Required Anchor Checks

These moments should remain distinct contextual occurrences if they resolve to verse-backed candidates:

1. `18:07-18:09`
2. `18:07-18:22`
3. `19:39-19:50`
4. `27:56-28:15`
5. `32:59-33:10`

### Required Repetition Rules

- repeated delivery of the same verse within one short contextual block may fuse into one occurrence
- recurrence after the context window must split into a new occurrence
- separate sermonic returns to the same verse later in the video must not collapse into one long-lived occurrence chain

### Repetition Fail Conditions

- one verse repeated across widely separated moments becomes one occurrence
- every repeated line inside one contextual block becomes its own occurrence

## Required Validation Metrics

At minimum, every validation report should surface:

- total candidates
- total resolved occurrences
- count of occurrences backed by multiple source types
- count of OCR-only occurrences
- count of split decisions
- count of fusion decisions
- count of discarded low-confidence candidates

These metrics make regression visible even when anchor checks still pass.

## Review Workflow

1. run the pipeline on one fixture video
2. inspect global invariants
3. inspect anchor checks for that fixture
4. inspect the occurrence list beside video playback
5. inspect fused candidate lineage for any warning or failure
6. record a machine-readable validation report

Do not treat manual visual review without a structured report as a sufficient validation pass.

## Minimum Gate Before Broad Rollout

Before broad implementation is considered ready:

- Clear Sermon must pass all required anchor checks
- Repetition must pass split-vs-fuse checks
- Hard Extraction Test must show graceful failure rather than hallucinated confidence
- no fixture may violate the global invariants

If those conditions are not met, resolver tuning remains in progress.
