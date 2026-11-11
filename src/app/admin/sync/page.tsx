import { createClient } from "@/lib/supabase/server";
import { Empty } from "@/components/Shell";

export default async function SyncRuns() {
  const supabase = await createClient();
  const { data } = await supabase.from("sync_runs").select("id, source, started_at, finished_at, status, records_written, error").order("started_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  return (
    <>
      <h1 className="text-2xl font-semibold">Data pulls</h1>
      <p className="mt-1 text-sm text-ink/60">Every run of every source, newest first.</p>
      {rows.length === 0 ? <div className="mt-6"><Empty>No data pulls have run yet.</Empty></div> : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="px-4 py-3 font-medium">Source</th><th className="px-4 py-3 font-medium">Started (UTC)</th>
                <th className="px-4 py-3 font-medium">Result</th><th className="px-4 py-3 font-medium">Records</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{r.source}</td>
                  <td className="px-4 py-3 tabular-nums">{r.started_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3">{r.status === "error" ? <span className="text-red-700">Failed: {r.error}</span> : r.status === "success" ? "OK" : "Running"}</td>
                  <td className="px-4 py-3 tabular-nums">{r.records_written}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
