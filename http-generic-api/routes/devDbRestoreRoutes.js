import { Router } from "express";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { getPool } from "../db.js";
const MAX_ARTIFACT_BYTES = Number(process.env.DEV_DB_RESTORE_MAX_BYTES || 512 * 1024 * 1024);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function isDevRequest(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const dbName = String(process.env.DB_NAME || "");
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase();
  return host.startsWith("dev.mad4b.com") && dbName.endsWith("_dev") && ["development", "dev", "production"].includes(appEnv || "production");
}

function validateUrl(value, label) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error(`${label} must be https.`);
  if (!url.hostname.endsWith("mad4b.com")) throw new Error(`${label} must be a mad4b.com URL.`);
  return url.toString();
}

async function fetchBuffer(url, label) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${label} download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > MAX_ARTIFACT_BYTES) throw new Error(`${label} is too large.`);
  const array = await res.arrayBuffer();
  const buf = Buffer.from(array);
  if (buf.length > MAX_ARTIFACT_BYTES) throw new Error(`${label} is too large.`);
  return buf;
}

function createHashingTransform(hash) {
  return new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

function createArtifactDecipher(artifact, keyDoc) {
  if (keyDoc.algorithm !== "aes-256-gcm") throw new Error("Unsupported key algorithm.");
  if (!safeEqualHex(sha256(artifact), keyDoc.artifact_sha256)) throw new Error("Encrypted artifact sha256 mismatch.");
  const key = Buffer.from(keyDoc.key_b64, "base64");
  const iv = Buffer.from(keyDoc.iv_b64, "base64");
  const tag = Buffer.from(keyDoc.auth_tag_b64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher;
}

async function materializeVerifiedSqlFile(artifact, keyDoc, manifest, sqlPath) {
  const gzipHash = createHash("sha256");
  const sqlHash = createHash("sha256");
  const decipher = createArtifactDecipher(artifact, keyDoc);

  await pipeline(
    Readable.from([artifact]),
    decipher,
    createHashingTransform(gzipHash),
    createGunzip(),
    createHashingTransform(sqlHash),
    createWriteStream(sqlPath, { mode: 0o600 })
  );

  const gzipSha256 = gzipHash.digest("hex");
  const sqlSha256 = sqlHash.digest("hex");
  if (!safeEqualHex(gzipSha256, manifest.gzip_sha256)) throw new Error("Gzip checksum does not match manifest.");
  if (!safeEqualHex(sqlSha256, manifest.plaintext_sql_sha256)) throw new Error("Plain SQL checksum does not match manifest.");
  return { gzip_sha256: gzipSha256, plaintext_sql_sha256: sqlSha256 };
}

async function consumeSqlLine(conn, state, line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("--")) return;
  state.current += (state.current ? "\n" : "") + line;
  if (trimmed.endsWith(";")) {
    await conn.query(state.current);
    state.current = "";
    state.executed += 1;
  }
}

async function executeSqlStreamStatements(conn, readable) {
  const decoder = new StringDecoder("utf8");
  const state = { current: "", executed: 0 };
  let carry = "";

  for await (const chunk of readable) {
    const text = carry + decoder.write(chunk);
    const lines = text.split(/\r?\n/);
    carry = lines.pop() || "";
    for (const line of lines) {
      await consumeSqlLine(conn, state, line);
    }
  }

  const tail = carry + decoder.end();
  if (tail) {
    for (const line of tail.split(/\r?\n/)) {
      await consumeSqlLine(conn, state, line);
    }
  }
  if (state.current.trim()) {
    await conn.query(state.current);
    state.executed += 1;
  }
  return state.executed;
}

async function getTableCounts(conn) {
  const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
  const tableNameKey = Object.keys(tables?.[0] || {}).find((key) => key.toLowerCase().startsWith("tables_in_"));
  let totalRows = 0;
  for (const row of tables) {
    const table = row[tableNameKey];
    if (!table) continue;
    const [countRows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${String(table).replace(/`/g, "``")}\``);
    totalRows += Number(countRows?.[0]?.c || 0);
  }
  return { table_count: tables.length, row_count: totalRows };
}

export function buildDevDbRestoreRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((req, res) => res.status(500).json({ ok: false, error: { code: "backend_guard_missing" } }));
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((req, res, next) => next());

  router.get("/dev/db/status", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      if (!isDevRequest(req)) return res.status(403).json({ ok: false, error: { code: "dev_db_status_not_allowed" } });
      const conn = await getPool().getConnection();
      try {
        const [[db]] = await conn.query("SELECT DATABASE() AS db_name");
        const counts = await getTableCounts(conn);
        return res.status(200).json({ ok: true, db_name: db.db_name, ...counts, secrets_included: false });
      } finally {
        conn.release();
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: err.code || "dev_db_status_failed", message: err.message } });
    }
  });

  router.post("/dev/db/restore-from-backup", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const startedAt = Date.now();
    let sqlPath = "";
    try {
      if (!isDevRequest(req)) return res.status(403).json({ ok: false, error: { code: "dev_db_restore_not_allowed", message: "Restore is only allowed on dev.mad4b.com with DB_NAME ending in _dev." } });
      const { artifact_url, manifest_url, key_url, confirm } = req.body || {};
      if (confirm !== "RESTORE_DEV_DB") return res.status(400).json({ ok: false, error: { code: "confirmation_required", message: "confirm must be RESTORE_DEV_DB." } });

      const artifactUrl = validateUrl(artifact_url, "artifact_url");
      const manifestUrl = validateUrl(manifest_url, "manifest_url");
      const keyUrl = validateUrl(key_url, "key_url");

      const [artifact, manifestBuffer, keyBuffer] = await Promise.all([
        fetchBuffer(artifactUrl, "artifact"),
        fetchBuffer(manifestUrl, "manifest"),
        fetchBuffer(keyUrl, "key"),
      ]);
      const manifest = JSON.parse(manifestBuffer.toString("utf8"));
      const keyDoc = JSON.parse(keyBuffer.toString("utf8"));

      if (!safeEqualHex(sha256(artifact), manifest.checksum_value)) throw new Error("Artifact checksum does not match manifest.");
      sqlPath = path.join(os.tmpdir(), `growth-os-dev-restore-${randomBytes(12).toString("hex")}.sql`);
      await materializeVerifiedSqlFile(artifact, keyDoc, manifest, sqlPath);

      const conn = await getPool().getConnection();
      let executed = 0;
      let foreignKeyChecksDisabled = false;
      try {
        await conn.query("SET FOREIGN_KEY_CHECKS=0");
        foreignKeyChecksDisabled = true;
        executed = await executeSqlStreamStatements(
          conn,
          createReadStream(sqlPath, {
            highWaterMark: Number(process.env.DEV_DB_RESTORE_SQL_CHUNK_BYTES || 1024 * 1024),
          })
        );
        await conn.query("SET FOREIGN_KEY_CHECKS=1");
        foreignKeyChecksDisabled = false;
        const [[db]] = await conn.query("SELECT DATABASE() AS db_name");
        const counts = await getTableCounts(conn);
        return res.status(200).json({
          ok: true,
          db_name: db.db_name,
          export_id: manifest.export_id,
          source_database_name: manifest.database_name,
          manifest_table_count: manifest.table_count,
          manifest_row_count: manifest.row_count,
          executed_statements: executed,
          ...counts,
          duration_ms: Date.now() - startedAt,
          secrets_included: false,
        });
      } finally {
        if (foreignKeyChecksDisabled) {
          await conn.query("SET FOREIGN_KEY_CHECKS=1").catch(() => {});
        }
        conn.release();
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: err.code || "dev_db_restore_failed", message: err.message }, duration_ms: Date.now() - startedAt });
    } finally {
      if (sqlPath) {
        await fs.rm(sqlPath, { force: true }).catch(() => {});
      }
    }
  });

  return router;
}
