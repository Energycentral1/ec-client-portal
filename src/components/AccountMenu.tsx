"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/login/actions";

/** Top-right menu under the signed-in email: the set-up screens (team only), change password, sign out. */
export function AccountMenu({ email, links }: { email: string; links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const item = "block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-mist";
  return (
    <div ref={box} className="relative ml-auto text-sm">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white">
        <span className="max-w-[16rem] truncate">{email}</span>
        <svg aria-hidden width="10" height="6" viewBox="0 0 10 6" className={open ? "rotate-180" : ""}><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-white p-1.5 shadow-lg shadow-navy-dark/20">
          {links.map((l) => <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className={item}>{l.label}</Link>)}
          {links.length > 0 && <hr className="my-1.5 border-line" />}
          <Link href="/login/password" role="menuitem" onClick={() => setOpen(false)} className={item}>Change password</Link>
          <form action={signOut}><button type="submit" role="menuitem" className={item}>Sign out</button></form>
        </div>
      )}
    </div>
  );
}
