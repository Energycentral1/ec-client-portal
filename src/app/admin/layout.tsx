import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/portal");
  return (
    <Shell title="Back-end" email={profile.email}
      nav={[{ href: "/admin", label: "Clients" }, { href: "/admin/enter", label: "Manual entry" }, { href: "/admin/approvals", label: "Approvals" }, { href: "/admin/sync", label: "Data pulls" }, { href: "/admin/logins", label: "Logins" }]}>
      {children}
    </Shell>
  );
}
