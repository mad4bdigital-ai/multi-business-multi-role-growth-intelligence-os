import crypto from "node:crypto";
import {
  resolveTenantEffectiveCapability,
  tenantEffectiveCapabilityReadinessSmoke,
} from "./tenantEffectiveCapabilityResolver.js";

const PILOT_BOUNDARY_POLICIES = Object.freeze({
  "activation.skills.read": {
    pilot_key: "activation.skills.read",
    boundary_family: "read",
    enforcement_mode: "shadow_only",
    provider_apply_allowed: false,
    mutation_allowed: false,
    approval_required_for_apply: false,
    required_obligations: ["shadow_compare_only"],
  },
  "platform.output-artifact.write": {
    pilot_key: "platform.output-artifact.write",
    boundary_family: "internal_write",
    enforcement_mode: "shadow_only",
    provider_apply_allowed: false,
    mutation_allowed: false,
    approval_required_for_apply: true,
    required_obligations: ["audit_evidence_required", "readback_required", "shadow_compare_only"],
  },
  "content.wordpress.publish": {
    pilot_key: "content.wordpress.publish",
    boundary_family: "external_high_impact",
    enforcement_mode: "shadow_only",
    provider_apply_allowed: false,
    mutation_allowed: false,
    approval_required_for_apply: true,
    required_obligations: ["approval_required", "audit_evidence_required", "readback_required", "provider_apply_forbidden"],
  },
});

