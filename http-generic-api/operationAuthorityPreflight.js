import { verifyCurrentOperationRuntime } from "./operationRuntimeVerifier.js";
import { buildDynamicCapabilityEnforcementShadow } from "./dynamicCapabilityEnforcementShadow.js";
import { evaluateCapabilityKillSwitch } from "./capabilityKillSwitchPolicy.js";

const REQUESTED_MODES = new Set(["preview", "apply"]);
const PRINCIPAL_SCOPES = new Set(["admin", "tenant", "internal"]);
const LEGACY_DECISIONS = new Set(["allow", "deny", "error", "not_evaluated"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const SECRET_KEY_PATTERN = /(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie|credential_payload)/i;
const EVIDENCE_KEYS = Object.freeze([
  "tenant_membership",
  "workspace_ready",
  "resource_authority",
  "capability_grant",
  "connection_present",
  "connection_validated",
  "credential_scope_match",
  "approval_present",
  "typed_confirmation_match",
  "idempotency_key_present",
  "quota_authority",
  "audit_ready",
  "readback_contract",
  "rollback_ready",
  "compensation_ready"
]);
const GATE_EVIDENCE_KEYS = Object.freeze({
  tenant_membership: "tenant_membership",
  workspace_readiness: "workspace_ready",
  resource_authority: "resource_authority",
  capability_grant: "capability_grant",
  connection_presence: "connection_present",
  connection_validation: "connection_validated",
  credential_scope: "credential_scope_match",
  approval: "approval_present",
  typed_confirmation: "typed_confirmation_match",
  idempotency: "idempotency_key_present",
  quota_authority: "quota_authority",
  audit_readiness: "audit_ready",
  readback_contract: "readback_contract",
  rollback_readiness: "rollback_ready",
  compensation_readiness: "compensation_ready"
});

export class OperationAuthorityPreflightError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationAuthorityPreflightError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationAuthorityPreflightError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, field) {
  if (!isObject(value)) fail("operation_authority_preflight_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function allowedKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail("operation_authority_preflight_sensitive_field_forbidden", `${field}.${key} is sensitive.`, 400, { field: `${field}.${key}` });
    }
    if (!allowed.has(key)) {
      fail("operation_authority_preflight_unknown_field", `${field}.${key} is not supported.`, 400, { field: `${field}.${key}` });
    }
  }
}

function stringValue(value, field, { max = 191, pattern = null, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_authority_preflight_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function enumValue(value, field, allowed, defaultValue) {
  const normalized = stringValue(value ?? defaultValue, field, { max: 32 }).toLowerCase();
  if (!allowed.has(normalized)) fail("operation_authority_preflight_invalid_enum", `${field} is unsupported.`, 400, { field, value: normalized });
  return normalized;
}

function booleanValue(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") fail("operation_authority_preflight_invalid_boolean", `${field} must be boolean.`, 400, { field });
  return value;
}

function hashValue(value, field, { optional = true } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = stringValue(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_authority_preflight_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  return normalized;
}

function stringList(value, field, maxItems = 20) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail("operation_authority_preflight_invalid_list", `${field} must contain at most ${maxItems} values.`, 400, { field });
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, { max: 128 }));
}

function normalizeEvidence(input, field, { hashes = false } = {}) {
  const source = input === undefined || input === null ? {} : object(input, field);
  allowedKeys(source, new Set(EVIDENCE_KEYS), field);
  return Object.fromEntries(EVIDENCE_KEYS.map((key) => [
    key,
    hashes ? hashValue(source[key], `${field}.${key}`) : booleanValue(source[key], `${field}.${key}`)
  ]));
}

