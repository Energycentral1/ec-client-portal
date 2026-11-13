import { createClient } from "@/lib/supabase/server";

const WHEN = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** Backups (Chloe, Nov 13 2026: "how do I make sure we have backups of this?"): where the data lives, a button for a full copy
 *  now, and whether the weekly copy to Drive is running. */
export default async function Backups() {
  const supabase = await createClient();
  const { data: last } = await supabase.from("sync_runs").select("started_at, finished_at, status, records_written, error").eq("source", "backup").order("started_at", { ascending: false }).limit(1);
  const run = last?.[0] as { started_at: string; finished_at: string | null; status: string | null; records_written: number; error: string | null } | undefined;
  const counts = await Promise.all((["clients", "deliverables", "metrics", "leads", "proofs"] as const).map(async (t) => [t, (await supabase.from(t).select("id", { count: "exact", head: true })).count ?? 0] as const));
  const label: Record<string, string> = { clients: "clients", deliverables: "placements", metrics: "results", leads: "lead sign-ups", proofs: "creative approvals" };
  const card = "rounded-2xl border border-line bg-white p-5";
  return (
    <>
      <h1 className="text-3xl font-semibold">Backups</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Everything clients and the team see lives in one database. This is how to keep a copy of it that Energy Central holds.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-lg font-semibold">Download a full copy now</h2>
          <p className="mt-1 text-sm text-ink/70">One Excel file with every table, every row: {counts.map(([t, n]) => `${n.toLocaleString("en-US")} ${label[t]}`).join(", ")}. It includes lead contact details, so keep it somewhere only the team can open.</p>
          <a href="/admin/backup/download" className="mt-4 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark">Download full backup</a>
          <p className="mt-3 text-sm text-ink/60">For one client, open their page and use &ldquo;Download everything&rdquo;.</p>
        </section>
        <section className={card}>
          <h2 className="text-lg font-semibold">Copies in Google Drive</h2>
          {run ? (
            <p className="mt-1 text-sm text-ink/70">Last run {WHEN.format(new Date(run.finished_at ?? run.started_at))}: <strong className={run.status === "success" ? "text-emerald-700" : "text-[#a13a12]"}>{run.status === "success" ? `saved, ${run.records_written.toLocaleString("en-US")} rows` : "did not finish"}</strong>.{run.error ? ` ${run.error}` : ""}</p>
          ) : (
            <p className="mt-1 text-sm text-ink/70"><strong className="text-[#a13a12]">Not running yet.</strong> It is built and scheduled, but it needs a Drive folder to write to and a key that lets it write there. Until then, use the download button.</p>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/60">
            <li><strong className="text-ink/80">Weekly database copies</strong>: every Sunday, a dated Excel file and a complete data file. Older copies are kept, never overwritten.</li>
            <li><strong className="text-ink/80">Uploaded files</strong>: every night, anything the team has uploaded to the portal (creative), in a folder per client. A file stays there even if it is later deleted in the portal.</li>
          </ul>
        </section>
      </div>
      <section className={`${card} mt-4`}>
        <h2 className="text-lg font-semibold">Where things live</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
          <li><strong>Supabase</strong> (project &ldquo;EC Client Portals&rdquo;): clients, placements, results, leads, logins, creative approvals and the creative files. Supabase backs the database up every day and keeps 7 days, restorable from its Backups screen (Pro plan, on since Nov 13 2026). Those backups do not include the creative files.</li>
          <li><strong>GitHub</strong>: the portal&apos;s code and the results read from the old Customer Reports, one file per client.</li>
          <li><strong>Notion</strong>: what was sold and scheduled. The portal copies it in every morning and never writes back.</li>
          <li><strong>Google Drive</strong>: the original Customer Reports and lead lists, untouched.</li>
        </ul>
        <p className="mt-3 text-sm text-ink/60">Nothing in the portal deletes on its own: the daily pulls only add or update, a rejected result is hidden rather than erased, and a removed login is kept and blocked. The one delete button is &ldquo;Delete this for good&rdquo; on a creative.</p>
      </section>
    </>
  );
}