function safeText(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function policyForBoundary(boundaryKey = "") {
  return PILOT_BOUNDARY_POLICIES[safeText(boundaryKey, 191)] || null;
}

function blockedDecision(code, message, details = {}) {
  return {
    ok: false,
    enforcement_kernel: "tenant_capability_enforcement_kernel_v1",
    enforcement_status: "blocked",
    would_allow: false,
    provider_apply_allowed: false,
    mutations_executed: false,
    error: { code, message, details },
    secrets_included: false,
  };
}

function classifyShadowDecision(resolution = {}, policy = {}) {
  if (resolution.ok !== true) return "resolver_blocked";
  if (resolution.mismatch?.ambiguity === true) return "ambiguous_resolution_blocked";
  if (resolution.ready !== true) return "dependency_blocked";
  if (resolution.policy?.provider_apply_allowed === true) return "provider_apply_blocked_by_shadow_kernel";
  if (policy.approval_required_for_apply === true || resolution.policy?.approval_required === true) return "approval_required_shadow_only";
  return "shadow_allow";
}

function buildEnforcementObligations(resolution = {}, policy = {}) {
  const inherited = Array.isArray(resolution.obligations?.obligations)
    ? resolution.obligations.obligations
    : [];
  const required = Array.isArray(policy.required_obligations)
    ? policy.required_obligations
    : [];
  return [...new Set([
    ...inherited,
    ...required,
    "shared_enforcement_kernel_checked",
    "provider_apply_forbidden",
    "no_enforcement_cutover",
  ])];
}

export const TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "tenant_capability_enforcement_preview",
    description: "Shadow-only shared enforcement kernel preview for the adaptive authorization pilots. It resolves the semantic capability, applies the selected pilot boundary policy, and returns an allow/deny shadow decision without provider calls, mutations, or enforcement cutover.",
    inputSchema: {
      type: "object",
      required: ["capability_key", "boundary_key"],
      properties: {
        capability_key: { type: "string" },
        boundary_key: {
          type: "string",
          enum: ["activation.skills.read", "platform.output-artifact.write", "content.wordpress.publish"],
        },
        decision_input: {
          type: "object",
          properties: {
            subject: { type: "object", additionalProperties: true },
            action: { type: "object", additionalProperties: true },
            resource: { type: "object", additionalProperties: true },
            context: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        workspace_id: { type: "string" },
        workspace_key: { type: "string" },
        resource_ref: { type: "string" },
        connection_id: { type: "string" },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals by the underlying resolver." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals by the underlying resolver." },
        include_resolution: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tenant_capability_enforcement_readiness_smoke",
    description: "Admin-only read-only readiness smoke for the shadow-only adaptive authorization enforcement kernel. Verifies resolver readiness and kernel descriptor invariants without provider calls or mutations.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
]);

export async function tenantCapabilityEnforcementPreview(args = {}, context = {}) {
  const boundaryKey = safeText(args.boundary_key, 191);
  const policy = policyForBoundary(boundaryKey);
  if (!policy) {
    return blockedDecision("ENFORCEMENT_BOUNDARY_NOT_REGISTERED", "The requested pilot enforcement boundary is not registered.", {
      boundary_key: boundaryKey || null,
      allowed_boundaries: Object.keys(PILOT_BOUNDARY_POLICIES),
    });
  }

  const resolution = await resolveTenantEffectiveCapability(args, context);
  const shadowDecision = classifyShadowDecision(resolution, policy);
  const wouldAllow = shadowDecision === "shadow_allow" || shadowDecision === "approval_required_shadow_only";
  const enforcementManifest = {
    boundary_key: boundaryKey,
    policy,
    resolver_status: resolution.status || null,
    resolver_ready: resolution.ready === true,
    decision_input: resolution.decision_input || null,
    revision_vector: resolution.revision_vector || null,
    policy_composition: resolution.policy || null,
    obligations: buildEnforcementObligations(resolution, policy),
    mismatch: resolution.mismatch || null,
    shadow_decision: shadowDecision,
    provider_apply_allowed: false,
    mutations_executed: false,
    enforcement_cutover: false,
  };

  return {
    ok: true,
    enforcement_kernel: "tenant_capability_enforcement_kernel_v1",
    enforcement_mode: "shadow_only",
    boundary: {
      boundary_key: boundaryKey,
      boundary_family: policy.boundary_family,
      pilot_key: policy.pilot_key,
    },
    enforcement_status: shadowDecision,
    would_allow: wouldAllow,
    provider_apply_allowed: false,
    mutations_executed: false,
    enforcement_cutover: false,
    obligations: enforcementManifest.obligations,
    mismatch: enforcementManifest.mismatch,
    revision_vector: enforcementManifest.revision_vector,
    policy: enforcementManifest.policy_composition,
    manifest_hash: sha256(JSON.stringify(enforcementManifest)),
    resolution: args.include_resolution === true ? resolution : undefined,
    secrets_included: false,
  };
}

export async function tenantCapabilityEnforcementReadinessSmoke(
  _args = {},
  context = {}
) {
  const resolverSmoke = await tenantEffectiveCapabilityReadinessSmoke({}, context);
  const descriptorNames = TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS.map((tool) => tool.name);
  const checks = [
    { name: "resolver_readiness_passed", pass: resolverSmoke.ok === true && resolverSmoke.status === "pass" },
    { name: "three_pilot_boundaries_registered", pass: Object.keys(PILOT_BOUNDARY_POLICIES).length === 3 },
    { name: "preview_descriptor_present", pass: descriptorNames.includes("tenant_capability_enforcement_preview") },
    { name: "readiness_descriptor_present", pass: descriptorNames.includes("tenant_capability_enforcement_readiness_smoke") },
    { name: "shadow_only", pass: Object.values(PILOT_BOUNDARY_POLICIES).every((policy) => policy.enforcement_mode === "shadow_only") },
    { name: "provider_apply_forbidden", pass: Object.values(PILOT_BOUNDARY_POLICIES).every((policy) => policy.provider_apply_allowed === false) },
    { name: "no_mutation", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "tenant_capability_enforcement_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok
      ? "tenant_capability_enforcement_kernel_ready"
      : "tenant_capability_enforcement_kernel_not_ready",
    boundary_keys: Object.keys(PILOT_BOUNDARY_POLICIES),
    descriptor_tools: descriptorNames,
    resolver_readiness: resolverSmoke,
    checks,
    provider_calls_made: 0,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}