function normalizeInput(input = {}) {
  const root = object(input, "input");
  allowedKeys(root, new Set(["runtime_verification", "capability", "kill_switch", "evidence_hashes"]), "input");

  const runtimeVerification = object(root.runtime_verification, "input.runtime_verification");
  const capability = object(root.capability, "input.capability");
  allowedKeys(capability, new Set([
    "capability_key",
    "requested_mode",
    "principal_scope",
    "tenant_ref",
    "workspace_ref",
    "resource_ref",
    "runtime_surface",
    "capability_envelope_id",
    "context_revision",
    "input_sha256",
    "expected_request_hash",
    "legacy_decision",
    "legacy_reason_codes",
    "legacy_explanation_ref",
    "legacy_exception_approved",
    "evidence"
  ]), "input.capability");

  const killSwitch = object(root.kill_switch, "input.kill_switch");
  allowedKeys(killSwitch, new Set(["surface", "action"]), "input.kill_switch");

  return {
    runtime_verification: runtimeVerification,
    capability: {
      capability_key: stringValue(capability.capability_key, "input.capability.capability_key", { pattern: KEY_PATTERN }),
      requested_mode: enumValue(capability.requested_mode, "input.capability.requested_mode", REQUESTED_MODES, "preview"),
      principal_scope: enumValue(capability.principal_scope, "input.capability.principal_scope", PRINCIPAL_SCOPES, "admin"),
      tenant_ref: stringValue(capability.tenant_ref, "input.capability.tenant_ref", { max: 191, optional: true }),
      workspace_ref: stringValue(capability.workspace_ref, "input.capability.workspace_ref", { max: 191, optional: true }),
      resource_ref: stringValue(capability.resource_ref, "input.capability.resource_ref", { max: 500, optional: true }),
      runtime_surface: stringValue(capability.runtime_surface, "input.capability.runtime_surface", { pattern: KEY_PATTERN, optional: true }),
      capability_envelope_id: stringValue(capability.capability_envelope_id, "input.capability.capability_envelope_id", { max: 64, optional: true }),
      context_revision: stringValue(capability.context_revision, "input.capability.context_revision", { max: 191, optional: true }),
      input_sha256: hashValue(capability.input_sha256, "input.capability.input_sha256"),
      expected_request_hash: hashValue(capability.expected_request_hash, "input.capability.expected_request_hash"),
      legacy_decision: enumValue(capability.legacy_decision, "input.capability.legacy_decision", LEGACY_DECISIONS, "not_evaluated"),
      legacy_reason_codes: stringList(capability.legacy_reason_codes, "input.capability.legacy_reason_codes"),
      legacy_explanation_ref: stringValue(capability.legacy_explanation_ref, "input.capability.legacy_explanation_ref", { max: 512, optional: true }),
      legacy_exception_approved: capability.legacy_exception_approved === true,
      evidence: normalizeEvidence(capability.evidence, "input.capability.evidence")
    },
    kill_switch: {
      surface: stringValue(killSwitch.surface, "input.kill_switch.surface", { max: 64, pattern: KEY_PATTERN }),
      action: stringValue(killSwitch.action, "input.kill_switch.action", { max: 64, pattern: KEY_PATTERN })
    },
    evidence_hashes: normalizeEvidence(root.evidence_hashes, "input.evidence_hashes", { hashes: true })
  };
}

function blocker(code, source, details = {}) {
  return { code, source, ...details };
}

function boundedRuntimeEvidence(report) {
  if (!report) return null;
  return {
    verification_status: report.verification_status || null,
    operation_key: report.operation_key || null,
    operation_version: report.operation_version || null,
    scope_fingerprint: report.scope_fingerprint || null,
    manifest_evidence: report.manifest_evidence || null,
    authority_evidence: report.authority_evidence || null,
    blocker_codes: Array.isArray(report.blockers) ? report.blockers.map((item) => item?.code).filter(Boolean) : [],
    secrets_included: false
  };
}

function boundedShadowEvidence(report) {
  if (!report) return null;
  return {
    shadow_version: report.shadow_version || null,
    capability_key: report.capability_key || null,
    requested_mode: report.requested_mode || null,
    request_hash: report.request_hash || null,
    decision_hash: report.decision_hash || null,
    adaptive_decision: report.adaptive_decision || null,
    effective_authority_decision: report.effective_authority_decision || null,
    blockers: Array.isArray(report.blockers) ? report.blockers.slice(0, 20) : [],
    next_actions: Array.isArray(report.next_actions) ? report.next_actions.slice(0, 10) : [],
    gates: Array.isArray(report.gates) ? report.gates.map((gate) => ({
      gate: gate.gate,
      state: gate.state,
      required: Boolean(gate.required),
      reason_code: gate.reason_code || null
    })) : [],
    manifest: report.manifest ? {
      manifest_id: report.manifest.manifest_id || null,
      manifest_version: report.manifest.manifest_version || null,
      manifest_hash: report.manifest.manifest_hash || null,
      source_revision_hash: report.manifest.source_revision_hash || null,
      compiler_version: report.manifest.compiler_version || null,
      effect_class: report.manifest.effect_class || null,
      risk_class: report.manifest.risk_class || null,
      status: report.manifest.status || null,
      rollout_mode: report.manifest.rollout_mode || null
    } : null,
    secrets_included: false
  };
}

function expectedAdaptiveDecision(mode) {
  return mode === "apply" ? "ready_for_dispatch" : "allow_preview";
}

function dependencies(overrides = {}) {
  return {
    verifyRuntime: overrides.verifyRuntime || verifyCurrentOperationRuntime,
    buildCapabilityShadow: overrides.buildCapabilityShadow || buildDynamicCapabilityEnforcementShadow,
    evaluateKillSwitch: overrides.evaluateKillSwitch || evaluateCapabilityKillSwitch,
    shadowDeps: overrides.shadowDeps || {}
  };
}

