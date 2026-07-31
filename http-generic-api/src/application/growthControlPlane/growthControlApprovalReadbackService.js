import { stableSha256 } from "../../domain/growthControlPlane/growthControlPlane.js";

const SHA256_RE = /^[a-f0-9]{64}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;

function approvalReadbackError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function resolveUnique(rows, code, message) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw approvalReadbackError(code, message, 409);
  const [candidate] = candidates;
  return candidate;
}

function identifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    throw approvalReadbackError(
      "growth_control_approval_readback_input_invalid",
      `${field} must be a bounded opaque identifier.`,
      422,
      { field },
    );
  }
  return normalized;
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    throw approvalReadbackError(
      "growth_control_approval_readback_input_invalid",
      `${field} must be a canonical key.`,
      422,
      { field },
    );
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw approvalReadbackError(
      "growth_control_approval_readback_input_invalid",
      `${field} must be SHA-256.`,
      422,
      { field },
    );
  }
  return normalized;
}

function sortedUnique(values, field, normalize = identifier) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw approvalReadbackError(
      "growth_control_approval_readback_input_invalid",
      `${field} must be a non-empty bounded array.`,
      422,
      { field },
    );
  }
  return [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
}

function normalizeExpectedBinding(input = {}) {
  return {
    plan_id: identifier(input.planId ?? input.plan_id, "planId"),
    plan_step_id: identifier(input.planStepId ?? input.plan_step_id, "planStepId"),
    tenant_id: identifier(input.tenantId ?? input.tenant_id, "tenantId"),
    plan_hash_sha256: sha256(input.planHashSha256 ?? input.plan_hash_sha256, "planHashSha256"),
    request_hash_sha256: sha256(input.requestHashSha256 ?? input.request_hash_sha256, "requestHashSha256"),
    node_id: canonical(input.nodeId ?? input.node_id, "nodeId"),
    capability_key: canonical(input.capabilityKey ?? input.capability_key, "capabilityKey"),
    action_ids: sortedUnique(input.actionIds ?? input.action_ids, "actionIds", canonical),
    resource_ids: sortedUnique(input.resourceIds ?? input.resource_ids, "resourceIds"),
    environment: canonical(input.environment, "environment"),
    effect_class: canonical(input.effectClass ?? input.effect_class, "effectClass"),
  };
}

function observedBinding(row, context) {
  return {
    plan_id: String(row.run_id ?? ""),
    plan_step_id: String(row.step_run_id ?? ""),
    tenant_id: String(row.tenant_id ?? ""),
    plan_hash_sha256: String(context.plan_hash_sha256 ?? ""),
    request_hash_sha256: String(context.request_hash_sha256 ?? ""),
    node_id: String(context.node_id ?? ""),
    capability_key: String(context.capability_key ?? ""),
    action_ids: Array.isArray(context.action_ids) ? [...context.action_ids].map(String).sort() : [],
    resource_ids: Array.isArray(context.resource_ids) ? [...context.resource_ids].map(String).sort() : [],
    environment: String(context.environment ?? ""),
    effect_class: String(context.effect_class ?? ""),
  };
}

function mismatchFields(expected, observed) {
  return Object.keys(expected).filter(
    (field) => stableSha256(expected[field]) !== stableSha256(observed[field]),
  );
}

export async function readGrowthControlApprovedHold({
  pool,
  holdId,
  now = new Date(),
  ...bindingInput
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw approvalReadbackError("growth_control_approval_readback_pool_required", "pool.query is required.", 400);
  }
  const normalizedHoldId = identifier(holdId, "holdId");
  const expected = normalizeExpectedBinding(bindingInput);
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw approvalReadbackError("growth_control_approval_readback_input_invalid", "now must be a valid instant.", 422);
  }

  const [rows] = await pool.query(
    `SELECT hold_id, run_id, step_run_id, tenant_id, status, required_role,
            expires_at, execution_context_json
       FROM approval_holds WHERE hold_id = ? LIMIT 2`,
    [normalizedHoldId],
  );
  const row = resolveUnique(
    rows,
    "growth_control_approval_readback_ambiguous",
    "Approval hold identity resolved to multiple rows.",
  );
  if (!row) {
    throw approvalReadbackError("growth_control_approval_readback_not_found", "Approval hold was not found.", 404);
  }
  const context = parseJson(row.execution_context_json, {});
  if (context.source !== "growth_control_provider_effect" || !SHA256_RE.test(String(context.binding_sha256 || ""))) {
    throw approvalReadbackError(
      "growth_control_approval_readback_contract_mismatch",
      "Approval hold is not bound by the Growth Control provider-effect contract.",
      409,
    );
  }
  const observed = observedBinding(row, context);
  const mismatches = mismatchFields(expected, observed);
  if (mismatches.length > 0) {
    throw approvalReadbackError(
      "growth_control_approval_readback_binding_mismatch",
      "Approval hold binding does not match the final-boundary request.",
      409,
      { mismatch_fields: mismatches.sort() },
    );
  }
  if (String(row.status) !== "approved") {
    throw approvalReadbackError(
      "growth_control_approval_readback_not_approved",
      `Approval hold is '${row.status}'.`,
      409,
      { approval_status: String(row.status || "unknown") },
    );
  }
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= instant.getTime()) {
    throw approvalReadbackError(
      "growth_control_approval_readback_expired",
      "Approval hold is expired or has an invalid expiry.",
      409,
    );
  }

  const evidence = {
    hold_id: normalizedHoldId,
    plan_id: expected.plan_id,
    plan_step_id: expected.plan_step_id,
    tenant_id: expected.tenant_id,
    binding_sha256: String(context.binding_sha256),
    request_hash_sha256: expected.request_hash_sha256,
    plan_hash_sha256: expected.plan_hash_sha256,
    capability_key: expected.capability_key,
    action_ids: expected.action_ids,
    resource_ids: expected.resource_ids,
    environment: expected.environment,
    effect_class: expected.effect_class,
    required_role: row.required_role ? String(row.required_role) : null,
    approval_status: "approved",
    expires_at: expiresAt.toISOString(),
    approval_satisfied: true,
    authority_granted: false,
    provider_dispatch_performed: false,
    external_writes: false,
    secrets_included: false,
  };
  return Object.freeze({ ...evidence, evidence_sha256: stableSha256(evidence) });
}

export const growthControlApprovalReadbackContract = Object.freeze({
  version: "growth-control-approved-hold-readback-v1",
  authority: "approval_holds",
  required_status: "approved",
  exact_binding_required: true,
  expiry_required: true,
  authority_granted: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});

export const _testingGrowthControlApprovalReadback = Object.freeze({
  parseJson,
  resolveUnique,
  normalizeExpectedBinding,
  observedBinding,
  mismatchFields,
});
