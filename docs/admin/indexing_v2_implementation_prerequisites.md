# Indexing V2 Implementation Prerequisites

Last updated: 2026-03-21

## Purpose

This document lists the remaining contracts, infrastructure decisions, and readiness inputs needed before a coding agent should implement Indexing V2 end to end.

It is intentionally narrower than the main V2 pipeline spec:

- [indexing_v2_pipeline_spec.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_pipeline_spec.md) defines the target pipeline behavior
- this document defines what is still open enough to affect implementation quality or architecture

## Already Locked In The V2 Spec

These items already have enough direction in the main spec and should not be treated as open blockers unless we deliberately change them:

- `TimingAuthority` exists and must be tracked at run level and occurrence level
- spoken candidate timestamps must use the active timing authority timeline
- OCR timestamps remain raw video time until fusion
- fusion uses a temporal proximity window
- snippet attachment is alignment-aware
- OCR requires confidence filtering and deduplication
- execution mode is separate from product run mode
- admin review should center on embedded video plus typed, clickable occurrences
- audio acquisition must use a fallback ladder beyond Cobalt

## Real User Decisions

Status: complete as of 2026-03-21.

These product and operational decisions are now resolved and should be treated as implementation inputs rather than open questions.

### 1. WhisperX deployment model

Decision: local controlled worker for the first iteration.

Why:

- zero infra complexity
- no queue or orchestration yet
- direct alignment debugging
- avoids premature scaling decisions
- fits the current validation stage better than a scale-first design

Implementation meaning:

- run WhisperX locally or on a single controlled machine
- trigger it manually or via admin controls
- persist resulting artifacts into the indexing system

Do not start with:

- remote service
- queue system
- deferred alignment

### 2. Alignment execution behavior

Decision: admin-triggered first, with optional async later.

Why:

- alignment is still experimental
- avoids wasting compute on bad videos
- allows inspection before automation
- keeps primary indexing fast and non-blocking

Initial behavior:

- indexing runs without alignment by default
- admin can explicitly trigger `Run Alignment`
- alignment runs as a local job in the first iteration

Future evolution:

- move to async auto-alignment after the workflow is stable

### 3. Manual audio override policy

Decision: yes to all three override paths.

Allow:

- uploaded audio
- pre-signed URLs
- cached or local artifacts

Why:

- audio extraction is currently unreliable
- manual override provides a guaranteed fallback
- manual override improves debugging
- manual override can unblock edge cases immediately

Rule:

- override audio becomes the highest-priority input in the acquisition ladder

### 4. Validation set

Decision: use the following initial validation set.

1. Clear Sermon
   - URL: `https://www.youtube.com/watch?v=3Hk-scIE6fw`
   - Notes: clean sermon with many allusions, OCR references, and direct citations
   - Additional anchors:
     - `John 7:37-39`
       - direct citation starts at `1:48` with `John Chapter 7`
       - scope is specified at `2:01` with `beginning in verse 37 through 39`
       - `verse 37 says...` begins at `2:08`
       - allusion runs roughly `2:08-2:41`
       - OCR appears roughly `2:09-2:41`
       - expected button placement is around `1:48` because that is the start of the direct citation
     - `John 16:7`
       - direct citation at `4:24` with `16th chapter of John, verse 7`
       - immediate allusion follows
       - OCR appears roughly `4:26-4:40`
     - `Acts 2:1-4`
       - direct citation begins at `21:38` with `Acts Chapter 2`
       - `Chapter 2 verse 1` at `21:52`
       - allusion runs roughly `21:54-22:18`
       - OCR appears roughly `21:52-22:20`
       - expected button placement is around `21:38`
     - `1 Corinthians 12:13-14`
       - direct citation begins at `25:53` with `1 Corinthians Chapter 12 verse 13`
       - verse `13` is repeated multiple times over the next twenty seconds
       - allusion to verses `13` and `14` follows
       - OCR shows `13` and `14`
       - expected result is button `1 Corinthians 12:13-14` around `25:53`
     - `Ephesians 1:13-14`
       - direct citation begins at `37:49` with `Ephesians 1 verse 13 now`
       - OCR and allusion point to `Ephesians 1:13-14` immediately after
       - expected result is button `Ephesians 1:13-14` around `37:49`
2. Spoken Heavy
   - URL: `https://www.youtube.com/watch?v=1j_nSyh0HOI`
   - Notes: minimal visual and verbal citations for much of the video; no direct chapter and verse reference until around 20 minutes; includes a reference to Colossians 1 at `13:07`
3. Low Quality Audio
   - URL: `https://www.youtube.com/watch?v=UFsdJJiq6WI`
   - Notes: Billy Graham; useful for degraded audio conditions
4. Hard Extraction Test
   - URL: `https://www.youtube.com/watch?v=b1kbLwvqugk`
   - Notes: Taylor Swift music video; useful for extraction stress-testing
