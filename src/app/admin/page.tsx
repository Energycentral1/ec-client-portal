import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Empty, TYPE_LABEL } from "@/components/Shell";
import { CHANNELS } from "@/components/ClientView";
import { ClientList, type ClientRow } from "@/components/ClientList";

type D = { reported_with: string | null; client_id: string; campaign_id: string | null; notion_page_id: string | null; deliverable_type: string; start_date: string | null; metrics: { metric: string; status: string }[] };
type Waiting = { status: string; client_id: string; pulled_at: string | null; deliverable_id: string; deliverables: { deliverable_type: string } | null };
type OpenProof = { id: string; client_id: string; deliverable_id: string | null; name: string; status: "awaiting_review" | "changes_requested"; due_date: string | null; created_at: string; feedback: string | null };

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string) => DAY.format(new Date(d.length === 10 ? d + "T00:00:00Z" : d));
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Home (Chloe, Nov 13 2026: "log on and see right away"): who you are, the clients with new numbers waiting for your
 *  approval, creative out with clients and the way to send more, then every client. */
export default async function AdminHome() {
  const supabase = await createClient();
  const profile = await getProfile();
  const today = new Date().toISOString().slice(0, 10);
  const { data: clients } = await supabase.from("clients").select("id, name, slug, is_active, customer_report_sheet_url, profiles(removed_at)").order("name");
  // Every placement, read in pages because the API returns 1,000 rows at a time.
  const all: D[] = [];
  for (let from = 0; from < 8000; from += 1000) {
    const { data } = await supabase.from("deliverables").select("client_id, campaign_id, notion_page_id, deliverable_type, start_date, reported_with, metrics(metric, status)").order("id").range(from, from + 999);
    all.push(...((data ?? []) as unknown as D[]));
    if (!data || data.length < 1000) break;
  }
  const { data: waitingRows } = await supabase.from("metrics").select("status, client_id, pulled_at, deliverable_id, deliverables(deliverable_type)").in("status", ["pending", "flagged"]).limit(1000);
  const { data: proofRows } = await supabase.from("proofs").select("id, client_id, deliverable_id, name, status, due_date, created_at, feedback")
    .in("status", ["awaiting_review", "changes_requested"]).order("created_at", { ascending: false });

  // Same rules as Manual entry: only placements on a campaign count, and one "needs numbers" once it has run and a column is empty.
  const colsOf = (t: string) => CHANNELS.find((c) => c.types.includes(t))?.cols ?? [];
  const mine = all.filter((d) => (d.campaign_id || !d.notion_page_id) && colsOf(d.deliverable_type).length);
  const live = (d: D) => d.metrics.filter((m) => m.status !== "rejected");
  const missing = (d: D) => !d.reported_with && !!d.start_date && d.start_date <= today && d.deliverable_type !== "marketing_email" && colsOf(d.deliverable_type).some(([m]) => !live(d).some((x) => x.metric === m));
  const rows: ClientRow[] = (clients ?? []).map((c) => {
    const ds = mine.filter((d) => d.client_id === c.id);
    return { id: c.id, name: c.name, slug: c.slug, live: c.is_active, placements: ds.length, need: ds.filter(missing).length,
      approve: ds.reduce((n, d) => n + d.metrics.filter((m) => m.status === "pending" || m.status === "flagged").length, 0),
      logins: ((c.profiles ?? []) as { removed_at: string | null }[]).filter((p) => !p.removed_at).length, report: c.customer_report_sheet_url };
  });
  const byId = new Map((clients ?? []).map((c) => [c.id, c]));

  // New numbers, one line per client, the client with the most recent arrival first.
  const waiting = (waitingRows ?? []) as unknown as Waiting[];
  const queue = [...new Set(waiting.map((w) => w.client_id))].map((id) => {
    const ws = waiting.filter((w) => w.client_id === id);
    const kinds = new Map<string, Set<string>>();
    for (const w of ws) { const t = w.deliverables?.deliverable_type ?? "other"; kinds.set(t, (kinds.get(t) ?? new Set()).add(w.deliverable_id)); }
    return { client: byId.get(id), n: ws.length, flagged: ws.filter((w) => w.status === "flagged").length,
      newest: ws.map((w) => w.pulled_at ?? "").sort().pop() ?? "",
      what: [...kinds].sort((a, b) => b[1].size - a[1].size).map(([t, s]) => plural(s.size, (TYPE_LABEL[t] ?? "placement").toLowerCase())).join(", ") };
  }).filter((q) => q.client).sort((a, b) => b.newest.localeCompare(a.newest));

  // Creative still open: only the latest version for a placement counts.
  const seen = new Set<string>();
  const open = ((proofRows ?? []) as OpenProof[]).filter((p) => { if (!p.deliverable_id) return true; if (seen.has(p.deliverable_id)) return false; seen.add(p.deliverable_id); return true; });
  const changes = open.filter((p) => p.status === "changes_requested");
  const out = open.filter((p) => p.status === "awaiting_review");

  const first = (profile?.full_name?.trim().split(/\s+/)[0]) || (profile?.email ?? "").split(/[@.]/)[0].replace(/^./, (c) => c.toUpperCase());
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const numbers = waiting.length;
  const card = "rounded-2xl border border-line bg-white";
  return (
    <>
      <p className="text-sm text-ink/60">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }).format(new Date())}</p>
      <h1 className="mt-1 font-display text-4xl tracking-tight">{hello}{first ? `, ${first}` : ""}.</h1>
      <p className="mt-2 max-w-3xl text-lg text-ink/80">
        {numbers ? <>{plural(numbers, "new number")} from {plural(queue.length, "client")} {numbers === 1 ? "is" : "are"} waiting for your approval.</> : <>No new numbers are waiting for your approval.</>}{" "}
        {changes.length > 0 && <>{plural(changes.length, "client")} asked for changes to creative. </>}
        {out.length > 0 && <>{plural(out.length, "creative")} {out.length === 1 ? "is" : "are"} out with clients.</>}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section aria-labelledby="h-approve" className={`${card} lg:col-span-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id="h-approve" className="text-lg font-semibold">New numbers to approve</h2>
            {numbers > 0 && <Link href="/admin/approvals" className="rounded-lg bg-navy px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-dark">Review all {numbers.toLocaleString("en-US")}</Link>}
          </div>
          {queue.length === 0 ? <p className="px-5 py-8 text-sm text-ink/60">You&apos;re caught up. New numbers show here as the pulls bring them in or someone types them in.</p> : (
            <ul>
              {queue.map((q) => (
                <li key={q.client!.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-0">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sun text-sm font-semibold tabular-nums">{q.n}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/admin/clients/${q.client!.slug}`} className="font-medium hover:underline">{q.client!.name}</Link>
                    <span className="block text-sm text-ink/60">{q.what}{q.flagged > 0 && <span className="ml-2 rounded bg-ember/15 px-1.5 py-0.5 text-xs font-medium text-[#a13a12]">{q.flagged} flagged as unusual</span>}</span>
                  </span>
                  {q.newest && <span className="text-sm text-ink/50">in {day(q.newest)}</span>}
                  <Link href={`/admin/approvals?client=${q.client!.slug}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy hover:border-navy">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-creative" className={`${card} lg:col-span-2`}>
          <div className="border-b border-line px-5 py-4">
            <h2 id="h-creative" className="text-lg font-semibold">Creative approvals</h2>
            <p className="mt-1 text-sm text-ink/60">Send a client the ad as it will run. They approve it or ask for changes on their page.</p>
            <Link href="/admin/creative" className="mt-3 inline-block rounded-lg bg-sun px-4 py-2 text-sm font-semibold text-ink hover:brightness-95">Send creative to a client</Link>
          </div>
          {open.length === 0 ? <p className="px-5 py-6 text-sm text-ink/60">Nothing is out with a client right now.</p> : (
            <ul>
              {[...changes, ...out].slice(0, 6).map((p) => { const c = byId.get(p.client_id); return (
                <li key={p.id} className="border-b border-line px-5 py-3 text-sm last:border-0">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={c ? `/admin/clients/${c.slug}#approvals` : "/admin/creative"} className="font-medium hover:underline">{c?.name ?? "Client"}</Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === "changes_requested" ? "bg-ember/15 text-[#a13a12]" : "bg-mist text-ink/70"}`}>{p.status === "changes_requested" ? "Changes requested" : "Waiting on the client"}</span>
                  </span>
                  <span className="block text-ink/70">{p.name}{p.due_date && p.status === "awaiting_review" && <span className={p.due_date < today ? "text-[#a13a12]" : "text-ink/50"}> · approve by {day(p.due_date)}</span>}</span>
                  {p.status === "changes_requested" && p.feedback && <span className="mt-1 block border-l-2 border-ember/50 pl-2 text-ink/80">{p.feedback.length > 140 ? p.feedback.slice(0, 140) + "…" : p.feedback}</span>}
                </li>
              ); })}
              {open.length > 6 && <li className="px-5 py-3 text-sm"><Link href="/admin/creative" className="text-navy hover:underline">See all {open.length}</Link></li>}
            </ul>
          )}
        </section>
      </div>

      <h2 id="clients" className="mt-12 scroll-mt-16 font-display text-2xl">Your clients</h2>
      {rows.length === 0 ? <div className="mt-4"><Empty>No clients yet.</Empty></div> : <ClientList rows={rows} />}
    </>
  );
}
