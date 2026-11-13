import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Empty } from "@/components/Shell";
import { ProofForm } from "@/components/ProofForm";

type P = { id: string; client_id: string; deliverable_id: string | null; name: string; status: "awaiting_review" | "changes_requested" | "approved"; due_date: string | null;
  created_at: string; feedback: string | null; reviewed_by_email: string | null; reviewed_at: string | null };
type Pl = { id: string; campaign_id: string | null; notion_page_id: string | null; start_date: string | null; status: string | null; display_title: string | null; deliverable_label: string | null; inventory_tag: string | null };
const OPEN_STATUSES = ["not started", "awaiting assets", "ready for production", "production in progress", "scheduled", "on hold"];
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string | null) => (d ? DAY.format(new Date(d.length === 10 ? d + "T00:00:00Z" : d)) : "No date");
const LABEL = { awaiting_review: ["Waiting on the client", "bg-mist text-ink/70"], changes_requested: ["Changes requested", "bg-ember/15 text-[#a13a12]"], approved: ["Approved", "bg-emerald-100 text-emerald-800"] } as const;

/** Creative approvals for the team (Chloe, Nov 13 2026: "where I can submit creatives for client approval"): pick a client,
 *  send the creative, and see everything that is out, came back with changes, or was approved. */
export default async function Creative({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: clients } = await supabase.from("clients").select("id, name, slug, is_active").order("name");
  const current = (clients ?? []).find((c) => c.slug === sp.client);
  const byId = new Map((clients ?? []).map((c) => [c.id, c]));
  const { data: proofRows } = await supabase.from("proofs").select("id, client_id, deliverable_id, name, status, due_date, created_at, feedback, reviewed_by_email, reviewed_at").order("created_at", { ascending: false }).limit(400);
  // Only the latest version for a placement is listed.
  const seen = new Set<string>();
  const proofs = ((proofRows ?? []) as P[]).filter((p) => { if (!p.deliverable_id) return true; if (seen.has(p.deliverable_id)) return false; seen.add(p.deliverable_id); return true; });
  const order = { changes_requested: 0, awaiting_review: 1, approved: 2 };
  const listed = proofs.filter((p) => !current || p.client_id === current.id).sort((a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at));
  let placements: { id: string; label: string }[] = [];
  if (current) {
    const { data } = await supabase.from("deliverables").select("id, campaign_id, notion_page_id, start_date, status, display_title, deliverable_label, inventory_tag")
      .eq("client_id", current.id).order("start_date", { ascending: true, nullsFirst: false });
    placements = ((data ?? []) as Pl[]).filter((d) => (d.campaign_id || !d.notion_page_id) && OPEN_STATUSES.includes((d.status ?? "").toLowerCase()))
      .map((d) => ({ id: d.id, label: `${day(d.start_date)}: ${d.display_title || d.deliverable_label || "Placement"}${d.inventory_tag ? ` (${d.inventory_tag})` : ""}` }));
  }
  const count = (s: P["status"]) => listed.filter((p) => p.status === s).length;
  return (
    <>
      <h1 className="text-3xl font-semibold">Creative approvals</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Send a client the ad as it will run. It goes to the top of their page, where they approve it or ask for changes.</p>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">1. Who is it for?</h2>
        <form action="/admin/creative" className="mt-3 flex flex-wrap items-center gap-2">
          <select name="client" defaultValue={sp.client ?? ""} aria-label="Client" className="min-w-56 rounded-lg border border-line bg-white px-3 py-2 text-sm">
            <option value="">Choose a client</option>
            {(clients ?? []).filter((c) => c.is_active).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            <optgroup label="Past clients">{(clients ?? []).filter((c) => !c.is_active).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</optgroup>
          </select>
          <button className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark">{current ? "Change client" : "Continue"}</button>
          {current && <Link href="/admin/creative" className="text-sm text-navy hover:underline">Show every client</Link>}
        </form>
      </section>

      {current && (
        <section className="mt-4">
          <h2 className="sr-only">2. The creative for {current.name}</h2>
          <ProofForm clientId={current.id} placements={placements} />
          {placements.length === 0 && <p className="mt-2 text-sm text-ink/60">{current.name} has no open inventory in Notion, so this creative can&apos;t be tied to an inventory item. You can still send it.</p>}
        </section>
      )}

      <h2 className="mt-10 font-display text-2xl">{current ? `${current.name}: sent so far` : "Everything sent"}</h2>
      {listed.length > 0 && <p className="mt-1 text-sm text-ink/60">{count("changes_requested")} came back with changes · {count("awaiting_review")} waiting on the client · {count("approved")} approved</p>}
      {listed.length === 0 ? <div className="mt-4"><Empty>{current ? `Nothing has been sent to ${current.name} yet.` : "No creative has been sent to a client yet. Choose a client above to send the first one."}</Empty></div> : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr>{["Client", "Creative", "Status", "Sent", "Approve by", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {listed.map((p) => { const c = byId.get(p.client_id); return (
                <tr key={p.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{c?.name ?? "—"}</td>
                  <td className="px-4 py-3">{p.name}
                    {p.status === "changes_requested" && p.feedback && <span className="mt-1 block max-w-md border-l-2 border-ember/50 pl-2 text-ink/80">{p.feedback}</span>}
                    {p.status === "approved" && p.reviewed_by_email && <span className="block text-xs text-ink/50">by {p.reviewed_by_email}{p.reviewed_at ? `, ${day(p.reviewed_at)}` : ""}</span>}</td>
                  <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${LABEL[p.status][1]}`}>{LABEL[p.status][0]}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink/70">{day(p.created_at)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 ${p.status === "awaiting_review" && p.due_date && p.due_date < today ? "font-medium text-[#a13a12]" : "text-ink/70"}`}>{p.due_date ? day(p.due_date) : "—"}</td>
                  <td className="px-4 py-3 text-right">{c && <Link href={`/admin/clients/${c.slug}#approvals`} className="whitespace-nowrap text-navy hover:underline">{p.status === "changes_requested" ? "Open and send a new version" : "Open"}</Link>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
