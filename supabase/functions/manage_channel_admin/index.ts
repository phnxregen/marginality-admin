import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAdmin } from "../_shared/admin_auth.ts";

type ManageAction =
  | "set_lifecycle_status"
  | "assign_user"
  | "unassign_user";

type ManageChannelRequest = {
  action: ManageAction;
  externalChannelId?: string;
  lifecycleStatus?: "invited" | "official";
  userEmail?: string;
  userId?: string;
  role?: "owner" | "editor" | "viewer";
};

type SupabaseServiceClient = Awaited<
  ReturnType<typeof verifyAdmin>
>["supabaseService"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function findUserByEmail(
  supabaseService: SupabaseServiceClient,
  email: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const users = data?.users || [];
    const match = users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );
    if (match) {
      return match;
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}

serve(async (req) => {
  try {
    const { user, supabaseService } = await verifyAdmin(req);

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body: ManageChannelRequest = await req.json();
    const { action, externalChannelId } = body;

    if (!action) {
      return jsonResponse({ error: "action is required" }, 400);
    }

    if (!externalChannelId || typeof externalChannelId !== "string") {
      return jsonResponse({ error: "externalChannelId is required" }, 400);
    }

    if (action === "set_lifecycle_status") {
      const lifecycleStatus = body.lifecycleStatus;
      if (lifecycleStatus !== "invited" && lifecycleStatus !== "official") {
        return jsonResponse(
          { error: "lifecycleStatus must be invited or official" },
          400
        );
      }

      const updatePayload: Record<string, string | null> = {
        channel_lifecycle_status: lifecycleStatus,
        officialized_at:
          lifecycleStatus === "official" ? new Date().toISOString() : null,
      };

      const { data: channel, error: updateError } = await supabaseService
        .from("external_channels")
        .update(updatePayload)
        .eq("id", externalChannelId)
        .select("id, channel_lifecycle_status, officialized_at")
        .single();

      if (updateError || !channel) {
        return jsonResponse(
          {
            error: "Failed to update channel lifecycle status",
            details: updateError?.message || "Channel not found",
          },
          500
        );
      }

      return jsonResponse({ channel });
    }

    if (action === "assign_user") {
      const userEmail = body.userEmail;
      const role = body.role || "viewer";

      if (
        typeof userEmail !== "string" ||
        userEmail.trim().length === 0 ||
        !userEmail.includes("@")
      ) {
        return jsonResponse({ error: "A valid userEmail is required" }, 400);
      }

      if (!["owner", "editor", "viewer"].includes(role)) {
        return jsonResponse(
          { error: "role must be owner, editor, or viewer" },
          400
        );
      }

      const matchedUser = await findUserByEmail(supabaseService, userEmail);
      if (!matchedUser?.id) {
        return jsonResponse(
          {
            error: `No auth user found for email: ${userEmail.trim().toLowerCase()}`,
          },
          404
        );
      }

      const { data: assignment, error: assignmentError } = await supabaseService
        .from("channel_assignments")
        .upsert(
          {
            external_channel_id: externalChannelId,
            user_id: matchedUser.id,
            user_email: matchedUser.email || userEmail.trim().toLowerCase(),
            role,
            assigned_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "external_channel_id,user_id" }
        )
        .select("id, external_channel_id, user_id, user_email, role, created_at")
        .single();

      if (assignmentError || !assignment) {
        return jsonResponse(
          {
            error: "Failed to assign channel user",
            details: assignmentError?.message || "Unknown assignment error",
          },
          500
        );
      }

      return jsonResponse({ assignment });
    }

    if (action === "unassign_user") {
      const userId = body.userId;
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return jsonResponse({ error: "userId is required" }, 400);
      }

      const { error: deleteError } = await supabaseService
        .from("channel_assignments")
        .delete()
        .eq("external_channel_id", externalChannelId)
        .eq("user_id", userId);

      if (deleteError) {
        return jsonResponse(
          {
            error: "Failed to unassign channel user",
            details: deleteError.message,
          },
          500
        );
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not an admin")
      ? 403
      : message.includes("Invalid")
        ? 401
        : 500;

    return jsonResponse({ error: message }, status);
  }
});
