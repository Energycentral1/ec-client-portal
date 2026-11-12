import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { AddLogin, LoginRow } from "@/components/LoginForms";

type P = { id: string; email: string; full_name: string | null; role: string; client_id: string | null; created_at: string };

/** Logins: who on the team can use the back-end, and which email addresses can see each client's page. */
export default async function Logins({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const sp = await searchParams;
  const me = await getProfile();
  const supabase = await createClient();
  const [{ data: people }, { data: clientRows }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, client_id, created_at").is("removed_at", null).order("email"),
    supabase.from("clients").select("id, name, slug, is_active").order("name"),
  ]);
  const all = (people ?? []) as P[];
  const clients = clientRows ?? [];
  const current = clients.find((c) => c.slug === sp.client);
  const team = all.filter((p) => p.role === "admin");
  const clientLogins = all.filter((p) => p.role === "client");
  const unlinked = clientLogins.filter((p) => !p.client_id);
  const groups = clients.filter((c) => (current ? c.id === current.id : clientLogins.some((p) => p.client_id === c.id)))
    .map((c) => ({ ...c, people: clientLogins.filter((p) => p.client_id === c.id) }));
  const ready = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  return (
    <>
      <h1 className="text-3xl font-semibold">Logins</h1>
      <p className="mt-2 max-w-2xl text-ink/70">Add or remove who can sign in. Adding someone never emails them: you get a one-time link to send yourself, and they choose their own password.</p>
      {!ready && <p role="alert" className="mt-4 rounded-lg border border-ember/40 bg-white p-3 text-sm">Adding and removing is off until <code>SUPABASE_SERVICE_ROLE_KEY</code> is added in Vercel. The lists below are current.</p>}

      {!current && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Team</h2>
          <p className="mt-1 text-sm text-ink/70">Team logins see every client and can enter, approve and edit.</p>
          <ul className="mt-4 rounded-xl border border-line bg-white">
            {team.map((p) => <LoginRow key={p.id} id={p.id} email={p.email} name={p.full_name} self={p.id === me?.id} />)}
          </ul>
          <AddLogin kind="team" />
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{current ? `${current.name} logins` : "Client logins"}</h2>
        <p className="mt-1 text-sm text-ink/70">A client login sees only that client&rsquo;s page: approved numbers, leads and creative approvals.{current && <> <Link href="/admin/logins" className="text-navy hover:underline">All logins</Link></>}</p>
        <AddLogin kind="client" clients={clients.map((c) => ({ id: c.id, name: c.name }))} defaultClient={current?.id} />
        {groups.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-line p-6 text-sm text-ink/60">{current ? "No one at this client has a login yet." : "No client has a login yet."}</p>}
        {groups.map((g) => (
          <div key={g.id} className="mt-6">
            <h3 className="font-semibold"><Link href={`/admin/clients/${g.slug}`} className="hover:underline">{g.name}</Link></h3>
            {g.people.length ? <ul className="mt-2 rounded-xl border border-line bg-white">
              {g.people.map((p) => <LoginRow key={p.id} id={p.id} email={p.email} name={p.full_name} self={false} />)}
            </ul> : <p className="mt-2 text-sm text-ink/60">No logins yet.</p>}
          </div>
        ))}
        {!current && unlinked.length > 0 && (
          <div className="mt-6">
            <h3 className="font-semibold">Not linked to a client</h3>
            <p className="text-sm text-ink/60">These can sign in but see nothing. Remove them, then add them again under the right client.</p>
            <ul className="mt-2 rounded-xl border border-line bg-white">
              {unlinked.map((p) => <LoginRow key={p.id} id={p.id} email={p.email} name={p.full_name} self={false} />)}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
