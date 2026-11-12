"use client";
import { useActionState } from "react";
import { setPassword } from "../actions";
import { LoginFrame } from "@/components/LoginFrame";

export default function ChoosePassword() {
  const [state, action, pending] = useActionState(setPassword, null);
  const field = "mt-1 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30";
  return (
    <LoginFrame heading="Choose a password">
      <form action={action}>
        <p className="mt-2 text-sm text-ink/70">At least 10 characters. You&rsquo;ll sign in with your email and this password from now on.</p>
        <label htmlFor="password" className="mt-6 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={field} />
        <label htmlFor="again" className="mt-4 block text-sm font-medium">Password again</label>
        <input id="again" name="again" type="password" required minLength={10} autoComplete="new-password" className={field} />
        {state?.error && <p role="alert" className="mt-4 text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending} className="mt-6 w-full rounded-lg bg-navy px-4 py-3 font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
          {pending ? "Saving…" : "Save password"}</button>
      </form>
    </LoginFrame>
  );
}
