import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const DEFAULT_POLICY = Object.freeze({
  policy_id: "smoke_recert_policy_runtime_default",
  tenant_id: null,
  plugin_key: "*",
  action_key: null,
  mock_provider: null,
  mock_resource: null,
  certification_ttl_days: 90,
  expires_soon_days: 14,
  max_batch_size: 5,
  auto_recertification_enabled: false,
  provider_smoke_required: true,
  allowed_expected_origin: null,
  status: "active",
  priority: 9999,
  source: "runtime_default",
  secrets_included: false,
});

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function nullable(value, max = 255) {
  const result = compact(value, max);
  return result || null;
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function policyAuditSummary(policy = null) {
  if (!policy) return null;
  return {
    policy_id: policy.policy_id || null,
    tenant_id: policy.tenant_id || null,
    plugin_key: policy.plugin_key || "*",
    action_key: policy.action_key || null,
    mock_provider: policy.mock_provider || null,
    mock_resource: policy.mock_resource || null,
    certification_ttl_days: policy.certification_ttl_days,
    expires_soon_days: policy.expires_soon_days,
    max_batch_size: policy.max_batch_size,
    auto_recertification_enabled: policy.auto_recertification_enabled === true,
    provider_smoke_required: policy.provider_smoke_required !== false,
    allowed_expected_origin: policy.allowed_expected_origin || null,
    status: policy.status || null,
    priority: policy.priority,
    notes_present: Boolean(policy.notes),
    secrets_included: false,
  };
}

function changedFields(beforePolicy = null, afterPolicy = null) {
  const before = policyAuditSummary(beforePolicy) || {};
  const after = policyAuditSummary(afterPolicy) || {};
  const fields = [
    "tenant_id", "plugin_key", "action_key", "mock_provider", "mock_resource",
    "certification_ttl_days", "expires_soon_days", "max_batch_size",
    "auto_recertification_enabled", "provider_smoke_required", "allowed_expected_origin",
    "status", "priority", "notes_present",
  ];
  return fields.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

async function getPolicyById(pool, policyId) {
  const [rows] = await pool.query(
    `SELECT policy_id, tenant_id, plugin_key, action_key, mock_provider, mock_resource,
            certification_ttl_days, expires_soon_days, max_batch_size,
            auto_recertification_enabled, provider_smoke_required, allowed_expected_origin,
            status, priority, notes, metadata_json
       FROM platform_plugin_smoke_recertification_policies
      WHERE policy_id = ?
      LIMIT 1`,
    [policyId]
  );
  return rows[0] ? normalizePolicy(rows[0]) : null;
}

async function writePolicyAuditEvidence({ pool, traceId, actor, reason, beforePolicy, afterPolicy, changed, upsertMode }) {
  const evidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "platform_plugin_smoke_recertification_policy_upsert",
    executionClass: "platform_plugin_governance",
    sourceLayer: "platformPluginSmokeRecertificationPolicy",
    userInput: `smoke recertification policy upsert ${afterPolicy?.policy_id || "unknown"}`,
    routeKeys: "platform_plugin_smoke_recertification_policy_upsert",
    selectedWorkflows: "policy_registry_upsert",
    executionMode: "policy_registry_mutation",
    decisionTrigger: "admin_tool",
    executionStatus: "success",
    outputSummary: {
      ok: true,
      upsert_mode: upsertMode,
      actor: actor || null,
      reason: reason || null,
      changed_fields: changed,
      before: policyAuditSummary(beforePolicy),
      after: policyAuditSummary(afterPolicy),
      secrets_included: false,
    },
    recoveryStatus: "not_required",
    routeStatus: "resolved",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: "ready",
    logSource: "sql_primary",
  });
  return evidence.row || null;
}

function normalizePolicy(row = null) {
  if (!row) return { ...DEFAULT_POLICY };
  return {
    policy_id: row.policy_id,
    tenant_id: row.tenant_id || null,
    plugin_key: row.plugin_key || "*",
    action_key: row.action_key || null,
    mock_provider: row.mock_provider || null,
    mock_resource: row.mock_resource || null,
    certification_ttl_days: boundedInt(row.certification_ttl_days, 90, 1, 365),
    expires_soon_days: boundedInt(row.expires_soon_days, 14, 1, 90),
    max_batch_size: boundedInt(row.max_batch_size, 5, 1, 10),
    auto_recertification_enabled: Number(row.auto_recertification_enabled || 0) === 1,
    provider_smoke_required: Number(row.provider_smoke_required ?? 1) === 1,
    allowed_expected_origin: row.allowed_expected_origin || null,
    status: row.status || "active",
    priority: boundedInt(row.priority, 100, 0, 1000000),
    notes: row.notes || null,
    metadata_json: parseJson(row.metadata_json, {}),
    source: "policy_registry",
    secrets_included: false,
  };
}

