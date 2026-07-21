import type { User } from "@supabase/supabase-js";

import { getServiceClient } from "~/lib/supabase.server";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;
const QUERY_SCAN_PAGES = 20;
const ENTITLING_STATUSES = new Set(["active", "trialing", "grace_period"]);

type EntitlementRow = {
  user_id: string;
  status: string | null;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type SubscriptionRow = {
  user_id: string;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type UserActivityRow = {
  user_id: string;
  last_seen_at: string | null;
  last_platform: string | null;
  last_app_version: string | null;
  last_event: string | null;
};

export type AdminUserBillingSummary = {
  hasPlus: boolean;
  status: string;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type AdminUserActivitySummary = {
  lastSeenAt: string | null;
  platform: string | null;
  appVersion: string | null;
  event: string | null;
};

export type AdminUserListItem = {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  confirmedAt: string | null;
  activity: AdminUserActivitySummary;
  billing: AdminUserBillingSummary;
};

export type AdminUserListResult = {
  users: AdminUserListItem[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
  query: string;
  error: string | null;
};

export type ListAdminUsersInput = {
  page?: number;
  perPage?: number;
  query?: string;
};

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string") return "inactive";
  const trimmed = value.trim().toLowerCase();
  return trimmed || "inactive";
}

function periodHasEnded(value: string | null): boolean {
  if (!value) return false;
  const endTime = new Date(value).getTime();
  return Number.isFinite(endTime) && endTime <= Date.now();
}

function statusIsCurrentlyEntitling(
  status: string,
  currentPeriodEnd: string | null
): boolean {
  if (!ENTITLING_STATUSES.has(status)) return false;
  return !periodHasEnded(currentPeriodEnd);
}

function providerFor(
  entitlement: EntitlementRow | undefined,
  subscription: SubscriptionRow | undefined
): string {
  const entitlementProvider = entitlement?.provider?.trim();
  if (entitlementProvider) return entitlementProvider;
  if (subscription?.stripe_customer_id || subscription?.stripe_subscription_id) {
    return "stripe";
  }
  return "unknown";
}

function effectiveBillingState(
  entitlement: EntitlementRow | undefined,
  subscription: SubscriptionRow | undefined
): AdminUserBillingSummary {
  const status = normalizeStatus(
    entitlement?.status ?? subscription?.subscription_status
  );
  const currentPeriodEnd =
    entitlement?.current_period_end ?? subscription?.current_period_end ?? null;

  return {
    hasPlus: statusIsCurrentlyEntitling(status, currentPeriodEnd),
    status,
    provider: providerFor(entitlement, subscription),
    currentPeriodEnd,
    cancelAtPeriodEnd:
      entitlement?.cancel_at_period_end === true ||
      subscription?.cancel_at_period_end === true,
  };
}

function newestByUserId<T extends { user_id: string; updated_at: string | null; created_at: string | null }>(
  rows: T[] | null
): Map<string, T> {
  const result = new Map<string, T>();

  for (const row of rows ?? []) {
    const existing = result.get(row.user_id);
    if (!existing) {
      result.set(row.user_id, row);
      continue;
    }

    const rowTime = new Date(row.updated_at ?? row.created_at ?? 0).getTime();
    const existingTime = new Date(
      existing.updated_at ?? existing.created_at ?? 0
    ).getTime();
    if (rowTime > existingTime) {
      result.set(row.user_id, row);
    }
  }

  return result;
}

function userMatchesQuery(user: User, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return (
    user.id.toLowerCase().includes(normalized) ||
    (user.email?.toLowerCase().includes(normalized) ?? false)
  );
}

function isMissingUserActivityTableError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("user_activity") && message.includes("not found") ||
    message.includes("relation \"public.user_activity\" does not exist")
  );
}

async function listAuthUsersPage(
  page: number,
  perPage: number,
  query: string
): Promise<{ users: User[]; hasNextPage: boolean }> {
  const supabase = getServiceClient();

  if (!query) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    return {
      users: data.users,
      hasNextPage: data.users.length === perPage,
    };
  }

  const matches: User[] = [];
  let scannedPage = 1;
  let exhausted = false;

  while (
    matches.length < page * perPage &&
    scannedPage <= QUERY_SCAN_PAGES &&
    !exhausted
  ) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: scannedPage,
      perPage: MAX_PER_PAGE,
    });
    if (error) throw error;

    matches.push(...data.users.filter((user) => userMatchesQuery(user, query)));
    exhausted = data.users.length < MAX_PER_PAGE;
    scannedPage += 1;
  }

  const start = (page - 1) * perPage;
  const pageUsers = matches.slice(start, start + perPage);

  return {
    users: pageUsers,
    hasNextPage:
      matches.length > start + perPage ||
      (!exhausted && scannedPage <= QUERY_SCAN_PAGES),
  };
}

