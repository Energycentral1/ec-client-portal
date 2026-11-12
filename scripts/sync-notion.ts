/**
 * Notion → Supabase sync for campaigns and deliverables.
 * Run: npm run sync:notion   (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NOTION_TOKEN in .env.local)
 * Safe to re-run: rows are upserted on their Notion page id.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Client as Notion } from "@notionhq/client";
import { createClient } from "@supabase/supabase-js";

const CAMPAIGNS_DS = "440fe11a-4f04-4022-82bb-99a6f5c76683"; // [Master] Energy Central Campaigns
const INVENTORY_DS = "170f9ef7-2740-4e08-904f-8378999ebbe0"; // [Master] Energy Central Campaign Inventory

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NOTION_TOKEN"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (set it in .env.local, or as a GitHub Actions secret)`); process.exit(1); }
}
const notion = new Notion({ auth: process.env.NOTION_TOKEN });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/* eslint-disable @typescript-eslint/no-explicit-any */
type Props = Record<string, any>;
const text = (p: any): string | null => (p?.title ?? p?.rich_text ?? []).map((t: any) => t.plain_text).join("").trim() || null;
const sel = (p: any): string | null => p?.select?.name ?? p?.status?.name ?? null;
const multi = (p: any): string[] => (p?.multi_select ?? []).map((o: any) => o.name);
const dateStart = (p: any): string | null => p?.date?.start?.slice(0, 10) ?? null;
const dateEnd = (p: any): string | null => p?.date?.end?.slice(0, 10) ?? null;
const people = (p: any): string | null => (p?.people ?? []).map((x: any) => x.name).filter(Boolean).join(", ") || null;
const rel = (p: any): string[] => (p?.relation ?? []).map((r: any) => r.id);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function queryAll(dataSourceId: string): Promise<{ id: string; properties: Props }[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

const TYPE_MAP: [RegExp, string][] = [
  [/^newsletter ad/i, "newsletter_ad"], [/^website ad/i, "website_ad"], [/^email blast/i, "email_blast"],
  [/marketing email|event follow-up email/i, "marketing_email"], [/^webinar/i, "webinar"], [/power ?session|powertalk/i, "powersession"],
  [/^podcast/i, "podcast"], [/featured story/i, "featured_story"], [/sponsored article|written interview|case study|q&a doc/i, "sponsored_article"],
  [/^gated content|white paper/i, "gated_content"], [/non-gated/i, "non_gated_content"], [/^sponsorship/i, "sponsorship"],
  [/community takeover/i, "community_takeover"], [/linkedin/i, "linkedin_post"], [/^reel/i, "reel"],
];
const mapType = (labels: string[]) => { for (const l of labels) for (const [re, t] of TYPE_MAP) if (re.test(l)) return t; return "other"; };
const placement = (labels: string[]) => {
  const m = labels.map((l) => /newsletter ad - (hero|\d)/i.exec(l)).find(Boolean);
  return m ? (m[1].toLowerCase() === "hero" ? "hero" : `spot_${m[1]}`) : null;
};
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** When stats are pulled, per the EC SOP Production doc. */
function reportingDue(type: string, start: string | null, end: string | null): string | null {
  if (!start) return null;
  switch (type) {
    case "newsletter_ad": return addDays(start, 14);
    case "website_ad": case "sponsorship": return addDays(end ?? start, 14);
    case "email_blast": case "marketing_email": return addDays(start, 7);
    case "podcast": return addDays(start, 30);
    case "webinar": case "powersession": return addDays(start, 1);
    default: return addDays(start, 14);
  }
}

/** Notion "Partner" values that are not paying clients: never synced, never created. */
const SKIP_PARTNERS = new Set(["Energy Central", "EC House Ad", "Holiday - No NL's", "DTECH", "RE+", "RE+ Events"].map(norm));
/** Alternate spellings in Notion → the partner name they belong to. */
const PARTNER_ALIASES: Record<string, string> = Object.fromEntries(Object.entries({
  "Franklin Energy (Snugg Pro)": "Franklin Energy", "Franklin Energy/SnuggPro": "Franklin Energy", "Greenwood-Power": "Greenwood",
}).map(([k, v]) => [norm(k), v]));
const canonical = (partner: string | null) => (partner ? PARTNER_ALIASES[norm(partner)] ?? partner : null);
const slugify = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isOpen = (status: string | null) => !/^done$/i.test(status ?? "");

async function main() {
  const { data: run } = await db.from("sync_runs").insert({ source: "notion" }).select("id").single();
  let written = 0;
  try {
    // Notion's Campaigns database decides who is in the portal: every partner with a campaign gets a client row,
    // and a client is live when at least one of its campaigns is not marked Done.
    const campaignPages = await queryAll(CAMPAIGNS_DS);
    const openByPartner = new Map<string, { name: string; open: boolean }>();
    for (const page of campaignPages) {
      const partner = canonical(sel(page.properties["Partner"]));
      if (!partner || SKIP_PARTNERS.has(norm(partner))) continue;
      const cur = openByPartner.get(norm(partner)) ?? { name: partner, open: false };
      cur.open = cur.open || isOpen(sel(page.properties["Status"]));
      openByPartner.set(norm(partner), cur);
    }

    const loadClients = async () => {
      const { data, error } = await db.from("clients").select("id, name, slug, is_active, notion_partner_name, notion_aliases");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const c of data!) for (const n of [c.name, c.notion_partner_name, ...(c.notion_aliases ?? [])]) if (n) map.set(norm(n), c.id);
      return { rows: data!, map };
    };
    let { rows: clients, map: byName } = await loadClients();

    const slugs = new Set(clients.map((c) => c.slug));
    const toCreate = [...openByPartner].filter(([k]) => !byName.has(k)).map(([, v]) => {
      let slug = slugify(v.name) || "client";
      while (slugs.has(slug)) slug += "-2";
      slugs.add(slug);
      return { name: v.name, slug, notion_partner_name: v.name, is_active: v.open };
    });
    if (toCreate.length) {
      const { error: e } = await db.from("clients").insert(toCreate);
      if (e) throw e;
      console.log(`Added ${toCreate.length} clients from Notion: ${toCreate.map((c) => c.name).join(", ")}`);
      ({ rows: clients, map: byName } = await loadClients());
    }

    // Live / past follows Notion for every client.
    const liveIds = new Set([...openByPartner].filter(([, v]) => v.open).map(([k]) => byName.get(k)).filter(Boolean));
    const flips = clients.filter((c) => c.is_active !== liveIds.has(c.id));
    for (const c of flips) {
      const { error: e } = await db.from("clients").update({ is_active: liveIds.has(c.id) }).eq("id", c.id);
      if (e) throw e;
    }
    if (flips.length) console.log(`Live/past changed for ${flips.length}: ${flips.map((c) => `${c.name} → ${liveIds.has(c.id) ? "live" : "past"}`).join(", ")}`);
    console.log(`${liveIds.size} live clients, ${clients.length} total.`);

    const unmatched = new Map<string, number>();
    const clientFor = (raw: string | null) => {
      const partner = canonical(raw);
      if (!partner || SKIP_PARTNERS.has(norm(partner))) return null;
      const id = byName.get(norm(partner));
      if (!id) unmatched.set(partner, (unmatched.get(partner) ?? 0) + 1);
      return id ?? null;
    };

    // 1. Campaigns
    const campaignRows = [];
    for (const page of campaignPages) {
      const p = page.properties;
      const client_id = clientFor(sel(p["Partner"]));
      if (!client_id) continue;
      campaignRows.push({
        client_id, notion_page_id: page.id, name: text(p["Name"]) ?? "Untitled campaign", status: sel(p["Status"]),
        date_signed: dateStart(p["Date Signed"]), am_name: people(p["AM"]), bp_name: people(p["BP"]),
        io_url: p["IO"]?.url ?? null, wrap_report_url: p["Wrap Report"]?.url ?? null,
      });
    }
    if (campaignRows.length) {
      const { error: e } = await db.from("campaigns").upsert(campaignRows, { onConflict: "notion_page_id" });
      if (e) throw e;
      written += campaignRows.length;
    }
    const { data: camps } = await db.from("campaigns").select("id, notion_page_id");
    const campByPage = new Map((camps ?? []).map((c) => [c.notion_page_id!.replace(/-/g, ""), c.id]));

    // 2. Deliverables (inventory rows)
    const delRows = [];
    for (const page of await queryAll(INVENTORY_DS)) {
      const p = page.properties;
      const client_id = clientFor(sel(p["Partner"]));
      if (!client_id) continue;
      const labels = multi(p["Deliverable"]);
      const type = mapType(labels);
      const start = dateStart(p["Date"]);
      const end = dateStart(p["End Date"]) ?? dateEnd(p["Date"]);
      const uid = p["View"]?.unique_id;
      const utm: string | null = p["UTM"]?.url ?? null;
      delRows.push({
        client_id, notion_page_id: page.id,
        campaign_id: rel(p["Campaign"]).map((id) => campByPage.get(id.replace(/-/g, ""))).find(Boolean) ?? null,
        inventory_tag: uid?.number != null ? `${uid.prefix ?? "EC"}-${uid.number}` : null,
        deliverable_type: type, deliverable_label: labels.join(", ") || null, ec_brand: multi(p["EC Brand"]),
        placement: placement(labels), title: text(p["Notes"]), start_date: start, end_date: end, status: sel(p["Status"]),
        reporting_due_date: reportingDue(type, start, end),
        ...(utm && /short\.gy/i.test(utm) ? { short_link: utm } : {}),
      });
    }
    for (let i = 0; i < delRows.length; i += 500) {
      const { error: e } = await db.from("deliverables").upsert(delRows.slice(i, i + 500), { onConflict: "notion_page_id" });
      if (e) throw e;
    }
    written += delRows.length;

    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written }).eq("id", run!.id);
    console.log(`Synced ${campaignRows.length} campaigns and ${delRows.length} deliverables.`);
    if (unmatched.size) {
      console.log("Inventory rows skipped because the partner has no campaign in Notion:");
      [...unmatched].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${n}: ${c} rows`));
    }
  } catch (e: any) {
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: String(e?.message ?? e).slice(0, 500) }).eq("id", run?.id);
    console.error(e);
    process.exit(1);
  }
}
main();
