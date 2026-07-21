import { getPool } from "./db.js";
import { resolveCapabilityExecutionEnvelope } from "./capabilityResolutionEnvelopeGuard.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_ADMIN_USER = "platform_admin";

function text(value, max = 512) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : "";
}
function parseJson(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}
function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => text(item, 191)).filter(Boolean) : [];
}
function decision({ ok, applicable = true, reasonCode, policy = null, family = "", binding = null, operation = "", mode = "", envelope = null, evidence = {} } = {}) {
  return {
    ok: Boolean(ok), applicable: Boolean(applicable),
    reason_code: reasonCode || (ok ? "capability_family_authorized" : "capability_family_denied"),
    capability_family: family || null, policy_key: policy?.policy_key || null,
    operation: operation || null, operation_mode: mode || null,
    mutation_policy_declared: Boolean(ok && binding?.mutation_policy_declared),
    envelope_id: envelope?.envelope_id || null,
    readback_required: Boolean(binding?.readback_required || envelope?.readback_required),
    audit_required: Boolean(binding?.audit_required || envelope?.audit_required),
    evidence, secrets_included: false,
  };
}
async function loadCapabilityFamilyPolicies(pool) {
  const [rows] = await pool.query(
    `SELECT id, policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking
       FROM execution_policies
      WHERE active = 'TRUE'
        AND JSON_VALID(policy_value)
        AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.capability_family')) IS NOT NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 100`,
  );
  return (rows || []).map((row) => ({ ...row, config: parseJson(row.policy_value) }));
}
function resolveBinding(policy, toolKey) {
  const bindings = policy?.config?.tool_bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
  const binding = bindings[toolKey];
  return binding && typeof binding === "object" && !Array.isArray(binding) ? binding : null;
}
function resolveOperation(binding = {}, args = {}) {
  if (binding.operation_mode && binding.operation) return { mode: text(binding.operation_mode, 64), operation: text(binding.operation, 128), config: binding };
  const modeArg = text(binding.mode_arg || "mode", 64);
  let mode = text(args?.[modeArg], 64).toLowerCase();
  if (modeArg === "dry_run") mode = args?.dry_run === false ? "apply" : "dry_run";
  if (!mode && binding.default_mode) mode = text(binding.default_mode, 64).toLowerCase();
  const config = binding.operations?.[mode];
  return { mode, operation: text(config?.operation || binding.operation, 128), config: config && typeof config === "object" ? config : null };
}
function resourceIds(config = {}, args = {}) {
  const values = [];
  for (const name of stringArray(config.resource_ids_args)) {
    const value = args?.[name];
    if (Array.isArray(value)) values.push(...value);
    else if (value !== null && value !== undefined && String(value).trim()) values.push(value);
  }
  return [...new Set(values.map((value) => text(value, 64)).filter(Boolean))];
}
async function validateActiveSession(pool, { config, args, callerType, principal }) {
  const resourceId = text(args?.[config.resource_id_arg || "id"], 64);
  if (!resourceId) return { ok: false, reason_code: "session_archive_resource_id_required" };
  const [rows] = await pool.query(
    `SELECT session_id, tenant_id, user_id, originator, session_status FROM customer_sessions WHERE session_id = ? LIMIT 1`,
    [resourceId],
  );
  const session = rows?.[0];
  if (!session) return { ok: false, reason_code: "session_archive_session_not_found", resource_id: resourceId };
  if (["completed", "closed"].includes(String(session.session_status || "").toLowerCase())) return { ok: false, reason_code: "session_archive_session_closed", resource_id: resourceId };
  if (config.require_gpt_action_originator && session.originator !== "gpt_action") return { ok: false, reason_code: "session_archive_originator_mismatch", resource_id: resourceId };
  if (callerType !== "admin") {
    const tenantId = text(principal?.tenant_id, 64);
    const userId = text(principal?.user_id, 64);
    if (!tenantId || !userId) return { ok: false, reason_code: "session_archive_principal_required", resource_id: resourceId };
    if (config.require_exact_tenant_scope && session.tenant_id !== tenantId) return { ok: false, reason_code: "session_archive_tenant_scope_mismatch", resource_id: resourceId };
    if (config.require_exact_user_scope && session.user_id && session.user_id !== userId) return { ok: false, reason_code: "session_archive_user_scope_mismatch", resource_id: resourceId };
  }
  return { ok: true, resource_id: resourceId, session_status: session.session_status, tenant_id: session.tenant_id || null, user_id: session.user_id || null };
}
export function capabilityFamilyFromTags(tags = []) {
  const values = (Array.isArray(tags) ? tags : String(tags || "").split(",")).map((tag) => text(tag, 191).toLowerCase()).filter(Boolean);
  const marker = values.find((tag) => tag.startsWith("capability_family:"));
  return marker ? marker.slice("capability_family:".length) : "";
}
export async function resolveToolCapabilityFamilyAuthorization({ pool = null, callerType = "tenant", principal = {}, toolKey = "", args = {}, expectedFamily = "", requirePolicy = false } = {}) {
  const db = pool || getPool();
  const normalizedToolKey = text(toolKey, 191);
  const normalizedFamily = text(expectedFamily, 191).toLowerCase();
  let policies;
  try { policies = await loadCapabilityFamilyPolicies(db); }
  catch { return decision({ ok: false, applicable: Boolean(requirePolicy || normalizedFamily), reasonCode: "capability_family_registry_unavailable", family: normalizedFamily }); }
  const matches = [];
  for (const policy of policies) {
    const family = text(policy.config.capability_family, 191).toLowerCase();
    if (normalizedFamily && family !== normalizedFamily) continue;
    const binding = resolveBinding(policy, normalizedToolKey);
    if (binding) matches.push({ policy, family, binding });
  }
  if (!matches.length) return decision({ ok: !requirePolicy && !normalizedFamily, applicable: Boolean(requirePolicy || normalizedFamily), reasonCode: requirePolicy || normalizedFamily ? "capability_family_policy_not_configured" : "capability_family_not_applicable", family: normalizedFamily });
  if (matches.length !== 1) return decision({ ok: false, reasonCode: "capability_family_binding_ambiguous", family: normalizedFamily, evidence: { matching_binding_count: matches.length } });
  const { policy, family, binding } = matches[0];
  const resolved = resolveOperation(binding, args);
  const config = resolved.config;
  if (!resolved.mode || !resolved.operation || !config) return decision({ ok: false, reasonCode: "capability_family_operation_not_configured", policy, family, binding, mode: resolved.mode, operation: resolved.operation });
  const callerTypes = stringArray(config.caller_types);
  if (callerTypes.length && !callerTypes.includes(callerType)) return decision({ ok: false, reasonCode: "capability_family_caller_not_allowed", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation });
  const itemArg = text(config.item_arg, 64);
  if (itemArg) {
    const items = Array.isArray(args?.[itemArg]) ? args[itemArg] : [];
    const maximum = Math.max(1, Number(config.max_items || 1));
    if (!items.length || items.length > maximum) return decision({ ok: false, reasonCode: "capability_family_item_bound_exceeded", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, evidence: { item_count: items.length, max_items: maximum } });
  }
  let resourceEvidence = {};
  if (config.resource_scope === "active_session") {
    const session = await validateActiveSession(db, { config, args, callerType, principal });
    if (!session.ok) return decision({ ok: false, reasonCode: session.reason_code, policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, evidence: session });
    resourceEvidence = session;
  }
  const ids = resourceIds(config, args);
  if (config.explicit_resource_ids_required && !ids.length) return decision({ ok: false, reasonCode: "capability_family_explicit_resource_ids_required", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation });
  if (ids.length > Math.max(1, Number(config.max_items || 25))) return decision({ ok: false, reasonCode: "capability_family_resource_bound_exceeded", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, evidence: { resource_count: ids.length, max_items: Number(config.max_items || 25) } });
  const reason = text(args?.[text(config.reason_arg || "reason", 64)], 1000);
  if (Number(config.min_reason_chars || 0) > 0 && reason.length < Number(config.min_reason_chars)) return decision({ ok: false, reasonCode: "capability_family_reason_required", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation });
  if (config.typed_confirmation && text(args?.confirm, 255) !== text(config.typed_confirmation, 255)) return decision({ ok: false, reasonCode: "capability_family_typed_confirmation_mismatch", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation });
  let envelope = null;
  if (config.envelope_required) {
    envelope = await resolveCapabilityExecutionEnvelope({
      pool: db, source: args,
      acceptedAppKeys: stringArray(config.accepted_app_keys),
      acceptedIntents: stringArray(config.accepted_intents),
      acceptedCapabilityKeys: stringArray(config.accepted_capability_keys),
      expectedTenantId: text(principal?.tenant_id, 64) || (callerType === "admin" ? PLATFORM_TENANT_ID : ""),
      expectedUserId: text(principal?.user_id, 64) || (callerType === "admin" ? PLATFORM_ADMIN_USER : ""),
      allowReferenced: false, requireReadyForDispatch: true, requireDispatchAllowed: true,
      requireNoApprovalRequired: false, requireNoBlockingGaps: true, requireNoSecrets: true,
    });
    if (!envelope.ok) return decision({ ok: false, reasonCode: envelope.status, policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, envelope, evidence: { resource_ids: ids } });
    if (config.apply_allowed_required && envelope.apply_allowed !== true) return decision({ ok: false, reasonCode: "capability_family_apply_not_authorized", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, envelope });
    if (config.readback_required && envelope.readback_required !== true) return decision({ ok: false, reasonCode: "capability_family_readback_contract_required", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, envelope });
    if (config.audit_required && envelope.audit_required !== true) return decision({ ok: false, reasonCode: "capability_family_audit_contract_required", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, envelope });
  }
  return decision({ ok: true, reasonCode: "capability_family_authorized", policy, family, binding: config, mode: resolved.mode, operation: resolved.operation, envelope, evidence: { ...resourceEvidence, resource_ids: ids, resource_count: ids.length } });
}
export function capabilityFamilyAuthorizationError(result, message = "Capability-family authorization denied this operation.") {
  const err = new Error(message);
  err.status = 403;
  err.code = result?.reason_code || "capability_family_authorization_denied";
  err.details = { ...(result || {}), secrets_included: false };
  return err;
}
export const _testingToolCapabilityFamilyAuthorization = { parseJson, resolveOperation, resourceIds, resolveBinding };
