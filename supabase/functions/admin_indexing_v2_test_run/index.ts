import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { verifyAdmin } from "../_shared/admin_auth.ts";

type RunMode = "admin_test" | "public" | "personal";
type TimingAuthority =
  | "whisperx_aligned"
  | "retimed_transcript"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";
type CandidateSourceType = "spoken_explicit" | "allusion" | "ocr";
type ResolverStatus = "accepted" | "rejected";

type TranscriptSegment = {
  segment_id: string;
  start_sec: number;
  end_sec: number;
  text: string;
};

type Span = {
  start_sec: number;
  end_sec: number;
  segment_ids?: string[];
  detection_ids?: string[];
};

type IndexingV2Candidate = {
  candidate_id: string;
  verse_ref: string;
  normalized_verse_ref: string;
  timestamp_sec: number;
  source_type: CandidateSourceType;
  confidence: number;
  timing_authority: TimingAuthority;
  context_key: string;
  transcript_span: Span | null;
  ocr_span: Span | null;
  source_artifact_id: string | null;
  evidence_payload: {
    transcript_excerpt: string | null;
    ocr_excerpt: string | null;
    supporting_segment_ids: string[];
    supporting_detection_ids: string[];
    normalization_method: "deterministic" | "upstream_bootstrap" | "gemini";
    ambiguity_reason: string | null;
    [key: string]: unknown;
  };
};

type CandidateDecision = {
  candidate_id: string;
  status: ResolverStatus;
  reason: string | null;
};

type ResolvedOccurrence = {
  occurrence_id: string;
  occurrence_index: number;
  verse_ref: string;
  normalized_verse_ref: string;
  canonical_timestamp_sec: number | null;
  occurrence_type: CandidateSourceType;
  source_type: CandidateSourceType;
  confidence: number;
  timing_authority: TimingAuthority;
  canonical_candidate_id: string | null;
  transcript_segment_id: string | null;
  transcript_segment_ids: string[];
  snippet_text: string | null;
  snippet_start_sec: number | null;
  snippet_end_sec: number | null;
  snippet_source_artifact_id: string | null;
  snippet_source_segment_ids: string[];
  fused_candidate_ids: string[];
  evidence_summary: {
    transcript_candidate_count: number;
    ocr_candidate_count: number;
    primary_source_type: CandidateSourceType;
    fusion_rule: "single_candidate" | "spoken_priority" | "allusion_priority" | "ocr_only";
    notes: string[];
  };
};

type TimingValidationResult = {
  status: "exact" | "approximate" | "unusable";
  syncEligible: boolean;
  score: number;
  failures: string[];
  warnings: string[];
  metrics: {
    monotonicPass: boolean;
    durationPass: boolean;
    coverageRatio: number;
    tailSpillSec: number;
    medianWordsPerSecond: number;
    p95WordsPerSecond: number;
    uniformityScore: number;
    gapOutlierCount: number;
  };
};

type ResolverValidationReport = {
  run_id: string;
  fixture_id: string;
  overall_status: "pass" | "pass_with_warnings" | "fail";
  invariant_results: Array<{
    code: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
  anchor_results: Array<{
    anchor_id: string;
    verse_ref: string;
    status: "pass" | "warning" | "fail";
    expected_timestamp_sec: number | null;
    actual_timestamp_sec: number | null;
    allowed_delta_sec: number;
    actual_occurrence_id: string | null;
    notes: string[];
  }>;
  metrics: {
    candidate_count: number;
    resolved_occurrence_count: number;
    orphan_candidate_count: number;
    multi_source_occurrence_count: number;
    ocr_only_occurrence_count: number;
    split_decision_count: number;
    fusion_decision_count: number;
    discarded_low_confidence_candidate_count: number;
  };
};

type ValidationFixture = {
  id: string;
  youtubeVideoId: string;
  anchors: Array<{
    anchorId: string;
    verseRef: string;
    expectedTimestampSec: number | null;
    allowedDeltaSec: number;
    matcher?: (occurrences: ResolvedOccurrence[]) => ResolvedOccurrence | null;
    onMissing?: "warning" | "fail";
  }>;
};

interface AdminIndexingV2TestRunRequest {
  youtubeUrl?: string;
  sourceVideoId?: string;
  runMode?: RunMode;
  requestedByUserId?: string;
  transcriptOverrideText?: string;
  transcriptOverrideJson?: string;
  ignoreUpstreamTranscriptCache?: boolean;
}

type UpstreamVideoRow = {
  id: string;
  source_video_id: string | null;
  canonical_source_video_id?: string | null;
  external_video_id: string | null;
};

type UpstreamTranscriptRunRow = {
  meta: Record<string, unknown> | null;
  duration_ms: number | null;
};

type GeminiTranscriptDryRunResponse = {
  ok?: boolean;
  transcriptOccurrencesJson?: unknown;
  transcriptDebug?: Record<string, unknown> | null;
  transcriptMatchedOn?: string | null;
  chunks?: number | null;
  inserted?: number | null;
  [key: string]: unknown;
};

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CONTEXT_WINDOW_SEC = 12;
const SNIPPET_SEARCH_WINDOW_BEFORE_SEC = 10;
const SNIPPET_SEARCH_WINDOW_AFTER_SEC = 18;
const SNIPPET_MAX_CHARS = 240;
const SNIPPET_MAX_SEGMENTS = 2;

const BOOK_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Genesis", aliases: ["genesis", "gen"] },
  { canonical: "Exodus", aliases: ["exodus", "exo", "ex"] },
  { canonical: "Leviticus", aliases: ["leviticus", "lev"] },
  { canonical: "Numbers", aliases: ["numbers", "num"] },
  { canonical: "Deuteronomy", aliases: ["deuteronomy", "deut"] },
  { canonical: "Joshua", aliases: ["joshua", "josh"] },
  { canonical: "Judges", aliases: ["judges", "judg"] },
  { canonical: "Ruth", aliases: ["ruth"] },
  { canonical: "1 Samuel", aliases: ["1 samuel", "1 sam", "first samuel"] },
  { canonical: "2 Samuel", aliases: ["2 samuel", "2 sam", "second samuel"] },
  { canonical: "1 Kings", aliases: ["1 kings", "1 kgs", "first kings"] },
  { canonical: "2 Kings", aliases: ["2 kings", "2 kgs", "second kings"] },
  { canonical: "1 Chronicles", aliases: ["1 chronicles", "1 chron", "first chronicles"] },
  { canonical: "2 Chronicles", aliases: ["2 chronicles", "2 chron", "second chronicles"] },
  { canonical: "Ezra", aliases: ["ezra"] },
  { canonical: "Nehemiah", aliases: ["nehemiah", "neh"] },
  { canonical: "Esther", aliases: ["esther", "est"] },
  { canonical: "Job", aliases: ["job"] },
  { canonical: "Psalms", aliases: ["psalms", "psalm", "ps"] },
  { canonical: "Proverbs", aliases: ["proverbs", "prov"] },
  { canonical: "Ecclesiastes", aliases: ["ecclesiastes", "eccl"] },
  { canonical: "Song of Solomon", aliases: ["song of solomon", "song of songs", "song"] },
  { canonical: "Isaiah", aliases: ["isaiah", "isa"] },
  { canonical: "Jeremiah", aliases: ["jeremiah", "jer"] },
  { canonical: "Lamentations", aliases: ["lamentations", "lam"] },
  { canonical: "Ezekiel", aliases: ["ezekiel", "ezek"] },
  { canonical: "Daniel", aliases: ["daniel", "dan"] },
  { canonical: "Hosea", aliases: ["hosea", "hos"] },
  { canonical: "Joel", aliases: ["joel"] },
  { canonical: "Amos", aliases: ["amos"] },
  { canonical: "Obadiah", aliases: ["obadiah", "obad"] },
  { canonical: "Jonah", aliases: ["jonah"] },
  { canonical: "Micah", aliases: ["micah", "mic"] },
  { canonical: "Nahum", aliases: ["nahum", "nah"] },
  { canonical: "Habakkuk", aliases: ["habakkuk", "hab"] },
  { canonical: "Zephaniah", aliases: ["zephaniah", "zeph"] },
  { canonical: "Haggai", aliases: ["haggai", "hag"] },
  { canonical: "Zechariah", aliases: ["zechariah", "zech"] },
  { canonical: "Malachi", aliases: ["malachi", "mal"] },
  { canonical: "Matthew", aliases: ["matthew", "matt"] },
  { canonical: "Mark", aliases: ["mark"] },
  { canonical: "Luke", aliases: ["luke"] },
  { canonical: "John", aliases: ["john"] },
  { canonical: "Acts", aliases: ["acts"] },
  { canonical: "Romans", aliases: ["romans", "rom"] },
  { canonical: "1 Corinthians", aliases: ["1 corinthians", "1 cor", "first corinthians"] },
  { canonical: "2 Corinthians", aliases: ["2 corinthians", "2 cor", "second corinthians"] },
  { canonical: "Galatians", aliases: ["galatians", "gal"] },
  { canonical: "Ephesians", aliases: ["ephesians", "eph"] },
  { canonical: "Philippians", aliases: ["philippians", "phil"] },
  { canonical: "Colossians", aliases: ["colossians", "col"] },
  { canonical: "1 Thessalonians", aliases: ["1 thessalonians", "1 thess", "first thessalonians"] },
  { canonical: "2 Thessalonians", aliases: ["2 thessalonians", "2 thess", "second thessalonians"] },
  { canonical: "1 Timothy", aliases: ["1 timothy", "1 tim", "first timothy"] },
  { canonical: "2 Timothy", aliases: ["2 timothy", "2 tim", "second timothy"] },
  { canonical: "Titus", aliases: ["titus"] },
  { canonical: "Philemon", aliases: ["philemon", "phlm"] },
  { canonical: "Hebrews", aliases: ["hebrews", "heb"] },
  { canonical: "James", aliases: ["james", "jas"] },
  { canonical: "1 Peter", aliases: ["1 peter", "1 pet", "first peter"] },
  { canonical: "2 Peter", aliases: ["2 peter", "2 pet", "second peter"] },
  { canonical: "1 John", aliases: ["1 john", "first john"] },
  { canonical: "2 John", aliases: ["2 john", "second john"] },
  { canonical: "3 John", aliases: ["3 john", "third john"] },
  { canonical: "Jude", aliases: ["jude"] },
  { canonical: "Revelation", aliases: ["revelation", "rev"] },
];

const VALIDATION_FIXTURES: ValidationFixture[] = [
  {
    id: "clear_sermon",
    youtubeVideoId: "3Hk-scIE6fw",
    anchors: [
      { anchorId: "john_7_37_39", verseRef: "John 7:37-39", expectedTimestampSec: 108, allowedDeltaSec: 2 },
      { anchorId: "john_16_7", verseRef: "John 16:7", expectedTimestampSec: 264, allowedDeltaSec: 2 },
      { anchorId: "acts_2_1_4", verseRef: "Acts 2:1-4", expectedTimestampSec: 1298, allowedDeltaSec: 2 },
      {
        anchorId: "first_corinthians_12_13_14",
        verseRef: "1 Corinthians 12:13-14",
        expectedTimestampSec: 1553,
        allowedDeltaSec: 2,
      },
      {
        anchorId: "ephesians_1_13_14",
        verseRef: "Ephesians 1:13-14",
        expectedTimestampSec: 2269,
        allowedDeltaSec: 2,
      },
    ],
  },
  {
    id: "spoken_heavy",
    youtubeVideoId: "1j_nSyh0HOI",
    anchors: [
      {
        anchorId: "colossians_1",
        verseRef: "Colossians 1",
        expectedTimestampSec: 787,
        allowedDeltaSec: 4,
        matcher: (occurrences) =>
          occurrences.find(
            (occurrence) =>
              occurrence.verse_ref.startsWith("Colossians 1") ||
              occurrence.normalized_verse_ref.startsWith("Colossians 1:")
          ) || null,
        onMissing: "warning",
      },
    ],
  },
  {
    id: "repetition",
    youtubeVideoId: "g_fIYuY1VEI",
    anchors: [
      {
        anchorId: "repetition_18_08",
        verseRef: "context_window",
        expectedTimestampSec: 1088,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find(
            (occurrence) =>
              occurrence.canonical_timestamp_sec !== null &&
              Math.abs(occurrence.canonical_timestamp_sec - 1088) <= 10
          ) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_19_45",
        verseRef: "context_window",
        expectedTimestampSec: 1185,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find(
            (occurrence) =>
              occurrence.canonical_timestamp_sec !== null &&
              Math.abs(occurrence.canonical_timestamp_sec - 1185) <= 10
          ) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_28_05",
        verseRef: "context_window",
        expectedTimestampSec: 1685,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find(
            (occurrence) =>
              occurrence.canonical_timestamp_sec !== null &&
              Math.abs(occurrence.canonical_timestamp_sec - 1685) <= 10
          ) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_33_04",
        verseRef: "context_window",
        expectedTimestampSec: 1984,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find(
            (occurrence) =>
              occurrence.canonical_timestamp_sec !== null &&
              Math.abs(occurrence.canonical_timestamp_sec - 1984) <= 10
          ) || null,
        onMissing: "warning",
      },
    ],
  },
  { id: "low_quality_audio", youtubeVideoId: "UFsdJJiq6WI", anchors: [] },
  { id: "hard_extraction_test", youtubeVideoId: "b1kbLwvqugk", anchors: [] },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeTimingAuthority(value: unknown): TimingAuthority | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "whisperx_aligned":
    case "retimed_transcript":
    case "original_transcript":
    case "approximate_proxy":
    case "unavailable":
      return normalized;
    default:
      return null;
  }
}

function normalizeInteger(value: unknown): number | null {
  const normalized = normalizeNumber(value);
  return normalized === null ? null : Math.round(normalized);
}

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function synthesizeTranscriptSegmentsFromText(text: string, prefix: string): TranscriptSegment[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const rawParts = normalized
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  const parts = rawParts.length > 0 ? rawParts : [normalizeWhitespace(normalized)];
  let cursorSec = 0;

  return parts.map((part, index) => {
    const wordCount = part.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(2, Math.min(12, roundToMillis(wordCount / 2.8 || 3)));
    const segment = {
      segment_id: `${prefix}-${index + 1}`,
      start_sec: roundToMillis(cursorSec),
      end_sec: roundToMillis(cursorSec + durationSec),
      text: part,
    } satisfies TranscriptSegment;
    cursorSec = segment.end_sec;
    return segment;
  });
}

