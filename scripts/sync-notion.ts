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
  if (!process.env[k]) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
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

async function main() {
  const { data: run } = await db.from("sync_runs").insert({ source: "notion" }).select("id").single();
  let written = 0;
  try {
    const { data: clients, error } = await db.from("clients").select("id, name, notion_partner_name, notion_aliases");
    if (error) throw error;
    const byName = new Map<string, string>();
    for (const c of clients!) for (const n of [c.name, c.notion_partner_name, ...(c.notion_aliases ?? [])]) if (n) byName.set(norm(n), c.id);
    const unmatched = new Map<string, number>();
    const clientFor = (partner: string | null) => {
      if (!partner) return null;
      const id = byName.get(norm(partner));
      if (!id) unmatched.set(partner, (unmatched.get(partner) ?? 0) + 1);
      return id ?? null;
    };

    // 1. Campaigns
    const campaignRows = [];
    for (const page of await queryAll(CAMPAIGNS_DS)) {
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
      console.log("Notion partners with no matching client (skipped):");
      [...unmatched].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${n}: ${c} rows`));
    }
  } catch (e: any) {
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: String(e?.message ?? e).slice(0, 500) }).eq("id", run?.id);
    console.error(e);
    process.exit(1);
  }
}
main();
