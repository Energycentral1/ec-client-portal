"use client";
import Link from "next/link";
import { useState } from "react";

export type ClientRow = { id: string; name: string; slug: string; live: boolean; placements: number; need: number; approve: number; logins: number; report: string | null };

/** The Clients home table with a search box and a "needs attention" filter. Each count links to where the work is done. */
export function ClientList({ rows }: { rows: ClientRow[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "live" | "todo">("live");
  const shown = rows.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()) && (q.trim() || only === "all" || (only === "live" ? c.live : c.need + c.approve > 0)));
  const chip = (id: typeof only, label: string) => (
    <button type="button" onClick={() => setOnly(id)} aria-pressed={only === id}
      className={`rounded-full px-3 py-1.5 text-sm ${only === id ? "bg-navy text-white" : "border border-line bg-white text-ink/70 hover:bg-mist"}`}>{label}</button>
  );
  const pill = "rounded bg-sun/60 px-1.5 py-0.5 tabular-nums hover:underline";
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients"
          className="w-64 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/30" />
        {chip("live", `Live (${rows.filter((c) => c.live).length})`)}
        {chip("todo", `Needs attention (${rows.filter((c) => c.need + c.approve > 0).length})`)}
        {chip("all", `All (${rows.length})`)}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-ink/60">
            <tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Placements</th><th className="px-4 py-3 font-medium">Missing results</th>
              <th className="px-4 py-3 font-medium">Awaiting approval</th><th className="px-4 py-3 font-medium">Logins</th><th className="px-4 py-3 font-medium">Old report</th></tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link href={`/admin/clients/${c.slug}`} className="font-medium text-navy hover:underline">{c.name}</Link>{!c.live && <span className="ml-2 text-xs text-ink/50">past</span>}</td>
                <td className="px-4 py-3 tabular-nums">{c.placements}</td>
                <td className="px-4 py-3">{c.need ? <Link href={`/admin/enter?client=${c.slug}&show=missing`} className={pill}>{c.need}</Link> : <span className="text-ink/40">Complete</span>}</td>
                <td className="px-4 py-3">{c.approve ? <Link href={`/admin/approvals?client=${c.slug}`} className={pill}>{c.approve}</Link> : <span className="text-ink/40">None</span>}</td>
                <td className="px-4 py-3">{c.logins ? <Link href={`/admin/logins?client=${c.slug}`} className="tabular-nums text-navy hover:underline">{c.logins}</Link> : <Link href={`/admin/logins?client=${c.slug}`} className="text-ink/50 hover:text-navy hover:underline">Add</Link>}</td>
                <td className="px-4 py-3">{c.report ? <a href={c.report} target="_blank" rel="noreferrer" className="text-navy hover:underline">Open</a> : <span className="text-ink/40">None</span>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/60">No client matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
