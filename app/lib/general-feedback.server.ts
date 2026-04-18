import { getServiceClient } from "~/lib/supabase.server";

export type GeneralFeedbackStatus = "open" | "triaged" | "resolved" | "dismissed";

export type GeneralFeedbackAttachment = {
  bucketId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  signedUrl: string | null;
};

export type GeneralFeedbackMessageRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: GeneralFeedbackStatus;
  source_surface: string;
  message: string;
  attachments: GeneralFeedbackAttachment[];
  reporter_user_id: string | null;
  reporter_email: string | null;
  reviewer_notes: string | null;
  resolved_at: string | null;
};

export type GeneralFeedbackCounts = Record<GeneralFeedbackStatus, number> & {
  total: number;
};

export type GeneralFeedbackFilters = {
  query?: string;
  status?: string;
  sourceSurface?: string;
};

export type GeneralFeedbackListResult = {
  messages: GeneralFeedbackMessageRow[];
  counts: GeneralFeedbackCounts;
  sourceSurfaces: string[];
  error?: string;
};

const FEEDBACK_SELECT =
  "id, created_at, updated_at, status, source_surface, message, attachments, " +
  "reporter_user_id, reporter_email, reviewer_notes, resolved_at";

const LEGACY_FEEDBACK_SELECT =
  "id, created_at, updated_at, status, source_surface, message, " +
  "reporter_user_id, reporter_email, reviewer_notes, resolved_at";

const STATUS_ORDER: Record<GeneralFeedbackStatus, number> = {
  open: 0,
  triaged: 1,
  resolved: 2,
  dismissed: 3,
};

function normalizeStatus(value: string | null | undefined): GeneralFeedbackStatus {
  switch (value) {
    case "triaged":
    case "resolved":
    case "dismissed":
      return value;
    default:
      return "open";
  }
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeSurface(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isMissingColumnError(message: string | undefined, columnName: string): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes(`column general_feedback_messages.${columnName} does not exist`) ||
    message.includes(`Could not find the '${columnName}' column`)
  );
}

function normalizeAttachment(value: unknown): Omit<GeneralFeedbackAttachment, "signedUrl"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const bucketId =
    typeof record.bucketId === "string" && record.bucketId.trim()
      ? record.bucketId.trim()
      : null;
  const storagePath =
    typeof record.storagePath === "string" && record.storagePath.trim()
      ? record.storagePath.trim()
      : null;
  const fileName =
    typeof record.fileName === "string" && record.fileName.trim()
      ? record.fileName.trim()
      : null;
  const contentType =
    typeof record.contentType === "string" && record.contentType.trim()
      ? record.contentType.trim()
      : null;
  const sizeBytesRaw = record.sizeBytes;
  const sizeBytes =
    typeof sizeBytesRaw === "number"
      ? Math.max(0, Math.floor(sizeBytesRaw))
      : typeof sizeBytesRaw === "string"
        ? Math.max(0, Number.parseInt(sizeBytesRaw, 10) || 0)
        : 0;

  if (!bucketId || !storagePath || !fileName || !contentType || sizeBytes <= 0) {
    return null;
  }

  return {
    bucketId,
    storagePath,
    fileName,
    contentType,
    sizeBytes,
  };
}

function extractAttachments(value: unknown): Array<Omit<GeneralFeedbackAttachment, "signedUrl">> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeAttachment)
    .filter((attachment): attachment is Omit<GeneralFeedbackAttachment, "signedUrl"> => {
      return attachment !== null;
    });
}

function matchesQuery(message: GeneralFeedbackMessageRow, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [
    message.message,
    message.reporter_email,
    message.reporter_user_id,
    message.source_surface,
    message.reviewer_notes,
    ...message.attachments.map((attachment) => attachment.fileName),
  ];

  return haystacks.some((value) => value?.toLowerCase().includes(query));
}

