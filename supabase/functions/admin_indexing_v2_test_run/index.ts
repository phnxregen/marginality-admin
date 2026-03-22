import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { verifyAdmin } from "../_shared/admin_auth.ts";

type RunMode = "admin_test" | "public" | "personal";
type TimingAuthority =
  | "whisperx_aligned"
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
    normalization_method: "deterministic" | "upstream_bootstrap";
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
  verse_ref: string;
  normalized_verse_ref: string;
  canonical_timestamp_sec: number;
  occurrence_type: CandidateSourceType;
  confidence: number;
  timing_authority: TimingAuthority;
  canonical_candidate_id: string | null;
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
}

type UpstreamVideoRow = {
  id: string;
  source_video_id: string | null;
  external_video_id: string | null;
};

type UpstreamTranscriptRunRow = {
  meta: Record<string, unknown> | null;
  duration_ms: number | null;
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
          occurrences.find((occurrence) => Math.abs(occurrence.canonical_timestamp_sec - 1088) <= 10) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_19_45",
        verseRef: "context_window",
        expectedTimestampSec: 1185,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find((occurrence) => Math.abs(occurrence.canonical_timestamp_sec - 1185) <= 10) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_28_05",
        verseRef: "context_window",
        expectedTimestampSec: 1685,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find((occurrence) => Math.abs(occurrence.canonical_timestamp_sec - 1685) <= 10) || null,
        onMissing: "warning",
      },
      {
        anchorId: "repetition_33_04",
        verseRef: "context_window",
        expectedTimestampSec: 1984,
        allowedDeltaSec: 10,
        matcher: (occurrences) =>
          occurrences.find((occurrence) => Math.abs(occurrence.canonical_timestamp_sec - 1984) <= 10) || null,
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

function normalizeBookName(value: string): string | null {
  const lowered = normalizeWhitespace(value.toLowerCase());
  for (const entry of BOOK_ALIASES) {
    if (entry.aliases.some((alias) => alias === lowered)) {
      return entry.canonical;
    }
  }
  return null;
}

function parseVerseRefsFromText(text: string): Array<{
  verseRef: string;
  normalizedVerseRef: string | null;
  confidence: number;
  ambiguityReason: string | null;
}> {
  const lowered = normalizeWhitespace(text.toLowerCase().replace(/[–—]/g, "-"));
  const results: Array<{
    verseRef: string;
    normalizedVerseRef: string | null;
    confidence: number;
    ambiguityReason: string | null;
  }> = [];

  for (const entry of BOOK_ALIASES) {
    for (const alias of entry.aliases.sort((left, right) => right.length - left.length)) {
      const aliasPattern = new RegExp(`(^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const matches = lowered.matchAll(aliasPattern);
      for (const match of matches) {
        const startIndex = match.index ?? 0;
        const remainder = lowered.slice(startIndex + match[0].length).trim();
        const explicit =
          remainder.match(/^(\d+)\s*:\s*(\d+)(?:\s*(?:-|through|thru|to)\s*(\d+))?/) ||
          remainder.match(/^chapter\s+(\d+)(?:[^0-9]{0,30}verse\s+(\d+)(?:\s*(?:-|through|thru|to)\s*(\d+))?)?/) ||
          remainder.match(/^(\d+)\s+verse\s+(\d+)(?:\s*(?:-|through|thru|to)\s*(\d+))?/);
        if (explicit) {
          const chapter = Number(explicit[1]);
          const verse = explicit[2] ? Number(explicit[2]) : null;
          const rangeEnd = explicit[3] ? Number(explicit[3]) : null;
          if (verse !== null) {
            const verseRef = rangeEnd
              ? `${entry.canonical} ${chapter}:${verse}-${rangeEnd}`
              : `${entry.canonical} ${chapter}:${verse}`;
            results.push({
              verseRef,
              normalizedVerseRef: verseRef,
              confidence: 0.9,
              ambiguityReason: null,
            });
            continue;
          }
        }

        const chapterOnly = remainder.match(/^(\d+)\b/);
        if (chapterOnly) {
          const verseRef = `${entry.canonical} ${Number(chapterOnly[1])}`;
          results.push({
            verseRef,
            normalizedVerseRef: verseRef,
            confidence: 0.52,
            ambiguityReason: "CHAPTER_ONLY_REF",
          });
        }
      }
    }
  }

  return results.filter(
    (result, index, items) =>
      items.findIndex((candidate) => candidate.verseRef === result.verseRef) === index
  );
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

function trimSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
}

function buildSnippet(input: {
  canonicalTimestampSec: number;
  candidates: IndexingV2Candidate[];
  transcriptSegments: TranscriptSegment[];
  snippetSourceArtifactId: string;
}) {
  const supportingSegmentIds = uniqueStrings(
    input.candidates.flatMap((candidate) => [
      ...(candidate.transcript_span?.segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ])
  );
  const preferredSegments = input.transcriptSegments.filter((segment) =>
    supportingSegmentIds.includes(segment.segment_id)
  );
  const searchStart = input.canonicalTimestampSec - SNIPPET_SEARCH_WINDOW_BEFORE_SEC;
  const searchEnd = input.canonicalTimestampSec + SNIPPET_SEARCH_WINDOW_AFTER_SEC;
  const inWindow = input.transcriptSegments.filter(
    (segment) => segment.end_sec >= searchStart && segment.start_sec <= searchEnd
  );
  const containingSegment =
    preferredSegments.find(
      (segment) => segment.start_sec <= input.canonicalTimestampSec && segment.end_sec >= input.canonicalTimestampSec
    ) ??
    inWindow.find(
      (segment) => segment.start_sec <= input.canonicalTimestampSec && segment.end_sec >= input.canonicalTimestampSec
    ) ??
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
}): TimingAuthority {
  if (input.timingValidation.status === "unusable") {
    return "unavailable";
  }
  if (
    input.timingValidation.status === "approximate" ||
    (input.transcriptSource || "").toLowerCase().includes("proxy")
  ) {
    return "approximate_proxy";
  }
  return "original_transcript";
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

  const occurrences: ResolvedOccurrence[] = [];
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
      const snippet = buildSnippet({
        canonicalTimestampSec: canonicalCandidate?.timestamp_sec ?? context[0].timestamp_sec,
        candidates: context,
        transcriptSegments: input.transcriptSegments,
        snippetSourceArtifactId: input.snippetSourceArtifactId,
      });
      const transcriptCandidateCount = context.filter((candidate) => candidate.source_type !== "ocr").length;
      const ocrCandidateCount = context.filter((candidate) => candidate.source_type === "ocr").length;
      const notes: string[] = [];
      if (context.length > 1) {
        notes.push(`fused_${context.length}_candidates`);
      }
      if (transcriptCandidateCount > 0 && ocrCandidateCount > 0) {
        notes.push("multi_source_support");
      }

      occurrences.push({
        occurrence_id: crypto.randomUUID(),
        verse_ref: canonicalCandidate?.verse_ref || context[0].verse_ref,
        normalized_verse_ref: normalizedVerseRef,
        canonical_timestamp_sec: roundToMillis(
          canonicalCandidate?.timestamp_sec ?? context[0].timestamp_sec
        ),
        occurrence_type: occurrenceType,
        confidence: resolveConfidence(context),
        timing_authority: input.timingAuthority,
        canonical_candidate_id: canonicalCandidate?.candidate_id ?? null,
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

  return {
    occurrences: occurrences.sort(
      (left, right) => left.canonical_timestamp_sec - right.canonical_timestamp_sec
    ),
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

  const timestampViolation = input.occurrences.find((occurrence) => {
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
            : "fail",
        expected_timestamp_sec: anchor.expectedTimestampSec,
        actual_timestamp_sec: actualTimestampSec,
        allowed_delta_sec: anchor.allowedDeltaSec,
        actual_occurrence_id: matchingOccurrence.occurrence_id,
        notes:
          anchor.expectedTimestampSec === null || deltaSec <= anchor.allowedDeltaSec
            ? []
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
}): IndexingV2Candidate[] {
  const occurrencesValue =
    (Array.isArray(input.transcriptOccurrencesPayload)
      ? input.transcriptOccurrencesPayload
      : pickFirst(input.transcriptOccurrencesPayload, ["occurrences", "data.occurrences"])) || [];
  if (!Array.isArray(occurrencesValue)) {
    return [];
  }

  return occurrencesValue
    .map((value) => {
      const record = asRecord(value);
      if (!record) {
        return null;
      }
      const verseRef =
        normalizeString(
          pickFirst(record, [
            "verse_ref",
            "verseRef",
            "reference",
            "verse_reference",
            "verseReference",
            "display_ref",
            "displayRef",
            "display.reference",
            "label",
          ])
        ) || null;
      if (!verseRef) {
        return null;
      }
      const normalizedVerseRef = normalizeVerseRef(verseRef) || verseRef;
      const startMs = normalizeNumber(pickFirst(record, ["start_ms", "startMs"]));
      const endMs = normalizeNumber(pickFirst(record, ["end_ms", "endMs"]));
      const startSecRaw =
        normalizeNumber(
          pickFirst(record, ["timestamp_sec", "timestampSec", "start_sec", "startSec", "t"])
        ) ?? (startMs !== null ? startMs / 1000 : null);
      if (startSecRaw === null) {
        return null;
      }
      const endSecRaw =
        normalizeNumber(pickFirst(record, ["end_sec", "endSec"])) ??
        (endMs !== null ? endMs / 1000 : null) ??
        startSecRaw;
      const sourceType = detectSourceType(
        pickFirst(record, ["source_type", "sourceType", "kind", "classification", "detection_source"])
      );
      const confidence =
        normalizeNumber(pickFirst(record, ["confidence", "score"])) ?? defaultConfidence(sourceType);
      const supportingSegments = findNearestSegments(input.transcriptSegments, startSecRaw);
      const transcriptExcerpt =
        normalizeString(
          pickFirst(record, ["raw_snippet", "rawSnippet", "snippet", "text", "display_text", "displayText"])
        ) || supportingSegments.map((segment) => segment.text).join(" ");
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
        ocr_span: null,
        source_artifact_id: input.sourceArtifactId,
        evidence_payload: {
          transcript_excerpt: normalizeString(transcriptExcerpt),
          ocr_excerpt: null,
          supporting_segment_ids: supportingSegments.map((segment) => segment.segment_id),
          supporting_detection_ids: [],
          normalization_method: "upstream_bootstrap",
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

  for (let index = 0; index < input.transcriptSegments.length; index += 1) {
    const segment = input.transcriptSegments[index];
    const adjacent = input.transcriptSegments[index + 1];
    const windowSegments = [segment, adjacent].filter(Boolean) as TranscriptSegment[];
    const combinedText = windowSegments.map((entry) => entry.text).join(" ");
    const references = parseVerseRefsFromText(combinedText);
    for (const reference of references) {
      const normalizedVerseRef = reference.normalizedVerseRef || reference.verseRef;
      candidates.push({
        candidate_id: crypto.randomUUID(),
        verse_ref: reference.verseRef,
        normalized_verse_ref: normalizedVerseRef,
        timestamp_sec: roundToMillis(segment.start_sec),
        source_type: "spoken_explicit",
        confidence: reference.confidence,
        timing_authority: input.timingAuthority,
        context_key: buildContextKey(normalizedVerseRef, segment.start_sec),
        transcript_span: {
          start_sec: roundToMillis(segment.start_sec),
          end_sec: roundToMillis(windowSegments[windowSegments.length - 1].end_sec),
          segment_ids: windowSegments.map((entry) => entry.segment_id),
        },
        ocr_span: null,
        source_artifact_id: input.sourceArtifactId,
        evidence_payload: {
          transcript_excerpt: normalizeString(combinedText),
          ocr_excerpt: null,
          supporting_segment_ids: windowSegments.map((entry) => entry.segment_id),
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
      evidence_payload: {
        ...existing.evidence_payload,
        transcript_excerpt:
          existing.evidence_payload.transcript_excerpt || candidate.evidence_payload.transcript_excerpt,
        supporting_segment_ids: mergedSegmentIds,
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
    column: "source_video_id" | "external_video_id",
    value: string
  ): Promise<UpstreamVideoRow | null> => {
    const { data, error } = await input.supabaseService
      .from("videos")
      .select("id, source_video_id, external_video_id")
      .eq(column, value)
      .limit(1);
    if (error) {
      throw new HttpError(500, "UPSTREAM_VIDEO_LOOKUP_FAILED", error.message);
    }
    return ((data || []) as UpstreamVideoRow[])[0] || null;
  };

  return (
    (input.sourceVideoId ? await findVideo("source_video_id", input.sourceVideoId) : null) ||
    (await findVideo("external_video_id", input.youtubeVideoId)) ||
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
    const { user, supabaseService } = await verifyAdmin(req);
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

      const upstreamVideo = await resolveUpstreamVideo({
        supabaseService,
        youtubeVideoId,
        sourceVideoId,
      });
      const sourceKeys = uniqueStrings([
        sourceVideoId,
        upstreamVideo?.source_video_id,
        youtubeVideoId,
      ]);
      const transcriptSegments = await loadTranscriptSegments({
        supabaseService,
        upstreamVideoId: upstreamVideo?.id || null,
        sourceKeys,
      });

      if (transcriptSegments.length === 0) {
        throw new HttpError(
          404,
          "TRANSCRIPT_NOT_FOUND",
          "No upstream transcript segments were found for this video."
        );
      }

      const transcriptRunMetadata = await loadTranscriptRunMetadata({
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
      });

      const transcriptArtifactPayload = {
        youtube_video_id: youtubeVideoId,
        youtube_url: youtubeUrl,
        upstream_video_id: upstreamVideo?.id || null,
        source_video_id: sourceVideoId || upstreamVideo?.source_video_id || null,
        transcript_source: transcriptRunMetadata.transcriptSource,
        lane_used: transcriptRunMetadata.laneUsed,
        timing_validation: timingValidation,
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
          timing_confidence: roundToMillis(timingValidation.score / 100),
          transcript_segment_count: transcriptSegments.length,
          status: "analyzing",
        })
        .eq("id", runId);

      const transcriptOccurrencesPayload = await loadTranscriptOccurrencesPayload({
        supabaseService,
        upstreamVideoId: upstreamVideo?.id || null,
      });

      const upstreamCandidates = buildCandidatesFromUpstreamOccurrences({
        transcriptOccurrencesPayload,
        transcriptSegments,
        timingAuthority,
        sourceArtifactId: transcriptArtifact.id,
      });
      const regexCandidates = buildCandidatesFromTranscriptSegments({
        transcriptSegments,
        timingAuthority,
        sourceArtifactId: transcriptArtifact.id,
      });
      const allCandidates = dedupeCandidates([...upstreamCandidates, ...regexCandidates]);

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
            verse_ref: occurrence.verse_ref,
            normalized_verse_ref: occurrence.normalized_verse_ref,
            canonical_timestamp_sec: occurrence.canonical_timestamp_sec,
            occurrence_type: occurrence.occurrence_type,
            confidence: occurrence.confidence,
            timing_authority: occurrence.timing_authority,
            canonical_candidate_id: occurrence.canonical_candidate_id,
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
          timing_confidence: roundToMillis(timingValidation.score / 100),
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
