export type TimingAuthority =
  | "whisperx_aligned"
  | "original_transcript"
  | "approximate_proxy"
  | "unavailable";

export type CandidateSourceType = "spoken_explicit" | "allusion" | "ocr";

export type ResolverStatus = "accepted" | "rejected";

export type TranscriptSegment = {
  segment_id: string;
  start_sec: number;
  end_sec: number;
  text: string;
};

export type Span = {
  start_sec: number;
  end_sec: number;
  segment_ids?: string[];
  detection_ids?: string[];
};

export type IndexingV2Candidate = {
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
    normalization_method: "deterministic" | "gemini" | "upstream_bootstrap";
    ambiguity_reason: string | null;
    [key: string]: unknown;
  };
};

export type CandidateDecision = {
  candidate_id: string;
  status: ResolverStatus;
  reason: string | null;
};

export type ResolvedOccurrence = {
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

export type ResolveIndexingV2Input = {
  candidates: IndexingV2Candidate[];
  transcriptSegments: TranscriptSegment[];
  timingAuthority: TimingAuthority;
  snippetSourceArtifactId?: string | null;
  createOccurrenceId?: () => string;
};

export type ResolveIndexingV2Result = {
  occurrences: ResolvedOccurrence[];
  candidateDecisions: CandidateDecision[];
  discardedLowConfidenceCandidateCount: number;
  fusionDecisionCount: number;
  splitDecisionCount: number;
};

const CONTEXT_WINDOW_SEC = 12;
const SNIPPET_SEARCH_WINDOW_BEFORE_SEC = 10;
const SNIPPET_SEARCH_WINDOW_AFTER_SEC = 18;
const SNIPPET_MAX_CHARS = 240;
const SNIPPET_MAX_SEGMENTS = 2;

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function asNonEmptyText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function isValidNormalizedVerseRef(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^[1-3]?\s?[A-Za-z][A-Za-z ]+\s+\d+:\d+(?:-\d+)?$/.test(value.trim());
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
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
  return (
    sorted.find((candidate) => candidate.source_type === prioritizedType) ??
    sorted[0] ??
    null
  );
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

  const trimmed = text.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd();
  return `${trimmed}…`;
}

function buildSnippet(input: {
  canonicalTimestampSec: number;
  candidates: IndexingV2Candidate[];
  transcriptSegments: TranscriptSegment[];
  snippetSourceArtifactId?: string | null;
}) {
  const { canonicalTimestampSec, candidates, transcriptSegments, snippetSourceArtifactId } = input;
  const supportingSegmentIds = uniqueStrings(
    candidates.flatMap((candidate) => [
      ...(candidate.transcript_span?.segment_ids || []),
      ...(candidate.evidence_payload.supporting_segment_ids || []),
    ])
  );
  const preferredSegments = transcriptSegments.filter((segment) =>
    supportingSegmentIds.includes(segment.segment_id)
  );
  const searchStart = canonicalTimestampSec - SNIPPET_SEARCH_WINDOW_BEFORE_SEC;
  const searchEnd = canonicalTimestampSec + SNIPPET_SEARCH_WINDOW_AFTER_SEC;
  const inWindow = transcriptSegments.filter(
    (segment) => segment.end_sec >= searchStart && segment.start_sec <= searchEnd
  );

  const containingSegment =
    preferredSegments.find(
      (segment) => segment.start_sec <= canonicalTimestampSec && segment.end_sec >= canonicalTimestampSec
    ) ??
    inWindow.find(
      (segment) => segment.start_sec <= canonicalTimestampSec && segment.end_sec >= canonicalTimestampSec
    ) ??
    preferredSegments[0] ??
    inWindow[0] ??
    null;

  if (!containingSegment) {
    return {
      snippet_text: null,
      snippet_start_sec: null,
      snippet_end_sec: null,
      snippet_source_artifact_id: snippetSourceArtifactId || null,
      snippet_source_segment_ids: [] as string[],
    };
  }

  const containingIndex = transcriptSegments.findIndex(
    (segment) => segment.segment_id === containingSegment.segment_id
  );
  const pickedSegments = [containingSegment];
  if (pickedSegments.length < SNIPPET_MAX_SEGMENTS) {
    const nextSegment = transcriptSegments[containingIndex + 1];
    if (nextSegment && nextSegment.start_sec <= searchEnd) {
      pickedSegments.push(nextSegment);
    }
  }

  const snippetText = asNonEmptyText(
    pickedSegments.map((segment) => segment.text).join(" ")
  );

  return {
    snippet_text: snippetText ? trimSnippet(snippetText) : null,
    snippet_start_sec: roundToMillis(pickedSegments[0].start_sec),
    snippet_end_sec: roundToMillis(pickedSegments[pickedSegments.length - 1].end_sec),
    snippet_source_artifact_id: snippetSourceArtifactId || null,
    snippet_source_segment_ids: pickedSegments.map((segment) => segment.segment_id),
  };
}

export function resolveIndexingV2Occurrences(
  input: ResolveIndexingV2Input
): ResolveIndexingV2Result {
  const occurrenceIdFactory =
    input.createOccurrenceId ?? (() => crypto.randomUUID());
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
      for (const candidate of context) {
        candidateDecisions.set(candidate.candidate_id, {
          candidate_id: candidate.candidate_id,
          status: "accepted",
          reason: null,
        });
      }

      if (context.length > 1) {
        fusionDecisionCount += 1;
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
        occurrence_id: occurrenceIdFactory(),
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
    fusionDecisionCount,
    splitDecisionCount,
  };
}
