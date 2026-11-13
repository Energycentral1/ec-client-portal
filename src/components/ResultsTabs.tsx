import Link from "next/link";

/** The two halves of Results under one title (Chloe, Nov 13 2026: adding results "doesn't need its own tab, should it just be
 *  within Results?"): results waiting for approval, and the screen where any result is added or corrected. */
export function ResultsTabs({ active, waiting }: { active: "approve" | "edit"; waiting?: number }) {
  const tabs = [{ id: "approve", label: "To approve", href: "/admin/approvals", n: waiting }, { id: "edit", label: "Add or edit results", href: "/admin/enter", n: undefined }] as const;
  return (
    <header>
      <h1 className="text-3xl font-semibold">Results</h1>
      <nav aria-label="Results" className="mt-4 flex flex-wrap gap-x-6 border-b border-line text-sm">
        {tabs.map((t) => (
          <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-3 pt-1 ${t.id === active ? "border-navy font-semibold text-navy" : "border-transparent text-ink/65 hover:border-line hover:text-ink"}`}>
            {t.label}{t.n != null && t.n > 0 && <span className="ml-2 rounded-full bg-sun px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink">{t.n.toLocaleString("en-US")}</span>}</Link>
        ))}
      </nav>
    </header>
  );
}
