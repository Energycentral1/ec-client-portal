"use server";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";

export async function reviewMetric(formData: FormData) {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Admins only");
  const decision = formData.get("decision") === "approve" ? "approved" : "rejected";
  const supabase = await createClient();
  const { error } = await supabase.from("metrics")
    .update({ status: decision, approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath("/admin/approvals");
}
