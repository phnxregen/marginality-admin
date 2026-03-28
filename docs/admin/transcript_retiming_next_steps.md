# Transcript Retiming Next Steps

Last updated: 2026-03-26

## Status

Transcript retiming is now a future timing-upgrade path, not the core V2 success path.

Current V2 success path:

```text
Transcript -> Verse Detection -> Ordered Occurrences
```

Future enhancement path:

```text
Validated Audio Artifact -> Alignment / Retiming -> Timing Upgrade
```

## What Retiming Is For Now

Retiming can improve:

- reviewer orientation
- snippet locality
- future playback UX
- future alignment readiness

Retiming does not currently define V2 success.

## Current Rules

- do not block V2 success on retiming
- do not block V2 success on audio acquisition
- do not present retimed or approximate timing as alignment-grade unless it truly is
- do not redefine occurrence identity or order when timing improves later

## Recommended Future Work

When core V2 is stable, the next timing-upgrade work should be:

1. validate audio availability for a run
2. produce improved transcript timing
3. store upgraded timing metadata
4. preserve the same `occurrence_id` and `occurrence_index` when possible
5. re-review whether timestamps can be promoted in UI trust

## App-Repo Coordination Rule

If future retiming work needs context from the app repo, stop and gather that exact context first.
Do not assume the app repo already matches the admin contract.
