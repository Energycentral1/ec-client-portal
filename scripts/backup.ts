/**
 * Weekly backup: every table → a dated Excel workbook and a complete, lossless JSON file, uploaded to a Google Drive folder
 * Energy Central owns. Nothing is overwritten; each run adds two dated files.
 * Run: npm run backup   (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, BACKUP_DRIVE_FOLDER_ID)
 * The folder must be in a shared drive (or shared with the service account's email as Content manager): a service account has
 * no storage of its own. `--dry` builds the files and reports sizes without uploading.
 * The files hold lead contact details, so they go to Drive only, never to the repo or to GitHub artifacts.
 *
 * It also keeps a second folder, "Uploaded files", inside the backup folder (Chloe, Nov 13 2026: "a secondary folder that has
 * everything that gets uploaded"): every creative file the team has uploaded to the portal, in a subfolder per client, copied
 * once and never removed, even if the creative is later deleted in the portal. `--files-only` does just that part (run daily).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import { BACKUP_TABLES, readAll, toWorkbook } from "../src/lib/fullExport";

const DRY = process.argv.includes("--dry");
const FILES_ONLY = process.argv.includes("--files-only");
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", ...(DRY ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON", "BACKUP_DRIVE_FOLDER_ID"])]) {
  if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function upload(token: string, name: string, type: string, body: Buffer, parent = process.env.BACKUP_DRIVE_FOLDER_ID!) {
  const boundary = "ecbackup" + Date.now();
  const meta = JSON.stringify({ name, parents: [parent] });
  const data = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--`)]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: data });
  if (!res.ok) throw new Error(`Drive upload of ${name} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function driveList(token: string, q: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = []; let page = "";
  do {
    const res = await fetch(`${DRIVE}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${page}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { files?: { id: string; name: string }[]; nextPageToken?: string };
    out.push(...(j.files ?? [])); page = j.nextPageToken ?? "";
  } while (page);
  return out;
}
async function folder(token: string, parent: string, name: string): Promise<string> {
  const found = await driveList(token, `'${parent}' in parents and name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  if (found[0]) return found[0].id;
  const res = await fetch(`${DRIVE}?supportsAllDrives=true&fields=id`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [parent], mimeType: "application/vnd.google-apps.folder" }) });
  if (!res.ok) throw new Error(`Could not make the Drive folder "${name}": ${res.status} ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { id: string }).id;
}

/** Copies every file in the portal's "proofs" storage bucket (creative the team uploaded) to Drive, once each. */
async function copyUploads(token: string | null): Promise<number> {
  const { data: clients } = await db.from("clients").select("id, name");
  const nameOf = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const { data: dirs, error } = await db.storage.from("proofs").list("", { limit: 1000 });
  if (error) throw new Error(`Storage: ${error.message}`);
  const root = token ? await folder(token, process.env.BACKUP_DRIVE_FOLDER_ID!, "Uploaded files") : "";
  let copied = 0, total = 0;
  for (const dir of dirs ?? []) {
    const { data: files } = await db.storage.from("proofs").list(dir.name, { limit: 1000 });
    const real = (files ?? []).filter((f) => f.id);   // entries without an id are sub-folders
    if (real.length === 0) continue;
    total += real.length;
    if (!token) continue;
    const dest = await folder(token, root, nameOf.get(dir.name) ?? dir.name);
    const have = new Set((await driveList(token, `'${dest}' in parents and trashed = false`)).map((f) => f.name));
    for (const f of real) {
      if (have.has(f.name)) continue;
      const { data: blob, error: e } = await db.storage.from("proofs").download(`${dir.name}/${f.name}`);
      if (e || !blob) throw new Error(`Could not read ${dir.name}/${f.name}: ${e?.message}`);
      await upload(token, f.name, blob.type || "application/octet-stream", Buffer.from(await blob.arrayBuffer()), dest);
      copied++;
    }
  }
  console.log(token ? `Uploaded files: ${copied} new of ${total} copied to Drive.` : `Uploaded files: ${total} in the portal (dry run, none copied).`);
  return copied;
}

async function driveToken(): Promise<string> {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/drive"] });
  return (await auth.getAccessToken()).token!;
}

async function main() {
  const token = DRY ? null : await driveToken();
  if (FILES_ONLY) { await copyUploads(token); return; }
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
    if (!token) console.log("DRY RUN: nothing uploaded.");
    else {
      const dest = await folder(token, process.env.BACKUP_DRIVE_FOLDER_ID!, "Weekly database copies");
      await upload(token, `ec-client-portal-backup-${day}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx, dest);
      await upload(token, `ec-client-portal-backup-${day}.json.gz`, "application/gzip", json, dest);
      console.log("Saved both files to Weekly database copies.");
    }
    await copyUploads(token);
    if (run) await db.from("sync_runs").update({ status: "success", finished_at: new Date().toISOString(), records_written: rows }).eq("id", run.id);
  } catch (e) {
    if (run) await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: String((e as Error).message ?? e).slice(0, 500) }).eq("id", run.id);
    throw e;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
