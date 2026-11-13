import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/portal");
  const supabase = await createClient();
  const { count } = await supabase.from("metrics").select("id", { count: "exact", head: true }).in("status", ["pending", "flagged"]);
  // Creative a client sent back with changes: the one thing that is easy to miss, so it gets a badge.
  const { count: changes } = await supabase.from("proofs").select("id", { count: "exact", head: true }).eq("status", "changes_requested");
  // Main bar (Chloe, Nov 13 2026): Home, Clients, Results (to approve + add or edit, as two tabs on one screen), Creative. Set-up screens live in the menu under the email (Chloe, Nov 12 2026).
  return (
    <Shell email={profile.email}
      nav={[{ href: "/admin", label: "Home" }, { href: "/admin/clients", label: "Clients" }, { href: "/admin/approvals", label: "Results", badge: count ?? 0 }, { href: "/admin/creative", label: "Creative", badge: changes ?? 0 }]}
      menu={[{ href: "/admin/leads", label: "Add leads" }, { href: "/admin/logins", label: "Logins" }, { href: "/admin/sync", label: "Data pulls" }, { href: "/admin/backup", label: "Backups" }]}>
      {children}
    </Shell>
  );
}
