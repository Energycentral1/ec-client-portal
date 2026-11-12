import { createClient } from "@/lib/supabase/server";
import { Empty, fmt, TYPE_LABEL } from "@/components/Shell";
import { reviewMetric } from "./actions";

type Row = { id: string; metric: string; value: number; source: string; status: string; flag_reason: string | null;
  clients: { name: string } | null; deliverables: { deliverable_type: string; title: string | null; start_date: string | null } | null };

export default async function Approvals() {
  const supabase = await createClient();
  const { data } = await supabase.from("metrics")
    .select("id, metric, value, source, status, flag_reason, clients(name), deliverables(deliverable_type, title, start_date)")
    .in("status", ["flagged", "pending"]).order("status").order("pulled_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <h1 className="text-3xl font-semibold">Approvals</h1>
      <p className="mt-1 text-sm text-ink/60">Clients only see a number after it is approved here. Flagged numbers look unusual and need a second look.</p>
      {rows.length === 0 ? <div className="mt-6"><Empty>Nothing waiting for review.</Empty></div> : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Deliverable</th>
                <th className="px-4 py-3 font-medium">Number</th><th className="px-4 py-3 font-medium">Why</th><th className="px-4 py-3 font-medium">Decision</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{r.clients?.name}</td>
                  <td className="px-4 py-3">{TYPE_LABEL[r.deliverables?.deliverable_type ?? ""] ?? "—"} · {r.deliverables?.start_date ?? "no date"}
                    {r.deliverables?.title && <span className="block text-ink/70">{r.deliverables.title}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className="font-medium tabular-nums">{fmt(r.value)}</span> {r.metric.replace(/_/g, " ")}
                    <span className="block text-xs text-ink/50">from {r.source}</span></td>
                  <td className="px-4 py-3">{r.status === "flagged" ? <span className="rounded bg-sun/60 px-1.5 py-0.5">{r.flag_reason ?? "Flagged"}</span> : <span className="text-ink/50">New</span>}</td>
                  <td className="px-4 py-3">
                    <form action={reviewMetric} className="flex gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <button name="decision" value="approve" className="rounded-lg bg-navy px-3 py-2 font-medium text-white hover:bg-navy-dark">Approve</button>
                      <button name="decision" value="reject" className="rounded-lg border border-line px-3 py-2 hover:bg-mist">Reject</button>
                    </form>
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
