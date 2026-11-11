import { createClient } from "@/lib/supabase/server";
import { Stat, Empty, fmt, TYPE_LABEL } from "@/components/Shell";

type Metric = { metric: string; value: number; status: string; source: string };
type Deliverable = { id: string; inventory_tag: string | null; deliverable_type: string; title: string | null; ec_brand: string[] | null;
  start_date: string | null; status: string | null; metrics: Metric[] };

/** Campaign view for one client. Used by the client portal and by admins previewing a client.
 *  showAll=true (admin) includes numbers that aren't approved yet; clients never receive those rows from the database. */
export async function ClientView({ clientId, showAll }: { clientId: string; showAll: boolean }) {
  const supabase = await createClient();
  const [{ data: dels }, { count: leadCount }] = await Promise.all([
    supabase.from("deliverables")
      .select("id, inventory_tag, deliverable_type, title, ec_brand, start_date, status, metrics(metric, value, status, source)")
      .eq("client_id", clientId).order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId),
  ]);
  const rows = (dels ?? []) as Deliverable[];
  const visible = (m: Metric) => showAll || m.status === "approved";
  const total = (name: string) => rows.flatMap((d) => d.metrics).filter((m) => m.metric === name && m.status === "approved").reduce((s, m) => s + Number(m.value), 0);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter((d) => d.start_date && d.start_date > today).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Leads" value={fmt(leadCount ?? 0)} />
        <Stat label="Clicks" value={fmt(total("clicks"))} />
        <Stat label="Delivered" value={rows.length - upcoming} />
        <Stat label="Coming up" value={upcoming} />
      </div>
      <h2 className="mt-8 text-lg font-semibold">Timeline</h2>
      {rows.length === 0 ? <div className="mt-3"><Empty>Nothing here yet. Deliverables appear once the Notion sync has run.</Empty></div> : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">What ran</th>
                <th className="px-4 py-3 font-medium">Where</th><th className="px-4 py-3 font-medium">Results</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{d.start_date ?? "Unscheduled"}</td>
                  <td className="px-4 py-3"><span className="font-medium">{TYPE_LABEL[d.deliverable_type] ?? d.deliverable_type}</span>
                    {d.title && <span className="block text-ink/70">{d.title}</span>}
                    {showAll && <span className="block text-xs text-ink/50">{d.inventory_tag} · {d.status}</span>}</td>
                  <td className="px-4 py-3">{d.ec_brand?.join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    {d.metrics.filter(visible).length === 0 ? <span className="text-ink/50">{d.start_date && d.start_date > today ? "Scheduled" : "Pending"}</span> :
                      d.metrics.filter(visible).map((m, i) => (
                        <span key={i} className="mr-3 inline-block whitespace-nowrap">
                          <span className="tabular-nums font-medium">{fmt(m.value)}</span> {m.metric.replace(/_/g, " ")}
                          {showAll && m.status !== "approved" && <span className="ml-1 rounded bg-sun/60 px-1 text-xs">{m.status}</span>}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
