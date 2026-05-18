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
async function cfFetch(baseUrl, token, pathAndQuery, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const fetchOptions = { method, headers };
  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${pathAndQuery}`, fetchOptions);
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
async function loadCloudflareRuntime(args) {
  const connectionId = requireArg(args, "connection_id");
  const zoneName = clean(args.zone_name || args.zone || "mad4b.com");
  const conn = await loadConnection(connectionId);
  if (!conn) throw new Error(`Active Cloudflare connection not found: ${connectionId}`);
  const credentials = decryptCredentials(conn.encrypted_credentials) || {};
  const token = credentials.bearer_token || credentials.api_key || credentials.token;
  if (!token) throw new Error("Cloudflare bearer token not found in encrypted credentials.");
  const baseUrl = conn.api_base_url || "https://api.cloudflare.com/client/v4";
  const zones = await cfFetch(baseUrl, token, `/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  const zone = zones.result?.[0];
  if (!zone?.id) throw new Error(`Cloudflare zone not found or not readable: ${zoneName}`);
  return { connectionId, zoneName, conn, token, baseUrl, zone };
}

async function listDnsRecordsForZone(baseUrl, token, zoneId) {
  const dnsRecords = [];
  for (let page = 1; page <= 50; page += 1) {
    const dns = await cfFetch(baseUrl, token, `/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
    dnsRecords.push(...(dns.result || []));
    const info = dns.result_info || {};
    if (!info.total_pages || page >= info.total_pages) break;
  }
  return dnsRecords;
}

async function repairLocalGatewayDns(args) {
  const runtime = await loadCloudflareRuntime(args);
  const recordName = clean(args.record_name || "local.mad4b.com");
  const desiredType = clean(args.desired_type || "A").toUpperCase();
  const desiredContent = clean(args.desired_content || "147.93.49.130");
  const desiredProxied = String(args.proxied ?? "true").toLowerCase() !== "false";
  const apply = String(args.apply || "false").toLowerCase() === "true";
  const dnsRecords = await listDnsRecordsForZone(runtime.baseUrl, runtime.token, runtime.zone.id);
  const existing = dnsRecords.filter((record) => record.name === recordName);
  const alreadyCorrect = existing.length === 1 &&
    existing[0].type === desiredType &&
    existing[0].content === desiredContent &&
    Boolean(existing[0].proxied) === desiredProxied;
  const planned_operations = [];

  if (!alreadyCorrect) {
    for (const record of existing) {
      planned_operations.push({ action: "delete", id: record.id, name: record.name, type: record.type, content: record.content, proxied: record.proxied });
    }
    planned_operations.push({
      action: "create",
      name: recordName,
      type: desiredType,
      content: desiredContent,
      proxied: desiredProxied,
      ttl: 1,
      comment: "local.mad4b.com public Auth/Hostinger gateway - DB routed local tools",
    });
  }

  const applied = [];
  if (apply && !alreadyCorrect) {
    for (const op of planned_operations) {
      if (op.action === "delete") {
        const deleted = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/dns_records/${op.id}`, { method: "DELETE" });
        applied.push({ action: "delete", id: op.id, ok: deleted.success !== false });
      } else if (op.action === "create") {
        const created = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/dns_records`, {
          method: "POST",
          body: {
            name: op.name,
            type: op.type,
            content: op.content,
            proxied: op.proxied,
            ttl: op.ttl,
            comment: op.comment,
          },
        });
        applied.push({ action: "create", id: created.result?.id || null, name: op.name, type: op.type, content: op.content, proxied: op.proxied });
      }
    }
  }

  const afterRecords = apply ? (await listDnsRecordsForZone(runtime.baseUrl, runtime.token, runtime.zone.id)).filter((record) => record.name === recordName) : existing;
  return {
    ok: true,
    action: "repair-local-gateway",
    applied: apply,
    zone: { id: runtime.zone.id, name: runtime.zone.name },
    desired: { name: recordName, type: desiredType, content: desiredContent, proxied: desiredProxied, ttl: 1 },
    already_correct: alreadyCorrect,
    existing: existing.map(redactRecord),
    planned_operations,
    applied_operations: applied,
    after: afterRecords.map(redactRecord),
    secrets_included: false,
  };
}

async function upsertCnameRecord(args) {
  const runtime = await loadCloudflareRuntime(args);
  const recordName = requireArg(args, "record_name");
  const content = requireArg(args, "content");
  const proxied = String(args.proxied ?? "true").toLowerCase() !== "false";
  const ttl = Math.max(1, Number(args.ttl || 1));
  const comment = clean(args.comment || "Managed by Growth Intelligence Platform");
  const apply = String(args.apply || "false").toLowerCase() === "true";
  const dnsRecords = await listDnsRecordsForZone(runtime.baseUrl, runtime.token, runtime.zone.id);
  const existing = dnsRecords.filter((record) => record.name === recordName);
  const alreadyCorrect = existing.length === 1 && existing[0].type === "CNAME" && existing[0].content === content && Boolean(existing[0].proxied) === proxied;
  const planned_operations = [];

  if (!alreadyCorrect) {
    for (const record of existing) {
      planned_operations.push({ action: "delete", id: record.id, name: record.name, type: record.type, content: record.content, proxied: record.proxied });
    }
    planned_operations.push({ action: "create", name: recordName, type: "CNAME", content, proxied, ttl, comment });
  }

  const applied = [];
  if (apply && !alreadyCorrect) {
    for (const op of planned_operations) {
      if (op.action === "delete") {
        const deleted = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/dns_records/${op.id}`, { method: "DELETE" });
        applied.push({ action: "delete", id: op.id, ok: deleted.success !== false });
      } else if (op.action === "create") {
        const created = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/dns_records`, {
          method: "POST",
          body: { name: op.name, type: op.type, content: op.content, proxied: op.proxied, ttl: op.ttl, comment: op.comment },
        });
        applied.push({ action: "create", id: created.result?.id || null, name: op.name, type: op.type, content: op.content, proxied: op.proxied });
      }
    }
  }

  const afterRecords = apply ? (await listDnsRecordsForZone(runtime.baseUrl, runtime.token, runtime.zone.id)).filter((record) => record.name === recordName) : existing;
  return {
    ok: true,
    action: "upsert-cname",
    applied: apply,
    zone: { id: runtime.zone.id, name: runtime.zone.name },
    desired: { name: recordName, type: "CNAME", content, proxied, ttl, comment },
    already_correct: alreadyCorrect,
    existing: existing.map(redactRecord),
    planned_operations,
    applied_operations: applied,
    after: afterRecords.map(redactRecord),
    secrets_included: false,
  };
}

async function repairLocalOriginRule(args) {
  const runtime = await loadCloudflareRuntime(args);
  const host = clean(args.host || "local.mad4b.com");
  const originHost = clean(args.origin_host || "auth.mad4b.com");
  const apply = String(args.apply || "false").toLowerCase() === "true";
  const expression = `(http.host eq \"${host}\")`;
  const ref = "local_gateway_auth_origin_override";
  let entrypoint = null;
  let entrypointError = null;
  try {
    const fetched = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/rulesets/phases/http_request_origin/entrypoint`);
    entrypoint = fetched.result || null;
  } catch (err) {
    if (err.status === 404) entrypointError = { status: 404, message: "entrypoint_not_found" };
    else throw err;
  }

  const existingRules = Array.isArray(entrypoint?.rules) ? entrypoint.rules : [];
  const existingRule = existingRules.find((rule) => rule.ref === ref || rule.description === "local.mad4b.com -> auth.mad4b.com origin host override" || rule.expression === expression);
  const desiredRule = {
    ref,
    ...(existingRule?.id ? { id: existingRule.id } : {}),
    description: "local.mad4b.com -> auth.mad4b.com origin host override",
    expression,
    action: "route",
    action_parameters: { host_header: originHost },
    enabled: true,
  };
  const alreadyCorrect = Boolean(existingRule && existingRule.action === desiredRule.action && existingRule.enabled !== false && existingRule.action_parameters?.host_header === originHost);
  const nextRules = existingRule
    ? existingRules.map((rule) => (rule === existingRule ? { ...rule, ...desiredRule } : rule))
    : [...existingRules, desiredRule];

  const planned = {
    action: entrypoint ? "update_ruleset" : "create_ruleset",
    phase: "http_request_origin",
    host,
    origin_host: originHost,
    existing_rules_count: existingRules.length,
    rule_was_present: Boolean(existingRule),
    already_correct: alreadyCorrect,
  };

  let result = null;
  if (apply && !alreadyCorrect) {
    const body = {
      name: entrypoint?.name || "Local gateway origin overrides",
      kind: "zone",
      phase: "http_request_origin",
      rules: nextRules,
    };
    if (entrypoint?.id) {
      result = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/rulesets/${entrypoint.id}`, { method: "PUT", body });
    } else {
      result = await cfFetch(runtime.baseUrl, runtime.token, `/zones/${runtime.zone.id}/rulesets`, { method: "POST", body });
    }
  }

  return {
    ok: true,
    action: "repair-local-origin-rule",
    applied: apply,
    zone: { id: runtime.zone.id, name: runtime.zone.name },
    entrypoint: entrypoint ? { id: entrypoint.id, name: entrypoint.name, phase: entrypoint.phase, rules_count: existingRules.length } : entrypointError,
    planned,
    desired_rule: desiredRule,
    applied_result: result ? { id: result.result?.id || null, rules_count: Array.isArray(result.result?.rules) ? result.result.rules.length : null } : null,
    secrets_included: false,
  };
}