5. Repetition
   - URL: `https://www.youtube.com/watch?v=g_fIYuY1VEI&t=113s`
   - Notes: heavy repetition of verses and allusions with no OCR
   - Review anchors:
     - `18:07-18:09` "The Lord, the Lord..."
     - `18:07-18:22` "The Lord, the Lord, a God merciful and gracious..."
     - `19:39-19:50` "...I want to forgive you so badly. That's just who I am."
     - `27:56-28:15` "They that wait upon the Lord..."
     - `32:59-33:10` "I have a real fear of missing out on that."

Validation interpretation note:

- end timestamps and spans should be treated mainly as contextual evidence for fusion
- they help determine whether direct citation, allusion, and OCR belong to the same contextual instance
- they do not automatically define where the final verse-reference button should land
- when a direct spoken citation starts earlier than the allusion or OCR, the resolved occurrence timestamp should usually stay near that direct spoken start

## Contract Status

Status: mostly resolved as of 2026-03-21.

The contract package that previously remained open is now defined in:

- [indexing_v2_design_package.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_design_package.md)
- [indexing_v2_shared_supabase_context.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_shared_supabase_context.md)

That document now covers:

1. audio acquisition contract
2. WhisperX service contract
3. V2 storage schema
4. verse candidate schema
5. resolved occurrence schema
6. Gemini contract
7. OCR policy contract
8. snippet policy contract
9. admin review payload contract

Those nine items should no longer be treated as blockers due to missing schema or interface definitions.

## Remaining Design-Critical Risk

The biggest remaining implementation risk is not the storage contract. It is the resolver behavior that turns multiple noisy candidate signals into one reviewable occurrence.

This includes:

- candidate rejection thresholds
- context partitioning
- fusion eligibility
- overlap rules
- canonical timestamp choice
- occurrence type choice
- confidence aggregation
- repeated-reference split behavior

Status:

- first-pass deterministic resolver rules are now defined in the design package
- they are implementation-ready enough for a coding agent to follow
- they are still the highest-leverage area to validate against the fixture set before broad rollout
- the resolver validation gate is now defined in [indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md)

## Resolved Contract Checklist

### 1. Audio Acquisition Contract

Status: resolved in the design package.

Defined there:

- provider interface
- request/response shapes
- provider ordering policy
- failure taxonomy
- cache reuse policy
- temp retention/deletion policy
- persisted audio-attempt shape
- manual override flow
- timestamp precision

### 2. WhisperX Service Contract

Status: resolved in the design package.

Defined there:

- input payload
- output payload
- timeout behavior
- retry policy
- error codes
- async-style lifecycle for a local worker
- artifact storage destination
- idempotency and retry identity rules

### 3. V2 Storage Schema

Status: resolved at contract level in the design package.

Defined there:

- tables
- run status model
- artifact linkage
- pipeline version storage
- timing authority storage
- execution mode storage
- candidate and occurrence identifiers
- evidence lineage fields
- reprocessing strategy
- `indexing_outputs` mirror policy

Still remaining:

- concrete SQL migrations
- exact database constraints and indexes

### 4. Verse Candidate Schema

Status: resolved in the design package.

Defined there:

- exact fields
- context key formula
- confidence normalization
- span interpretation
- artifact lineage

### 5. Resolved Occurrence Schema

Status: resolved in the design package.

Defined there:

- exact fields
- canonical timestamp rules
- fused candidate lineage
- evidence summary shape
- snippet provenance expectations

### 6. Gemini Contract

Status: resolved in the design package.

Defined there:

- exact input JSON
- exact output JSON
- allowed candidate types
- ambiguity handling
- transcript/OCR disagreement handling
- anti-hallucination constraints
- required evidence linkage

### 7. OCR Policy Contract

Status: resolved in the design package.

Defined there:

- frame sampling interval
- minimum OCR confidence threshold
- OCR detection payload
- verse normalization rules
- clustering rules for persistent on-screen references

### 8. Snippet Policy Contract

Status: resolved in the design package.

Defined there:

- search window
- max snippet length
- single-segment vs merged multi-segment behavior
- fallback behavior
- formatting rules

### 9. Admin Review Payload Contract

Status: resolved in the design package.

Defined there:

- run detail payload
- embedded player metadata
- occurrence list payload
- filter state payload
- downloadable artifact metadata
- evidence inspection payload
- warnings shape
- active/latest run selection rule

## Remaining Work Before Broad Implementation

The contract decisions are now sufficiently defined. What remains is implementation sequencing.

The following decisions should be treated as fixed unless implementation reveals a concrete blocker.

### 1. SQL Migration Package

Decision:

- do an additive-first migration, not an in-place rewrite
- extend `indexing_runs` where needed and add new V2 support tables rather than creating a separate `indexing_runs_v2`
- create the supporting V2 tables from the design package:
  - `indexing_run_artifacts`
  - `indexing_audio_attempts`
  - `indexing_alignment_jobs`
  - `verse_candidates_v2`
  - `resolved_occurrences_v2`
  - `resolved_occurrence_candidates_v2`
