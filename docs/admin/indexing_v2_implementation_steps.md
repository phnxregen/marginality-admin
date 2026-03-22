# Indexing V2 Implementation Steps

Last updated: 2026-03-21

## Purpose

This document defines the first implementation sequence for an additive Indexing V2 prototype in the admin repo.

The goal is:

- get a working V2 prototype in the admin repo
- keep shared Supabase risk low
- avoid mutating V1 production indexing behavior
- produce a version that can later be transferred into the app repo with less guesswork

## Non-Negotiable Guardrails

- do not write V2 transcript data into `public.transcript_segments`
- do not write V2 occurrence data into `public.verse_occurrences`
- do not write V2 payloads under existing V1 `public.indexing_outputs.output_type` values
- do not mutate shared V1 `videos.visibility`, `listing_state`, `indexing_status`, `transcript_status`, or `verse_status` fields for the prototype
- do not modify `index_video`, `index_personal_video`, `detect_verses_from_transcript`, or `detect_verses_from_ocr` in the first pass
- keep V2 fully additive: new tables, new functions, new routes
- tag all V2 prototype runs with `pipeline_version='indexing_v2'`

## Source Of Truth Files

These files define the product and technical contract for the prototype:

- [indexing_v2_pipeline_spec.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_pipeline_spec.md): overall V2 behavior and target UX
- [indexing_v2_design_package.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_design_package.md): concrete schema, resolver, OCR, snippet, and payload contracts
- [indexing_v2_implementation_prerequisites.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_implementation_prerequisites.md): fixed rollout decisions and implementation boundaries
- [indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md): validation gate and fixture acceptance criteria
- [indexing_v2_shared_supabase_context.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_shared_supabase_context.md): shared-Supabase safety constraints from the app repo
- [transcript_timing_validation_steps.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/transcript_timing_validation_steps.md): timing validation policy for exact vs approximate transcript timing

## Existing Reference Files

These files are implementation references. Reuse patterns from them, but do not force V2 into their V1 contracts.

- [supabase/functions/admin_indexing_test_run/index.ts](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_test_run/index.ts): current admin-run test orchestrator; reference for admin auth, test-run creation, and upstream inspection
- [app/lib/indexing-testing.server.ts](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-testing.server.ts): current server helper layer for test runs, outputs, logs, and fixture creation
- [app/lib/indexing-test-reconciliation.server.ts](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-test-reconciliation.server.ts): current upstream reconciliation pattern against shared indexing state
- [app/routes/admin.indexing-testing.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.tsx): current testing-center layout route
- [app/routes/admin.indexing-testing._index.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing._index.tsx): current create-run page
- [app/routes/admin.indexing-testing.runs.$id.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.runs.$id.tsx): current run detail route
- [app/components/Sidebar.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/components/Sidebar.tsx): admin navigation
- [supabase/migrations/20260213130500_indexing_testing_center_phase1.sql](/Users/phoenixparks/Projects/Marginality-admin/supabase/migrations/20260213130500_indexing_testing_center_phase1.sql): current admin testing-center schema

## New Files To Create

These are the first-pass V2 prototype files and their roles.

- `supabase/migrations/<timestamp>_indexing_v2_prototype.sql`: additive V2 schema for prototype tables
- `supabase/functions/admin_indexing_v2_test_run/index.ts`: admin-only V2 orchestration function
- `app/lib/indexing-v2-testing.server.ts`: server-side loader/start helpers for V2 runs and artifacts
- `app/lib/indexing-v2-resolver.server.ts`: deterministic resolver logic
- `app/lib/indexing-v2-validation.server.ts`: validation report generation using the resolver validation plan
- `app/routes/admin.indexing-v2-testing.tsx`: V2 testing-center layout route
- `app/routes/admin.indexing-v2-testing._index.tsx`: V2 create-run page
- `app/routes/admin.indexing-v2-testing.runs.$id.tsx`: V2 run-detail review route
- `app/routes/admin.indexing-v2-testing.runs.$id.occurrences[.]json.ts`: V2 occurrences artifact download route
- `app/routes/admin.indexing-v2-testing.runs.$id.candidates[.]json.ts`: V2 candidates artifact download route
- `app/routes/admin.indexing-v2-testing.runs.$id.validation[.]json.ts`: V2 validation artifact download route