async function inspectTunnelConfig(args) {
  const runtime = await loadCloudflareRuntime(args);
  const tunnelId = requireArg(args, "tunnel_id");
  const accountId = clean(args.account_id || "dd1024b934e907723484568d97c7c74c");
  const config = await cfFetch(runtime.baseUrl, runtime.token, `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`);
  return {
    ok: true,
    action: "inspect-tunnel-config",
    account_id: accountId,
    tunnel_id: tunnelId,
    config: config.result || config,
    secrets_included: false,
  };
}

async function exportManifest(args) {
  if (args.action !== "export") throw new Error("Only --action=export is supported.");
  const outputDir = clean(args.output_dir || "");
  const { connectionId, zoneName, token, baseUrl, zone } = await loadCloudflareRuntime(args);

  let tokenVerification = { result: { status: "not_checked" }, success: null };
  let tokenVerifyWarning = null;
  try {
    tokenVerification = await cfFetch(baseUrl, token, "/user/tokens/verify");
  } catch (err) {
    tokenVerifyWarning = { status: err.status || null, message: err.message, details: err.details || null };
  }

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
            account_metadata=JSON_SET(COALESCE(account_metadata, JSON_OBJECT()), '$.cloudflare_export', ?)
      WHERE connection_id=?`,
    [JSON.stringify(summary), connectionId]
  );

  return { manifest, summary };
}

async function main() {
  const args = parseArgs();
  try {
    if (args.action === "repair-local-gateway") {
      const result = await repairLocalGatewayDns(args);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (args.action === "repair-local-origin-rule") {
      const result = await repairLocalOriginRule(args);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (args.action === "upsert-cname") {
      const result = await upsertCnameRecord(args);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

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
