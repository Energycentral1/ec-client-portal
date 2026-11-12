import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TYPE_LABEL } from "@/components/Shell";
import { LeadUpload } from "@/components/LeadUpload";

/** Add leads by hand: a CSV export from Zoom, GoToWebinar or Tally for one placement. Zoom and Tally leads normally arrive
 *  on their own; this is for lists that did not (older sessions, in-person events, a list a partner sent). */
export default async function AddLeads({ searchParams }: { searchParams: Promise<{ client?: string; bulk?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name, slug").order("name");
  const current = (clients ?? []).find((c) => c.slug === sp.client);
  const { data: dels } = current ? await supabase.from("deliverables").select("id, deliverable_type, deliverable_label, display_title, start_date")
    .eq("client_id", current.id).in("deliverable_type", ["webinar", "powersession", "gated_content", "non_gated_content", "sponsored_article", "featured_story", "other"])
    .order("start_date", { ascending: false }) : { data: [] };
  const placements = (dels ?? []).map((d) => ({ id: d.id, label: `${d.start_date ?? "no date"} · ${d.display_title || d.deliverable_label || TYPE_LABEL[d.deliverable_type]}`.slice(0, 110) }));
  const bulk = sp.bulk === "1";
  return (
    <>
      <h1 className="text-3xl font-semibold">Add leads</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink/60">Zoom registrations and on-demand sign-ups arrive on their own. Use this for a list that didn&rsquo;t: export it as CSV, pick the placement it belongs to and upload it. Anyone already on that placement is left as they are, so uploading a list twice adds nothing. Clients see leads straight away.</p>
      {bulk ? <LeadUpload client={null} placements={[]} /> : (
        <>
          <form action="/admin/leads" className="mt-4 flex flex-wrap items-center gap-2">
            <select name="client" defaultValue={sp.client ?? ""} aria-label="Client" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="" disabled>Choose a client</option>
              {(clients ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
            <button className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark">Show</button>
          </form>
          {current && (placements.length ? <LeadUpload client={current.slug} placements={placements} />
            : <p className="mt-4 rounded-xl border border-dashed border-line bg-white p-6 text-sm text-ink/60">{current.name} has no session or content placement to attach leads to. Check it exists in Notion, or in <Link href={`/admin/enter?client=${current.slug}`} className="text-navy underline">Manual entry</Link>.</p>)}
        </>
      )}
    </>
  );
}
