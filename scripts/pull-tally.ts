/* eslint-disable @typescript-eslint/no-explicit-any -- Tally responses are untyped JSON */
/**
 * Tally pull: on-demand webinar sign-ups and gated content downloads -> leads.
 * Run: npm run pull:tally -- [--dry]
 *
 * Every form in the Energy Central Tally workspace is read, so a new form needs no setup (a webhook would have to be added
 * to each form by hand). Runs every few hours; leads have no approval step, so clients see them on the next run.
 *
 * Form -> placement. Forms are named "<Client> Presents: <title>" (also "<Client> Paper | ...", "<Client> eBook: ...").
 * A form already linked (`deliverables.tally_form_id`) stays linked. Otherwise, among that client's placements on a campaign:
 *   1. the placement whose name (Zoom title / display title) shares most of the form's title words, else
 *   2. for "Presents" forms, the one webinar/PowerSession within 3 days of the day the form was made (forms are built for the event),
 *   3. for papers, reports, eBooks, surveys and assessments, the one gated content placement within 45 days.
 * Anything else is listed, never guessed. Webinar forms give `webinar_on_demand` leads, the rest `gated_content`.
 * Secret: TALLY_API_KEY (Tally > Settings > API keys).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TALLY_API_KEY"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (GitHub Actions secret, or .env.local)`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry");
const WORKSPACE = "mYRM7B"; // Energy Central forms
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
async function tally(path: string, tries = 5): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://api.tally.so${path}`, { headers: { Authorization: `Bearer ${process.env.TALLY_API_KEY}` } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < tries) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`${r.status} for ${path.replace(/\?.*/, "")}: ${(await r.text()).slice(0, 200)}`);
  }
}
const squash = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: string) => new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a: string, b: string) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const PRESENTS_AS: Record<string, string> = { itron: "locusview" };
const WEBINAR = ["webinar", "powersession"], GATED = ["gated_content", "non_gated_content", "other"];

/** Tally answers -> lead columns, by question label. */
function toLead(questions: any[], s: any) {
  const label = new Map(questions.map((q) => [q.id, String(q.label ?? "").toLowerCase()]));
  const out: Record<string, any> = {};
  for (const r of s.responses ?? []) {
    const l = label.get(r.questionId) ?? "";
    const a = Array.isArray(r.answer) ? r.answer.join(", ") : typeof r.answer === "object" && r.answer ? JSON.stringify(r.answer) : String(r.answer ?? "");
    const v = a.trim();
    if (!v) continue;
    if (/e-?mail/.test(l)) out.email = v.toLowerCase();
    else if (/first/.test(l)) out.first_name = v;
    else if (/last|surname/.test(l)) out.last_name = v;
    else if (/phone/.test(l)) out.phone = v;
    else if (/job|title|role|position/.test(l)) out.job_title = v;
    else if (/company size|employees/.test(l)) out.company_size = v;
    else if (/company|organi[sz]ation|employer/.test(l)) out.company = v;
    else if (/city/.test(l)) out.city = v;
    else if (/state|province/.test(l)) out.state = v;
    else if (/country/.test(l)) out.country = v;
    else if (/consent|contact me/i.test(v) || /consent/.test(l)) out.consent = true;
  }
  return out;
}

async function main() {
  const { data: run } = DRY ? { data: null } : await db.from("sync_runs").insert({ source: "tally" }).select("id").single();
  let written = 0;
  const problems: string[] = [];
  try {
    const { data: clients } = await db.from("clients").select("id, name");
    const { data: dels, error } = await db.from("deliverables")
      .select("id, client_id, campaign_id, notion_page_id, deliverable_type, inventory_tag, start_date, display_title, title, deliverable_label, tally_form_id")
      .in("deliverable_type", [...WEBINAR, ...GATED]);
    if (error) throw error;
    const placements = (dels ?? []).filter((d) => d.campaign_id || !d.notion_page_id);

    const list = await tally(`/forms?workspaceIds=${WORKSPACE}&limit=500`);
    const forms = ((list.items ?? list.forms ?? list.data ?? []) as any[])
      .filter((f: any) => !/template|energy central'?s|reader survey|workforce survey/i.test(f.name) && f.numberOfSubmissions > 0);
    console.log(`Tally forms with sign-ups: ${forms.length}.`);

    const leads: any[] = [];
    const link = new Map<string, string>(); // deliverable id -> form id
    for (const f of forms) {
      const name = String(f.name).replace(/\s+/g, " ").trim();
      let d = placements.find((x) => x.tally_form_id === f.id);
      if (!d) {
        const sq = squash(name.split(/presents|paper|report|ebook|e-book|survey|\||:/i)[0]);
        const client = (clients ?? []).find((c) => { const cn = squash(c.name), first = squash(c.name.split(/\s+/)[0]);
          return (sq && (sq === cn || sq.startsWith(cn) || cn.startsWith(sq) || (first.length >= 3 && sq.startsWith(first)))) || Object.entries(PRESENTS_AS).some(([as, real]) => sq.startsWith(as) && cn.includes(real)); });
        if (!client) { problems.push(`"${name}": no client named ${sq || "(none)"}`); continue; }
        const mine = placements.filter((x) => x.client_id === client.id);
        const title = name.replace(/^[^:|]*[:|]/, "");
        const scored = mine.map((x) => ({ x, s: overlap(title, `${x.display_title ?? ""} ${x.title ?? ""}`) })).filter((y) => y.s >= 0.6).sort((a, b) => b.s - a.s);
        if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) d = scored[0].x;
        else {
          const isWebinar = /presents/i.test(name) && !/paper|report|ebook|survey|assessment|guide/i.test(name);
          const near = mine.filter((x) => x.start_date && (isWebinar ? WEBINAR.includes(x.deliverable_type) && days(x.start_date, f.createdAt) <= 3
            : GATED.includes(x.deliverable_type) && days(x.start_date, f.createdAt) <= 45));
          if (near.length === 1) d = near[0];
          else { problems.push(`"${name}" (${client.name}, form made ${String(f.createdAt).slice(0, 10)}): ${near.length} possible placements${near.length ? `: ${near.map((x) => `${x.start_date} ${x.inventory_tag ?? ""}`).join(", ")}` : ""}`); continue; }
        }
        link.set(d.id, f.id);
      }
      const source = WEBINAR.includes(d.deliverable_type) ? "webinar_on_demand" : "gated_content";
      for (let page = 1; page < 50; page++) {
        const r = await tally(`/forms/${f.id}/submissions?page=${page}&limit=500&filter=completed`);
        for (const s of r.submissions ?? []) {
          const l = toLead(r.questions ?? [], s);
          if (!l.email) continue;
          leads.push({ client_id: d.client_id, deliverable_id: d.id, source, origin: "tally", submitted_at: s.submittedAt ?? null, consent: l.consent ?? false,
            ...l, raw: { tally_form_id: f.id, tally_submission_id: s.id } });
        }
        if (!r.hasMore) break;
      }
    }
    const uniq = [...new Map(leads.map((l) => [`${l.client_id}|${l.deliverable_id}|${l.source}|${l.email}`, l])).values()];
    console.log(`Sign-ups read: ${uniq.length}. New form links: ${link.size}.`);
    console.log(`Not matched (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n") || "- none"}`);
    if (DRY) { console.log(`\nDRY RUN: nothing was written.`); return; }

    // New people only: a lead already in the portal (from a sheet or Zoom) is never overwritten.
    let fresh = 0;
    for (let i = 0; i < uniq.length; i += 300) {
      const batch = uniq.slice(i, i + 300);
      const { data, error: e } = await db.from("leads").upsert(batch, { onConflict: "client_id,deliverable_id,source,email", ignoreDuplicates: true }).select("id");
      if (e) throw e;
      fresh += data?.length ?? 0;
    }
    for (const [id, form] of link) { const { error: e } = await db.from("deliverables").update({ tally_form_id: form }).eq("id", id); if (e) throw e; }
    written = fresh + link.size;
    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written,
      error: problems.length ? `${problems.length} forms not matched (see the Action log)` : null }).eq("id", run!.id);
    console.log(`\nWrote ${fresh} new leads and ${link.size} form links.`);
  } catch (e: any) {
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: String(e?.message ?? e).slice(0, 500) }).eq("id", run.id);
    console.error(e);
    process.exit(1);
  }
}

main();
