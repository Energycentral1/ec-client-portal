"use client";
import { useRef, useState } from "react";
import { reviewMetric } from "@/app/admin/approvals/actions";
import { Pencil, editClass } from "@/components/EditLink";

/** The number and decision cells of one Approvals row. "Edit" turns the number into a box; Approve then saves the corrected
 *  number and approves it in one step. */
export function ApprovalCells({ id, value, metric, source, flag }: { id: string; value: number; metric: string; source: string; flag: string | null }) {
  const [editing, setEditing] = useState(false);
  // What was just clicked. The row says so at once and greys out, then drops off the list when the page refreshes
  // (Chloe, Nov 13 2026: "make it more clear I clicked, or remove them as they go").
  const [done, setDone] = useState<"approve" | "reject" | null>(null);
  const cell = useRef<HTMLTableCellElement>(null);
  const form = `review-${id}`;
  const clicked = (e: React.FormEvent<HTMLFormElement>) => {
    const which = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "reject" ? "reject" : "approve";
    setDone(which);   // the edit box stays mounted so its corrected value is still sent with this submit
    cell.current?.closest("tr")?.setAttribute("data-done", which);
  };
  return (
    <>
      <td className="whitespace-nowrap px-4 py-3">
        {editing ? (
          <input form={form} name="value" defaultValue={value} inputMode="numeric" autoFocus aria-label={`Corrected ${metric}`}
            className="w-28 rounded-lg border border-sky px-2 py-1.5 text-right tabular-nums outline-none focus:ring-2 focus:ring-sky/30" />
        ) : <span className="font-medium tabular-nums">{Number(value).toLocaleString("en-US")}</span>} {metric}
        <span className="block text-xs text-ink/50">from {source}</span>
        {!done && <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={`${editClass} mt-1.5 !px-2 !py-1 !text-xs`}>{editing ? "Cancel edit" : <><Pencil />Edit number</>}</button>}
      </td>
      <td className="px-4 py-3">{flag ? <span className="rounded bg-sun/60 px-1.5 py-0.5">{flag}</span> : <span className="text-ink/50">New</span>}</td>
      <td ref={cell} className="px-4 py-3">
        <form id={form} action={reviewMetric} onSubmit={clicked} className={done ? "hidden" : "flex gap-2"}>
          <input type="hidden" name="id" value={id} />
          <button name="decision" value="approve" className="whitespace-nowrap rounded-lg bg-navy px-3 py-2 font-medium text-white hover:bg-navy-dark">{editing ? "Save and approve" : "Approve"}</button>
          <button name="decision" value="reject" className="rounded-lg border border-line px-3 py-2 hover:bg-mist">Reject</button>
        </form>
        {done && <p role="status" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 font-semibold ${done === "approve" ? "bg-emerald-100 text-emerald-800" : "bg-ember/15 text-[#a13a12]"}`}>
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16"><path d={done === "approve" ? "M3 8.5l3.2 3.2L13 5" : "M4 4l8 8M12 4l-8 8"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {done === "approve" ? "Approved" : "Rejected"}</p>}
      </td>
    </>
  );
}
