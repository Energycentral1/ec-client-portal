import Link from "next/link";
import { EditLink } from "@/components/EditLink";

export type ClientTab = "team" | "client" | "entry" | "logins";

/** The header every client-scoped screen shares: where you are, the client's name, and the same four tabs in the same
 *  place, so moving between a client's views never changes the frame. "Team view" has every number, approved or not;
 *  "Client view" is the page laid out as the client sees it (names: Chloe, Nov 12 2026, replacing "Back-end view" / "What the client sees"). */
export function ClientTabs({ slug, name, active, meta, period }: { slug: string; name: string; active: ClientTab; meta?: React.ReactNode; period?: string | null }) {
  const p = period ? `period=${period}` : "";
  const tabs: { id: ClientTab; label: string; href: string }[] = [
    { id: "team", label: "Team view", href: `/admin/clients/${slug}${p ? `?${p}` : ""}` },
    { id: "client", label: "Client view", href: `/admin/clients/${slug}?view=client${p ? `&${p}` : ""}` },
    { id: "entry", label: "Add or edit results", href: `/admin/enter?client=${slug}` },
    { id: "logins", label: "Logins", href: `/admin/logins?client=${slug}` },
  ];
  return (
    <header>
      <Link href="/admin/clients" className="inline-flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm font-medium text-navy hover:underline">
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16"><path d="M9.5 3.5L5 8l4.5 4.5M5.5 8H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        All clients
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{name}</h1>
        {(active === "team" || active === "client") && (
          <span className="flex flex-wrap gap-2">
            {/* Everything held for this client, all years, as one Excel file. A plain link so the browser downloads it. */}
            <a href={`/admin/clients/${slug}/export`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium text-ink hover:border-navy">
              <svg aria-hidden width="14" height="14" viewBox="0 0 16 16"><path d="M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Download everything</a>
            <EditLink href={`/admin/enter?client=${slug}`}>Edit results, titles and links</EditLink>
          </span>
        )}
      </div>
      {meta && <p className="mt-1 text-sm text-ink/60">{meta}</p>}
      <nav aria-label={`${name} views`} className="mt-5 flex flex-wrap gap-x-6 border-b border-line text-sm">
        {tabs.map((t) => (
          <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-3 pt-1 ${t.id === active ? "border-navy font-semibold text-navy" : "border-transparent text-ink/65 hover:border-line hover:text-ink"}`}>{t.label}</Link>
        ))}
      </nav>
    </header>
  );
}