async function fetchFeedbackMessagesWithCompatibility() {
  const supabase = getServiceClient();

  const messagesResult = await supabase
    .from("general_feedback_messages")
    .select(FEEDBACK_SELECT)
    .order("created_at", { ascending: false })
    .limit(250);

  if (messagesResult.error && isMissingColumnError(messagesResult.error.message, "attachments")) {
    const legacyResult = await supabase
      .from("general_feedback_messages")
      .select(LEGACY_FEEDBACK_SELECT)
      .order("created_at", { ascending: false })
      .limit(250);

    if (legacyResult.error) {
      return legacyResult;
    }

    const upgradedRows = Array.isArray(legacyResult.data)
      ? legacyResult.data.map((row) => ({
          ...(row as unknown as Record<string, unknown>),
          attachments: [],
        }))
      : [];

    return {
      ...legacyResult,
      data: upgradedRows,
      error: null,
    };
  }

  return messagesResult;
}

export async function listGeneralFeedbackMessages(
  filters: GeneralFeedbackFilters = {}
): Promise<GeneralFeedbackListResult> {
  const supabase = getServiceClient();
  const counts: GeneralFeedbackCounts = {
    total: 0,
    open: 0,
    triaged: 0,
    resolved: 0,
    dismissed: 0,
  };

  const [messagesResult, totalCountResult, openCountResult, triagedCountResult, resolvedCountResult, dismissedCountResult] =
    await Promise.all([
      fetchFeedbackMessagesWithCompatibility(),
      supabase
        .from("general_feedback_messages")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("general_feedback_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("general_feedback_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "triaged"),
      supabase
        .from("general_feedback_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved"),
      supabase
        .from("general_feedback_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "dismissed"),
    ]);

  const countError =
    totalCountResult.error ||
    openCountResult.error ||
    triagedCountResult.error ||
    resolvedCountResult.error ||
    dismissedCountResult.error;

  if (countError) {
    return {
      messages: [],
      counts,
      sourceSurfaces: [],
      error: `Failed to load feedback counts: ${countError.message}`,
    };
  }

  counts.total = totalCountResult.count ?? 0;
  counts.open = openCountResult.count ?? 0;
  counts.triaged = triagedCountResult.count ?? 0;
  counts.resolved = resolvedCountResult.count ?? 0;
  counts.dismissed = dismissedCountResult.count ?? 0;

  if (messagesResult.error) {
    return {
      messages: [],
      counts,
      sourceSurfaces: [],
      error: `Failed to load feedback messages: ${messagesResult.error.message}`,
    };
  }

  const normalizedStatus = normalizeStatus(filters.status);
  const normalizedQuery = normalizeQuery(filters.query);
  const normalizedSurface = normalizeSurface(filters.sourceSurface);

  const rawMessages = Array.isArray(messagesResult.data)
    ? (messagesResult.data as unknown as GeneralFeedbackMessageRow[])
    : [];

  const sourceSurfaces = Array.from(
    new Set(
      rawMessages
        .map((message) => message.source_surface?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => left.localeCompare(right));

  const normalizedMessages = await Promise.all(
    rawMessages.map(async (message) => {
      const attachments = extractAttachments((message as unknown as Record<string, unknown>).attachments);
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (attachment) => {
          const { data, error } = await supabase.storage
            .from(attachment.bucketId)
            .createSignedUrl(attachment.storagePath, 60 * 60);

          return {
            ...attachment,
            signedUrl: error ? null : data.signedUrl,
          };
        })
      );

      return {
        ...message,
        status: normalizeStatus(message.status),
        attachments: attachmentsWithUrls,
      };
    })
  );

  const messages = normalizedMessages
    .filter((message) =>
      (filters.status ? message.status === normalizedStatus : true) &&
      (normalizedSurface ? message.source_surface.toLowerCase() === normalizedSurface : true) &&
      matchesQuery(message, normalizedQuery)
    )
    .sort((left, right) => {
      const leftOrder = STATUS_ORDER[left.status];
      const rightOrder = STATUS_ORDER[right.status];
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return right.created_at.localeCompare(left.created_at);
    });

  return { messages, counts, sourceSurfaces };
}
