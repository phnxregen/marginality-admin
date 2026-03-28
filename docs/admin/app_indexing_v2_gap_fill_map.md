# App Indexing V2 Gap Fill Map

Last updated: 2026-03-27

## Purpose

This document maps the admin repo's deterministic Indexing V2 resolver stack onto the current app-side
transcript indexing pipeline.

The goal is to close the real gap in the app repo:

```text
lane 1 / lane 2 transcript acquisition -> Gemini evidence -> deterministic range resolution -> stable persisted verse ranges
```

This is not a transcript-lane gap. The app already tries lane 1, lane 2, and then verse detection.
The missing piece is the admin V2 candidate and resolver stack after transcript acquisition.

## Current App Reality

The app already does:

- lane-based transcript acquisition in order
- transcript segment persistence
- Gemini transcript verse detection
- local Gemini cleanup
- `verse_occurrences` writes
- `transcript_occurrences` and `transcript_debug` output writes

The app does not yet do:

- deterministic parser candidate generation from transcript text
- candidate fusion between Gemini/upstream evidence and local parser evidence
- resolver-driven ordered occurrence grouping
- occurrence lineage persistence
- transcript-segment lineage persistence in the final output contract

## What To Reuse From Admin V2

### 1. Candidate model

Use the admin V2 candidate shape as the app-side pre-resolution artifact:

- `candidate_id`
- `verse_ref`
- `normalized_verse_ref`
- `timestamp_sec`
- `source_type`
- `confidence`
- `timing_authority`
- `context_key`
- `transcript_span`
- `ocr_span`
- `source_artifact_id`
- `evidence_payload`

Reference:
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L2590)
- [`indexing-v2-resolver.server.ts`](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-v2-resolver.server.ts#L26)

### 2. Parser entrypoints

Port these deterministic parser helpers into shared app-side code:

- `normalizeVerseRef`
- `normalizeBookName`
- `parseChapterToken`
- `findNearestContext`
- `parseVerseRefsFromText`
- `buildCandidatesFromTranscriptSegments`

These are the parser pieces that let transcript-only text produce explicit verse candidates even when
Gemini is noisy, incomplete, or overly broad.

Reference:
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L694)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L949)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L2698)

### 3. Gemini/upstream candidate conversion

Do not treat Gemini rows as final persisted rows immediately. Convert them into candidates first.

The admin bootstrap path to reuse:

- `buildVerseRefFromOccurrenceRecord`
- `buildCandidatesFromUpstreamOccurrences`

That path allows Gemini output to become one evidence source among others instead of the final contract.

Reference:
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L744)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L2590)

### 4. Simplification chain

The app should adopt this exact post-candidate pipeline order:

1. `dedupeCandidates([...upstreamCandidates, ...regexCandidates])`
2. `promoteSequentialRangeCandidates(...)`
3. `promoteQuotedContinuationRanges(..., transcriptSegments)`
4. `promoteSignatureBoundedRanges(..., transcriptSegments)`
5. `dedupeCandidates(...)`
6. `suppressContainedVerseCandidates(...)`
7. `resolveIndexingV2Occurrences(...)`

Reference:
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L3301)

Notes:

- `promoteSequentialRangeCandidates` is the general same-context range builder.
- `promoteQuotedContinuationRanges` is the adjacent quoted-next-verse extension rule.
- `promoteSignatureBoundedRanges` is the narrow signature-based range promotion for known difficult cases.
- `suppressContainedVerseCandidates` removes noisy singles once a justified bounded range exists nearby.

