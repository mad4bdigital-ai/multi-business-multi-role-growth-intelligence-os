import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value = "") {
  return compact(value, 255).toLowerCase();
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function bool(value) {
  if (value === true || value === false) return value;
  return ["true", "1", "yes", "y", "ok", "success"].includes(normalize(value));
}

function boundedTtlDays(value) {
  const parsed = Number(value || 90);
  if (!Number.isFinite(parsed)) return 90;
  return Math.max(1, Math.min(Math.floor(parsed), 365));
}

function addDaysIso(days = 90) {
  const date = new Date(Date.now() + boundedTtlDays(days) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function inferMock(summary = {}) {
  const preview = parseJson(summary.response_preview, {}) || {};
  const urlPath = compact(summary.url_path || "", 500);
  const parts = urlPath.split("/").filter(Boolean);
  const mockProviderIdx = parts.indexOf("mock-providers");
  if (mockProviderIdx >= 0) {
    return {
      mock_provider: compact(preview.provider_key || parts[mockProviderIdx + 1] || "", 128),
      mock_resource: compact(preview.resource_key || parts[mockProviderIdx + 2] || "", 128),
      provider_name: compact(preview.provider || "", 128),
    };
  }
  if (urlPath.includes("/platform/mock-crm/contacts")) {
    return {
      mock_provider: "crm",
      mock_resource: "contacts",
      provider_name: compact(preview.provider || "platform_mock_crm", 128),
    };
  }
  return {
    mock_provider: compact(preview.provider_key || "", 128),
    mock_resource: compact(preview.resource_key || preview.resource || "", 128),
    provider_name: compact(preview.provider || "", 128),
  };
}

function validateSmokeEvidence(logRow = {}) {
  const summary = parseJson(logRow.output_summary, {}) || {};
  const mock = inferMock(summary);
  const blocks = [];
  if (logRow.execution_status !== "success") blocks.push("execution_log_not_success");
  if (summary.provider_smoke !== true) blocks.push("provider_smoke_flag_missing");
  if (summary.dry_run === true) blocks.push("dry_run_cannot_certify_smoke");
  if (summary.method !== "GET") blocks.push("smoke_method_must_be_get");
  if (summary.response_status !== 200) blocks.push("smoke_response_status_not_200");
  if (summary.response_ok !== true) blocks.push("smoke_response_not_ok");
  if (summary.secrets_included !== false) blocks.push("smoke_summary_must_be_secret_free");
  if (!summary.plugin_key) blocks.push("plugin_key_missing");
  if (!summary.action_key) blocks.push("action_key_missing");
  if (!summary.provider_smoke_expected_origin) blocks.push("expected_origin_missing");
  if (!summary.url_origin) blocks.push("url_origin_missing");
  if (summary.provider_smoke_expected_origin && summary.url_origin && summary.provider_smoke_expected_origin !== summary.url_origin) {
    blocks.push("expected_origin_mismatch");
  }
  if (!mock.mock_provider || !mock.mock_resource) blocks.push("mock_provider_resource_missing");
  return { ok: blocks.length === 0, blocks, summary, mock };
}

export async function getPlatformPluginSmokeCertification(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const pluginKey = compact(input.plugin_key || input.pluginKey, 128);
  const actionKey = compact(input.action_key || input.actionKey, 128);
  const mockProvider = compact(input.mock_provider || input.mockProvider || input.provider || "", 128);
  const mockResource = compact(input.mock_resource || input.mockResource || input.resource || "", 128);
  const where = ["1=1"];
  const params = [];
  if (pluginKey) { where.push("plugin_key = ?"); params.push(pluginKey); }
  if (actionKey) { where.push("action_key = ?"); params.push(actionKey); }
  if (mockProvider) { where.push("mock_provider = ?"); params.push(mockProvider); }
  if (mockResource) { where.push("mock_resource = ?"); params.push(mockResource); }
  const [rows] = await pool.query(
    `SELECT certification_id, plugin_key, action_key, endpoint_key, tenant_id, user_id,
            connection_id, mock_provider, mock_resource, expected_origin, url_origin,
            url_path, http_method, last_smoke_status, last_response_status,
            last_response_ok, last_smoke_execution_log_id, last_smoke_trace_id,
            certification_status, certified_at, certification_expires_at,
            last_recertification_required_at, recertification_reason,
            certified_by, notes, metadata_json,
            secrets_included, created_at, updated_at
       FROM platform_plugin_smoke_certifications
      WHERE ${where.join(" AND ")}
      ORDER BY certified_at DESC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(Number(input.limit || 20), 100))]
  );
  return {
    ok: true,
    count: rows.length,
    certifications: rows.map((row) => ({
      ...row,
      metadata_json: parseJson(row.metadata_json, {}),
      secrets_included: false,
    })),
    secrets_included: false,
  };
}

export async function certifyPlatformPluginSmoke(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const executionLogId = Number(input.execution_log_id || input.executionLogId || input.last_smoke_execution_log_id || 0);
  if (!Number.isFinite(executionLogId) || executionLogId <= 0) {
    const err = new Error("execution_log_id is required for smoke certification.");
    err.status = 400;
    err.code = "smoke_execution_log_id_required";
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT id, execution_status, execution_trace_id_writeback, output_summary, created_at
       FROM execution_log
      WHERE id = ?
      LIMIT 1`,
    [executionLogId]
  );
  const logRow = rows[0];
  if (!logRow) {
    const err = new Error("Execution log row was not found.");
    err.status = 404;
    err.code = "smoke_execution_log_not_found";
    throw err;
  }
  const evidence = validateSmokeEvidence(logRow);
  if (!evidence.ok) {
    return {
      ok: false,
      certified: false,
      reason: "smoke_evidence_not_certifiable",
      blocks: evidence.blocks,
      execution_log_id: executionLogId,
      secrets_included: false,
    };
  }
  const s = evidence.summary;
  const certificationId = compact(input.certification_id || input.certificationId || `smoke_cert_${randomUUID()}`, 64);
  const certificationTtlDays = boundedTtlDays(input.certification_ttl_days || input.certificationTtlDays || 90);
  const certificationExpiresAt = addDaysIso(certificationTtlDays);
  const metadata = {
    certification_ttl_days: certificationTtlDays,
    certification_expires_at: certificationExpiresAt,
    provider_name: evidence.mock.provider_name || null,
    template_source: s.template_source || null,
    provider_smoke: true,
    response_ok: true,
    response_status: Number(s.response_status || 0),
    smoke_read_only: true,
    will_mutate: false,
    secrets_included: false,
  };
  await pool.query(
    `INSERT INTO platform_plugin_smoke_certifications (
       certification_id, plugin_key, action_key, endpoint_key, tenant_id, user_id,
       connection_id, mock_provider, mock_resource, expected_origin, url_origin,
       url_path, http_method, last_smoke_status, last_response_status,
       last_response_ok, last_smoke_execution_log_id, last_smoke_trace_id,
       certification_status, certified_by, notes, metadata_json, secrets_included
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
     ON DUPLICATE KEY UPDATE
       endpoint_key = VALUES(endpoint_key),
       tenant_id = VALUES(tenant_id),
       user_id = VALUES(user_id),
       connection_id = VALUES(connection_id),
       expected_origin = VALUES(expected_origin),
       url_origin = VALUES(url_origin),
       url_path = VALUES(url_path),
       http_method = VALUES(http_method),
       last_smoke_status = VALUES(last_smoke_status),
       last_response_status = VALUES(last_response_status),
       last_response_ok = VALUES(last_response_ok),
       last_smoke_execution_log_id = VALUES(last_smoke_execution_log_id),
       last_smoke_trace_id = VALUES(last_smoke_trace_id),
       certification_status = VALUES(certification_status),
       certified_at = CURRENT_TIMESTAMP,
       certified_by = VALUES(certified_by),
       notes = VALUES(notes),
       metadata_json = VALUES(metadata_json),
       secrets_included = 0`,
    [
      certificationId,
      compact(s.plugin_key, 128),
      compact(s.action_key, 128),
      compact(s.endpoint_key || s.action_key || "", 128),
      compact(s.tenant_id || "", 64) || null,
      compact(s.user_id || "", 64) || null,
      compact(s.connection_id || "", 64) || null,
      evidence.mock.mock_provider,
      evidence.mock.mock_resource,
      compact(s.provider_smoke_expected_origin, 300),
      compact(s.url_origin, 300),
      compact(s.url_path, 500),
      "GET",
      "success",
      Number(s.response_status || 0),
      bool(s.response_ok) ? 1 : 0,
      executionLogId,
      compact(logRow.execution_trace_id_writeback || "", 255) || null,
      "certified",
      compact(input.certified_by || input.certifiedBy || input.admin_user_id || input.adminUserId || "", 128) || null,
      compact(input.notes || "", 2000) || null,
      JSON.stringify(metadata),
    ]
  );
  return {
    ok: true,
    certified: true,
    certification: {
      certification_id: certificationId,
      plugin_key: compact(s.plugin_key, 128),
      action_key: compact(s.action_key, 128),
      endpoint_key: compact(s.endpoint_key || s.action_key || "", 128),
      mock_provider: evidence.mock.mock_provider,
      mock_resource: evidence.mock.mock_resource,
      expected_origin: compact(s.provider_smoke_expected_origin, 300),
      url_origin: compact(s.url_origin, 300),
      url_path: compact(s.url_path, 500),
      last_smoke_execution_log_id: executionLogId,
      last_smoke_trace_id: logRow.execution_trace_id_writeback || null,
      last_response_status: Number(s.response_status || 0),
      last_response_ok: true,
      certification_status: "certified",
      secrets_included: false,
    },
    secrets_included: false,
  };
}
