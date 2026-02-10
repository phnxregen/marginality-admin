import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { getSupabaseClient } from "~/lib/supabase.client";
import { getSessionUser } from "~/lib/auth.server";
import Button from "~/components/Button";
import TextField from "~/components/TextField";

export const meta: MetaFunction = () => {
  return [{ title: "Login | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getSessionUser(request);
  if (user) {
    return redirect("/channels");
  }
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const accessToken = formData.get("access_token");
  const refreshToken = formData.get("refresh_token");

  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    return Response.json(
      { error: "Authentication failed" },
      { status: 400 }
    );
  }

  // Verify token is valid
  const { getSupabaseClient } = await import("~/utils/getSupabaseClient");
  const supabase = getSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return Response.json(
      { error: "Invalid token" },
      { status: 401 }
    );
  }

  // Store tokens in session
  const { getSession, commitSession } = await import("~/session.server");
  const session = await getSession();
  session.set("access_token", accessToken);
  session.set("refresh_token", refreshToken);

  return redirect("/channels", {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}

function LoginForm() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";
  const [clientError, setClientError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setClientError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.session) {
        // POST tokens to server action
        const tokenFormData = new FormData();
        tokenFormData.set("access_token", data.session.access_token);
        tokenFormData.set("refresh_token", data.session.refresh_token);
        submit(tokenFormData, { method: "POST" });
      }
    } catch (error: any) {
      setClientError(error.message || "Login failed");
    }
  };

  return (
        <Form method="POST" onSubmit={handleSubmit}>
          {(actionData?.error || clientError) && (
        <p className="p-3 mb-4 text-sm rounded-md bg-rose-50 text-rose-700">
          {actionData?.error || clientError}
        </p>
      )}
      <fieldset
        className="w-full space-y-4 disabled:opacity-70"
        disabled={isSubmitting}
      >
        <TextField
          id="email"
          name="email"
          label="Email address"
          required
          type="email"
          placeholder="Email address"
        />
        <TextField
          id="password"
          name="password"
          label="Password"
          required
          type="password"
          placeholder="Password"
        />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Login
        </Button>
      </fieldset>
    </Form>
  );
}

export default function Login() {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md p-8 space-y-8 bg-white shadow-md rounded-xl">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
            Log In to Marginality Admin
          </h1>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
