import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { requireAdmin } from "~/lib/admin.server";
import AdminShell from "~/components/AdminShell";

export const meta: MetaFunction = () => {
  return [{ title: "Channels | Marginality Admin" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}

export default function ChannelsLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
