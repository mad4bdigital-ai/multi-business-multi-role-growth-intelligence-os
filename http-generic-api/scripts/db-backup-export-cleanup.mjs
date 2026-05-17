#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const EXPORT_ROOT = process.env.DB_BACKUP_EXPORT_ROOT || "/tmp/growth-os-db-backups";
function parseArgs(argv = process.argv.slice(2)) {
  const args = { max_age_minutes: "60", mode: "dry_run" };
  for (const arg of argv) {
    if (arg === "--apply") args.mode = "apply";
    if (arg === "--dry-run") args.mode = "dry_run";
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  return args;
}
async function statOrNull(p) { try { return await fs.stat(p); } catch { return null; } }
async function main() {
  const args = parseArgs();
  const maxAgeMinutes = Math.max(0, Number(args.max_age_minutes || 60));
  const cutoff = Date.now() - maxAgeMinutes * 60_000;
  const rootStat = await statOrNull(EXPORT_ROOT);
  if (!rootStat) {
    console.log(JSON.stringify({ ok: true, root: EXPORT_ROOT, exists: false, removed: [], mode: args.mode }, null, 2));
    return;
  }
  const entries = await fs.readdir(EXPORT_ROOT, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) continue;
    const full = path.join(EXPORT_ROOT, entry.name);
    const st = await fs.stat(full);
    if (st.mtimeMs <= cutoff) candidates.push({ export_id: entry.name, path: full, modified_at: st.mtime.toISOString() });
  }
  const removed = [];
  if (args.mode === "apply") {
    for (const c of candidates) {
      await fs.rm(c.path, { recursive: true, force: true });
      removed.push(c);
    }
  }
  console.log(JSON.stringify({ ok: true, root: EXPORT_ROOT, mode: args.mode, maxAgeMinutes, candidateCount: candidates.length, candidates, removedCount: removed.length, removed }, null, 2));
}
main().catch((err) => { console.error(JSON.stringify({ ok: false, error: { code: err.code || "db_backup_export_cleanup_failed", message: err.message } }, null, 2)); process.exitCode = 1; });