- prefer `text` plus `check` constraints over PostgreSQL enums for first-pass rollout
- do not backfill historical runs before first implementation
- keep legacy tables and flows intact during rollout
- treat V2 tables as source of truth for new V2 runs
- keep `indexing_outputs` as a write-through compatibility mirror for V2 exports that the current admin/testing surfaces still depend on

Required indexes:

- `indexing_runs(video_id, created_at desc)`
- `indexing_runs(status, created_at desc)`
- `indexing_run_artifacts(run_id, artifact_type, created_at desc)`
- `indexing_audio_attempts(run_id, order_index)`
- `indexing_alignment_jobs(run_id, created_at desc)`
- `verse_candidates_v2(run_id, normalized_verse_ref, timestamp_sec)`
- `resolved_occurrences_v2(run_id, canonical_timestamp_sec)`
- `resolved_occurrence_candidates_v2(candidate_id)`

Implementation directive:

- do not delete or repurpose the current transcript/OCR storage paths in the first migration wave
- do not require historical backfill as a prerequisite for shipping V2 on new runs
- if coexistence becomes awkward, prefer duplication during rollout over premature destructive cleanup

Done when:

- the full V2 table set exists as concrete SQL migrations
- all enum-like fields are constraint-backed
- required indexes exist
- coexistence with current admin/testing tables is explicit

### 2. Resolver Validation Pass

Decision:

- implementation starts with the deterministic resolver rules already documented
- do not re-open resolver contract design during the first implementation pass unless the fixture set proves a hard failure
- use [indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md) as the release gate
- keep the default context window at `12.000` seconds for the first pass
- keep the default candidate rejection floor at `0.55` for the first pass
- treat Clear Sermon as the canonical timestamp benchmark
- treat Repetition as the split-vs-fuse benchmark
- treat Hard Extraction Test as the anti-hallucination benchmark
- require a machine-readable validation report for each fixture run

Release gate:

- Clear Sermon must pass anchor placement checks
- Repetition must pass split-vs-fuse checks
- Hard Extraction Test must show graceful failure rather than fabricated confidence
- no fixture may violate the global invariants

Implementation directive:

- ship resolver changes behind admin/testing workflows first
- do not broaden rollout based on informal visual review alone
- if a fixture fails, tune the resolver rules and rerun the validation plan before broad rollout

Done when:

- the fixture set has structured validation reports
- the required release-gate fixtures pass

### 3. Cross-Repo Implementation Prompt

Decision:

- app repo implements the pipeline and storage changes first
- admin repo follows after the app repo exposes stable V2 artifacts and payloads
- do not ask one coding agent to invent cross-repo behavior from memory
- use the admin repo docs as the contract source of truth:
  - `indexing_v2_pipeline_spec.md`
  - `indexing_v2_design_package.md`
  - `indexing_v2_resolver_validation_plan.md`
- use [indexing_v2_shared_supabase_context.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_shared_supabase_context.md) as the shared-Supabase safety document
- if app-repo uncertainty remains, stop and gather app-repo context before implementation rather than guessing

Implementation directive:

- the first app-repo prompt should cover:
  - SQL migrations
  - artifact persistence
  - audio acquisition subsystem
  - WhisperX job wiring
  - candidate generation persistence
  - resolver implementation
  - compatibility mirroring into `indexing_outputs`
- the follow-on admin-repo prompt should cover:
  - occurrence-first review payload consumption
  - embedded player review flow
  - warning rendering
  - evidence inspection

Done when:

- there is an app-repo implementation prompt that is explicit enough to execute without architectural guesswork
- there is a separate admin-repo prompt for the UI migration

### 4. Admin Review Route Migration Plan

Decision:

- migrate admin review in phases instead of replacing the current route in one step
- `resolved_occurrences_json` and the normalized occurrence payload become the primary review surface once available
- legacy transcript/OCR JSON downloads remain available during migration
- the first route to upgrade is the run-detail review experience, not every admin screen at once
- the target route payload is `AdminRunDetailPayload`

Migration phases:

1. keep current run-detail route, but add V2 payload loading behind the scenes
2. add occurrence-first review UI with player, filters, warnings, and evidence inspection
3. keep legacy transcript/OCR JSON as downloadable debug artifacts, not the primary review surface
4. only after the V2 review flow is stable, consider reducing emphasis on the raw legacy JSON panels

Implementation directive:

- preserve current debugging affordances during migration
- do not block reviewer access to transcript/OCR raw artifacts while the new review flow stabilizes
- use the active/latest run selection rule from the design package for any video-level review surface

Done when:

- the run-detail route can review V2 occurrences as the primary artifact
- legacy downloads still exist for debugging
- reviewers can inspect warnings and fused evidence without leaving the route

## Priority Order For Remaining Work

If we want the fastest path to implementation readiness now, the remaining work should be finalized in this order:

1. SQL migration package
2. resolver validation pass against the fixture set
3. app-repo implementation prompt
4. admin review route migration plan

## Recommended Next Deliverable

The next useful artifact is no longer another contract doc.

It should be one of these:

1. a V2 SQL migration plan
2. a resolver pseudocode package
3. a cross-repo implementation prompt for the app repo
4. an admin review route migration plan
