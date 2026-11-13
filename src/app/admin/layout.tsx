import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/portal");
  const supabase = await createClient();
  const { count } = await supabase.from("metrics").select("id", { count: "exact", head: true }).in("status", ["pending", "flagged"]);
  // Main bar = the daily work: Home (what needs you, then every client), numbers to approve, creative to send, numbers to type in (Chloe, Nov 13 2026). Set-up screens live in the menu under the email (Chloe, Nov 12 2026).
  return (
    <Shell email={profile.email}
      nav={[{ href: "/admin", label: "Home" }, { href: "/admin/approvals", label: "Approvals", badge: count ?? 0 }, { href: "/admin/creative", label: "Creative approvals" }, { href: "/admin/enter", label: "Manual entry" }]}
      menu={[{ href: "/admin/leads", label: "Add leads" }, { href: "/admin/logins", label: "Logins" }, { href: "/admin/sync", label: "Data pulls" }]}>
      {children}
    </Shell>
  );
}
