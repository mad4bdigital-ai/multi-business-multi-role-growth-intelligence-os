import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const VALID_AUTH_TYPES = new Set(["oauth2", "api_key", "webhook", "mcp", "basic_auth", "bearer_token"]);
const VALID_CREDENTIAL_SOURCES = new Set(["user_connection", "tenant_connection", "platform_managed", "target_resolved", "none", "mixed"]);
const VALID_BINDING_ROLES = new Set(["primary_api", "secondary_api", "mcp_api", "oauth_provider", "webhook", "transport", "resolver", "native_controller", "canary", "unknown"]);
const VALID_EXPOSURE_DEFAULTS = new Set(["not_exported", "curated_exports", "manual_tools", "runtime_only"]);
const PROMOTABLE_STATUSES = new Set(["submitted", "certified"]);

function compactString(value = "", max = 1000) { return String(value || "").trim().slice(0, max); }
function normalizeKey(value = "") { return compactString(value, 256).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_"); }
function parseStoredJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
function isoNow() { return new Date().toISOString(); }
function sqlDate(iso) { return String(iso || isoNow()).slice(0, 10); }

async function safeQuery(pool, sql, params = []) {
  try { const [rows] = await pool.query(sql, params); return rows || []; }
  catch (err) { if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return []; throw err; }
}

function toSafeContribution(row = {}) {
  return {
    contribution_id: row.contribution_id,
    plugin_key: row.plugin_key,
    display_name: row.display_name,
    plugin_type: row.plugin_type,
    owner_scope: row.owner_scope,
    owner_tenant_id: row.owner_tenant_id || null,
    owner_user_id: row.owner_user_id || null,
    target: row.target,
    base_plugin_key: row.base_plugin_key || null,
    status: row.status,
    certification_status: row.certification_status || "not_started",
    private_execution_enabled: Boolean(row.private_execution_enabled),
    private_activated_at: row.private_activated_at || null,
    manifest_json: parseStoredJson(row.manifest_json, {}),
    protocol_bindings_json: parseStoredJson(row.protocol_bindings_json, []),
    action_bindings_json: parseStoredJson(row.action_bindings_json, []),
    credential_policy_json: parseStoredJson(row.credential_policy_json, {}),
    validation_report_json: parseStoredJson(row.validation_report_json, {}),
    notes: row.notes || "",
    secrets_included: false,
  };
}

async function writeExecutionLog({ pool, traceId, entryType, status, payload }) {
  const now = isoNow();
  await pool.query(
    `INSERT INTO execution_log
       (run_date, start_time, end_time, entry_type, execution_class, source_layer,
        user_input, route_keys, selected_workflows, execution_mode, decision_trigger,
        execution_status, output_summary, recovery_status, route_status, route_source,
        intake_validation_status, execution_ready_status, execution_trace_id_writeback,
        log_source_writeback, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [sqlDate(now), now, now, entryType, "platform_plugin_promotion", "platformPluginPromotion",
      payload?.plugin_key ? `platform plugin promotion ${payload.plugin_key}` : "platform plugin promotion",
      entryType, "platform_plugin_certification_promotion", payload?.execution_mode || "promotion_preview",
      "admin_tool", status, JSON.stringify({ ...payload, secrets_included: false }), "not_required", "resolved",
      "sql_primary", "validated", status === "success" ? "ready" : "degraded", traceId, "sql_primary"]
  );
  const rows = await safeQuery(pool, `SELECT id, execution_status, execution_trace_id_writeback FROM execution_log WHERE execution_trace_id_writeback = ? ORDER BY id DESC LIMIT 1`, [traceId]);
  return rows[0] || null;
}

async function loadContribution(pool, contributionId) {
  const rows = await safeQuery(pool, `SELECT * FROM platform_plugin_contributions WHERE contribution_id = ? LIMIT 1`, [contributionId]);
  return rows[0] ? toSafeContribution(rows[0]) : null;
}

function inferAuthType(contribution) {
  const protocols = contribution.protocol_bindings_json || [];
  const policy = contribution.credential_policy_json || {};
  const explicit = normalizeKey(policy.auth_type || policy.authType || "");
  if (VALID_AUTH_TYPES.has(explicit)) return explicit;
  if (protocols.some((binding) => normalizeKey(binding.protocol) === "mcp")) return "mcp";
  if (protocols.some((binding) => normalizeKey(binding.protocol) === "webhook")) return "webhook";
  return "api_key";
}

function validateContributionForCertification(contribution) {
  const errors = [];
  const warnings = [];
  const protocols = contribution.protocol_bindings_json || [];
  const actions = contribution.action_bindings_json || [];
  const policy = contribution.credential_policy_json || {};
  if (!contribution.plugin_key) errors.push("missing_plugin_key");
  if (!contribution.display_name) errors.push("missing_display_name");
  if (!protocols.length) errors.push("missing_protocol_bindings");
  if (!actions.length) errors.push("missing_action_bindings");
  const authType = inferAuthType(contribution);
  if (!VALID_AUTH_TYPES.has(authType)) errors.push("invalid_auth_type");
  if (["tenant_private", "user_private"].includes(contribution.target)) warnings.push("private_target_promotes_to_platform_base_only_when_admin_confirms");
  for (const action of actions) {
    if (!action.action_key) errors.push("action_missing_action_key");
    const method = String(action.method || action.http_method || "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) errors.push(`action_method_not_allowed:${action.action_key || "unknown"}`);
    const credentialSource = normalizeKey(action.credential_source || policy.default_credential_source || "tenant_connection");
    if (!VALID_CREDENTIAL_SOURCES.has(credentialSource)) errors.push(`invalid_credential_source:${action.action_key || "unknown"}`);
  }
  return { ok: errors.length === 0, errors, warnings, auth_type: authType, checked_at: isoNow(), secrets_included: false };
}

export async function certifyPlatformPluginContribution({ pool = getPool(), contributionId, adminUserId = null, notes = "" } = {}) {
  const id = compactString(contributionId, 64);
  if (!id) { const err = new Error("contribution_id is required."); err.code = "missing_contribution_id"; err.status = 400; throw err; }
  const contribution = await loadContribution(pool, id);
  if (!contribution) { const err = new Error("Platform Plugin contribution not found."); err.code = "contribution_not_found"; err.status = 404; throw err; }
  const base = await safeQuery(pool, `SELECT app_key FROM app_integrations WHERE app_key = ? LIMIT 1`, [contribution.plugin_key]);
  const report = validateContributionForCertification(contribution);
  if (base[0]) { report.ok = false; report.errors.push("plugin_key_already_exists_in_platform_base"); }
  const nextStatus = report.ok ? "certified" : "validation_failed";
  const validationReport = { ...(contribution.validation_report_json || {}), certification: report };
  await pool.query(
    `UPDATE platform_plugin_contributions
        SET certification_status = ?, status = ?, validation_report_json = ?,
            notes = CASE WHEN ? = '' THEN notes ELSE CONCAT(COALESCE(notes,''), '\n', ?) END,
            updated_by = COALESCE(?, updated_by)
      WHERE contribution_id = ?`,
    [nextStatus, nextStatus, JSON.stringify(validationReport), compactString(notes, 1000), compactString(notes, 1000), adminUserId || null, id]
  );
  const log = await writeExecutionLog({ pool, traceId: `platform_plugin_certify_${id}_${randomUUID()}`, entryType: "platform_plugin_contribution_certify", status: report.ok ? "success" : "failed", payload: { contribution_id: id, plugin_key: contribution.plugin_key, certification_status: nextStatus, errors: report.errors, warnings: report.warnings, execution_mode: "certification_preview" } });
  return { ok: report.ok, contribution: await loadContribution(pool, id), certification: report, execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false }, promoted: false, platform_base_mutated: false, secrets_included: false };
}

function normalizeActionBinding(contribution, action) {
  const policy = contribution.credential_policy_json || {};
  const role = normalizeKey(action.binding_role || "primary_api");
  const credentialSource = normalizeKey(action.credential_source || policy.default_credential_source || "tenant_connection");
  const exposure = normalizeKey(action.exposure_default || "runtime_only");
  return {
    binding_id: `bind_${randomUUID()}`,
    app_key: contribution.plugin_key,
    action_key: compactString(action.action_key, 128),
    binding_role: VALID_BINDING_ROLES.has(role) ? role : "primary_api",
    credential_source: VALID_CREDENTIAL_SOURCES.has(credentialSource) ? credentialSource : "tenant_connection",
    exposure_default: VALID_EXPOSURE_DEFAULTS.has(exposure) ? exposure : "runtime_only",
    status: "active",
    notes: compactString(action.notes || `Promoted from contribution ${contribution.contribution_id}`, 1000),
  };
}

export async function promotePlatformPluginContribution({ pool = getPool(), contributionId, adminUserId = null, status = "beta", notes = "" } = {}) {
  const id = compactString(contributionId, 64);
  if (!id) { const err = new Error("contribution_id is required."); err.code = "missing_contribution_id"; err.status = 400; throw err; }
  const contribution = await loadContribution(pool, id);
  if (!contribution) { const err = new Error("Platform Plugin contribution not found."); err.code = "contribution_not_found"; err.status = 404; throw err; }
  if (!PROMOTABLE_STATUSES.has(contribution.status) || contribution.certification_status !== "certified") { const err = new Error("Contribution must be certified before promotion."); err.code = "contribution_not_certified"; err.status = 409; throw err; }
  const existing = await safeQuery(pool, `SELECT app_key FROM app_integrations WHERE app_key = ? LIMIT 1`, [contribution.plugin_key]);
  if (existing[0]) { const err = new Error("Platform Base already contains this plugin_key."); err.code = "platform_base_conflict"; err.status = 409; throw err; }
  const report = validateContributionForCertification(contribution);
  if (!report.ok) { const err = new Error("Contribution no longer passes certification checks."); err.code = "certification_recheck_failed"; err.status = 409; err.details = report; throw err; }
  const manifest = contribution.manifest_json || {};
  const actions = contribution.action_bindings_json || [];
  const baseStatus = status === "active" ? "active" : "beta";
  const defaultActionGrants = actions.map((action) => ({ action_key: action.action_key, auto_approve: false, source: "promoted_contribution" }));
  await pool.query(
    `INSERT INTO app_integrations
       (app_key, display_name, description, auth_type, oauth_scopes_default, mcp_server_info, docs_url, category, default_action_grants, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [contribution.plugin_key, compactString(contribution.display_name, 128), compactString(manifest.description || `Promoted from contribution ${id}`, 4000), report.auth_type, JSON.stringify((contribution.credential_policy_json || {}).oauth_scopes || []), report.auth_type === "mcp" ? JSON.stringify(contribution.protocol_bindings_json || []) : null, compactString(manifest.docs_url || manifest.docsUrl || "", 512) || null, compactString(contribution.plugin_type || "contribution", 64), JSON.stringify(defaultActionGrants), baseStatus]
  );
  for (const action of actions) {
    if (!action.action_key) continue;
    const binding = normalizeActionBinding(contribution, action);
    await pool.query(
      `INSERT INTO app_integration_action_bindings
         (binding_id, app_key, action_key, binding_role, credential_source, exposure_default, status, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [binding.binding_id, binding.app_key, binding.action_key, binding.binding_role, binding.credential_source, binding.exposure_default, binding.status, binding.notes]
    );
  }
  const promotion = { promoted: true, promoted_at: isoNow(), app_key: contribution.plugin_key, status: baseStatus, action_bindings_created: actions.filter((action) => action.action_key).length, secrets_included: false };
  await pool.query(
    `UPDATE platform_plugin_contributions
        SET validation_report_json = ?, notes = CASE WHEN ? = '' THEN notes ELSE CONCAT(COALESCE(notes,''), '\n', ?) END,
            updated_by = COALESCE(?, updated_by)
      WHERE contribution_id = ?`,
    [JSON.stringify({ ...(contribution.validation_report_json || {}), promotion }), compactString(notes, 1000), compactString(notes, 1000), adminUserId || null, id]
  );
  const app = await safeQuery(pool, `SELECT app_key, display_name, auth_type, category, status FROM app_integrations WHERE app_key = ? LIMIT 1`, [contribution.plugin_key]);
  const bindings = await safeQuery(pool, `SELECT action_key, binding_role, credential_source, exposure_default, status FROM app_integration_action_bindings WHERE app_key = ? ORDER BY action_key ASC`, [contribution.plugin_key]);
  const log = await writeExecutionLog({ pool, traceId: `platform_plugin_promote_${id}_${randomUUID()}`, entryType: "platform_plugin_contribution_promote", status: app[0] ? "success" : "failed", payload: { contribution_id: id, plugin_key: contribution.plugin_key, platform_base_mutated: Boolean(app[0]), action_bindings_created: bindings.length, execution_mode: "admin_platform_base_promotion" } });
  return { ok: Boolean(app[0]), promoted: Boolean(app[0]), platform_base_mutated: Boolean(app[0]), app_integration: app[0] || null, action_bindings: bindings, contribution: await loadContribution(pool, id), execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false }, secrets_included: false };
}
