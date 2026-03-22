# Indexing V2 Shared Supabase Context

Last updated: 2026-03-21

## Purpose

This document captures the app-repo context that matters for implementing an additive Indexing V2 prototype in the admin repo while the admin and app repos continue to share one Supabase project.

Use this as a safety document for V2 migrations, shared writes, and rollout guardrails.

## 1. Shared tables

`videos`: direct app read + edge-function write. It is the primary row the app uses for visibility and indexing state; key columns in active app reads are `id`, `source_video_id`, `canonical_source_video_id`, `visibility`, `listing_state`, `indexing_status`, `transcript_status`, `verse_status`, `transcript_timing_mode`, plus metadata fields. Public indexing upserts on `source_video_id`; the index is unique. Safest V2 posture: leave unchanged and do not repurpose status/listing fields on shared rows. Refs: `content_video_service.dart` (line 109), `personal_indexing_data_service.dart` (line 429), `index_video/index.ts` (line 193), `index_personal_video/index.ts` (line 600), `20251222001712_videos_add_youtube_metadata_columns.sql` (line 7), `20260208000200_content_layers_and_creator_publish.sql` (line 3), `20260314131500_transcript_timing_mode.sql` (line 1)

`transcript_segments`: direct app read + edge-function write. It is the materialized transcript store the app searches, resolves by `source_video_id`, and renders in detail views; key columns are `video_id`, `source_video_id`, `start_ms`, `end_ms`, `text`. Safest V2 posture: leave unchanged and do not store alternate transcript versions for the same shared video in this table. Refs: `personal_indexing_data_service.dart` (line 143), `personal_indexing_data_service.dart` (line 337), `20251224000000_indexing_schema.sql` (line 3), `acquire_transcript_lane1_youtube/index.ts` (line 560), `acquire_transcript_lane2_proxy/index.ts` (line 692), `acquire_transcript_lane3_whisper/index.ts` (line 530)

`verse_occurrences`: direct app read + edge-function write. It is the materialized verse-hit table used for search, page hits, transcript detail verse refs, and public/private feed filtering; key columns are `video_id`, `source_video_id`, `anchor_verse_id`, `start_ms`, `end_ms`, `raw_snippet`, `detection_source`, `detection_version`, `kind`, `has_spoken`. Safest V2 posture: leave unchanged and do not add V2 rows here unless the app is explicitly updated, because current reads do not filter by version/source. Refs: `video_occurrence_service.dart` (line 80), `personal_indexing_data_service.dart` (line 156), `personal_indexing_data_service.dart` (line 367), `20251224000000_indexing_schema.sql` (line 33)

`indexing_runs`: edge-function read/write only in the app repo; no direct Flutter reads were found. It is the audit/processing-run table for transcript acquisition and verse detection; key columns are `id`, `video_id`, `source_video_id`, `phase`, `engine`, `status`, `duration_ms`, `meta`. Safest V2 posture: leave unchanged; if V2 reuses it, keep `meta.request_id` and current `status` / `phase` semantics. Refs: `20251224000000_indexing_schema.sql` (line 175), `indexing_runs.ts` (line 84), `indexing_runs.ts` (line 117)

`indexing_outputs`: edge-function read/write only in the app repo; no direct Flutter reads were found. It stores persisted JSON contract outputs keyed by `video_id + output_type`; key columns are `video_id`, `source_video_id`, `indexing_run_id`, `output_type`, `payload`. Safest V2 posture: leave unchanged and avoid writing V2 data under existing V1 `output_type`s. Refs: `20260211170000_indexing_outputs_json_contract.sql` (line 3), `20260307225500_indexing_outputs_transcript_debug.sql` (line 1), `indexing_outputs.ts` (line 134)

`video_user_access`: direct app/RPC visibility dependency + personal-indexing write. Personal indexing uses it to grant/reuse access on shared private indexed videos; key columns are `video_id`, `user_id`, `access_type`. Safest V2 posture: leave unchanged if V2 touches private/personal indexing at all. Refs: `20260308090000_personal_video_access_model.sql` (line 3), `index_personal_video/index.ts` (line 720), `20260308090000_personal_video_access_model.sql` (line 151)

