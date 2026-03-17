# Transcript Timing Validation Steps

Last updated: 2026-03-15

This document defines the lane-agnostic timing-validation gate for transcript acquisition. It is the policy layer that decides whether a transcript is sync-grade, recovery-only, or unusable before downstream consumers treat it as timed media data.

This belongs in the admin repo because the admin repo already owns indexing orchestration, lane evaluation, and testing-plan documentation. If implementation later spans the app repo, this document should remain the policy source of truth and the app repo can reference it from implementation notes.

## Core Policy

Whisper can return segment and word timestamps when using `whisper-1` with `response_format=verbose_json` and `timestamp_granularities`. Word timestamps add latency. Segment timestamps do not add extra latency. That makes Whisper a strong candidate for an exact-timed lane, but not a guaranteed one. It still requires QA before it can be trusted for premium sync.

Current policy:

- Proxy with estimated timestamps: treat as text-only recovery, never sync-grade.
- Proxy with real segment timestamps: candidate exact-timed output, but it must pass QA.
- Whisper with segment or word timestamps: candidate exact-timed output, but it must pass QA.
- Anything that fails QA: downgrade it and do not treat it as synced.

Decision:

- Do not turn off proxy completely yet.
- Do turn off proxy-estimated timing as a sync source.
- Keep proxy text recovery for readable transcript output, text search, verse detection from text, and resilience when timed lanes fail.
- Do not allow proxy-estimated timestamps to become the effective sync lane.

## Validation Contract

Every transcript lane that emits timing must normalize into this validator input:

```ts
type TimingValidationInput = {
  lane: string
  videoDurationSec: number
  transcriptText: string
  segments: Array<{
    startSec: number
    endSec: number
    text: string
    wordCount: number
    sourceType: 'caption' | 'proxy_real_timing' | 'proxy_estimated' | 'asr_segment' | 'asr_word' | 'alignment'
  }>
  words?: Array<{
    word: string
    startSec: number
    endSec: number
  }>
}
```

The validator must return:

```ts
type TimingValidationResult = {
  status: 'exact' | 'approximate' | 'unusable'
  syncEligible: boolean
  score: number // 0-100
  failures: string[]
  warnings: string[]
  metrics: {
    monotonicPass: boolean
    durationPass: boolean
    coverageRatio: number
    tailSpillSec: number
    medianWordsPerSecond: number
    p95WordsPerSecond: number
    uniformityScore: number
    gapOutlierCount: number
  }
}
```

## Steps

### Step 1 — Normalize every lane into a common structure

- Convert every timed transcript candidate into `TimingValidationInput`.
- Keep the `lane` field lane-agnostic. The validator should not care whether the source is lane 1, lane 2, or any future lane.
- Use `sourceType` to preserve how timing was produced:
  - `caption`
  - `proxy_real_timing`
  - `proxy_estimated`
  - `asr_segment`
  - `asr_word`
  - `alignment`
- If a provider only has recovered text or synthetic timing, still normalize it, but do not promote it to sync-grade unless it passes the same gate and policy allows that source type.

### Step 2 — Apply automatic hard-fail rules

Hard fail means `status = 'unusable'`.

Use these as automatic demotions:

- Any segment has `endSec < startSec`.
- Segment starts are not monotonic.
- More than 1% of segments have zero or negative duration.
- Final transcript segment ends more than 20 seconds past real video duration.
- More than 5% of segments have impossible speaking rate, such as sustained `> 8 words/sec`.
- Timestamps are obviously synthetic and uniform across the file while line lengths vary heavily.
- Large blocks of transcript land inside silence or tail dead air.

### Step 3 — Apply soft-fail downgrade rules

Soft fail means `status = 'approximate'`.

Downgrade instead of rejecting when there is:

- Tail spill between 5 and 20 seconds.
- Moderate timing drift.
- Many segments that look regularized.
- Words-per-second distribution that is plausible overall but unstable.
- Sparse but not catastrophic alignment issues.

### Step 4 — Accept exact timing only when the full gate passes

