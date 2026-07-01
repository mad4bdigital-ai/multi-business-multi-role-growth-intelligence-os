import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_CAPABILITY_ENFORCEMENT_SHADOW_VERSION,
  buildDynamicCapabilityEnforcementShadow,
} from "./dynamicCapabilityEnforcementShadow.js";

const NOW = "2026-07-01T03:00:00.000Z";
const CURRENT_MANIFEST_HASH = "a".repeat(64);
const CURRENT_SOURCE_HASH = "b".repeat(64);
const INPUT_HASH = "c".repeat(64);

function manifest(overrides = {}) {
  const capabilityKey = overrides.capability_key || "admin_tool.shadow_apply";
  const requirements = {
    scope_guard: true,
    resource_binding: true,
    validated_connection: true,
    credential_reference: true,
    approval_mode: "explicit_scoped",
    typed_confirmation: true,
    capability_envelope: true,
    idempotency: true,
    certification: true,
    audit: true,
    readback: true,
    rollback: true,
    compensation: false,
    quota: true,
    ...(overrides.requirements || {}),
  };
  const value = {
    capability_key: capabilityKey,
    display_name: "Shadow Apply",
    capability_family: capabilityKey.split(".")[0],
    source: overrides.source || { table: "admin_platform_endpoint_tools", key: capabilityKey.split(".").slice(1).join(".") },
    effect_class: overrides.effect_class || "internal_write",
    risk_class: overrides.risk_class || "D",
    requirements,
    projection: overrides.projection || { admin: "candidate", tenant: "not_applicable" },
    rollout_mode: "shadow",
    status: "shadow_ready",
    manifest_hash: overrides.manifest_hash || CURRENT_MANIFEST_HASH,
    secrets_included: false,
  };
  return {
    manifest_id: "manifest-1",
    run_id: "run-1",
    capability_key: capabilityKey,
    manifest_version: 1,
    manifest_hash: value.manifest_hash,
    source_revision_hash: CURRENT_SOURCE_HASH,
    compiler_version: "dynamic-capability-governance-compiler-v3",
    effect_class: value.effect_class,
    risk_class: value.risk_class,
    authority_requirement_type: "resource",
    status: overrides.status || "shadow_ready",
    rollout_mode: overrides.rollout_mode || "shadow",
    manifest_json: JSON.stringify(value),
    created_at: new Date("2026-06-30T00:00:00.000Z"),
  };
}

function readyEnvelope(overrides = {}) {
  return {
    envelope_id: "env-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    workspace_key: "workspace-key",
    brand_key: null,
    app_key: "platform_orchestration",
    capability_key: "admin_tool.shadow_apply",
    operation_intent: "shadow_apply",
    risk_class: "high",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: "shadow_apply",
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 1,
    approval_required: 1,
    quota_required: 1,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    envelope_sha256: "d".repeat(64),
    execution_ref: null,
    execution_status: "not_executed",
    expires_at: "2026-07-01T05:00:00.000Z",
    secrets_included: 0,
    created_at: "2026-07-01T02:00:00.000Z",
    updated_at: "2026-07-01T02:00:00.000Z",
    ...overrides,
  };
}

