/**
 * History import: loads the legacy "Customer Report" numbers in data/legacy/*.json into `metrics`.
 * Run: npm run import:legacy [client-slug]
 * Every number lands as source = legacy_sheet, status = pending, so nothing reaches a client until approved.
 * Safe to re-run: existing rows are left alone (including ones already approved).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (set it in .env.local, or as a GitHub Actions secret)`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Row = { tab: string; date: string; end_date?: string; title?: string; live_url?: string; metrics: Record<string, number> };
type LegacyFile = { client_slug: string; rows: Row[] };
type Deliverable = { id: string; deliverable_type: string; placement: string | null; start_date: string | null; inventory_tag: string | null; title: string | null };

/** Which deliverable types a sheet tab can describe, most likely first. dayWindow = how far the sheet date may be from Notion's. */
const TABS: Record<string, { types: string[]; dayWindow: number }> = {
  newsletter: { types: ["newsletter_ad"], dayWindow: 1 },
  email: { types: ["email_blast", "marketing_email"], dayWindow: 2 },
  events: { types: ["powersession", "webinar"], dayWindow: 3 },
  sponsorship: { types: ["community_takeover", "sponsorship", "website_ad"], dayWindow: 3 },
  website: { types: ["website_ad"], dayWindow: 3 },
  content: { types: ["sponsored_article", "featured_story", "gated_content", "non_gated_content", "other"], dayWindow: 3 },
  podcast: { types: ["podcast"], dayWindow: 7 },
};
const days = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

async function importFile(file: LegacyFile) {
  const { data: client } = await db.from("clients").select("id, name").eq("slug", file.client_slug).maybeSingle();
  if (!client) { console.log(`✗ ${file.client_slug}: no client with that slug, skipped`); return 0; }
  const { data: dels, error } = await db.from("deliverables").select("id, deliverable_type, placement, start_date, inventory_tag, title").eq("client_id", client.id);
  if (error) throw error;
  const pool = (dels ?? []) as Deliverable[];
  const used = new Set<string>();
  let written = 0, matched = 0, created = 0;
  console.log(`\n${client.name}: ${file.rows.length} sheet rows, ${pool.length} deliverables from Notion`);

  for (const row of file.rows) {
    const tab = TABS[row.tab];
    if (!tab) { console.log(`  ? unknown tab "${row.tab}"`); continue; }
    // Closest date wins; hero placement breaks ties (the sheet reports one number for "Hero & Position 1").
    const candidates = pool
      .filter((d) => !used.has(d.id) && tab.types.includes(d.deliverable_type) && d.start_date && days(d.start_date, row.date) <= tab.dayWindow)
      .sort((a, b) => days(a.start_date!, row.date) - days(b.start_date!, row.date)
        || tab.types.indexOf(a.deliverable_type) - tab.types.indexOf(b.deliverable_type)
        || (a.placement === "hero" ? -1 : 0) - (b.placement === "hero" ? -1 : 0));
    let target = candidates[0];
    if (target) { matched++; }
    else {
      const { data: made, error: e } = await db.from("deliverables").insert({
        client_id: client.id, deliverable_type: tab.types[0], title: row.title ?? null, start_date: row.date, end_date: row.end_date ?? null,
        status: "Done", notes: "From the legacy Customer Report; no matching row in Notion inventory.",
      }).select("id, deliverable_type, placement, start_date, inventory_tag, title").single();
      if (e) throw e;
      target = made as Deliverable; created++;
    }
    used.add(target.id);
    // Carry over what the sheet knows and Notion doesn't: the event or post name, and where it lives.
    const patch: Record<string, string> = {};
    if (row.live_url) patch.live_url = row.live_url;
    if (row.title && !target.title && row.tab !== "newsletter") patch.title = row.title;
    if (Object.keys(patch).length) { const { error: e3 } = await db.from("deliverables").update(patch).eq("id", target.id); if (e3) throw e3; }
    const rows = Object.entries(row.metrics).map(([metric, value]) => ({
      client_id: client.id, deliverable_id: target.id, metric, value, source: "legacy_sheet", status: "pending",
      window_start: row.date, window_end: row.end_date ?? row.date,
    }));
    const { error: e2 } = await db.from("metrics").upsert(rows, { onConflict: "deliverable_id,metric,source,window_end", ignoreDuplicates: true });
    if (e2) throw e2;
    written += rows.length;
    console.log(`  ${candidates[0] ? "✓" : "+"} ${row.tab} ${row.date} → ${target.inventory_tag ?? "new row"} (${target.deliverable_type}${target.start_date !== row.date ? `, Notion date ${target.start_date}` : ""}) ${Object.entries(row.metrics).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  console.log(`  ${matched} matched to Notion, ${created} added because Notion had no row.`);
  return written;
}

async function main() {
  const only = process.argv[2];
  const { data: run } = await db.from("sync_runs").insert({ source: "legacy_sheet" }).select("id").single();
  let written = 0;
  try {
    // Newsletter issues (date → link). Interim source until scripts/pull-beehiiv.ts fills this table nightly.
    const issuesFile = join(process.cwd(), "data", "newsletter-issues.json");
    if (existsSync(issuesFile)) {
      const issues = JSON.parse(readFileSync(issuesFile, "utf8"));
      const { error: e } = await db.from("newsletter_issues").upsert(issues, { onConflict: "publication,issue_date" });
      if (e) throw e;
      console.log(`Newsletter issues: ${issues.length} dates linked.`);
    }
    const dir = join(process.cwd(), "data", "legacy");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const file = JSON.parse(readFileSync(join(dir, f), "utf8")) as LegacyFile;
      if (only && file.client_slug !== only) continue;
      written += await importFile(file);
    }
    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written }).eq("id", run?.id);
    console.log(`\nDone: ${written} numbers loaded as pending.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: msg.slice(0, 500) }).eq("id", run?.id);
    console.error(e);
    process.exit(1);
  }
}
main();
