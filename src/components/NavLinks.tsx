"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Top navigation with the current section marked. Anything scoped to one client (its page, its Manual entry, its Logins)
 *  counts as "Clients", so the top bar stays put while you move between a client's tabs. */
export function NavLinks({ nav }: { nav: { href: string; label: string }[] }) {
  const path = usePathname();
  const client = useSearchParams().get("client");
  const inClient = path.startsWith("/admin/clients/") || !!client;
  const active = (href: string) => (inClient ? href === "/admin" : href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <nav className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
      {nav.map((n) => (
        <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
          className={`rounded-md px-3 py-2 ${active(n.href) ? "bg-white/15 font-medium text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>{n.label}</Link>
      ))}
    </nav>
  );
}
