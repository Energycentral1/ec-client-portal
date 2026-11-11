import Link from "next/link";
import { signOut } from "@/app/login/actions";

export function Shell({ title, nav, email, children }: {
  title: string; nav: { href: string; label: string }[]; email: string; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-navy">Energy Central <span className="font-normal text-ink/60">· {title}</span></Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="py-2 text-ink/80 hover:text-navy">{n.label}</Link>)}
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-ink/60">{email}</span>
            <button type="submit" className="rounded-lg border border-line px-3 py-2 hover:bg-mist">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm text-ink/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-ink/60">{children}</p>;
}

export const fmt = (n: number | string | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
export const TYPE_LABEL: Record<string, string> = {
  newsletter_ad: "Newsletter ad", website_ad: "Website ad", email_blast: "Email blast", marketing_email: "Marketing email",
  webinar: "Webinar", powersession: "PowerSession", podcast: "Podcast", featured_story: "Featured story",
  sponsored_article: "Sponsored article", gated_content: "Gated content", non_gated_content: "Content",
  sponsorship: "Sponsorship", community_takeover: "Community takeover", linkedin_post: "LinkedIn post", reel: "Reel", other: "Other",
};
