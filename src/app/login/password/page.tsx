"use client";
import { useActionState } from "react";
import { setPassword } from "../actions";

export default function ChoosePassword() {
  const [state, action, pending] = useActionState(setPassword, null);
  const field = "mt-1 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-navy">Energy Central</p>
        <h1 className="mt-1 text-2xl font-semibold">Choose a password</h1>
        <p className="mt-2 text-sm text-ink/70">At least 10 characters. You&rsquo;ll sign in with your email and this password from now on.</p>
        <label htmlFor="password" className="mt-6 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={field} />
        <label htmlFor="again" className="mt-4 block text-sm font-medium">Password again</label>
        <input id="again" name="again" type="password" required minLength={10} autoComplete="new-password" className={field} />
        {state?.error && <p role="alert" className="mt-4 text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending} className="mt-6 w-full rounded-lg bg-navy px-4 py-3 font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
          {pending ? "Saving…" : "Save password"}</button>
      </form>
    </main>
  );
}
