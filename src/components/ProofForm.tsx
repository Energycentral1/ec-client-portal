"use client";

import { useActionState, useEffect, useRef } from "react";
import { addProof, type ProofFormState } from "@/app/proofs/actions";

const field = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";

/** Team only: send the creative a client needs to sign off, tied to the placement it is for (picked from Notion inventory). The creative goes in
 *  exactly as it will appear (Chloe, Nov 13 2026): no name to type, no copy fields, no preview layout to choose. */
export function ProofForm({ clientId, placements }: { clientId: string; placements: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ProofFormState, FormData>(addProof, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) form.current?.reset(); }, [state.ok]);
  return (
    <form ref={form} action={action} className="rounded-2xl border border-line bg-white p-5 text-sm">
      <h3 className="text-base font-semibold">Send creative for approval</h3>
      <p className="mt-1 text-ink/60">Upload the creative exactly as it will run. The client sees it at the top of their page until they approve it or ask for changes.</p>
      <input type="hidden" name="client_id" value={clientId} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">Placement <span className="text-ink/50">(from Notion inventory)</span>
          <select name="deliverable_id" className={field} defaultValue="">
            <option value="">Not tied to a placement</option>
            {placements.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select></label>
        <label className="block">The creative <span className="text-ink/50">(image or PDF, up to 4 MB)</span>
          <input name="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" className={field} /></label>
        <label className="block">Or a link to it <span className="text-ink/50">(Figma, Drive, Canva)</span>
          <input name="link_url" type="url" placeholder="https://" className={field} /></label>
        <label className="block">Where it clicks to <span className="text-ink/50">(optional)</span>
          <input name="click_url" type="url" placeholder="https://" className={field} /></label>
        <label className="block">Approve by <span className="text-ink/50">(leave empty for 3 days before it runs)</span>
          <input name="due_date" type="date" className={field} /></label>
        <label className="block sm:col-span-2">Note for the client <span className="text-ink/50">(optional)</span>
          <textarea name="note" rows={2} placeholder="What changed in this version, anything to check" className={field} /></label>
      </div>
      <label className="mt-4 flex items-center gap-2"><input type="checkbox" name="notify" defaultChecked className="size-4" /> Email the client&apos;s logins that this is waiting for them</label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-navy px-4 py-2 font-semibold text-white hover:bg-navy-dark disabled:opacity-50">{pending ? "Adding…" : "Send for approval"}</button>
        <p role="status" className={state.error ? "text-red-700" : "text-emerald-700"}>{state.error ?? (state.ok ? `Added. It is now at the top of the client's page. ${state.message ?? ""}` : "")}</p>
      </div>
    </form>
  );
}
