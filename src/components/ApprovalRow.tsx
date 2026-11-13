"use client";
import { useState } from "react";
import { reviewMetric } from "@/app/admin/approvals/actions";
import { Pencil, editClass } from "@/components/EditLink";

/** The number and decision cells of one Approvals row. "Edit" turns the number into a box; Approve then saves the corrected
 *  number and approves it in one step. */
export function ApprovalCells({ id, value, metric, source, flag }: { id: string; value: number; metric: string; source: string; flag: string | null }) {
  const [editing, setEditing] = useState(false);
  const form = `review-${id}`;
  return (
    <>
      <td className="whitespace-nowrap px-4 py-3">
        {editing ? (
          <input form={form} name="value" defaultValue={value} inputMode="numeric" autoFocus aria-label={`Corrected ${metric}`}
            className="w-28 rounded-lg border border-sky px-2 py-1.5 text-right tabular-nums outline-none focus:ring-2 focus:ring-sky/30" />
        ) : <span className="font-medium tabular-nums">{Number(value).toLocaleString("en-US")}</span>} {metric}
        <span className="block text-xs text-ink/50">from {source}</span>
        <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={`${editClass} mt-1.5 !px-2 !py-1 !text-xs`}>{editing ? "Cancel edit" : <><Pencil />Edit number</>}</button>
      </td>
      <td className="px-4 py-3">{flag ? <span className="rounded bg-sun/60 px-1.5 py-0.5">{flag}</span> : <span className="text-ink/50">New</span>}</td>
      <td className="px-4 py-3">
        <form id={form} action={reviewMetric} className="flex gap-2">
          <input type="hidden" name="id" value={id} />
          <button name="decision" value="approve" className="whitespace-nowrap rounded-lg bg-navy px-3 py-2 font-medium text-white hover:bg-navy-dark">{editing ? "Save and approve" : "Approve"}</button>
          <button name="decision" value="reject" className="rounded-lg border border-line px-3 py-2 hover:bg-mist">Reject</button>
        </form>
      </td>
    </>
  );
}