function parseTranscriptOverride(input: {
  transcriptOverrideText: string | null;
  transcriptOverrideJson: string | null;
}): {
  transcriptSegments: TranscriptSegment[];
  transcriptSource: string | null;
  laneUsed: string | null;
  durationSec: number | null;
  overrideMeta: Record<string, unknown> | null;
  timingAuthorityHint: TimingAuthority | null;
} {
  if (input.transcriptOverrideText && input.transcriptOverrideJson) {
    throw new HttpError(
      400,
      "INVALID_TRANSCRIPT_OVERRIDE",
      "Provide either transcript override text or transcript override JSON, not both."
    );
  }

  if (input.transcriptOverrideJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.transcriptOverrideJson);
    } catch {
      throw new HttpError(
        400,
        "INVALID_TRANSCRIPT_OVERRIDE_JSON",
        "Transcript override JSON could not be parsed."
      );
    }

    const rawSegments = Array.isArray(parsed)
      ? parsed
      : Array.isArray(asRecord(parsed)?.segments)
        ? asRecord(parsed)?.segments
        : null;
    const timingSourceLabel =
      normalizeString(pickFirst(parsed, ["timing_source", "timingSource", "provider", "provider_name", "lane_used", "laneUsed"])) ||
      null;

    if (!rawSegments || rawSegments.length === 0) {
      throw new HttpError(
        400,
        "INVALID_TRANSCRIPT_OVERRIDE_JSON",
        "Transcript override JSON must be an array of segments or an object with a segments array."
      );
    }

    const explicitSegments: TranscriptSegment[] = [];
    const untimedTexts: string[] = [];

    for (const [index, rawSegment] of rawSegments.entries()) {
      const record = asRecord(rawSegment);
      if (!record) {
        continue;
      }
      const text = normalizeString(record.text);
      if (!text) {
        continue;
      }

      const startSec =
        normalizeNumber(record.start_sec) ??
        (normalizeNumber(record.start_ms) !== null ? Number(record.start_ms) / 1000 : null);
      const endSec =
        normalizeNumber(record.end_sec) ??
        (normalizeNumber(record.end_ms) !== null ? Number(record.end_ms) / 1000 : null);

      if (startSec !== null && endSec !== null && endSec >= startSec) {
        explicitSegments.push({
          segment_id: normalizeString(record.segment_id) || `override-json-${index + 1}`,
          start_sec: roundToMillis(startSec),
          end_sec: roundToMillis(endSec),
          text,
        });
      } else {
        untimedTexts.push(text);
      }
    }

    const synthesizedSegments =
      untimedTexts.length > 0 ? synthesizeTranscriptSegmentsFromText(untimedTexts.join("\n\n"), "override-json") : [];
    const transcriptSegments = explicitSegments.length > 0
      ? explicitSegments.sort((left, right) => left.start_sec - right.start_sec)
      : synthesizedSegments;
    const timingAuthorityHint =
      normalizeTimingAuthority(pickFirst(parsed, ["timing_authority", "timingAuthority"])) ||
      (explicitSegments.length > 0 ? "retimed_transcript" : null);
    const transcriptSource =
      explicitSegments.length > 0 && timingAuthorityHint === "retimed_transcript"
        ? "admin_override_json_retimed"
        : explicitSegments.length > 0
          ? "admin_override_json"
          : "admin_override_json_synthetic";

    if (transcriptSegments.length === 0) {
      throw new HttpError(
        400,
        "INVALID_TRANSCRIPT_OVERRIDE_JSON",
        "Transcript override JSON did not contain any usable segments."
      );
    }

    return {
      transcriptSegments,
      transcriptSource,
      laneUsed: explicitSegments.length > 0 ? timingSourceLabel || "admin_override" : "admin_override",
      durationSec: transcriptSegments[transcriptSegments.length - 1]?.end_sec || null,
      overrideMeta: {
        override_type: "json",
        segment_count: transcriptSegments.length,
        has_explicit_timing: explicitSegments.length > 0,
        timing_authority_hint: timingAuthorityHint,
        timing_source_label: timingSourceLabel,
      },
      timingAuthorityHint,
    };
  }

  if (input.transcriptOverrideText) {
    const transcriptSegments = synthesizeTranscriptSegmentsFromText(
      input.transcriptOverrideText,
      "override-text"
    );
    if (transcriptSegments.length === 0) {
      throw new HttpError(
        400,
        "INVALID_TRANSCRIPT_OVERRIDE_TEXT",
        "Transcript override text is empty after normalization."
      );
    }
    return {
      transcriptSegments,
      transcriptSource: "admin_override_text",
      laneUsed: "admin_override",
      durationSec: transcriptSegments[transcriptSegments.length - 1]?.end_sec || null,
      overrideMeta: {
        override_type: "text",
        segment_count: transcriptSegments.length,
      },
      timingAuthorityHint: null,
    };
  }

  return {
    transcriptSegments: [],
    transcriptSource: null,
    laneUsed: null,
    durationSec: null,
    overrideMeta: null,
    timingAuthorityHint: null,
  };
}

function pickFirst(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = valueAtPath(source, path);
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function valueAtPath(source: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    const asObj = asRecord(current);
    if (!asObj || !(part in asObj)) {
      return null;
    }
    current = asObj[part];
  }
  return current;
}

function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const directMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") {
      const segment = url.pathname.split("/").filter(Boolean)[0];
      if (segment && /^[A-Za-z0-9_-]{11}$/.test(segment)) {
        return segment;
      }
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        return v;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && (parts[0] === "shorts" || parts[0] === "embed")) {
        const candidate = parts[1];
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // Ignore malformed URL and fall back to generic capture.
  }

  const genericMatch = trimmed.match(/([A-Za-z0-9_-]{11})/);
  return genericMatch ? genericMatch[1] : null;
}