## Existing Files To Edit

- [app/components/Sidebar.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/components/Sidebar.tsx): add navigation entry for the V2 testing center
- [docs/admin/indexing_v2_implementation_prerequisites.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_implementation_prerequisites.md): update only if implementation decisions materially change

## Prototype Scope For First Pass

The first working V2 slice should be transcript-first and admin-only.

It must do all of the following:

- create a V2 run record
- resolve the upstream `videos.id` and `source_video_id` read-only
- ingest transcript input from a safe source
- persist transcript artifacts in V2 tables
- generate V2 candidates
- run the deterministic resolver
- persist resolved occurrences plus candidate lineage
- generate a validation report
- render the run in an occurrence-first review route

It does not need to do all of the following yet:

- audio acquisition
- WhisperX
- OCR fusion
- writes into V1 production materialized tables
- app-facing production integration

## Step Sequence

### Step 1. Add The V2 Prototype Schema

Create one additive migration in `supabase/migrations`.

Minimum first-pass tables:

- `indexing_v2_runs`
- `indexing_v2_run_artifacts`
- `indexing_v2_candidates`
- `indexing_v2_occurrences`
- `indexing_v2_occurrence_candidates`
- `indexing_v2_validation_reports`

Recommended run-table fields:

- `id`
- `test_run_id`
- `upstream_video_id`
- `source_video_id`
- `youtube_video_id`
- `youtube_url`
- `run_mode`
- `status`
- `pipeline_version`
- `execution_mode`
- `timing_authority`
- `timing_confidence`
- `error_code`
- `error_message`
- `created_at`
- `updated_at`

Recommended artifact-table behavior:

- store raw transcript input
- store candidate export JSON
- store resolved occurrence export JSON
- store validation export JSON
- use V2-only `artifact_type` values

Done when:

- the V2 schema exists without mutating shared V1 tables
- the migration is additive and reversible in principle

### Step 2. Add The V2 Edge Function

Create `supabase/functions/admin_indexing_v2_test_run/index.ts`.

Role:

- admin-only orchestration entrypoint for V2 prototype runs

First-pass behavior:

- verify admin auth
- create or update an admin test-run shell if needed
- create `indexing_v2_runs` row
- resolve upstream `videos.id` / `source_video_id` read-only
- pull transcript input from safe sources
- persist transcript artifact
- call resolver pipeline
- persist candidates, occurrences, validation report, and logs
- return V2 run identifiers for the admin UI

Important first-pass constraint:

- do not invoke or mutate V1 production indexing functions unless the call is strictly read-only and documented

### Step 3. Add Server Helpers For V2

Create `app/lib/indexing-v2-testing.server.ts`.

Role:

- typed access layer for V2 runs, artifacts, validation, and run startup

Minimum functions:

- `startIndexingV2TestRun()`
- `listIndexingV2Runs()`
- `getIndexingV2Run()`
- `getIndexingV2Artifacts()`
- `getIndexingV2Candidates()`
- `getIndexingV2Occurrences()`
- `getIndexingV2ValidationReport()`

Keep this separate from the V1 helper layer.

### Step 4. Implement The Deterministic Resolver

Create `app/lib/indexing-v2-resolver.server.ts`.

Role:

- convert candidate signals into resolved occurrences using the design-package rules

First-pass responsibilities:

- reject invalid or too-low-confidence candidates
- partition candidates by normalized verse ref
- group candidates into contexts
- apply fusion vs split rules
- choose occurrence type
- choose canonical timestamp
- aggregate confidence
- preserve fused candidate lineage
- emit evidence summary

Use:

- [indexing_v2_design_package.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_design_package.md)
- especially the deterministic resolver rules and span overlap rule

### Step 5. Implement Validation Report Generation

Create `app/lib/indexing-v2-validation.server.ts`.

Role:

- generate machine-readable validation reports for V2 runs

First-pass responsibilities:

- evaluate global invariants
- evaluate fixture anchor checks when the run matches a known validation fixture
- emit a structured report matching the resolver validation plan

Use:

- [indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md)

### Step 6. Add The V2 Admin Layout Route

Create `app/routes/admin.indexing-v2-testing.tsx`.

Role:

- separate V2 testing-center layout

Behavior:

- require admin
- render title, description, and tabs or nav
- keep V2 visually separate from the existing V1 testing center

