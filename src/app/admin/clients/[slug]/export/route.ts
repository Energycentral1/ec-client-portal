import { createClient, getProfile } from "@/lib/supabase/server";
import { readTable, toWorkbook } from "@/lib/fullExport";
import { TYPE_LABEL } from "@/components/Shell";

export const maxDuration = 60;
type R = Record<string, unknown>;
const METRICS = ["impressions", "sent", "delivered", "opens", "clicks", "views", "likes", "comments", "registrants", "attendees", "plays", "short_form_views", "page_views"];
const HOW = (l: R) => l.source === "webinar_live" ? (l.attended ? "Attended live" : "Registered") : l.source === "webinar_on_demand" ? "Watched on demand" : l.source === "gated_content" ? "Downloaded content" : "Other";

/** Everything the portal holds for one client, all years, as one Excel file (Chloe, Nov 13 2026: "a clear view of lifetime
 *  stuff per client"). Team only. Results retired in favour of an old report are left out; results still waiting are marked. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await getProfile();
  if (profile?.role !== "admin") return new Response("Team only", { status: 403 });
  const { slug } = await params;
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name").eq("slug", slug).maybeSingle();
  if (!client) return new Response("No such client", { status: 404 });
  const by = { column: "client_id", value: client.id };
  const [dels, metrics, leads, proofs, campaigns] = await Promise.all(["deliverables", "metrics", "leads", "proofs", "campaigns"].map((t) => readTable(supabase, t, by)));
  const live = metrics.filter((m) => m.status !== "rejected");
  const title = new Map(dels.map((d) => [d.id as string, d]));
  const label = (d: R | undefined) => (d ? String(d.deliverable_label || TYPE_LABEL[String(d.deliverable_type)] || d.deliverable_type) : "");

  const placements = [...dels].sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? ""))).map((d) => {
    const ms = live.filter((m) => m.deliverable_id === d.id);
    const row: R = { Date: d.start_date, "End date": d.end_date, Placement: label(d), Title: d.display_title ?? d.title, "EC number": d.inventory_tag, "Notion status": d.status,
      "On a campaign": d.campaign_id ? "Yes" : d.notion_page_id ? "No (not shown to the client)" : "From the old report", Link: d.live_url };
    for (const k of METRICS) { const m = ms.find((x) => x.metric === k); row[k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())] = m ? Number(m.value) : null; }
    row["Still waiting for approval"] = ms.filter((m) => m.status !== "approved").map((m) => m.metric).join(", ") || null;
    row["Where the results came from"] = [...new Set(ms.map((m) => String(m.source).replace("legacy_sheet", "old report").replace("manual", "typed in")))].join(", ") || null;
    return row;
  });
  const people = [...leads].sort((a, b) => String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))).map((l) => {
    const d = title.get(l.deliverable_id as string);
    return { Date: l.submitted_at ? String(l.submitted_at).slice(0, 10) : null, "First name": l.first_name, "Last name": l.last_name, Email: l.email, Phone: l.phone, "Job title": l.job_title,
      Company: l.company, "Company size": l.company_size, City: l.city, State: l.state, Country: l.country, "How they came in": HOW(l),
      Source: d ? String(d.display_title ?? label(d)) : null, "Source date": d?.start_date ?? null, "Consent to contact": l.consent == null ? null : l.consent ? "Yes" : "No" };
  });
  const creative = proofs.map((p) => ({ Sent: String(p.created_at).slice(0, 10), Creative: p.name, Placement: label(title.get(p.deliverable_id as string)), Status: String(p.status).replace(/_/g, " "),
    "Approve by": p.due_date, "Decided by": p.reviewed_by_email, "Decided on": p.reviewed_at ? String(p.reviewed_at).slice(0, 10) : null, Feedback: p.feedback, "Clicks to": p.click_url, Link: p.link_url }));
  const deals = campaigns.map((c) => ({ Campaign: c.name, Status: c.status, "Date signed": c.date_signed, "Account manager": c.am_name, Seller: c.bp_name, IO: c.io_url, "Wrap report": c.wrap_report_url }));

  const day = new Date().toISOString().slice(0, 10);
  const file = await toWorkbook([{ name: "Placements and results", rows: placements }, { name: "Leads", rows: people }, { name: "Creative approvals", rows: creative }, { name: "Campaigns (internal)", rows: deals }], [
    `${client.name}: everything in the Energy Central Client Portal, ${day}`,
    `${placements.length.toLocaleString("en-US")} placements, ${people.length.toLocaleString("en-US")} lead sign-ups, ${creative.length} creative approvals, all years.`,
    "This is the team's copy: it includes results still waiting for approval (marked) and internal campaign names. Check before forwarding to a client.",
  ]);
  return new Response(new Uint8Array(file), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${slug}-everything-${day}.xlsx"`, "Cache-Control": "no-store" } });
}
