import { createHash } from "node:crypto";

import {
  RUNTIME_BREAK_GLASS_CONTRACT,
  RUNTIME_BREAK_GLASS_OPERATION_INTENT,
  normalizeRuntimeBreakGlassIncident,
} from "./runtimeBreakGlassLifecycle.js";

const SYNTHETIC_CAPABILITY_ENVELOPE_ID = "00000000-0000-4000-8000-000000000018";
const CALLER_FINGERPRINT_FIELDS = Object.freeze([
  "break_glass_scope_sha256",
  "runtime_break_glass_scope_sha256",
]);
const POST_APPROVAL_FIELDS = Object.freeze([
  "approved_scope_sha256",
  "post_change_hashes",
  "post_change_hashes_json",
  "post_change_readback_hashes",
  "post_change_readback_json",
  "runtime_verification_run_id",
  "runtime_verification",
  "runtime_verification_json",
  "approved_at",
  "local_patch_applied_at",
  "runtime_verified_at",
  "reconciliation_started_at",
  "rolled_back_at",
  "closed_at",
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rejectCallerAuthorityFingerprint(input = {}) {
  for (const key of CALLER_FINGERPRINT_FIELDS) {
    if (Object.hasOwn(input, key) && String(input[key] || "").trim()) {
      const error = new Error(`${key} is computed by the governed runtime break-glass issuer and must not be caller supplied.`);
      error.code = "runtime_break_glass_scope_fingerprint_caller_supplied";
      throw error;
    }
  }
}

export function buildRuntimeBreakGlassApprovalScope(input = {}) {
  rejectCallerAuthorityFingerprint(input);
  const normalized = normalizeRuntimeBreakGlassIncident({
    ...input,
    lifecycle_state: input.lifecycle_state || "OPEN",
    capability_envelope_id: input.capability_envelope_id || SYNTHETIC_CAPABILITY_ENVELOPE_ID,
  });
  return {
    contract: RUNTIME_BREAK_GLASS_CONTRACT,
    operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
    break_glass_id: normalized.break_glass_id,
    incident_id: normalized.incident_id,
    target_id: normalized.target_id,
    target_application_root: normalized.target_application_root,
    environment_key: normalized.environment_key,
    approving_principal: normalized.approving_principal,
    executing_principal: normalized.executing_principal,
    release_gate_id: normalized.release_gate_id,
    release_operation_id: normalized.release_operation_id,
    expected_commit_sha: normalized.expected_commit_sha,
    reason: normalized.reason,
    allowed_paths: normalized.allowed_paths,
    pre_change_hashes: normalized.pre_change_hashes,
    rollback_plan: normalized.rollback_plan,
    audit_correlation: normalized.audit_correlation,
    authorization_expires_at: normalized.authorization_expires_at,
  };
}

export function fingerprintRuntimeBreakGlassApprovalScope(input = {}) {
  const scope = buildRuntimeBreakGlassApprovalScope(input);
  return createHash("sha256").update(stableJson(scope)).digest("hex");
}

export function parseRuntimeBreakGlassScopeJson(value) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    const error = new Error("--runtime-break-glass-scope-json must contain valid JSON.");
    error.code = "runtime_break_glass_scope_json_invalid";
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Runtime break-glass scope must be a JSON object.");
    error.code = "runtime_break_glass_scope_object_required";
    throw error;
  }
  rejectCallerAuthorityFingerprint(parsed);
  if (String(parsed.lifecycle_state || "OPEN").trim().toUpperCase() !== "OPEN") {
    const error = new Error("Governed runtime break-glass scope issuance is only valid for an OPEN incident scope.");
    error.code = "runtime_break_glass_scope_open_state_required";
    throw error;
  }
  for (const key of POST_APPROVAL_FIELDS) {
    if (!Object.hasOwn(parsed, key)) continue;
    const raw = parsed[key];
    const present = raw !== null && raw !== undefined && raw !== "" && !(Array.isArray(raw) && raw.length === 0);
    if (present) {
      const error = new Error(`${key} is post-approval evidence and must not be supplied to the governed approval-scope issuer.`);
      error.code = "runtime_break_glass_scope_post_approval_evidence_forbidden";
      throw error;
    }
  }
  return parsed;
}

export const RUNTIME_BREAK_GLASS_SCOPE_BINDING_CONTRACT = "mad4b.runtime-break-glass.scope-binding.v1";