async function loadBillingRows(userIds: string[]): Promise<{
  entitlements: Map<string, EntitlementRow>;
  subscriptions: Map<string, SubscriptionRow>;
  error: string | null;
}> {
  if (userIds.length === 0) {
    return {
      entitlements: new Map(),
      subscriptions: new Map(),
      error: null,
    };
  }

  const supabase = getServiceClient();
  const [entitlementResult, subscriptionResult] = await Promise.all([
    supabase
      .from("account_entitlements")
      .select(
        "user_id, status, provider, current_period_end, cancel_at_period_end, created_at, updated_at"
      )
      .eq("entitlement_type", "marginality_plus")
      .in("user_id", userIds),
    supabase
      .from("subscriptions")
      .select(
        "user_id, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at, updated_at"
      )
      .in("user_id", userIds),
  ]);

  const errors = [entitlementResult.error, subscriptionResult.error]
    .filter(Boolean)
    .map((error) => error?.message)
    .join("; ");

  return {
    entitlements: newestByUserId(
      (entitlementResult.data ?? []) as EntitlementRow[]
    ),
    subscriptions: newestByUserId(
      (subscriptionResult.data ?? []) as SubscriptionRow[]
    ),
    error: errors || null,
  };
}

async function loadActivityRows(userIds: string[]): Promise<{
  activities: Map<string, UserActivityRow>;
  error: string | null;
}> {
  if (userIds.length === 0) {
    return {
      activities: new Map(),
      error: null,
    };
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("user_activity")
    .select("user_id, last_seen_at, last_platform, last_app_version, last_event")
    .in("user_id", userIds);

  return {
    activities: new Map(
      ((data ?? []) as UserActivityRow[]).map((row) => [row.user_id, row])
    ),
    error: isMissingUserActivityTableError(error) ? null : error?.message ?? null,
  };
}

export async function listAdminUsers({
  page: pageInput,
  perPage: perPageInput,
  query: queryInput,
}: ListAdminUsersInput = {}): Promise<AdminUserListResult> {
  const page = normalizePositiveInteger(pageInput, 1, Number.MAX_SAFE_INTEGER);
  const perPage = normalizePositiveInteger(
    perPageInput,
    DEFAULT_PER_PAGE,
    MAX_PER_PAGE
  );
  const query = queryInput?.trim() ?? "";

  try {
    const { users, hasNextPage } = await listAuthUsersPage(page, perPage, query);
    const userIds = users.map((user) => user.id);
    const [billingRows, activityRows] = await Promise.all([
      loadBillingRows(userIds),
      loadActivityRows(userIds),
    ]);
    const dataErrors = [billingRows.error, activityRows.error]
      .filter(Boolean)
      .join("; ");

    return {
      users: users.map((user) => {
        const entitlement = billingRows.entitlements.get(user.id);
        const subscription = billingRows.subscriptions.get(user.id);
        const activity = activityRows.activities.get(user.id);
        return {
          id: user.id,
          email: user.email ?? null,
          createdAt: user.created_at ?? null,
          lastSignInAt: user.last_sign_in_at ?? null,
          confirmedAt: user.confirmed_at ?? user.email_confirmed_at ?? null,
          activity: {
            lastSeenAt: activity?.last_seen_at ?? null,
            platform: activity?.last_platform ?? null,
            appVersion: activity?.last_app_version ?? null,
            event: activity?.last_event ?? null,
          },
          billing: effectiveBillingState(entitlement, subscription),
        };
      }),
      page,
      perPage,
      hasNextPage,
      query,
      error: dataErrors || null,
    };
  } catch (error) {
    return {
      users: [],
      page,
      perPage,
      hasNextPage: false,
      query,
      error: error instanceof Error ? error.message : "Failed to load users",
    };
  }
}
