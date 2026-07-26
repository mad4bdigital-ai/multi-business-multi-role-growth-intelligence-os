#!/usr/bin/env node
import { createHash } from "node:crypto";
import { getPool } from "../db.js";
import { decryptCredentials } from "../tokenEncryption.js";

const pool = getPool();
function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  return args;
}
function maskShape(value = "") {
  const s = String(value || "");
  return {
    length: s.length,
    sha256_prefix: createHash("sha256").update(s).digest("hex").slice(0, 12),
    starts_with_bearer: /^Bearer\s+/i.test(s),
    starts_with_json: /^\s*[{[]/.test(s),
    contains_whitespace: /\s/.test(s),
    contains_newline: /[\r\n]/.test(s),
    looks_global_api_key_length: s.length === 37,
    looks_empty: s.length === 0,
  };
}
async function main() {
  const args = parseArgs();
  const connectionId = args.connection_id;
  if (!connectionId) throw new Error("Missing --connection-id");
  const [rows] = await pool.query(
    `SELECT connection_id, app_key, auth_type, status, validation_status, encrypted_credentials, account_metadata, api_base_url
       FROM user_app_connections WHERE connection_id=? LIMIT 1`,
    [connectionId]
  );
  const row = rows?.[0];
  if (!row) throw new Error(`connection not found: ${connectionId}`);
  const creds = decryptCredentials(row.encrypted_credentials) || {};
  const keys = Object.keys(creds).sort();
  const diagnostics = {};
  for (const key of keys) diagnostics[key] = maskShape(creds[key]);
  const selected = creds.bearer_token || creds.api_key || creds.token || creds.N8N_API_KEY || creds.HOSTINGER_API_KEY || "";
  console.log(JSON.stringify({
    ok: true,
    connection_id: row.connection_id,
    app_key: row.app_key,
    auth_type: row.auth_type,
    status: row.status,
    validation_status: row.validation_status,
    api_base_url: row.api_base_url,
    credential_keys: keys,
    credential_diagnostics: diagnostics,
    selected_token_source: creds.bearer_token ? "bearer_token" : creds.api_key ? "api_key" : creds.token ? "token" : null,
    selected_token_diagnostics: maskShape(selected),
    secrets_printed: false
  }, null, 2));
}
main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "credential_diagnostics_failed", message: err.message } }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  try { await pool.end(); } catch {}
});
