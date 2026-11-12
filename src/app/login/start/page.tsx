import { StartForm } from "./StartForm";

/** Landing page for a one-time link from /admin/logins. The link is only used when the person presses the button, so a chat
 *  or email app that previews the link does not use it up. */
export default async function Start({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-navy">Energy Central</p>
        <h1 className="mt-1 text-2xl font-semibold">Partner Portal</h1>
        <StartForm tokenHash={sp.token_hash ?? ""} type={sp.type === "invite" ? "invite" : "recovery"} />
      </div>
    </main>
  );
}
