import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Supabase's login admin API (create a login, make a sign-in link, block a login). It needs the service role key, so this is
 *  the one place app code uses it, and only for `auth.admin` calls from /admin/logins after the caller is checked to be an
 *  admin. Never read or write tables with it: data goes through the signed-in client so row-level security applies. */
export function authAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}
