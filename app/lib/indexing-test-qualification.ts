type SupportedRunStatus = "queued" | "processing" | "complete" | "failed";

export type IndexingTestRunAssessmentInput = {
  created_at: string;
  updated_at: string;
  status: SupportedRunStatus;
  indexing_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  transcript_count: number;
  ocr_count: number;
  transcript_source: string | null;
  lane_used: string | null;
};

export type IndexingTestRunAssessment = {
  state: "qualifying" | "non_qualifying" | "processing" | "stale_processing" | "failed";
  label: string;
  summary: string;
  reasons: string[];
  isQualifying: boolean;
  canCreateFixture: boolean;
};

const STALE_PROCESSING_MINUTES = 30;

function formatElapsedDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function assessIndexingTestRun(
  run: IndexingTestRunAssessmentInput,
  now = Date.now()
): IndexingTestRunAssessment {
  if (run.status === "failed") {
    return {
      state: "failed",
      label: "Failed",
      summary: run.error_code || run.error_message || "Run failed before producing qualifying outputs.",
      reasons: [run.error_message || "Run failed."],
      isQualifying: false,
      canCreateFixture: false,
    };
  }

  if (run.status === "processing") {
    const updatedAtMs = Date.parse(run.updated_at || run.created_at);
    const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : 0;
    if (ageMs >= STALE_PROCESSING_MINUTES * 60_000) {
      return {
        state: "stale_processing",
        label: "Likely stale",
        summary: `Still processing after ${formatElapsedDuration(ageMs)}.`,
        reasons: [
          `Run has remained in processing longer than ${STALE_PROCESSING_MINUTES} minutes.`,
        ],
        isQualifying: false,
        canCreateFixture: false,
      };
    }

    return {
      state: "processing",
      label: "Processing",
      summary: "Waiting for upstream indexing to finish.",
      reasons: [],
      isQualifying: false,
      canCreateFixture: false,
    };
  }

  if (run.status !== "complete") {
    return {
      state: "non_qualifying",
      label: "Non-qualifying",
      summary: `Run status is ${run.status}.`,
      reasons: [`Run is not complete.`],
      isQualifying: false,
      canCreateFixture: false,
    };
  }

  const reasons: string[] = [];
  if (!run.indexing_run_id) {
    reasons.push("Missing indexing run ID.");
  }
  if (run.transcript_count > 0 && !run.transcript_source) {
    reasons.push("Missing transcript source metadata.");
  }
  if (run.transcript_count > 0 && !run.lane_used) {
    reasons.push("Missing lane metadata for transcript output.");
  }

  if (reasons.length > 0) {
    return {
      state: "non_qualifying",
      label: "Non-qualifying",
      summary: reasons[0],
      reasons,
      isQualifying: false,
      canCreateFixture: false,
    };
  }

  return {
    state: "qualifying",
    label: "Qualifying",
    summary: "Run completed with terminal indexing metadata.",
    reasons: [],
    isQualifying: true,
    canCreateFixture: true,
  };
}
