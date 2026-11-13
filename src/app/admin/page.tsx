import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Empty, TYPE_LABEL } from "@/components/Shell";
import { ClientList } from "@/components/ClientList";
import { loadClientRows } from "@/lib/teamData";

type Waiting = { status: string; client_id: string; pulled_at: string | null; deliverable_id: string; deliverables: { deliverable_type: string } | null };
type OpenProof = { id: string; client_id: string; deliverable_id: string | null; name: string; status: "awaiting_review" | "changes_requested"; due_date: string | null; created_at: string; feedback: string | null };

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string) => DAY.format(new Date(d.length === 10 ? d + "T00:00:00Z" : d));
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Home (Chloe, Nov 13 2026: "log on and see right away"): who you are, the clients with results waiting for your approval
 *  (your own accounts first, then the longest wait), creative out with clients and the way to send more, then the client list. */
export default async function AdminHome() {
  const supabase = await createClient();
  const profile = await getProfile();
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await loadClientRows(supabase, profile);
  const { data: waitingRows } = await supabase.from("metrics").select("status, client_id, pulled_at, deliverable_id, deliverables(deliverable_type)").in("status", ["pending", "flagged"]).limit(1000);
  const { data: proofRows } = await supabase.from("proofs").select("id, client_id, deliverable_id, name, status, due_date, created_at, feedback")
    .in("status", ["awaiting_review", "changes_requested"]).order("created_at", { ascending: false });

  const byId = new Map(rows.map((c) => [c.id, c]));

  // Results waiting, one line per client: the signed-in person's own accounts first, then whoever has waited longest.
  const waiting = (waitingRows ?? []) as unknown as Waiting[];
  const now = Date.parse(today + "T23:59:59Z");
  const queue = [...new Set(waiting.map((w) => w.client_id))].map((id) => {
    const ws = waiting.filter((w) => w.client_id === id);
    const kinds = new Map<string, Set<string>>();
    for (const w of ws) { const t = w.deliverables?.deliverable_type ?? "other"; kinds.set(t, (kinds.get(t) ?? new Set()).add(w.deliverable_id)); }
    const oldest = ws.map((w) => w.pulled_at ?? "").filter(Boolean).sort()[0] ?? "";
    return { client: byId.get(id), n: ws.length, flagged: ws.filter((w) => w.status === "flagged").length,
      days: oldest ? Math.max(0, Math.floor((now - Date.parse(oldest)) / 864e5)) : 0,
      what: [...kinds].sort((a, b) => b[1].size - a[1].size).map(([t, s]) => plural(s.size, (TYPE_LABEL[t] ?? "placement").toLowerCase())).join(", ") };
  }).filter((q) => q.client).sort((a, b) => Number(b.client!.mine) - Number(a.client!.mine) || b.days - a.days || b.n - a.n);
  const anyMine = rows.some((r) => r.mine && r.live);

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
        {numbers ? <>{plural(numbers, "result")} from {plural(queue.length, "client")} {numbers === 1 ? "is" : "are"} waiting for your approval.</> : <>No results are waiting for your approval.</>}{" "}
        {changes.length > 0 && <>{plural(changes.length, "client")} asked for changes to creative. </>}
        {out.length > 0 && <>{plural(out.length, "creative")} {out.length === 1 ? "is" : "are"} out with clients.</>}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section aria-labelledby="h-approve" className={`${card} self-start lg:col-span-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id="h-approve" className="text-lg font-semibold">Results to approve</h2>
            {numbers > 0 && <Link href="/admin/approvals" className="rounded-lg bg-navy px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-dark">Review all {numbers.toLocaleString("en-US")}</Link>}
          </div>
          {queue.length === 0 ? <p className="px-5 py-8 text-sm text-ink/60">You&apos;re caught up. New results show here as the pulls bring them in or someone adds them.</p> : (
            <ul>
              {queue.map((q) => (
                <li key={q.client!.id} className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-0 hover:bg-mist/60">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sun text-sm font-semibold tabular-nums" aria-hidden>{q.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{q.client!.name}</span>
                    {anyMine && q.client!.mine && <span className="ml-2 rounded bg-navy/10 px-1.5 py-0.5 text-xs font-medium text-navy">Yours</span>}
                    <span className="block text-sm text-ink/60">{plural(q.n, "result")} · {q.what}{q.flagged > 0 && <span className="ml-2 rounded bg-ember/15 px-1.5 py-0.5 text-xs font-medium text-[#a13a12]">{q.flagged} flagged as unusual</span>}</span>
                  </span>
                  <span className={`text-sm ${q.days >= 7 ? "font-medium text-[#a13a12]" : "text-ink/50"}`}>{q.days === 0 ? "new today" : `waiting ${plural(q.days, "day")}`}</span>
                  {/* The whole row is the link. */}
                  <Link href={`/admin/approvals?client=${q.client!.slug}`} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-navy after:absolute after:inset-0 hover:border-navy">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-creative" className={`${card} self-start lg:col-span-2`}>
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

      <h2 id="clients" className="mt-12 scroll-mt-16 font-display text-2xl">{anyMine ? "Your clients" : "Clients"}</h2>
      {rows.length === 0 ? <div className="mt-4"><Empty>No clients yet.</Empty></div> : <ClientList rows={rows} />}
    </>
  );
}
