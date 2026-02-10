import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { requireUser } from "~/lib/auth.server";
import AdminShell from "~/components/AdminShell";

export const meta: MetaFunction = () => {
  return [{ title: "Channels | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return null;
}

export default function ChannelsLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
