/* eslint-disable @typescript-eslint/no-explicit-any -- beehiiv and short.io responses are untyped JSON */
/**
 * beehiiv + short.io pull: newsletter issues, newsletter ad numbers, paid email blast numbers.
 * Run: npm run pull:beehiiv -- [--dry] [client-slug ...]     (no slugs = every client)
 *
 * 1. Newsletter issues. Every Daily and Weekly issue of the last 12 months is upserted into `newsletter_issues`
 *    (headline, opens, and the web link only when the post was published to the web), so newsletter ads link to their issue.
 * 2. Newsletter ad (Notion "Newsletter Ad", 14+ days after the run date)
 *    impressions = total opens of that day's issue (Isuri's SOP).
 *    clicks      = short.io human (bot-filtered) clicks on the ad's short link, all time, read once at 14+ days and then kept. The link is
 *                  found in the issue's own click list (energycentral.short.gy/<client>...) and saved on the placement.
 *                  A short link reused for a week of placements is counted once, on the first day.
 * 3. Paid email (Notion "Email Blast", 7+ days after the send)
 *    sent = delivered, opens = total opens, clicks = total raw clicks (matches the old sheets; CLAUDE.md).
 *    Matched by beehiiv tags (paid, not marketing; brand tag) or, for untagged posts, "paid" + client name in the title,
 *    sent within 2 days of Notion's date. The post id, subject line and (once the post is on the web) its link are saved.
 *
 * Rules: every number goes in as `pending` (or `flagged` with a reason) and reaches clients only after approval.
 * A placement that already has a value for a metric (from a legacy sheet or an earlier pull) is skipped for that metric,
 * so numbers never double up and a pulled number never changes once written. Placements with no campaign are skipped,
 * because clients never see them (CLAUDE.md). Every run is logged to `sync_runs`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BEEHIIV_API_KEY", "SHORTIO_API_KEY"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (GitHub Actions secret, or .env.local)`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const BEEHIIV = "https://api.beehiiv.com/v2";
const PUBS = { daily: "pub_9613cbe2-a104-42f5-8312-f1adf98462f8", weekly: "pub_8d2dba00-687a-41bb-8886-598e60f76740", marketing: "pub_3e34367e-3dd1-4676-83a0-c3e29f763041" };
const SHORT_DOMAIN = "energycentral.short.gy";
const DRY = process.argv.includes("--dry");

const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
async function getJson(url: string, headers: Record<string, string>, tries = 5): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < tries) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`${r.status} ${r.statusText} for ${url.replace(/\?.*/, "")}: ${(await r.text()).slice(0, 200)}`);
  }
}
const bh = (path: string) => getJson(`${BEEHIIV}${path}`, { Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}` });
const sio = (url: string) => getJson(url, { Authorization: process.env.SHORTIO_API_KEY!, Accept: "application/json" });

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (unix: number) => ET.format(new Date(unix * 1000));
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));
const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

type Post = { id: string; title: string; subject_line?: string; publish_date: number; platform?: string; web_url?: string; hidden_from_feed?: boolean; content_tags?: string[]; stats?: any };

/** All confirmed posts of a publication sent on or after `since`, newest first, with stats. */
async function postsSince(pub: string, since: string): Promise<Post[]> {
  const out: Post[] = [];
  for (let page = 1; page < 60; page++) {
    const r = await bh(`/publications/${pub}/posts?status=confirmed&limit=100&page=${page}&order_by=publish_date&direction=desc&expand[]=stats`);
    const batch = (r.data ?? []) as Post[];
    out.push(...batch);
    if (batch.length < 100 || (batch.length && etDate(batch[batch.length - 1].publish_date) < since)) break;
  }
  return out.filter((p) => p.publish_date && etDate(p.publish_date) >= since);
}
/** A post's web page exists only when it was published to the web (beehiiv platform "web" or "both"). */
const webUrl = (p: Post) => (p.platform && p.platform !== "email" && p.web_url ? p.web_url : null);
const tagsOf = (p: Post) => (p.content_tags ?? []).map((t: any) => String(typeof t === "string" ? t : t.display ?? t.slug).toLowerCase());