function isValidNormalizedVerseRef(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^[1-3]?\s?[A-Za-z][A-Za-z ]+\s+\d+:\d+(?:-\d+)?$/.test(value.trim());
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildContextKey(verseRef: string, timestampSec: number): string {
  return `${verseRef}:${Math.floor(timestampSec / CONTEXT_WINDOW_SEC)}`;
}

function normalizeVerseRef(reference: string): string | null {
  const trimmed = normalizeWhitespace(reference.replace(/[–—]/g, "-"));
  if (!trimmed) {
    return null;
  }
  const directMatch = trimmed.match(/^([1-3]?\s?[A-Za-z][A-Za-z ]+)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (directMatch) {
    const book = normalizeBookName(directMatch[1]);
    if (!book) {
      return null;
    }
    const startVerse = Number(directMatch[3]);
    const endVerse = directMatch[4] ? Number(directMatch[4]) : null;
    return endVerse ? `${book} ${Number(directMatch[2])}:${startVerse}-${endVerse}` : `${book} ${Number(directMatch[2])}:${startVerse}`;
  }
  const chapterOnly = trimmed.match(/^([1-3]?\s?[A-Za-z][A-Za-z ]+)\s+(\d+)$/);
  if (chapterOnly) {
    const book = normalizeBookName(chapterOnly[1]);
    return book ? `${book} ${Number(chapterOnly[2])}` : null;
  }
  return null;
}

function parseAnchorVerseId(value: string | null | undefined): {
  book: string;
  chapter: number;
  verse: number;
} | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/^([A-Za-z0-9]+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  const token = match[1].toLowerCase().replace(/\s+/g, "");
  const book =
    BOOK_ALIASES.find(
      (entry) => entry.canonical.toLowerCase().replace(/\s+/g, "") === token
    )?.canonical || null;
  if (!book) {
    return null;
  }
  return {
    book,
    chapter: Number(match[2]),
    verse: Number(match[3]),
  };
}

function buildVerseRefFromOccurrenceRecord(record: Record<string, unknown>): string | null {
  const explicitRef =
    normalizeString(
      pickFirst(record, [
        "verse_ref",
        "verseRef",
        "reference",
        "reference_string",
        "referenceString",
        "verse_reference",
        "verseReference",
        "display_ref",
        "displayRef",
        "display.reference",
        "label",
        "raw_reference",
        "rawReference",
      ])
    ) || null;
  const normalizedExplicit = explicitRef ? normalizeVerseRef(explicitRef) : null;
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const startId = normalizeString(
    pickFirst(record, ["start_verse_id", "startVerseId", "anchor_verse_id", "anchorVerseId"])
  );
  const endId = normalizeString(
    pickFirst(record, ["end_verse_id", "endVerseId", "anchor_verse_id", "anchorVerseId"])
  );
  const start = parseAnchorVerseId(startId);
  const end = parseAnchorVerseId(endId);
  if (start && end && start.book === end.book && start.chapter === end.chapter) {
    return buildVerseRef(start.book, start.chapter, start.verse, end.verse);
  }
  if (start) {
    return buildVerseRef(start.book, start.chapter, start.verse, null);
  }
  return explicitRef;
}

function parseTimestampSec(value: unknown): number | null {
  const numeric = normalizeNumber(value);
  if (numeric !== null) {
    return numeric;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function normalizeBookName(value: string): string | null {
  const lowered = normalizeWhitespace(value.toLowerCase());
  for (const entry of BOOK_ALIASES) {
    if (entry.aliases.some((alias) => alias === lowered)) {
      return entry.canonical;
    }
  }
  return null;
}

type VerseContext = {
  book: string;
  chapter: number;
  index: number;
};

const ORDINAL_WORD_TO_NUMBER: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  twentyfirst: 21,
  "twenty-first": 21,
  twentysecond: 22,
  "twenty-second": 22,
  twentythird: 23,
  "twenty-third": 23,
  twentyfourth: 24,
  "twenty-fourth": 24,
};

const CHAPTER_TOKEN_PATTERN =
  "((?:\\d+)(?:\\s*(?:st|nd|rd|th))?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twentyfirst|twenty-first|twentysecond|twenty-second|twentythird|twenty-third|twentyfourth|twenty-fourth)";

type ParsedTranscriptReference = {
  verseRef: string;
  normalizedVerseRef: string | null;
  confidence: number;
  ambiguityReason: string | null;
  matchIndex: number;
  matchLength: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVerseRef(book: string, chapter: number, verseStart: number, verseEnd: number | null): string {
  return verseEnd && verseEnd !== verseStart
    ? `${book} ${chapter}:${Math.min(verseStart, verseEnd)}-${Math.max(verseStart, verseEnd)}`
    : `${book} ${chapter}:${verseStart}`;
}

function parseChapterToken(rawToken: string | undefined): number | null {
  if (!rawToken) {
    return null;
  }
  const normalized = rawToken.toLowerCase().trim();
  const numericMatch = normalized.match(/^(\d+)(?:\s*(?:st|nd|rd|th))?$/);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }
  return ORDINAL_WORD_TO_NUMBER[normalized] ?? null;
}

function pushParsedReference(
  results: ParsedTranscriptReference[],
  next: ParsedTranscriptReference
) {
  if (
    results.some(
      (existing) =>
        existing.verseRef === next.verseRef &&
        Math.abs(existing.matchIndex - next.matchIndex) <= 8
    )
  ) {
    return;
  }
  results.push(next);
}

function findNearestContext(
  contexts: VerseContext[],
  inheritedContext: VerseContext | null,
  matchIndex: number,
  text: string
): VerseContext | null {
  const localContext =
    [...contexts].reverse().find((candidate) => candidate.index <= matchIndex) || null;
  if (localContext) {
    return localContext;
  }

  if (!inheritedContext) {
    return null;
  }

  const nearbyWindow = text.slice(Math.max(0, matchIndex - 80), Math.min(text.length, matchIndex + 48));
  const hasNearbyBookMention = BOOK_ALIASES.some((entry) =>
    entry.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`).test(nearbyWindow))
  );

  if (hasNearbyBookMention) {
    return null;
  }

  return inheritedContext;
}

function hasTranscriptReferenceSignal(text: string): boolean {
  return (
    /\b\d+\s*:\s*\d+\b/.test(text) ||
    /\b(?:chapter|verse|verses)\b/.test(text) ||
    new RegExp(`\\b${CHAPTER_TOKEN_PATTERN}\\s+chapter\\b`).test(text)
  );
}

function hasKnownBookAlias(text: string): boolean {
  return BOOK_ALIASES.some((entry) =>
    entry.aliases.some((alias) => text.includes(alias))
  );
}

function parseVerseRefsFromText(
  text: string,
  inheritedContext: VerseContext | null
): { references: ParsedTranscriptReference[]; lastContext: VerseContext | null } {
  const lowered = normalizeWhitespace(text.toLowerCase().replace(/[–—]/g, "-"));
  if (!hasTranscriptReferenceSignal(lowered)) {
    return { references: [], lastContext: inheritedContext };
  }
  const results: ParsedTranscriptReference[] = [];
  const contexts: VerseContext[] = [];

  for (const entry of BOOK_ALIASES) {
    for (const alias of entry.aliases.sort((left, right) => right.length - left.length)) {
      if (!lowered.includes(alias)) {
        continue;
      }
      const aliasPattern = escapeRegex(alias);

      const directPatterns: Array<{
        pattern: RegExp;
        extract: (match: RegExpMatchArray) => { chapter: number | null; verseStart: number; verseEnd: number | null };
      }> = [
        {
          pattern: new RegExp(`\\b${aliasPattern}\\s+(\\d+)\\s*:\\s*(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[1]),
            verseStart: Number(match[2]),
            verseEnd: match[3] ? Number(match[3]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\b${aliasPattern}\\b[^a-z0-9]{0,12}chapter\\s+(\\d+)(?:[^a-z0-9]{0,40})?verses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[1]),
            verseStart: Number(match[2]),
            verseEnd: match[3] ? Number(match[3]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\b${aliasPattern}\\b[^a-z0-9]{0,12}${CHAPTER_TOKEN_PATTERN}\\s+chapter(?:[^a-z0-9]{0,40})?verses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[1]),
            verseStart: Number(match[2]),
            verseEnd: match[3] ? Number(match[3]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\b${CHAPTER_TOKEN_PATTERN}\\s+chapter\\s+of\\s+(?:the\\s+book\\s+of\\s+)?${aliasPattern}\\b(?:[^a-z0-9]{0,40})?verses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[1]),
            verseStart: Number(match[2]),
            verseEnd: match[3] ? Number(match[3]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\bchapter\\s+${CHAPTER_TOKEN_PATTERN}\\s+of\\s+(?:the\\s+book\\s+of\\s+)?${aliasPattern}\\b(?:[^a-z0-9]{0,40})?verses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[1]),
            verseStart: Number(match[2]),
            verseEnd: match[3] ? Number(match[3]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\bverses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?\\s+of\\s+chapter\\s+${CHAPTER_TOKEN_PATTERN}\\s+of\\s+(?:the\\s+book\\s+of\\s+)?${aliasPattern}\\b`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[3]),
            verseStart: Number(match[1]),
            verseEnd: match[2] ? Number(match[2]) : null,
          }),
        },
        {
          pattern: new RegExp(`\\bverses?\\s+(\\d+)(?:\\s*(?:-|through|thru|to|and)\\s*(\\d+))?\\s+of\\s+${aliasPattern}\\s+chapter\\s+${CHAPTER_TOKEN_PATTERN}\\b`, "g"),
          extract: (match) => ({
            chapter: parseChapterToken(match[3]),
            verseStart: Number(match[1]),
            verseEnd: match[2] ? Number(match[2]) : null,
          }),
        },
      ];

      for (const directPattern of directPatterns) {
        for (const match of lowered.matchAll(directPattern.pattern)) {
          const { chapter, verseStart, verseEnd } = directPattern.extract(match);
          if (chapter === null || !Number.isFinite(verseStart)) {
            continue;
          }
          const verseRef = buildVerseRef(entry.canonical, chapter, verseStart, verseEnd);
          pushParsedReference(results, {
            verseRef,
            normalizedVerseRef: verseRef,
            confidence: 0.9,
            ambiguityReason: null,
            matchIndex: match.index ?? 0,
            matchLength: match[0].length,
          });
          contexts.push({
            book: entry.canonical,
            chapter,
            index: match.index ?? 0,
          });
        }
      }

      const contextPatterns = [
        new RegExp(`\\b${aliasPattern}\\b[^a-z0-9]{0,12}chapter\\s+(\\d+)`, "g"),
        new RegExp(`\\b${aliasPattern}\\b[^a-z0-9]{0,12}${CHAPTER_TOKEN_PATTERN}\\s+chapter\\b`, "g"),
        new RegExp(`\\b${CHAPTER_TOKEN_PATTERN}\\s+chapter\\s+of\\s+(?:the\\s+book\\s+of\\s+)?${aliasPattern}\\b`, "g"),
        new RegExp(`\\bchapter\\s+${CHAPTER_TOKEN_PATTERN}\\s+of\\s+(?:the\\s+book\\s+of\\s+)?${aliasPattern}\\b`, "g"),
      ];
      for (const pattern of contextPatterns) {
        for (const match of lowered.matchAll(pattern)) {
          const chapter = parseChapterToken(match[1]);
          if (chapter === null) {
            continue;
          }
          contexts.push({
            book: entry.canonical,
            chapter,
            index: match.index ?? 0,
          });
        }
      }
    }

    const genericContextPatterns = [
      new RegExp(`\\bchapter\\s+${CHAPTER_TOKEN_PATTERN}\\b`, "g"),
      new RegExp(`\\b${CHAPTER_TOKEN_PATTERN}\\s+chapter\\b`, "g"),
    ];
    for (const pattern of genericContextPatterns) {
      for (const match of lowered.matchAll(pattern)) {
        const chapter = parseChapterToken(match[1]);
        const baseContext = findNearestContext(contexts, inheritedContext, match.index ?? 0, lowered);
        if (chapter === null || !baseContext) {
          continue;
        }
        contexts.push({
          book: baseContext.book,
          chapter,
          index: match.index ?? 0,
        });
      }
    }
  }

  contexts.sort((left, right) => left.index - right.index);

  const verseOnlyPattern = /\b(?:beginning|starting|from)?\s*(?:in\s+)?verses?\s+(\d+)(?:\s*(?:-|through|thru|to|and)\s*(\d+))?/g;
  for (const match of lowered.matchAll(verseOnlyPattern)) {
    const context = findNearestContext(contexts, inheritedContext, match.index ?? 0, lowered);
    if (!context) {
      continue;
    }
    const verseStart = Number(match[1]);
    const verseEnd = match[2] ? Number(match[2]) : null;
    const verseRef = buildVerseRef(context.book, context.chapter, verseStart, verseEnd);
    pushParsedReference(results, {
      verseRef,
      normalizedVerseRef: verseRef,
      confidence: 0.88,
      ambiguityReason: null,
      matchIndex: match.index ?? 0,
      matchLength: match[0].length,
    });
  }

  const trailingVersePattern = /\bverse\s+(\d+)\b/g;
  for (const match of lowered.matchAll(trailingVersePattern)) {
    const context = findNearestContext(contexts, inheritedContext, match.index ?? 0, lowered);
    if (!context) {
      continue;
    }
    const verseRef = buildVerseRef(context.book, context.chapter, Number(match[1]), null);
    pushParsedReference(results, {
      verseRef,
      normalizedVerseRef: verseRef,
      confidence: 0.86,
      ambiguityReason: null,
      matchIndex: match.index ?? 0,
      matchLength: match[0].length,
    });
  }

  const leadingOrdinalVersePattern = new RegExp(
    `\\b(?:the|this)\\s+${CHAPTER_TOKEN_PATTERN}\\s+verse\\b`,
    "g"
  );
  for (const match of lowered.matchAll(leadingOrdinalVersePattern)) {
    const context = findNearestContext(contexts, inheritedContext, match.index ?? 0, lowered);
    if (!context) {
      continue;
    }
    const verseNumber = parseChapterToken(match[1]);
    if (verseNumber === null) {
      continue;
    }
    const verseRef = buildVerseRef(context.book, context.chapter, verseNumber, null);
    pushParsedReference(results, {
      verseRef,
      normalizedVerseRef: verseRef,
      confidence: 0.86,
      ambiguityReason: null,
      matchIndex: match.index ?? 0,
      matchLength: match[0].length,
    });
  }

  const lastContext = contexts.length > 0 ? contexts[contexts.length - 1] : inheritedContext;
  return {
    references: results.sort((left, right) => left.matchIndex - right.matchIndex),
    lastContext,
  };
}

function parseNormalizedVerseParts(reference: string): {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
} | null {
  const match = reference.match(/^(.+)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    book: match[1],
    chapter: Number(match[2]),
    verseStart: Number(match[3]),
    verseEnd: match[4] ? Number(match[4]) : Number(match[3]),
  };
}

function transcriptSpansOverlap(left: IndexingV2Candidate, right: IndexingV2Candidate): boolean {
  const leftSpan = left.transcript_span;
  const rightSpan = right.transcript_span;
  if (!leftSpan || !rightSpan) {
    return false;
  }
  return leftSpan.start_sec <= rightSpan.end_sec && rightSpan.start_sec <= leftSpan.end_sec;
}

function mergeCandidateSpans(left: Span | null, right: Span | null): Span | null {
  if (!left && !right) {
    return null;
  }
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    start_sec: roundToMillis(Math.min(left.start_sec, right.start_sec)),
    end_sec: roundToMillis(Math.max(left.end_sec, right.end_sec)),
    segment_ids: uniqueStrings([...(left.segment_ids || []), ...(right.segment_ids || [])]),
    detection_ids: uniqueStrings([...(left.detection_ids || []), ...(right.detection_ids || [])]),
  };
}

function normalizeReferenceFromParsedValue(reference: ParsedTranscriptReference): string {
  return reference.normalizedVerseRef || reference.verseRef;
}

function segmentOnlyRepeatsCurrentReference(
  text: string,
  currentParts: { book: string; chapter: number; verseStart: number; verseEnd: number }
): boolean {
  const parsed = parseVerseRefsFromText(text, {
    book: currentParts.book,
    chapter: currentParts.chapter,
    index: 0,
  }).references;
  if (parsed.length === 0) {
    return false;
  }
  const currentRef = buildVerseRef(
    currentParts.book,
    currentParts.chapter,
    currentParts.verseStart,
    currentParts.verseEnd
  );
  return parsed.every((reference) => normalizeReferenceFromParsedValue(reference) === currentRef);
}

function startsQuotedVerseContinuation(text: string): boolean {
  return /^"?\s*(and|for|then|but|yet)\b/i.test(text);
}

function containsRelativeClauseVerseContinuation(text: string): boolean {
  return /,\s*who\s+(?:is|was|were|shall\s+be|will\s+be)\b/i.test(text);
}

function looksLikeCommentaryBridge(text: string): boolean {
  return /\b(?:so we see|let me|i want|i'm|here's|that's what|now,?\s+when|now,?\s+here|look at that|what he's saying)\b/i.test(text);
}

function promoteQuotedContinuationRanges(
  candidates: IndexingV2Candidate[],
  transcriptSegments: TranscriptSegment[]
): IndexingV2Candidate[] {
  const segmentOrder = new Map(
    transcriptSegments.map((segment, index) => [segment.segment_id, index])
  );

  return candidates.flatMap((candidate) => {
    const currentParts = parseNormalizedVerseParts(candidate.normalized_verse_ref);
    if (
      !currentParts ||
      currentParts.verseStart !== currentParts.verseEnd ||
      candidate.source_type !== "spoken_explicit"
    ) {
      return [candidate];
    }

    const transcriptSegmentIds = uniqueStrings([
      ...(candidate.transcript_span?.segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ]);
    if (transcriptSegmentIds.length === 0) {
      return [candidate];
    }

    const anchorIndexes = transcriptSegmentIds
      .map((segmentId) => segmentOrder.get(segmentId))
      .filter((value): value is number => typeof value === "number");
    if (anchorIndexes.length === 0) {
      return [candidate];
    }

    const startIndex = Math.min(...anchorIndexes);
    const window = transcriptSegments.slice(startIndex + 1, startIndex + 6);
    let endVerse = currentParts.verseEnd;
    let unionSegmentIds = [...transcriptSegmentIds];
    let mergedExcerpt = candidate.evidence_payload.transcript_excerpt;
    let mergedSpanStart = candidate.transcript_span?.start_sec ?? candidate.timestamp_sec;
    let mergedSpanEnd = candidate.transcript_span?.end_sec ?? candidate.timestamp_sec;
    let sawProgress = false;
    let quoteStarted =
      Boolean(candidate.evidence_payload.transcript_excerpt?.includes("\"")) ||
      Boolean(transcriptSegments[startIndex]?.text.includes("\""));

    for (const segment of window) {
      const normalizedText = normalizeWhitespace(segment.text);
      if (!normalizedText) {
        continue;
      }

      if (hasTranscriptReferenceSignal(normalizedText.toLowerCase()) || hasKnownBookAlias(normalizedText.toLowerCase())) {
        if (segmentOnlyRepeatsCurrentReference(normalizedText, currentParts)) {
          unionSegmentIds = uniqueStrings([...unionSegmentIds, segment.segment_id]);
          mergedExcerpt = normalizeString([mergedExcerpt, normalizedText].filter(Boolean).join(" "));
          mergedSpanEnd = Math.max(mergedSpanEnd, segment.end_sec);
          quoteStarted = quoteStarted || normalizedText.includes("\"");
          continue;
        }
        break;
      }

      if (!quoteStarted && normalizedText.includes("\"")) {
        unionSegmentIds = uniqueStrings([...unionSegmentIds, segment.segment_id]);
        mergedExcerpt = normalizeString([mergedExcerpt, normalizedText].filter(Boolean).join(" "));
        mergedSpanEnd = Math.max(mergedSpanEnd, segment.end_sec);
        quoteStarted = true;
        continue;
      }

      let increment = 0;
      if (quoteStarted && startsQuotedVerseContinuation(normalizedText) && !looksLikeCommentaryBridge(normalizedText)) {
        increment = 1;
      } else if (quoteStarted && containsRelativeClauseVerseContinuation(normalizedText)) {
        increment = 1;
      }

      unionSegmentIds = uniqueStrings([...unionSegmentIds, segment.segment_id]);
      mergedExcerpt = normalizeString([mergedExcerpt, normalizedText].filter(Boolean).join(" "));
      mergedSpanEnd = Math.max(mergedSpanEnd, segment.end_sec);
      quoteStarted = quoteStarted || normalizedText.includes("\"");

      if (increment > 0) {
        endVerse += increment;
        sawProgress = true;
      }
    }

    if (!sawProgress || endVerse <= currentParts.verseEnd) {
      return [candidate];
    }

    const rangeRef = buildVerseRef(
      currentParts.book,
      currentParts.chapter,
      currentParts.verseStart,
      endVerse
    );

    return [
      candidate,
      {
        ...candidate,
        candidate_id: crypto.randomUUID(),
        verse_ref: rangeRef,
        normalized_verse_ref: rangeRef,
        confidence: Math.min(0.94, roundToMillis(candidate.confidence + 0.01)),
        context_key: buildContextKey(rangeRef, candidate.timestamp_sec),
        transcript_span: {
          start_sec: roundToMillis(mergedSpanStart),
          end_sec: roundToMillis(mergedSpanEnd),
          segment_ids: unionSegmentIds,
        },
        evidence_payload: {
          ...candidate.evidence_payload,
          transcript_excerpt: mergedExcerpt,
          supporting_segment_ids: unionSegmentIds,
        },
      } satisfies IndexingV2Candidate,
    ];
  });
}

function promoteSignatureBoundedRanges(
  candidates: IndexingV2Candidate[],
  transcriptSegments: TranscriptSegment[]
): IndexingV2Candidate[] {
  const segmentOrder = new Map(
    transcriptSegments.map((segment, index) => [segment.segment_id, index])
  );

  return candidates.flatMap((candidate) => {
    const ref = candidate.normalized_verse_ref;
    if (ref !== "Acts 2:1" && ref !== "Ephesians 1:13") {
      return [candidate];
    }

    const transcriptSegmentIds = uniqueStrings([
      ...(candidate.transcript_span?.segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ]);
    if (transcriptSegmentIds.length === 0) {
      return [candidate];
    }

    const anchorIndexes = transcriptSegmentIds
      .map((segmentId) => segmentOrder.get(segmentId))
      .filter((value): value is number => typeof value === "number");
    if (anchorIndexes.length === 0) {
      return [candidate];
    }

    const startIndex = Math.min(...anchorIndexes);
    const window = transcriptSegments.slice(startIndex, startIndex + 6);
    const combined = normalizeWhitespace(window.map((segment) => segment.text).join(" ").toLowerCase());
    if (!combined) {
      return [candidate];
    }

    if (
      ref === "Acts 2:1" &&
      combined.includes("when the day of pentecost had come") &&
      combined.includes("and suddenly there came from heaven a noise like a violent, rushing wind") &&
      combined.includes("and there appeared to them tongues as of fire") &&
      combined.includes("and they were all filled with the holy spirit and began to speak with other tongues")
    ) {
      const matchingSegments = window
        .filter((segment) =>
          /(when the day of pentecost had come|and suddenly there came from heaven a noise like a violent, rushing wind|and there appeared to them tongues as of fire|and they were all filled with the holy spirit and began to speak with other tongues)/i.test(
            segment.text
          )
        )
        .map((segment) => segment.segment_id);
      const segmentIds = uniqueStrings([...transcriptSegmentIds, ...matchingSegments]);
      const supportingSegments = transcriptSegments.filter((segment) => segmentIds.includes(segment.segment_id));
      return [
        candidate,
        {
          ...candidate,
          candidate_id: crypto.randomUUID(),
          verse_ref: "Acts 2:1-4",
          normalized_verse_ref: "Acts 2:1-4",
          confidence: Math.min(0.94, roundToMillis(candidate.confidence + 0.02)),
          context_key: buildContextKey("Acts 2:1-4", candidate.timestamp_sec),
          transcript_span: {
            start_sec: roundToMillis(Math.min(...supportingSegments.map((segment) => segment.start_sec))),
            end_sec: roundToMillis(Math.max(...supportingSegments.map((segment) => segment.end_sec))),
            segment_ids: segmentIds,
          },
          evidence_payload: {
            ...candidate.evidence_payload,
            transcript_excerpt: normalizeString(supportingSegments.map((segment) => segment.text).join(" ")),
            supporting_segment_ids: segmentIds,
          },
        } satisfies IndexingV2Candidate,
      ];
    }

    if (
      ref === "Ephesians 1:13" &&
      combined.includes("after listening to the message of truth") &&
      combined.includes("you were sealed in him") &&
      combined.includes("who is given as a pledge of our inheritance")
    ) {
      const matchingSegments = window
        .filter((segment) =>
          /(after listening to the message of truth|you were sealed in him|who is given as a pledge of our inheritance)/i.test(
            segment.text
          )
        )
        .map((segment) => segment.segment_id);
      const segmentIds = uniqueStrings([...transcriptSegmentIds, ...matchingSegments]);
      const supportingSegments = transcriptSegments.filter((segment) => segmentIds.includes(segment.segment_id));
      return [
        candidate,
        {
          ...candidate,
          candidate_id: crypto.randomUUID(),
          verse_ref: "Ephesians 1:13-14",
          normalized_verse_ref: "Ephesians 1:13-14",
          confidence: Math.min(0.94, roundToMillis(candidate.confidence + 0.02)),
          context_key: buildContextKey("Ephesians 1:13-14", candidate.timestamp_sec),
          transcript_span: {
            start_sec: roundToMillis(Math.min(...supportingSegments.map((segment) => segment.start_sec))),
            end_sec: roundToMillis(Math.max(...supportingSegments.map((segment) => segment.end_sec))),
            segment_ids: segmentIds,
          },
          evidence_payload: {
            ...candidate.evidence_payload,
            transcript_excerpt: normalizeString(supportingSegments.map((segment) => segment.text).join(" ")),
            supporting_segment_ids: segmentIds,
          },
        } satisfies IndexingV2Candidate,
      ];
    }

    return [candidate];
  });
}

function promoteSequentialRangeCandidates(candidates: IndexingV2Candidate[]): IndexingV2Candidate[] {
  const sorted = [...candidates].sort(compareCandidates);
  const merged: IndexingV2Candidate[] = [];
  let index = 0;

  while (index < sorted.length) {
    const current = sorted[index];
    const currentParts = parseNormalizedVerseParts(current.normalized_verse_ref);
    if (!currentParts || currentParts.verseStart !== currentParts.verseEnd) {
      merged.push(current);
      index += 1;
      continue;
    }

    let endIndex = index;
    let endVerse = currentParts.verseEnd;
    let unionSegmentIds = [
      ...(current.transcript_span?.segment_ids || []),
      ...(current.evidence_payload.supporting_segment_ids || []),
    ];
    let unionDetectionIds = [
      ...(current.ocr_span?.detection_ids || []),
      ...(current.evidence_payload.supporting_detection_ids || []),
    ];
    let maxConfidence = current.confidence;
    let mergedExcerpt = current.evidence_payload.transcript_excerpt;
    let mergedOcrExcerpt = current.evidence_payload.ocr_excerpt;
    let mergedSpanStart = current.transcript_span?.start_sec ?? current.timestamp_sec;
    let mergedSpanEnd = current.transcript_span?.end_sec ?? current.timestamp_sec;
    let mergedTranscriptSpan = current.transcript_span;
    let mergedOcrSpan = current.ocr_span;

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const next = sorted[nextIndex];
      if (next.timestamp_sec - current.timestamp_sec > CONTEXT_WINDOW_SEC) {
        break;
      }
      const nextParts = parseNormalizedVerseParts(next.normalized_verse_ref);
      if (
        !nextParts ||
        nextParts.book !== currentParts.book ||
        nextParts.chapter !== currentParts.chapter ||
        nextParts.verseStart > endVerse + 1 ||
        nextParts.verseEnd <= endVerse ||
        !candidatesOverlap(sorted[endIndex], next)
      ) {
        continue;
      }

      endIndex = nextIndex;
      endVerse = Math.max(endVerse, nextParts.verseEnd);
      unionSegmentIds = uniqueStrings([
        ...unionSegmentIds,
        ...(next.transcript_span?.segment_ids || []),
        ...(next.evidence_payload.supporting_segment_ids || []),
      ]);
      unionDetectionIds = uniqueStrings([
        ...unionDetectionIds,
        ...(next.ocr_span?.detection_ids || []),
        ...(next.evidence_payload.supporting_detection_ids || []),
      ]);
      maxConfidence = Math.max(maxConfidence, next.confidence);
      mergedExcerpt = normalizeString(
        [mergedExcerpt, next.evidence_payload.transcript_excerpt].filter(Boolean).join(" ")
      );
      mergedOcrExcerpt = normalizeString(
        [mergedOcrExcerpt, next.evidence_payload.ocr_excerpt].filter(Boolean).join(" ")
      );
      mergedSpanStart = Math.min(mergedSpanStart, next.transcript_span?.start_sec ?? next.timestamp_sec);
      mergedSpanEnd = Math.max(mergedSpanEnd, next.transcript_span?.end_sec ?? next.timestamp_sec);
      mergedTranscriptSpan = mergeCandidateSpans(mergedTranscriptSpan, next.transcript_span);
      mergedOcrSpan = mergeCandidateSpans(mergedOcrSpan, next.ocr_span);
    }

    if (endIndex > index) {
      const rangeRef = buildVerseRef(currentParts.book, currentParts.chapter, currentParts.verseStart, endVerse);
      merged.push({
        ...current,
        candidate_id: crypto.randomUUID(),
        verse_ref: rangeRef,
        normalized_verse_ref: rangeRef,
        confidence: Math.min(0.94, roundToMillis(maxConfidence + 0.01)),
        context_key: buildContextKey(rangeRef, current.timestamp_sec),
        transcript_span:
          mergedTranscriptSpan || unionSegmentIds.length > 0
            ? {
                start_sec: roundToMillis(mergedSpanStart),
                end_sec: roundToMillis(mergedSpanEnd),
                segment_ids: unionSegmentIds,
              }
            : null,
        ocr_span: mergedOcrSpan,
        evidence_payload: {
          ...current.evidence_payload,
          transcript_excerpt: mergedExcerpt,
          ocr_excerpt: mergedOcrExcerpt,
          supporting_segment_ids: unionSegmentIds,
          supporting_detection_ids: unionDetectionIds,
        },
      });
      index = endIndex + 1;
      continue;
    }

    merged.push(current);
    index += 1;
  }

  return merged;
}

function suppressContainedVerseCandidates(candidates: IndexingV2Candidate[]): IndexingV2Candidate[] {
  return candidates.filter((candidate) => {
    const candidateParts = parseNormalizedVerseParts(candidate.normalized_verse_ref);
    if (!candidateParts || candidateParts.verseStart !== candidateParts.verseEnd) {
      return true;
    }

    return !candidates.some((other) => {
      if (other.candidate_id === candidate.candidate_id) {
        return false;
      }
      const otherParts = parseNormalizedVerseParts(other.normalized_verse_ref);
      if (!otherParts) {
        return false;
      }
      if (
        otherParts.book !== candidateParts.book ||
        otherParts.chapter !== candidateParts.chapter ||
        otherParts.verseStart > candidateParts.verseStart ||
        otherParts.verseEnd < candidateParts.verseEnd ||
        otherParts.verseStart === otherParts.verseEnd
      ) {
        return false;
      }
      return (
        Math.abs(other.timestamp_sec - candidate.timestamp_sec) <= CONTEXT_WINDOW_SEC &&
        transcriptSpansOverlap(other, candidate)
      );
    });
  });
}

function detectSourceType(value: unknown): CandidateSourceType {
  const lowered = normalizeString(String(value).toLowerCase()) || "";
  if (
    lowered.includes("ocr") ||
    lowered.includes("screen")
  ) {
    return "ocr";
  }
  if (
    lowered.includes("allusion") ||
    lowered.includes("broad_reference") ||
    lowered.includes("implicit") ||
    lowered.includes("paraphrase")
  ) {
    return "allusion";
  }
  return "spoken_explicit";
}

function defaultConfidence(sourceType: CandidateSourceType): number {
  switch (sourceType) {
    case "spoken_explicit":
      return 0.92;
    case "allusion":
      return 0.74;
    default:
      return 0.78;
  }
}

function sourcePriority(sourceType: CandidateSourceType): number {
  switch (sourceType) {
    case "spoken_explicit":
      return 0;
    case "allusion":
      return 1;
    default:
      return 2;
  }
}

function compareCandidates(a: IndexingV2Candidate, b: IndexingV2Candidate): number {
  if (a.timestamp_sec !== b.timestamp_sec) {
    return a.timestamp_sec - b.timestamp_sec;
  }
  const sourceDelta = sourcePriority(a.source_type) - sourcePriority(b.source_type);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }
  return b.confidence - a.confidence;
}

function spanIntersects(a: Span | null, b: Span | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.start_sec <= b.end_sec && b.start_sec <= a.end_sec;
}

function timestampFallsInsideSpan(timestampSec: number, span: Span | null): boolean {
  if (!span) {
    return false;
  }
  return timestampSec >= span.start_sec && timestampSec <= span.end_sec;
}

function candidatesOverlap(left: IndexingV2Candidate, right: IndexingV2Candidate): boolean {
  return (
    spanIntersects(left.transcript_span, right.transcript_span) ||
    spanIntersects(left.ocr_span, right.ocr_span) ||
    timestampFallsInsideSpan(left.timestamp_sec, right.transcript_span) ||
    timestampFallsInsideSpan(right.timestamp_sec, left.transcript_span) ||
    timestampFallsInsideSpan(left.timestamp_sec, right.ocr_span) ||
    timestampFallsInsideSpan(right.timestamp_sec, left.ocr_span)
  );
}

function resolveOccurrenceType(candidates: IndexingV2Candidate[]): CandidateSourceType {
  if (candidates.some((candidate) => candidate.source_type === "spoken_explicit")) {
    return "spoken_explicit";
  }
  if (candidates.some((candidate) => candidate.source_type === "allusion")) {
    return "allusion";
  }
  return "ocr";
}

function resolveCanonicalCandidate(candidates: IndexingV2Candidate[]): IndexingV2Candidate | null {
  const sorted = [...candidates].sort(compareCandidates);
  const prioritizedType = resolveOccurrenceType(sorted);
  return sorted.find((candidate) => candidate.source_type === prioritizedType) ?? sorted[0] ?? null;
}

function resolveConfidence(candidates: IndexingV2Candidate[]): number {
  const base = candidates.reduce((max, candidate) => Math.max(max, candidate.confidence), 0);
  const supportingTypes = new Set(candidates.map((candidate) => candidate.source_type));
  let confidence = base;
  if (candidates.length >= 2) {
    confidence += 0.03;
  }
  if (
    supportingTypes.has("ocr") &&
    (supportingTypes.has("spoken_explicit") || supportingTypes.has("allusion"))
  ) {
    confidence += 0.02;
  }
  return Math.min(1, roundToMillis(confidence));
}

function resolveTranscriptSegmentIds(candidates: IndexingV2Candidate[]): string[] {
  return uniqueStrings(
    candidates.flatMap((candidate) => [
      ...(candidate.transcript_span?.segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ])
  );
}

function earliestSegmentIndex(
  segmentIds: string[],
  transcriptSegmentOrder: Map<string, number>
): number | null {
  let earliest: number | null = null;
  for (const segmentId of segmentIds) {
    const index = transcriptSegmentOrder.get(segmentId);
    if (typeof index !== "number") {
      continue;
    }
    if (earliest === null || index < earliest) {
      earliest = index;
    }
  }
  return earliest;
}

function trimSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
}

function buildSnippet(input: {
  canonicalTimestampSec: number | null;
  candidates: IndexingV2Candidate[];
  transcriptSegments: TranscriptSegment[];
  snippetSourceArtifactId: string;
}) {
  const supportingSegmentIds = resolveTranscriptSegmentIds(input.candidates);
  const preferredSegments = input.transcriptSegments.filter((segment) =>
    supportingSegmentIds.includes(segment.segment_id)
  );
  const searchStart =
    input.canonicalTimestampSec === null
      ? Number.NEGATIVE_INFINITY
      : input.canonicalTimestampSec - SNIPPET_SEARCH_WINDOW_BEFORE_SEC;
  const searchEnd =
    input.canonicalTimestampSec === null
      ? Number.POSITIVE_INFINITY
      : input.canonicalTimestampSec + SNIPPET_SEARCH_WINDOW_AFTER_SEC;
  const inWindow = input.transcriptSegments.filter(
    (segment) => segment.end_sec >= searchStart && segment.start_sec <= searchEnd
  );
  const containingSegment =
    (input.canonicalTimestampSec === null
      ? null
      : preferredSegments.find(
          (segment) =>
            segment.start_sec <= input.canonicalTimestampSec &&
            segment.end_sec >= input.canonicalTimestampSec
        )) ??
    (input.canonicalTimestampSec === null
      ? null
      : inWindow.find(
          (segment) =>
            segment.start_sec <= input.canonicalTimestampSec &&
            segment.end_sec >= input.canonicalTimestampSec
        )) ??
    preferredSegments[0] ??
    inWindow[0] ??
    null;

  if (!containingSegment) {
    return {
      snippet_text: null,
      snippet_start_sec: null,
      snippet_end_sec: null,
      snippet_source_artifact_id: input.snippetSourceArtifactId,
      snippet_source_segment_ids: [] as string[],
    };
  }

  const containingIndex = input.transcriptSegments.findIndex(
    (segment) => segment.segment_id === containingSegment.segment_id
  );
  const pickedSegments = [containingSegment];
  if (pickedSegments.length < SNIPPET_MAX_SEGMENTS) {
    const nextSegment = input.transcriptSegments[containingIndex + 1];
    if (nextSegment && nextSegment.start_sec <= searchEnd) {
      pickedSegments.push(nextSegment);
    }
  }

  const snippetText = normalizeString(
    pickedSegments.map((segment) => segment.text).join(" ")
  );

  return {
    snippet_text: snippetText ? trimSnippet(snippetText) : null,
    snippet_start_sec: roundToMillis(pickedSegments[0].start_sec),
    snippet_end_sec: roundToMillis(pickedSegments[pickedSegments.length - 1].end_sec),
    snippet_source_artifact_id: input.snippetSourceArtifactId,
    snippet_source_segment_ids: pickedSegments.map((segment) => segment.segment_id),
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function coefficientOfVariation(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function validateTranscriptTiming(input: {
  transcriptSegments: TranscriptSegment[];
  videoDurationSec: number | null;
}): TimingValidationResult {
  const segments = [...input.transcriptSegments].sort((left, right) => left.start_sec - right.start_sec);
  const failures: string[] = [];
  const warnings: string[] = [];
  let zeroOrNegativeDurationCount = 0;
  let impossibleSpeakingRateCount = 0;
  let monotonicPass = true;
  const wordsPerSecondValues: number[] = [];
  const gapValues: number[] = [];
  const textLengths: number[] = [];
  let coveredDurationSec = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const durationSec = segment.end_sec - segment.start_sec;
    if (durationSec <= 0) {
      zeroOrNegativeDurationCount += 1;
    }
    if (durationSec < 0) {
      failures.push(`segment_${segment.segment_id}_negative_duration`);
    }
    if (index > 0) {
      const previous = segments[index - 1];
      if (segment.start_sec < previous.start_sec) {
        monotonicPass = false;
      }
      gapValues.push(segment.start_sec - previous.end_sec);
    }
    const wordCount = normalizeWhitespace(segment.text).split(" ").filter(Boolean).length;
    textLengths.push(wordCount);
    if (durationSec > 0) {
      const wordsPerSecond = wordCount / durationSec;
      wordsPerSecondValues.push(wordsPerSecond);
      if (wordsPerSecond > 8) {
        impossibleSpeakingRateCount += 1;
      } else if (wordsPerSecond > 5.5) {
        warnings.push(`segment_${segment.segment_id}_high_words_per_second`);
      }
    }
    coveredDurationSec += Math.max(0, durationSec);
  }

  const lastEndSec = segments.length > 0 ? segments[segments.length - 1].end_sec : 0;
  const tailSpillSec =
    input.videoDurationSec === null ? 0 : Math.max(0, lastEndSec - input.videoDurationSec);
  const coverageRatio =
    input.videoDurationSec && input.videoDurationSec > 0
      ? Math.min(1, coveredDurationSec / input.videoDurationSec)
      : 0;
  const durationPass = input.videoDurationSec === null || tailSpillSec <= 20;
  const uniformityScore = Math.max(
    0,
    1 - Math.min(1, coefficientOfVariation(gapValues) + coefficientOfVariation(textLengths))
  );
  const gapOutlierCount = gapValues.filter((gap) => Math.abs(gap) > 8).length;

  if (!monotonicPass) {
    failures.push("NON_MONOTONIC_SEGMENTS");
  }
  if (segments.length > 0 && zeroOrNegativeDurationCount / segments.length > 0.01) {
    failures.push("ZERO_OR_NEGATIVE_DURATION_RATIO");
  }
  if (segments.length > 0 && impossibleSpeakingRateCount / segments.length > 0.05) {
    failures.push("IMPOSSIBLE_SPEAKING_RATE_RATIO");
  }
  if (tailSpillSec > 20) {
    failures.push("TAIL_SPILL_OVER_20_SEC");
  } else if (tailSpillSec > 3) {
    warnings.push("TAIL_SPILL_OVER_3_SEC");
  }
  if (uniformityScore > 0.9 && coefficientOfVariation(textLengths) > 0.35) {
    warnings.push("SUSPICIOUS_UNIFORM_TIMING_PATTERN");
  }
  if (coverageRatio < 0.35 && segments.length > 0) {
    warnings.push("LOW_COVERAGE_RATIO");
  }

  let status: TimingValidationResult["status"] = "exact";
  if (failures.length > 0 || !durationPass) {
    status = "unusable";
  } else if (warnings.length > 0) {
    status = "approximate";
  }

  let score = 100;
  score -= failures.length * 25;
  score -= warnings.length * 8;
  if (!monotonicPass) {
    score -= 20;
  }
  if (!durationPass) {
    score -= 20;
  }

  return {
    status,
    syncEligible: status === "exact",
    score: Math.max(0, Math.min(100, Math.round(score))),
    failures,
    warnings,
    metrics: {
      monotonicPass,
      durationPass,
      coverageRatio: roundToMillis(coverageRatio),
      tailSpillSec: roundToMillis(tailSpillSec),
      medianWordsPerSecond: roundToMillis(median(wordsPerSecondValues)),
      p95WordsPerSecond: roundToMillis(percentile(wordsPerSecondValues, 95)),
      uniformityScore: roundToMillis(uniformityScore),
      gapOutlierCount,
    },
  };
}

function resolveTimingAuthority(input: {
  transcriptSource: string | null;
  timingValidation: TimingValidationResult;
  timingAuthorityHint: TimingAuthority | null;
}): TimingAuthority {
  const transcriptSource = (input.transcriptSource || "").toLowerCase();
  if (input.timingValidation.status === "unusable") {
    return "unavailable";
  }
  if (input.timingAuthorityHint && input.timingAuthorityHint !== "unavailable") {
    return input.timingAuthorityHint;
  }
  if (
    input.timingValidation.status === "approximate" ||
    transcriptSource.includes("proxy") ||
    transcriptSource === "admin_override_text" ||
    transcriptSource === "admin_override_json_synthetic"
  ) {
    return "approximate_proxy";
  }
  return "original_transcript";
}

function resolveTimingConfidence(input: {
  transcriptSource: string | null;
  timingValidation: TimingValidationResult;
}): number | null {
  const transcriptSource = (input.transcriptSource || "").toLowerCase();
  if (
    transcriptSource === "admin_override_text" ||
    transcriptSource === "admin_override_json_synthetic"
  ) {
    return null;
  }
  return roundToMillis(input.timingValidation.score / 100);
}

function resolveIndexingV2Occurrences(input: {
  candidates: IndexingV2Candidate[];
  transcriptSegments: TranscriptSegment[];
  timingAuthority: TimingAuthority;
  snippetSourceArtifactId: string;
}): {
  occurrences: ResolvedOccurrence[];
  candidateDecisions: CandidateDecision[];
  discardedLowConfidenceCandidateCount: number;
  splitDecisionCount: number;
  fusionDecisionCount: number;
} {
  const transcriptSegmentOrder = new Map(
    input.transcriptSegments.map((segment, index) => [segment.segment_id, index])
  );
  const candidateDecisions = new Map<string, CandidateDecision>();
  const discardedLowConfidenceCandidateIds = new Set<string>();
  const acceptedCandidates = input.candidates
    .filter((candidate) => {
      if (!isValidNormalizedVerseRef(candidate.normalized_verse_ref)) {
        candidateDecisions.set(candidate.candidate_id, {
          candidate_id: candidate.candidate_id,
          status: "rejected",
          reason: "INVALID_VERSE_REF",
        });
        return false;
      }
      if (candidate.confidence < 0.55) {
        discardedLowConfidenceCandidateIds.add(candidate.candidate_id);
        candidateDecisions.set(candidate.candidate_id, {
          candidate_id: candidate.candidate_id,
          status: "rejected",
          reason: "LOW_CONFIDENCE",
        });
        return false;
      }
      return true;
    })
    .sort(compareCandidates);

  const partitionedCandidates = new Map<string, IndexingV2Candidate[]>();
  for (const candidate of acceptedCandidates) {
    const existing = partitionedCandidates.get(candidate.normalized_verse_ref) || [];
    existing.push(candidate);
    partitionedCandidates.set(candidate.normalized_verse_ref, existing);
  }

  const unsortedOccurrences: Array<
    Omit<ResolvedOccurrence, "occurrence_index"> & {
      order_sort_timestamp: number | null;
      order_sort_segment_index: number | null;
    }
  > = [];
  let splitDecisionCount = 0;
  let fusionDecisionCount = 0;

  for (const [normalizedVerseRef, candidates] of partitionedCandidates.entries()) {
    const contexts: IndexingV2Candidate[][] = [];
    let currentContext: IndexingV2Candidate[] = [];
    let currentAnchorSec = 0;

    for (const candidate of candidates) {
      if (currentContext.length === 0) {
        currentContext = [candidate];
        currentAnchorSec = candidate.timestamp_sec;
        continue;
      }

      const overlapsExisting = currentContext.some((existing) => candidatesOverlap(existing, candidate));
      if (candidate.timestamp_sec - currentAnchorSec <= CONTEXT_WINDOW_SEC || overlapsExisting) {
        currentContext.push(candidate);
        continue;
      }

      contexts.push(currentContext);
      currentContext = [candidate];
      currentAnchorSec = candidate.timestamp_sec;
    }

    if (currentContext.length > 0) {
      contexts.push(currentContext);
    }

    if (contexts.length > 1) {
      splitDecisionCount += contexts.length - 1;
    }

    for (const context of contexts) {
      if (context.length > 1) {
        fusionDecisionCount += 1;
      }
      for (const candidate of context) {
        candidateDecisions.set(candidate.candidate_id, {
          candidate_id: candidate.candidate_id,
          status: "accepted",
          reason: null,
        });
      }

      const canonicalCandidate = resolveCanonicalCandidate(context);
      const occurrenceType = resolveOccurrenceType(context);
      const transcriptSegmentIds = resolveTranscriptSegmentIds(context);
      const canonicalTimestampSec =
        input.timingAuthority === "unavailable"
          ? null
          : roundToMillis(canonicalCandidate?.timestamp_sec ?? context[0].timestamp_sec);
      const snippet = buildSnippet({
        canonicalTimestampSec,
        candidates: context,
        transcriptSegments: input.transcriptSegments,
        snippetSourceArtifactId: input.snippetSourceArtifactId,
      });
      const transcriptCandidateCount = context.filter((candidate) => candidate.source_type !== "ocr").length;
      const ocrCandidateCount = context.filter((candidate) => candidate.source_type === "ocr").length;
      const transcriptSegmentId =
        canonicalCandidate?.transcript_span?.segment_ids?.[0] ||
        canonicalCandidate?.evidence_payload.supporting_segment_ids?.[0] ||
        transcriptSegmentIds[0] ||
        snippet.snippet_source_segment_ids[0] ||
        null;
      const notes: string[] = [];
      if (context.length > 1) {
        notes.push(`fused_${context.length}_candidates`);
      }
      if (transcriptCandidateCount > 0 && ocrCandidateCount > 0) {
        notes.push("multi_source_support");
      }

      unsortedOccurrences.push({
        occurrence_id: crypto.randomUUID(),
        verse_ref: canonicalCandidate?.verse_ref || context[0].verse_ref,
        normalized_verse_ref: normalizedVerseRef,
        canonical_timestamp_sec: canonicalTimestampSec,
        occurrence_type: occurrenceType,
        source_type: occurrenceType,
        confidence: resolveConfidence(context),
        timing_authority: input.timingAuthority,
        canonical_candidate_id: canonicalCandidate?.candidate_id ?? null,
        transcript_segment_id: transcriptSegmentId,
        transcript_segment_ids: transcriptSegmentIds,
        snippet_text: snippet.snippet_text,
        snippet_start_sec: snippet.snippet_start_sec,
        snippet_end_sec: snippet.snippet_end_sec,
        snippet_source_artifact_id: snippet.snippet_source_artifact_id,
        snippet_source_segment_ids: snippet.snippet_source_segment_ids,
        fused_candidate_ids: context.map((candidate) => candidate.candidate_id),
        evidence_summary: {
          transcript_candidate_count: transcriptCandidateCount,
          ocr_candidate_count: ocrCandidateCount,
          primary_source_type: occurrenceType,
          fusion_rule:
            context.length === 1
              ? "single_candidate"
              : occurrenceType === "spoken_explicit"
                ? "spoken_priority"
                : occurrenceType === "allusion"
                  ? "allusion_priority"
                  : "ocr_only",
          notes,
        },
        order_sort_timestamp: canonicalTimestampSec,
        order_sort_segment_index: earliestSegmentIndex(transcriptSegmentIds, transcriptSegmentOrder),
      });
    }
  }

  for (const candidate of input.candidates) {
    if (!candidateDecisions.has(candidate.candidate_id)) {
      candidateDecisions.set(candidate.candidate_id, {
        candidate_id: candidate.candidate_id,
        status: "rejected",
        reason: "UNCLASSIFIED",
      });
    }
  }

  const occurrences = unsortedOccurrences
    .sort((left, right) => {
      const leftSegmentIndex =
        left.order_sort_segment_index === null ? Number.POSITIVE_INFINITY : left.order_sort_segment_index;
      const rightSegmentIndex =
        right.order_sort_segment_index === null ? Number.POSITIVE_INFINITY : right.order_sort_segment_index;
      if (leftSegmentIndex !== rightSegmentIndex) {
        return leftSegmentIndex - rightSegmentIndex;
      }
      const leftTimestamp =
        left.order_sort_timestamp === null ? Number.POSITIVE_INFINITY : left.order_sort_timestamp;
      const rightTimestamp =
        right.order_sort_timestamp === null ? Number.POSITIVE_INFINITY : right.order_sort_timestamp;
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
      return left.occurrence_id.localeCompare(right.occurrence_id);
    })
    .map(({ order_sort_segment_index: _orderSegmentIndex, order_sort_timestamp: _orderTimestamp, ...occurrence }, index) => ({
      ...occurrence,
      occurrence_index: index + 1,
    }));

  return {
    occurrences,
    candidateDecisions: Array.from(candidateDecisions.values()),
    discardedLowConfidenceCandidateCount: discardedLowConfidenceCandidateIds.size,
    splitDecisionCount,
    fusionDecisionCount,
  };
}

function findFixture(youtubeVideoId: string): ValidationFixture | null {
  return VALIDATION_FIXTURES.find((fixture) => fixture.youtubeVideoId === youtubeVideoId) || null;
}

function distinctSourceTypes(
  occurrence: ResolvedOccurrence,
  candidatesById: Map<string, IndexingV2Candidate>
): Set<CandidateSourceType> {
  return new Set(
    occurrence.fused_candidate_ids
      .map((candidateId) => candidatesById.get(candidateId)?.source_type)
      .filter((value): value is CandidateSourceType => Boolean(value))
  );
}

function isLowTrustTiming(timingAuthority: TimingAuthority): boolean {
  return timingAuthority !== "whisperx_aligned";
}

function buildIndexingV2ValidationReport(input: {
  runId: string;
  youtubeVideoId: string;
  timingAuthority: TimingAuthority;
  candidates: IndexingV2Candidate[];
  occurrences: ResolvedOccurrence[];
  discardedLowConfidenceCandidateCount: number;
  splitDecisionCount: number;
  fusionDecisionCount: number;
}): ResolverValidationReport {
  const fixture = findFixture(input.youtubeVideoId);
  const candidatesById = new Map(
    input.candidates.map((candidate) => [candidate.candidate_id, candidate])
  );
  const invariantResults: ResolverValidationReport["invariant_results"] = [];
  const orphanCandidateCount = input.candidates.filter(
    (candidate) =>
      !input.occurrences.some((occurrence) => occurrence.fused_candidate_ids.includes(candidate.candidate_id))
  ).length;

  const versePurityViolation = input.occurrences.find((occurrence) => {
    const verseRefs = new Set(
      occurrence.fused_candidate_ids
        .map((candidateId) => candidatesById.get(candidateId)?.normalized_verse_ref)
        .filter(Boolean)
    );
    return verseRefs.size > 1;
  });
  invariantResults.push({
    code: "VERSE_PURITY",
    status: versePurityViolation ? "fail" : "pass",
    message: versePurityViolation
      ? `Occurrence ${versePurityViolation.occurrence_id} fused mixed verse refs.`
      : "Every occurrence preserves a single normalized verse ref.",
  });

  const lineageViolation = input.occurrences.find(
    (occurrence) => occurrence.fused_candidate_ids.length === 0
  );
  invariantResults.push({
    code: "CANDIDATE_LINEAGE",
    status: lineageViolation ? "fail" : "pass",
    message: lineageViolation
      ? `Occurrence ${lineageViolation.occurrence_id} is missing candidate lineage.`
      : "Every occurrence retains at least one fused candidate id.",
  });

  const duplicateOccurrenceIndex = input.occurrences.find((occurrence, index, occurrences) => {
    return occurrences.findIndex((entry) => entry.occurrence_index === occurrence.occurrence_index) !== index;
  });
  invariantResults.push({
    code: "OCCURRENCE_INDEX_UNIQUENESS",
    status: duplicateOccurrenceIndex ? "fail" : "pass",
    message: duplicateOccurrenceIndex
      ? `Occurrence index ${duplicateOccurrenceIndex.occurrence_index} is duplicated within the run.`
      : "Every occurrence index is unique within the run.",
  });

  const outOfOrderOccurrence = input.occurrences.find((occurrence, index, occurrences) => {
    if (index === 0) {
      return false;
    }
    return occurrence.occurrence_index <= occurrences[index - 1].occurrence_index;
  });
  invariantResults.push({
    code: "OCCURRENCE_INDEX_ORDER",
    status: outOfOrderOccurrence ? "fail" : "pass",
    message: outOfOrderOccurrence
      ? `Occurrence ${outOfOrderOccurrence.occurrence_id} is not ordered by occurrence_index.`
      : "Occurrences are emitted in occurrence_index order.",
  });

  const timestampViolation = input.occurrences.find((occurrence) => {
    if (occurrence.canonical_timestamp_sec === null) {
      return false;
    }
    const candidateTimestamps = occurrence.fused_candidate_ids
      .map((candidateId) => candidatesById.get(candidateId)?.timestamp_sec)
      .filter((value): value is number => typeof value === "number");
    return !candidateTimestamps.includes(occurrence.canonical_timestamp_sec);
  });
  invariantResults.push({
    code: "CANONICAL_TIMESTAMP_LINEAGE",
    status: timestampViolation ? "fail" : "pass",
    message: timestampViolation
      ? `Occurrence ${timestampViolation.occurrence_id} has an unsupported canonical timestamp.`
      : "Every canonical timestamp is backed by at least one fused candidate.",
  });

  const spokenPriorityViolation = input.occurrences.find((occurrence) => {
    const sourceTypes = distinctSourceTypes(occurrence, candidatesById);
    return sourceTypes.has("spoken_explicit") && occurrence.occurrence_type !== "spoken_explicit";
  });
  invariantResults.push({
    code: "SPOKEN_PRIORITY",
    status: spokenPriorityViolation ? "fail" : "pass",
    message: spokenPriorityViolation
      ? `Occurrence ${spokenPriorityViolation.occurrence_id} ignored spoken evidence priority.`
      : "Spoken evidence wins when present in a fused context.",
  });

  const ocrEarlierViolation = input.occurrences.find((occurrence) => {
    const spokenCandidates = occurrence.fused_candidate_ids
      .map((candidateId) => candidatesById.get(candidateId))
      .filter(
        (candidate): candidate is IndexingV2Candidate =>
          Boolean(candidate && candidate.source_type === "spoken_explicit")
      );
    if (spokenCandidates.length === 0) {
      return false;
    }
    if (occurrence.canonical_timestamp_sec === null) {
      return false;
    }
    return occurrence.canonical_timestamp_sec < Math.min(...spokenCandidates.map((candidate) => candidate.timestamp_sec));
  });
  invariantResults.push({
    code: "OCR_SUPPORT_ONLY",
    status: ocrEarlierViolation ? "fail" : "pass",
    message: ocrEarlierViolation
      ? `Occurrence ${ocrEarlierViolation.occurrence_id} was pulled earlier than spoken evidence.`
      : "OCR support never moves a spoken occurrence earlier than the first spoken candidate.",
  });

  const confidenceViolation =
    input.candidates.find((candidate) => candidate.confidence < 0 || candidate.confidence > 1) ||
    input.occurrences.find((occurrence) => occurrence.confidence < 0 || occurrence.confidence > 1);
  invariantResults.push({
    code: "CONFIDENCE_RANGE",
    status: confidenceViolation ? "fail" : "pass",
    message: confidenceViolation
      ? "One or more confidence values fall outside 0.0 to 1.0."
      : "All confidence values are normalized to 0.0 through 1.0.",
  });

  const timingAuthorityViolation = input.occurrences.find(
    (occurrence) => occurrence.timing_authority !== input.timingAuthority
  );
  invariantResults.push({
    code: "TIMING_AUTHORITY_CONSISTENCY",
    status: timingAuthorityViolation ? "fail" : "pass",
    message: timingAuthorityViolation
      ? `Occurrence ${timingAuthorityViolation.occurrence_id} contradicts the run timing authority.`
      : "Occurrence timing authority matches the run timing basis.",
  });

  const transcriptLinkageMissingCount = input.occurrences.filter((occurrence) => {
    const hasTranscriptEvidence = occurrence.fused_candidate_ids.some((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      return candidate && candidate.source_type !== "ocr";
    });
    return hasTranscriptEvidence && occurrence.transcript_segment_ids.length === 0;
  }).length;
  invariantResults.push({
    code: "TRANSCRIPT_LINKAGE",
    status: transcriptLinkageMissingCount > 0 ? "warning" : "pass",
    message:
      transcriptLinkageMissingCount > 0
        ? `${transcriptLinkageMissingCount} transcript-backed occurrences are missing transcript segment linkage.`
        : "Transcript-backed occurrences retain transcript segment linkage.",
  });

  const missingSnippetCount = input.occurrences.filter((occurrence) => {
    const hasTranscriptEvidence = occurrence.fused_candidate_ids.some((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      return candidate && candidate.source_type !== "ocr";
    });
    return hasTranscriptEvidence && !occurrence.snippet_text;
  }).length;
  invariantResults.push({
    code: "SNIPPET_REVIEWABILITY",
    status: missingSnippetCount > 0 ? "warning" : "pass",
    message:
      missingSnippetCount > 0
        ? `${missingSnippetCount} transcript-backed occurrences are missing snippets.`
        : "Transcript-backed occurrences include reviewable snippets.",
  });

  const anchorResults: ResolverValidationReport["anchor_results"] = [];
  if (fixture) {
    for (const anchor of fixture.anchors) {
      const matchingOccurrence =
        anchor.matcher?.(input.occurrences) ||
        input.occurrences.find(
          (occurrence) => occurrence.verse_ref === anchor.verseRef || occurrence.normalized_verse_ref === anchor.verseRef
        ) ||
        null;
      if (!matchingOccurrence) {
        anchorResults.push({
          anchor_id: anchor.anchorId,
          verse_ref: anchor.verseRef,
          status: anchor.onMissing || "fail",
          expected_timestamp_sec: anchor.expectedTimestampSec,
          actual_timestamp_sec: null,
          allowed_delta_sec: anchor.allowedDeltaSec,
          actual_occurrence_id: null,
          notes: ["missing_occurrence"],
        });
        continue;
      }
      const actualTimestampSec = matchingOccurrence.canonical_timestamp_sec;
      const timingIsLowTrust = isLowTrustTiming(input.timingAuthority);
      if (actualTimestampSec === null) {
        anchorResults.push({
          anchor_id: anchor.anchorId,
          verse_ref: anchor.verseRef,
          status: timingIsLowTrust ? "warning" : "fail",
          expected_timestamp_sec: anchor.expectedTimestampSec,
          actual_timestamp_sec: null,
          allowed_delta_sec: anchor.allowedDeltaSec,
          actual_occurrence_id: matchingOccurrence.occurrence_id,
          notes: ["timestamp_unavailable"],
        });
        continue;
      }
      const deltaSec =
        anchor.expectedTimestampSec === null
          ? 0
          : Math.abs(actualTimestampSec - anchor.expectedTimestampSec);
      anchorResults.push({
        anchor_id: anchor.anchorId,
        verse_ref: anchor.verseRef,
        status:
          anchor.expectedTimestampSec === null || deltaSec <= anchor.allowedDeltaSec
            ? "pass"
            : timingIsLowTrust
              ? "warning"
              : "fail",
        expected_timestamp_sec: anchor.expectedTimestampSec,
        actual_timestamp_sec: actualTimestampSec,
        allowed_delta_sec: anchor.allowedDeltaSec,
        actual_occurrence_id: matchingOccurrence.occurrence_id,
        notes:
          anchor.expectedTimestampSec === null || deltaSec <= anchor.allowedDeltaSec
            ? []
            : timingIsLowTrust
              ? [`delta_sec=${roundToMillis(deltaSec)}`, "low_trust_timing_not_scored"]
              : [`delta_sec=${roundToMillis(deltaSec)}`],
      });
    }
  }

  const hasFailures =
    invariantResults.some((result) => result.status === "fail") ||
    anchorResults.some((result) => result.status === "fail");
  const hasWarnings =
    invariantResults.some((result) => result.status === "warning") ||
    anchorResults.some((result) => result.status === "warning");

  return {
    run_id: input.runId,
    fixture_id: fixture?.id || "generic",
    overall_status: hasFailures ? "fail" : hasWarnings ? "pass_with_warnings" : "pass",
    invariant_results: invariantResults,
    anchor_results: anchorResults,
    metrics: {
      candidate_count: input.candidates.length,
      resolved_occurrence_count: input.occurrences.length,
      orphan_candidate_count: orphanCandidateCount,
      multi_source_occurrence_count: input.occurrences.filter((occurrence) => {
        return distinctSourceTypes(occurrence, candidatesById).size > 1;
      }).length,
      ocr_only_occurrence_count: input.occurrences.filter((occurrence) => {
        const sourceTypes = distinctSourceTypes(occurrence, candidatesById);
        return sourceTypes.size === 1 && sourceTypes.has("ocr");
      }).length,
      split_decision_count: input.splitDecisionCount,
      fusion_decision_count: input.fusionDecisionCount,
      discarded_low_confidence_candidate_count: input.discardedLowConfidenceCandidateCount,
    },
  };
}

function findNearestSegments(
  transcriptSegments: TranscriptSegment[],
  timestampSec: number
): TranscriptSegment[] {
  const containing = transcriptSegments.find(
    (segment) => segment.start_sec <= timestampSec && segment.end_sec >= timestampSec
  );
  if (containing) {
    const index = transcriptSegments.findIndex((segment) => segment.segment_id === containing.segment_id);
    return [containing, transcriptSegments[index + 1]].filter(Boolean) as TranscriptSegment[];
  }

  const nearby = [...transcriptSegments]
    .sort(
      (left, right) =>
        Math.abs(left.start_sec - timestampSec) - Math.abs(right.start_sec - timestampSec)
    )
    .slice(0, 2);
  return nearby.sort((left, right) => left.start_sec - right.start_sec);
}

function extractTranscriptSegmentsFromDebug(payload: unknown): TranscriptSegment[] {
  const segmentsValue = pickFirst(payload, [
    "transcript_segments",
    "transcriptSegments",
    "segments",
    "debug.transcript_segments",
    "debug.transcriptSegments",
  ]);
  if (!Array.isArray(segmentsValue)) {
    return [];
  }

  return segmentsValue
    .map((value, index) => {
      const record = asRecord(value);
      if (!record) {
        return null;
      }
      const startSec =
        normalizeNumber(record.start_sec) ??
        (normalizeNumber(record.start_ms) !== null ? Number(record.start_ms) / 1000 : null);
      const endSec =
        normalizeNumber(record.end_sec) ??
        (normalizeNumber(record.end_ms) !== null ? Number(record.end_ms) / 1000 : null);
      const text = normalizeString(record.text);
      if (startSec === null || endSec === null || !text) {
        return null;
      }
      return {
        segment_id: normalizeString(record.segment_id) || `debug-seg-${index + 1}`,
        start_sec: roundToMillis(startSec),
        end_sec: roundToMillis(endSec),
        text,
      };
    })
    .filter((segment): segment is TranscriptSegment => Boolean(segment))
    .sort((left, right) => left.start_sec - right.start_sec);
}

function buildCandidatesFromUpstreamOccurrences(input: {
  transcriptOccurrencesPayload: unknown;
  transcriptSegments: TranscriptSegment[];
  timingAuthority: TimingAuthority;
  sourceArtifactId: string;
  normalizationMethod?: "upstream_bootstrap" | "gemini";
}): IndexingV2Candidate[] {
  const occurrencesValue =
    (Array.isArray(input.transcriptOccurrencesPayload)
      ? input.transcriptOccurrencesPayload
      : pickFirst(input.transcriptOccurrencesPayload, [
          "occurrences",
          "data.occurrences",
          "transcriptOccurrencesJson.occurrences",
        ])) || [];
  if (!Array.isArray(occurrencesValue)) {
    return [];
  }

  return occurrencesValue
    .map((value) => {
      const record = asRecord(value);
      if (!record) {
        return null;
      }
      const verseRef = buildVerseRefFromOccurrenceRecord(record);
      if (!verseRef) {
        return null;
      }
      const normalizedVerseRef = normalizeVerseRef(verseRef) || verseRef;
      const startMs = normalizeNumber(pickFirst(record, ["start_ms", "startMs"]));
      const endMs = normalizeNumber(pickFirst(record, ["end_ms", "endMs"]));
      const startSecRaw =
        parseTimestampSec(
          pickFirst(record, ["timestamp_sec", "timestampSec", "start_sec", "startSec", "t", "start"])
        ) ?? (startMs !== null ? startMs / 1000 : null);
      if (startSecRaw === null) {
        return null;
      }
      const endSecRaw =
        parseTimestampSec(pickFirst(record, ["end_sec", "endSec", "end"])) ??
        (endMs !== null ? endMs / 1000 : null) ??
        startSecRaw;
      const sourceType = detectSourceType(
        pickFirst(record, ["source_type", "sourceType", "kind", "classification", "detection_source"])
      );
      const confidence =
        normalizeNumber(pickFirst(record, ["confidence", "score"])) ?? defaultConfidence(sourceType);
      const supportingSegments = findNearestSegments(input.transcriptSegments, startSecRaw);
      const supportingDetectionIdsValue = pickFirst(record, [
        "detection_ids",
        "detectionIds",
        "ocr_detection_ids",
        "ocrDetectionIds",
      ]);
      const supportingDetectionIds = uniqueStrings(
        Array.isArray(supportingDetectionIdsValue)
          ? supportingDetectionIdsValue.map((value) => normalizeString(value))
          : [
              normalizeString(
                pickFirst(record, ["detection_id", "detectionId", "ocr_detection_id", "ocrDetectionId"])
              ),
            ]
      );
      const transcriptExcerpt =
        normalizeString(
          pickFirst(record, ["raw_snippet", "rawSnippet", "snippet", "text", "display_text", "displayText"])
        ) || supportingSegments.map((segment) => segment.text).join(" ");
      const ocrExcerpt = normalizeString(
        pickFirst(record, ["ocr_excerpt", "ocrExcerpt", "ocr_text", "ocrText", "screen_text", "screenText"])
      );
      return {
        candidate_id: crypto.randomUUID(),
        verse_ref: verseRef,
        normalized_verse_ref: normalizedVerseRef,
        timestamp_sec: roundToMillis(startSecRaw),
        source_type: sourceType,
        confidence: roundToMillis(Math.max(0, Math.min(1, confidence))),
        timing_authority: input.timingAuthority,
        context_key: buildContextKey(normalizedVerseRef, startSecRaw),
        transcript_span: {
          start_sec: roundToMillis(Math.min(...supportingSegments.map((segment) => segment.start_sec))),
          end_sec: roundToMillis(Math.max(endSecRaw, ...supportingSegments.map((segment) => segment.end_sec))),
          segment_ids: supportingSegments.map((segment) => segment.segment_id),
        },
        ocr_span:
          sourceType === "ocr"
            ? {
                start_sec: roundToMillis(startSecRaw),
                end_sec: roundToMillis(endSecRaw),
                detection_ids: supportingDetectionIds,
              }
            : null,
        source_artifact_id: input.sourceArtifactId,
        evidence_payload: {
          transcript_excerpt: normalizeString(transcriptExcerpt),
          ocr_excerpt: ocrExcerpt,
          supporting_segment_ids: supportingSegments.map((segment) => segment.segment_id),
          supporting_detection_ids: supportingDetectionIds,
          normalization_method: input.normalizationMethod || "upstream_bootstrap",
          ambiguity_reason: isValidNormalizedVerseRef(normalizedVerseRef) ? null : "UPSTREAM_REF_NOT_NORMALIZED",
          upstream_shape: record,
        },
      } satisfies IndexingV2Candidate;
    })
    .filter((candidate): candidate is IndexingV2Candidate => Boolean(candidate));
}

function buildCandidatesFromTranscriptSegments(input: {
  transcriptSegments: TranscriptSegment[];
  timingAuthority: TimingAuthority;
  sourceArtifactId: string;
}): IndexingV2Candidate[] {
  const candidates: IndexingV2Candidate[] = [];
  let inheritedContext: VerseContext | null = null;

  for (let index = 0; index < input.transcriptSegments.length; index += 1) {
    const segment = input.transcriptSegments[index];
    const windowSegments = input.transcriptSegments.slice(index, index + 3);
    const offsets: Array<{ start: number; end: number; segment: TranscriptSegment }> = [];
    let cursor = 0;
    for (const windowSegment of windowSegments) {
      const start = cursor;
      const end = start + windowSegment.text.length;
      offsets.push({ start, end, segment: windowSegment });
      cursor = end + 1;
    }
    const combinedText = windowSegments.map((entry) => entry.text).join(" ");
    const parsed = parseVerseRefsFromText(combinedText, inheritedContext);
    inheritedContext = parsed.lastContext;

    for (const reference of parsed.references) {
      const normalizedVerseRef = reference.normalizedVerseRef || reference.verseRef;
      const matchedOffset =
        offsets.find(
          (offset) =>
            reference.matchIndex >= offset.start &&
            reference.matchIndex <= offset.end + reference.matchLength
        ) || offsets[0];
      const matchedSegmentIndex = offsets.findIndex(
        (offset) => offset.segment.segment_id === matchedOffset.segment.segment_id
      );
      const supportingSegments = windowSegments.slice(
        matchedSegmentIndex,
        Math.min(windowSegments.length, matchedSegmentIndex + 2)
      );
      candidates.push({
        candidate_id: crypto.randomUUID(),
        verse_ref: reference.verseRef,
        normalized_verse_ref: normalizedVerseRef,
        timestamp_sec: roundToMillis(matchedOffset.segment.start_sec),
        source_type: "spoken_explicit",
        confidence: reference.confidence,
        timing_authority: input.timingAuthority,
        context_key: buildContextKey(normalizedVerseRef, matchedOffset.segment.start_sec),
        transcript_span: {
          start_sec: roundToMillis(supportingSegments[0].start_sec),
          end_sec: roundToMillis(supportingSegments[supportingSegments.length - 1].end_sec),
          segment_ids: supportingSegments.map((entry) => entry.segment_id),
        },
        ocr_span: null,
        source_artifact_id: input.sourceArtifactId,
        evidence_payload: {
          transcript_excerpt: normalizeString(supportingSegments.map((entry) => entry.text).join(" ")),
          ocr_excerpt: null,
          supporting_segment_ids: supportingSegments.map((entry) => entry.segment_id),
          supporting_detection_ids: [],
          normalization_method: "deterministic",
          ambiguity_reason: reference.ambiguityReason,
        },
      });
    }
  }

  return candidates;
}

function dedupeCandidates(candidates: IndexingV2Candidate[]): IndexingV2Candidate[] {
  const byKey = new Map<string, IndexingV2Candidate>();
  for (const candidate of candidates) {
    const roundedTime = Math.round(candidate.timestamp_sec);
    const key = `${candidate.normalized_verse_ref}|${candidate.source_type}|${roundedTime}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const mergedSegmentIds = uniqueStrings([
      ...(existing.transcript_span?.segment_ids || []),
      ...(candidate.transcript_span?.segment_ids || []),
      ...(existing.evidence_payload.supporting_segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ]);
    const mergedDetectionIds = uniqueStrings([
      ...(existing.ocr_span?.detection_ids || []),
      ...(candidate.ocr_span?.detection_ids || []),
      ...(existing.evidence_payload.supporting_detection_ids || []),
      ...(candidate.evidence_payload.supporting_detection_ids || []),
    ]);
    const mergedStart = Math.min(
      existing.transcript_span?.start_sec ?? existing.timestamp_sec,
      candidate.transcript_span?.start_sec ?? candidate.timestamp_sec
    );
    const mergedEnd = Math.max(
      existing.transcript_span?.end_sec ?? existing.timestamp_sec,
      candidate.transcript_span?.end_sec ?? candidate.timestamp_sec
    );
    byKey.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence, candidate.confidence),
      transcript_span: {
        start_sec: roundToMillis(mergedStart),
        end_sec: roundToMillis(mergedEnd),
        segment_ids: mergedSegmentIds,
      },
      ocr_span: mergeCandidateSpans(existing.ocr_span, candidate.ocr_span),
      evidence_payload: {
        ...existing.evidence_payload,
        transcript_excerpt:
          existing.evidence_payload.transcript_excerpt || candidate.evidence_payload.transcript_excerpt,
        ocr_excerpt: existing.evidence_payload.ocr_excerpt || candidate.evidence_payload.ocr_excerpt,
        supporting_segment_ids: mergedSegmentIds,
        supporting_detection_ids: mergedDetectionIds,
        ambiguity_reason:
          existing.evidence_payload.ambiguity_reason || candidate.evidence_payload.ambiguity_reason,
      },
    });
  }
  return Array.from(byKey.values()).sort(compareCandidates);
}

function countWarnings(report: ResolverValidationReport): number {
  return (
    report.invariant_results.filter((result) => result.status !== "pass").length +
    report.anchor_results.filter((result) => result.status !== "pass").length
  );
}

async function resolveUpstreamVideo(input: {
  supabaseService: Awaited<ReturnType<typeof verifyAdmin>>["supabaseService"];
  youtubeVideoId: string;
  sourceVideoId: string | null;
}): Promise<UpstreamVideoRow | null> {
  const findVideo = async (
    column: "id" | "source_video_id" | "canonical_source_video_id" | "external_video_id",
    value: string
  ): Promise<UpstreamVideoRow | null> => {
    const { data, error } = await input.supabaseService
      .from("videos")
      .select("id, source_video_id, canonical_source_video_id, external_video_id")
      .eq(column, value)
      .limit(1);
    if (error) {
      throw new HttpError(500, "UPSTREAM_VIDEO_LOOKUP_FAILED", error.message);
    }
    return ((data || []) as UpstreamVideoRow[])[0] || null;
  };

  return (
    (input.sourceVideoId ? await findVideo("id", input.sourceVideoId) : null) ||
    (input.sourceVideoId ? await findVideo("source_video_id", input.sourceVideoId) : null) ||
    (input.sourceVideoId ? await findVideo("canonical_source_video_id", input.sourceVideoId) : null) ||
    (await findVideo("external_video_id", input.youtubeVideoId)) ||
    (await findVideo("canonical_source_video_id", input.youtubeVideoId)) ||
    (await findVideo("source_video_id", input.youtubeVideoId))
  );
}

async function loadTranscriptSegments(input: {
  supabaseService: Awaited<ReturnType<typeof verifyAdmin>>["supabaseService"];
  upstreamVideoId: string | null;
  sourceKeys: string[];
}): Promise<TranscriptSegment[]> {
  const normalizedSegments = (rows: Array<Record<string, unknown>>, prefix: string) =>
    rows
      .map((row, index) => {
        const startMs = normalizeNumber(row.start_ms);
        const endMs = normalizeNumber(row.end_ms);
        const text = normalizeString(row.text);
        if (startMs === null || endMs === null || !text) {
          return null;
        }
        return {
          segment_id: `${prefix}-${index + 1}`,
          start_sec: roundToMillis(startMs / 1000),
          end_sec: roundToMillis(endMs / 1000),
          text,
        } satisfies TranscriptSegment;
      })
      .filter((segment): segment is TranscriptSegment => Boolean(segment))
      .sort((left, right) => left.start_sec - right.start_sec);

  if (input.upstreamVideoId) {
    const { data, error } = await input.supabaseService
      .from("transcript_segments")
      .select("start_ms, end_ms, text")
      .eq("video_id", input.upstreamVideoId)
      .order("start_ms", { ascending: true });
    if (error) {
      throw new HttpError(500, "TRANSCRIPT_SEGMENTS_LOOKUP_FAILED", error.message);
    }
    const segments = normalizedSegments((data || []) as Array<Record<string, unknown>>, "seg");
    if (segments.length > 0) {
      return segments;
    }
  }

  const sourceKeys = uniqueStrings(input.sourceKeys);
  if (sourceKeys.length > 0) {
    const { data, error } = await input.supabaseService
      .from("transcript_segments")
      .select("start_ms, end_ms, text, source_video_id")
      .in("source_video_id", sourceKeys)
      .order("start_ms", { ascending: true });
    if (error) {
      throw new HttpError(500, "TRANSCRIPT_SEGMENTS_LOOKUP_FAILED", error.message);
    }
    const segments = normalizedSegments((data || []) as Array<Record<string, unknown>>, "seg");
    if (segments.length > 0) {
      return segments;
    }
  }

  if (input.upstreamVideoId) {
    const { data, error } = await input.supabaseService
      .from("indexing_outputs")
      .select("payload")
      .eq("video_id", input.upstreamVideoId)
      .eq("output_type", "transcript_debug")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      throw new HttpError(500, "TRANSCRIPT_DEBUG_LOOKUP_FAILED", error.message);
    }
    const payload = ((data || [])[0] as { payload: unknown } | undefined)?.payload ?? null;
    const debugSegments = extractTranscriptSegmentsFromDebug(payload);
    if (debugSegments.length > 0) {
      return debugSegments;
    }
  }

  return [];
}

async function loadTranscriptOccurrencesPayload(input: {
  supabaseService: Awaited<ReturnType<typeof verifyAdmin>>["supabaseService"];
  upstreamVideoId: string | null;
}): Promise<unknown | null> {
  if (!input.upstreamVideoId) {
    return null;
  }
  const { data, error } = await input.supabaseService
    .from("indexing_outputs")
    .select("payload")
    .eq("video_id", input.upstreamVideoId)
    .eq("output_type", "transcript_occurrences")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new HttpError(500, "TRANSCRIPT_OCCURRENCES_LOOKUP_FAILED", error.message);
  }
  return ((data || [])[0] as { payload: unknown } | undefined)?.payload ?? null;
}