export async function resolvePlatformPluginSmokeRecertificationPolicy(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const tenantId = nullable(input.tenant_id || input.tenantId, 64);
  const pluginKey = compact(input.plugin_key || input.pluginKey || "*", 128) || "*";
  const actionKey = nullable(input.action_key || input.actionKey, 128);
  const mockProvider = nullable(input.mock_provider || input.mockProvider || input.provider, 128);
  const mockResource = nullable(input.mock_resource || input.mockResource || input.resource, 128);
  const [rows] = await pool.query(
    `SELECT policy_id, tenant_id, plugin_key, action_key, mock_provider, mock_resource,
            certification_ttl_days, expires_soon_days, max_batch_size,
            auto_recertification_enabled, provider_smoke_required, allowed_expected_origin,
            status, priority, notes, metadata_json
       FROM platform_plugin_smoke_recertification_policies
      WHERE status = 'active'
        AND (tenant_id = ? OR tenant_id IS NULL)
        AND (plugin_key = ? OR plugin_key = '*')
        AND (action_key = ? OR action_key IS NULL)
        AND (mock_provider = ? OR mock_provider IS NULL)
        AND (mock_resource = ? OR mock_resource IS NULL)
      ORDER BY (tenant_id = ?) DESC,
               (plugin_key = ?) DESC,
               (action_key = ?) DESC,
               (mock_provider = ?) DESC,
               (mock_resource = ?) DESC,
               priority ASC,
               updated_at DESC
      LIMIT 1`,
    [tenantId, pluginKey, actionKey, mockProvider, mockResource, tenantId, pluginKey, actionKey, mockProvider, mockResource]
  );
  const policy = normalizePolicy(rows[0] || null);
  return {
    ok: true,
    policy,
    resolved_from_registry: Boolean(rows[0]),
    match_context: {
      tenant_id: tenantId,
      plugin_key: pluginKey,
      action_key: actionKey,
      mock_provider: mockProvider,
      mock_resource: mockResource,
    },
    secrets_included: false,
  };
}

export async function listPlatformPluginSmokeRecertificationPolicies(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = ["1=1"];
  const params = [];
  for (const [field, max] of [["tenant_id", 64], ["plugin_key", 128], ["action_key", 128], ["mock_provider", 128], ["mock_resource", 128], ["status", 64]]) {
    const value = nullable(input[field] || input[field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())], max);
    if (value) { where.push(`${field} = ?`); params.push(value); }
  }
  const limit = boundedInt(input.limit, 50, 1, 200);
  const [rows] = await pool.query(
    `SELECT policy_id, tenant_id, plugin_key, action_key, mock_provider, mock_resource,
            certification_ttl_days, expires_soon_days, max_batch_size,
            auto_recertification_enabled, provider_smoke_required, allowed_expected_origin,
            status, priority, notes, metadata_json, created_at, updated_at
       FROM platform_plugin_smoke_recertification_policies
      WHERE ${where.join(" AND ")}
      ORDER BY status ASC, priority ASC, plugin_key ASC, action_key ASC
      LIMIT ?`,
    [...params, limit]
  );
  return {
    ok: true,
    count: rows.length,
    policies: rows.map(normalizePolicy),
    secrets_included: false,
  };
}

export async function upsertPlatformPluginSmokeRecertificationPolicy(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const policyId = compact(input.policy_id || input.policyId || `smoke_recert_policy_${randomUUID()}`, 64);
  const tenantId = nullable(input.tenant_id || input.tenantId, 64);
  const pluginKey = compact(input.plugin_key || input.pluginKey || "*", 128) || "*";
  const actionKey = nullable(input.action_key || input.actionKey, 128);
  const mockProvider = nullable(input.mock_provider || input.mockProvider || input.provider, 128);
  const mockResource = nullable(input.mock_resource || input.mockResource || input.resource, 128);
  const certificationTtlDays = boundedInt(input.certification_ttl_days || input.certificationTtlDays, 90, 1, 365);
  const expiresSoonDays = boundedInt(input.expires_soon_days || input.expiresSoonDays, 14, 1, 90);
  const maxBatchSize = boundedInt(input.max_batch_size || input.maxBatchSize, 5, 1, 10);
  const autoEnabled = input.auto_recertification_enabled === true || input.autoRecertificationEnabled === true ? 1 : 0;
  const providerSmokeRequired = input.provider_smoke_required === false || input.providerSmokeRequired === false ? 0 : 1;
  const allowedExpectedOrigin = nullable(input.allowed_expected_origin || input.allowedExpectedOrigin, 300);
  const status = compact(input.status || "active", 64) || "active";
  const priority = boundedInt(input.priority, 100, 0, 1000000);
  const notes = nullable(input.notes, 2000);
  const metadata = JSON.stringify({ ...(input.metadata || {}), secrets_included: false });
  const actor = nullable(input.actor || input.actor_id || input.actorId || input.admin_user_id || input.adminUserId || input.updated_by || input.updatedBy, 128);
  const reason = nullable(input.reason || input.change_reason || input.changeReason || input.notes, 2000);
  const traceId = compact(input.trace_id || input.traceId || `smoke_recert_policy_upsert_${randomUUID()}`, 255);
  const beforePolicy = await getPolicyById(pool, policyId);
  await pool.query(
    `INSERT INTO platform_plugin_smoke_recertification_policies (
       policy_id, tenant_id, plugin_key, action_key, mock_provider, mock_resource,
       certification_ttl_days, expires_soon_days, max_batch_size,
       auto_recertification_enabled, provider_smoke_required, allowed_expected_origin,
       status, priority, notes, metadata_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       certification_ttl_days = VALUES(certification_ttl_days),
       expires_soon_days = VALUES(expires_soon_days),
       max_batch_size = VALUES(max_batch_size),
       auto_recertification_enabled = VALUES(auto_recertification_enabled),
       provider_smoke_required = VALUES(provider_smoke_required),
       allowed_expected_origin = VALUES(allowed_expected_origin),
       status = VALUES(status),
       priority = VALUES(priority),
       notes = VALUES(notes),
       metadata_json = VALUES(metadata_json)`,
    [policyId, tenantId, pluginKey, actionKey, mockProvider, mockResource,
      certificationTtlDays, expiresSoonDays, maxBatchSize,
      autoEnabled, providerSmokeRequired, allowedExpectedOrigin,
      status, priority, notes, metadata]
  );
  return resolvePlatformPluginSmokeRecertificationPolicy({ tenant_id: tenantId, plugin_key: pluginKey, action_key: actionKey, mock_provider: mockProvider, mock_resource: mockResource }, { pool });
}
