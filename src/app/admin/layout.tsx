import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/portal");
  const supabase = await createClient();
  const { count } = await supabase.from("metrics").select("id", { count: "exact", head: true }).in("status", ["pending", "flagged"]);
  // Main bar = the daily work, in the order it happens. Set-up screens live in the menu under the email (Chloe, Nov 12 2026).
  return (
    <Shell email={profile.email}
      nav={[{ href: "/admin", label: "Clients" }, { href: "/admin/enter", label: "Manual entry" }, { href: "/admin/approvals", label: "Approvals", badge: count ?? 0 }]}
      menu={[{ href: "/admin/leads", label: "Add leads" }, { href: "/admin/logins", label: "Logins" }, { href: "/admin/sync", label: "Data pulls" }]}>
      {children}
    </Shell>
  );
}