function currentCertification(overrides = {}) {
  return {
    certification_key: "shadow_apply",
    surface_key: "shadow_apply",
    surface_family: "internal_shadow",
    tool_or_action_key: "shadow_apply",
    risk_class: "D",
    certification_status: "current",
    smoke_strategy: "shadow_only",
    dispatch_allowed: 1,
    apply_allowed: 1,
    requires_resource_authority: 1,
    requires_dry_run: 1,
    requires_audit_evidence: 1,
    requires_readback: 1,
    last_evidence_ref: "smoke:shadow-apply",
    last_certified_at: "2026-07-01T02:30:00.000Z",
    expires_at: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

function createPool({ manifestRow = manifest(), envelope = readyEnvelope(), certifications = [currentCertification()] } = {}) {
  return {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM platform_capability_compiled_manifests")) return [[manifestRow]];
      if (source.includes("FROM capability_resolution_envelope_ledger")) return [[...(envelope ? [envelope] : [])]];
      if (source.includes("FROM runtime_dispatch_certification_registry")) return [certifications];
      throw new Error(`Unexpected SQL: ${source.slice(0, 140)}`);
    },
  };
}

const completeEvidence = {
  workspace_ready: true,
  resource_authority: true,
  capability_grant: true,
  connection_present: true,
  connection_validated: true,
  credential_scope_match: true,
  approval_present: true,
  typed_confirmation_match: true,
  idempotency_key_present: true,
  quota_authority: true,
  audit_ready: true,
  readback_contract: true,
  rollback_ready: true,
  compensation_ready: true,
};

const applyInput = {
  capability_key: "admin_tool.shadow_apply",
  requested_mode: "apply",
  principal_scope: "admin",
  workspace_ref: "workspace-1",
  resource_ref: "resource-1",
  runtime_surface: "shadow_apply",
  capability_envelope_id: "env-1",
  input_sha256: INPUT_HASH,
  expected_manifest_hash: CURRENT_MANIFEST_HASH,
  expected_source_revision_hash: CURRENT_SOURCE_HASH,
  legacy_decision: "allow",
  evidence: completeEvidence,
};

const deps = { pool: createPool(), now: () => NOW };
const matchAllow = await buildDynamicCapabilityEnforcementShadow(applyInput, deps);
const repeated = await buildDynamicCapabilityEnforcementShadow(applyInput, deps);
assert.equal(matchAllow.ok, true);
assert.equal(matchAllow.shadow_version, DYNAMIC_CAPABILITY_ENFORCEMENT_SHADOW_VERSION);
assert.equal(matchAllow.mode, "shadow");
assert.equal(matchAllow.adaptive_decision, "ready_for_dispatch");
assert.equal(matchAllow.effective_authority_decision, "allow");
assert.equal(matchAllow.parity.classification, "match_allow");
assert.equal(matchAllow.parity.blocking, false);
assert.equal(matchAllow.request_hash, repeated.request_hash);
assert.equal(matchAllow.decision_hash, repeated.decision_hash);
assert.equal(matchAllow.evidence.evidence_hash, repeated.evidence.evidence_hash);
assert.equal(matchAllow.execution_performed, false);
assert.equal(matchAllow.guarantees.legacy_authority_preserved, true);
assert.equal(matchAllow.guarantees.runtime_authority_changed, false);
assert.equal(matchAllow.guarantees.envelope_consumed, false);
assert.equal(matchAllow.guarantees.provider_calls_performed, false);
assert.equal(matchAllow.guarantees.mutations_performed, false);
assert.equal(matchAllow.secrets_included, false);

const unexplainedMismatch = await buildDynamicCapabilityEnforcementShadow({
  ...applyInput,
  legacy_decision: "deny",
  legacy_reason_codes: ["LEGACY_POLICY_DENY"],
}, deps);
assert.equal(unexplainedMismatch.adaptive_decision, "ready_for_dispatch");
assert.equal(unexplainedMismatch.effective_authority_decision, "deny");
assert.equal(unexplainedMismatch.parity.classification, "adaptive_allow_legacy_deny");
assert.equal(unexplainedMismatch.parity.blocking, true);
assert.equal(unexplainedMismatch.execution_performed, false);

const explainedMismatch = await buildDynamicCapabilityEnforcementShadow({
  ...applyInput,
  legacy_decision: "deny",
  legacy_explanation_ref: "review:legacy-deny-1",
  legacy_exception_approved: true,
}, deps);
assert.equal(explainedMismatch.parity.classification, "adaptive_allow_legacy_deny");
assert.equal(explainedMismatch.parity.exception_complete, true);
assert.equal(explainedMismatch.parity.blocking, false);
assert.equal(explainedMismatch.effective_authority_decision, "deny");

const staleManifest = await buildDynamicCapabilityEnforcementShadow({ ...applyInput, expected_manifest_hash: "e".repeat(64), legacy_decision: "allow" }, deps);
assert.equal(staleManifest.adaptive_decision, "deny");
assert.equal(staleManifest.parity.classification, "adaptive_stricter");
assert.equal(staleManifest.gates.find((item) => item.gate === "manifest_revision").state, "stale");

const staleCertification = await buildDynamicCapabilityEnforcementShadow(applyInput, {
  pool: createPool({ certifications: [currentCertification({ expires_at: "2026-06-30T23:00:00.000Z" })] }),
  now: () => NOW,
});
assert.equal(staleCertification.adaptive_decision, "deny");
assert.equal(staleCertification.blockers.includes("CERTIFICATION_STALE"), true);
assert.equal(staleCertification.gates.find((item) => item.gate === "certification").state, "stale");

const previewManifest = manifest({
  capability_key: "admin_tool.shadow_preview",
  effect_class: "preview_only",
  risk_class: "A",
  requirements: {
    scope_guard: false,
    resource_binding: false,
    validated_connection: false,
    credential_reference: false,
    approval_mode: "none",
    typed_confirmation: false,
    capability_envelope: false,
    idempotency: false,
    certification: false,
    audit: false,
    readback: false,
    rollback: false,
    compensation: false,
    quota: false,
  },
  source: { table: "admin_platform_endpoint_tools", key: "shadow_preview" },
  projection: { admin: "candidate", tenant: "not_applicable" },
});
const preview = await buildDynamicCapabilityEnforcementShadow({
  capability_key: "admin_tool.shadow_preview",
  requested_mode: "preview",
  principal_scope: "admin",
  legacy_decision: "allow",
  evidence: { capability_grant: true },
}, { pool: createPool({ manifestRow: previewManifest, envelope: null, certifications: [] }), now: () => NOW });
assert.equal(preview.adaptive_decision, "allow_preview");
assert.equal(preview.parity.classification, "match_allow");
assert.equal(preview.gates.find((item) => item.gate === "capability_envelope").state, "not_applicable");

const tenantBlocked = await buildDynamicCapabilityEnforcementShadow({
  capability_key: "admin_tool.shadow_preview",
  requested_mode: "preview",
  principal_scope: "tenant",
  tenant_ref: "tenant-1",
  legacy_decision: "deny",
  evidence: { tenant_membership: true, capability_grant: true },
}, { pool: createPool({ manifestRow: previewManifest, envelope: null, certifications: [] }), now: () => NOW });
assert.equal(tenantBlocked.adaptive_decision, "deny");
assert.equal(tenantBlocked.blockers.includes("TENANT_TO_ADMIN_SURFACE_BLOCKED"), true);
assert.equal(tenantBlocked.parity.classification, "match_deny");

await assert.rejects(
  () => buildDynamicCapabilityEnforcementShadow({ capability_key: "x", requested_mode: "execute" }, deps),
  (error) => error.code === "capability_enforcement_shadow_mode_invalid" && error.status === 400
);
await assert.rejects(
  () => buildDynamicCapabilityEnforcementShadow({ capability_key: "missing" }, {
    pool: { async query(sql) { return String(sql).includes("platform_capability_compiled_manifests") ? [[]] : [[]]; } },
    now: () => NOW,
  }),
  (error) => error.code === "CAPABILITY_NOT_REGISTERED" && error.status === 404
);

function collectObjectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

const returnedKeys = collectObjectKeys(matchAllow);
for (const forbiddenKey of [
  "input",
  "raw_input",
  "envelope_json",
  "credential_payload",
  "credential_secret",
  "access_token",
  "refresh_token",
  "authorization",
]) {
  assert.equal(returnedKeys.has(forbiddenKey), false, `forbidden output key returned: ${forbiddenKey}`);
}
assert.equal(matchAllow.guarantees.credential_payloads_read, false);
assert.equal(matchAllow.evidence.raw_input_returned, false);

const routesSource = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.equal(routesSource.includes("platform_capability_enforcement_shadow_preview"), true);
assert.equal(routesSource.includes("buildDynamicCapabilityEnforcementShadow"), true);
const manifestSource = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
assert.equal(manifestSource.includes("test-dynamic-capability-enforcement-shadow.mjs"), true);

console.log("dynamic capability enforcement shadow tests passed");
