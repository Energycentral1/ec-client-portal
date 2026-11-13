"use server";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";

/** Approve or reject one number. If the row was edited first, the corrected number is saved with the approval. */
export async function reviewMetric(formData: FormData) {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Admins only");
  const decision = formData.get("decision") === "approve" ? "approved" : "rejected";
  const patch: Record<string, unknown> = { status: decision, approved_by: profile.id, approved_at: new Date().toISOString() };
  if (decision === "approved" && formData.has("value")) {
    const value = Number(String(formData.get("value") ?? "").replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value < 0) throw new Error("That is not a number.");
    patch.value = value; patch.flag_reason = null;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("metrics").update(patch).eq("id", String(formData.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath("/admin", "layout");
}

/** Approve every result waiting for one client in one go. Results flagged as unusual are left for a person to look at. */
export async function approveAll(formData: FormData) {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Admins only");
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id").eq("slug", String(formData.get("client"))).maybeSingle();
  if (!client) throw new Error("No such client");
  const { error } = await supabase.from("metrics").update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() }).eq("client_id", client.id).eq("status", "pending");
  if (error) throw new Error(error.message);
  revalidatePath("/admin", "layout");
}