## 2. Shared functions

`index_personal_video`: private/personal indexing orchestrator; app currently calls this directly. It reuses existing private videos, writes transcript/status rows, invokes transcript lanes and verse detectors, and returns the response model the app UI uses. First-pass V2 should avoid changing it directly. Refs: `personal_video_index_service.dart` (line 166), `index_personal_video/index.ts` (line 1258), `index_personal_video/index.ts` (line 2554)

`index_video`: public indexing orchestrator; no direct Flutter invocation was found in the app repo, so admin/public caller is uncertain from the app repo alone. It upserts the shared public `videos` row, runs transcript acquisition, transcript verse detection, optional OCR, and finalizes public visibility/listing state. First-pass V2 should avoid changing it directly. Refs: `index_video/index.ts` (line 504), `index_video/index.ts` (line 1370), `index_video/index.ts` (line 1831)

`acquire_transcript_lane1_youtube`, `acquire_transcript_lane2_proxy`, `acquire_transcript_lane3_whisper`: transcript acquisition lanes. App does not call them directly; both orchestrators call them. Each writes `transcript_segments`, skips if segments already exist and `explicitReindex` is false, and deletes/replaces on explicit reindex. First-pass V2 should avoid changing them directly. Refs: `index_video/index.ts` (line 910), `index_personal_video/index.ts` (line 1618), `acquire_transcript_lane1_youtube/index.ts` (line 462), `acquire_transcript_lane2_proxy/index.ts` (line 537), `acquire_transcript_lane3_whisper/index.ts` (line 342)

`detect_verses_from_transcript`: transcript-based verse detector. App does not call it directly; both orchestrators call it. It locks Gemini verse runs, preflights overwrite against `indexing_outputs`, deletes existing `gemini_transcript` rows from `verse_occurrences`, inserts replacements, and stores `transcript_occurrences` plus `transcript_debug`. First-pass V2 should avoid changing it directly. Refs: `index_video/index.ts` (line 1379), `index_personal_video/index.ts` (line 2012), `detect_verses_from_transcript/index.ts` (line 691), `detect_verses_from_transcript/index.ts` (line 957), `detect_verses_from_transcript/index.ts` (line 1113)

`detect_verses_from_ocr`: OCR-based verse detector. App does not call it directly; both orchestrators call it when OCR is enabled. It preflights overwrite against `indexing_outputs`, deletes existing `ocr_pipeline` rows from `verse_occurrences`, inserts replacements, and stores `ocr_occurrences`. First-pass V2 should avoid changing it directly. Refs: `index_video/index.ts` (line 1648), `index_personal_video/index.ts` (line 2343), `detect_verses_from_ocr/index.ts` (line 672), `detect_verses_from_ocr/index.ts` (line 722)

`admin_repair_source_video`: repair utility touching the same indexing tables. No app-side invocation was found; likely admin/ops-facing, but caller is uncertain from the app repo alone. It deletes/recreates `transcript_segments`, `verse_occurrences`, `indexing_outputs`, `video_user_access`, `indexing_runs`, and `videos` data for repair flows. V2 should not change its assumptions in the first pass. Refs: `admin_repair_source_video/index.ts` (line 21), `admin_repair_source_video/index.ts` (line 50), `admin_repair_source_video/index.ts` (line 125), `admin_repair_source_video/index.ts` (line 190)

## 3. Shared artifacts and outputs

Materialized transcript artifact: `public.transcript_segments` with `{ video_id, source_video_id, start_ms, end_ms, text }`. The app directly searches and renders this table. Refs: `20251224000000_indexing_schema.sql` (line 3), `personal_indexing_data_service.dart` (line 345)

