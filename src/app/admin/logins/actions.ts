"use server";
import { randomInt } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";
import { authAdmin } from "@/lib/supabase/admin";

export type LoginState = { error?: string; email?: string; password?: string; site?: string; message?: string };
const NO_KEY = "Logins can't be changed yet: SUPABASE_SERVICE_ROLE_KEY is not set in Vercel.";

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ec-client-portal.vercel.app";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}
/** A password made here, never typed by anyone on the team: 3 groups of 4 from letters and digits that can't be misread. */
function makePassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [0, 1, 2].map(() => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("")).join("-");
}

/** Add a team or client login (Chloe, Nov 12 2026: "we need to give them logins", no expiring links). Nothing is emailed:
 *  the login is made with a password that is shown once, for the admin to pass on. It does not expire. */
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
  const { data: existing } = await supabase.from("profiles").select("id, removed_at").eq("email", email).maybeSingle();
  if (existing && !existing.removed_at) return { error: `${email} already has a login. Use "New password" on their row if they can't get in.` };

  const password = makePassword();
  let userId = existing?.id as string | undefined;
  if (userId) {     // removed earlier: bring the same login back with a fresh password
    const { error } = await admin.updateUserById(userId, { ban_duration: "none", password });
    if (error) return { error: error.message };
  } else {
    const { data, error } = await admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { full_name: name } : undefined });
    if (error) return { error: /registered|exists/i.test(error.message) ? `${email} already has an account that isn't on this list. Ask Chloe to check it in Supabase.` : error.message };
    userId = data.user?.id;
  }
  if (!userId) return { error: "Supabase did not create the login. Try again." };
  const { error: e2 } = await supabase.from("profiles")
    .update({ role: kind === "team" ? "admin" : "client", client_id: kind === "client" ? clientId : null, full_name: name, removed_at: null }).eq("id", userId);
  if (e2) return { error: e2.message };
  revalidatePath("/admin/logins");
  return { email, password, site: `${await siteUrl()}/login` };
}

/** A new password for someone who lost theirs. The old one stops working. */
export async function newPassword(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Admins only." };
  const admin = authAdmin();
  if (!admin) return { error: NO_KEY };
  const id = String(fd.get("id") ?? "");
  if (id === me.id) return { error: "Change your own password from \"Change password\" at the top of the page." };
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("email, removed_at").eq("id", id).maybeSingle();
  if (!p || p.removed_at) return { error: "That login no longer exists." };
  const password = makePassword();
  const { error } = await admin.updateUserById(id, { password });
  if (error) return { error: error.message };
  return { email: p.email, password, site: `${await siteUrl()}/login` };
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
