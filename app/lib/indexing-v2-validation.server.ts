import type {
  CandidateSourceType,
  IndexingV2Candidate,
  ResolvedOccurrence,
  TimingAuthority,
  TranscriptSegment,
} from "~/lib/indexing-v2-resolver.server";

export type TimingValidationResult = {
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

export type ResolverValidationReport = {
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
    notes?: string[];
  }>;
};

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

export function validateTranscriptTiming(input: {
  transcriptSegments: TranscriptSegment[];
  videoDurationSec: number | null;
  transcriptText?: string | null;
}): TimingValidationResult {
  const segments = [...input.transcriptSegments].sort((left, right) => left.start_sec - right.start_sec);
  const transcriptText = normalizeWhitespace(
    input.transcriptText ?? segments.map((segment) => segment.text).join(" ")
  );
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
  if (coverageRatio < 0.35 && transcriptText.length > 0) {
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
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    status,
    syncEligible: status === "exact",
    score,
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
  {
    id: "low_quality_audio",
    youtubeVideoId: "UFsdJJiq6WI",
    anchors: [],
  },
  {
    id: "hard_extraction_test",
    youtubeVideoId: "b1kbLwvqugk",
    anchors: [],
  },
];

function findFixture(youtubeVideoId: string): ValidationFixture | null {
  return VALIDATION_FIXTURES.find((fixture) => fixture.youtubeVideoId === youtubeVideoId) || null;
}

function invariantResult(
  code: string,
  status: "pass" | "warning" | "fail",
  message: string
) {
  return { code, status, message };
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

export function buildIndexingV2ValidationReport(input: {
  runId: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  executionMode: string;
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
  invariantResults.push(
    invariantResult(
      "VERSE_PURITY",
      versePurityViolation ? "fail" : "pass",
      versePurityViolation
        ? `Occurrence ${versePurityViolation.occurrence_id} fused mixed verse refs.`
        : "Every occurrence preserves a single normalized verse ref."
    )
  );

  const lineageViolation = input.occurrences.find(
    (occurrence) => occurrence.fused_candidate_ids.length === 0
  );
  invariantResults.push(
    invariantResult(
      "CANDIDATE_LINEAGE",
      lineageViolation ? "fail" : "pass",
      lineageViolation
        ? `Occurrence ${lineageViolation.occurrence_id} is missing candidate lineage.`
        : "Every occurrence retains at least one fused candidate id."
    )
  );

  const timestampViolation = input.occurrences.find((occurrence) => {
    const candidateTimestamps = occurrence.fused_candidate_ids
      .map((candidateId) => candidatesById.get(candidateId)?.timestamp_sec)
      .filter((value): value is number => typeof value === "number");
    return !candidateTimestamps.includes(occurrence.canonical_timestamp_sec);
  });
  invariantResults.push(
    invariantResult(
      "CANONICAL_TIMESTAMP_LINEAGE",
      timestampViolation ? "fail" : "pass",
      timestampViolation
        ? `Occurrence ${timestampViolation.occurrence_id} has a canonical timestamp that is not backed by a fused candidate.`
        : "Every canonical timestamp is backed by at least one fused candidate."
    )
  );

  const spokenPriorityViolation = input.occurrences.find((occurrence) => {
    const sourceTypes = distinctSourceTypes(occurrence, candidatesById);
    return sourceTypes.has("spoken_explicit") && occurrence.occurrence_type !== "spoken_explicit";
  });
  invariantResults.push(
    invariantResult(
      "SPOKEN_PRIORITY",
      spokenPriorityViolation ? "fail" : "pass",
      spokenPriorityViolation
        ? `Occurrence ${spokenPriorityViolation.occurrence_id} ignored spoken evidence priority.`
        : "Spoken evidence wins when present in a fused context."
    )
  );

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
    const earliestSpoken = Math.min(...spokenCandidates.map((candidate) => candidate.timestamp_sec));
    return occurrence.canonical_timestamp_sec < earliestSpoken;
  });
  invariantResults.push(
    invariantResult(
      "OCR_SUPPORT_ONLY",
      ocrEarlierViolation ? "fail" : "pass",
      ocrEarlierViolation
        ? `Occurrence ${ocrEarlierViolation.occurrence_id} was pulled earlier than spoken evidence.`
        : "OCR support never moves a spoken occurrence earlier than the first spoken candidate."
    )
  );

  const confidenceViolation =
    input.candidates.find((candidate) => candidate.confidence < 0 || candidate.confidence > 1) ||
    input.occurrences.find((occurrence) => occurrence.confidence < 0 || occurrence.confidence > 1);
  invariantResults.push(
    invariantResult(
      "CONFIDENCE_RANGE",
      confidenceViolation ? "fail" : "pass",
      confidenceViolation
        ? "One or more confidence values fall outside 0.0 to 1.0."
        : "All confidence values are normalized to 0.0 through 1.0."
    )
  );

  const timingAuthorityViolation = input.occurrences.find(
    (occurrence) => occurrence.timing_authority !== input.timingAuthority
  );
  invariantResults.push(
    invariantResult(
      "TIMING_AUTHORITY_CONSISTENCY",
      timingAuthorityViolation ? "fail" : "pass",
      timingAuthorityViolation
        ? `Occurrence ${timingAuthorityViolation.occurrence_id} contradicts the run timing authority.`
        : "Occurrence timing authority matches the run timing basis."
    )
  );

  const missingSnippetCount = input.occurrences.filter((occurrence) => {
    const hasTranscriptEvidence = occurrence.fused_candidate_ids.some((candidateId) => {
      const candidate = candidatesById.get(candidateId);
      return candidate && candidate.source_type !== "ocr";
    });
    return hasTranscriptEvidence && !occurrence.snippet_text;
  }).length;
  invariantResults.push(
    invariantResult(
      "SNIPPET_REVIEWABILITY",
      missingSnippetCount > 0 ? "warning" : "pass",
      missingSnippetCount > 0
        ? `${missingSnippetCount} transcript-backed occurrences are missing snippets.`
        : "Transcript-backed occurrences include reviewable snippets."
    )
  );

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
          notes: anchor.notes || ["missing_occurrence"],
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
          anchor.expectedTimestampSec === null || deltaSec <= anchor.allowedDeltaSec ? "pass" : "fail",
        expected_timestamp_sec: anchor.expectedTimestampSec,
        actual_timestamp_sec: actualTimestampSec,
        allowed_delta_sec: anchor.allowedDeltaSec,
        actual_occurrence_id: matchingOccurrence.occurrence_id,
        notes:
          anchor.expectedTimestampSec === null || deltaSec <= anchor.allowedDeltaSec
            ? anchor.notes || []
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
        return distinctSourceTypes(occurrence, candidatesById).size === 1 &&
          distinctSourceTypes(occurrence, candidatesById).has("ocr");
      }).length,
      split_decision_count: input.splitDecisionCount,
      fusion_decision_count: input.fusionDecisionCount,
      discarded_low_confidence_candidate_count: input.discardedLowConfidenceCandidateCount,
    },
  };
}
