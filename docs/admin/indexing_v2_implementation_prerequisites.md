# Indexing V2 Implementation Prerequisites

Last updated: 2026-03-26

## Purpose

This document records the implementation decisions that are now fixed enough to guide coding in the
admin repo.

It is narrower than the main spec:

- [indexing_v2_pipeline_spec.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_pipeline_spec.md) defines the product contract
- this document defines what should no longer be treated as open architecture questions

## Locked In

These decisions are now implementation inputs:

- admin repo is the source of truth for V2 right now
- V2 success path is transcript-driven
- ordered occurrences are the primary output
- `occurrence_index` is authoritative for ordering
- timing is optional metadata, not the success criterion
- audio acquisition is not required for core success
- alignment is not required for core success
- low-trust timestamps must stay visibly low-trust
- validation and review must still work with approximate or missing timing

## What Is No Longer An Open Blocker

Do not stop implementation on these:

- lack of WhisperX
- lack of audio acquisition fallback work
- lack of playback-accurate timestamps
- lack of app-repo migration planning

Those are future enhancements, not current prerequisites.

## Current Success Criteria

The admin implementation is successful when it can:

1. ingest transcript segments from upstream reuse or override input
2. detect verse candidates
3. resolve ordered verse occurrences
4. preserve transcript linkage and candidate lineage
5. support review and validation without precise timing

## Data Model Decisions

These fields are required now at the occurrence level:

- `occurrence_index`
- transcript linkage via `transcript_segment_id` or `transcript_segment_ids`
- `source_type`
- `timing_authority`
- optional `canonical_timestamp_sec`
- optional snippet metadata

These behavioral rules are required now:

- order is derived from `occurrence_index`
- timestamps are not authoritative when timing is approximate or unavailable
- future alignment may upgrade timing metadata without redefining occurrence identity or order

## Validation Direction

Resolver validation should prioritize:

1. verse purity
2. lineage preservation
3. spoken-priority fusion behavior
4. repetition splitting
5. ordered occurrence stability
6. transcript linkage
7. timing trust labeling

Anchor timestamp checks still matter, but only relative to the run timing authority.

## Operational Constraints

- do not make Cobalt or any audio provider a dependency for V2 success
- do not make alignment a dependency for V2 success
- do not move V2 responsibility into the app repo yet
- if app-repo coordination becomes necessary, stop and request exact context instead of guessing

## Remaining Design-Critical Risk

The largest remaining product risk is the resolver and review contract, not audio or alignment.

The highest-leverage implementation work is:

- explicit occurrence ordering
- transcript linkage quality
- low-trust timing representation
- review ergonomics when timing is absent or approximate
