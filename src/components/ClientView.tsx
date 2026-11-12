import { createClient } from "@/lib/supabase/server";
import { Stat, Empty, fmt, TYPE_LABEL } from "@/components/Shell";

type Metric = { metric: string; value: number; status: string; source: string };
type Deliverable = { id: string; inventory_tag: string | null; deliverable_type: string; title: string | null; ec_brand: string[] | null;
  placement: string | null; start_date: string | null; reporting_due_date: string | null; status: string | null; metrics: Metric[] };
/** One line in a channel table. Same-day newsletter placements are merged into one line, the way clients think about them. */
type Line = { key: string; type: string; date: string | null; due: string | null; label: string; detail: string | null;
  values: Record<string, number>; waiting: boolean; tags: string[] };

/** Channels in the order a client reads them. `cols` are raw numbers; `rates` are worked out from them at display time,
 *  so they stay right when a number is corrected and never need their own data pull. */
const CHANNELS: { title: string; types: string[]; cols: [string, string][]; rates: [string, string, string][] }[] = [
  { title: "Newsletter ads", types: ["newsletter_ad"], cols: [["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [["CTR", "clicks", "impressions"]] },
  { title: "Email", types: ["email_blast", "marketing_email"], cols: [["sent", "Sent"], ["opens", "Opens"], ["clicks", "Clicks"]],
    rates: [["Open rate", "opens", "sent"], ["Click rate", "clicks", "sent"]] },
  { title: "Webinars and PowerSessions", types: ["webinar", "powersession"], cols: [["registrants", "Registered"], ["attendees", "Attended"]],
    rates: [["Attendance", "attendees", "registrants"]] },
  { title: "Partner Content", types: ["sponsored_article", "featured_story", "gated_content", "non_gated_content"],
    cols: [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"]], rates: [] },
  { title: "Podcast", types: ["podcast"], cols: [["plays", "Plays"], ["short_form_views", "Clip views"], ["clicks", "Clicks"]], rates: [] },
  { title: "Sponsorship and site", types: ["sponsorship", "community_takeover", "website_ad", "linkedin_post", "reel", "other"],
    cols: [["impressions", "Impressions"], ["clicks", "Clicks"]], rates: [] },
];
/** Site impressions are a homepage-pageview proxy that doesn't reconcile, so clients don't see them (see CLAUDE.md). */
const SITE_TYPES = ["website_ad", "community_takeover", "sponsorship"];

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(n / d < 0.1 ? 2 : 1)}%`;
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDate = (d: string | null) => (d ? DATE.format(new Date(d + "T00:00:00Z")) : "Unscheduled");
const PLACEMENT = (p: string) => (p === "hero" ? "Hero" : p.replace("spot_", "Position "));

/** Campaign results for one client. Used by the client portal and by admins previewing a client.
 *  showAll=true (admin) includes numbers that aren't approved yet; clients never receive those rows from the database. */
export async function ClientView({ clientId, showAll, preview = false }: { clientId: string; showAll: boolean; preview?: boolean }) {
  // preview (admin only): lay the page out exactly as the client will see it, but with unapproved numbers filled in.
  const admin = showAll && !preview;
  const supabase = await createClient();
  const [{ data: dels }, { count: leadCount }] = await Promise.all([
    supabase.from("deliverables")
      .select("id, inventory_tag, deliverable_type, title, ec_brand, placement, start_date, reporting_due_date, status, metrics(metric, value, status, source)")
      .eq("client_id", clientId).order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId),
  ]);
  const rows = (dels ?? []) as Deliverable[];
  const today = new Date().toISOString().slice(0, 10);
  if (rows.length === 0) return <Empty>Nothing here yet. Campaigns appear once they are scheduled.</Empty>;

  const lines = new Map<string, Line & { placements: string[] }>();
  for (const d of rows) {
    const merge = d.deliverable_type === "newsletter_ad" && d.start_date;
    const key = merge ? `nl-${d.start_date}` : d.id;
    const line = lines.get(key) ?? { key, type: d.deliverable_type, date: d.start_date, due: d.reporting_due_date, label: "", detail: null,
      values: {}, waiting: false, tags: [], placements: [] };
    for (const m of d.metrics) {
      if (!showAll && m.status !== "approved") continue;
      if (!admin && m.metric === "impressions" && SITE_TYPES.includes(d.deliverable_type)) continue;
      line.values[m.metric] ??= Number(m.value);
      if (m.status !== "approved") line.waiting = true;
    }
    if (d.placement) line.placements.push(PLACEMENT(d.placement));
    if (d.inventory_tag) line.tags.push(d.inventory_tag);
    if (merge) {
      line.label = [(d.ec_brand ?? []).join(", ") || "Newsletter", line.placements.sort().join(" + ")].filter(Boolean).join(" · ");
    } else {
      line.label = d.title || TYPE_LABEL[d.deliverable_type] || d.deliverable_type;
      line.detail = d.title ? TYPE_LABEL[d.deliverable_type] ?? null : null;
    }
    lines.set(key, line);
  }
  const all = [...lines.values()];
  const has = (l: Line) => Object.keys(l.values).length > 0;
  const upcoming = all.filter((l) => l.date && l.date > today).sort((a, b) => a.date!.localeCompare(b.date!));
  // Clients see a delivered line once it has numbers, or while its numbers are still inside the normal reporting window.
  const delivered = all.filter((l) => !(l.date && l.date > today) && (has(l) || admin || (l.due != null && l.due >= today)));
  const sum = (ls: Line[], k: string) => ls.reduce((s, l) => s + (l.values[k] ?? 0), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Impressions" value={fmt(sum(delivered, "impressions"))} />
        <Stat label="Clicks" value={fmt(sum(delivered, "clicks"))} />
        <Stat label="Leads" value={fmt(leadCount ?? 0)} />
        <Stat label="Delivered" value={delivered.length} />
      </div>
      {showAll && <p className="mt-2 text-xs text-ink/50">{preview ? "Preview of the client page, with numbers that are still waiting for approval filled in." : "This back-end view includes numbers still waiting for approval. Clients see approved numbers only."}</p>}

      {upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Coming up</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-white text-sm">
            {upcoming.map((l) => (
              <li key={l.key} className="flex flex-wrap gap-x-4 px-4 py-3"><span className="w-28 tabular-nums text-ink/70">{fmtDate(l.date)}</span>
                <span className="font-medium">{l.label}</span>{l.detail && <span className="text-ink/60">{l.detail}</span>}</li>
            ))}
          </ul>
        </section>
      )}

      {CHANNELS.map((ch) => {
        const ls = delivered.filter((l) => ch.types.includes(l.type));
        if (ls.length === 0) return null;
        const withNumbers = ls.filter(has);
        const cols = ch.cols.filter(([k]) => admin || withNumbers.some((l) => l.values[k] != null) || withNumbers.length === 0);
        const rates = ch.rates.filter(([, n, d]) => cols.some(([k]) => k === n) && cols.some(([k]) => k === d));
        return (
          <section key={ch.title} className="mt-8">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <h2 className="text-lg font-semibold">{ch.title}</h2>
              <p className="text-sm text-ink/70">
                {cols.map(([k, label]) => <span key={k} className="mr-4 whitespace-nowrap"><span className="font-medium tabular-nums text-ink">{fmt(sum(withNumbers, k))}</span> {label.toLowerCase()}</span>)}
                {rates.map(([label, n, d]) => sum(withNumbers, d) > 0 && (
                  <span key={label} className="mr-4 whitespace-nowrap"><span className="font-medium tabular-nums text-navy">{pct(sum(withNumbers, n), sum(withNumbers, d))}</span> {label.toLowerCase()}</span>
                ))}
              </p>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-ink/60">
                  <tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">What ran</th>
                    {cols.map(([k, label]) => <th key={k} className="px-4 py-3 text-right font-medium">{label}</th>)}
                    {rates.map(([label]) => <th key={label} className="px-4 py-3 text-right font-medium">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {ls.map((l) => (
                    <tr key={l.key} className="border-b border-line align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmtDate(l.date)}</td>
                      <td className="px-4 py-3"><span className="font-medium">{l.label}</span>
                        {l.detail && <span className="block text-ink/60">{l.detail}</span>}
                        {admin && <span className="block text-xs text-ink/50">{l.tags.join(", ")}{l.waiting && <span className="ml-2 rounded bg-sun/60 px-1 text-ink">waiting for approval</span>}</span>}</td>
                      {has(l) ? (
                        <>
                          {cols.map(([k]) => <td key={k} className="px-4 py-3 text-right tabular-nums">{fmt(l.values[k])}</td>)}
                          {rates.map(([label, n, d]) => <td key={label} className="px-4 py-3 text-right font-medium tabular-nums text-navy">{l.values[n] != null && l.values[d] ? pct(l.values[n], l.values[d]) : "—"}</td>)}
                        </>
                      ) : (
                        <td colSpan={cols.length + rates.length} className="px-4 py-3 text-right text-ink/50">
                          {l.due && l.due >= today ? `Results expected ${fmtDate(l.due)}` : "No numbers yet"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
