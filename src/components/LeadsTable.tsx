"use client";

import { useMemo, useState } from "react";

export type LeadRow = {
  id: string; first_name: string | null; last_name: string | null; email: string; phone: string | null;
  job_title: string | null; company: string | null; company_size: string | null;
  city: string | null; state: string | null; country: string | null;
  /** How the person came in, in client words: "Attended live", "Registered", "Watched on demand"... */
  how: string; event: string; eventDate: string | null; date: string | null; consent: boolean | null;
};

const PAGE = 25;
const CSV_COLS: [string, (l: LeadRow) => string][] = [
  ["First name", (l) => l.first_name ?? ""], ["Last name", (l) => l.last_name ?? ""], ["Email", (l) => l.email],
  ["Phone", (l) => l.phone ?? ""], ["Job title", (l) => l.job_title ?? ""], ["Company", (l) => l.company ?? ""],
  ["Company size", (l) => l.company_size ?? ""], ["City", (l) => l.city ?? ""], ["State", (l) => l.state ?? ""],
  ["Country", (l) => l.country ?? ""], ["How they came in", (l) => l.how], ["Source", (l) => l.event],
  ["Date", (l) => when(l) ?? ""], ["Source date", (l) => l.eventDate ?? ""],
  ["Consent to contact", (l) => (l.consent == null ? "" : l.consent ? "Yes" : "No")],
];
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** The day the person signed up. Older imports don't always have it, so those fall back to the session date. */
const when = (l: LeadRow) => l.date ?? l.eventDate;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Leads with filters and a CSV download. The download always matches what the filters show. */
export function LeadsTable({ leads, fileName }: { leads: LeadRow[]; fileName: string }) {
  const [how, setHow] = useState("All");
  const [event, setEvent] = useState("All");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const hows = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.how, (m.get(l.how) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);
  const events = useMemo(() => [...new Set(leads.map((l) => l.event))], [leads]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return leads.filter((l) => (how === "All" || l.how === how) && (event === "All" || l.event === event)
      && (!s || [l.first_name, l.last_name, l.email, l.company, l.job_title].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => (when(b) ?? "").localeCompare(when(a) ?? ""));
  }, [leads, how, event, q]);
  const reset = () => setShown(PAGE);

  function download() {
    const csv = [CSV_COLS.map(([h]) => h).join(","), ...rows.map((l) => CSV_COLS.map(([, f]) => cell(f(l))).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  const chip = (label: string, n: number) => (
    <button key={label} type="button" aria-pressed={how === label} onClick={() => { setHow(label); reset(); }}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${how === label ? "border-navy bg-navy text-white" : "border-line bg-white text-ink/80 hover:border-navy"}`}>
      {label} <span className={`tabular-nums ${how === label ? "text-white/70" : "text-ink/50"}`}>{n.toLocaleString("en-US")}</span>
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {chip("All", leads.length)}
        {hows.map(([h, n]) => chip(h, n))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search name, company or title" aria-label="Search leads"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm sm:max-w-xs" />
        {events.length > 1 && (
          <select value={event} onChange={(e) => { setEvent(e.target.value); reset(); }} aria-label="Filter by source"
            className="min-w-0 max-w-full rounded-lg border border-line bg-white px-3 py-2 text-sm sm:max-w-sm">
            <option value="All">Every source</option>
            {events.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}
        <button type="button" onClick={download} disabled={rows.length === 0}
          className="ml-auto rounded-lg bg-sun px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-40">
          Download {rows.length.toLocaleString("en-US")} as CSV
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-line text-ink/60">
            <tr>{["Date", "Name", "Role", "Location", "How they came in", "Source"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((l) => (
              <tr key={l.id} className="border-b border-line align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{when(l) ? DATE.format(new Date(when(l) + "T00:00:00Z")) : "—"}</td>
                <td className="px-4 py-3"><span className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(" ") || "No name given"}</span>
                  <a href={`mailto:${l.email}`} className="block break-all text-navy hover:underline">{l.email}</a></td>
                <td className="px-4 py-3">{l.job_title || "—"}<span className="block text-ink/60">{l.company}</span></td>
                <td className="px-4 py-3 text-ink/80">{[l.city, l.state, l.country].filter(Boolean).join(", ") || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${l.how === "Attended live" ? "bg-sun/70" : l.how === "Watched on demand" ? "bg-sky/15 text-navy-dark" : "bg-mist text-ink/70"}`}>{l.how}</span></td>
                <td className="max-w-[260px] px-4 py-3 text-ink/80">{l.event}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/60">No leads match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" onClick={() => setShown(shown + 100)} className="mt-3 rounded-lg border border-line bg-white px-4 py-2 text-sm hover:border-navy">
          Show more ({(rows.length - shown).toLocaleString("en-US")} left)
        </button>
      )}
    </div>
  );
}
