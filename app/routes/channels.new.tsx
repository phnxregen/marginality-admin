import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
import Button from "~/components/Button";
import TextField from "~/components/TextField";

const DEFAULT_PARTNER_CHANNEL_ID = "157fc544-c063-4ceb-ba25-0bdcfcbfc900";

export const meta: MetaFunction = () => {
  return [{ title: "Create Channel | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const identifier = formData.get("identifier");
  const partnerChannelId = formData.get("partner_channel_id");

  if (typeof identifier !== "string" || !identifier.trim()) {
    return Response.json(
      { error: "YouTube channel identifier is required" },
      { status: 400 }
    );
  }

  if (typeof partnerChannelId !== "string" || !partnerChannelId.trim()) {
    return Response.json(
      { error: "partner_channel_id is required" },
      { status: 400 }
    );
  }

  try {
    // Call Edge Function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
    }

    const url = `${supabaseUrl}/functions/v1/create_channel_admin`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({
        identifier: identifier.trim(),
        partnerChannelId: partnerChannelId.trim(),
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText || "Request failed" }));
      const message =
        (typeof error.error === "string" && error.error) ||
        (typeof error.message === "string" && error.message) ||
        (typeof error.code === "string" && error.code) ||
        "Failed to create channel";
      const details =
        typeof error.details === "string" && error.details
          ? ` (${error.details})`
          : "";
      return Response.json(
        { error: `${message}${details}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const channelId =
      typeof data?.channel?.id === "string" ? data.channel.id : null;

    if (channelId) {
      return redirect(`/channels/${channelId}`);
    }

    return redirect("/channels");
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to create channel" },
      { status: 500 }
    );
  }
}

export default function ChannelsNew() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Create Channel</h1>
      
      <div className="p-4 bg-white rounded-lg shadow">
        <Form method="POST" className="space-y-4">
          <input
            type="hidden"
            name="partner_channel_id"
            value={DEFAULT_PARTNER_CHANNEL_ID}
          />

          {actionData?.error && (
            <p className="p-3 text-sm rounded-md bg-rose-50 text-rose-700">
              {actionData.error}
            </p>
          )}
          
          <div className="p-3 rounded-md bg-cyan-50">
            <p className="text-sm text-slate-700">
              Enter a YouTube channel identifier:
            </p>
            <ul className="mt-2 ml-4 text-sm text-slate-600 list-disc">
              <li>Channel ID (e.g., UC...)</li>
              <li>Handle (e.g., @channelname)</li>
              <li>Full URL (e.g., youtube.com/@channelname or youtube.com/channel/UC...)</li>
            </ul>
            <p className="mt-2 text-xs text-slate-600">
              Partner assignment: {DEFAULT_PARTNER_CHANNEL_ID}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              New channels start as invited/private demo channels.
            </p>
          </div>

          <TextField
            id="identifier"
            name="identifier"
            label="YouTube Channel Identifier"
            required
            placeholder="UC... or @channelname or youtube.com/..."
            autoFocus
          />

          <div className="flex gap-3">
            <Button type="submit" loading={isSubmitting}>
              Create Channel
            </Button>
            <a
              href="/channels"
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </a>
          </div>
        </Form>
      </div>
    </div>
  );
}
