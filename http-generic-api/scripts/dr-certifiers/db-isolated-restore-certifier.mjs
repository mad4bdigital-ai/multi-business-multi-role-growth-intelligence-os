#!/usr/bin/env node
/**
 * Source-controlled DB isolated restore certifier.
 * Runs only against a local encrypted backup bundle and an isolated MariaDB Docker container.
 * Never publishes ports, never touches production, and never prints recovery-key material.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { validateIsolatedRestoreInputs, isolatedDockerRunArgs } from "./isolatedRestoreSafety.mjs";

function arg(name, fallback = "") {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (item) return item.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const artifact = arg("artifact");
const manifestPath = arg("manifest");
const keyPath = arg("recovery-key");
const restoreRoot = arg("restore-root", path.join(process.cwd(), "restore-tests", "db-isolated"));
const image = arg("image", "mariadb:11.4");
// The isolated test database must always be explicitly named by the caller.
// No runtime, Staging, or Production schema identity is valid as a fallback.
const database = arg("database");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = path.join(restoreRoot, `isolated-restore-${stamp}`);
fs.mkdirSync(workDir, { recursive: true });
const evidence = { ok: false, mode: "isolated_db_restore_mariadb", started_at: new Date().toISOString(), work_dir: workDir, image, database, secrets_included: false, production_touched: false, ports_published: false, network_isolated: false, full_import_attempted: false, cleanup: {} };
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function parseJson(file) { let text = fs.readFileSync(file, "utf8"); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); return JSON.parse(text); }
function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts });
  if (res.status !== 0) throw new Error(`${command} failed with ${res.status}: ${(res.stderr || res.stdout || "").slice(0, 1200)}`);
  return res.stdout || "";
}
try {
  if (!artifact || !manifestPath || !keyPath) throw new Error("artifact, manifest, and recovery-key arguments are required");
  const manifest = parseJson(manifestPath);
  const keyDoc = parseJson(keyPath);
  const cryptoEnvelope = validateIsolatedRestoreInputs({ manifest, keyDoc, artifactFilename: path.basename(artifact), image, database });
  const encrypted = fs.readFileSync(artifact);
  const encryptedSha = sha256(encrypted);
  evidence.artifact = { exists: true, size_bytes: encrypted.length, checksum_sha256: encryptedSha, checksum_matches: encryptedSha === manifest.checksum_value };
  if (!evidence.artifact.checksum_matches) throw new Error("encrypted artifact checksum mismatch");
  const decipher = crypto.createDecipheriv("aes-256-gcm", cryptoEnvelope.key, cryptoEnvelope.iv);
  decipher.setAuthTag(cryptoEnvelope.tag);
  const gzipBytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  evidence.decryption = { ok: true, gzip_sha256_matches: sha256(gzipBytes) === manifest.gzip_sha256, gzip_size_bytes: gzipBytes.length };
  if (!evidence.decryption.gzip_sha256_matches) throw new Error("gzip checksum mismatch");
  const sqlBytes = zlib.gunzipSync(gzipBytes);
  evidence.plaintext = { sql_sha256_matches: sha256(sqlBytes) === manifest.plaintext_sql_sha256, sql_size_bytes: sqlBytes.length };
  if (!evidence.plaintext.sql_sha256_matches) throw new Error("plaintext sql checksum mismatch");
  evidence.recovery_key = { content_read: true, content_returned: false };
  const sqlPath = path.join(workDir, "restore.sql");
  fs.writeFileSync(sqlPath, sqlBytes);
  const container = `growthos-db-restore-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const password = crypto.randomBytes(18).toString("base64url");
  evidence.container = { name: container, image, ports_published: false };
  run("docker", isolatedDockerRunArgs({ name: container, password, image }));
  try {
    const isolation = run("docker", ["inspect", "-f", "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}", container]).trim();
    if (isolation !== "none|null" && isolation !== "none|{}") throw new Error("restore_container_isolation_not_proven");
    evidence.network_isolated = true;
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      const ping = spawnSync("docker", ["exec", "-e", `MYSQL_PWD=${password}`, container, "mariadb-admin", "ping", "-h127.0.0.1", "--protocol=TCP", "-uroot", "--silent"], { encoding: "utf8", windowsHide: true });
      if (ping.status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
    if (!ready) throw new Error("mariadb container did not become ready");
    evidence.container.ready = true;
    run("docker", ["cp", sqlPath, `${container}:/tmp/restore.sql`]);
    run("docker", ["exec", "-e", `MYSQL_PWD=${password}`, container, "mariadb", "-h127.0.0.1", "--protocol=TCP", "-uroot", "-e", `CREATE DATABASE IF NOT EXISTS \`${database}\`;`]);
    evidence.full_import_attempted = true;
    run("docker", ["exec", "-e", `MYSQL_PWD=${password}`, container, "sh", "-lc", `mariadb -h127.0.0.1 --protocol=TCP -uroot ${database} < /tmp/restore.sql`]);
    const counts = run("docker", ["exec", "-e", `MYSQL_PWD=${password}`, container, "mariadb", "-h127.0.0.1", "--protocol=TCP", "-uroot", "-N", "-B", "-e", `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'; SELECT COALESCE(SUM(table_rows),0) FROM information_schema.tables WHERE table_schema='${database}';`]);
    const nums = counts.trim().split(/\s+/).map(Number);
    evidence.readback = { table_count: nums[0] || 0, approximate_rows: nums[1] || 0, expected_table_count: manifest.table_count, expected_manifest_rows: manifest.row_count };
    evidence.ok = evidence.readback.table_count === Number(manifest.table_count);
  } finally {
    evidence.cleanup.container_removed = spawnSync("docker", ["rm", "-f", container], { encoding: "utf8", windowsHide: true }).status === 0;
    try { fs.rmSync(sqlPath, { force: true }); evidence.cleanup.plaintext_sql_removed = true; } catch { evidence.cleanup.plaintext_sql_removed = false; }
  }
} catch (error) {
  evidence.error = { code: error.code || "isolated_db_restore_failed", message: error.message };
}
// A rejected manifest or a Docker startup failure must never leave a decrypted
// SQL file behind. A failed cleanup invalidates the restore certificate.
try { fs.rmSync(path.join(workDir, "restore.sql"), { force: true }); evidence.cleanup.plaintext_sql_removed = true; }
catch { evidence.cleanup.plaintext_sql_removed = false; }
evidence.ok = evidence.ok && evidence.network_isolated === true && evidence.cleanup.container_removed === true && evidence.cleanup.plaintext_sql_removed === true;
evidence.completed_at = new Date().toISOString();
const evidencePath = path.join(workDir, "isolated-db-restore-evidence.json");
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
evidence.evidence_path = evidencePath;
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.ok ? 0 : 1);
