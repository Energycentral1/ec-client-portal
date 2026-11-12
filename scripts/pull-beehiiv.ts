/* eslint-disable @typescript-eslint/no-explicit-any -- beehiiv and short.io responses are untyped JSON */
/**
 * beehiiv + short.io pull for newsletter ads and paid email blasts.
 * Run: npm run pull:beehiiv -- [client-slug ...]      (DRY RUN: reads only, prints a comparison table, writes nothing)
 *
 * Newsletter ad (Notion "Newsletter Ad", 14+ days after the run date)
 *   impressions = total opens of that day's Daily issue (Isuri's SOP); the issue headline and web link come along.
 *   clicks      = short.io human clicks on the ad's short link, counted from the run date to run date + 14 days.
 *                 The short link is found in the issue's own click list (energycentral.short.gy/<client>...), so nobody
 *                 has to type it in. beehiiv's own click counts for that link are printed alongside for comparison.
 * Paid email (Notion "Email Blast", 7+ days after the send)
 *   sent = delivered, opens = total opens, clicks = total raw clicks (matches the old sheets; CLAUDE.md).
 *   Matched in the "Energy Central Marketing" publication by client name in the title or subject line and a send date
 *   within 2 days of Notion's. Anything without exactly one match is listed, never guessed.
 *
 * This first version is read-only on every system: beehiiv, short.io and Supabase. Writing comes after the dry run is checked.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BEEHIIV_API_KEY", "SHORTIO_API_KEY"]) {
  if (!process.env[k]) { console.error(`Missing ${k} (GitHub Actions secret, or .env.local)`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const BEEHIIV = "https://api.beehiiv.com/v2";
const DAILY_PUB = "pub_9613cbe2-a104-42f5-8312-f1adf98462f8";
const SHORT_DOMAIN = "energycentral.short.gy";

async function getJson(url: string, headers: Record<string, string>, tries = 4): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < tries) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
    throw new Error(`${r.status} ${r.statusText} for ${url.replace(/\?.*/, "")}: ${(await r.text()).slice(0, 200)}`);
  }
}
const bh = (path: string) => getJson(`${BEEHIIV}${path}`, { Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}` });
const sio = (url: string) => getJson(url, { Authorization: process.env.SHORTIO_API_KEY!, Accept: "application/json" });

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (unix: number) => ET.format(new Date(unix * 1000));
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));

type Post = { id: string; title: string; subject_line?: string; publish_date: number; platform?: string; web_url?: string; stats?: any };

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

/** Short.io: total and human (bot-filtered) clicks for one short path inside a date window. */
async function shortClicks(path: string, from: string, to: string) {
  const link = await sio(`https://api.short.io/links/expand?domain=${SHORT_DOMAIN}&path=${encodeURIComponent(path)}`);
  const id = link.idString ?? link.id;
  const s = await sio(`https://statistics.short.io/statistics/link/${id}?period=custom&startDate=${from}&endDate=${to}&tz=America/New_York`);
  const all = await sio(`https://statistics.short.io/statistics/link/${id}?period=total&tz=America/New_York`);
  const top = (rows: any[], key: string) => (rows ?? []).slice().sort((a, b) => b.score - a.score).slice(0, 3).map((r) => `${r[key] ?? r.city ?? r.country} ${r.score}`).join(", ");
  return { total: num(s.totalClicks), human: num(s.humanClicks), allTotal: num(all.totalClicks), allHuman: num(all.humanClicks), id,
    topCity: (all.city ?? []).length ? (() => { const c = all.city.slice().sort((a: any, b: any) => b.score - a.score)[0]; return { name: CITY[c.city] ?? `location ${c.city}`, clicks: c.score as number }; })() : null,
    where: `cities: ${top(all.city, "cityName")}; countries: ${top(all.country, "countryName")}; keys: ${Object.keys(all).join(",")}` };
}

/** short.io reports cities as GeoNames ids. The ones seen so far; anything else shows as "location <id>". */
const CITY: Record<string, string> = { "4744870": "Ashburn, VA (data centers)", "6252001": "United States, city unknown", "5308655": "Phoenix, AZ",
  "4726206": "San Antonio, TX", "4509177": "Columbus, OH", "2925533": "Frankfurt, Germany", "6167865": "Toronto, Canada", "5368361": "Los Angeles, CA" };
const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const token = (name: string) => name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "").slice(0, 5);
/** beehiiv content tags say what a send was. Daily publication (before June 2026): "type: paid partner email blast" vs
 *  "type: marketing email"; Marketing publication: "paid email" vs "marketing email". Only paid sends are reported. */