Materialized verse-hit artifact: `public.verse_occurrences` with row fields including `{ video_id, source_video_id, anchor_verse_id, start_ms, end_ms, kind, has_spoken, raw_snippet, detection_source, detection_version }`. The app reads this directly and via `search_verse_occurrences`. Refs: `20251224000000_indexing_schema.sql` (line 33), `video_occurrence_service.dart` (line 88), `personal_indexing_data_service.dart` (line 367)

Contract JSON output `transcript_occurrences`: stored in `public.indexing_outputs.payload`, `output_type='transcript_occurrences'`, shape `{ video_url, transcript_source, occurrences[] }`, where each occurrence carries verse anchors/reference/timestamps/classification/display text. Refs: `schema_validate.ts` (line 43), `detect_verses_from_transcript/index.ts` (line 1075), `20260211170000_indexing_outputs_json_contract.sql` (line 3)

Contract JSON output `ocr_occurrences`: stored in `public.indexing_outputs.payload`, `output_type='ocr_occurrences'`, shape `{ video_url, sampling: "1_per_5s", occurrences[] }`. Refs: `schema_validate.ts` (line 56), `detect_verses_from_ocr/index.ts` (line 764)

Contract JSON output `transcript_debug`: stored in `public.indexing_outputs.payload`, `output_type='transcript_debug'`, with counts, drop reasons, insert compatibility, transcript segments, and chunk debug. The app does not directly read it, but personal indexing recovery logic treats `transcript_occurrences` existence as reusable state. Refs: `20260307225500_indexing_outputs_transcript_debug.sql` (line 1), `detect_verses_from_transcript/index.ts` (line 1050)

Status/output model on `videos`: public completion writes `visibility='public'`, `listing_state='published'`, `indexing_status='complete'`; personal completion writes `visibility='private'`, `listing_state='indexed'`, `indexing_status='complete'`; both also use `transcript_status`, `verse_status`, and `transcript_timing_mode`. Refs: `index_video/index.ts` (line 1826), `index_personal_video/index.ts` (line 2535)

Storage paths: no current indexing use of Supabase Storage buckets/paths was found in the inspected indexing functions; persisted indexing artifacts are DB-backed, not storage-object-backed. Refs: `acquire_transcript_lane1_youtube/index.ts` (line 560), `detect_verses_from_transcript/index.ts` (line 1113), `detect_verses_from_ocr/index.ts` (line 764)

## 4. Safety mechanisms

Public in-flight guard is row-status based, not DB-lock based: `index_video` returns `202` if any of `videos.transcript_status`, `verse_status`, or `indexing_status` is already `processing`. Refs: `index_video/index.ts` (line 521)

Personal stale-run recovery exists: `index_personal_video` loads `indexing_runs`, treats runs older than `30` minutes as stale, fails them, and patches the `videos` row back to `failed` / `draft`. Refs: `stale_processing.ts` (line 3), `index_personal_video/index.ts` (line 877), `index_personal_video/index.ts` (line 1307)

Transcript acquisition is cache-first and explicit-reindex gated: all three lane functions skip if `transcript_segments` already exists and only delete/reset on `explicitReindex=true`. Refs: `acquire_transcript_lane1_youtube/index.ts` (line 475), `acquire_transcript_lane2_proxy/index.ts` (line 550), `acquire_transcript_lane3_whisper/index.ts` (line 355)

Transcript verse detection has an explicit run lock plus overwrite preflight: it refuses concurrent `gemini_transcript` verse-detection runs for the same video and refuses overwriting a different run’s `transcript_occurrences` unless `explicitReindex` is set. OCR has overwrite preflight but no equivalent run lock was found. Refs: `detect_verses_from_transcript/index.ts` (line 462), `detect_verses_from_transcript/index.ts` (line 720), `detect_verses_from_ocr/index.ts` (line 672)

Verse writes are delete-then-insert by `detection_source`: transcript deletes existing `gemini_transcript` rows; OCR deletes existing `ocr_pipeline` rows. Insert compatibility code normalizes rows, strips legacy-missing columns, and can salvage individually insertable rows, but the replacement is not atomic/transactional. Refs: `detect_verses_from_transcript/index.ts` (line 957), `detect_verses_from_ocr/index.ts` (line 722), `verse_occurrence_writes.ts` (line 231), `verse_occurrence_writes.ts` (line 352)