Pass means `status = 'exact'`.

Only mark a transcript exact when all of these are true:

- Monotonic timestamps pass.
- Timing fits inside the media duration.
- Speaking-rate distribution is plausible.
- There is no strong synthetic-spacing pattern.
- Transcript progression tracks audio progression credibly.

### Step 5 — Set sync eligibility from validation status

- `exact` means `syncEligible = true`.
- `approximate` means `syncEligible = false`.
- `unusable` means `syncEligible = false`.

Approximate timing may still be useful for transcript recovery, text search, or verse detection from text, but not for synced transcript playback.

## Starting Thresholds

These are starting numbers, not eternal truth.

### Segment duration sanity

- Minimum allowed: `0.15 sec`.
- Preferred median: `1.0` to `6.0 sec`.
- Soft warning if many segments exceed `15 sec`.
- Hard fail if many segments exceed `30 sec`, unless the transcript is intentionally paragraph-level.

### Speaking-rate sanity

Per segment:

- Normal speech usually clusters around roughly `2` to `4 words/sec`.
- Warning above `5.5 words/sec`.
- Hard fail above `7.5` to `8 words/sec` for more than a tiny fraction of segments.

### Tail spill

- Exact pass: `<= 3 sec`.
- Approximate downgrade: `> 3 sec` and `<= 20 sec`.
- Unusable: `> 20 sec`.

### Uniformity detection

Flag suspicious timing when all of these are true:

- Coefficient of variation of inter-segment gaps is very low.
- Coefficient of variation of segment text length is much higher.
- The timing source says timestamps were estimated or inferred.

Plain-English rule:

If transcript line lengths vary a lot, but timestamps march forward in nearly perfect equal steps, that is fake precision.

## Whisper-Specific Acceptance Policy

Whisper should use a two-tier acceptance model.

### Tier 1 — Segment timestamp acceptance

If only segment timestamps are requested:

- Allow synced transcript output only if segment QA passes.

### Tier 2 — Word timestamp boosted confidence

If word timestamps are also requested:

- Compute additional checks:
  - word starts are monotonic
  - word coverage is consistent with segment coverage
  - segment boundaries align with word boundaries
- If both segment-level and word-level checks pass, increase confidence score.

Because word timestamps add latency, do not require them for every video. Segment timestamps should be the default lower-latency exact-timing candidate. Word timestamps are a confidence booster, not a universal requirement.

## Recommended Production Strategies

### Option A — Cost-aware default

1. Try the normal transcript lanes already in the pipeline.
2. If only text-only output exists, run Whisper with segment timestamps.
3. Validate the Whisper result.
4. If Whisper passes QA, publish synced transcript output.
5. Otherwise publish recovered transcript only.

### Option B — Premium-first

1. Try the primary transcript lanes already in the pipeline.
2. If no exact timing exists, run Whisper immediately.
3. Keep proxy for text recovery comparison or backup.
4. Choose the best exact-timed result after QA.

Recommended rollout:

- Start with Option A.
- Move to Option B only if the economics work.

## Logging and Evaluation Plan

Implementation order:

1. Add the validator module.
2. Make both proxy and Whisper feed into it.
3. Demote proxy-estimated timing immediately.
4. Start logging validation scores by lane.
5. Compare 25 to 50 real videos across:
   - sermons
   - podcasts
   - music-heavy intros
   - low-quality uploads
   - multiple speakers
6. Only after that decide whether Whisper can replace proxy as the default sync fallback.

## Naming Decision

Implement this as:

```ts
validateTranscriptTiming()
```

Do not implement it as:

```ts
checkWhisperAlignment()
```

This validator is a permanent gate for every current and future lane, not a Whisper-only exception path.

## Decision To Act On Now

Yes, add a custom process for transcript timing validation.

The immediate product decision is:

- keep proxy for text recovery
- stop treating proxy-estimated timing as sync-grade
- validate every exact-timing candidate through the same lane-agnostic gate
- allow only validated exact results to become synced transcript output
