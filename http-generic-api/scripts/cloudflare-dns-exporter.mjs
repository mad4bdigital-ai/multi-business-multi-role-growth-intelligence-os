#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getPool } from "../db.js";
import { decryptCredentials } from "../tokenEncryption.js";

const pool = getPool();

function clean(value = "") { return String(value ?? "").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { action: "export", zone_name: "mad4b.com", output_dir: "", summary_only: "false" };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  return args;
}
function requireArg(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required --${key.replace(/_/g, "-")}`);
  return value;
}
async function cfFetch(baseUrl, token, pathAndQuery) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = new Error(data?.errors?.[0]?.message || `Cloudflare request failed: ${res.status}`);
    err.status = res.status;
    err.details = data?.errors || data;
    throw err;
  }
  return data;
}
async function loadConnection(connectionId) {
  const [rows] = await pool.query(
    `SELECT connection_id, user_id, tenant_id, app_key, display_label, auth_type,
            encrypted_credentials, api_base_url, account_metadata
       FROM user_app_connections
      WHERE connection_id=? AND app_key='cloudflare' AND status='active'
      LIMIT 1`,
    [connectionId]
  );
  return rows?.[0] || null;
}
function redactRecord(record) {
  return {
    id: record.id,
    zone_id: record.zone_id,
    zone_name: record.zone_name,
    name: record.name,
    type: record.type,
    content: record.type === "TXT" ? "<redacted-txt>" : record.content,
    proxied: record.proxied,
    ttl: record.ttl,
    comment: record.comment || null,
    tags: record.tags || [],
    created_on: record.created_on,
    modified_on: record.modified_on,
  };
}
function expected(records, name) {
  return records.filter((r) => r.name === name).map(redactRecord);
}
async function exportManifest(args) {
  if (args.action !== "export") throw new Error("Only --action=export is supported.");
  const connectionId = requireArg(args, "connection_id");
  const zoneName = clean(args.zone_name || "mad4b.com");
  const outputDir = clean(args.output_dir || "");
  const conn = await loadConnection(connectionId);
  if (!conn) throw new Error(`Active Cloudflare connection not found: ${connectionId}`);
  const credentials = decryptCredentials(conn.encrypted_credentials) || {};
  const token = credentials.bearer_token || credentials.api_key || credentials.token;
  if (!token) throw new Error("Cloudflare bearer token not found in encrypted credentials.");
  const baseUrl = conn.api_base_url || "https://api.cloudflare.com/client/v4";

  let tokenVerification = { result: { status: "not_checked" }, success: null };
  let tokenVerifyWarning = null;
  try {
    tokenVerification = await cfFetch(baseUrl, token, "/user/tokens/verify");
  } catch (err) {
    // Account API tokens may not validate against the user token verify endpoint.
    // Do not fail here; the effective permission check is the zone/DNS read below.
    tokenVerifyWarning = { status: err.status || null, message: err.message, details: err.details || null };
  }
  const zones = await cfFetch(baseUrl, token, `/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  const zone = zones.result?.[0];
  if (!zone?.id) throw new Error(`Cloudflare zone not found or not readable: ${zoneName}`);

  const dnsRecords = [];
  for (let page = 1; page <= 50; page += 1) {
    const dns = await cfFetch(baseUrl, token, `/zones/${zone.id}/dns_records?per_page=100&page=${page}`);
    dnsRecords.push(...(dns.result || []));
    const info = dns.result_info || {};
    if (!info.total_pages || page >= info.total_pages) break;
  }

  let accounts = [];
  let tunnels = [];
  try {
    const accountResp = await cfFetch(baseUrl, token, "/accounts?per_page=50");
    accounts = accountResp.result || [];
    for (const account of accounts) {
      try {
        const tunnelResp = await cfFetch(baseUrl, token, `/accounts/${account.id}/cfd_tunnel?per_page=100`);
        tunnels.push(...(tunnelResp.result || []).map((item) => ({
          id: item.id,
          name: item.name,
          account_id: account.id,
          account_name: account.name,
          status: item.status,
          created_at: item.created_at,
          deleted_at: item.deleted_at || null,
          connections_count: Array.isArray(item.connections) ? item.connections.length : null,
        })));
      } catch (err) {
        tunnels.push({ account_id: account.id, account_name: account.name, export_status: "blocked", error: err.message });
      }
    }
  } catch (err) {
    accounts = [{ export_status: "blocked", error: err.message }];
  }

  const redactedRecords = dnsRecords.map(redactRecord).sort((a, b) => `${a.name}:${a.type}`.localeCompare(`${b.name}:${b.type}`));
  const manifest = {
    schema: "cloudflare-dns-manifest/v1",
    status: "succeeded",
    exported_at: new Date().toISOString(),
    connection_id: connectionId,
    zone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      paused: zone.paused,
      type: zone.type,
      development_mode: zone.development_mode,
      name_servers: zone.name_servers || [],
      original_name_servers: zone.original_name_servers || [],
    },
    token_validation: {
      status: tokenVerification.result?.status || "effective_zone_read",
      id: tokenVerification.result?.id || null,
      user_verify_warning: tokenVerifyWarning,
    },
    dns_record_count: redactedRecords.length,
    dns_records: redactedRecords,
    expected_records: {
      auth_mad4b_com: expected(dnsRecords, "auth.mad4b.com"),
      connector_mad4b_com: expected(dnsRecords, "connector.mad4b.com"),
      n8n_mad4b_com: expected(dnsRecords, "n8n.mad4b.com"),
    },
    accounts: accounts.map((a) => ({ id: a.id || null, name: a.name || null, export_status: a.export_status || "read" })),
    tunnels,
    secrets_included: false,
    txt_content_redacted: true,
  };

  let outputPath = null;
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    outputPath = path.join(outputDir, `cloudflare-dns-manifest-${new Date().toISOString().slice(0, 10)}.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    manifest.output_path = outputPath;
  }

  const summary = {
    zone_name: zone.name,
    zone_id: zone.id,
    dns_record_count: redactedRecords.length,
    tunnel_count: tunnels.length,
    auth_records: manifest.expected_records.auth_mad4b_com.length,
    connector_records: manifest.expected_records.connector_mad4b_com.length,
    n8n_records: manifest.expected_records.n8n_mad4b_com.length,
    output_path: outputPath,
    exported_at: manifest.exported_at,
  };

  await pool.query(
    `UPDATE user_app_connections
        SET validation_status='validated', last_validated_at=NOW(),
            account_metadata=JSON_SET(COALESCE(account_metadata, JSON_OBJECT()), '$.cloudflare_export', JSON_EXTRACT(?, '

  return { manifest, summary };
}

async function main() {
  const args = parseArgs();
  try {
    const { manifest, summary } = await exportManifest(args);
    const payload = String(args.summary_only).toLowerCase() === "true"
      ? { ok: true, summary }
      : { ok: true, summary, manifest };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(async (err) => {
  try { await pool.end(); } catch {}
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "cloudflare_dns_export_failed", message: err.message, status: err.status || null, details: err.details || null } }, null, 2));
  process.exitCode = 1;
});
))
      WHERE connection_id=?`,
    [JSON.stringify(summary), connectionId]
  );

  return { manifest, summary };
}

async function main() {
  const args = parseArgs();
  try {
    const { manifest, summary } = await exportManifest(args);
    const payload = String(args.summary_only).toLowerCase() === "true"
      ? { ok: true, summary }
      : { ok: true, summary, manifest };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(async (err) => {
  try { await pool.end(); } catch {}
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "cloudflare_dns_export_failed", message: err.message, status: err.status || null, details: err.details || null } }, null, 2));
  process.exitCode = 1;
});