export async function buildOperationAuthorityPreflight(input = {}, dependencyOverrides = {}) {
  const request = normalizeInput(input);
  const resolved = dependencies(dependencyOverrides);
  const blockers = [];

  const runtimeReport = await resolved.verifyRuntime(request.runtime_verification);
  const runtimeReady = runtimeReport?.ok === true && runtimeReport?.verification_status === "ready_for_runtime_authority_resolution";
  if (!runtimeReady) {
    blockers.push(blocker("runtime_verification_not_ready", "operation_runtime_verifier", {
      observed_status: runtimeReport?.verification_status || null
    }));
  }

  const runtimeDispatch = runtimeReport?.authority_evidence?.dispatch_binding || null;
  if (runtimeDispatch) {
    if (runtimeDispatch.capability_key && runtimeDispatch.capability_key !== request.capability.capability_key) {
      blockers.push(blocker("capability_key_runtime_mismatch", "operation_runtime_verifier"));
    }
    if (request.capability.runtime_surface && runtimeDispatch.runtime_surface && runtimeDispatch.runtime_surface !== request.capability.runtime_surface) {
      blockers.push(blocker("runtime_surface_mismatch", "operation_runtime_verifier"));
    }
  }

  let shadowReport = null;
  if (blockers.length === 0) {
    shadowReport = await resolved.buildCapabilityShadow({
      ...request.capability,
      runtime_surface: request.capability.runtime_surface || runtimeDispatch?.runtime_surface || null,
      expected_manifest_hash: runtimeReport?.manifest_evidence?.manifest_hash || null,
      expected_source_revision_hash: runtimeReport?.manifest_evidence?.source_revision_hash || null
    }, resolved.shadowDeps);

    const adaptiveExpected = expectedAdaptiveDecision(request.capability.requested_mode);
    if (shadowReport?.adaptive_decision !== adaptiveExpected) {
      blockers.push(blocker("adaptive_authority_not_ready", "dynamic_capability_enforcement_shadow", {
        expected: adaptiveExpected,
        observed: shadowReport?.adaptive_decision || null
      }));
    }
    if (shadowReport?.effective_authority_decision !== "allow") {
      blockers.push(blocker("legacy_authority_not_allowing", "dynamic_capability_enforcement_shadow", {
        observed: shadowReport?.effective_authority_decision || null
      }));
    }
    if (shadowReport?.parity?.blocking === true) {
      blockers.push(blocker("authority_parity_exception_required", "dynamic_capability_enforcement_shadow"));
    }
    for (const reasonCode of Array.isArray(shadowReport?.blockers) ? shadowReport.blockers : []) {
      blockers.push(blocker(reasonCode || "capability_shadow_blocked", "dynamic_capability_enforcement_shadow"));
    }

    for (const gate of Array.isArray(shadowReport?.gates) ? shadowReport.gates : []) {
      if (!gate?.required || gate.state !== "pass") continue;
      const evidenceKey = GATE_EVIDENCE_KEYS[gate.gate];
      if (evidenceKey && !request.evidence_hashes[evidenceKey]) {
        blockers.push(blocker("authority_evidence_hash_missing", "authority_evidence", {
          gate: gate.gate,
          evidence_key: evidenceKey
        }));
      }
    }
  }

  const killSwitch = resolved.evaluateKillSwitch({
    surface: request.kill_switch.surface,
    action: request.kill_switch.action
  });
  if (killSwitch?.blocked) {
    blockers.push(blocker("capability_kill_switch_enabled", "capability_kill_switch", {
      switch_key: killSwitch.switch_key || null,
      env_var: killSwitch.env_var || null
    }));
  }

  const uniqueBlockers = [];
  const seen = new Set();
  for (const item of blockers) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueBlockers.push(item);
  }

  const ready = uniqueBlockers.length === 0;
  return {
    ok: ready,
    report_type: "operation_authority_preflight",
    preflight_status: ready ? "ready_for_governed_authority_handoff" : "blocked_authority_preflight",
    runtime_verification: boundedRuntimeEvidence(runtimeReport),
    capability_shadow: boundedShadowEvidence(shadowReport),
    kill_switch: {
      blocked: Boolean(killSwitch?.blocked),
      surface: killSwitch?.surface || request.kill_switch.surface,
      action: killSwitch?.action || request.kill_switch.action,
      mutation: Boolean(killSwitch?.mutation),
      switch_enabled: Boolean(killSwitch?.switch_enabled),
      switch_key: killSwitch?.switch_key || null,
      env_var: killSwitch?.env_var || null,
      secrets_included: false
    },
    evidence_hashes: Object.fromEntries(Object.entries(request.evidence_hashes).filter(([, value]) => Boolean(value))),
    blockers: uniqueBlockers,
    blocker_count: uniqueBlockers.length,
    next_stage: ready ? "governed_runtime_authority_resolution" : "resolve_authority_preflight_blockers",
    authoritative_decision_source: "legacy_runtime",
    legacy_authority_preserved: true,
    runtime_authority_resolution_required: true,
    runtime_dispatch_authorized: false,
    execution_performed: false,
    database_writes_performed: false,
    provider_calls_performed: false,
    credential_payloads_read: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    envelope_consumed: false,
    idempotency_reserved: false,
    secrets_included: false
  };
}

export const buildRuntimeAuthorityPreflight = buildOperationAuthorityPreflight;
