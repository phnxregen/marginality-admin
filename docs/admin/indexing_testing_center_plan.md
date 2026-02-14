# Indexing Testing Center Plan (Hardened)

Last updated: 2026-02-13

## Phase Status

- [x] Phase 0 — Security decision and guardrails
- [x] Phase 1 — Database foundation (normalized + versioned)
- [x] Phase 2 — Secure Edge Function (`admin_indexing_test_run`)
- [x] Phase 3 — Remix Admin UI
- [x] Phase 4 — App repo preflight overwrite guard + concurrency lock
- [x] Phase 5 — OCR override MVP
- [ ] Phase 6 — Regression diff engine
- [ ] Phase 7 — Polish

## Scope

This plan adds an Admin Indexing Testing Center so we can:

- run controlled indexing tests
- store fixtures
- perform regression diffs
- safely rerun indexing
- debug logs and metrics
- validate OCR
- avoid partial mutation bugs
- prevent public abuse

Admin repo handles orchestration + UI.  
App repo handles indexing safety + OCR logic.

---

## Phase 0 — Security Decision (Blocker) ✅ Complete

Security Option A is confirmed:

- allow server-side service-role usage in Remix loaders/actions
- `SUPABASE_SERVICE_ROLE_KEY` is server-only
- key must never be exposed to browser bundle
- admin gating must happen before privileged queries
- edge functions enforce admin auth

Implemented in this repo:

- server-only Supabase helper module with service + anon clients:
  - `app/lib/supabase.server.ts`
- centralized admin gate helper:
  - `app/lib/admin.server.ts` (`requireAdmin(request)`)
- docs updated with server-only key warning:
  - `docs/admin/SETUP.md`
- existing admin routes now call `requireAdmin(request)` at loader/action entry
- lint guardrails added:
  - no direct `createClient` in routes
  - no `getServiceClient()` use/import outside `*.server.ts`

---

## Phase 1 — Database Foundation (Normalized + Versioned)

Status: complete (2026-02-13)

Migration applied:

- `supabase/migrations/20260213130500_indexing_testing_center_phase1.sql`

`supabase db push` result:

- applied `20260213130500_indexing_testing_center_phase1.sql`
- completed without errors
- notices only for expected first-run `DROP ... IF EXISTS` skips

Remote migration history:

- `supabase migration list` shows local and remote both at `20260213130500`

### 1.1 Tables

Create migration with:

1) `indexing_test_runs`

- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `requested_by_user_id uuid null`
- `youtube_url text not null`
- `youtube_video_id text not null`
- `source_video_id text null`
- `run_mode text not null default 'admin_test'`
- `status text not null default 'queued'`
- `indexing_run_id uuid null`
- `contract_version text not null default 'v1'`
- `pipeline_version text null`
- `error_code text null`
- `error_message text null`
- `transcript_count int default 0`
- `ocr_count int default 0`
- `transcript_source text null`
- `lane_used text null`
- `duration_ms int null`

No large JSON blobs in this table.

2) `indexing_test_outputs`

- `test_run_id uuid pk references indexing_test_runs(id) on delete cascade`
- `created_at timestamptz default now()`
- `transcript_json jsonb not null`
- `ocr_json jsonb not null`

3) `indexing_test_logs`

- `id uuid pk default gen_random_uuid()`
- `test_run_id uuid references indexing_test_runs(id) on delete cascade`
- `t timestamptz default now()`
- `level text not null`
- `msg text not null`
- `data jsonb null`

4) `indexing_test_fixtures`

- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz default now()`
- `name text not null`
- `youtube_video_id text not null`
- `youtube_url text not null`
- `expected_transcript_json jsonb not null`
- `expected_ocr_json jsonb not null`
- `contract_version text not null default 'v1'`
- `pipeline_version text null`
- `notes text null`
- `tags text[] default '{}'`

5) `indexing_test_comparisons`

- `id uuid pk default gen_random_uuid()`
- `created_at timestamptz default now()`
- `fixture_id uuid references indexing_test_fixtures(id) on delete cascade`
- `test_run_id uuid references indexing_test_runs(id) on delete cascade`
- `diff_algorithm_version text not null default 'v1'`
- `result jsonb not null`

### 1.2 RLS

- enable RLS on all testing-center tables
- policies allow only `service_role`
- admin access via Remix server only

### 1.3 Indexes

- `indexing_test_runs(youtube_video_id, created_at desc)`
- `indexing_test_logs(test_run_id, t)`
- `indexing_test_comparisons(fixture_id)`
- `indexing_test_comparisons(test_run_id)`

### 1.4 Execution

- create migration
- `supabase db push`
- verify tables, RLS, and indexes
- record migration name + CLI output

---

## Phase 2 — Secure Edge Function: `admin_indexing_test_run`

Status: complete (2026-02-13)

Implemented:

- function created:
  - `supabase/functions/admin_indexing_test_run/index.ts`
- deployed:
  - `supabase functions deploy admin_indexing_test_run`
- secure admin auth enforced via:
  - `supabase/functions/_shared/admin_auth.ts`
- request validation includes:
  - required `youtubeUrl`
  - `youtubeVideoId` extraction
  - `runMode` validation
  - optional `partnerChannelId` pass-through for `index_video`
  - personal-mode `requestedByUserId` enforcement
- writes normalized records:
  - `indexing_test_runs` (`processing` -> `complete`/`failed`)
  - `indexing_test_logs` (step-by-step log entries)
  - `indexing_test_outputs` (only on successful indexer response)
- no large output JSON stored in `indexing_test_runs`

Smoke test summary:

- temporary admin user + JWT created for test invocation
- function invocation returned `testRunId`
- `indexing_test_runs` row created and transitioned to `failed`
- `indexing_test_logs` rows persisted (4 rows in test run)
- personal mode without `requestedByUserId` correctly rejected
- note: run failed in upstream indexing dependencies (`Gemini API key not valid`) but proved run creation, status transition, and log persistence in this function

Must not be public.

### 2.1 Security

- require `Authorization: Bearer <jwt>`
- validate JWT via Supabase auth
- confirm user in `admin_users`
- reject non-admin callers

### 2.2 Behavior

POST input:

```json
{
  "youtubeUrl": "string",
  "sourceVideoId": "string?",
  "runMode": "admin_test|public|personal?",
  "requestedByUserId": "uuid?",
  "options": {}
}
```

Flow:

1. validate input, extract `youtubeVideoId`
2. insert `indexing_test_runs` (`status='processing'`)
3. append step logs into `indexing_test_logs`
4. call `index_personal_video` when `runMode='personal'`, otherwise `index_video`
5. store outputs in `indexing_test_outputs`
6. update run metrics fields in `indexing_test_runs`
7. set `status='complete'`
8. on errors: set `status='failed'`, `error_code`, `error_message`, and write log row

Return:

```json
{
  "testRunId": "uuid",
  "status": "processing|complete|failed",
  "metrics": {},
  "error": {}
}
```

### 2.3 Personal Mode Safety

- if `runMode='personal'`, `requestedByUserId` is required
- enforce correct attribution or reject

### 2.4 Deployment + Smoke Test

- deploy function:
  - `supabase functions deploy admin_indexing_test_run`
- verify:
  - run row created
  - status transitions occur
  - logs persisted

---

## Phase 3 — Remix Admin UI

Status: complete (2026-02-13)

Implemented routes:

- `app/routes/admin.indexing-testing.tsx`
- `app/routes/admin.indexing-testing._index.tsx`
- `app/routes/admin.indexing-testing.runs.$id.tsx`
- `app/routes/admin.indexing-testing.fixtures.tsx`
- `app/routes/admin.indexing-testing.fixtures.$id.tsx`
- `app/routes/admin.indexing-testing.runs.$id.transcript[.]json.ts`
- `app/routes/admin.indexing-testing.runs.$id.ocr[.]json.ts`

Server-only data layer:

- `app/lib/indexing-testing.server.ts`
- all route loaders/actions call `requireAdmin(request)` first
- service-role usage is confined to `*.server.ts` helpers

Delivered UI:

- create run form with all required options and OCR override parser
- recent runs table
- run detail page with status/metrics/logs/output viewers
- save-as-fixture action from run detail
- fixture list and fixture detail pages
- run-against-fixture action
- JSON download endpoints with attachment headers

All loaders/actions must call `requireAdmin(request)` first.

Routes:

- `/admin/indexing-testing`
- `/admin/indexing-testing/runs/:id`
- `/admin/indexing-testing/fixtures`
- `/admin/indexing-testing/fixtures/:id`

Create Run form fields:

- `youtubeUrl`
- `sourceVideoId`
- `runMode`
- `enableOcr`
- `explicitReindex`
- `useCacheOnly`
- lane toggles (only real lanes)
- `chunkMinutes` (default `7`)
- `chunkOverlapSeconds` (default `15`)
- OCR override textarea

OCR override parser:

- input line format: `mm:ss | text`
- output: `{ t: string, text: string }`
- include only when `enableOcr=true`

Run detail loader:

- fetch run
- fetch outputs
- fetch logs

Run detail UI:

- status panel
- metrics summary
- logs timeline
- transcript JSON viewer
- OCR JSON viewer
- rerun button
- save as fixture

Download routes:

- `/admin/indexing-testing/runs/:id/transcript.json`
- `/admin/indexing-testing/runs/:id/ocr.json`

Return headers:

- `Content-Type: application/json`
- `Content-Disposition: attachment`

---

## Phase 4 — App Repo: Prevent Partial Mutation (Critical)

Status: complete (2026-02-13)

Implemented in app repo (`/Users/phoenixparks/Projects/Marginally-master`):

- shared overwrite-preflight helper added:
  - `supabase/functions/_shared/indexing_outputs.ts`
  - new export `evaluateIndexingOutputPreflight(...)`
- new indexing error codes:
  - `OVERWRITE_BLOCKED`
  - `CONCURRENT_RUN_LOCKED`
  - file: `supabase/functions/_shared/indexing_errors.ts`
- transcript detection preflight now runs before any `verse_occurrences` mutation:
  - file: `supabase/functions/detect_verses_from_transcript/index.ts`
  - behavior:
    - checks in-flight run ordering guard (per-video gemini verse_detection processing run ownership)
    - runs output overwrite preflight for `transcript_occurrences`
    - returns `409` with structured guard payload when blocked
    - includes `preflightOverwriteGuard`/`runLockGuard` in responses for debug visibility
- index_video flow updated to classify and log guard outcomes in indexing run meta:
  - file: `supabase/functions/index_video/index.ts`
  - blocked preflight now maps to `OVERWRITE_BLOCKED`
  - run-order guard block maps to `CONCURRENT_RUN_LOCKED`
  - success/failure meta includes `preflight_overwrite_guard` and `run_lock_guard`
- index_personal_video updated similarly:
  - file: `supabase/functions/index_personal_video/index.ts`
  - now accepts `explicitReindex` input
  - passes `indexingRunId` + `explicitReindex` into transcript detection
  - maps blocked conditions to the same error codes and meta fields

Deployment completed (app repo):

- `supabase functions deploy detect_verses_from_transcript`
- `supabase functions deploy index_video`
- `supabase functions deploy index_personal_video`

### 4A.1 Goal

Prevent destructive changes if overwrite is blocked.

### 4A.2 Concurrency lock

Before destructive mutation:

- acquire advisory lock (`pg_advisory_xact_lock(hash(youtubeVideoId))`)
- or lock relevant `videos` row (`SELECT ... FOR UPDATE`)

### 4A.3 Preflight check

Before deleting `verse_occurrences`:

- check overwrite eligibility
- if `explicitReindex=false` and overwrite blocked:
  - abort with `OVERWRITE_BLOCKED`
  - no mutation
- write preflight pass/fail log

### 4A.4 Lock release

- lock released at transaction end

---

## Phase 5 — OCR Override MVP (App Repo)

Status: complete (2026-02-13)

Implemented in app repo (`/Users/phoenixparks/Projects/Marginally-master`):

- OCR pipeline function upgraded from stub to working override-driven flow:
  - file: `supabase/functions/detect_verses_from_ocr/index.ts`
  - accepts `enableOcr` + `ocrRawSegmentsOverride` from top-level or nested `options`
  - normalizes override rows into raw OCR segments (`mm:ss`/`hh:mm:ss` compatible)
  - extracts OCR candidates with canonical-book + abbreviation matching
  - normalizes references into verse IDs and deterministic ranges (same chapter), drops invalid refs
  - emits `Occurrence` objects with:
    - `classification="onscreen"`
    - `transcript_is_spoken=false`
  - stores normalized OCR detections into `verse_occurrences` (`detection_source='ocr_pipeline'`)
  - stores OCR JSON in `indexing_outputs` (`outputType='ocr_occurrences'`)
  - returns real counts: `ocrRawSegments`, `ocrCandidates`, `inserted`, `droppedInvalidCandidates`
- overwrite preflight guard added for OCR output before destructive OCR mutation:
  - blocks conflicting runs with `INDEXING_OUTPUT_RUN_CONFLICT` when `explicitReindex=false`
  - includes `preflightOverwriteGuard` in responses for debugging
- index_video now respects nested admin options for OCR + reindex:
  - file: `supabase/functions/index_video/index.ts`
  - parses `options.explicitReindex` and `options.enableOcr`
  - passes `ocrRawSegmentsOverride` through to OCR function
  - supports OCR-disabled mode (`enableOcr=false`) with explicit skipped OCR run metadata
- index_personal_video now supports the same OCR override path:
  - file: `supabase/functions/index_personal_video/index.ts`
  - parses nested `options.explicitReindex`/`options.enableOcr`
  - runs optional OCR phase and persists OCR run metadata/results
  - includes OCR counts/json in success payload when enabled

Deployment completed (app repo):

- `supabase functions deploy detect_verses_from_ocr`
- `supabase functions deploy index_video`
- `supabase functions deploy index_personal_video`

Smoke checks:

- `detect_verses_from_ocr` invocation with synthetic input now returns typed function response (`404` on unknown video, confirming runtime path)
- `index_video` invocation with invalid URL returns expected `400` validation response
- `index_personal_video` unauthenticated invocation returns expected `401` response

If `enableOcr=true` and `ocrRawSegmentsOverride` provided:

- skip frame extraction
- treat override as raw OCR input

Pipeline requirements:

- strict Bible-reference regex extraction
- normalize canonical books + abbreviations
- chapter/verse validation
- deterministic range expansion
- drop invalid references
- `classification="onscreen"`
- `transcript_is_spoken=false`

Return same JSON contract shape with counts:

- `ocrRawSegments`
- `ocrCandidates`
- `occurrences`

---

## Phase 6 — Regression Diff Engine (Admin Repo)

Two-pass matching:

1. `anchor_verse_id` + nearest time
2. fallback: `anchor_verse_id` only

Classifications:

- `added`
- `removed`
- `shifted`
- `changed classification`

Pass condition:

- no `added`/`removed`
- only allowed time shifts (±2s)

Store:

- `diff_algorithm_version='v1'`

---

## Phase 7 — Polish

Add:

- auto-refresh while processing
- manual refresh button
- copy summary button
- JSON download buttons
- summary metrics panel

---

## Implementation Order

1. Phase 0 — security
2. Phase 1 — DB
3. Phase 2 — edge function
4. Phase 3 — UI
5. Phase 4 — app preflight guard + lock
6. Phase 5 — OCR override
7. Phase 6 — diff engine
8. Phase 7 — polish
