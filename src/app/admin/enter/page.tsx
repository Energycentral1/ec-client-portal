import Link from "next/link";
import { ClientTabs } from "@/components/ClientTabs";
import { ResultsTabs } from "@/components/ResultsTabs";
import { createClient } from "@/lib/supabase/server";
import { Empty, TYPE_LABEL } from "@/components/Shell";
import { CHANNELS } from "@/components/ClientView";
import { InventoryRow } from "@/components/EnterNumbersRow";

/** Manual entry (Chloe, Nov 12 2026): anyone on the team can fill in or correct any piece of inventory. Laid out like the
 *  client page (one table per channel, same columns) with Notion's row details (EC number linked to the Notion row, status),
 *  so it reads the same as the two places the team already knows. Start: a list of clients with what still needs numbers. */
type Row = { id: string; client_id: string; campaign_id: string | null; notion_page_id: string | null; deliverable_type: string; deliverable_label: string | null; title: string | null;
  display_title: string | null; live_url: string | null; status: string | null; inventory_tag: string | null; start_date: string | null; reported_with?: string | null;
  metrics: { metric: string; value: number; source: string; status: string }[] };

const SOURCE: Record<string, string> = { beehiiv: "beehiiv", shortio: "short.io", zoom: "Zoom", tally: "Tally", manual: "typed in", legacy_sheet: "old report", bettermode: "Bettermode", youtube: "YouTube", flightcast: "Flightcast", linkedin: "LinkedIn" };

