import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Empty, TYPE_LABEL } from "@/components/Shell";
import { ApprovalCells } from "@/components/ApprovalRow";

type Row = { id: string; metric: string; value: number; source: string; status: string; flag_reason: string | null;
  clients: { name: string; slug: string } | null;
  deliverables: { deliverable_type: string; deliverable_label: string | null; display_title: string | null; start_date: string | null; inventory_tag: string | null;
    notion_page_id: string | null; live_url: string | null; short_link: string | null; ec_brand: string[] | null } | null };
const SOURCE: Record<string, string> = { beehiiv: "beehiiv", shortio: "short.io", zoom: "Zoom", tally: "Tally", manual: "typed in", legacy_sheet: "old report" };

/** Approvals: every number waiting, with a way to open the thing it measures, check it in Notion, correct it, and approve. */
export default async function Approvals({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name, slug").order("name");
  const current = (clients ?? []).find((c) => c.slug === sp.client);
  let query = supabase.from("metrics")
    .select("id, metric, value, source, status, flag_reason, clients(name, slug), deliverables(deliverable_type, deliverable_label, display_title, start_date, inventory_tag, notion_page_id, live_url, short_link, ec_brand)")
    .in("status", ["flagged", "pending"]).order("status").order("pulled_at", { ascending: false }).limit(300);
  if (current) query = query.eq("client_id", current.id);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  // Newsletter ads open the issue they ran in.
  const dates = [...new Set(rows.filter((r) => r.deliverables?.deliverable_type === "newsletter_ad" && r.deliverables.start_date).map((r) => r.deliverables!.start_date!))];
  const { data: issues } = dates.length ? await supabase.from("newsletter_issues").select("publication, issue_date, web_url").in("issue_date", dates) : { data: [] };
  const openLink = (d: NonNullable<Row["deliverables"]>) => d.deliverable_type === "newsletter_ad"
    ? (issues ?? []).find((i) => i.issue_date === d.start_date && i.publication === ((d.ec_brand ?? []).some((b) => /weekly/i.test(b)) ? "weekly" : "daily"))?.web_url ?? d.live_url
    : d.live_url;
  const a = "text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-navy";
  return (
    <>
      <h1 className="text-3xl font-semibold">Approvals</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Clients only see a number after it is approved here. Flagged numbers look unusual and need a second look. Open the placement to check it, use Edit to correct a number, then approve.</p>
      <form action="/admin/approvals" className="mt-4 flex flex-wrap items-center gap-2">
        <select name="client" defaultValue={sp.client ?? ""} aria-label="Client" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <option value="">All clients</option>
          {(clients ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <button className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark">Show</button>
        <span className="text-sm text-ink/60">{rows.length === 300 ? "Showing the first 300" : `${rows.length} waiting`}{current ? ` for ${current.name}` : ""}</span>
      </form>
      {rows.length === 0 ? <div className="mt-6"><Empty>Nothing waiting for review.</Empty></div> : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Placement</th>
                <th className="px-4 py-3 font-medium">Number</th><th className="px-4 py-3 font-medium">Why</th><th className="px-4 py-3 font-medium">Decision</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => { const d = r.deliverables; const link = d ? openLink(d) : null; return (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{r.clients ? <Link href={`/admin/clients/${r.clients.slug}`} className="hover:underline">{r.clients.name}</Link> : "—"}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{d?.deliverable_label || TYPE_LABEL[d?.deliverable_type ?? ""] || "—"}</span> · {d?.start_date ?? "no date"}
                    {d?.display_title && <span className="block text-ink/70">{d.display_title}</span>}
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                      {link ? <a href={link} target="_blank" rel="noreferrer" className={a}>{d?.deliverable_type === "newsletter_ad" ? "Open the issue" : "Open it"}</a> : <span className="text-ink/40">No link saved</span>}
                      {d?.short_link && <a href={`${d.short_link}+`} target="_blank" rel="noreferrer" className={a}>Short link</a>}
                      {d?.notion_page_id && <a href={`https://www.notion.so/${d.notion_page_id.replace(/-/g, "")}`} target="_blank" rel="noreferrer" className={a}>{d.inventory_tag ?? "Notion"}</a>}
                      {r.clients && <Link href={`/admin/enter?client=${r.clients.slug}&q=${encodeURIComponent(d?.inventory_tag ?? d?.start_date ?? "")}`} className={a}>Manual entry</Link>}
                    </span>
                  </td>
                  <ApprovalCells id={r.id} value={Number(r.value)} metric={r.metric.replace(/_/g, " ")} source={SOURCE[r.source] ?? r.source} flag={r.status === "flagged" ? r.flag_reason ?? "Flagged" : null} />
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
