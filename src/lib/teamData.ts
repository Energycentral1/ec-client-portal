import type { SupabaseClient } from "@supabase/supabase-js";
import { CHANNELS } from "@/components/ClientView";
import type { ClientRow } from "@/components/ClientList";

type D = { reported_with: string | null; client_id: string; campaign_id: string | null; notion_page_id: string | null; deliverable_type: string; start_date: string | null; metrics: { metric: string; status: string }[] };
type Camp = { client_id: string; status: string | null; am_name: string | null; bp_name: string | null };
export type Me = { email: string; full_name: string | null } | null;

/** Is this Notion person (an AM or seller on a campaign) the signed-in team member? Notion gives a display name, the portal an
 *  email and sometimes a name, so match the name, or the usual ways a name becomes an email: chloe@, pdavis@, pj.davis@. */
export function isMe(name: string, me: Me): boolean {
  if (!me) return false;
  const n = name.trim().toLowerCase(); if (!n) return false;
  if (me.full_name && me.full_name.trim().toLowerCase() === n) return true;
  const local = me.email.split("@")[0].toLowerCase();
  const parts = n.split(/\s+/); const first = parts[0]; const last = parts[parts.length - 1];
  return local === first || local === first[0] + last || local === `${first}.${last}` || local === first + last;
}
const names = (v: (string | null)[]) => {
  const count = new Map<string, number>();
  for (const s of v) for (const n of (s ?? "").split(",").map((x) => x.trim()).filter(Boolean)) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([n]) => n);
};

/** One row per client for the Clients list and Home: what is missing, what is waiting, and who owns the account in Notion
 *  (the AM and the seller, "BP", on the client's campaigns; open campaigns first, else whatever the past ones say). */
export async function loadClientRows(supabase: SupabaseClient, me: Me): Promise<{ rows: ClientRow[]; placements: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: clients } = await supabase.from("clients").select("id, name, slug, is_active, customer_report_sheet_url, profiles(removed_at)").order("name");
  const { data: camps } = await supabase.from("campaigns").select("client_id, status, am_name, bp_name").limit(2000);
  // Every placement, read in pages because the API returns 1,000 rows at a time.
  const all: D[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    const { data } = await supabase.from("deliverables").select("client_id, campaign_id, notion_page_id, deliverable_type, start_date, reported_with, metrics(metric, status)").order("id").range(from, from + 999);
    all.push(...((data ?? []) as unknown as D[]));
    if (!data || data.length < 1000) break;
  }
  // Same rules as the results screens: only placements on a campaign count, and one is "missing results" once it has run and a column is empty.
  const colsOf = (t: string) => CHANNELS.find((c) => c.types.includes(t))?.cols ?? [];
  const mine = all.filter((d) => (d.campaign_id || !d.notion_page_id) && colsOf(d.deliverable_type).length);
  const live = (d: D) => d.metrics.filter((m) => m.status !== "rejected");
  const missing = (d: D) => !d.reported_with && !!d.start_date && d.start_date <= today && d.deliverable_type !== "marketing_email" && colsOf(d.deliverable_type).some(([m]) => !live(d).some((x) => x.metric === m));
  const rows: ClientRow[] = (clients ?? []).map((c) => {
    const ds = mine.filter((d) => d.client_id === c.id);
    const cs = ((camps ?? []) as Camp[]).filter((x) => x.client_id === c.id);
    const open = cs.filter((x) => !/^done$/i.test(x.status ?? ""));
    const use = open.length ? open : cs;
    const ams = names(use.map((x) => x.am_name)); const sellers = names(use.map((x) => x.bp_name));
    return { id: c.id, name: c.name, slug: c.slug, live: c.is_active, placements: ds.length, need: ds.filter(missing).length,
      approve: ds.reduce((n, d) => n + d.metrics.filter((m) => m.status === "pending" || m.status === "flagged").length, 0),
      logins: ((c.profiles ?? []) as { removed_at: string | null }[]).filter((p) => !p.removed_at).length, report: c.customer_report_sheet_url,
      ams, sellers, mine: [...ams, ...sellers].some((n) => isMe(n, me)) };
  });
  return { rows, placements: mine.length };
}
