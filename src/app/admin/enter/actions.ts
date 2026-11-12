"use server";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";

export type EnterState = { error?: string; ok?: number; message?: string };
const METRICS = ["views", "likes", "comments", "plays", "short_form_views", "impressions", "clicks"];

/** Numbers typed in by the team for placements no pull covers (Bettermode, podcast, website ads). They go in as
 *  `manual` + `pending`, so they pass through /admin/approvals like every pulled number. */
export async function saveNumbers(_prev: EnterState, fd: FormData): Promise<EnterState> {
  const profile = await getProfile();
  if (profile?.role !== "admin") return { error: "Admins only." };
  const supabase = await createClient();
  const id = String(fd.get("deliverable_id") ?? "");
  const { data: d } = await supabase.from("deliverables").select("id, client_id, start_date, live_url, display_title, metrics(metric)").eq("id", id).single();
  if (!d) return { error: "That placement no longer exists." };
  const have = new Set(((d.metrics ?? []) as { metric: string }[]).map((m) => m.metric));
  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  for (const metric of METRICS) {
    const raw = String(fd.get(metric) ?? "").replace(/[,\s]/g, "");
    if (!raw || have.has(metric)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `"${fd.get(metric)}" is not a number.` };
    rows.push({ client_id: d.client_id, deliverable_id: d.id, metric, value, source: "manual", status: "pending", window_start: d.start_date ?? today, window_end: today });
  }
  const patch: Record<string, string> = {};
  const link = String(fd.get("live_url") ?? "").trim();
  const title = String(fd.get("display_title") ?? "").trim();
  if (link && !d.live_url) { if (!/^https:\/\/\S+$/.test(link)) return { error: "The link has to start with https://" }; patch.live_url = link; }
  if (title && !d.display_title) patch.display_title = title;
  if (!rows.length && !Object.keys(patch).length) return { error: "Nothing to save: type at least one number." };
  if (rows.length) {
    const { error } = await supabase.from("metrics").upsert(rows, { onConflict: "deliverable_id,metric,source,window_end" });
    if (error) return { error: error.message };
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("deliverables").update(patch).eq("id", d.id);
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/enter");
  revalidatePath("/admin/approvals");
  return { ok: Date.now(), message: rows.length ? `Saved ${rows.length} ${rows.length === 1 ? "number" : "numbers"}. Waiting in Approvals.` : "Saved." };
}
