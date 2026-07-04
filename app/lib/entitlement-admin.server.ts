import type { SessionUser } from "~/lib/auth.server";

export type ManualEntitlementAction = "inspect" | "grant" | "revoke";

export type AdminEntitlementAuditAction = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  target_user_id: string;
  target_email: string | null;
  action: ManualEntitlementAction;
  status_before: string | null;
  status_after: string | null;
  previous_period_end: string | null;
  new_period_end: string | null;
  reason: string;
  metadata: Record<string, unknown>;
};

export type AdminEntitlementState = {
  entitlement: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  auditActions: AdminEntitlementAuditAction[];
  effective: {
    has_plus: boolean;
    status: string;
    provider: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  };
};

export type AdminEntitlementResponse = {
  ok: boolean;
  action: ManualEntitlementAction;
  targetUser: {
    id: string;
    email: string | null;
  };
  state: AdminEntitlementState;
};

export type ManageEntitlementInput = {
  action: ManualEntitlementAction;
  email: string;
  days?: number;
  reason?: string;
};

function getFunctionsUrl(): string {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL must be set");
  }
  return `${supabaseUrl}/functions/v1/admin-manage-subscription-entitlement`;
}

export async function manageSubscriptionEntitlement(
  user: SessionUser,
  input: ManageEntitlementInput
): Promise<AdminEntitlementResponse> {
  const response = await fetch(getFunctionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.accessToken}`,
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Entitlement request failed with status ${response.status}`
    );
  }

  return body as AdminEntitlementResponse;
}