Reference:

- [admin.indexing-testing.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.tsx)

### Step 7. Add The V2 Create-Run Route

Create `app/routes/admin.indexing-v2-testing._index.tsx`.

Role:

- create and list V2 prototype runs

First-pass input fields:

- `youtubeUrl`
- optional `sourceVideoId`
- `runMode`
- transcript source selection or transcript override path
- OCR enabled flag, but OCR can remain disabled in first pass

Behavior:

- start V2 run
- redirect to V2 run detail route
- list recent V2 runs

Reference:

- [admin.indexing-testing._index.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing._index.tsx)

### Step 8. Add The V2 Run Detail Route

Create `app/routes/admin.indexing-v2-testing.runs.$id.tsx`.

Role:

- primary V2 review surface

Must show:

- run summary
- warnings
- resolved occurrences
- candidate lineage / evidence inspection
- validation report summary
- raw artifact download links
- embedded YouTube player or at minimum player metadata wired for later use

Reference:

- [admin.indexing-testing.runs.$id.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.runs.$id.tsx)

### Step 9. Add V2 Artifact Download Routes

Create:

- `app/routes/admin.indexing-v2-testing.runs.$id.occurrences[.]json.ts`
- `app/routes/admin.indexing-v2-testing.runs.$id.candidates[.]json.ts`
- `app/routes/admin.indexing-v2-testing.runs.$id.validation[.]json.ts`

Role:

- download V2 artifacts directly from admin review surfaces

### Step 10. Add Navigation

Edit [Sidebar.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/components/Sidebar.tsx).

Role:

- add a new nav item for `/admin/indexing-v2-testing`

Keep the existing V1 testing center link intact.

## Safe Transcript Input Strategy For First Pass

The fastest safe transcript-first prototype path is:

1. resolve the upstream video row read-only
2. inspect existing shared artifacts read-only
3. if safe reusable transcript input exists, copy it into a V2 artifact row
4. if not, allow admin-provided transcript input for prototype purposes
5. do not write the transcript back into `transcript_segments`

This avoids blocking the resolver prototype on lane orchestration.

## Explicitly Deferred Work

Do not include these in the first implementation slice:

- V2 OCR extraction and fusion
- V2 audio acquisition ladder
- V2 WhisperX worker wiring
- V2 writes into shared V1 materialized app tables
- production app integration
- historical backfill

Those become later slices after transcript-first V2 is working.

## Definition Of Done For The First Working V2 Slice

The first slice is complete when:

- an admin can start a V2 prototype run from the new V2 testing center
- the run persists into V2 tables only
- transcript input is captured as a V2 artifact
- V2 candidates are generated and stored
- V2 resolved occurrences are generated and stored
- candidate lineage is preserved
- a machine-readable validation report is generated and stored
- the V2 run-detail route renders occurrence-first review
- none of the prohibited shared V1 tables or output types are written

## Initial Implementation Prompt Template

Use the following prompt to start implementation with a coding agent:

