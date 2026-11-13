import { createClient, getProfile } from "@/lib/supabase/server";
import { Empty } from "@/components/Shell";
import { ClientList } from "@/components/ClientList";
import { loadClientRows } from "@/lib/teamData";

/** Clients: every client, who owns the account, and what each still needs. */
export default async function Clients() {
  const supabase = await createClient();
  const profile = await getProfile();
  const { rows } = await loadClientRows(supabase, profile);
  return (
    <>
      <h1 className="text-3xl font-semibold">Clients</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Account manager and seller come from each client&apos;s campaigns in Notion.</p>
      {rows.length === 0 ? <div className="mt-6"><Empty>No clients yet.</Empty></div> : <ClientList rows={rows} />}
    </>
  );
}