const tagsOf = (p: Post) => ((p as any).content_tags ?? []).map((t: string) => t.toLowerCase());
const isPaid = (p: Post) => tagsOf(p).some((t: string) => t === "paid email" || t === "type: paid partner email blast") && !tagsOf(p).some((t: string) => t.includes("marketing email"));
const brandMatches = (p: Post, client: string) => tagsOf(p).some((t: string) => t.startsWith("brand:") && t.replace(/[^a-z0-9]/g, "").includes(token(client)));

async function main() {
  const slugs = process.argv.slice(2).filter(Boolean);
  const wanted = slugs.length ? slugs : ["semtech", "ssp-innovations"];
  const { data: clients, error } = await db.from("clients").select("id, name, slug").in("slug", wanted);
  if (error) throw error;

  // What's due: newsletter ads 14+ days old and email blasts 7+ days old, over the last 12 months.
  const since = addDays(today, -365);
  const { data: dels, error: e2 } = await db.from("deliverables")
    .select("id, client_id, deliverable_type, deliverable_label, inventory_tag, start_date, ec_brand, metrics(metric, value, source, status)")
    .in("client_id", (clients ?? []).map((c) => c.id)).in("deliverable_type", ["newsletter_ad", "email_blast"])
    .gte("start_date", since).order("start_date");
  if (e2) throw e2;
  const due = (dels ?? []).filter((d) => d.start_date! <= addDays(today, d.deliverable_type === "newsletter_ad" ? -14 : -7));
  console.log(`Clients: ${(clients ?? []).map((c) => c.name).join(", ")}. Placements due: ${due.length}.\n`);

  // beehiiv: the Daily, and the Marketing publication for paid emails.
  const pubs = (await bh(`/publications?limit=100`)).data as { id: string; name: string }[];
  const marketing = pubs.find((p) => /marketing/i.test(p.name));
  console.log(`beehiiv publications: ${pubs.map((p) => `${p.name} (${p.id})`).join("; ")}`);
  const daily = await postsSince(DAILY_PUB, since);
  // The Daily publication also sends promo emails; the newsletter_issues table holds the actual Daily issue for each date.
  const { data: issueRows } = await db.from("newsletter_issues").select("issue_date, beehiiv_post_id").eq("publication", "daily").gte("issue_date", since);
  const issueId = new Map((issueRows ?? []).map((r) => [r.issue_date as string, r.beehiiv_post_id as string]));
  const mkt = marketing ? await postsSince(marketing.id, since) : [];
  console.log(`Daily issues since ${since}: ${daily.length}. Marketing posts: ${mkt.length}.`);
  if (daily[0]) console.log(`Shape check, stats fields on one Daily issue: ${JSON.stringify(Object.keys(daily[0].stats ?? {}))}, email: ${JSON.stringify(daily[0].stats?.email ?? {})}`);

  const lines: string[] = [];
  const usedPosts = new Set<string>();
  const usedLinks = new Map<string, string>(); // short path -> first placement date it was counted for
  // Clicks per client for the outlier check, filled as links are read.
  const clickLog: { client: string; date: string; path: string; human: number; top: { name: string; clicks: number } | null }[] = [];
  const problems: string[] = [];
  for (const d of due) {
    const client = clients!.find((c) => c.id === d.client_id)!;
    const had = (k: string) => (d.metrics as any[]).filter((m) => m.metric === k).map((m) => `${fmt(Number(m.value))} (${m.source}${m.status === "approved" ? "" : `, ${m.status}`})`).join(" / ") || "—";
    const tag = d.inventory_tag ?? "no EC tag";
    if (d.deliverable_type === "newsletter_ad") {
      if ((d.ec_brand ?? []).some((b: string) => /weekly/i.test(b))) { problems.push(`${client.name} ${d.start_date} ${tag}: runs in the Weekly; not handled yet`); continue; }
      const issue = daily.find((p) => p.id === issueId.get(d.start_date!))
        ?? daily.find((p) => etDate(p.publish_date) === d.start_date && !/^(email|.*\b(ps|email) ?[-#])/i.test(p.title));
      if (!issue) { problems.push(`${client.name} ${d.start_date} ${tag}: no Daily issue sent that day`); continue; }
      const opens = num(issue.stats?.email?.opens);
      // The ad's short link, from the issue's own click list.
      const links = ((issue.stats?.clicks ?? []) as any[]).filter((c) => {
        try { const u = new URL(c.url); return u.host === SHORT_DOMAIN && u.pathname.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(token(client.name).slice(0, 5)); } catch { return false; }
      });
      let clickCell = `no short link found in the issue (short links in it: ${((issue.stats?.clicks ?? []) as any[]).map((c) => { try { const u = new URL(c.url); return u.host === SHORT_DOMAIN ? u.pathname.slice(1) : null; } catch { return null; } }).filter(Boolean).join(", ") || "none"})`;
      if (links.length) {
        const parts: string[] = [];
        for (const l of links) {
          const path = new URL(l.url).pathname.slice(1);
          // One short link used for a whole week of placements: count it once, on the first day it ran.
          if (usedLinks.has(path)) { parts.push(`${path}: counted with ${usedLinks.get(path)}`); continue; }
          usedLinks.set(path, d.start_date!);
          const bhTotal = num(l.email?.clicks ?? l.total_clicks), bhUnique = num(l.email?.unique_clicks ?? l.total_unique_clicks);
          try {
            const s = await shortClicks(path, d.start_date!, addDays(d.start_date!, 14));
            clickLog.push({ client: client.name, date: d.start_date!, path, human: s.allHuman ?? 0, top: s.topCity });
            parts.push(`${path}: short.io 14 days human ${fmt(s.human)} / total ${fmt(s.total)}, all time human ${fmt(s.allHuman)} / total ${fmt(s.allTotal)} [${s.where}]; beehiiv total ${fmt(bhTotal)} / unique ${fmt(bhUnique)}`);
          } catch (err) { parts.push(`${path}: short.io error ${(err as Error).message.slice(0, 80)}; beehiiv total ${fmt(bhTotal)} / unique ${fmt(bhUnique)}`); }
        }
        clickCell = parts.join(" | ");
      }
      lines.push(`| ${client.name} | ${d.start_date} | Newsletter ad (${d.deliverable_label ?? ""}) | ${tag} | impressions: now ${had("impressions")}, beehiiv ${fmt(opens)} | clicks: now ${had("clicks")}; ${clickCell} | ${issue.title} |`);
    } else {
      // Paid sends only, matched by the brand tag, from either publication (paid emails before June went out from the Daily).
      const near = [...mkt, ...daily].filter((p) => Math.abs(Date.parse(etDate(p.publish_date)) - Date.parse(d.start_date!)) <= 2 * 864e5
        && isPaid(p) && brandMatches(p, client.name) && !usedPosts.has(p.id));
      if (near.length !== 1) {
        // Investigation: every post within 3 days in Marketing and in the Daily publication (paid emails before June went out from the Daily).
        const around = (posts: Post[], label: string) => posts.filter((p) => Math.abs(Date.parse(etDate(p.publish_date)) - Date.parse(d.start_date!)) <= 3 * 864e5)
          .map((p) => `    ${label} ${etDate(p.publish_date)} | ${p.title} | subj: ${p.subject_line ?? ""} | delivered ${fmt(num(p.stats?.email?.delivered))} | tags ${JSON.stringify((p as any).content_tags ?? [])}`).join("\n");
        problems.push(`${client.name} ${d.start_date} ${tag}: ${near.length} matching emails in Marketing (${near.map((p) => p.title).join("; ") || "none"})\n${around(mkt, "MKT")}\n${around(daily, "DAILY")}`);
        continue;
      }
      usedPosts.add(near[0].id);
      const e = near[0].stats?.email ?? {};
      lines.push(`| ${client.name} | ${d.start_date} | Email blast | ${tag} | sent: now ${had("sent")}, beehiiv ${fmt(num(e.delivered))}; opens: now ${had("opens")}, beehiiv ${fmt(num(e.opens))} | clicks: now ${had("clicks")}, beehiiv ${fmt(num(e.clicks))} (unique ${fmt(num(e.unique_clicks))}) | ${near[0].subject_line ?? near[0].title} |`);
    }
  }
  console.log(`\n| Client | Date | Placement | EC tag | Reach | Clicks | Issue / subject |\n|---|---|---|---|---|---|---|\n${lines.join("\n")}`);
  // Outlier rule (Chloe, Nov 12 2026): when an ad's clicks are far above the client's usual, remove the location with the most
  // clicks. "Far above" = at least 2x the client's median ad AND one location holding 40%+ of the clicks (a bot farm signature).
  console.log(`\nOutlier check (clicks vs client median, top location share):`);
  for (const c of clickLog) {
    const peers = clickLog.filter((x) => x.client === c.client && x !== c).map((x) => x.human).sort((a, b) => a - b);
    const median = peers.length ? peers[Math.floor(peers.length / 2)] : 0;
    const share = c.top && c.human ? c.top.clicks / c.human : 0;
    const out = median > 0 && c.human >= 2 * median && share >= 0.4;
    console.log(`- ${c.client} ${c.date} ${c.path}: ${fmt(c.human)} clicks, median ${fmt(median)}, top ${c.top?.name ?? "—"} ${Math.round(share * 100)}%${out ? ` -> OUTLIER: report ${fmt(c.human - c.top!.clicks)} (minus ${fmt(c.top!.clicks)} from ${c.top!.name})` : ""}`);
  }
  console.log(`\nNot matched (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n") || "- none"}`);
  console.log(`\nDRY RUN: nothing was written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