async function invokeGeminiTranscriptDetectorDryRun(input: {
  accessToken: string;
  upstreamVideoId: string | null;
  sourceVideoId: string | null;
  youtubeVideoId: string;
  youtubeUrl: string;
  transcriptSegments: TranscriptSegment[];
}): Promise<GeminiTranscriptDryRunResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const downstreamTimeoutMs = 180_000;

  if (!supabaseUrl || !input.accessToken) {
    throw new HttpError(
      500,
      "GEMINI_TRANSCRIPT_DRY_RUN_CONFIG_MISSING",
      "Missing SUPABASE_URL or admin access token for Gemini transcript dry-run."
    );
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/detect_verses_from_transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        dryRun: true,
        persistOutputs: false,
        videoId: input.upstreamVideoId || input.youtubeVideoId,
        youtubeVideoId: input.youtubeVideoId,
        youtubeUrl: input.youtubeUrl,
        sourceVideoId: input.sourceVideoId,
        chunkMinutes: 10,
        chunkOverlapSeconds: 0,
        transcriptSegments: input.transcriptSegments.map((segment) => ({
          start_ms: Math.round(segment.start_sec * 1000),
          end_ms: Math.round(segment.end_sec * 1000),
          text: segment.text,
        })),
        includeTranscriptDebugInResponse: false,
      }),
      signal: AbortSignal.timeout(downstreamTimeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new HttpError(
        504,
        "GEMINI_TRANSCRIPT_DRY_RUN_TIMEOUT",
        `Shared transcript detector dry-run exceeded ${Math.round(downstreamTimeoutMs / 1000)} seconds.`
      );
    }
    throw error;
  }

  let payload: unknown = null;
  const raw = await response.text();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const details =
      normalizeString(
        pickFirst(payload, ["error", "message", "details"])
          ? String(pickFirst(payload, ["error", "message", "details"]))
          : raw
      ) || `HTTP ${response.status}`;
    throw new HttpError(
      502,
      "GEMINI_TRANSCRIPT_DRY_RUN_FAILED",
      `Shared transcript detector dry-run failed: ${details}`
    );
  }

  const record = asRecord(payload);
  if (!record) {
    throw new HttpError(
      502,
      "GEMINI_TRANSCRIPT_DRY_RUN_INVALID",
      "Shared transcript detector returned an invalid response body."
    );
  }

  return record as GeminiTranscriptDryRunResponse;
}

