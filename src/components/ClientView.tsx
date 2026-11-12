import { createClient } from "@/lib/supabase/server";
import { Empty, fmt, TYPE_LABEL } from "@/components/Shell";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { ProofCard, PROOF_STATUS, type Proof } from "@/components/Proofs";
import { ProofForm } from "@/components/ProofForm";
import { CountUp } from "@/components/CountUp";
import { companyTypeOf, seniorityOf } from "@/lib/leadProfile";

type Metric = { metric: string; value: number; status: string; source: string; window_start: string | null; window_end: string | null };
type Deliverable = { id: string; campaign_id: string | null; notion_page_id: string | null; inventory_tag: string | null; deliverable_type: string; deliverable_label: string | null; title: string | null; display_title: string | null;
  ec_brand: string[] | null; live_url: string | null; placement: string | null; start_date: string | null; reporting_due_date: string | null; status: string | null; metrics: Metric[] };
/** One line in a channel table. Same-day newsletter placements are merged into one line, the way clients think about them. */
type Line = { key: string; ids: string[]; type: string; date: string | null; due: string | null; label: string; detail: string | null; link: string | null; linkText: string;
  values: Record<string, number>; waiting: boolean; tags: string[];
  /** True when the numbers cover a multi-day flight (a week of ads reported as one figure), so per-ad averages don't apply. */
  flight: boolean };

/** Channels in the order a client reads them. `cols` are raw numbers; `rates` are worked out from them at display time,
 *  so they stay right when a number is corrected and never need their own data pull. */
