"use server";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";

export type EnterState = { error?: string; ok?: number; message?: string };
const METRICS = ["impressions", "sent", "opens", "clicks", "registrants", "attendees", "views", "likes", "comments", "plays", "short_form_views"];

/** Manual entry: the team types or corrects any placement's numbers, headline and link. A new or changed number is saved as
 *  `manual` + `pending`, so it passes through /admin/approvals again before the client sees it. Unchanged boxes are left alone. */
export async function saveNumbers(_prev: EnterState, fd: FormData): Promise<EnterState> {
  const profile = await getProfile();
  if (profile?.role !== "admin") return { error: "Admins only." };
  const supabase = await createClient();
  const id = String(fd.get("deliverable_id") ?? "");
  const { data: d } = await supabase.from("deliverables").select("id, client_id, start_date, live_url, display_title, metrics(id, metric, value, status)").eq("id", id).single();
  if (!d) return { error: "That placement no longer exists." };
  const existing = ((d.metrics ?? []) as { id: string; metric: string; value: number; status: string }[]).filter((m) => m.status !== "rejected");
  const today = new Date().toISOString().slice(0, 10);
  let changed = 0;
  for (const metric of METRICS) {
    if (!fd.has(metric)) continue;
    const raw = String(fd.get(metric) ?? "").replace(/[,\s]/g, "");
    if (!raw) continue;                                   // an emptied box never deletes a number
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `"${fd.get(metric)}" is not a number.` };
    const cur = existing.find((m) => m.metric === metric);
    if (cur && Number(cur.value) === value) continue;
    const { error } = cur
      ? await supabase.from("metrics").update({ value, source: "manual", status: "pending", flag_reason: null, approved_by: null, approved_at: null, pulled_at: new Date().toISOString(), window_end: today }).eq("id", cur.id)
      : await supabase.from("metrics").upsert({ client_id: d.client_id, deliverable_id: d.id, metric, value, source: "manual", status: "pending", window_start: d.start_date ?? today, window_end: today }, { onConflict: "deliverable_id,metric,source,window_end" });
    if (error) return { error: error.message };
    changed++;
  }
  const patch: Record<string, string | null> = {};
  if (fd.has("live_url")) {
    const link = String(fd.get("live_url") ?? "").trim();
    if (link && !/^https:\/\/\S+$/.test(link)) return { error: "The link has to start with https://" };
    if (link !== (d.live_url ?? "")) patch.live_url = link || null;
  }
  if (fd.has("display_title")) {
    const title = String(fd.get("display_title") ?? "").trim();
    if (title !== (d.display_title ?? "")) patch.display_title = title || null;
  }
  if (!changed && !Object.keys(patch).length) return { error: "Nothing changed." };
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("deliverables").update(patch).eq("id", d.id);
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/enter");
  revalidatePath("/admin/approvals");
  return { ok: Date.now(), message: changed ? `Saved. ${changed} ${changed === 1 ? "number is" : "numbers are"} waiting in Approvals.` : "Saved." };
}
