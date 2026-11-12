import Link from "next/link";
import { signOut } from "@/app/login/actions";

const LOGO = "https://media.beehiiv.com/cdn-cgi/image/format=auto,onerror=redirect/uploads/asset/file/fb5b602b-7301-4246-8c72-6cd4d1ddb8ae/Logo_Landscape_-_Ripe_Lemon_2x.png";

export function Shell({ title, nav, email, children }: {
  title: string; nav: { href: string; label: string }[]; email: string; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            {/* The logo is the one on news.energycentral.com, served from the same place, so it changes when the site's does. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="Energy Central" width={158} height={25} className="h-[25px] w-auto" />
            <span className="border-l border-white/30 pl-3 text-sm text-white/80">{title}</span>
          </Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="py-2 text-white/85 hover:text-sun">{n.label}</Link>)}
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-white/70">{email}</span>
            <button type="submit" className="rounded-lg border border-white/40 px-3 py-2 hover:bg-white/10">Sign out</button>
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
  sponsored_article: "Partner Content", gated_content: "Gated content", non_gated_content: "Content",
  sponsorship: "Sponsorship", community_takeover: "Community takeover", linkedin_post: "LinkedIn post", reel: "Reel", other: "Other",
};
