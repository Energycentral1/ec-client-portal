import { LOGO } from "@/lib/brand";

/** The signed-out pages (sign in, one-time link, choose a password): the Energy Central logo on navy over one white card. */
export function LoginFrame({ heading = "Client Portal", back, children }: { heading?: string; back?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO} alt="Energy Central" width={252} height={40} className="h-10 w-auto" />
      <div className="mt-8 w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl shadow-navy-dark/40">
        {back && <a href={back} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:underline">
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16"><path d="M9.5 3.5L5 8l4.5 4.5M5.5 8H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>Back</a>}
        <h1 className="font-display text-3xl font-medium text-navy">{heading}</h1>
        {children}
      </div>
      <p className="mt-6 text-sm text-white/70">Your campaign results, leads and creative approvals with Energy Central.</p>
    </main>
  );
}
