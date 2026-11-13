import { createClient, getProfile } from "@/lib/supabase/server";
import { BACKUP_TABLES, readAll, toWorkbook } from "@/lib/fullExport";

export const maxDuration = 60;

/** The whole database as one Excel workbook, a sheet per table. Team only; it runs as the signed-in admin. */
export async function GET() {
  const profile = await getProfile();
  if (profile?.role !== "admin") return new Response("Team only", { status: 403 });
  const tables = await readAll(await createClient());
  const day = new Date().toISOString().slice(0, 10);
  const file = await toWorkbook(BACKUP_TABLES.map((t) => ({ name: t, rows: tables[t] })), [
    `Energy Central Client Portal: full backup, ${day}`,
    `Downloaded by ${profile.email}. One sheet per table, every row and column as stored.`,
    "Contains lead contact details: keep it somewhere only the team can open.",
    ...BACKUP_TABLES.map((t) => `${t}: ${tables[t].length.toLocaleString("en-US")} rows`),
  ]);
  return new Response(new Uint8Array(file), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="ec-client-portal-backup-${day}.xlsx"`, "Cache-Control": "no-store" } });
}
