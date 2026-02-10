import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form } from "@remix-run/react";
import { clearSession } from "~/lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const response = redirect("/login");
  return clearSession(response);
}

export default function Logout() {
  return (
    <Form method="POST">
      <button type="submit" className="text-sm underline text-cyan-600">
        Logout
      </button>
    </Form>
  );
}
