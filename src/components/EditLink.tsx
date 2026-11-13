import Link from "next/link";

/** The one look for "you can change this" across the team screens (Chloe, Nov 13 2026: "the ability to edit should be clearly
 *  labeled"): a pencil and the word Edit, outlined in navy. Use it wherever a number, title or link can be changed. */
export const Pencil = () => (
  <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" className="shrink-0"><path d="M11.2 2.3l2.5 2.5-8 8L2.5 13.5l.7-3.2 8-8zM9.8 3.7l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const editClass = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-navy bg-white px-2.5 py-1.5 text-sm font-medium text-navy hover:bg-navy hover:text-white";

export function EditLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={`${editClass} ${className}`}><Pencil />{children}</Link>;
}
