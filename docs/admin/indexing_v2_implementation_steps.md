# Indexing V2 Implementation Steps

Last updated: 2026-03-26

## Purpose

This document records the current implementation order for the admin-repo V2 prototype.

The sequence below reflects the simplified product definition:

```text
Transcript -> Verse Detection -> Ordered Occurrences
```

## Source Documents

These files define the contract that implementation should follow:

- [indexing_v2_pipeline_spec.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_pipeline_spec.md)
- [indexing_v2_design_package.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_design_package.md)
- [indexing_v2_implementation_prerequisites.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_implementation_prerequisites.md)
- [indexing_v2_resolver_validation_plan.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_resolver_validation_plan.md)
- [indexing_v2_shared_supabase_context.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/indexing_v2_shared_supabase_context.md)
- [transcript_retiming_next_steps.md](/Users/phoenixparks/Projects/Marginality-admin/docs/admin/transcript_retiming_next_steps.md)

## Current Build Order

### Step 1

Stabilize transcript intake:

- upstream transcript reuse
- transcript override text
- transcript override JSON
- timing-authority classification for each run
- current admin V2 runner uses cached upstream transcript reuse or override input only
- fresh transcript acquisition remains outside this runner for now

### Step 2

Stabilize verse detection:

- shared Gemini transcript dry-run when available
- transcript-driven candidate generation
- optional OCR support
- deterministic normalization and deduplication fallback

### Step 3

Make ordered occurrences first-class:

- persist `occurrence_index`
- persist transcript linkage
- allow nullable/low-trust timestamp metadata
- keep lineage from occurrence back to candidates

### Step 4

Make validation and review order-first:

- review by occurrence order
- show timing authority clearly
- avoid treating approximate timestamps as authoritative playback controls

### Step 5

Only after admin V2 is stable, evaluate migration into the app repo.

## Required Files

Implementation should continue to center on:

- `supabase/migrations/*indexing_v2*.sql`
- `supabase/functions/admin_indexing_v2_test_run/index.ts`
- `app/lib/indexing-v2-testing.server.ts`
- `app/lib/indexing-v2-resolver.server.ts`
- `app/lib/indexing-v2-validation.server.ts`
- `app/routes/admin.indexing-v2-testing._index.tsx`
- `app/routes/admin.indexing-v2-testing.runs.$id.tsx`

## Out Of Scope For This Slice

- WhisperX implementation
- audio acquisition implementation
- dependency on Cobalt or other audio providers
- moving V2 ownership into the app repo
