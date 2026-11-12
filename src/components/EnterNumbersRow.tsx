"use client";

import { useActionState } from "react";
import { saveNumbers, type EnterState } from "@/app/admin/enter/actions";

const input = "mt-1 w-24 rounded-lg border border-line bg-white px-2 py-2 text-sm tabular-nums";

/** One placement in the "Enter numbers" list: a box per missing number, plus the link and name if those are missing too. */
export function EnterNumbersRow({ id, fields, needsLink, needsTitle }: {
  id: string; fields: { metric: string; label: string; value: number | null }[]; needsLink: boolean; needsTitle: boolean;
}) {
  const [state, action, pending] = useActionState<EnterState, FormData>(saveNumbers, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="deliverable_id" value={id} />
      {fields.map((f) => (
        <label key={f.metric} className="block text-xs text-ink/60">{f.label}
          {f.value != null
            ? <span className="mt-1 block w-24 py-2 text-sm font-medium tabular-nums text-ink">{f.value.toLocaleString("en-US")}</span>
            : <input name={f.metric} inputMode="numeric" autoComplete="off" className={input} />}
        </label>
      ))}
      {needsTitle && <label className="block text-xs text-ink/60">Headline the client sees
        <input name="display_title" autoComplete="off" className={`${input} w-56`} /></label>}
      {needsLink && <label className="block text-xs text-ink/60">Link to it
        <input name="live_url" type="url" placeholder="https://" autoComplete="off" className={`${input} w-56`} /></label>}
      <button type="submit" disabled={pending} className="rounded-lg bg-navy px-3 py-2 text-sm font-medium text-white hover:bg-navy-dark disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      <p role="status" className={`basis-full text-xs ${state.error ? "text-red-700" : "text-emerald-700"}`}>{state.error ?? state.message ?? ""}</p>
    </form>
  );
}
