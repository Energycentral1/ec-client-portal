"use client";
import { useActionState, useState } from "react";
import { addLogin, newPassword, removeLogin, type LoginState } from "@/app/admin/logins/actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/30";

/** The new login's details, shown once with a copy button. Nothing is emailed by the portal. */
function DetailsBox({ state }: { state: LoginState }) {
  const [copied, setCopied] = useState(false);
  if (!state.password) return null;
  const text = `Energy Central Client Portal\n${state.site}\nEmail: ${state.email}\nPassword: ${state.password}`;
  return (
    <div className="mt-3 rounded-lg border border-line bg-cream p-3 text-sm" role="status">
      <p className="font-medium">Login ready for {state.email}. Copy it now: the password is shown only this once, and the portal has not emailed them.</p>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-white p-3 font-mono text-xs leading-relaxed">{text}</pre>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}
          className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-dark">{copied ? "Copied" : "Copy login details"}</button>
        <span className="text-ink/70">It doesn&rsquo;t expire. They can change the password after signing in.</span>
      </div>
    </div>
  );
}

export function AddLogin({ kind, clients, defaultClient }: { kind: "team" | "client"; clients?: { id: string; name: string }[]; defaultClient?: string }) {
  const [state, action, pending] = useActionState(addLogin, {});
  return (
    <form action={action} className="mt-4 rounded-xl border border-line bg-white p-4">
      <input type="hidden" name="kind" value={kind} />
      <div className={`grid gap-3 ${kind === "client" ? "sm:grid-cols-[1.2fr_1fr_1fr_auto]" : "sm:grid-cols-[1.2fr_1fr_auto]"}`}>
        <label className="text-sm font-medium">Email
          <input name="email" type="email" required autoComplete="off" className={`${input} mt-1 font-normal`} /></label>
        <label className="text-sm font-medium">Name
          <input name="full_name" autoComplete="off" className={`${input} mt-1 font-normal`} /></label>
        {kind === "client" && (
          <label className="text-sm font-medium">Client
            <select name="client_id" required defaultValue={defaultClient ?? ""} className={`${input} mt-1 font-normal`}>
              <option value="" disabled>Choose a client</option>
              {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}
        <button type="submit" disabled={pending} className="self-end rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
          {pending ? "Adding…" : kind === "team" ? "Add team login" : "Add client login"}</button>
      </div>
      {state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
      <DetailsBox state={state} />
    </form>
  );
}

export function LoginRow({ id, email, name, detail, self }: { id: string; email: string; name: string | null; detail?: string; self: boolean }) {
  const [linkState, linkAction, linking] = useActionState(newPassword, {});
  const [rmState, rmAction, removing] = useActionState(removeLogin, {});
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="border-b border-line px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name || email}{self && <span className="ml-2 text-xs font-normal text-ink/50">you</span>}</p>
          <p className="truncate text-sm text-ink/60">{name ? email : ""}{name && detail ? " · " : ""}{detail}</p>
        </div>
        {!self && <form action={linkAction}><input type="hidden" name="id" value={id} />
          <button type="submit" disabled={linking} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-mist disabled:opacity-60">{linking ? "Making…" : "New password"}</button></form>}
        {!self && (confirm ? (
          <form action={rmAction} className="flex items-center gap-2"><input type="hidden" name="id" value={id} />
            <button type="submit" disabled={removing} className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{removing ? "Removing…" : "Remove login"}</button>
            <button type="button" onClick={() => setConfirm(false)} className="text-sm text-ink/60 hover:underline">Keep</button></form>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-red-700 hover:bg-mist">Remove</button>
        ))}
      </div>
      {(linkState.error || rmState.error) && <p role="alert" className="mt-2 text-sm text-red-700">{linkState.error || rmState.error}</p>}
      <DetailsBox state={linkState} />
    </li>
  );
}