/** short.io cities are GeoNames ids. The ones seen so far; anything else shows as "location <id>". "City unknown" is ignored. */
const CITY: Record<string, string> = { "4744870": "Ashburn, VA (data centers)", "5308655": "Phoenix, AZ", "4726206": "San Antonio, TX",
  "4509177": "Columbus, OH", "2925533": "Frankfurt, Germany", "6167865": "Toronto, Canada", "5368361": "Los Angeles, CA" };
const UNKNOWN_CITY = "6252001";
async function shortClicks(path: string, from: string, to: string) {
  const link = await sio(`https://api.short.io/links/expand?domain=${SHORT_DOMAIN}&path=${encodeURIComponent(path)}`);
  const id = String(link.idString ?? link.id);
  // All-time human clicks, read once the placement is 14+ days old and never re-read: the method behind the old sheets
  // (Chloe, Nov 12 2026). short.io's custom date window undercounts against them (Semtech Feb 26 2026: 6 in the window, 28 on the sheet).
  void from; void to;
  const s = await sio(`https://statistics.short.io/statistics/link/${id}?period=total&tz=America/New_York`);
  await sleep(400);
  const c = ((s.city ?? []) as any[]).filter((x) => String(x.city) !== UNKNOWN_CITY).sort((a, b) => b.score - a.score)[0];
  return { id, human: num(s.humanClicks) ?? 0, total: num(s.totalClicks) ?? 0, top: c ? { name: CITY[c.city] ?? `location ${c.city}`, clicks: Number(c.score) } : null };
}

/** First word of the client name, letters and digits only: "SSP Innovations" -> "ssp", "Semtech" -> "semte". */
const token = (name: string) => name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "").slice(0, 5);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isMarketing = (p: Post) => tagsOf(p).some((t) => t.includes("marketing email"));
const paidTag = (p: Post) => tagsOf(p).some((t) => t === "paid email" || t === "type: paid partner email blast");
/** Paid sends only. A post tagged both paid and marketing counts as paid when its title says "paid". */
const isPaid = (p: Post) => (paidTag(p) && (!isMarketing(p) || /\bpaid\b/i.test(p.title))) || (!tagsOf(p).length && /\bpaid\b/i.test(p.title));
/** beehiiv brand tags that use a short name: tag text -> client name. */
const BRAND_ALIASES: Record<string, string> = { ltm: "ltimindtree" };
const brandMatches = (p: Post, client: string) => {
  const brand = tagsOf(p).filter((t) => t.startsWith("brand:"));
  const alias = Object.entries(BRAND_ALIASES).filter(([, real]) => squash(client).startsWith(real)).map(([as]) => as);
  const hit = (text: string) => squash(text).includes(token(client)) || alias.some((a) => new RegExp(`\\b${a}\\b`, "i").test(text.replace(/^brand:\s*/i, "")));
  return brand.length ? brand.some(hit) : hit(p.title);
};
const isDailyIssue = (p: Post) => tagsOf(p).includes("daily newsletter")
  || (!tagsOf(p).length && new Date(p.publish_date * 1000).getUTCHours() >= 10 && new Date(p.publish_date * 1000).getUTCHours() <= 13 && !/promo|paid|webinar|powersession|trivia/i.test(p.title));

type Row = { client_id: string; deliverable_id: string; metric: string; value: number; window_start: string; window_end: string; source: string; status: string; flag_reason: string | null; type: string };

