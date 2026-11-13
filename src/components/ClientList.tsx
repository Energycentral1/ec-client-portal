"use client";
import Link from "next/link";
import { useState } from "react";

export type ClientRow = { id: string; name: string; slug: string; live: boolean; placements: number; need: number; approve: number; logins: number; report: string | null;
  /** Account managers and sellers on the client's campaigns in Notion, and whether the signed-in person is one of them. */
  ams: string[]; sellers: string[]; mine: boolean };

/** The client table with search and filters. Each count links to where the work is done. Someone who owns accounts in Notion
 *  (AM or seller on a campaign) lands on "Mine"; everyone else on "Live". */
export function ClientList({ rows }: { rows: ClientRow[] }) {
  const anyMine = rows.some((c) => c.mine);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "live" | "todo" | "mine">(anyMine ? "mine" : "live");
  const shown = rows.filter((c) => {
    const s = q.trim().toLowerCase();
    if (s) return [c.name, ...c.ams, ...c.sellers].some((v) => v.toLowerCase().includes(s));
    return only === "all" || (only === "live" ? c.live : only === "mine" ? c.mine : c.need + c.approve > 0);
  });
  const chip = (id: typeof only, label: string) => (
    <button type="button" onClick={() => setOnly(id)} aria-pressed={only === id}
      className={`rounded-full px-3 py-1.5 text-sm ${only === id ? "bg-navy text-white" : "border border-line bg-white text-ink/70 hover:bg-mist"}`}>{label}</button>
  );
  const pill = "rounded bg-sun/60 px-1.5 py-0.5 tabular-nums hover:underline";
  const th = "px-4 py-3 font-medium";
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a client or a person" aria-label="Search clients"
          className="w-64 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/30" />
        {anyMine && chip("mine", `Mine (${rows.filter((c) => c.mine).length})`)}
        {chip("live", `Live (${rows.filter((c) => c.live).length})`)}
        {chip("todo", `Needs attention (${rows.filter((c) => c.need + c.approve > 0).length})`)}
        {chip("all", `All (${rows.length})`)}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-line text-ink/60">
            <tr><th className={th}>Client</th><th className={th}>Account manager</th><th className={th}>Seller</th><th className={th}>Missing results</th>
              <th className={th}>Awaiting approval</th><th className={th}>Logins</th><th className={th}>Old report</th></tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link href={`/admin/clients/${c.slug}`} className="font-medium text-navy hover:underline">{c.name}</Link>{!c.live && <span className="ml-2 text-xs text-ink/50">past</span>}
                  <span className="block text-xs text-ink/50">{c.placements} placements</span></td>
                <td className="px-4 py-3">{c.ams.length ? c.ams.join(", ") : <span className="text-ink/40">Not set in Notion</span>}</td>
                <td className="px-4 py-3">{c.sellers.length ? c.sellers.join(", ") : <span className="text-ink/40">Not set in Notion</span>}</td>
                <td className="px-4 py-3">{c.need ? <Link href={`/admin/enter?client=${c.slug}&show=missing`} className={pill}>{c.need}</Link> : <span className="text-ink/40">Complete</span>}</td>
                <td className="px-4 py-3">{c.approve ? <Link href={`/admin/approvals?client=${c.slug}`} className={pill}>{c.approve}</Link> : <span className="text-ink/40">None</span>}</td>
                <td className="px-4 py-3">{c.logins ? <Link href={`/admin/logins?client=${c.slug}`} className="tabular-nums text-navy hover:underline">{c.logins}</Link> : <Link href={`/admin/logins?client=${c.slug}`} className="text-ink/50 hover:text-navy hover:underline">Add</Link>}</td>
                <td className="px-4 py-3">{c.report ? <a href={c.report} target="_blank" rel="noreferrer" className="text-navy hover:underline">Open</a> : <span className="text-ink/40">None</span>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/60">No client matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
