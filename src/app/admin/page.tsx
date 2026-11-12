import { createClient } from "@/lib/supabase/server";
import { Stat, Empty } from "@/components/Shell";
import { CHANNELS } from "@/components/ClientView";
import { ClientList, type ClientRow } from "@/components/ClientList";

type D = { reported_with: string | null; client_id: string; campaign_id: string | null; notion_page_id: string | null; deliverable_type: string; start_date: string | null; metrics: { metric: string; status: string }[] };

/** Clients: the home screen. One row per client with what still needs doing (numbers to enter, numbers to approve). */
export default async function AdminHome() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: clients } = await supabase.from("clients").select("id, name, slug, is_active, customer_report_sheet_url, profiles(removed_at)").order("name");
  // Every placement, read in pages because the API returns 1,000 rows at a time.
  const all: D[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    const { data } = await supabase.from("deliverables").select("client_id, campaign_id, notion_page_id, deliverable_type, start_date, reported_with, metrics(metric, status)").order("id").range(from, from + 999);
    all.push(...((data ?? []) as unknown as D[]));
    if (!data || data.length < 1000) break;
  }
  // Same rules as Manual entry: only placements on a campaign count, and one "needs numbers" once it has run and a column is empty.
  const colsOf = (t: string) => CHANNELS.find((c) => c.types.includes(t))?.cols ?? [];
  const mine = all.filter((d) => (d.campaign_id || !d.notion_page_id) && colsOf(d.deliverable_type).length);
  const live = (d: D) => d.metrics.filter((m) => m.status !== "rejected");
  const missing = (d: D) => !d.reported_with && !!d.start_date && d.start_date <= today && d.deliverable_type !== "marketing_email" && colsOf(d.deliverable_type).some(([m]) => !live(d).some((x) => x.metric === m));
  const rows: ClientRow[] = (clients ?? []).map((c) => {
    const ds = mine.filter((d) => d.client_id === c.id);
    return { id: c.id, name: c.name, slug: c.slug, live: c.is_active, placements: ds.length, need: ds.filter(missing).length,
      approve: ds.reduce((n, d) => n + d.metrics.filter((m) => m.status === "pending" || m.status === "flagged").length, 0),
      logins: ((c.profiles ?? []) as { removed_at: string | null }[]).filter((p) => !p.removed_at).length, report: c.customer_report_sheet_url };
  });
  const sum = (k: "need" | "approve") => rows.reduce((n, r) => n + r[k], 0);
  return (
    <>
      <h1 className="text-3xl font-semibold">Clients</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Live clients" value={rows.filter((r) => r.live).length} />
        <Stat label="Placements" value={mine.length.toLocaleString("en-US")} />
        <Stat label="Missing results" value={sum("need").toLocaleString("en-US")} />
        <Stat label="Awaiting approval" value={sum("approve").toLocaleString("en-US")} />
      </div>
      {rows.length === 0 ? <div className="mt-6"><Empty>No clients yet.</Empty></div> : <ClientList rows={rows} />}
    </>
  );
}
