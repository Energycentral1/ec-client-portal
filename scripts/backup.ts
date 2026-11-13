/**
 * Weekly backup: every table → a dated Excel workbook and a complete, lossless JSON file, uploaded to a Google Drive folder
 * Energy Central owns. Nothing is overwritten; each run adds two dated files.
 * Run: npm run backup   (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, BACKUP_DRIVE_FOLDER_ID)
 * The folder must be in a shared drive (or shared with the service account's email as Content manager): a service account has
 * no storage of its own. `--dry` builds the files and reports sizes without uploading.
 * The files hold lead contact details, so they go to Drive only, never to the repo or to GitHub artifacts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import { BACKUP_TABLES, readAll, toWorkbook } from "../src/lib/fullExport";

const DRY = process.argv.includes("--dry");
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", ...(DRY ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON", "BACKUP_DRIVE_FOLDER_ID"])]) {
  if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function upload(token: string, name: string, type: string, body: Buffer) {
  const boundary = "ecbackup" + Date.now();
  const meta = JSON.stringify({ name, parents: [process.env.BACKUP_DRIVE_FOLDER_ID] });
  const data = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--`)]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: data });
  if (!res.ok) throw new Error(`Drive upload of ${name} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  // A dry run is not logged, so the Backups screen only ever reports real copies.
  const run = DRY ? null : (await db.from("sync_runs").insert({ source: "backup" }).select("id").single()).data;
  try {
    const tables = await readAll(db);
    const rows = Object.values(tables).reduce((n, t) => n + t.length, 0);
    const day = new Date().toISOString().slice(0, 10);
    const xlsx = await toWorkbook(BACKUP_TABLES.map((t) => ({ name: t, rows: tables[t] })), [
      `Energy Central Client Portal: weekly backup, ${day}`, "One sheet per table, every row and column as stored.",
      "Contains lead contact details: keep it somewhere only the team can open.", ...BACKUP_TABLES.map((t) => `${t}: ${tables[t].length.toLocaleString("en-US")} rows`)]);
    const json = gzipSync(Buffer.from(JSON.stringify({ taken_at: new Date().toISOString(), tables })));
    console.log(`${rows.toLocaleString("en-US")} rows: ${BACKUP_TABLES.map((t) => `${t} ${tables[t].length}`).join(", ")}`);
    console.log(`Excel ${(xlsx.length / 1e6).toFixed(1)} MB, data file ${(json.length / 1e6).toFixed(1)} MB`);
    if (DRY) console.log("DRY RUN: nothing uploaded.");
    else {
      const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
      const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/drive"] });
      const token = (await auth.getAccessToken()).token!;
      await upload(token, `ec-client-portal-backup-${day}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx);
      await upload(token, `ec-client-portal-backup-${day}.json.gz`, "application/gzip", json);
      console.log("Saved both files to the Drive backup folder.");
    }
    if (run) await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: rows }).eq("id", run.id);
  } catch (e) {
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: String((e as Error).message ?? e).slice(0, 500) }).eq("id", run.id);
    throw e;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