async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const { data: run } = DRY ? { data: null } : await db.from("sync_runs").insert({ source: "beehiiv" }).select("id").single();
  let written = 0;
  try {
    let q = db.from("clients").select("id, name, slug");
    if (slugs.length) q = q.in("slug", slugs);
    const { data: clients, error } = await q;
    if (error) throw error;
    const byId = new Map((clients ?? []).map((c) => [c.id, c]));

    const since = addDays(today, -365);
    const [daily, weekly, mkt] = await Promise.all([postsSince(PUBS.daily, since), postsSince(PUBS.weekly, since), postsSince(PUBS.marketing, since)]);
    console.log(`beehiiv since ${since}: Daily pub ${daily.length} posts, Weekly ${weekly.length}, Marketing ${mkt.length}.`);

    // 1. Newsletter issues.
    const issues = [
      ...daily.filter(isDailyIssue).map((p) => ({ publication: "daily", p })),
      ...weekly.map((p) => ({ publication: "weekly", p })),
    ];
    const seen = new Set<string>();
    const issueRows = issues.filter(({ publication, p }) => { const k = `${publication}:${etDate(p.publish_date)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(({ publication, p }) => ({ publication, issue_date: etDate(p.publish_date), title: p.title, web_url: webUrl(p), beehiiv_post_id: p.id,
        sent_at: new Date(p.publish_date * 1000).toISOString(), total_opens: num(p.stats?.email?.opens), unique_opens: num(p.stats?.email?.unique_opens),
        recipients: num(p.stats?.email?.recipients ?? p.stats?.email?.delivered), pulled_at: new Date().toISOString() }));
    if (!DRY && issueRows.length) {
      const { error: e } = await db.from("newsletter_issues").upsert(issueRows, { onConflict: "publication,issue_date" });
      if (e) throw e;
      written += issueRows.length;
    }
    console.log(`Newsletter issues: ${issueRows.length} (${issueRows.filter((r) => r.web_url).length} with a web page).`);
    const issueFor = new Map(issueRows.map((r) => [`${r.publication}:${r.issue_date}`, r.beehiiv_post_id]));
    const postById = new Map([...daily, ...weekly, ...mkt].map((p) => [p.id, p]));

    // 2 and 3. What's due: newsletter ads 14+ days old and paid emails 7+ days old, last 12 months, attached to a campaign.
    const ids = (clients ?? []).map((c) => c.id);
    const dels: any[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error: e2 } = await db.from("deliverables")
        .select("id, client_id, campaign_id, notion_page_id, deliverable_type, deliverable_label, inventory_tag, start_date, ec_brand, short_link, display_title, live_url, beehiiv_post_id, metrics(metric, value, source, status)")
        .in("client_id", ids.slice(i, i + 50)).in("deliverable_type", ["newsletter_ad", "email_blast"]).gte("start_date", since).order("start_date");
      if (e2) throw e2;
      dels.push(...(data ?? []));
    }
    const visible = dels.filter((d) => d.campaign_id || !d.notion_page_id);
    const due = visible.filter((d) => d.start_date <= addDays(today, d.deliverable_type === "newsletter_ad" ? -14 : -7));
    console.log(`Placements due: ${due.length} (${due.filter((d) => d.deliverable_type === "newsletter_ad").length} newsletter ads, ${due.filter((d) => d.deliverable_type === "email_blast").length} paid emails).`);

    const rows: Row[] = [];
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const problems: string[] = [];
    const usedPosts = new Set(dels.map((d) => d.beehiiv_post_id).filter(Boolean));
    const usedLinks = new Map<string, string>();
    const has = (d: any, metric: string) => (d.metrics as any[]).some((m) => m.metric === metric);
    const add = (d: any, metric: string, value: number | null, source: string, from: string, to: string, reason: string | null = null) => {
      if (value == null || Number.isNaN(value) || has(d, metric)) return;
      rows.push({ client_id: d.client_id, deliverable_id: d.id, metric, value, window_start: from, window_end: to, source, status: reason ? "flagged" : "pending", flag_reason: reason, type: d.deliverable_type });
    };

    // Short links of a newsletter ad, read from its issue's click list.
    const adLinks = (d: any) => {
      const client = byId.get(d.client_id)!;
      const pub = (d.ec_brand ?? []).some((b: string) => /weekly/i.test(b)) ? "weekly" : "daily";
      let issueId = issueFor.get(`${pub}:${d.start_date}`);
      for (let k = 1; !issueId && pub === "weekly" && k <= 6; k++) issueId = issueFor.get(`weekly:${addDays(d.start_date, k)}`);
      const issue = issueId ? postById.get(issueId) : undefined;
      const urls = ((issue?.stats?.clicks ?? []) as any[]).map((c) => { try { return new URL(c.url); } catch { return null; } })
        .filter((u): u is URL => !!u && u.host === SHORT_DOMAIN && squash(u.pathname).startsWith(token(client.name)));
      return [...new Set(urls.map((u) => u.pathname.slice(1)))];
    };
    // Links already counted on any placement that has clicks (a legacy sheet or an earlier run) are used up before anything
    // is written, whatever order placements come in: a shared weekly link, or Hero + 1st Spot on one day, is counted once, ever.
    due.sort((a, b) => a.start_date.localeCompare(b.start_date) || String(a.inventory_tag).localeCompare(String(b.inventory_tag)));
    for (const d of due) if (d.deliverable_type === "newsletter_ad" && has(d, "clicks")) for (const path of adLinks(d)) if (!usedLinks.has(path)) usedLinks.set(path, d.start_date);

    for (const d of due) {
      const client = byId.get(d.client_id)!;
      const label = `${client.name} ${d.start_date} ${d.inventory_tag ?? "no EC tag"}`;
      if (d.deliverable_type === "newsletter_ad") {
        const pub = (d.ec_brand ?? []).some((b: string) => /weekly/i.test(b)) ? "weekly" : "daily";
        // The Weekly goes out once a week: use the issue sent on the run date or the closest one in the 6 days after it.
        let issueId = issueFor.get(`${pub}:${d.start_date}`);
        for (let k = 1; !issueId && pub === "weekly" && k <= 6; k++) issueId = issueFor.get(`weekly:${addDays(d.start_date, k)}`);
        const issue = issueId ? postById.get(issueId) : undefined;
        if (!issue) { problems.push(`${label}: no ${pub === "weekly" ? "Weekly" : "Daily"} issue that day`); continue; }
        const from = d.start_date, to = addDays(d.start_date, 14);
        add(d, "impressions", num(issue.stats?.email?.opens), "beehiiv", from, to);
        const links = ((issue.stats?.clicks ?? []) as any[]).map((c) => { try { return new URL(c.url); } catch { return null; } })
          .filter((u): u is URL => !!u && u.host === SHORT_DOMAIN && squash(u.pathname).startsWith(token(client.name)));
        const paths = [...new Set(links.map((u) => u.pathname.slice(1)))];
        // A placement that already has clicks (a legacy sheet or an earlier run) has used its links: mark them, so a later
        // day sharing the same weekly link is never counted again on a second run.
        if (has(d, "clicks")) { for (const path of paths) if (!usedLinks.has(path)) usedLinks.set(path, d.start_date); continue; }
        if (!paths.length) { problems.push(`${label}: no ${client.name} short link in the issue's clicks; clicks not pulled`); continue; }
        let human = 0, total = 0, top: { name: string; clicks: number } | null = null;
        const counted: string[] = [];
        for (const path of paths) {
          if (usedLinks.has(path)) continue;          // same link, earlier day of the same week: already counted there
          usedLinks.set(path, d.start_date);
          try {
            const s = await shortClicks(path, from, to);
            human += s.human; total += s.total; counted.push(path);
            if (s.top && (!top || s.top.clicks > top.clicks)) top = s.top;
            if (!d.short_link) updates.push({ id: d.id, patch: { short_link: `https://${SHORT_DOMAIN}/${path}`, short_link_id: s.id } });
          } catch (err) { problems.push(`${label}: short.io error on ${path}: ${(err as Error).message.slice(0, 100)}`); }
        }
        if (!counted.length) { problems.push(`${label}: short link ${paths.join(", ")} already counted on an earlier day; no clicks added here`); continue; }
        rows.push({ client_id: d.client_id, deliverable_id: d.id, metric: "clicks", value: human, window_start: from, window_end: to, source: "shortio",
          status: "pending", flag_reason: null, type: d.deliverable_type, ...({ _top: top, _total: total, _paths: counted } as any) });
      } else {
        const near = [...mkt, ...daily].filter((p) => Math.abs(Date.parse(etDate(p.publish_date)) - Date.parse(d.start_date)) <= 2 * 864e5
          && isPaid(p) && brandMatches(p, client.name) && (!usedPosts.has(p.id) || p.id === d.beehiiv_post_id));
        const post = d.beehiiv_post_id ? postById.get(d.beehiiv_post_id) : near.length === 1 ? near[0] : undefined;
        if (!post) { problems.push(`${label}: ${near.length} matching paid emails within 2 days (${near.map((p) => `"${p.title}"`).join(", ") || "none"})`); continue; }
        usedPosts.add(post.id);
        const e = post.stats?.email ?? {};
        const from = d.start_date, to = addDays(d.start_date, 7);
        add(d, "sent", num(e.delivered), "beehiiv", from, to);
        add(d, "opens", num(e.opens), "beehiiv", from, to);
        add(d, "clicks", num(e.clicks), "beehiiv", from, to);
        const patch: Record<string, unknown> = {};
        if (!d.beehiiv_post_id) patch.beehiiv_post_id = post.id;
        if (!d.display_title && (post.subject_line || post.title)) patch.display_title = post.subject_line || post.title;
        if (!d.live_url && webUrl(post)) patch.live_url = webUrl(post);
        if (Object.keys(patch).length) updates.push({ id: d.id, patch });
      }
    }

    // Flagging. Outlier rule (Chloe, Nov 12 2026): ad clicks at least 2x the client's median with one city holding 40%+ of them
    // look like a bot farm: report the clicks minus that city, flagged. Any other value more than 3x above or below the client's
    // median for that metric and placement type is flagged for a second look (CLAUDE.md task 6). Medians need 3+ other values.
    const known = (clientId: string, type: string, metric: string, self: Row) => [
      ...dels.filter((d) => d.client_id === clientId && d.deliverable_type === type).flatMap((d) => (d.metrics as any[]).filter((m) => m.metric === metric).map((m) => Number(m.value))),
      ...rows.filter((r) => r !== self && r.client_id === clientId && r.type === type && r.metric === metric).map((r) => r.value),
    ].filter((v) => v > 0).sort((a, b) => a - b);
    for (const r of rows) {
      const peers = known(r.client_id, r.type, r.metric, r);
      const median = peers.length >= 3 ? peers[Math.floor(peers.length / 2)] : null;
      const top = (r as any)._top as { name: string; clicks: number } | null;
      if (r.metric === "clicks" && r.source === "shortio" && median && top && r.value >= 2 * median && top.clicks / r.value >= 0.4) {
        r.flag_reason = `Bot pattern: ${fmt(r.value)} clicks, ${fmt(top.clicks)} from ${top.name} (${Math.round((top.clicks / r.value) * 100)}%). Reported without that city. Client median ${fmt(median)}.`;
        r.value -= top.clicks; r.status = "flagged";
      } else if (median && (r.value > 3 * median || r.value < median / 3)) {
        r.flag_reason = `${fmt(r.value)} vs this client's usual ${fmt(median)} for this placement type (more than 3x off).`; r.status = "flagged";
      }
    }

    // Report and write.
    console.log(`\n| Client | Date | Placement | Metric | Value | Status | Note |\n|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      const d = dels.find((x) => x.id === r.deliverable_id)!;
      console.log(`| ${byId.get(r.client_id)!.name} | ${d.start_date} | ${d.deliverable_type === "newsletter_ad" ? "Newsletter ad" : "Paid email"} ${d.inventory_tag ?? ""} | ${r.metric} (${r.source}) | ${fmt(r.value)} | ${r.status} | ${r.flag_reason ?? ((r as any)._paths ? `${(r as any)._paths.join(", ")}; all clicks ${fmt((r as any)._total)}` : "")} |`);
    }
    console.log(`\nPlacement updates (short link, post id, subject line, web link): ${updates.length}`);
    console.log(`\nNot pulled (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n") || "- none"}`);

    if (DRY) { console.log(`\nDRY RUN: nothing was written.`); return; }
    const clean = rows.map((r) => { const o: any = { ...r }; delete o.type; delete o._top; delete o._total; delete o._paths; return o; });
    for (let i = 0; i < clean.length; i += 200) {
      const { error: e } = await db.from("metrics").upsert(clean.slice(i, i + 200), { onConflict: "deliverable_id,metric,source,window_end", ignoreDuplicates: true });
      if (e) throw e;
    }
    for (const u of updates) { const { error: e } = await db.from("deliverables").update(u.patch).eq("id", u.id); if (e) throw e; }
    written += clean.length + updates.length;
    await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: written,
      error: problems.length ? `${problems.length} placements not pulled (see the Action log)` : null }).eq("id", run!.id);
    console.log(`\nWrote ${clean.length} numbers (pending approval) and ${updates.length} placement updates.`);
  } catch (e: any) {
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), records_written: written, error: String(e?.message ?? e).slice(0, 500) }).eq("id", run.id);
    console.error(e);
    process.exit(1);
  }
}

main();
