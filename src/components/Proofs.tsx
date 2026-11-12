import { reviewProof, removeProof } from "@/app/proofs/actions";

export type Proof = { id: string; deliverable_id: string | null; name: string; copy_text: string | null; click_url: string | null; note: string | null;
  file_path: string | null; link_url: string | null; due_date: string | null; status: "awaiting_review" | "changes_requested" | "approved";
  feedback: string | null; reviewed_by_email: string | null; reviewed_at: string | null; created_at: string };

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string) => DAY.format(new Date(d.length === 10 ? d + "T00:00:00Z" : d));
export const PROOF_STATUS: Record<Proof["status"], [string, string]> = {
  awaiting_review: ["Needs your approval", "bg-sun text-ink"],
  changes_requested: ["Changes requested", "bg-ember/15 text-[#a13a12]"],
  approved: ["Approved", "bg-emerald-100 text-emerald-800"],
};
const btn = "rounded-lg border border-line bg-white px-3 py-2 text-sm hover:border-navy";

/** One proof: what will run, where and when, and the two things a client can do about it. */
export function ProofCard({ proof: p, fileUrl, placement, version, admin, today }: {
  proof: Proof; fileUrl: string | null; placement: { label: string; date: string | null } | null; version: number | null; admin: boolean; today: string }) {
  const [label, tone] = PROOF_STATUS[p.status];
  const isImage = !!p.file_path && /\.(png|jpe?g|gif|webp)$/i.test(p.file_path);
  const waiting = p.status === "awaiting_review";
  const late = waiting && p.due_date != null && p.due_date < today;
  return (
    <article className={`flex flex-col rounded-2xl bg-white p-5 text-sm ${waiting ? "border-2 border-sun" : "border border-line"}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{admin && waiting ? "Waiting for the client" : label}</span>
        {version != null && <span className="text-ink/60">Version {version}</span>}
        {waiting && p.due_date && <span className={late ? "font-medium text-red-700" : "text-ink/70"}>{late ? "Was due" : "Approve by"} {day(p.due_date)}</span>}
      </p>
      <h3 className="mt-3 text-base font-semibold">{p.name}</h3>
      {placement && <p className="text-ink/70">{placement.label}{placement.date && <>, {placement.date > today ? "runs" : "ran"} {day(placement.date)}</>}</p>}

      {isImage && fileUrl && (
        // Signed, short-lived storage URL, so next/image optimisation doesn't apply.
        // eslint-disable-next-line @next/next/no-img-element
        <a href={fileUrl} target="_blank" rel="noreferrer" className="mt-4 block rounded-xl border border-line bg-mist p-3"><img src={fileUrl} alt={`Creative: ${p.name}`} className="mx-auto max-h-80 w-auto max-w-full" /></a>
      )}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="text-navy underline decoration-navy/30 underline-offset-2">{isImage ? "Open full size" : "Open the file"}</a>}
        {p.link_url && <a href={p.link_url} target="_blank" rel="noreferrer" className="text-navy underline decoration-navy/30 underline-offset-2">Open the creative</a>}
      </p>
      {p.copy_text && <div className="mt-3 rounded-xl bg-mist px-4 py-3"><p className="text-xs text-ink/60">Ad copy as it will run</p><p className="mt-1 whitespace-pre-wrap">{p.copy_text}</p></div>}
      {p.click_url && <p className="mt-3">Clicks go to <a href={p.click_url} target="_blank" rel="noreferrer" className="break-all text-navy underline decoration-navy/30 underline-offset-2">{p.click_url}</a></p>}
      {p.note && <p className="mt-3 text-ink/80"><span className="text-ink/60">Note from Energy Central:</span> {p.note}</p>}

      {p.status === "changes_requested" && (
        <div className="mt-3 rounded-xl bg-ember/10 px-4 py-3"><p className="text-xs text-ink/60">Changes requested{p.reviewed_by_email && ` by ${p.reviewed_by_email}`}{p.reviewed_at && `, ${day(p.reviewed_at)}`}</p>
          <p className="mt-1 whitespace-pre-wrap">{p.feedback}</p>
          {!admin && <p className="mt-2 text-ink/60">Energy Central will post a new version here.</p>}</div>
      )}
      {p.status === "approved" && <p className="mt-3 text-ink/70">Approved{p.reviewed_by_email && ` by ${p.reviewed_by_email}`}{p.reviewed_at && `, ${day(p.reviewed_at)}`}</p>}

      <div className="mt-auto flex flex-wrap items-start gap-2 pt-4">
        {waiting && (
          <>
            <form action={reviewProof}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value="approved" />
              <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark">{admin ? "Mark approved for the client" : "Approve"}</button></form>
            <details className="group min-w-0 basis-full sm:basis-auto sm:flex-1">
              <summary className={`${btn} inline-block cursor-pointer list-none`}>{admin ? "Log requested changes" : "Request changes"}</summary>
              <form action={reviewProof} className="mt-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value="changes_requested" />
                <textarea name="feedback" required rows={3} aria-label="What should change" placeholder="What should change?" className="w-full rounded-lg border border-line px-3 py-2" />
                <button type="submit" className={`${btn} mt-2`}>Send to Energy Central</button></form>
            </details>
          </>
        )}
        {admin && !waiting && <form action={reviewProof}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value="awaiting_review" /><button type="submit" className={btn}>Send back to review</button></form>}
        {admin && (
          <details className="ml-auto"><summary className="cursor-pointer list-none px-2 py-2 text-ink/60 hover:text-red-700">Remove</summary>
            <form action={removeProof} className="mt-1"><input type="hidden" name="id" value={p.id} /><button type="submit" className="rounded-lg border border-red-300 px-3 py-2 text-red-700 hover:bg-red-50">Delete this for good</button></form></details>
        )}
      </div>
    </article>
  );
}
