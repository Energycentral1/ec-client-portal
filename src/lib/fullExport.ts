import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Everything the portal holds that exists nowhere else, table by table. Used by the "Download full backup" button (as the
 *  signed-in admin) and by scripts/backup.ts (weekly, to Drive). No imports from the app, so the script can use it too. */
export const BACKUP_TABLES = ["clients", "campaigns", "deliverables", "metrics", "leads", "proofs", "profiles", "benchmarks", "newsletter_issues"] as const;
type Row = Record<string, unknown>;

export async function readTable(db: SupabaseClient, table: string, filter?: { column: string; value: string }): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select("*").order("id").range(from, from + 999);
    if (filter) q = q.eq(filter.column, filter.value);
    const { data, error } = await q;
    if (error) {
      // A small table with no id column: read it unordered, once.
      const again = await (filter ? db.from(table).select("*").eq(filter.column, filter.value).limit(5000) : db.from(table).select("*").limit(5000));
      if (again.error) throw new Error(`${table}: ${again.error.message}`);
      return (again.data ?? []) as Row[];
    }
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function readAll(db: SupabaseClient): Promise<Record<string, Row[]>> {
  const tables: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = await readTable(db, t);
  return tables;
}

const cell = (v: unknown): string | number | boolean | null => {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 32000 ? s.slice(0, 32000) + "…" : s;   // Excel's limit for one cell
};

/** One sheet per entry, a bold frozen header row, columns sized to their content. */
export async function toWorkbook(sheets: { name: string; rows: Row[]; columns?: string[] }[], note?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  if (note?.length) {
    const ws = wb.addWorksheet("About this file");
    note.forEach((line) => ws.addRow([line]));
    ws.getColumn(1).width = 110; ws.getRow(1).font = { bold: true, size: 14 };
  }
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    const cols = s.columns ?? [...new Set(s.rows.flatMap((r) => Object.keys(r)))];
    if (cols.length === 0) { ws.addRow(["Nothing here yet."]); continue; }
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of s.rows) ws.addRow(cols.map((c) => cell(r[c])));
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(c.length + 2, ...s.rows.slice(0, 200).map((r) => String(cell(r[c]) ?? "").length + 2))); });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
