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
  display_title: string | null; live_url: string | null; inventory_tag: string | null; start_date: string | null; ec_brand: string[] | null;
  clients: { name: string; slug: string } | null; metrics: { metric: string; value: number }[] };

export default async function EnterNumbers({ searchParams }: { searchParams: Promise<{ client?: string; type?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 548 * 864e5).toISOString().slice(0, 10);   // the last 18 months
  const { data } = await supabase.from("deliverables")
    .select("id, campaign_id, notion_page_id, deliverable_type, deliverable_label, title, display_title, live_url, inventory_tag, start_date, ec_brand, clients(name, slug), metrics(metric, value)")
    .in("deliverable_type", TYPES).lte("start_date", today).gte("start_date", since).order("start_date", { ascending: false }).limit(2000);
  const fieldsOf = (t: string) => MANUAL.find((m) => m.types.includes(t))!.fields;
  // Same rules as the client page: only what is on a campaign, and newsletter-week sponsorships are covered by the issue.
  const inNewsletter = (d: Row) => d.deliverable_type !== "website_ad" && ((d.ec_brand ?? []).some((b) => /daily|weekly/i.test(b)) || /\bNL\b/.test(d.deliverable_label ?? ""));
  const all = ((data ?? []) as unknown as Row[]).filter((d) => (d.campaign_id || !d.notion_page_id) && !(["sponsorship"].includes(d.deliverable_type) && inNewsletter(d)));
  const open = all.filter((d) => fieldsOf(d.deliverable_type).some(([m]) => !d.metrics.some((x) => x.metric === m)));
  const clients = [...new Map(open.map((d) => [d.clients?.slug ?? "", d.clients?.name ?? ""])).entries()].filter(([s]) => s).sort((a, b) => a[1].localeCompare(b[1]));
  const groups = MANUAL.map((m) => ({ key: m.types[0], label: TYPE_LABEL[m.types[0]] === "Sponsorship" ? "Sponsorship and community" : m.types[0] === "sponsored_article" ? "Partner Content" : TYPE_LABEL[m.types[0]], types: m.types }));
  const rows = open.filter((d) => (!sp.client || d.clients?.slug === sp.client) && (!sp.type || groups.find((g) => g.key === sp.type)?.types.includes(d.deliverable_type)));
  const href = (p: { client?: string; type?: string }) => { const q = new URLSearchParams(Object.entries({ client: sp.client, type: sp.type, ...p }).filter(([, v]) => v) as [string, string][]).toString(); return `/admin/enter${q ? `?${q}` : ""}`; };
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink/70 hover:bg-mist"}`;
  return (
    <>
      <h1 className="text-2xl font-semibold">Enter numbers{sp.client && clients.find(([s]) => s === sp.client) ? `: ${clients.find(([s]) => s === sp.client)![1]}` : ""}</h1>
      {sp.client && <p className="mt-1 text-sm"><Link href={`/admin/clients/${sp.client}`} className="text-navy hover:underline">Back to this client&apos;s page</Link></p>}
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Placements that have run and still have a number missing, for the types no data pull covers: Partner Content and website ads (read from Bettermode), podcasts (Flightcast) and sponsorships. What you save here waits in Approvals before the client sees it.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={href({ type: undefined })} className={pill(!sp.type)}>All types ({open.filter((d) => !sp.client || d.clients?.slug === sp.client).length})</Link>
        {groups.map((g) => { const n = open.filter((d) => g.types.includes(d.deliverable_type) && (!sp.client || d.clients?.slug === sp.client)).length;
          return n ? <Link key={g.key} href={href({ type: g.key })} className={pill(sp.type === g.key)}>{g.label} ({n})</Link> : null; })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={href({ client: undefined })} className={pill(!sp.client)}>All clients</Link>
        {clients.map(([slug, name]) => <Link key={slug} href={href({ client: slug })} className={pill(sp.client === slug)}>{name}</Link>)}
      </div>
      {rows.length === 0 ? <div className="mt-6"><Empty>Nothing waiting for numbers.</Empty></div> : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
          {rows.slice(0, 150).map((d) => (
            <li key={d.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <div className="text-sm">
                <p className="font-medium">{d.clients?.name} <span className="font-normal text-ink/50">· {d.start_date}{d.inventory_tag ? ` · ${d.inventory_tag}` : ""}</span></p>
                <p className="text-ink/80">{d.deliverable_label || TYPE_LABEL[d.deliverable_type]}</p>
                {(d.display_title || d.title) && <p className="text-ink/60">{d.display_title || d.title}</p>}
                {d.live_url && <a href={d.live_url} target="_blank" rel="noreferrer" className="text-navy hover:underline">Open it</a>}
              </div>
              <EnterNumbersRow id={d.id} needsLink={!d.live_url} needsTitle={!d.display_title}
                fields={fieldsOf(d.deliverable_type).map(([metric, label]) => ({ metric, label, value: d.metrics.find((x) => x.metric === metric)?.value ?? null }))} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > 150 && <p className="mt-3 text-sm text-ink/60">Showing the 150 most recent of {rows.length}. Pick a client or type to narrow it down.</p>}
    </>
  );
}
