/* eslint-disable @typescript-eslint/no-explicit-any -- Zoom responses are untyped JSON */
/**
 * Zoom Events pull: webinars and PowerSessions. Registrations, attendance, live and on-demand leads, recording links.
 * Run: npm run pull:zoom -- [--dry] [--days=N]       (default: events from the last 400 days and everything upcoming)
 *
 * Needs a Zoom Server-to-Server OAuth app (Zoom Marketplace, on the account that owns the Zoom Events hub) with scopes
 * zoom_events_basic:read:admin, zoom_events_reports:read:admin, zoom_events_hubs:read:admin, zoom_events_vod_reports:read:admin.
 * Secrets: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET.
 *
 * 1. Events. Every hosted event is matched to one webinar/PowerSession placement: "<Client> Presents: ..." (or the client's
 *    name anywhere in the title) plus an event date within a day of the Notion date. LocusView sessions run under Itron (acquired).
 *    A title with no client name matches only when exactly one webinar/PowerSession is booked that day. Unmatched events are
 *    listed, never guessed. The event id is saved on the placement.
 * 2. Registrations, before and after the event (Chloe: registrations have to come in too). The ticket registration report gives
 *    name, email, marketing opt-in, the registration answers (job title, company...) and attended/absent. Each registrant is a
 *    lead (`source = webinar_live`, `origin = zoom`, `attended` true/false); a registrant who later attends is updated to attended.
 *    Leads have no approval step, so the client sees registrants as they sign up.
 * 3. Numbers, once the event is over: registrants and attendees as `pending` metrics (skipped if the placement already has them).
 * 4. Recordings. Hub videos carry the event they were recorded from (`source_event_id`), so the recording link and the Zoom title
 *    go straight onto the placement when it has no link yet.
 * 5. On-demand viewers. The hub's on-demand channel registrations list who watched which video; each viewer of a client's
 *    recording becomes a lead for that placement (`source = webinar_on_demand`). Tally sign-ups for the same person dedupe on email.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

// Until the API keys are added as GitHub secrets the scheduled run just says so and stops, instead of failing every time.
const missingKey = ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"].filter((k) => !process.env[k]);
if (missingKey.length) { console.log(`Not set up yet: add ${missingKey.join(", ")} as GitHub Actions secrets. Nothing was read or written.`); process.exit(0); }
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (GitHub Actions secret, or .env.local)`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry");
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 400);
const ZOOM = "https://api.zoom.us/v2";

const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
let token = "";
async function auth() {
  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Zoom sign-in failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  token = (await r.json()).access_token;
}
async function zoom(path: string, tries = 5): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(`${ZOOM}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return r.json();
    if (r.status === 401 && i < 1) { await auth(); continue; }
    if ((r.status === 429 || r.status >= 500) && i < tries) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`${r.status} for ${path.replace(/\?.*/, "")}: ${(await r.text()).slice(0, 200)}`);
  }
}
/** Every page of a Zoom list. */
async function all(path: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let next = "";
  for (let i = 0; i < 200; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await zoom(`${path}${sep}page_size=300${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`);
    out.push(...(r[key] ?? []));
    next = r.next_page_token ?? "";
    if (!next) break;
  }
  return out;
}

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDay = (iso: string) => ET.format(new Date(iso));
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const squash = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Companies that present under another name: the key appears in Zoom titles, the value in the client's name. */
const PRESENTS_AS: Record<string, string> = { itron: "locusview" };

/** Registration answers -> lead columns. Zoom question titles are free text, so match loosely. */
function answers(reg: any) {
  const out: Record<string, string> = {};
  for (const t of reg.tickets ?? []) for (const q of t.questions ?? []) {
    const title = String(q.title ?? "").toLowerCase(), a = String(q.answer ?? "").trim();
    if (!a) continue;
    if (/job ?title|title|role|position/.test(title) && !out.job_title) out.job_title = a;
    else if (/company size|employees|organization size/.test(title)) out.company_size = a;
    else if (/company|organi[sz]ation|employer|utility name/.test(title) && !out.company) out.company = a;
    else if (/phone/.test(title)) out.phone = a;
    else if (/city/.test(title)) out.city = a;
    else if (/state|province/.test(title)) out.state = a;
    else if (/country/.test(title)) out.country = a;
  }
  return out;
}

async function main() {
  const { data: run } = DRY ? { data: null } : await db.from("sync_runs").insert({ source: "zoom" }).select("id").single();
  let written = 0;
  const problems: string[] = [];
  try {
    await auth();
    if (process.argv.includes("--probe")) {
      // What this app can see: counts only, no personal data.
      const tryIt = async (label: string, path: string, key: string) => { try { const r = await zoom(path); console.log(`${label}: ${(r[key] ?? []).length} (total_records ${r.total_records ?? "?"})${(r[key] ?? [])[0] ? ` first keys ${Object.keys(r[key][0]).join(",")}` : ""}`); return r[key] ?? []; } catch (e) { console.log(`${label}: ERROR ${(e as Error).message.slice(0, 200)}`); return []; } };
      const hubs = await tryIt("hubs host", `/zoom_events/hubs?role_type=host`, "hubs");
      for (const st of ["past", "upcoming", "draft"]) { await tryIt(`events host ${st}`, `/zoom_events/events?role_type=host&event_status_type=${st}&page_size=300`, "events"); await tryIt(`events attendee ${st}`, `/zoom_events/events?role_type=attendee&event_status_type=${st}&page_size=300`, "events"); }
      for (const h of hubs) {
        await tryIt(`hub ${h.name} events past`, `/zoom_events/events?role_type=host&event_status_type=past&hub_id=${h.hub_id}&page_size=300`, "events");
        const vids = await tryIt(`hub ${h.name} videos`, `/zoom_events/hubs/${h.hub_id}/videos?page_size=300`, "videos");
        console.log(`  videos with source_event_id: ${vids.filter((v: any) => v.source_event_id).length}; source types ${[...new Set(vids.map((v: any) => v.source_type))].join(",")}; sample: ${vids.slice(0, 4).map((v: any) => `${v.name} | ${v.source_type} | ev ${v.source_event_id ? "yes" : "no"} | ${String(v.play_link ?? "").replace(/[?].*/, "")}`).join(" ;; ")}`);
        const withEv = vids.find((v: any) => v.source_event_id);
        if (withEv) { await tryIt(`registration report for "${withEv.name}"`, `/zoom_events/events/${withEv.source_event_id}/reports/ticket_registration?page_size=30`, "registrations"); await tryIt(`attendance report`, `/zoom_events/events/${withEv.source_event_id}/reports/event_attendance?page_size=30`, "attendees"); try { const ev = await zoom(`/zoom_events/events/${withEv.source_event_id}`); console.log(`event detail keys: ${Object.keys(ev).join(",")}; start ${ev.start_time}; name ${ev.name}`); } catch (e) { console.log(`event detail: ERROR ${(e as Error).message.slice(0, 160)}`); } }
        const chans = await tryIt(`hub ${h.name} vod channels`, `/zoom_events/hubs/${h.hub_id}/vod_channels?page_size=300`, "vod_channels");
        console.log(`  channels: ${chans.map((c: any) => `${c.name} (${c.channel_id ?? c.id})`).join("; ")}`);
      }
      return;
    }
    const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);

    // Placements: webinars and PowerSessions on a campaign (clients never see the rest), plus the client names to match on.
    const { data: clients } = await db.from("clients").select("id, name");
    const nameOf = new Map((clients ?? []).map((c) => [c.id, c.name as string]));
    const { data: dels, error } = await db.from("deliverables")
      .select("id, client_id, campaign_id, notion_page_id, deliverable_type, inventory_tag, start_date, zoom_event_id, live_url, display_title, metrics(metric)")
      .in("deliverable_type", ["webinar", "powersession"]).gte("start_date", since);
    if (error) throw error;
    const placements = (dels ?? []).filter((d) => d.campaign_id || !d.notion_page_id);

    // 1. Events (past and upcoming) -> placements.
    // Events are listed per hub as well as for the app owner: most sessions are hosted by other people on the team.
    const hubList: any[] = await zoom(`/zoom_events/hubs?role_type=host`).then((r) => r.hubs ?? []).catch((e) => { problems.push(`Hubs: ${e.message.slice(0, 160)}`); return []; });
    console.log(`Hubs: ${hubList.map((h) => `${h.name} (${h.hub_id})`).join("; ") || "none"}`);
    const seenEv = new Map<string, any>();
    const scopes = ["", ...hubList.map((h) => `&hub_id=${h.hub_id}`)];
    for (const sc of scopes) for (const q of [`event_status_type=past`, `event_status_type=upcoming`]) {
      const list = await all(`/zoom_events/events?role_type=host&${q}${sc}`, "events").catch((e) => { problems.push(`Events (${q}${sc}): ${e.message.slice(0, 160)}`); return []; });
      // Zoom's own `from` filter returns nothing for hub events, so the date cut is made here.
      for (const ev of list) if (ev.start_time && etDay(ev.start_time) >= since) seenEv.set(ev.event_id, ev);
    }
    const events = [...seenEv.values()];
    console.log(`Zoom events: ${events.length}. Webinar/PowerSession placements since ${since}: ${placements.length}.`);
    const matched = new Map<string, any>(); // event_id -> placement
    for (const ev of events) {
      if (!ev.start_time) continue;
      const day = etDay(ev.start_time), title = squash(ev.name);
      const sameDay = placements.filter((d) => d.start_date && dayDiff(d.start_date, day) <= 1);
      let hit = placements.find((d) => d.zoom_event_id === ev.event_id);
      // Internal test and template events never belong to a client.
      if (!hit && /\b(test|testing|template|duplication)\b|^(my|y) event/i.test(ev.name)) continue;
      if (!hit) {
        const tw = (t: string) => new Set(String(t ?? "").replace(/^.*?\bpresents\s*[:|]\s*/i, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
        const like = (a: string, b: string) => { const A = tw(a), B = tw(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
        // 1. Same title as the placement's client-facing name, within 3 days.
        const byTitle = placements.filter((d) => d.start_date && dayDiff(d.start_date, day) <= 3 && d.display_title && like(ev.name, d.display_title) >= 0.6);
        // 2. The client's name in the event title (Zoom event titles usually leave it out).
        const byName = sameDay.filter((d) => {
          const client = squash(nameOf.get(d.client_id) ?? "");
          const first = squash((nameOf.get(d.client_id) ?? "").split(/\s+/)[0]);
          return (first.length >= 3 && title.includes(first)) || title.includes(client)
            || Object.entries(PRESENTS_AS).some(([as, real]) => title.includes(as) && client.includes(real));
        });
        // 3. The only webinar/PowerSession booked that exact day, unless its own name clearly says something else.
        const onDay = sameDay.filter((d) => dayDiff(d.start_date!, day) === 0);
        if (byTitle.length === 1) hit = byTitle[0];
        else if (byName.length === 1) hit = byName[0];
        else if (!byTitle.length && !byName.length && onDay.length === 1 && (!onDay[0].display_title || like(ev.name, onDay[0].display_title) >= 0.3)) hit = onDay[0];
      }
      if (!hit) { if (sameDay.length || /presents/i.test(ev.name)) problems.push(`Event "${ev.name}" (${day}): no single placement matches (${sameDay.map((d) => `${nameOf.get(d.client_id)} ${d.start_date} ${d.inventory_tag ?? ""}`).join("; ") || "none that day"})`); continue; }
      matched.set(ev.event_id, { ...hit, _event: ev });
    }
    console.log(`Matched ${matched.size} events to placements.`);
    if (DRY) for (const ev of events) console.log(`  event ${ev.start_time ? etDay(ev.start_time) : "?"} | ${ev.name} | ${matched.has(ev.event_id) ? "matched" : "-"}`);

    // 2 and 3. Registrations, attendance, numbers.
    const leadRows: any[] = [];
    const metricRows: any[] = [];
    const placementPatch = new Map<string, Record<string, unknown>>();
    const patch = (id: string, p: Record<string, unknown>) => placementPatch.set(id, { ...(placementPatch.get(id) ?? {}), ...p });
    for (const [eventId, d] of matched) {
      const ev = d._event;
      if (!d.zoom_event_id) patch(d.id, { zoom_event_id: eventId });
      let regs: any[] = [];
      try { regs = await all(`/zoom_events/events/${eventId}/reports/ticket_registration`, "registrations"); }
      catch (e) { problems.push(`"${ev.name}": registration report failed: ${(e as Error).message.slice(0, 120)}`); continue; }
      const people = new Map<string, any>();
      for (const r of regs) { const email = String(r.email ?? "").trim().toLowerCase(); if (email) people.set(email, r); }
      const over = ev.end_time ? Date.parse(ev.end_time) < Date.now() - 12 * 3600e3 : false;
      for (const [email, r] of people) {
        leadRows.push({ client_id: d.client_id, deliverable_id: d.id, source: "webinar_live", email, origin: "zoom",
          first_name: r.first_name || null, last_name: r.last_name || null, consent: typeof r.opt_in_marketing === "boolean" ? r.opt_in_marketing : null,
          attended: over ? r.event_attendance === "attended" : false, submitted_at: r.register_date ?? null, ...answers(r),
          raw: { zoom_event_id: eventId, registration_source: r.registration_source ?? null, questions: (r.tickets ?? []).flatMap((t: any) => t.questions ?? []) } });
      }
      if (over) {
        const have = new Set((d.metrics ?? []).map((m: any) => m.metric));
        const day = etDay(ev.start_time);
        const attended = [...people.values()].filter((r) => r.event_attendance === "attended").length;
        if (!have.has("registrants")) metricRows.push({ client_id: d.client_id, deliverable_id: d.id, metric: "registrants", value: people.size, window_start: day, window_end: day, source: "zoom", status: "pending" });
        if (!have.has("attendees")) metricRows.push({ client_id: d.client_id, deliverable_id: d.id, metric: "attendees", value: attended, window_start: day, window_end: day, source: "zoom", status: "pending" });
      }
      console.log(`- ${nameOf.get(d.client_id)} ${d.start_date} ${d.inventory_tag ?? ""}: "${ev.name}" ${people.size} registered${over ? `, ${[...people.values()].filter((r) => r.event_attendance === "attended").length} attended` : " (upcoming)"}`);
    }

    // 4 and 5. Recordings and on-demand viewers, from every hub.
    const hubs = hubList;
    // Hub videos carry no event id, so a recording belongs to the matched event with the same title.
    const words = (t: string) => new Set((t ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const sameTitle = (a: string, b: string) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(A.size, B.size) >= 0.8; };
    const strip = (t: string) => String(t ?? "").replace(/^.*?\bpresents\s*[:|]\s*/i, "");
    const forTitle = (title: string) => { const hits = [...matched.values()].filter((d) => sameTitle(strip(d._event.name), strip(title))); return hits.length === 1 ? hits[0] : undefined; };
    const placementByVideo = new Map<string, any>();
    for (const hub of hubs) {
      const videos = await all(`/zoom_events/hubs/${hub.hub_id}/videos`, "videos").catch((e) => { problems.push(`Hub "${hub.name}" videos: ${e.message.slice(0, 120)}`); return []; });
      for (const v of videos) {
        const d = forTitle(v.name);
        if (!d) continue;
        placementByVideo.set(v.video_id, d);
        if (!d.live_url && /^https:\/\/events\.zoom\.us\/.+\/recording\/.+/.test(String(v.play_link ?? ""))) patch(d.id, { live_url: v.play_link });
        if (!d.display_title && d._event?.name) patch(d.id, { display_title: d._event.name });
      }
      const channels = await all(`/zoom_events/hubs/${hub.hub_id}/vod_channels`, "vod_channels").catch((e) => { problems.push(`Hub "${hub.name}" channels: ${e.message.slice(0, 120)}`); return []; });
      for (const c of channels) {
        const ch = c.channel_id ?? c.id;
        const regs = await all(`/zoom_events/hubs/${hub.hub_id}/vod_channels/${ch}/reports/registrations`, "registrations").catch((e) => { problems.push(`On-demand channel "${c.name}": ${e.message.slice(0, 120)}`); return []; });
        for (const r of regs) {
          const email = String(r.email ?? "").trim().toLowerCase();
          if (!email) continue;
          for (const w of r.video_watch_duration ?? []) {
            const d = placementByVideo.get(w.video_id) ?? forTitle(w.video_name);
            if (!d || !(Number(w.duration) > 0)) continue;
            const a = answers({ tickets: [{ questions: r.questions ?? [] }] });
            leadRows.push({ client_id: d.client_id, deliverable_id: d.id, source: "webinar_on_demand", email, origin: "zoom",
              first_name: r.first_name || null, last_name: r.last_name || null, attended: null, ...a,
              raw: { zoom_video_id: w.video_id, watch_minutes: w.duration, questions: r.questions ?? [] } });
          }
        }
      }
    }

    // Write. Leads: new people are inserted; a registrant who has since attended is updated; nothing else is overwritten,
    // so leads loaded from the old sheets keep their details.
    const uniq = new Map(leadRows.map((l) => [`${l.client_id}|${l.deliverable_id}|${l.source}|${l.email}`, l]));
    const leads = [...uniq.values()];
    console.log(`\nLeads seen: ${leads.length} (${leads.filter((l) => l.source === "webinar_live").length} registrants, ${leads.filter((l) => l.source === "webinar_on_demand").length} on-demand). Numbers: ${metricRows.length}. Placement updates: ${placementPatch.size}.`);
    console.log(`Not matched (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n") || "- none"}`);
    if (DRY) { console.log(`\nDRY RUN: nothing was written.`); return; }

    let newLeads = 0, nowAttended = 0;
    const delIds = [...new Set(leads.map((l) => l.deliverable_id))];
    for (const id of delIds) {
      const mine = leads.filter((l) => l.deliverable_id === id);
      const { data: existing, error: e } = await db.from("leads").select("id, email, source, attended").eq("deliverable_id", id);
      if (e) throw e;
      const have = new Map((existing ?? []).map((x) => [`${x.source}|${x.email.toLowerCase()}`, x]));
      const fresh = mine.filter((l) => !have.has(`${l.source}|${l.email}`));
      for (let i = 0; i < fresh.length; i += 200) {
        const { error: e2 } = await db.from("leads").upsert(fresh.slice(i, i + 200), { onConflict: "client_id,deliverable_id,source,email", ignoreDuplicates: true });
        if (e2) throw e2;
      }
      newLeads += fresh.length;
      const upgraded = mine.filter((l) => l.attended === true && have.get(`${l.source}|${l.email}`)?.attended === false).map((l) => have.get(`${l.source}|${l.email}`)!.id);
      if (upgraded.length) { const { error: e3 } = await db.from("leads").update({ attended: true }).in("id", upgraded); if (e3) throw e3; nowAttended += upgraded.length; }
    }
    if (metricRows.length) { const { error: e } = await db.from("metrics").upsert(metricRows, { onConflict: "deliverable_id,metric,source,window_end", ignoreDuplicates: true }); if (e) throw e; }
    for (const [id, p] of placementPatch) { const { error: e } = await db.from("deliverables").update(p).eq("id", id); if (e) throw e; }
    written = newLeads + nowAttended + metricRows.length + placementPatch.size;
    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written,
      error: problems.length ? `${problems.length} events not matched (see the Action log)` : null }).eq("id", run!.id);
    console.log(`\nWrote ${newLeads} new leads, marked ${nowAttended} as attended, ${metricRows.length} numbers (pending), ${placementPatch.size} placement updates.`);
  } catch (e: any) {
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: String(e?.message ?? e).slice(0, 500) }).eq("id", run.id);
    console.error(e);
    process.exit(1);
  }
}

main();