```md
Implement the first working additive Indexing V2 prototype in the admin repo.

Read these files first and treat them as source of truth:

- [docs/admin/indexing_v2_pipeline_spec.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_pipeline_spec.md): overall V2 behavior and target UX
- [docs/admin/indexing_v2_design_package.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_design_package.md): concrete V2 contracts for schema, resolver, OCR, snippets, and admin payloads
- [docs/admin/indexing_v2_implementation_prerequisites.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_implementation_prerequisites.md): fixed rollout decisions and additive-first implementation rules
- [docs/admin/indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md): validation gate for resolver behavior
- [docs/admin/indexing_v2_shared_supabase_context.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_shared_supabase_context.md): shared Supabase safety constraints; do not violate these
- [docs/admin/indexing_v2_implementation_steps.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_implementation_steps.md): ordered execution plan for this implementation
- [docs/admin/transcript_timing_validation_steps.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/transcript_timing_validation_steps.md): exact timing validation policy

Existing files and their roles:

- [supabase/functions/admin_indexing_test_run/index.ts](/Users/phoenixparks/Projects/Marginality-admin/supabase/functions/admin_indexing_test_run/index.ts): V1 admin test orchestrator; reference pattern only, do not retrofit V2 into it
- [app/lib/indexing-testing.server.ts](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-testing.server.ts): V1 server helper layer; reference pattern only
- [app/lib/indexing-test-reconciliation.server.ts](/Users/phoenixparks/Projects/Marginality-admin/app/lib/indexing-test-reconciliation.server.ts): reference for upstream read-only inspection and reconciliation patterns
- [app/routes/admin.indexing-testing.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.tsx): V1 testing-center layout; reference pattern only
- [app/routes/admin.indexing-testing._index.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing._index.tsx): V1 create-run route; reference pattern only
- [app/routes/admin.indexing-testing.runs.$id.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/routes/admin.indexing-testing.runs.$id.tsx): V1 run-detail route; reference pattern only
- [app/components/Sidebar.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/components/Sidebar.tsx): admin navigation; add the new V2 route here
- [supabase/migrations/20260213130500_indexing_testing_center_phase1.sql](/Users/phoenixparks/Projects/Marginality-admin/supabase/migrations/20260213130500_indexing_testing_center_phase1.sql): reference for admin testing-center schema patterns

Create these files and give them these roles:

- `supabase/migrations/<timestamp>_indexing_v2_prototype.sql`: additive V2 schema for prototype tables only
- `supabase/functions/admin_indexing_v2_test_run/index.ts`: admin-only V2 orchestrator
- `app/lib/indexing-v2-testing.server.ts`: server-side data access and run start helpers
- `app/lib/indexing-v2-resolver.server.ts`: deterministic resolver implementation
- `app/lib/indexing-v2-validation.server.ts`: validation report generation
- `app/routes/admin.indexing-v2-testing.tsx`: V2 testing-center layout
- `app/routes/admin.indexing-v2-testing._index.tsx`: V2 create-run and list page
- `app/routes/admin.indexing-v2-testing.runs.$id.tsx`: V2 occurrence-first run detail page
- `app/routes/admin.indexing-v2-testing.runs.$id.occurrences[.]json.ts`: V2 occurrences download route
- `app/routes/admin.indexing-v2-testing.runs.$id.candidates[.]json.ts`: V2 candidates download route
- `app/routes/admin.indexing-v2-testing.runs.$id.validation[.]json.ts`: V2 validation report download route

Edit these existing files:

- [app/components/Sidebar.tsx](/Users/phoenixparks/Projects/Marginality-admin/app/components/Sidebar.tsx): add nav entry for the V2 testing center

Non-negotiable guardrails:

- do not write V2 transcript data into `public.transcript_segments`
- do not write V2 occurrence data into `public.verse_occurrences`
- do not write V2 payloads under existing V1 `public.indexing_outputs.output_type` values
- do not mutate shared V1 `videos.visibility`, `listing_state`, `indexing_status`, `transcript_status`, or `verse_status` fields
- do not modify `index_video`, `index_personal_video`, `detect_verses_from_transcript`, or `detect_verses_from_ocr` in this first pass
- keep V2 fully additive
- tag all prototype runs with `pipeline_version='indexing_v2'`

Scope for this first slice:

- transcript-first, admin-only V2 prototype
- safe read-only reuse of upstream video/transcript context where possible
- V2 artifact persistence
- V2 candidate generation
- deterministic resolver
- V2 occurrence persistence
- machine-readable validation report
- occurrence-first admin review route

Do not implement yet:

- OCR fusion
- audio acquisition ladder
- WhisperX wiring
- writes into shared V1 materialized tables
- production app integration

Implementation order:

1. add the additive V2 schema
2. implement `admin_indexing_v2_test_run`
3. implement `app/lib/indexing-v2-testing.server.ts`
4. implement `app/lib/indexing-v2-resolver.server.ts`
5. implement `app/lib/indexing-v2-validation.server.ts`
6. add the V2 layout and create-run routes
7. add the V2 run-detail route
8. add the V2 artifact download routes
9. update the sidebar nav

Definition of done for this slice:

- a V2 run can be started from the new admin V2 testing center
- V2 data is persisted only into new V2 tables
- transcript input is captured as a V2 artifact
- candidates, resolved occurrences, and validation report are persisted
- the V2 run-detail route renders occurrence-first review
- no prohibited shared V1 write path is touched

When finished:

- summarize what was implemented
- list any assumptions
- list any remaining blockers before adding OCR or WhisperX
```