const CHANNELS: { id: string; title: string; types: string[]; cols: [string, string][]; rates: [string, string, string][] }[] = [
  { id: "newsletter", title: "Newsletter ads", types: ["newsletter_ad"], cols: [["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [["CTR", "clicks", "impressions"]] },
  { id: "email", title: "Email", types: ["email_blast", "marketing_email"], cols: [["sent", "Sent"], ["opens", "Opens"], ["clicks", "Clicks"]],
    rates: [["Open rate", "opens", "sent"], ["Click rate", "clicks", "sent"]] },
  { id: "events", title: "Webinars and PowerSessions", types: ["webinar", "powersession"], cols: [["registrants", "Registered"], ["attendees", "Attended"]],
    rates: [["Attendance", "attendees", "registrants"]] },
  { id: "content", title: "Partner Content", types: ["sponsored_article", "featured_story", "gated_content", "non_gated_content"],
    cols: [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"]], rates: [] },
  { id: "podcast", title: "Podcast", types: ["podcast"], cols: [["plays", "Episode reach"], ["short_form_views", "Short-form reach"], ["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [] },
  { id: "website", title: "Website ads", types: ["website_ad"], cols: [["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [["CTR", "clicks", "impressions"]] },
  { id: "sponsorship", title: "Sponsorship and community", types: ["sponsorship", "community_takeover", "linkedin_post", "reel", "other"],
    cols: [["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [["CTR", "clicks", "impressions"]] },
];

/** Benchmark keys for the worked-out rates (see the benchmarks table). */
const RATE_KEY: Record<string, string> = { CTR: "ctr", Attendance: "attendance" };
/** How a number compares with the Energy Central average. Within 5% either way reads as "on par". */
function Versus({ value, avg, dark = false }: { value: number | undefined; avg: number | undefined; dark?: boolean }) {
  if (value == null || !avg) return null;
  const diff = value / avg - 1;
  if (Math.abs(diff) < 0.05) return <span className={`block text-xs font-normal ${dark ? "text-white/70" : "text-ink/50"}`}>on par with average</span>;
  return <span className={`block text-xs font-normal ${diff > 0 ? (dark ? "text-sun" : "text-emerald-700") : dark ? "text-white/70" : "text-ink/50"}`}>{diff > 0 ? "+" : "−"}{Math.abs(diff) >= 1 ? `${(Math.abs(diff) * 100).toFixed(0)}` : (Math.abs(diff) * 100).toFixed(0)}% vs average</span>;
}
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(n / d < 0.1 ? 2 : 1)}%`;
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDate = (d: string | null) => (d ? DATE.format(new Date(d + "T00:00:00Z")) : "Unscheduled");

/** Notion statuses that mean a placement has not run yet ("open inventory"). */
const OPEN_STATUSES = ["not started", "awaiting assets", "ready for production", "production in progress", "scheduled", "on hold"];
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const ms = (d: string) => Date.parse(d + "T00:00:00Z");
const addDays = (d: string, n: number) => new Date(ms(d) + n * 864e5).toISOString().slice(0, 10);

type Lead = { id: string; deliverable_id: string | null; source: string; attended: boolean | null; email: string; first_name: string | null; last_name: string | null;
  job_title: string | null; company: string | null; company_size: string | null; phone: string | null; city: string | null; state: string | null; country: string | null;
  consent: boolean | null; submitted_at: string | null };
/** "How they came in", in the client's words. This is what the leads filter and the CSV use. */
const howLabel = (l: Lead) => l.source === "webinar_live" ? (l.attended ? "Attended live" : "Registered")
  : l.source === "webinar_on_demand" ? "Watched on demand" : l.source === "gated_content" ? "Downloaded content" : l.source === "survey" ? "Answered survey" : "Other";


/** The year at a glance: one lane per channel, one mark per placement, positioned by date. Upcoming placements are hollow. */
function Timeline({ lanes, today }: { lanes: { title: string; color: string; lines: Line[] }[]; today: string }) {
  const dates = lanes.flatMap((l) => l.lines.map((x) => x.date!)).concat(today).sort();
  const first = new Date(ms(dates[0])); const last = new Date(ms(dates[dates.length - 1]));
  const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
  const at = (t: number) => `${(((t - start) / (end - start)) * 100).toFixed(2)}%`;
  const months: number[] = [];
  for (let t = start; t < end; ) { months.push(t); const d = new Date(t); t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  const every = Math.ceil(months.length / 12);
  return (
    <div className="mt-8" role="img" aria-label={`Timeline of placements: ${lanes.map((l) => `${l.lines.length} ${l.title.toLowerCase()}`).join(", ")}`}>
      {lanes.map((lane) => (
        <div key={lane.title} className="grid grid-cols-1 items-center gap-x-4 border-t border-white/15 py-2 sm:grid-cols-[11rem_1fr]">
          <p className="text-sm text-white/80">{lane.title} <span className="tabular-nums text-white/50">{lane.lines.length}</span></p>
          <div className="relative mx-2 h-5">
            {lane.lines.map((l) => (
              <span key={l.key} title={`${fmtDate(l.date)}: ${l.label}`} style={{ left: at(ms(l.date!)), ...(l.date! > today ? { borderColor: lane.color } : { background: lane.color, borderColor: lane.color }) }}
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-x-4 border-t border-white/15 sm:grid-cols-[11rem_1fr]">
        <span className="hidden sm:block" />
        <div className="relative mx-2 h-7 text-xs text-white/60">
          {months.map((t, i) => i % every === 0 && <span key={t} className="absolute top-2" style={{ left: at(t) }}>{MONTH.format(new Date(t))}</span>)}
          <span className="absolute -top-px h-2 w-px bg-sun" style={{ left: at(ms(today)) }} />
        </div>
      </div>
    </div>
  );
}

/** Campaign results for one client. Used by the client portal and by admins previewing a client.
 *  showAll=true (admin) includes numbers that aren't approved yet; clients never receive those rows from the database. */
export async function ClientView({ clientId, clientName, showAll, preview = false, period = null, basePath }: {
  clientId: string; clientName: string; showAll: boolean; preview?: boolean;
  /** A year ("2026"), "all", or null for the year in progress. */
  period?: string | null;
  /** Where the period picker links to, ending in "?" or "&" so "period=..." can be appended. */
  basePath: string }) {
  // preview (admin only): lay the page out exactly as the client will see it, but with unapproved numbers filled in.
  const admin = showAll && !preview;
  const supabase = await createClient();
  const { data: dels } = await supabase.from("deliverables")
    .select("id, campaign_id, notion_page_id, inventory_tag, deliverable_type, deliverable_label, title, display_title, ec_brand, live_url, placement, start_date, reporting_due_date, status, metrics(metric, value, status, source, window_start, window_end)")
    .eq("client_id", clientId).order("start_date", { ascending: false, nullsFirst: false });
  // Leads come back 1,000 at a time; keep reading until a short page so the table and the CSV are always complete.
  const leadRows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("leads")
      .select("id, deliverable_id, source, attended, email, first_name, last_name, job_title, company, company_size, phone, city, state, country, consent, submitted_at")
      .eq("client_id", clientId).order("submitted_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + 999);
    leadRows.push(...((data ?? []) as Lead[]));
    if (!data || data.length < 1000) break;
  }
  const { data: benchRows } = await supabase.from("benchmarks").select("deliverable_type, metric, value");
  const bench = (type: string, metric: string): number | undefined => {
    const b = (benchRows ?? []).find((r) => r.deliverable_type === type && r.metric === metric);
    return b ? Number(b.value) : undefined;
  };
  const { data: proofRows } = await supabase.from("proofs")
    .select("id, deliverable_id, name, copy_text, click_url, cta_text, format, note, file_path, link_url, due_date, status, feedback, reviewed_by_email, reviewed_at, created_at")
    .eq("client_id", clientId).order("created_at", { ascending: false });
  const proofs = (proofRows ?? []) as Proof[];
  const paths = proofs.filter((p) => p.file_path).map((p) => p.file_path!);
  // Proof files live in a private bucket; these links work for an hour.
  const { data: signed } = paths.length ? await supabase.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
  const fileUrl = (p: Proof) => (signed ?? []).find((x) => x.path === p.file_path)?.signedUrl ?? null;
  // What a client sees is what they bought: Notion inventory rows attached to one of their campaigns (Chloe, Nov 12 2026).
  // Rows with no campaign are Energy Central's own promotion (house ads, promo ads, marketing emails for the client's event)
  // and stay in the back-end view only. Rows that came from the client's old report rather than Notion are kept:
  // the client has already been shown those numbers.
  const visible = ((dels ?? []) as Deliverable[]).filter((d) => admin
    || (d.deliverable_type !== "marketing_email" && (d.campaign_id != null || d.notion_page_id == null)));
  const today = new Date().toISOString().slice(0, 10);

  // Periods are calendar years, the way clients budget and remember what they bought, never Notion campaign names
  // (Chloe, Nov 12 2026). Rows with no date yet belong to the year in progress.
  const yearOf = (d: string | null) => d?.slice(0, 4) ?? null;
  const years = [...new Set(visible.map((d) => yearOf(d.start_date)).filter((y): y is string => !!y))].sort().reverse();
  const thisYear = today.slice(0, 4);
  const defaultYear = years.includes(thisYear) ? thisYear : years[0] ?? thisYear;
  const year = period === "all" ? null : period && years.includes(period) ? period : defaultYear;
  // The headline, strip, leads and "who you reached" cover everything the client has done with us; the year only filters the
  // placement tables lower down (Chloe, Nov 12 2026: a year picker at the top was "too much control").
  const rows = visible;
  const inYear = (l: { date: string | null }) => !year || (l.date ? yearOf(l.date) === year : year === defaultYear);
  // Placements that run inside the newsletter: newsletter ads, and sponsorships sold as newsletter (+ web) weeks.
  // A sponsorship week links to the first issue it ran in.
  const inNewsletter = (d: Deliverable) => d.deliverable_type === "newsletter_ad"
    || (["sponsorship", "community_takeover", "other"].includes(d.deliverable_type) && ((d.ec_brand ?? []).some((b) => /daily|weekly/i.test(b)) || /\bNL\b|newsletter/i.test(d.deliverable_label ?? "")));
  const nlDates = [...new Set(rows.filter((d) => inNewsletter(d) && d.start_date).flatMap((d) => d.deliverable_type === "newsletter_ad" ? [d.start_date!] : [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(d.start_date!, n))))];
  const { data: issues } = nlDates.length
    ? await supabase.from("newsletter_issues").select("publication, issue_date, title, web_url").in("issue_date", nlDates)
    : { data: [] };
  const issueFor = (d: Deliverable) => (issues ?? []).find((i) => i.issue_date === d.start_date
    && i.publication === ((d.ec_brand ?? []).includes("Weekly") ? "weekly" : "daily"));
  if (visible.length === 0 && proofs.length === 0) return <Empty>Nothing here yet. Campaigns appear once they are scheduled.</Empty>;

  const lines = new Map<string, Line & { placements: string[] }>();
  for (const d of rows) {
    const merge = d.deliverable_type === "newsletter_ad" && d.start_date;
    const key = merge ? `nl-${d.start_date}` : d.id;
    const line = lines.get(key) ?? { key, ids: [], type: d.deliverable_type, date: d.start_date, due: d.reporting_due_date, label: "", detail: null, link: null, linkText: "",
      values: {}, waiting: false, tags: [], flight: false, placements: [] };
    line.ids.push(d.id);
    for (const m of d.metrics) {
      if (!showAll && m.status !== "approved") continue;
      line.values[m.metric] ??= Number(m.value);
      if (m.window_start && m.window_end && m.window_end > m.window_start) line.flight = true;
      if (m.status !== "approved") line.waiting = true;
    }
    if (d.inventory_tag) line.tags.push(d.inventory_tag);
    // Names come straight from the Notion "Deliverable" value, so the portal says exactly what was sold.
    const sold = d.deliverable_label || TYPE_LABEL[d.deliverable_type] || d.deliverable_type;
    if (merge) {
      // "Newsletter Ad - Hero" + "Newsletter Ad - 1st Spot" on the same day → "Newsletter Ad - Hero + 1st Spot"
      line.placements.push(sold.replace(/^Newsletter Ad - /i, ""));
      const order = ["Hero", "1st Spot", "2nd Spot", "3rd Spot", "4th Spot", "5th Spot"];
      line.placements.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const issue = issueFor(d);
      line.label = `Newsletter Ad - ${line.placements.join(" + ")}`;
      // Issues sent before the Daily was also published to the web have no page to link to: show the headline as plain text.
      line.detail = [...(d.ec_brand ?? []), d.display_title, issue && !issue.web_url ? issue.title : null].filter(Boolean).join(", ") || null;
      // The issue headline is the link, so the client sees which issue they ran in and can open it.
      line.link = issue?.web_url ?? null; line.linkText = issue?.title || "View the issue";
    } else {
      // Client-facing name first (event title, subject line); the Notion note is internal shorthand, so only admins fall back to it.
      const name = d.display_title || (admin ? d.title : null);
      line.label = name || sold;
      line.detail = [name ? sold : null, ...(d.ec_brand ?? [])].filter(Boolean).join(", ") || null;
      line.linkText = ["webinar", "powersession"].includes(d.deliverable_type) ? "Watch the recording" : ["email_blast", "marketing_email"].includes(d.deliverable_type) ? "View the email" : d.deliverable_type === "podcast" ? "Listen to the episode" : "View it live";
      line.link = d.live_url;
      if (!line.link && inNewsletter(d) && d.start_date) {
        const pub = (d.ec_brand ?? []).some((b) => /weekly/i.test(b)) ? "weekly" : "daily";
        const first = (issues ?? []).filter((i) => i.publication === pub && i.issue_date >= d.start_date! && i.issue_date <= addDays(d.start_date!, 6))
          .sort((a, b) => a.issue_date.localeCompare(b.issue_date))[0];
        if (first?.web_url) { line.link = first.web_url; line.linkText = first.title ? `See it in the daily newsletter: ${first.title}` : "See it in the daily newsletter"; }
        else if (first?.title) line.detail = [line.detail, first.title].filter(Boolean).join(", ");
      }
    }
    lines.set(key, line);
  }
  const all = [...lines.values()];
  const has = (l: Line) => Object.keys(l.values).length > 0;
  const upcoming = all.filter((l) => l.date && l.date > today).sort((a, b) => a.date!.localeCompare(b.date!));
  // Everything that ran is listed, with or without numbers yet, so a client never lands on an empty page.
  // Cancelled and rolled-over rows never ran: only the back-end view shows those.
  const dead = new Set(rows.filter((d) => /cancel|rolled over/i.test(d.status ?? "")).map((d) => d.id));
  const delivered = all.filter((l) => !(l.date && l.date > today) && (admin || has(l) || (l.date != null && !l.ids.every((id) => dead.has(id)))));
  const sum = (ls: Line[], k: string) => ls.reduce((s, l) => s + (l.values[k] ?? 0), 0);

  const ranLines = all.filter((l) => l.date && l.date <= today && !l.ids.every((id) => dead.has(id)));
  const ran = ranLines.length; const withResults = ranLines.filter(has).length;
  const lineOf = new Map<string, Line>(all.flatMap((l) => l.ids.map((id) => [id, l] as [string, Line])));
  const leadsFor = (l: Line) => leadRows.filter((x) => x.deliverable_id && l.ids.includes(x.deliverable_id)).length;
  const inPeriod = new Set(rows.map((d) => d.id));
  const periodLeads = year ? leadRows.filter((l) => l.deliverable_id && inPeriod.has(l.deliverable_id)) : leadRows;
  const leads: LeadRow[] = periodLeads.map((l) => {
    const line = l.deliverable_id ? lineOf.get(l.deliverable_id) : undefined;
    return { id: l.id, first_name: l.first_name, last_name: l.last_name, email: l.email, phone: l.phone, job_title: l.job_title, company: l.company,
      company_size: l.company_size, city: l.city, state: l.state, country: l.country, how: howLabel(l), companyType: companyTypeOf(l.company), seniority: seniorityOf(l.job_title),
      event: line ? line.label.replace(new RegExp(`^${clientName} Presents:\\s*`, "i"), "") : "Energy Central", eventDate: line?.date ?? null,
      date: l.submitted_at ? l.submitted_at.slice(0, 10) : null, consent: l.consent };
  });

  const LANE_COLORS = ["#ffe02d", "#ffffff", "#fd713b", "#9cc4fb", "#9cc4fb", "#9cc4fb", "#9cc4fb"];
  const lanes = CHANNELS.map((ch, i) => ({ title: ch.title, color: LANE_COLORS[i], lines: [...delivered, ...upcoming].filter((l) => l.date && ch.types.includes(l.type)) })).filter((l) => l.lines.length > 0);
  const dated = ranLines.map((l) => l.date!).sort();
  // The summary strip: the handful of numbers a client quotes to their boss, each with a line of context.
  const ev = delivered.filter((l) => ["webinar", "powersession"].includes(l.type) && has(l));
  const reach = sum(delivered, "impressions") + sum(delivered, "sent") + sum(delivered, "views");
  // The strip under the headline, as in the chosen mockup (Chloe, Nov 12 2026): the number, then what it is.
  const sessionWord = ev.every((l) => l.type === "webinar") ? "Webinar" : "Session";
  const summary: { label: string; value: string; sub?: React.ReactNode }[] = [];
  if (reach > 0) summary.push({ label: "Impressions, sends and views", value: fmt(reach) });
  if (sum(delivered, "clicks") > 0) summary.push({ label: "Clicks to your site", value: fmt(sum(delivered, "clicks")) });
  if (sum(ev, "registrants") > 0) summary.push({ label: `${sessionWord} registrants`, value: fmt(sum(ev, "registrants")) });
  if (sum(ev, "attendees") > 0 && sum(ev, "registrants") > 0) {
    const live = ev.filter((l) => l.values.attendees != null && l.values.registrants);
    summary.push({ label: "Attended live", value: `${Math.round((sum(live, "attendees") / sum(live, "registrants")) * 100)}%`,
      sub: live.every((l) => !l.flight) && new Set(live.map((l) => l.type)).size === 1 ? <Versus value={sum(live, "attendees") / sum(live, "registrants")} avg={bench(live[0].type, "attendance")} dark /> : null });
  }
  if (leads.length > 0) summary.push({ label: "Leads", value: fmt(leads.length), sub: <a href="#leads" className="text-sun underline decoration-sun/40 underline-offset-2 hover:decoration-sun">View and download</a> });
  // Proofs: the newest version for each placement is the live one; earlier versions fold away underneath it.
  const soldLabel = (d: Deliverable) => d.deliverable_label || TYPE_LABEL[d.deliverable_type] || d.deliverable_type;
  const placementOf = (p: Proof) => { const d = visible.find((r) => r.id === p.deliverable_id); return d ? { label: d.display_title || soldLabel(d), date: d.start_date } : null; };
  // Which layout to preview a proof in: what the team picked, otherwise whatever the placement is.
  const kindOf = (p: Proof): "newsletter_ad" | "newsletter_hero" | "plain" => {
    if (p.format) return p.format;
    const d = visible.find((r) => r.id === p.deliverable_id);
    if (d?.deliverable_type !== "newsletter_ad") return "plain";
    return /hero/i.test(soldLabel(d)) ? "newsletter_hero" : "newsletter_ad";
  };
  const proofGroups: { latest: Proof; older: Proof[] }[] = [];
  for (const p of proofs) {
    const g = p.deliverable_id ? proofGroups.find((x) => x.latest.deliverable_id === p.deliverable_id) : undefined;
    if (g) g.older.push(p); else proofGroups.push({ latest: p, older: [] });
  }
  const rank = { awaiting_review: 0, changes_requested: 1, approved: 2 };
  proofGroups.sort((a, b) => rank[a.latest.status] - rank[b.latest.status]);
  const awaiting = proofGroups.filter((g) => g.latest.status === "awaiting_review").length;
  const proofFor = (l: Line) => proofGroups.find((g) => g.latest.deliverable_id && l.ids.includes(g.latest.deliverable_id))?.latest;
  // Creative can only be attached to open inventory: Notion rows that have not run yet.
  const placements = visible.filter((d) => OPEN_STATUSES.includes((d.status ?? "").toLowerCase())).sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"))
    .map((d) => ({ id: d.id, label: `${fmtDate(d.start_date)}: ${d.display_title || soldLabel(d)}${d.inventory_tag ? ` (${d.inventory_tag})` : ""}` }));
  // What was bought in this period and how much of it has run, one line per Notion "Deliverable" value (verbatim).
  const bought = new Map<string, { label: string; type: string; total: number; ran: number; unscheduled: number; values: Record<string, number> }>();
  // Rows imported from an old report aren't in Notion, so they aren't counted as bought; their numbers go to the line of the same kind.
  const fromNotion = rows.filter((d) => d.notion_page_id && !dead.has(d.id) && d.deliverable_type !== "marketing_email");
  const labelForType = (t: string) => fromNotion.find((d) => d.deliverable_type === t) ? soldLabel(fromNotion.find((d) => d.deliverable_type === t)!) : TYPE_LABEL[t] ?? t;
  for (const d of rows) {
    if (dead.has(d.id) || d.deliverable_type === "marketing_email") continue;
    const label = d.notion_page_id ? soldLabel(d) : labelForType(d.deliverable_type);
    const g = bought.get(label) ?? { label, type: d.deliverable_type, total: 0, ran: 0, unscheduled: 0, values: {} };
    if (d.notion_page_id) {
      g.total++;
      if (!d.start_date) g.unscheduled++; else if (d.start_date <= today) g.ran++;
    }
    for (const m of d.metrics) if (showAll || m.status === "approved") g.values[m.metric] = (g.values[m.metric] ?? 0) + Number(m.value);
    bought.set(label, g);
  }
  const boughtRows = [...bought.values()].sort((a, b) => CHANNELS.findIndex((c) => c.types.includes(a.type)) - CHANNELS.findIndex((c) => c.types.includes(b.type)) || a.label.localeCompare(b.label));
  // The overview: the period in one sentence, then one row per channel with the numbers a client quotes.
  const totals = boughtRows.reduce((t, g) => ({ ran: t.ran + g.ran, total: t.total + g.total }), { ran: 0, total: 0 });
  const firstYear = dated[0]?.slice(0, 4);
  const periodMeta = dated.length ? `Since ${MONTH_YEAR.format(new Date(ms(dated[0])))}` : null;
  const placementsMeta = totals.total > 0 ? `${totals.ran} of ${totals.total} placements have run` : ran > 0 ? `${ran} ${ran === 1 ? "placement" : "placements"} delivered` : null;
  const heroLead = !firstYear || firstYear === thisYear ? "This year you reached" : `Since ${firstYear}, you've reached`;


  const sections = [...(proofGroups.length || admin ? [{ id: "approvals", title: awaiting ? `Creative approvals (${awaiting})` : "Creative approvals" }] : []), ...CHANNELS.filter((ch) => delivered.some((l) => ch.types.includes(l.type) && inYear(l))).map((ch) => ({ id: ch.id, title: ch.title })),
    ...(leads.length ? [{ id: "leads", title: "Leads" }] : [])];

  return (
    <>
      {!admin && awaiting > 0 && (
        <a href="#approvals" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-sun px-5 py-4 text-ink hover:brightness-95">
          <span className="font-semibold">{awaiting === 1 ? "1 piece of creative needs your approval" : `${awaiting} pieces of creative need your approval`}</span>
          <span className="text-ink/80">before it can run.</span>
          <span className="ml-auto font-semibold underline underline-offset-2">Review now</span>
        </a>
      )}


      <section className="mt-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink/70">
          <span>{[clientName, periodMeta, placementsMeta].filter(Boolean).join(" · ")}</span>
          {reach > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-sun px-3 py-1 text-xs font-medium text-ink">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#FD713B] opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FD713B]" />
              </span>
              Live total: grows as new results come in
            </span>
          )}
        </p>
        {reach > 0 ? (
          <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl xl:whitespace-nowrap xl:text-[2.9rem]">
            {heroLead} <em><CountUp value={reach} /></em> energy professionals.
          </h1>
        ) : <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{clientName}</h1>}
      </section>

      {summary.length > 0 && (
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/15 text-white sm:grid-cols-3 lg:flex">
          {summary.map((f) => (
            <div key={f.label} className="flex-1 bg-navy px-6 py-7 sm:px-8">
              <dt className="sr-only">{f.label}</dt>
              <dd className="font-display text-4xl leading-none tabular-nums sm:text-5xl">{f.value}</dd>
              <dd className="mt-3 text-sm text-white/85">{f.label}{f.sub && <span className="mt-1 block text-xs">{f.sub}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {showAll && <p className="mt-3 text-xs text-ink/60">{preview ? "Preview of the client page, with numbers that are still waiting for approval filled in." : "This back-end view includes numbers still waiting for approval. Clients see approved numbers only."}</p>}


      {upcoming.length > 0 && (
        <section id="upcoming" className="mt-12 scroll-mt-16">
          <h2 className="font-display text-3xl tracking-tight">Coming up</h2>
          <ul className="mt-3 divide-y divide-line border-y border-ink text-sm">
            {upcoming.slice(0, 8).map((l) => (
              <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <span className="font-medium">{l.label}</span>
                <span className="flex items-center gap-3">
                  {proofFor(l) && <a href="#approvals" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PROOF_STATUS[proofFor(l)!.status][1]}`}>Creative: {PROOF_STATUS[proofFor(l)!.status][0].toLowerCase()}</a>}
                  <span className="tabular-nums text-ink/70">{fmtDate(l.date)}</span>
                </span>
              </li>
            ))}
          </ul>
          {upcoming.length > 8 && <p className="mt-2 text-sm text-ink/70">And {upcoming.length - 8} more after that.</p>}
        </section>
      )}

      {admin && (lanes.length > 0 || ran > withResults) && (
        <div className="mt-10 rounded-3xl bg-navy px-5 py-6 text-white sm:px-8">
          <p className="text-sm text-white/70">Back-end only</p>
          {lanes.length > 0 && <Timeline lanes={lanes} today={today} />}
          {ran > withResults && <p className="mt-4 text-sm text-white/70">{ran - withResults} placements that ran have no numbers yet.</p>}
        </div>
      )}

      {sections.length > 1 && (
        <nav aria-label="Sections" className="sticky top-0 z-10 -mx-4 mt-10 flex gap-1 overflow-x-auto border-b border-line bg-cream/95 px-4 py-2 text-sm backdrop-blur">
          {sections.map((s) => <a key={s.id} href={`#${s.id}`} className="whitespace-nowrap rounded-full px-3 py-2 text-ink/80 hover:bg-white hover:text-navy">{s.title}</a>)}
        </nav>
      )}


      {(proofGroups.length > 0 || admin) && (
        <section id="approvals" className="mt-10 scroll-mt-16">
          <h2 className="font-display text-2xl">{!admin && awaiting ? "Creative for your approval" : "Creative approvals"}</h2>
          {!admin && <p className="mt-1 max-w-2xl text-sm text-ink/70">{awaiting ? "This is what will run. Check the creative and where it clicks to, then approve it or tell us what to change." : "The creative you have reviewed, with who signed it off."}</p>}
          {proofGroups.length > 0 && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {proofGroups.map((g) => (
                <div key={g.latest.id} className="flex flex-col">
                  <ProofCard proof={g.latest} fileUrl={fileUrl(g.latest)} placement={placementOf(g.latest)} kind={kindOf(g.latest)} version={g.older.length ? g.older.length + 1 : null} admin={admin} today={today} />
                  {g.older.length > 0 && (
                    <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink/70 hover:text-navy">{g.older.length} earlier {g.older.length === 1 ? "version" : "versions"}</summary>
                      <ul className="mt-2 space-y-2">{g.older.map((o, i) => (
                        <li key={o.id} className="rounded-xl border border-line bg-white px-4 py-3">Version {g.older.length - i}: {o.name}, {PROOF_STATUS[o.status][0].toLowerCase().replace("needs your approval", "replaced before review")}
                          {o.feedback && <span className="block text-ink/70">{o.feedback}</span>}
                          {fileUrl(o) && <a href={fileUrl(o)!} target="_blank" rel="noreferrer" className="text-navy underline decoration-navy/30 underline-offset-2">Open the file</a>}</li>
                      ))}</ul></details>
                  )}
                </div>
              ))}
            </div>
          )}
          {admin && <div className="mt-4"><ProofForm clientId={clientId} placements={placements} /></div>}
        </section>
      )}

      {delivered.length > 0 && (
        <div id="placements" className="mt-12 flex scroll-mt-16 flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
          <h2 className="font-display text-3xl tracking-tight">Your placements</h2>
          {years.length > 1 && (
            <nav aria-label="Placements by year" className="flex flex-wrap gap-1.5 text-sm">
              {[...years.filter((y) => delivered.some((l) => l.date?.startsWith(y))), "all"].map((y) => {
                const on = y === "all" ? !year : year === y;
                return <a key={y} href={`${basePath}period=${y}#placements`} aria-current={on ? "page" : undefined}
                  className={`rounded-full border px-3 py-1.5 ${on ? "border-ink bg-ink text-cream" : "border-line text-ink/80 hover:border-ink"}`}>{y === "all" ? "All years" : y}</a>;
              })}
            </nav>
          )}
        </div>
      )}

      {CHANNELS.map((ch) => {
        const ls = delivered.filter((l) => ch.types.includes(l.type) && inYear(l));
        if (ls.length === 0) return null;
        const withNumbers = ls.filter(has);
        const cols = ch.cols.filter(([k]) => admin || withNumbers.some((l) => l.values[k] != null) || withNumbers.length === 0);
        const rates = ch.rates.filter(([, n, d]) => cols.some(([k]) => k === n) && cols.some(([k]) => k === d));
        const lead = cols[0]?.[0];
        const max = lead ? Math.max(1, ...withNumbers.map((l) => l.values[lead] ?? 0)) : 1;
        const showLeads = ch.id === "events" && ls.some((l) => leadsFor(l) > 0);
        return (
          <section key={ch.id} id={ch.id} className="mt-10 scroll-mt-16">
            <h2 className="font-display text-2xl">{ch.title}</h2>
            {withNumbers.length > 0 && (
              <p className="mt-1 text-sm text-ink/70">
                {cols.map(([k, label]) => <span key={k} className="mr-5 whitespace-nowrap"><span className="text-base font-semibold tabular-nums text-ink">{fmt(sum(withNumbers, k))}</span> {label.toLowerCase()}</span>)}
                {rates.map(([label, n, d]) => sum(withNumbers, d) > 0 && (
                  <span key={label} className="mr-5 whitespace-nowrap"><span className="text-base font-semibold tabular-nums text-navy">{pct(sum(withNumbers, n), sum(withNumbers, d))}</span> {label === "CTR" ? label : label.toLowerCase()}</span>
                ))}
              </p>
            )}
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-line text-ink/60">
                  <tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">What ran</th>
                    {cols.map(([k, label]) => <th key={k} className="px-4 py-3 text-right font-medium">{label}</th>)}
                    {rates.map(([label]) => <th key={label} className="px-4 py-3 text-right font-medium">{label}</th>)}
                    {showLeads && <th className="px-4 py-3 text-right font-medium">Leads</th>}</tr>
                </thead>
                <tbody>
                  {ls.map((l) => (
                    <tr key={l.key} className="border-b border-line align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmtDate(l.date)}</td>
                      <td className="max-w-md px-4 py-3"><span className="font-medium">{l.label}</span>
                        {l.detail && <span className="block text-ink/60">{l.detail}</span>}
                        {l.link && <a href={l.link} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-navy">{l.linkText}</a>}
                        {admin && <span className="block text-xs text-ink/50">{l.tags.join(", ")}{l.waiting && <span className="ml-2 rounded bg-sun/60 px-1 text-ink">waiting for approval</span>}</span>}</td>
                      {has(l) ? (
                        <>
                          {cols.map(([k], i) => (
                            <td key={k} className="px-4 py-3 text-right tabular-nums">{fmt(l.values[k])}
                              {i === 0 && l.values[k] != null && <span className="ml-auto mt-1.5 block h-1 w-24 rounded-full bg-mist"><span className="block h-1 rounded-full bg-sky" style={{ width: `${Math.max(3, (l.values[k] / max) * 100)}%` }} /></span>}
                              {!l.flight && <Versus value={l.values[k]} avg={bench(l.type, k)} />}</td>
                          ))}
                          {rates.map(([label, n, d]) => <td key={label} className="px-4 py-3 text-right font-medium tabular-nums text-navy">{l.values[n] != null && l.values[d] ? pct(l.values[n], l.values[d]) : "—"}
                            {l.values[n] != null && l.values[d] ? <Versus value={l.values[n] / l.values[d]} avg={bench(l.type, RATE_KEY[label])} /> : null}</td>)}
                        </>
                      ) : (
                        <td colSpan={cols.length + rates.length} className="px-4 py-3 text-right text-ink/50">
                          {l.due && l.due >= today ? `Results expected ${fmtDate(l.due)}` : admin ? "No numbers yet" : "Results to come"}</td>
                      )}
                      {showLeads && <td className="px-4 py-3 text-right tabular-nums">{leadsFor(l) > 0 ? <a href="#leads" className="text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-navy">{fmt(leadsFor(l))}</a> : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {leads.length > 0 && (
        <section id="leads" className="mt-10 scroll-mt-16">
          <h2 className="font-display text-2xl">Leads</h2>
          <div className="mt-4"><LeadsTable leads={leads} fileName={`${clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-leads-${today}.csv`} /></div>
        </section>
      )}


    </>
  );
}
