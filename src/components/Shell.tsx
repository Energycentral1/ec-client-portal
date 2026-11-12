import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "@/components/NavLinks";
import { AccountMenu } from "@/components/AccountMenu";

import { LOGO } from "@/lib/brand";

export function Shell({ title, nav, menu = [], email, children }: {
  title?: string; nav: { href: string; label: string; badge?: number }[]; menu?: { href: string; label: string }[]; email: string; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-3">
            {/* The logo is the one on news.energycentral.com, served from the same place, so it changes when the site's does. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="Energy Central" width={158} height={25} className="h-[25px] w-auto" />
            {title && <span className="border-l border-white/30 pl-3 text-sm text-white/80">{title}</span>}
          </Link>
          <Suspense fallback={null}><NavLinks nav={nav} /></Suspense>
          <AccountMenu email={email} links={menu} />
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