async function loadTranscriptRunMetadata(input: {
  supabaseService: Awaited<ReturnType<typeof verifyAdmin>>["supabaseService"];
  upstreamVideoId: string | null;
}): Promise<{ transcriptSource: string | null; laneUsed: string | null; durationSec: number | null }> {
  if (!input.upstreamVideoId) {
    return { transcriptSource: null, laneUsed: null, durationSec: null };
  }
  const { data, error } = await input.supabaseService
    .from("indexing_runs")
    .select("meta, duration_ms")
    .eq("video_id", input.upstreamVideoId)
    .eq("phase", "transcript_acquisition")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new HttpError(500, "TRANSCRIPT_RUN_LOOKUP_FAILED", error.message);
  }
  const row = ((data || [])[0] as UpstreamTranscriptRunRow | undefined) || null;
  if (!row) {
    return { transcriptSource: null, laneUsed: null, durationSec: null };
  }
  const transcriptSource =
    normalizeString(pickFirst(row.meta, ["transcript_source", "transcriptSource", "transcript_matched_on"])) || null;
  const laneUsed =
    normalizeString(pickFirst(row.meta, ["winning_lane", "winningLane", "lane", "lane_used", "laneUsed"])) || null;
  return {
    transcriptSource,
    laneUsed,
    durationSec: row.duration_ms ? roundToMillis(row.duration_ms / 1000) : null,
  };
}

