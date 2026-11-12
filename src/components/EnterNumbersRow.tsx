"use client";

import { useActionState } from "react";
import { saveNumbers, type EnterState } from "@/app/admin/enter/actions";

const box = "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm hover:border-line focus:border-navy focus:bg-white focus:outline-none";

export type Field = { metric: string; value: number | null; note: string | null };

/** One placement as a table row, edited in place like a Notion row: every cell is a box, Save sends the row. */
export function InventoryRow({ id, date, label, tag, notionUrl, status, title, link, fields, missing }: {
  id: string; date: string | null; label: string; tag: string | null; notionUrl: string | null; status: string | null;
  title: string | null; link: string | null; fields: Field[]; missing: boolean;
}) {
  const [state, action, pending] = useActionState<EnterState, FormData>(saveNumbers, {});
  const form = `f-${id}`;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">{date ?? "No date"}</td>
      <td className="px-3 py-2">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-ink/60">
          {notionUrl ? <a href={notionUrl} target="_blank" rel="noreferrer" className="text-navy hover:underline">{tag ?? "Notion row"}</a> : (tag ?? "Old report")}
          {status ? ` · ${status}` : ""}{missing && <span className="ml-1 rounded bg-sun/60 px-1 text-ink">missing results</span>}
        </span>
      </td>
      <td className="px-1 py-1"><input form={form} name="display_title" defaultValue={title ?? ""} placeholder="Title the client sees" aria-label="Title the client sees" autoComplete="off" className={box} /></td>
      {fields.map((f) => (
        <td key={f.metric} className="px-1 py-1">
          <input form={form} name={f.metric} defaultValue={f.value ?? ""} inputMode="numeric" autoComplete="off" aria-label={f.metric.replace(/_/g, " ")}
            className={`${box} w-24 text-right tabular-nums ${f.value == null ? "border-line bg-white" : ""}`} />
          {f.note && <span className="block px-2 text-right text-[11px] text-ink/50">{f.note}</span>}
        </td>
      ))}
      <td className="px-1 py-1">
        <input form={form} name="live_url" type="url" defaultValue={link ?? ""} placeholder="https://" aria-label="Link" autoComplete="off" className={`${box} min-w-40`} />
        {link && <a href={link} target="_blank" rel="noreferrer" className="block px-2 text-[11px] text-navy hover:underline">Open</a>}
      </td>
      <td className="px-3 py-2">
        <form id={form} action={action}>
          <input type="hidden" name="deliverable_id" value={id} />
          <button type="submit" disabled={pending} className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-dark disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        </form>
        <p role="status" className={`mt-1 max-w-40 text-[11px] ${state.error ? "text-red-700" : "text-emerald-700"}`}>{state.error ?? state.message ?? ""}</p>
      </td>
    </tr>
  );
}
