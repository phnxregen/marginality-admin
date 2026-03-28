# Indexing V2 Pipeline Specification

Last updated: 2026-03-26

## Purpose

This document defines the current source-of-truth product contract for Indexing V2 in the admin repo.

Indexing V2 is structured verse occurrence extraction in video order. It is not a timestamped playback
system yet.

The current admin implementation is the source of truth. Do not move responsibility into the app repo
until the admin version is stable.

## Product Definition

Core output:

- ordered verse occurrences
- verse identity
- evidence lineage
- transcript linkage
- optional low-trust timing metadata

Core non-goals for the current ship path:

- audio acquisition as a dependency for success
- WhisperX alignment as a dependency for success
- fake or inferred sync-grade timestamps
- review flows that break when precise timing is missing

## Core Decisions

- ordering is required
- timing is optional enhancement metadata
- transcript is the primary linguistic input
- OCR is a secondary confirmation source
- audio acquisition is deferred from the core success path
- WhisperX alignment is deferred and non-blocking
- inaccurate timestamps must not be presented as authoritative
- future timing upgrades must not require occurrence identity or order to be redefined

## Current Ship Pipeline

```text
Transcript -> Verse Detection -> Ordered Occurrences
```

Meaning:

1. acquire or reuse transcript segments
2. detect verse candidates from transcript and optional OCR support
3. resolve ordered occurrences in video order
4. persist occurrence lineage, transcript linkage, and review metadata

For the current admin test runner, transcript intake means:

- reuse cached upstream transcript state when it already exists
- or accept transcript override text / JSON

It does not yet perform fresh YouTube transcript acquisition itself.

Success means:

- the run yields ordered verse occurrences
- ordering is reviewable even when timing is approximate or unavailable
- verse identity and lineage are preserved

## Future Enhancement Pipeline

```text
Validated Audio Artifact -> Alignment (WhisperX) -> Timing Upgrade
```

This future path upgrades timing metadata only.

It does not redefine:

- occurrence identity
- occurrence order
- candidate lineage
- review contracts

## Scope

Indexing V2 currently covers:

1. ingest and run registration
2. cached transcript reuse or transcript override intake
3. verse detection
4. deterministic occurrence resolution
5. ordered occurrence persistence
6. validation and admin review

Indexing V2 currently does not require:

1. audio download
2. waveform alignment
3. exact playback timestamps
4. alignment workers or queues

Current admin test-run implementation also does not yet include:

1. fresh transcript acquisition inside the V2 runner
2. shared-row finalization into app-visible V1 tables

Current admin test-run behavior for semantic analysis:

- cached/upstream transcript reuse may attempt the shared Gemini transcript detector in dry-run mode
- transcript override runs stay on the deterministic local path so admin validation remains fast and reproducible

## Primary Contract

The primary artifact is `resolved_occurrences_json`.

Recommended normalized shape:

```ts
type VerseOccurrenceType = "spoken_explicit" | "allusion" | "ocr";

type TimingAuthority =
  | "whisperx_aligned"
  | "retimed_transcript"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";

type VerseOccurrence = {
  occurrence_id: string;
  occurrence_index: number;
  verse_ref: string;
  normalized_verse_ref: string;
  source_type: VerseOccurrenceType;
  confidence: number;
  transcript_segment_id: string | null;
  transcript_segment_ids: string[];
  canonical_timestamp_sec: number | null;
  timing_authority: TimingAuthority;
  timing_confidence: number | null;
  snippet_text: string | null;
  snippet_start_sec: number | null;
  snippet_end_sec: number | null;
  fused_candidate_ids: string[];
  evidence_summary: {
    transcript_candidate_count: number;
    ocr_candidate_count: number;
    notes: string[];
  };
};
```

Rules:

- `occurrence_index` is authoritative for ordering
- `canonical_timestamp_sec` is nullable
- timestamps are low-trust unless `timing_authority` is real alignment
- UI and validation must not treat approximate timestamps as authoritative playback anchors

## Timing Semantics

Timing authority values mean:

- `whisperx_aligned`: timing can be treated as alignment-grade
- `retimed_transcript`: transcript timing improved, but still not full alignment by default
- `original_transcript`: provider timing reused as-is
- `approximate_proxy`: deterministic or proxy timing only
- `unavailable`: no usable timing basis exists

Behavior:

- `whisperx_aligned` is high-trust
- every other value is low-trust for playback placement
- low-trust timestamps may help reviewer orientation, snippet extraction, and debugging
- low-trust timestamps must not be presented as precise sync

## Review Contract

Admin review should emphasize:

1. occurrence order
2. verse identity
3. source type
4. transcript snippet and lineage
5. timing authority
6. timestamp only when present and clearly labeled by trust level

The review surface must still work when:

- `canonical_timestamp_sec` is null
- `timing_authority` is `approximate_proxy`
- `timing_authority` is `unavailable`

## Data Model Expectations

The data model must support:

- first-class ordered occurrences
- `occurrence_index`
- transcript linkage via `transcript_segment_id` and/or `transcript_segment_ids`
- `source_type`
- nullable `canonical_timestamp_sec`
- `timing_authority`
- optional snippet metadata
- future timing upgrades without remapping occurrence identity by default

## Operational Constraints

- do not make Cobalt or any audio provider a dependency for V2 success
- do not make alignment a dependency for V2 success
- verse detection must succeed when timing is approximate or unavailable
- future app-repo migration happens only after admin V2 is working

## Out Of Scope Now

- WhisperX implementation
- audio acquisition implementation
- playback-accurate seek UX
- shifting V2 ownership into the app repo
