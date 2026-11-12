"use client";
import { useState } from "react";

type Result = { client: string; list: string; placement: string | null; inFile: number; added: number; alreadyThere: number; note?: string };
const field = "rounded-lg border border-line bg-white px-3 py-2 text-sm";

/** Upload form for /admin/leads. Posts the file to the upload route and shows what happened to each list. */
export function LeadUpload({ client, placements }: { client: string | null; placements: { id: string; label: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null); setResults(null);
    try {
      const r = await fetch("/admin/leads/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "The upload failed.");
      setResults(j.results ?? null);
    } catch { setError("The upload failed. Try again."); }
    setBusy(false);
  }
  const total = (k: "added" | "alreadyThere" | "inFile") => (results ?? []).reduce((n, r) => n + r[k], 0);
  return (
    <>
      <form onSubmit={send} className="mt-4 rounded-xl border border-line bg-white p-4">
        {client && <input type="hidden" name="client" value={client} />}
        <div className="flex flex-wrap items-end gap-3">
          {client && (
            <>
              <label className="text-sm font-medium">Placement
                <select name="deliverable_id" required defaultValue="" className={`${field} mt-1 block max-w-md font-normal`}>
                  <option value="" disabled>Choose the session or content piece</option>
                  {placements.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select></label>
              <label className="text-sm font-medium">How they came in
                <select name="source" required defaultValue="" className={`${field} mt-1 block font-normal`}>
                  <option value="" disabled>Choose</option>
                  <option value="webinar_live">Registered or attended live</option>
                  <option value="webinar_on_demand">Watched on demand</option>
                  <option value="gated_content">Downloaded content</option>
                </select></label>
            </>
          )}
          <label className="text-sm font-medium">{client ? "Lead list (CSV)" : "Prepared file"}
            <input name="file" type="file" required accept={client ? ".csv" : ".json"} className="mt-1 block text-sm font-normal" /></label>
          <button type="submit" disabled={busy} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-60">{busy ? "Adding…" : "Add leads"}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </form>
      {results && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-white" role="status">
          <p className="border-b border-line px-4 py-3 text-sm font-medium">{total("added").toLocaleString("en-US")} leads added, {total("alreadyThere").toLocaleString("en-US")} were already there ({total("inFile").toLocaleString("en-US")} in the file).</p>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60"><tr><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 font-medium">List</th><th className="px-4 py-2 font-medium">Placement</th><th className="px-4 py-2 font-medium">In file</th><th className="px-4 py-2 font-medium">Added</th><th className="px-4 py-2 font-medium">Already there</th></tr></thead>
            <tbody>{results.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{r.client}</td><td className="px-4 py-2">{r.list}</td>
                <td className="px-4 py-2">{r.placement ?? <span className="rounded bg-sun/60 px-1.5 py-0.5">{r.note}</span>}</td>
                <td className="px-4 py-2 tabular-nums">{r.inFile}</td><td className="px-4 py-2 tabular-nums">{r.added}</td><td className="px-4 py-2 tabular-nums">{r.alreadyThere}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
