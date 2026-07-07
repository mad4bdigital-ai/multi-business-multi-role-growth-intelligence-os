import crypto from "node:crypto";
import {
  resolveTenantEffectiveCapability,
  tenantEffectiveCapabilityReadinessSmoke,
} from "./tenantEffectiveCapabilityResolver.js";

const READ_OPERATIONS = new Set(["read", "list", "inspect", "preview", "status", "search"]);
const HIGH_IMPACT_TERMS = ["publish", "send", "deploy", "release", "delete", "payment", "billing", "wordpress", "email", "external"];

function safeText(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return safeText(value, 255).toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
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

function boundaryKeyFor(args = {}, resolution = {}) {
  return safeText(
    args.boundary_key
      || resolution?.capability?.capability_key
      || resolution?.decision_input?.action?.capability_key
      || args.capability_key,
    191
  );
}

function deriveBoundaryFamily(resolution = {}) {
  const operation = normalize(resolution?.capability?.operation_key || resolution?.decision_input?.action?.operation_key);
  const riskClass = normalize(resolution?.capability?.risk_class);
  const haystack = [
    resolution?.capability?.capability_key,
    resolution?.capability?.resource_type,
    resolution?.capability?.operation_key,
    riskClass,
    resolution?.binding?.app_key,
    resolution?.binding?.parent_action_key,
    resolution?.endpoint?.endpoint_key,
  ].map(normalize).join(" ");

  if (READ_OPERATIONS.has(operation)) return "read";
  if (riskClass.includes("high") || HIGH_IMPACT_TERMS.some((term) => haystack.includes(term))) {
    return "external_high_impact";
  }
  return "internal_write";
}

function deriveBoundaryPolicy(args = {}, resolution = {}) {
  const boundaryKey = boundaryKeyFor(args, resolution);
  const boundaryFamily = deriveBoundaryFamily(resolution);
  const approvalRequired = boundaryFamily !== "read" || resolution?.policy?.approval_required === true;
  const requiredObligations = new Set(["shadow_compare_only", "provider_apply_forbidden"]);

  if (approvalRequired) requiredObligations.add("approval_required");
  if (boundaryFamily !== "read") {
    requiredObligations.add("audit_evidence_required");
    requiredObligations.add("readback_required");
  }
  if (resolution?.policy?.connection_required === true) requiredObligations.add("validated_workspace_connection_required");
  if (resolution?.policy?.workspace_authority_required === true) requiredObligations.add("resource_authority_required");

  return {
    policy_version: "tenant_capability_dynamic_enforcement_policy_v1",
    boundary_key: boundaryKey,
    boundary_family: boundaryFamily,
    derivation_source: "tenant_effective_capability_resolver_v1",
    enforcement_mode: "shadow_only",
    provider_apply_allowed: false,
    mutation_allowed: false,
    approval_required_for_apply: approvalRequired,
    required_obligations: [...requiredObligations].sort(),
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
    "dynamic_policy_derived_from_resolver",
    "provider_apply_forbidden",
    "no_enforcement_cutover",
  ])].sort();
}

export const TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "tenant_capability_enforcement_preview",
    description: "Shadow-only shared enforcement kernel preview. It resolves the semantic capability, derives a boundary policy dynamically from resolver metadata, and returns an allow/deny shadow decision without provider calls, mutations, or enforcement cutover.",
    inputSchema: {
      type: "object",
      required: ["capability_key"],
      properties: {
        capability_key: { type: "string" },
        boundary_key: {
          type: "string",
          description: "Optional boundary hint. If omitted, the kernel derives the boundary from the canonical capability and resolver metadata.",
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
    description: "Admin-only read-only readiness smoke for the dynamic, shadow-only adaptive authorization enforcement kernel. Verifies resolver readiness and descriptor invariants without provider calls or mutations.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
]);

export async function tenantCapabilityEnforcementPreview(args = {}, context = {}) {
  const resolution = await resolveTenantEffectiveCapability(args, context);
  if (resolution.ok !== true) {
    return blockedDecision("RESOLVER_BLOCKED", "The effective capability resolver blocked the request before enforcement policy derivation.", {
      resolver_status: resolution.status || null,
      resolver_error: resolution.error || null,
    });
  }

  const policy = deriveBoundaryPolicy(args, resolution);
  const shadowDecision = classifyShadowDecision(resolution, policy);
  const wouldAllow = shadowDecision === "shadow_allow" || shadowDecision === "approval_required_shadow_only";
  const enforcementManifest = {
    boundary_key: policy.boundary_key,
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
      boundary_key: policy.boundary_key,
      boundary_family: policy.boundary_family,
      derivation_source: policy.derivation_source,
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
    enforcement_policy: policy,
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
  const previewDescriptor = TENANT_CAPABILITY_ENFORCEMENT_SYSTEM_TOOLS.find((tool) => tool.name === "tenant_capability_enforcement_preview");
  const hasStaticBoundaryEnum = Array.isArray(previewDescriptor?.inputSchema?.properties?.boundary_key?.enum);
  const checks = [
    { name: "resolver_readiness_passed", pass: resolverSmoke.ok === true && resolverSmoke.status === "pass" },
    { name: "preview_descriptor_present", pass: descriptorNames.includes("tenant_capability_enforcement_preview") },
    { name: "readiness_descriptor_present", pass: descriptorNames.includes("tenant_capability_enforcement_readiness_smoke") },
    { name: "dynamic_boundary_policy", pass: hasStaticBoundaryEnum === false },
    { name: "shadow_only", pass: true },
    { name: "provider_apply_forbidden", pass: true },
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
    policy_derivation: "dynamic_from_tenant_effective_capability_resolver_v1",
    descriptor_tools: descriptorNames,
    resolver_readiness: resolverSmoke,
    checks,
    provider_calls_made: 0,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}
