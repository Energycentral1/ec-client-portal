import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Empty, TYPE_LABEL } from "@/components/Shell";
import { EnterNumbersRow } from "@/components/EnterNumbersRow";

/** Placement types whose numbers nobody can pull yet, and the numbers each one needs (same columns as the client page).
 *  Partner Content and website ads are read from Bettermode's screens (no API on the current plan) until the move to
 *  beehiiv; podcast plays come from Flightcast, which has no API. */
const MANUAL: { types: string[]; fields: [string, string][] }[] = [
  { types: ["sponsored_article", "featured_story", "gated_content", "non_gated_content"], fields: [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"]] },
  { types: ["podcast"], fields: [["plays", "Episode reach"], ["short_form_views", "Short-form reach"], ["impressions", "Impressions"], ["clicks", "Clicks"]] },
  { types: ["website_ad"], fields: [["impressions", "Impressions"], ["clicks", "Clicks"]] },
  { types: ["sponsorship", "community_takeover", "linkedin_post", "reel"], fields: [["impressions", "Impressions"], ["clicks", "Clicks"]] },
];
const TYPES = MANUAL.flatMap((m) => m.types);

type Row = { id: string; campaign_id: string | null; notion_page_id: string | null; deliverable_type: string; deliverable_label: string | null; title: string | null;
  display_title: string | null; live_url: string | null; status: string | null; inventory_tag: string | null; start_date: string | null; ec_brand: string[] | null;
  clients: { name: string; slug: string } | null; metrics: { metric: string; value: number }[] };

export default async function EnterNumbers({ searchParams }: { searchParams: Promise<{ client?: string; type?: string; q?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 548 * 864e5).toISOString().slice(0, 10);   // the last 18 months
  const { data } = await supabase.from("deliverables")
    .select("id, campaign_id, notion_page_id, deliverable_type, deliverable_label, title, display_title, live_url, status, inventory_tag, start_date, ec_brand, clients(name, slug), metrics(metric, value)")
    .in("deliverable_type", TYPES).lte("start_date", today).gte("start_date", since).order("start_date", { ascending: false }).limit(2000);
  const fieldsOf = (t: string) => MANUAL.find((m) => m.types.includes(t))!.fields;
  // Same rules as the client page: only what is on a campaign, and newsletter-week sponsorships are covered by the issue.
  const inNewsletter = (d: Row) => d.deliverable_type !== "website_ad" && ((d.ec_brand ?? []).some((b) => /daily|weekly/i.test(b)) || /\bNL\b/.test(d.deliverable_label ?? ""));
  const all = ((data ?? []) as unknown as Row[]).filter((d) => (d.campaign_id || !d.notion_page_id) && !(["sponsorship"].includes(d.deliverable_type) && inNewsletter(d)));
  const open = all.filter((d) => fieldsOf(d.deliverable_type).some(([m]) => !d.metrics.some((x) => x.metric === m)));
  const clients = [...new Map(open.map((d) => [d.clients?.slug ?? "", d.clients?.name ?? ""])).entries()].filter(([s]) => s).sort((a, b) => a[1].localeCompare(b[1]));
  const groups = MANUAL.map((m) => ({ key: m.types[0], label: TYPE_LABEL[m.types[0]] === "Sponsorship" ? "Sponsorship and community" : m.types[0] === "sponsored_article" ? "Partner Content" : TYPE_LABEL[m.types[0]], types: m.types }));
  const q = (sp.q ?? "").trim().toLowerCase();
  const matches = (d: Row) => !q || [d.clients?.name, d.inventory_tag, d.deliverable_label, d.display_title, d.title, d.start_date, TYPE_LABEL[d.deliverable_type]].some((v) => (v ?? "").toLowerCase().includes(q));
  const inClient = open.filter((d) => (!sp.client || d.clients?.slug === sp.client) && matches(d));
  const rows = inClient.filter((d) => !sp.type || groups.find((g) => g.key === sp.type)?.types.includes(d.deliverable_type));
  const href = (p: { client?: string; type?: string }) => { const qs = new URLSearchParams(Object.entries({ client: sp.client, type: sp.type, q: sp.q, ...p }).filter(([, v]) => v) as [string, string][]).toString(); return `/admin/enter${qs ? `?${qs}` : ""}`; };
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink/70 hover:bg-mist"}`;
  // One block per client, newest placement first, so a client's whole backlog is in one place.
  const shown = rows.slice(0, 200);
  const byClient = [...new Map(shown.map((d) => [d.clients?.slug ?? "", { slug: d.clients?.slug ?? "", name: d.clients?.name ?? "", rows: [] as Row[] }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of shown) byClient.find((c) => c.slug === (d.clients?.slug ?? ""))!.rows.push(d);
  const notion = (id: string | null) => (id ? `https://www.notion.so/${id.replace(/-/g, "")}` : null);
  const field = "rounded-lg border border-line bg-white px-3 py-2 text-sm";
  return (
    <>
      <h1 className="text-2xl font-semibold">Manual entry</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Placements that have run and still have a number missing, for the types no data pull covers: Partner Content and website ads (read from Bettermode), podcasts (Flightcast) and sponsorships. Each one links to its row in Notion. What you save waits in Approvals before the client sees it.</p>
      <form action="/admin/enter" className="mt-4 flex flex-wrap items-center gap-2">
        {sp.type && <input type="hidden" name="type" value={sp.type} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search: client, EC number, headline, date" aria-label="Search placements" className={`${field} w-80`} />
        <select name="client" defaultValue={sp.client ?? ""} aria-label="Client" className={field}>
          <option value="">All clients ({clients.length})</option>
          {clients.map(([slug, name]) => <option key={slug} value={slug}>{name} ({open.filter((d) => d.clients?.slug === slug).length})</option>)}
        </select>
        <button className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark">Search</button>
        {(sp.q || sp.client || sp.type) && <Link href="/admin/enter" className="text-sm text-navy hover:underline">Clear</Link>}
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={href({ type: undefined })} className={pill(!sp.type)}>All types ({inClient.length})</Link>
        {groups.map((g) => { const n = inClient.filter((d) => g.types.includes(d.deliverable_type)).length;
          return n ? <Link key={g.key} href={href({ type: g.key })} className={pill(sp.type === g.key)}>{g.label} ({n})</Link> : null; })}
      </div>
      {rows.length === 0 ? <div className="mt-6"><Empty>{q || sp.client || sp.type ? "Nothing matches that search." : "Nothing waiting for numbers."}</Empty></div> : byClient.map((c) => (
        <section key={c.slug} className="mt-6">
          <h2 className="flex flex-wrap items-baseline gap-x-3 text-lg font-semibold">
            <Link href={`/admin/clients/${c.slug}`} className="hover:underline">{c.name}</Link>
            <span className="text-sm font-normal text-ink/50">{c.rows.length} to fill in</span>
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white">
            {c.rows.map((d) => (
              <li key={d.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
                <div className="text-sm">
                  <p className="font-medium">{d.deliverable_label || TYPE_LABEL[d.deliverable_type]} <span className="font-normal text-ink/50">· {d.start_date}</span></p>
                  {(d.display_title || d.title) && <p className="text-ink/70">{d.display_title || d.title}</p>}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-ink/60">
                    {notion(d.notion_page_id) ? <a href={notion(d.notion_page_id)!} target="_blank" rel="noreferrer" className="text-navy hover:underline">{d.inventory_tag ?? "Notion row"} in Notion</a> : <span>{d.inventory_tag ?? "From an old report, not in Notion"}</span>}
                    {d.status && <span>{d.status}</span>}
                    {d.live_url && <a href={d.live_url} target="_blank" rel="noreferrer" className="text-navy hover:underline">Open the post</a>}
                  </p>
                </div>
                <EnterNumbersRow id={d.id} needsLink={!d.live_url} needsTitle={!d.display_title}
                  fields={fieldsOf(d.deliverable_type).map(([metric, label]) => ({ metric, label, value: d.metrics.find((x) => x.metric === metric)?.value ?? null }))} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.length > 200 && <p className="mt-3 text-sm text-ink/60">Showing the 200 most recent of {rows.length}. Search or pick a client to narrow it down.</p>}
    </>
  );
}
