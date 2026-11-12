import { NextResponse } from "next/server";
import { createClient, getProfile } from "@/lib/supabase/server";

export const maxDuration = 60;

type LeadRow = { email: string; first_name?: string; last_name?: string; job_title?: string; company?: string; city?: string; state?: string; country?: string; phone?: string; company_size?: string; attended?: boolean };
type Batch = { client_slug: string; date: string | null; source: string; event?: string; deliverable_id?: string; rows: LeadRow[] };
const SOURCES = ["webinar_live", "webinar_on_demand", "gated_content"];
const EVENT_TYPES = ["webinar", "powersession"];
const CONTENT_TYPES = ["gated_content", "non_gated_content", "sponsored_article", "featured_story", "other"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const days = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);

/** Splits one CSV line set into rows, honouring quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const FIELDS: [keyof LeadRow, string[]][] = [["email", ["registrant email", "email address", "email", "user email"]], ["first_name", ["first name"]], ["last_name", ["last name"]],
  ["job_title", ["job title", "title"]], ["company", ["organization", "company name", "company"]], ["city", ["city"]], ["state", ["state province", "state"]],
  ["country", ["country region", "country"]], ["phone", ["phone number", "phone"]], ["company_size", ["company size"]]];
/** A lead list exported from Zoom, GoToWebinar or Tally: finds the header row and reads the columns it recognises. */
function rowsFromCsv(text: string): LeadRow[] {
  const table = parseCsv(text.replace(/^﻿/, ""));
  const norm = (h: string) => h.toLowerCase().split("_*_")[0].replace(/[^a-z]+/g, " ").trim();
  const hi = table.findIndex((r) => r.some((c) => ["email", "registrant email", "email address"].includes(norm(c))));
  if (hi < 0) return [];
  const heads = table[hi].map(norm);
  const idx = new Map<keyof LeadRow, number>();
  for (const [key, names] of FIELDS) for (const n of names) if (!idx.has(key) && heads.includes(n)) idx.set(key, heads.indexOf(n));
  const ai = heads.findIndex((h) => /^(event attendance|attended|participation|attendance)/.test(h));
  return table.slice(hi + 1).map((r) => {
    const o: LeadRow = { email: (r[idx.get("email")!] ?? "").trim().toLowerCase() };
    for (const [k, i] of idx) if (k !== "email" && r[i]?.trim()) (o as Record<string, unknown>)[k] = r[i].trim().slice(0, 200);
    if (ai >= 0) o.attended = /^(yes|attended|true|y|live)/i.test((r[ai] ?? "").trim());
    return o;
  });
}

/** Add leads: one CSV for a chosen placement, or a prepared file of several lists (the old-report load). Team only.
 *  A lead already on that placement with the same email and "how they came in" is left as it is. */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Team logins only." }, { status: 403 });
  const supabase = await createClient();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const text = await file.text();
  let batches: Batch[];
  if (file.name.toLowerCase().endsWith(".json")) {
    try { batches = (JSON.parse(text).batches ?? []) as Batch[]; } catch { return NextResponse.json({ error: "That file is not valid." }, { status: 400 }); }
  } else {
    const source = String(form.get("source") ?? "");
    const deliverable_id = String(form.get("deliverable_id") ?? "");
    if (!SOURCES.includes(source) || !deliverable_id) return NextResponse.json({ error: "Pick the placement and how these people came in." }, { status: 400 });
    batches = [{ client_slug: String(form.get("client") ?? ""), date: null, source, deliverable_id, rows: rowsFromCsv(text) }];
  }
  const { data: clients } = await supabase.from("clients").select("id, name, slug");
  const results: { client: string; list: string; placement: string | null; inFile: number; added: number; alreadyThere: number; note?: string }[] = [];
  for (const b of batches) {
    const client = (clients ?? []).find((c) => c.slug === b.client_slug);
    const rows = [...new Map((b.rows ?? []).filter((r) => EMAIL.test(r.email ?? "")).map((r) => [r.email.toLowerCase(), r])).values()];
    const list = `${b.event ?? ""} ${b.date ?? ""}`.trim() || file.name;
    if (!client || !SOURCES.includes(b.source)) { results.push({ client: b.client_slug, list, placement: null, inFile: rows.length, added: 0, alreadyThere: 0, note: "No such client" }); continue; }
    const { data: dels } = await supabase.from("deliverables").select("id, deliverable_type, deliverable_label, display_title, start_date").eq("client_id", client.id);
    let target = (dels ?? []).find((d) => d.id === b.deliverable_id);
    if (!target && b.date) {
      const types = b.source === "gated_content" ? CONTENT_TYPES : EVENT_TYPES;
      const window = b.source === "gated_content" ? 45 : 3;
      target = (dels ?? []).filter((d) => types.includes(d.deliverable_type) && d.start_date && days(d.start_date, b.date!) <= window)
        .sort((x, y) => days(x.start_date!, b.date!) - days(y.start_date!, b.date!))[0];
    }
    if (!target) { results.push({ client: client.name, list, placement: null, inFile: rows.length, added: 0, alreadyThere: 0, note: "No placement near that date; nothing added" }); continue; }
    let added = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400).map((r) => ({
        client_id: client.id, deliverable_id: target!.id, source: b.source, origin: file.name.toLowerCase().endsWith(".json") ? "legacy_sheet" : "manual",
        email: r.email.toLowerCase(), first_name: r.first_name ?? null, last_name: r.last_name ?? null, job_title: r.job_title ?? null, company: r.company ?? null,
        city: r.city ?? null, state: r.state ?? null, country: r.country ?? null, phone: r.phone ?? null, company_size: r.company_size ?? null,
        attended: b.source === "webinar_live" ? r.attended ?? null : null,
      }));
      const { data, error } = await supabase.from("leads").upsert(chunk, { onConflict: "client_id,deliverable_id,source,email", ignoreDuplicates: true }).select("id");
      if (error) return NextResponse.json({ error: error.message, results }, { status: 500 });
      added += data?.length ?? 0;
    }
    results.push({ client: client.name, list, placement: `${target.display_title || target.deliverable_label || target.deliverable_type} · ${target.start_date ?? "no date"}`, inFile: rows.length, added, alreadyThere: rows.length - added });
  }
  return NextResponse.json({ results });
}
