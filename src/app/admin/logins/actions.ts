"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";
import { authAdmin } from "@/lib/supabase/admin";

export type LoginState = { error?: string; link?: string; email?: string; message?: string };
const NO_KEY = "Logins can't be changed yet: SUPABASE_SERVICE_ROLE_KEY is not set in Vercel.";

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ec-client-portal.vercel.app";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}
const linkFor = async (hash: string, type: string) => `${await siteUrl()}/login/start?token_hash=${encodeURIComponent(hash)}&type=${type}`;

/** Add a team or client login. Nothing is emailed: the result is a one-time link the admin sends to the person themselves. */
export async function addLogin(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Admins only." };
  const admin = authAdmin();
  if (!admin) return { error: NO_KEY };
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("full_name") ?? "").trim() || null;
  const kind = String(fd.get("kind") ?? "");
  const clientId = String(fd.get("client_id") ?? "") || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That doesn't look like an email address." };
  if (kind !== "team" && kind !== "client") return { error: "Pick team or client." };
  if (kind === "client" && !clientId) return { error: "Pick the client this login belongs to." };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("profiles").select("id, role, client_id, removed_at").eq("email", email).maybeSingle();
  if (existing && !existing.removed_at) return { error: `${email} already has a login. Use "New link" on their row if they can't get in.` };

  let userId = existing?.id as string | undefined, hash: string | undefined, type = "invite";
  if (userId) {
    const { error: e1 } = await admin.updateUserById(userId, { ban_duration: "none" });
    if (e1) return { error: e1.message };
    const { data, error } = await admin.generateLink({ type: "recovery", email });
    if (error) return { error: error.message };
    hash = data.properties?.hashed_token; type = "recovery";
  } else {
    const { data, error } = await admin.generateLink({ type: "invite", email, options: { data: name ? { full_name: name } : undefined } });
    if (error) return { error: /registered|exists/i.test(error.message) ? `${email} already has an account. Ask Chloe to check it in Supabase.` : error.message };
    userId = data.user?.id; hash = data.properties?.hashed_token;
  }
  if (!userId || !hash) return { error: "Supabase did not return a sign-in link. Try again." };
  const { error: e2 } = await supabase.from("profiles")
    .update({ role: kind === "team" ? "admin" : "client", client_id: kind === "client" ? clientId : null, full_name: name, removed_at: null }).eq("id", userId);
  if (e2) return { error: e2.message };
  revalidatePath("/admin/logins");
  return { email, link: await linkFor(hash, type) };
}

/** A fresh one-time link for someone who lost theirs or forgot their password. */
export async function newLink(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Admins only." };
  const admin = authAdmin();
  if (!admin) return { error: NO_KEY };
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("email, removed_at").eq("id", String(fd.get("id") ?? "")).maybeSingle();
  if (!p || p.removed_at) return { error: "That login no longer exists." };
  const { data, error } = await admin.generateLink({ type: "recovery", email: p.email });
  if (error || !data.properties?.hashed_token) return { error: error?.message ?? "No link came back. Try again." };
  return { email: p.email, link: await linkFor(data.properties.hashed_token, "recovery") };
}

/** Remove a login: it can no longer sign in and sees nothing. The row is kept (hidden) because past approvals point at it. */
export async function removeLogin(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Admins only." };
  const admin = authAdmin();
  if (!admin) return { error: NO_KEY };
  const id = String(fd.get("id") ?? "");
  if (id === me.id) return { error: "You can't remove your own login." };
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("email").eq("id", id).maybeSingle();
  if (!p) return { error: "That login no longer exists." };
  const { error: e1 } = await supabase.from("profiles").update({ role: "client", client_id: null, removed_at: new Date().toISOString() }).eq("id", id);
  if (e1) return { error: e1.message };
  const { error: e2 } = await admin.updateUserById(id, { ban_duration: "876000h" });
  if (e2) return { error: `Access was removed, but blocking the sign-in failed: ${e2.message}` };
  revalidatePath("/admin/logins");
  return { message: `${p.email} removed.` };
}