Reference:
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L1286)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L1367)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L1484)
- [`admin_indexing_v2_test_run/index.ts`](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_v2_test_run/index.ts#L1595)

### 5. Resolver contract

Use the resolver as the app-side authority for final occurrence grouping and ordering.

Resolver responsibilities:

- reject invalid or low-confidence candidates
- group candidates by normalized verse ref
- split repeated references into separate contexts when outside the context window
- fuse overlapping same-context evidence
- choose the canonical candidate by source priority
- preserve transcript lineage
- build snippets
- emit stable `occurrence_index`

Reference:
- [`indexing-v2-resolver.server.ts`](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-v2-resolver.server.ts#L83)
- [`indexing-v2-resolver.server.ts`](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-v2-resolver.server.ts#L320)

## Exact App-Side Integration Point

The app orchestrators already do lane ordering. This does not need a new lane feature.

References:

- public lane winner/final transcript source handling: [`index_video/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/index_video/index.ts#L1391)
- personal lane function map and ordered loop: [`index_personal_video/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/index_personal_video/index.ts#L1695)

The required change belongs inside:

- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts)

Specifically, replace the current "Gemini rows are final rows" path with:

1. chunk transcript and call Gemini
2. convert Gemini rows into V2 candidates
3. generate deterministic transcript parser candidates from transcript text
4. run the admin simplification chain
5. run the admin resolver
6. map resolved occurrences into the app persistence shapes

## What To Replace In The App Detector

The current app detector still treats Gemini rows as the main contract:

- Gemini prompt and row parsing
- local row normalization
- adjacent quoted continuation merge
- nested suppression
- final row dedupe
- direct persistence into `verse_occurrences`

Reference:
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1461)
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1641)

Keep:

- transcript loading
- chunk planning
- Gemini invocation
- run locks
- existing output preflight logic

Replace the middle:

- current final-row shaping
- row-only range synthesis as the authoritative resolver

## Persistence Mapping After Resolution

### `verse_occurrences`

Continue writing app-visible `verse_occurrences`, but derive them from resolved occurrences instead of
raw Gemini rows.

Map:

- `anchor_verse_id` <- resolved canonical start verse id
- `start_verse_id` <- resolved start verse id
- `end_verse_id` <- resolved end verse id
- `reference_string` <- resolved `verse_ref`
- `raw_reference` <- resolved `verse_ref`
- `start_ms` / `end_ms` <- resolved timestamp/snippet anchor mapped back to ms
- `kind` <- `spoken_explicit` => `direct`, `allusion` => `allusion`
- `has_spoken` <- true for transcript-backed occurrences
- `raw_snippet` <- resolver snippet text

The current write point to replace is here:
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1687)

### `transcript_occurrences`

Keep the existing output type, but populate its occurrences from resolved occurrences instead of raw
Gemini rows.

The current mapping path is:
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1107)
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1793)

Minimum additions recommended to the debug payload:

- candidate count
- accepted/rejected candidate decisions
- fusion decision count
- split decision count
- occurrence lineage by candidate ids
- transcript segment lineage by occurrence

### `transcript_debug`

Preserve the current output type, but enrich it with:

- raw Gemini rows
- parser-generated candidates
- final candidate set after simplification
- resolver result summary
- candidate rejection reasons

Current write point:
- [`detect_verses_from_transcript/index.ts`](/Users/phoenixparks/Projects/Marginally-master/supabase/functions/detect_verses_from_transcript/index.ts#L1818)

## Recommended Shared App Files

Create new shared helpers in the app repo rather than embedding this logic directly inside one large
edge function.

Recommended split:

- `_shared/transcript_candidate_parser.ts`
- `_shared/transcript_candidate_generation.ts`
- `_shared/transcript_candidate_simplification.ts`
- `_shared/transcript_occurrence_resolver.ts`
- `_shared/transcript_occurrence_mapping.ts`

That keeps `detect_verses_from_transcript/index.ts` below the repo's practical complexity threshold and
makes the parser/resolver testable in isolation.

## Minimum Implementation Order In App Repo

1. Port candidate and resolver types into shared app-side helpers.
2. Port parser helpers and `buildCandidatesFromTranscriptSegments`.
3. Convert Gemini rows into V2 candidates instead of final rows.
4. Port simplification chain.
5. Port resolver.
6. Map resolved occurrences back into current app persistence outputs.
7. Add debug payload fields for candidate and resolver decisions.
8. Run fixture validation against known difficult sermons before enabling broadly.

## Validation Focus

The pass bar in the app repo should match the admin resolver validation posture:

- repeated references split into separate occurrences
- single-verse noise suppressed when a justified bounded range exists
- quoted-next-verse continuation only extends one adjacent verse
- signature-bounded cases like `Acts 2:1-4` and `Ephesians 1:13-14` resolve correctly
- ordering follows transcript order, not timestamp sort alone
- lane 1 exact timing and lane 2 estimated timing both still persist correctly

## Bottom Line

If the app keeps its current lane orchestration and swaps in the admin V2 candidate plus resolver stack
inside `detect_verses_from_transcript`, it will already satisfy the product goal you described:

- try lane 1 and lane 2
- use Gemini as one evidence source
- resolve to the proper recognized verse ranges
- persist ordered, app-visible outputs without needing a brand new orchestration layer