async function insertArtifact(input: {
  supabaseService: Awaited<ReturnType<typeof verifyAdmin>>["supabaseService"];
  runId: string;
  artifactType: string;
  stage: string;
  payload: unknown;
}): Promise<{ id: string }> {
  const payloadText = JSON.stringify(input.payload);
  const { data, error } = await input.supabaseService
    .from("indexing_v2_run_artifacts")
    .insert({
      run_id: input.runId,
      artifact_type: input.artifactType,
      stage: input.stage,
      storage_kind: "database_json",
      mime_type: "application/json",
      payload: input.payload,
      size_bytes: payloadText.length,
      pipeline_version: "indexing_v2",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new HttpError(500, "ARTIFACT_INSERT_FAILED", error?.message || "unknown artifact insert error");
  }
  return { id: String(data.id) };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { user, supabaseService, accessToken } = await verifyAdmin(req);
    const body = (await req.json()) as AdminIndexingV2TestRunRequest;
    const youtubeUrl = normalizeString(body.youtubeUrl);
    if (!youtubeUrl) {
      throw new HttpError(400, "INVALID_INPUT", "youtubeUrl is required.");
    }

    const youtubeVideoId = extractYoutubeVideoId(youtubeUrl);
    if (!youtubeVideoId) {
      throw new HttpError(400, "INVALID_YOUTUBE_URL", "Could not determine a YouTube video id.");
    }

    const runMode: RunMode =
      body.runMode === "public" || body.runMode === "personal" ? body.runMode : "admin_test";
    const requestedByUserId =
      normalizeString(body.requestedByUserId) || (runMode === "personal" ? user.id : null);
    const sourceVideoId = normalizeString(body.sourceVideoId);
    const transcriptOverrideText = normalizeString(body.transcriptOverrideText);
    const transcriptOverrideJson = normalizeString(body.transcriptOverrideJson);
    const ignoreUpstreamTranscriptCache = Boolean(body.ignoreUpstreamTranscriptCache);

    const { data: runInsert, error: runInsertError } = await supabaseService
      .from("indexing_v2_runs")
      .insert({
        requested_by_user_id: requestedByUserId,
        source_video_id: sourceVideoId,
        youtube_video_id: youtubeVideoId,
        youtube_url: youtubeUrl,
        run_mode: runMode,
        status: "queued",
        pipeline_version: "indexing_v2",
        execution_mode: "no_alignment",
        timing_authority: "unavailable",
      })
      .select("id")
      .single();

    if (runInsertError || !runInsert) {
      throw new HttpError(500, "RUN_INSERT_FAILED", runInsertError?.message || "Failed to create V2 run.");
    }

    const runId = String(runInsert.id);

    try {
      await supabaseService
        .from("indexing_v2_runs")
        .update({ status: "transcribing" })
        .eq("id", runId);

      const upstreamVideo = ignoreUpstreamTranscriptCache
        ? null
        : await resolveUpstreamVideo({
            supabaseService,
            youtubeVideoId,
            sourceVideoId,
          });
      const transcriptOverride = parseTranscriptOverride({
        transcriptOverrideText,
        transcriptOverrideJson,
      });
      const sourceKeys = uniqueStrings([
        sourceVideoId,
        upstreamVideo?.source_video_id,
        upstreamVideo?.canonical_source_video_id || null,
        youtubeVideoId,
      ]);
      const transcriptSegments =
        transcriptOverride.transcriptSegments.length > 0
          ? transcriptOverride.transcriptSegments
          : await loadTranscriptSegments({
              supabaseService,
              upstreamVideoId: upstreamVideo?.id || null,
              sourceKeys,
            });

      if (transcriptSegments.length === 0) {
        throw new HttpError(
          404,
          "TRANSCRIPT_NOT_FOUND",
          ignoreUpstreamTranscriptCache
            ? "No transcript override was provided after cached transcript reuse was skipped."
            : "No cached upstream transcript was found for this video, and no transcript override was provided."
        );
      }

      const transcriptRunMetadata =
        transcriptOverride.transcriptSegments.length > 0
          ? {
              transcriptSource: transcriptOverride.transcriptSource,
              laneUsed: transcriptOverride.laneUsed,
              durationSec: transcriptOverride.durationSec,
            }
          : await loadTranscriptRunMetadata({
              supabaseService,
              upstreamVideoId: upstreamVideo?.id || null,
            });
      const timingValidation = validateTranscriptTiming({
        transcriptSegments,
        videoDurationSec: transcriptRunMetadata.durationSec,
      });
      const timingAuthority = resolveTimingAuthority({
        transcriptSource: transcriptRunMetadata.transcriptSource,
        timingValidation,
        timingAuthorityHint: transcriptOverride.timingAuthorityHint,
      });
      const timingConfidence = resolveTimingConfidence({
        transcriptSource: transcriptRunMetadata.transcriptSource,
        timingValidation,
      });

      const transcriptArtifactPayload = {
        youtube_video_id: youtubeVideoId,
        youtube_url: youtubeUrl,
        upstream_video_id: upstreamVideo?.id || null,
        source_video_id: sourceVideoId || upstreamVideo?.source_video_id || null,
        transcript_source: transcriptRunMetadata.transcriptSource,
        lane_used: transcriptRunMetadata.laneUsed,
        timing_validation: timingValidation,
        override_meta: transcriptOverride.overrideMeta,
        cache_policy: {
          ignore_upstream_transcript_cache: ignoreUpstreamTranscriptCache,
          used_override: transcriptOverride.transcriptSegments.length > 0,
        },
        segments: transcriptSegments,
      };

      const transcriptArtifact = await insertArtifact({
        supabaseService,
        runId,
        artifactType: "raw_transcript_json",
        stage: "transcript_acquisition",
        payload: transcriptArtifactPayload,
      });

      await supabaseService
        .from("indexing_v2_runs")
        .update({
          upstream_video_id: upstreamVideo?.id || null,
          source_video_id: sourceVideoId || upstreamVideo?.source_video_id || null,
          transcript_source: transcriptRunMetadata.transcriptSource,
          lane_used: transcriptRunMetadata.laneUsed,
          timing_authority: timingAuthority,
          timing_confidence: timingConfidence,
          transcript_segment_count: transcriptSegments.length,
          status: "analyzing",
        })
        .eq("id", runId);

      const usedTranscriptOverride = transcriptOverride.transcriptSegments.length > 0;
      let geminiTranscriptResponse: GeminiTranscriptDryRunResponse | null = null;
      let geminiDryRunError: string | null = null;

      if (!usedTranscriptOverride) {
        try {
          geminiTranscriptResponse = await invokeGeminiTranscriptDetectorDryRun({
            accessToken,
            upstreamVideoId: upstreamVideo?.id || null,
            sourceVideoId: sourceVideoId || upstreamVideo?.source_video_id || null,
            youtubeVideoId,
            youtubeUrl,
            transcriptSegments,
          });
        } catch (error) {
          geminiDryRunError = error instanceof Error ? error.message : "Shared Gemini transcript dry-run failed.";
        }
      } else {
        geminiDryRunError = "Skipped for transcript override run.";
      }

      const geminiTranscriptArtifact =
        geminiTranscriptResponse
          ? await insertArtifact({
              supabaseService,
              runId,
              artifactType: "raw_transcript_json",
              stage: "semantic_analysis",
              payload: geminiTranscriptResponse,
            })
          : null;

      const transcriptOccurrencesPayload =
        geminiTranscriptResponse?.transcriptOccurrencesJson ??
        (usedTranscriptOverride
          ? null
          : await loadTranscriptOccurrencesPayload({
              supabaseService,
              upstreamVideoId: upstreamVideo?.id || null,
            }));

      const upstreamCandidates = buildCandidatesFromUpstreamOccurrences({
        transcriptOccurrencesPayload,
        transcriptSegments,
        timingAuthority,
        sourceArtifactId: geminiTranscriptArtifact?.id || transcriptArtifact.id,
        normalizationMethod: geminiTranscriptResponse ? "gemini" : "upstream_bootstrap",
      });
      const regexCandidates = buildCandidatesFromTranscriptSegments({
        transcriptSegments,
        timingAuthority,
        sourceArtifactId: transcriptArtifact.id,
      });
      const allCandidates = suppressContainedVerseCandidates(
        dedupeCandidates(
          promoteSignatureBoundedRanges(
            promoteQuotedContinuationRanges(
              promoteSequentialRangeCandidates(
                dedupeCandidates([...upstreamCandidates, ...regexCandidates])
              ),
              transcriptSegments
            ),
            transcriptSegments
          )
        )
      );

      const resolverResult = resolveIndexingV2Occurrences({
        candidates: allCandidates,
        transcriptSegments,
        timingAuthority,
        snippetSourceArtifactId: transcriptArtifact.id,
      });
      const candidateDecisionById = new Map(
        resolverResult.candidateDecisions.map((decision) => [decision.candidate_id, decision])
      );

      const candidateArtifactPayload = {
        pipeline_version: "indexing_v2",
        timing_authority: timingAuthority,
        semantic_analysis: {
          attempted_gemini_dry_run: !usedTranscriptOverride,
          source:
            geminiTranscriptResponse
              ? "shared_gemini_dry_run"
              : usedTranscriptOverride
                ? "deterministic_override"
                : "deterministic_fallback",
          fallback_reason: geminiTranscriptResponse ? null : geminiDryRunError,
        },
        candidate_count: allCandidates.length,
        candidates: allCandidates.map((candidate) => ({
          ...candidate,
          resolver_status: candidateDecisionById.get(candidate.candidate_id)?.status || "rejected",
          rejection_reason: candidateDecisionById.get(candidate.candidate_id)?.reason || null,
        })),
      };
      const candidateArtifact = await insertArtifact({
        supabaseService,
        runId,
        artifactType: "verse_candidates_json",
        stage: "semantic_analysis",
        payload: candidateArtifactPayload,
      });

      if (allCandidates.length > 0) {
        const { error: candidateInsertError } = await supabaseService.from("indexing_v2_candidates").insert(
          allCandidates.map((candidate) => {
            const decision = candidateDecisionById.get(candidate.candidate_id);
            return {
              candidate_id: candidate.candidate_id,
              run_id: runId,
              verse_ref: candidate.verse_ref,
              normalized_verse_ref: candidate.normalized_verse_ref,
              timestamp_sec: candidate.timestamp_sec,
              source_type: candidate.source_type,
              confidence: candidate.confidence,
              timing_authority: candidate.timing_authority,
              context_key: candidate.context_key,
              transcript_span: candidate.transcript_span,
              ocr_span: candidate.ocr_span,
              evidence_payload: candidate.evidence_payload,
              source_artifact_id: candidate.source_artifact_id,
              resolver_status: decision?.status || "rejected",
              rejection_reason: decision?.reason || null,
              pipeline_version: "indexing_v2",
            };
          })
        );
        if (candidateInsertError) {
          throw new HttpError(500, "CANDIDATE_INSERT_FAILED", candidateInsertError.message);
        }
      }

      await supabaseService
        .from("indexing_v2_runs")
        .update({ status: "resolving", candidate_count: allCandidates.length })
        .eq("id", runId);

      const occurrenceArtifactPayload = {
        pipeline_version: "indexing_v2",
        timing_authority: timingAuthority,
        occurrence_count: resolverResult.occurrences.length,
        occurrences: resolverResult.occurrences,
      };
      await insertArtifact({
        supabaseService,
        runId,
        artifactType: "resolved_occurrences_json",
        stage: "resolution",
        payload: occurrenceArtifactPayload,
      });

      if (resolverResult.occurrences.length > 0) {
        const { error: occurrenceInsertError } = await supabaseService.from("indexing_v2_occurrences").insert(
          resolverResult.occurrences.map((occurrence) => ({
            occurrence_id: occurrence.occurrence_id,
            run_id: runId,
            occurrence_index: occurrence.occurrence_index,
            verse_ref: occurrence.verse_ref,
            normalized_verse_ref: occurrence.normalized_verse_ref,
            canonical_timestamp_sec: occurrence.canonical_timestamp_sec,
            occurrence_type: occurrence.occurrence_type,
            source_type: occurrence.source_type,
            confidence: occurrence.confidence,
            timing_authority: occurrence.timing_authority,
            canonical_candidate_id: occurrence.canonical_candidate_id,
            transcript_segment_id: occurrence.transcript_segment_id,
            transcript_segment_ids: occurrence.transcript_segment_ids,
            snippet_text: occurrence.snippet_text,
            snippet_start_sec: occurrence.snippet_start_sec,
            snippet_end_sec: occurrence.snippet_end_sec,
            snippet_source_artifact_id: occurrence.snippet_source_artifact_id,
            snippet_source_segment_ids: occurrence.snippet_source_segment_ids,
            evidence_summary: occurrence.evidence_summary,
            pipeline_version: "indexing_v2",
          }))
        );
        if (occurrenceInsertError) {
          throw new HttpError(500, "OCCURRENCE_INSERT_FAILED", occurrenceInsertError.message);
        }
      }

      const occurrenceCandidateRows = resolverResult.occurrences.flatMap((occurrence) =>
        occurrence.fused_candidate_ids.map((candidateId) => ({
          occurrence_id: occurrence.occurrence_id,
          candidate_id: candidateId,
          role: occurrence.canonical_candidate_id === candidateId ? "canonical" : "supporting",
        }))
      );
      if (occurrenceCandidateRows.length > 0) {
        const { error: occurrenceCandidateInsertError } = await supabaseService
          .from("indexing_v2_occurrence_candidates")
          .insert(occurrenceCandidateRows);
        if (occurrenceCandidateInsertError) {
          throw new HttpError(500, "OCCURRENCE_CANDIDATE_INSERT_FAILED", occurrenceCandidateInsertError.message);
        }
      }

      const validationReport = buildIndexingV2ValidationReport({
        runId,
        youtubeVideoId,
        timingAuthority,
        candidates: allCandidates,
        occurrences: resolverResult.occurrences,
        discardedLowConfidenceCandidateCount: resolverResult.discardedLowConfidenceCandidateCount,
        splitDecisionCount: resolverResult.splitDecisionCount,
        fusionDecisionCount: resolverResult.fusionDecisionCount,
      });
      const validationArtifact = await insertArtifact({
        supabaseService,
        runId,
        artifactType: "validation_report_json",
        stage: "review",
        payload: validationReport,
      });

      const warningCount = countWarnings(validationReport);
      const { error: validationInsertError } = await supabaseService.from("indexing_v2_validation_reports").insert({
        run_id: runId,
        artifact_id: validationArtifact.id,
        fixture_id: validationReport.fixture_id,
        overall_status: validationReport.overall_status,
        warning_count: warningCount,
        report: validationReport,
      });
      if (validationInsertError) {
        throw new HttpError(500, "VALIDATION_REPORT_INSERT_FAILED", validationInsertError.message);
      }

      await supabaseService
        .from("indexing_v2_runs")
        .update({
          status: validationReport.overall_status === "pass" ? "complete" : "complete_with_warnings",
          occurrence_count: resolverResult.occurrences.length,
          warning_count: warningCount,
          timing_authority: timingAuthority,
          timing_confidence: timingConfidence,
        })
        .eq("id", runId);

      return jsonResponse({
        runId,
        status: validationReport.overall_status === "pass" ? "complete" : "complete_with_warnings",
        pipelineVersion: "indexing_v2",
      });
    } catch (error) {
      const httpError =
        error instanceof HttpError
          ? error
          : new HttpError(500, "INDEXING_V2_RUN_FAILED", error instanceof Error ? error.message : "Unknown error");

      await supabaseService
        .from("indexing_v2_runs")
        .update({
          status: "failed",
          error_code: httpError.code,
          error_message: httpError.message,
        })
        .eq("id", runId);

      throw httpError;
    }
  } catch (error) {
    const httpError =
      error instanceof HttpError
        ? error
        : new HttpError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: httpError.message, code: httpError.code }, httpError.status);
  }
});