Personal reuse/retry logic is stronger than public: if a private video is already complete or processing, `index_personal_video` reuses it; if statuses drift but `transcript_occurrences` exists, it can recover the row back to complete and return reuse metadata instead of reindexing. Refs: `personal_video_reuse.ts` (line 21), `index_personal_video/index.ts` (line 806), `index_personal_video/index.ts` (line 1387), `index_personal_video/index.ts` (line 2151)

`indexing_runs.meta` has enforced semantics if reused: `request_id` is required, cannot be changed on completion/failure, and secret-like keys are rejected. Refs: `indexing_runs.ts` (line 36), `20251224000000_indexing_schema.sql` (line 240)

## 5. Migration risk notes

Highest risk is writing V2 transcript/verse data into the existing V1 materialized tables. Current app reads `transcript_segments` and `verse_occurrences` directly with no version filter, and the search/content RPCs use those same tables. Duplicate V2 rows would surface as duplicate search hits, duplicate verse refs, and ambiguous snippets. Refs: `personal_indexing_data_service.dart` (line 345), `personal_indexing_data_service.dart` (line 367), `20260308090000_personal_video_access_model.sql` (line 151), `20260208000200_content_layers_and_creator_publish.sql` (line 437)

Writing V2 rows to `verse_occurrences` under a new `detection_source` is still unsafe. Current app reads/searches all rows by `video_id` / `anchor_verse_id`; it does not filter to `gemini_transcript` or `ocr_pipeline`. Refs: `video_occurrence_service.dart` (line 88), `personal_indexing_data_service.dart` (line 367)

Writing V2 transcript rows into `transcript_segments` is unsafe even if additive. Current lane functions treat the mere presence of transcript rows as reusable cache, and some app resolution/search paths fall back from `videos.source_video_id` to `transcript_segments.source_video_id`. Refs: `acquire_transcript_lane1_youtube/index.ts` (line 475), `personal_indexing_data_service.dart` (line 143)

Reusing V1 `indexing_outputs.output_type`s is unsafe. `indexing_outputs` is unique on `(video_id, output_type)`, helpers reject different-run overwrites unless explicit reindex is set, and personal recovery logic treats existing `transcript_occurrences` as recoverable completion state. Refs: `20260211170000_indexing_outputs_json_contract.sql` (line 51), `indexing_outputs.ts` (line 99), `index_personal_video/index.ts` (line 806)

Touching shared `videos` state on existing rows is high risk. The app buckets indexed/unindexed using `indexing_status == 'complete'`; public views require `visibility='public'` and `listing_state='published'`; private reuse expects `listing_state='indexed'`. Those writes also fire side-effect triggers that consume free index quota and officialize channels. Refs: `content_video_service.dart` (line 458), `20260208000200_content_layers_and_creator_publish.sql` (line 473), `20260211000001_free_index_quota_on_complete.sql` (line 50), `20260211000000_channel_assignments_and_lifecycle.sql` (line 236)

Creating alternate shared `videos` rows keyed to the same public `source_video_id` will collide with the unique index and current upsert strategy. Refs: `20251222001712_videos_add_youtube_metadata_columns.sql` (line 10), `index_video/index.ts` (line 197), `index_personal_video/index.ts` (line 600)

## 6. Recommendation

Safest first pass: keep V2 fully additive in new tables and new function names, keyed back to the existing `videos.id` / `source_video_id`, but do not write V2 rows into `transcript_segments`, `verse_occurrences`, or V1 `indexing_outputs` types yet.

Do not mutate shared V1 `videos` status / listing / visibility fields in the prototype. Read V1 for comparison only.

If V2 needs persisted JSON artifacts, use a new table or new output-type namespace that current helpers do not interpret as reusable V1 completion.
