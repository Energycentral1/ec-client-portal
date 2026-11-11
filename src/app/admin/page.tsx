import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Stat, Empty } from "@/components/Shell";

export default async function AdminHome() {
  const supabase = await createClient();
  const [{ data: clients }, { count: toReview }, { count: deliverables }] = await Promise.all([
    supabase.from("clients").select("id, name, slug, is_active, customer_report_sheet_url, deliverables(count), profiles(count)").order("name"),
    supabase.from("metrics").select("id", { count: "exact", head: true }).in("status", ["pending", "flagged"]),
    supabase.from("deliverables").select("id", { count: "exact", head: true }),
  ]);
  const rows = clients ?? [];
  const live = rows.filter((c) => c.is_active);
  return (
    <>
      <h1 className="text-2xl font-semibold">Clients</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Live clients" value={live.length} />
        <Stat label="All clients" value={rows.length} />
        <Stat label="Deliverables synced" value={deliverables ?? 0} />
        <Stat label="Numbers to review" value={toReview ?? 0} />
      </div>
      {rows.length === 0 ? <div className="mt-6"><Empty>No clients yet.</Empty></div> : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Deliverables</th><th className="px-4 py-3 font-medium">Logins</th><th className="px-4 py-3 font-medium">Old report</th></tr>
            </thead>
            <tbody>
              {[...live, ...rows.filter((c) => !c.is_active)].map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3"><Link href={`/admin/clients/${c.slug}`} className="font-medium text-navy hover:underline">{c.name}</Link></td>
                  <td className="px-4 py-3">{c.is_active ? <span className="rounded-full bg-sky/15 px-2 py-0.5 text-navy-dark">Live</span> : <span className="text-ink/50">Past</span>}</td>
                  <td className="px-4 py-3 tabular-nums">{(c.deliverables as { count: number }[])[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{(c.profiles as { count: number }[])[0]?.count ?? 0}</td>
                  <td className="px-4 py-3">{c.customer_report_sheet_url ? <a href={c.customer_report_sheet_url} target="_blank" rel="noreferrer" className="text-navy hover:underline">Open</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
