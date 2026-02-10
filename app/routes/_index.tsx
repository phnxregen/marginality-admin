import type { MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getSessionUser } from "~/lib/auth.server";

export async function loader({ request }: { request: Request }) {
  try {
    const user = await getSessionUser(request);
    return redirect(user ? "/overview" : "/login");
  } catch {
    return redirect("/login");
  }
}

export const meta: MetaFunction = () => {
  return [
    { title: "Marginality Admin" },
    { name: "description", content: "Marginality admin control center" },
  ];
};

export default function Index() {
  return null;
}
