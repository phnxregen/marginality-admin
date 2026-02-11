# Indexing Timeline: YouTube → Transcript (4 lanes) → Verse Detection → OCR → Outputs

This document defines the end-to-end indexing timeline for a single YouTube video:
- Transcript acquisition via 4 lanes
- Spoken verse detection + normalization
- OCR scanning (1 frame / 5 seconds) for on-screen references
- OCR candidate extraction + normalization
- Return/storing TWO outputs: transcript-occurrences JSON and ocr-occurrences JSON

## Phase 0 — Input + Run Initialization

1. Input: `youtubeUrl` (and optional `sourceVideoId`)
2. Extract `youtubeVideoId`
3. Create an `indexing_run` row (idempotent):
   - status = `processing`
   - store request context (user_id, timestamps, version hashes)
4. Fetch video metadata (title, duration, channelId, publishedAt).
5. Decide transcript lane plan (Lane 1 → Lane 2 → Lane 3 → Lane 4), and store chosen plan.

## Phase 1 — Transcript Acquisition (4 Lanes)

### Lane 1 — Official captions
- Attempt to fetch official captions.
- If found: normalize into `TranscriptSegment[]`.
- Set `transcript_source = lane1_official`.
- Continue to Phase 2.

### Lane 2 — Proxy transcript
- Attempt transcript acquisition via proxy provider.
- If found: normalize into `TranscriptSegment[]`.
- Set `transcript_source = lane2_proxy`.
- Continue to Phase 2.

### Lane 3 — Whisper ASR (audio)
- Acquire audio URL (if supported), respecting size/time constraints.
- Run ASR.
- Normalize into `TranscriptSegment[]`.
- Set `transcript_source = lane3_whisper`.
- Continue to Phase 2.

### Lane 4 — Final fallback
- If Lane 3 fails:
  - attempt partial transcript strategy (optional) OR fail.
- Set `transcript_source = lane4_fallback` or `none`.
- If `none`, mark run failed with a transcript lane error.

Output of Phase 1:
- `TranscriptSegment[] transcript_segments`
- `transcript_source`
- debug fields (lane errors, provider details)

## Phase 2 — Spoken Verse Detection + Normalization (Gemini)

Goal: detect spoken (and broad) Bible references from transcript segments and return normalized occurrences.

1. Chunk transcript segments into windows (time-based or token-based):
   - recommended: 5–10 minute windows
   - include 10–20 seconds overlap between chunks
2. For each chunk:
   - call Gemini verse detection formatter (Transcript prompt)
   - input: chunk segments + carry-forward context state
   - output: `Occurrence[]` + updated context state
3. Merge chunk outputs deterministically:
   - concatenate
   - sort by `start`
   - dedupe only if SAME reference appears in SAME second (per rules)
   - preserve repeated occurrences otherwise

Output of Phase 2:
- `TranscriptOccurrencesJson` (video_url + occurrences[])

## Phase 3 — OCR Scanning (1 frame per 5 seconds)

Goal: extract on-screen Bible references.

1. Sample frames at 1 per 5 seconds across video duration.
2. Run OCR on each frame.
3. Produce `OcrRawSegment[]` with timestamp + extracted text.
4. Collapse adjacent duplicates:
   - if the same OCR text repeats across adjacent frames, consolidate into a range:
     - start = first frame time
     - end = last frame time + 5 seconds

Output of Phase 3:
- `OcrRawSegment[] ocr_raw_segments` (consolidated)

## Phase 4 — OCR Candidate Extraction (Deterministic)

1. Run regex-based candidate detection on `ocr_raw_segments.text` using canonical book list and patterns.
2. Produce `OcrCandidate[]`:
   - raw_reference (matched string)
   - start/end range from the consolidated OCR segment
   - optional: source_text (full OCR line for debugging)

Output of Phase 4:
- `OcrCandidate[] ocr_candidates`

## Phase 5 — OCR Candidate Normalization (Gemini or Deterministic Parser)

Goal: turn OCR candidates into the same `Occurrence` schema.

1. For each candidate (or batched):
   - normalize to `anchor_verse_id` + `reference_string`
   - expand ranges to `verses[]`
   - classification = `onscreen`
   - display_text = "found in video"
   - transcript_is_spoken = false
2. Validate verse IDs and drop obvious OCR noise (optional).

Output of Phase 5:
- `OcrOccurrencesJson` (video_url + occurrences[])

## Phase 6 — Return / Storage

Return/store TWO JSON outputs:
1) Transcript occurrences JSON
2) OCR occurrences JSON

Optional later: unified merge into `both` classification (deterministic):
- if same reference overlaps in time (±2s), mark as `both`
- else keep separate occurrences

This merge is not required for initial pipeline output.
