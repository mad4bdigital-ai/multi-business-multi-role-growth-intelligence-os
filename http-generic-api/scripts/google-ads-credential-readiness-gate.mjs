#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    tenantId: "",
    userId: "",
    connectionId: "",
    requireValidated: true,
    maxValidationAgeHours: 720,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--user-id")) { args.userId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--connection-id")) { args.connectionId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--max-validation-age-hours")) { args.maxValidationAgeHours = Number(value); if (consume) i += 1; }
    else if (item === "--no-require-validated") args.requireValidated = false;
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function hoursSince(dateValue) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 36e5);
}

async function loadConnection(pool, args) {
  const where = ["app_key = 'google_ads'", "status = 'active'"];
  const params = [];
  if (args.tenantId) { where.push("tenant_id = ?"); params.push(clean(args.tenantId, 64)); }
  if (args.userId) { where.push("user_id = ?"); params.push(clean(args.userId, 64)); }
  if (args.connectionId) { where.push("connection_id = ?"); params.push(clean(args.connectionId, 64)); }
  const [rows] = await pool.query(
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, credential_ref,
            token_expires_at, scopes_granted, account_label, account_metadata,
            validation_status, last_validated_at, connected_at, status
       FROM user_app_connections
      WHERE ${where.join(" AND ")}
      ORDER BY is_primary DESC, last_validated_at DESC, connected_at DESC
      LIMIT 5`,
    params
  );
  return rows;
}

async function loadBindings(pool, connectionId) {
  if (!connectionId) return [];
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, owner_type, owner_id, user_id, connection_id,
            action_key, target_key, credential_role, credential_ref,
            provider_family, connector_family, resolution_priority, status
       FROM credential_bindings
      WHERE connection_id = ?
        AND status = 'active'
      ORDER BY resolution_priority DESC, created_at DESC
      LIMIT 10`,
    [connectionId]
  );
  return rows;
}

function evaluate({ connection, bindings, args }) {
  if (!connection) {
    return {
      ok: true,
      decision: "blocked_google_ads_connection_missing",
      ready_for_execution_credentials: false,
      blocking_gaps: ["google_ads_active_connection_missing"],
      secrets_included: false,
    };
  }
  const gaps = [];
  const validStatuses = new Set(["validated", "valid", "ok", "ready", "active"]);
  if (connection.status !== "active") gaps.push("google_ads_connection_not_active");
  if (!connection.credential_ref) gaps.push("google_ads_connection_credential_ref_missing");
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) gaps.push("google_ads_token_expired");
  const age = hoursSince(connection.last_validated_at);
  const maxAge = Number.isFinite(args.maxValidationAgeHours) ? args.maxValidationAgeHours : 720;
  if (args.requireValidated && !validStatuses.has(String(connection.validation_status || "").toLowerCase())) gaps.push("google_ads_connection_validation_status_not_ready");
  if (args.requireValidated && (age === null || age > maxAge)) gaps.push("google_ads_connection_validation_stale_or_missing");
  if (!bindings.length) gaps.push("google_ads_active_credential_binding_missing");
  const spendBinding = bindings.find((row) => ["googleads_api", "google_ads_budget_change", "google_ads_budget_change_execution"].includes(String(row.action_key || row.target_key || "")) || String(row.credential_role || "").includes("google_ads"));
  if (!spendBinding) gaps.push("google_ads_spend_binding_missing");
  return {
    ok: true,
    decision: gaps.length ? "blocked_google_ads_credential_readiness" : "ready_for_dispatch",
    ready_for_execution_credentials: gaps.length === 0,
    blocking_gaps: gaps,
    connection: {
      connection_id: connection.connection_id,
      tenant_id: connection.tenant_id,
      user_id: connection.user_id,
      app_key: connection.app_key,
      auth_type: connection.auth_type,
      credential_ref_present: Boolean(connection.credential_ref),
      token_expires_at: connection.token_expires_at,
      validation_status: connection.validation_status,
      last_validated_at: connection.last_validated_at,
      validation_age_hours: age === null ? null : Number(age.toFixed(2)),
      status: connection.status,
      secrets_included: false,
    },
    active_binding_count: bindings.length,
    matching_binding_present: Boolean(spendBinding),
    binding_refs: bindings.map((row) => ({
      binding_id: row.binding_id,
      action_key: row.action_key,
      target_key: row.target_key,
      credential_role: row.credential_role,
      credential_ref_present: Boolean(row.credential_ref),
      provider_family: row.provider_family,
      connector_family: row.connector_family,
      status: row.status,
      secrets_included: false,
    })),
    no_credential_payload_read: true,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

export async function runGoogleAdsCredentialReadinessGate(args = parseArgs()) {
  const pool = getPool();
  const rows = await loadConnection(pool, args);
  const connection = rows[0] || null;
  const bindings = await loadBindings(pool, connection?.connection_id);
  return {
    ...evaluate({ connection, bindings, args }),
    request_context: {
      tenant_id: clean(args.tenantId, 64) || null,
      user_id: clean(args.userId, 64) || null,
      connection_id: clean(args.connectionId, 64) || null,
      app_key: "google_ads",
      require_validated: Boolean(args.requireValidated),
      max_validation_age_hours: Number.isFinite(args.maxValidationAgeHours) ? args.maxValidationAgeHours : 720,
    },
    candidate_connection_count: rows.length,
    no_credential_payload_read: true,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdsCredentialReadinessGate(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      if (!result.ready_for_execution_credentials) process.exitCode = 1;
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "google_ads_credential_readiness_failed", message: err.message }, no_credential_payload_read: true, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
