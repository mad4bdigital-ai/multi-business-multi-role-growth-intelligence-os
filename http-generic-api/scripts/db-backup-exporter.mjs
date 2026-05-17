#!/usr/bin/env node
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, createCipheriv } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { getPool } from "../db.js";

const gzipAsync = promisify(gzip);
const EXPORT_ROOT = process.env.DB_BACKUP_EXPORT_ROOT || "/tmp/growth-os-db-backups";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.AUTH_BASE_URL || "https://auth.mad4b.com").replace(/\/$/, "");

function clean(value = "") { return String(value ?? "").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { action: "create", retention_minutes: "30" };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  return args;
}
function qid(identifier) { return `\`${String(identifier).replace(/`/g, "``")}\``; }
function sqlString(value) { return `'${String(value).replace(/\\/g, "\\\\").replace(/\0/g, "\\0").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\x1a/g, "\\Z").replace(/'/g, "\\'")}'`; }
function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (value instanceof Date) return sqlString(value.toISOString().slice(0, 19).replace("T", " "));
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return sqlString(JSON.stringify(value));
  return sqlString(value);
}
async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}
async function writeLine(stream, line = "") {
  await new Promise((resolve, reject) => stream.write(`${line}\n`, (err) => err ? reject(err) : resolve()));
}
async function dumpDatabase(conn, sqlPath) {
  const stream = createWriteStream(sqlPath, { encoding: "utf8" });
  let tableCount = 0;
  let rowCount = 0;
  const [dbRows] = await conn.query("SELECT DATABASE() AS db");
  const dbName = dbRows?.[0]?.db || "unknown";
  try {
    await writeLine(stream, "-- Growth OS database backup");
    await writeLine(stream, `-- database: ${dbName}`);
    await writeLine(stream, `-- created_at: ${new Date().toISOString()}`);
    await writeLine(stream, "SET FOREIGN_KEY_CHECKS=0;");
    await writeLine(stream, "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';");
    const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
    const tableNameKey = Object.keys(tables?.[0] || {}).find(k => k.toLowerCase().startsWith("tables_in_"));
    for (const row of tables) {
      const table = row[tableNameKey];
      if (!table) continue;
      tableCount += 1;
      await writeLine(stream, "");
      await writeLine(stream, `-- Table ${table}`);
      await writeLine(stream, `DROP TABLE IF EXISTS ${qid(table)};`);
      const [createRows] = await conn.query(`SHOW CREATE TABLE ${qid(table)}`);
      await writeLine(stream, `${createRows[0]["Create Table"]};`);
      const [cols] = await conn.query(`SHOW COLUMNS FROM ${qid(table)}`);
      const colNames = cols.map(c => c.Field);
      const colList = colNames.map(qid).join(", ");
      const batchSize = 1000;
      let offset = 0;
      while (true) {
        const [rows] = await conn.query(`SELECT * FROM ${qid(table)} LIMIT ${batchSize} OFFSET ${offset}`);
        if (!rows.length) break;
        rowCount += rows.length;
        for (const dataRow of rows) {
          const values = colNames.map(col => sqlValue(dataRow[col])).join(", ");
          await writeLine(stream, `INSERT INTO ${qid(table)} (${colList}) VALUES (${values});`);
        }
        offset += rows.length;
      }
    }
    await writeLine(stream, "SET FOREIGN_KEY_CHECKS=1;");
  } finally {
    await new Promise(resolve => stream.end(resolve));
  }
  return { dbName, tableCount, rowCount };
}
async function main() {
  const args = parseArgs();
  if (clean(args.action || "create") !== "create") throw new Error("Only --action=create is supported.");
  await fs.mkdir(EXPORT_ROOT, { recursive: true });
  const exportId = randomBytes(12).toString("hex");
  const dir = path.join(EXPORT_ROOT, exportId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `growth-os-db-primary-${ts}`;
  const sqlPath = path.join(dir, `${base}.sql`);
  const gzPath = path.join(dir, `${base}.sql.gz`);
  const artifactPath = path.join(dir, `${base}.sql.gz.aes256gcm`);
  const manifestPath = path.join(dir, `${base}.manifest.json`);
  const keyPath = path.join(dir, `${base}.recovery-key.json`);

  const conn = await getPool().getConnection();
  let dumpStats;
  try { dumpStats = await dumpDatabase(conn, sqlPath); }
  finally { conn.release(); await getPool().end(); }

  const sqlBuffer = await fs.readFile(sqlPath);
  const gzBuffer = await gzipAsync(sqlBuffer, { level: 9 });
  await fs.writeFile(gzPath, gzBuffer);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(gzBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.writeFile(artifactPath, encrypted);

  const artifactSha = await sha256File(artifactPath);
  const gzSha = await sha256File(gzPath);
  const sqlSha = await sha256File(sqlPath);
  const artifactStat = await fs.stat(artifactPath);
  const manifest = {
    schema: "backup-manifest/v1",
    backup_kind: "database",
    policy_key: "policy:platform-db-primary:manual-draft",
    artifact_format: "sql_dump",
    compression: "gzip",
    encryption_scheme: "aes-256-gcm",
    checksum_algorithm: "sha256",
    checksum_value: artifactSha,
    plaintext_sql_sha256: sqlSha,
    gzip_sha256: gzSha,
    export_id: exportId,
    database_name: dumpStats.dbName,
    table_count: dumpStats.tableCount,
    row_count: dumpStats.rowCount,
    size_bytes: artifactStat.size,
    artifact_filename: path.basename(artifactPath),
    key_filename: path.basename(keyPath),
    created_at: new Date().toISOString(),
    created_by: "db-backup-exporter"
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const keyDoc = {
    schema: "backup-recovery-key/v1",
    export_id: exportId,
    algorithm: "aes-256-gcm",
    key_b64: key.toString("base64"),
    iv_b64: iv.toString("base64"),
    auth_tag_b64: tag.toString("base64"),
    artifact_sha256: artifactSha,
    created_at: new Date().toISOString(),
    warning: "Store separately from the encrypted artifact where possible. Required for restore."
  };
  await fs.writeFile(keyPath, `${JSON.stringify(keyDoc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rm(sqlPath, { force: true });
  await fs.rm(gzPath, { force: true });

  const token = randomBytes(32).toString("base64url");
  const tokenSha = createHash("sha256").update(token).digest("hex");
  const retentionMinutes = Math.max(5, Math.min(Number(args.retention_minutes || 30), 120));
  const expiresAt = new Date(Date.now() + retentionMinutes * 60_000).toISOString();
  const download = { export_id: exportId, token_sha256: tokenSha, expires_at: expiresAt, files: [path.basename(artifactPath), path.basename(manifestPath), path.basename(keyPath)] };
  await fs.writeFile(path.join(dir, "download.json"), `${JSON.stringify(download, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const url = (file) => `${PUBLIC_BASE_URL}/connector-agent/backup-artifacts/export/${exportId}/${encodeURIComponent(file)}?token=${encodeURIComponent(token)}`;
  console.log(JSON.stringify({
    ok: true,
    export_id: exportId,
    expires_at: expiresAt,
    artifact_filename: path.basename(artifactPath),
    manifest_filename: path.basename(manifestPath),
    key_filename: path.basename(keyPath),
    artifact_url: url(path.basename(artifactPath)),
    manifest_url: url(path.basename(manifestPath)),
    key_url: url(path.basename(keyPath)),
    checksum_sha256: artifactSha,
    size_bytes: artifactStat.size,
    table_count: dumpStats.tableCount,
    row_count: dumpStats.rowCount,
    note: "Encrypted DB backup export created on server. Download URLs are temporary."
  }, null, 2));
}
main().catch((err) => { console.error(JSON.stringify({ ok: false, error: { code: err.code || "db_backup_export_failed", message: err.message } }, null, 2)); process.exitCode = 1; });
