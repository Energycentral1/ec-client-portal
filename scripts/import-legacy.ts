/**
 * History import: loads the legacy "Customer Report" numbers in data/legacy/*.json into `metrics`.
 * Run: npm run import:legacy [client-slug]
 * Run with --dry to print what would happen and write nothing.
 * Every number lands as source = legacy_sheet, status = pending, so nothing reaches a client until approved.
 * The old report is the source of truth for anything already reported (Chloe, Nov 12 2026): where a sheet row lands on a
 * placement, numbers pulled from beehiiv, short.io or Zoom for the same metric are retired (status rejected, reason kept),
 * and the other Notion rows the sheet number covers (the days of a week, a second spot the same day) are linked to it with
 * `reported_with` so pulls leave them alone. Approved and typed-in numbers are never touched.
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
const DRY = process.argv.includes("--dry");
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
const WEEK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (a: string, b: string) => `Week of ${WEEK.format(new Date(a + "T00:00:00Z"))} to ${WEEK.format(new Date(b + "T00:00:00Z"))}`;
const days = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

async function importFile(file: LegacyFile) {
  const { data: client } = await db.from("clients").select("id, name").eq("slug", file.client_slug).maybeSingle();
  if (!client) { console.log(`✗ ${file.client_slug}: no client with that slug, skipped`); return 0; }
  const { data: dels, error } = await db.from("deliverables").select("id, deliverable_type, placement, start_date, inventory_tag, title").eq("client_id", client.id);
  if (error) throw error;
  const pool = (dels ?? []) as Deliverable[];
  const used = new Set<string>();
  let written = 0, matched = 0, created = 0, skipped = 0, retired = 0, linked = 0;
  // A newsletter date with a single sheet row covers every newsletter ad the client ran that day.
  const perDay = new Map<string, number>();
  for (const r of file.rows) if (r.tab === "newsletter" && !r.end_date) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  // Sheets go back years; Notion inventory doesn't. Rows from before Notion's first placement (less a week) are left out,
  // so the portal doesn't fill up with history nobody can check. Loading older history is a decision for the team.
  const first = pool.map((d) => d.start_date).filter(Boolean).sort()[0];
  const cutoff = first ? new Date(Date.parse(first) - 7 * 864e5).toISOString().slice(0, 10) : null;
  console.log(`\n${client.name}: ${file.rows.length} sheet rows, ${pool.length} deliverables from Notion`);

  for (const row of file.rows) {
    const tab = TABS[row.tab];
    if (!tab) { console.log(`  ? unknown tab "${row.tab}"`); continue; }
    if (cutoff && row.date < cutoff) { skipped++; continue; }
    // A sheet row with an end date is a whole flight (usually a week) reported as one number. Notion may hold one row per day
    // for it: the numbers go on the first of them and the rest are taken out of play so no later row grabs them.
    const inFlight = (d: Deliverable) => !!row.end_date && !!d.start_date && d.start_date >= new Date(Date.parse(row.date) - 864e5).toISOString().slice(0, 10)
      && d.start_date <= new Date(Date.parse(row.end_date) + 864e5).toISOString().slice(0, 10);
    // Closest date wins; hero placement breaks ties (the sheet reports one number for "Hero & Position 1").
    const candidates = pool
      .filter((d) => !used.has(d.id) && tab.types.includes(d.deliverable_type) && d.start_date && (row.end_date ? inFlight(d) : days(d.start_date, row.date) <= tab.dayWindow))
      .sort((a, b) => days(a.start_date!, row.date) - days(b.start_date!, row.date)
        || tab.types.indexOf(a.deliverable_type) - tab.types.indexOf(b.deliverable_type)
        || (a.placement === "hero" ? -1 : 0) - (b.placement === "hero" ? -1 : 0));
    let target = candidates[0];
    if (target) { matched++; }
    else if (DRY) { created++; console.log(`  + ${row.tab} ${row.date} → no Notion row; one would be added (${Object.entries(row.metrics).map(([k, v]) => `${k} ${v}`).join(", ")})`); continue; }
    else {
      const { data: made, error: e } = await db.from("deliverables").insert({
        // No Notion row: use whichever of this tab's types the client has most of, so a sponsorship week isn't filed as a takeover.
        client_id: client.id, deliverable_type: [...tab.types].sort((x, y) => pool.filter((d) => d.deliverable_type === y).length - pool.filter((d) => d.deliverable_type === x).length)[0], display_title: row.title ?? null, start_date: row.date, end_date: row.end_date ?? null,
        status: "Done", notes: "From the legacy Customer Report; no matching row in Notion inventory.",
      }).select("id, deliverable_type, placement, start_date, inventory_tag, title").single();
      if (e) throw e;
      target = made as Deliverable; created++;
    }
    used.add(target.id);
    // The other Notion rows this one sheet number speaks for: the rest of the flight, or the other spot on the same day.
    const covered = (row.end_date ? candidates.filter((c) => c.deliverable_type === target.deliverable_type)
      : row.tab === "newsletter" && perDay.get(row.date) === 1 ? candidates.filter((c) => c.start_date === target.start_date) : []).filter((c) => c.id !== target.id);
    for (const c of covered) used.add(c.id);
    const metricNames = Object.keys(row.metrics);
    if (DRY) {
      const { count } = await db.from("metrics").select("id", { count: "exact", head: true }).in("deliverable_id", [target.id, ...covered.map((c) => c.id)])
        .in("metric", metricNames).in("source", ["beehiiv", "shortio", "zoom"]).in("status", ["pending", "flagged"]);
      retired += count ?? 0; linked += covered.length; written += metricNames.length;
      console.log(`  ✓ ${row.tab} ${row.date} → ${target.inventory_tag ?? "sheet row"}${covered.length ? ` (+${covered.length} covered)` : ""} ${Object.entries(row.metrics).map(([k, v]) => `${k} ${v}`).join(", ")}${count ? `; would retire ${count} pulled` : ""}`);
      continue;
    }
    if (covered.length) {
      const { error: e4 } = await db.from("deliverables").update({ reported_with: target.id }).in("id", covered.map((c) => c.id));
      if (e4) throw e4;
      linked += covered.length;
    }
    const { data: gone, error: e5 } = await db.from("metrics").update({ status: "rejected", flag_reason: "Replaced by the figure in the old report." })
      .in("deliverable_id", [target.id, ...covered.map((c) => c.id)]).in("metric", metricNames).in("source", ["beehiiv", "shortio", "zoom"]).in("status", ["pending", "flagged"]).select("id");
    if (e5) throw e5;
    retired += gone?.length ?? 0;
    // Carry over what the sheet knows and Notion doesn't: the event or post name, and where it lives.
    const patch: Record<string, string> = {};
    if (row.live_url) patch.live_url = row.live_url;
    if (row.title) patch.display_title = row.title;
    else if (row.end_date && row.end_date !== row.date) patch.display_title = span(row.date, row.end_date);
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
  console.log(`  ${retired} pulled numbers ${DRY ? "would be" : ""} retired in favour of the sheet; ${linked} extra Notion rows covered by a sheet row.`);
  console.log(`  ${matched} matched to Notion, ${created} added because Notion had no row${skipped ? `, ${skipped} left out (before Notion's first placement, ${first})` : ""}.`);
  return written;
}

async function main() {
  const only = process.argv.slice(2).find((a) => a && !a.startsWith("--"));
  const { data: run } = DRY ? { data: null } : await db.from("sync_runs").insert({ source: "legacy_sheet" }).select("id").single();
  let written = 0;
  try {
    // Newsletter issues (date → link). Interim source until scripts/pull-beehiiv.ts fills this table nightly.
    const issuesFile = join(process.cwd(), "data", "newsletter-issues.json");
    if (existsSync(issuesFile) && !DRY) {
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
    if (DRY) { console.log(`\nDRY RUN: ${written} numbers would be loaded; nothing was written.`); return; }
    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written }).eq("id", run?.id);
    console.log(`\nDone: ${written} numbers loaded as pending.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: msg.slice(0, 500) }).eq("id", run.id);
    console.error(e);
    process.exit(1);
  }
}
main();