export default async function ManualEntry({ searchParams }: { searchParams: Promise<{ client?: string; q?: string; show?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const q = (sp.q ?? "").trim().toLowerCase();
  const { data: clientRows } = await supabase.from("clients").select("id, name, slug, is_active").order("name");
  const clients = clientRows ?? [];
  const current = clients.find((c) => c.slug === sp.client);
  // Every placement on a campaign (what the client can see), read in pages because the API returns 1,000 rows at a time.
  const all: Row[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    let query = supabase.from("deliverables")
      .select("id, client_id, campaign_id, notion_page_id, deliverable_type, deliverable_label, title, display_title, live_url, status, inventory_tag, start_date, reported_with, metrics(metric, value, source, status)")
      .order("start_date", { ascending: false }).range(from, from + 999);
    if (current) query = query.eq("client_id", current.id);
    const { data } = await query;
    // Numbers retired in favour of an old report are not shown or counted.
    all.push(...((data ?? []) as unknown as Row[]).map((d) => ({ ...d, metrics: d.metrics.filter((m) => m.status !== "rejected") })));
    if (!data || data.length < 1000) break;
  }
  const colsOf = (t: string) => CHANNELS.find((c) => c.types.includes(t))?.cols ?? [];
  const onCampaign = all.filter((d) => (d.campaign_id || !d.notion_page_id) && colsOf(d.deliverable_type).length);
  const ran = (d: Row) => !!d.start_date && d.start_date <= today;
  const missing = (d: Row) => !d.reported_with && ran(d) && d.deliverable_type !== "marketing_email" && colsOf(d.deliverable_type).some(([m]) => !d.metrics.some((x) => x.metric === m));
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const field = "rounded-lg border border-line bg-white px-3 py-2 text-sm";
  const intro = (
    <>
      {current ? <ClientTabs slug={current.slug} name={current.name} active="entry" /> : <ResultsTabs active="edit" />}
      <p className={`${current ? "mt-5" : "mt-4"} max-w-3xl text-sm text-ink/60`}>Fill in or correct any placement: its results, the title the client sees and its link. Laid out like the client page, one table per channel, with each row linked to Notion. A new or changed number waits in Approvals before the client sees it.</p>
      <form action="/admin/enter" className="mt-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search: EC number, title, date" aria-label="Search placements" className={`${field} w-72`} />
        {current ? <input type="hidden" name="client" value={current.slug} /> : (
          <select name="client" defaultValue="" aria-label="Client" className={field}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        <select name="show" defaultValue={sp.show ?? ""} aria-label="Which placements" className={field}>
          <option value="">Everything</option>
          <option value="missing">Missing results only</option>
        </select>
        <button className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark">Show</button>
        {(sp.q || sp.show) && <Link href={current ? `/admin/enter?client=${current.slug}` : "/admin/enter"} className="text-sm text-navy hover:underline">Clear</Link>}
      </form>
    </>
  );

  // Start page: one row per client, like the Clients list, with what is still missing.
  if (!current && !q) {
    const list = clients.map((c) => { const mine = onCampaign.filter((d) => d.client_id === c.id);
      return { ...c, total: mine.length, need: mine.filter(missing).length, byChannel: CHANNELS.map((ch) => [ch.title, mine.filter((d) => ch.types.includes(d.deliverable_type) && missing(d)).length] as const).filter(([, n]) => n) }; })
      .filter((c) => c.total > 0 && (sp.show !== "missing" || c.need > 0)).sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.need - a.need);
    return (
      <>
        {intro}
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-ink/60"><tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Placements</th><th className="px-4 py-3 font-medium">Missing results</th><th className="px-4 py-3 font-medium">Where</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.slug} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium"><Link href={`/admin/enter?client=${c.slug}`} className="text-navy hover:underline">{c.name}</Link>{!c.is_active && <span className="ml-2 text-xs font-normal text-ink/50">past</span>}</td>
                  <td className="px-4 py-3 tabular-nums">{c.total}</td>
                  <td className="px-4 py-3 tabular-nums">{c.need ? <Link href={`/admin/enter?client=${c.slug}&show=missing`} className="rounded bg-sun/60 px-1.5 py-0.5 hover:underline">{c.need}</Link> : <span className="text-ink/50">Complete</span>}</td>
                  <td className="px-4 py-3 text-ink/70">{c.byChannel.map(([t, n]) => `${t} ${n}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const matches = (d: Row) => !q || [d.inventory_tag, d.deliverable_label, d.display_title, d.title, d.start_date, TYPE_LABEL[d.deliverable_type], nameOf.get(d.client_id)].some((v) => (v ?? "").toLowerCase().includes(q));
  const rows = onCampaign.filter((d) => matches(d) && (sp.show !== "missing" || missing(d)));
  const shown = rows.slice(0, 400);
  const groups = (current ? [current.id] : [...new Set(shown.map((d) => d.client_id))].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "")))
    .map((cid) => ({ cid, name: nameOf.get(cid) ?? "", slug: clients.find((c) => c.id === cid)?.slug ?? "", rows: shown.filter((d) => d.client_id === cid) }));
  const notion = (id: string | null) => (id ? `https://www.notion.so/${id.replace(/-/g, "")}` : null);
  return (
    <>
      {intro}
      {rows.length === 0 ? <div className="mt-6"><Empty>Nothing matches.</Empty></div> : groups.map((g) => (
        <div key={g.cid}>
          {!current && <h2 className="mt-8 text-xl font-semibold"><Link href={`/admin/enter?client=${g.slug}`} className="hover:underline">{g.name}</Link></h2>}
          {CHANNELS.map((ch) => { const lines = g.rows.filter((d) => ch.types.includes(d.deliverable_type)); if (!lines.length) return null;
            const need = lines.filter(missing).length;
            return (
              <section key={ch.id} id={ch.id} className="mt-6 scroll-mt-16">
                <h3 className="flex items-baseline gap-3 text-base font-semibold">{ch.title}<span className="text-sm font-normal text-ink/50">{lines.length} {lines.length === 1 ? "placement" : "placements"}{need ? `, ${need} missing results` : ""}</span></h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="border-b border-line text-ink/60">
                      <tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Placement</th><th className="px-3 py-2 font-medium">Title</th>
                        {ch.cols.map(([m, label]) => <th key={m} className="px-3 py-2 text-right font-medium">{label}</th>)}
                        <th className="px-3 py-2 font-medium">Link</th><th className="px-3 py-2" /></tr>
                    </thead>
                    <tbody>
                      {lines.map((d) => (
                        <InventoryRow key={d.id} id={d.id} date={d.start_date} label={d.deliverable_label || TYPE_LABEL[d.deliverable_type]} tag={d.inventory_tag} notionUrl={notion(d.notion_page_id)}
                          status={d.status} title={d.display_title} link={d.live_url} missing={missing(d)}
                          fields={ch.cols.map(([metric]) => { const m = d.metrics.find((x) => x.metric === metric);
                            return { metric, value: m ? Number(m.value) : null, note: m ? `${SOURCE[m.source] ?? m.source}${m.status === "approved" ? "" : `, ${m.status === "pending" ? "waiting" : m.status}`}` : null }; })} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ); })}
        </div>
      ))}
      {rows.length > 400 && <p className="mt-3 text-sm text-ink/60">Showing the 400 most recent of {rows.length}. Pick a client or search to narrow it down.</p>}
    </>
  );
}
