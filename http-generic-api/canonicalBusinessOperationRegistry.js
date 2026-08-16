import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SOURCE_REGISTRY = JSON.parse(readFileSync(new URL("./canonical-business-operation-registry.json", import.meta.url), "utf8"));
const SURFACES = Object.freeze(["custom_gpt", "system_layer", "remote_mcp", "rest", "frontend", "internal_agent"]);
const VALID_STATUSES = new Set(["active", "shadow", "blocked"]);
const VALID_PROJECTION_STATUSES = new Set(["active", "compatibility", "shadow", "blocked", "not_projected"]);
const VALID_APPROVAL_CONTRACTS = new Set(["none", "policy_resolved", "explicit", "typed_confirmation"]);
const VALID_READBACK_CONTRACTS = new Set(["none", "same_cycle_required", "provider_verified"]);
const WRITE_EFFECTS = new Set(["internal_write", "external_write", "destructive", "destructive_write", "commercial_effect"]);
const BLOCKED_HOSTS = new Set(SOURCE_REGISTRY.environment_policy.blocked_public_hosts || []);

const SPEC020_SHADOW_PROJECTION = Object.freeze({
  custom_gpt: "shadow",
  system_layer: "shadow",
  remote_mcp: "not_projected",
  rest: "shadow",
  frontend: "shadow",
  internal_agent: "shadow",
});

const SPEC020_OPERATIONS = Object.freeze([
  {
    operation_key: "brand.identity.resolve",
    domain: "brand",
    lifecycle_action: "read",
    resource_type: "brand_identity",
    principal_scopes: ["tenant_user", "tenant_owner", "tenant_admin"],
    effect_class: "read_only",
    risk_class: "low",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_relationship_v1",
    capability_profile: "brand_identity_read",
    tool_discovery_required: false,
    executor_ref: "brandIdentityResolver.resolvePersistentBrandIdentity",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Shadow-only canonical Brand identity resolution; no relationship, grant, or authority is implied by identity." },
  },
  {
    operation_key: "brand.identity.reconcile",
    domain: "brand",
    lifecycle_action: "read",
    resource_type: "brand_identity_reconciliation",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "read_only",
    risk_class: "medium",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_relationship_v1",
    capability_profile: "brand_identity_diagnostics",
    tool_discovery_required: false,
    executor_ref: "brandIdentityReconciliation.readBrandIdentityReconciliationDiagnostics",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "SELECT-only reconciliation diagnostics. Destructive auto-merge or repair is forbidden." },
  },
  {
    operation_key: "brand.claim.list",
    domain: "brand",
    lifecycle_action: "read",
    resource_type: "brand_claim",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "read_only",
    risk_class: "medium",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_read",
    tool_discovery_required: false,
    executor_ref: "brandClaimService.listBrandClaims",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Claim state is separate from effective resource authority and remains library-only in Spec 020." },
  },
  {
    operation_key: "brand.claim.request",
    domain: "brand",
    lifecycle_action: "create",
    resource_type: "brand_claim",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "internal_write",
    risk_class: "high",
    environment: "staging",
    status: "shadow",
    approval_required: true,
    approval_contract: "policy_resolved",
    readback_required: true,
    readback_contract: "same_cycle_required",
    optimistic_concurrency_required: false,
    idempotency_required: true,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_request",
    tool_discovery_required: false,
    executor_ref: "brandClaimService.requestBrandClaim",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Creates a pending claim/relationship only; it never creates an authority grant." },
  },
  {
    operation_key: "brand.claim.challenge.prepare",
    domain: "brand",
    lifecycle_action: "validate",
    resource_type: "brand_claim",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "read_only",
    risk_class: "medium",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_challenge",
    tool_discovery_required: false,
    executor_ref: "brandClaimService.prepareClaimChallenge",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Prepares bounded verification challenge metadata without granting or verifying authority." },
  },
  {
    operation_key: "brand.claim.evidence.submit",
    domain: "brand",
    lifecycle_action: "create",
    resource_type: "brand_verification_evidence",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "internal_write",
    risk_class: "high",
    environment: "staging",
    status: "shadow",
    approval_required: true,
    approval_contract: "policy_resolved",
    readback_required: true,
    readback_contract: "same_cycle_required",
    optimistic_concurrency_required: false,
    idempotency_required: true,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_evidence",
    tool_discovery_required: false,
    executor_ref: "brandClaimService.submitClaimEvidence",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Evidence submission remains pending and cannot self-verify a claim." },
  },
  {
    operation_key: "brand.claim.verify",
    domain: "brand",
    lifecycle_action: "validate",
    resource_type: "brand_claim",
    principal_scopes: ["tenant_admin"],
    effect_class: "internal_write",
    risk_class: "high",
    environment: "staging",
    status: "shadow",
    approval_required: true,
    approval_contract: "explicit",
    readback_required: true,
    readback_contract: "same_cycle_required",
    optimistic_concurrency_required: true,
    idempotency_required: true,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_verification",
    tool_discovery_required: false,
    executor_ref: "brandClaimVerification.verifyBrandClaim",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Verification activates only the Tenant-to-Brand relationship; authority grants remain a separate subsystem." },
  },
  {
    operation_key: "brand.claim.revoke",
    domain: "brand",
    lifecycle_action: "revoke",
    resource_type: "brand_claim",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "internal_write",
    risk_class: "high",
    environment: "staging",
    status: "shadow",
    approval_required: true,
    approval_contract: "explicit",
    readback_required: true,
    readback_contract: "same_cycle_required",
    optimistic_concurrency_required: true,
    idempotency_required: true,
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_claim_revocation",
    tool_discovery_required: false,
    executor_ref: "brandClaimService.revokeWorkspaceBrandClaim",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Revokes the relationship claim but does not silently revoke or mutate separate authority grants." },
  },
  {
    operation_key: "asset.identity.resolve",
    domain: "asset",
    lifecycle_action: "read",
    resource_type: "asset_identity",
    principal_scopes: ["tenant_user", "tenant_owner", "tenant_admin", "resource_owner"],
    effect_class: "read_only",
    risk_class: "low",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "asset_identity_v1",
    relationship_resolution_contract: "asset_rights_separate_v1",
    capability_profile: "asset_identity_read",
    tool_discovery_required: false,
    executor_ref: "platformResourceIdentityAdapters.adaptAssetIdentity",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Content identity is distinct from Tenant rights, visibility, and authority." },
  },
  {
    operation_key: "provider_account.identity.resolve",
    domain: "provider",
    lifecycle_action: "read",
    resource_type: "provider_account_identity",
    principal_scopes: ["tenant_owner", "tenant_admin"],
    effect_class: "read_only",
    risk_class: "medium",
    environment: "staging",
    status: "shadow",
    approval_required: false,
    approval_contract: "none",
    readback_required: false,
    readback_contract: "none",
    optimistic_concurrency_required: false,
    idempotency_required: false,
    identity_resolution_contract: "provider_account_identity_v1",
    relationship_resolution_contract: "credential_binding_separate_v1",
    capability_profile: "provider_account_identity_read",
    tool_discovery_required: false,
    executor_ref: "platformResourceIdentityAdapters.adaptProviderAccountIdentity",
    projection_policy: SPEC020_SHADOW_PROJECTION,
    projection_notes: { all: "Provider-native account identity excludes credential material and does not imply execution authority." },
  },
]);

function withSpec020Overlay(operation) {
  if (operation?.operation_key !== "brand.create") return operation;
  return {
    ...operation,
    approval_contract: "policy_resolved",
    readback_contract: "same_cycle_required",
    identity_resolution_contract: "brand_identity_v2",
    relationship_resolution_contract: "tenant_brand_claim_v1",
    capability_profile: "brand_identity_mutation",
    tool_discovery_required: false,
    projection_notes: {
      ...(operation.projection_notes || {}),
      all: "Schema-adaptive Brand create resolves/reuses global identity when available, creates Tenant relationship separately, and never treats identity as authority.",
    },
  };
}

function buildRegistry(source) {
  const sourceOperations = (Array.isArray(source?.operations) ? source.operations : []).map(withSpec020Overlay);
  const existing = new Set(sourceOperations.map((operation) => operation.operation_key));
  return {
    ...source,
    revision: "staging-safe-2026-08-15-spec020-r2",
    operations: [...sourceOperations, ...SPEC020_OPERATIONS.filter((operation) => !existing.has(operation.operation_key))],
    provenance: {
      ...(source.provenance || {}),
      spec020_extension: "canonicalBusinessOperationRegistry.js",
      spec020_contract: "Platform Resource Identity, Relationships & Brand Governance",
      secrets_included: false,
    },
  };
}

const REGISTRY = buildRegistry(SOURCE_REGISTRY);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function addError(errors, code, details = {}) {
  errors.push({ code, ...details });
}

export function validateCanonicalBusinessOperationRegistry(registry = REGISTRY) {
  const errors = [];
  const operations = Array.isArray(registry?.operations) ? registry.operations : [];
  const keys = new Set();
  for (const operation of operations) {
    const operationKey = String(operation?.operation_key || "").trim();
    if (!operationKey) addError(errors, "operation_key_missing");
    if (operationKey && !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/u.test(operationKey)) addError(errors, "operation_key_must_use_dot_notation", { operation_key: operationKey });
    if (keys.has(operationKey)) addError(errors, "duplicate_operation_key", { operation_key: operationKey });
    keys.add(operationKey);
    if (!operation?.domain || !operation?.lifecycle_action || !operation?.resource_type) {
      addError(errors, "operation_identity_incomplete", { operation_key: operationKey || null });
    }
    if (!VALID_STATUSES.has(operation?.status)) addError(errors, "invalid_operation_status", { operation_key: operationKey || null, status: operation?.status || null });
    if (!Array.isArray(operation?.principal_scopes) || operation.principal_scopes.length === 0) {
      addError(errors, "principal_scopes_missing", { operation_key: operationKey || null });
    }
    if (operation.approval_contract != null && !VALID_APPROVAL_CONTRACTS.has(operation.approval_contract)) {
      addError(errors, "approval_contract_invalid", { operation_key: operationKey || null, approval_contract: operation.approval_contract });
    }
    if (operation.readback_contract != null && !VALID_READBACK_CONTRACTS.has(operation.readback_contract)) {
      addError(errors, "readback_contract_invalid", { operation_key: operationKey || null, readback_contract: operation.readback_contract });
    }
    if (WRITE_EFFECTS.has(operation?.effect_class)) {
      if (operation.status === "active") addError(errors, "write_operation_must_not_be_active", { operation_key: operationKey });
      if (operation.operation_key !== "approvals.request" && operation.approval_required !== true) addError(errors, "write_operation_approval_required", { operation_key: operationKey });
      if (operation.readback_required !== true) addError(errors, "write_operation_readback_required", { operation_key: operationKey });
      if (operation.idempotency_required !== true) addError(errors, "write_operation_idempotency_required", { operation_key: operationKey });
      if (["update", "archive", "restore", "deactivate", "activate", "supersede", "revoke"].includes(operation.lifecycle_action)
        && operation.optimistic_concurrency_required !== true) {
        addError(errors, "mutable_operation_revision_required", { operation_key: operationKey });
      }
    }
    const projection = operation?.projection_policy || {};
    for (const surface of SURFACES) {
      if (!VALID_PROJECTION_STATUSES.has(projection[surface])) {
        addError(errors, "projection_status_missing_or_invalid", { operation_key: operationKey || null, surface, status: projection[surface] || null });
      }
    }
    const serialized = JSON.stringify(operation);
    for (const blockedHost of BLOCKED_HOSTS) {
      if (serialized.includes(blockedHost)) addError(errors, "blocked_host_in_operation_descriptor", { operation_key: operationKey || null, host: blockedHost });
    }
    if (operation.lifecycle_action === "purge" && operation.status !== "blocked") {
      addError(errors, "purge_must_remain_blocked", { operation_key: operationKey || null });
    }
    if (operationKey === "brand.create") {
      const nextOperations = operation.response_contract?.next_operations;
      if (
        nextOperations?.type !== "array"
        || nextOperations?.items?.type !== "object"
        || nextOperations?.items?.read_only !== true
        || nextOperations?.items?.operation_key_format !== "dot_notation"
        || !Array.isArray(nextOperations?.items?.required)
        || !["operation_key", "status", "reason"].every((field) => nextOperations.items.required.includes(field))
      ) {
        addError(errors, "brand_create_next_operations_contract_missing", { operation_key: operationKey });
      }
    }
  }
  if (registry?.environment_policy?.production_mutation_allowed !== false) addError(errors, "production_mutation_policy_must_be_false");
  if (registry?.environment_policy?.provider_mutation_allowed !== false) addError(errors, "provider_mutation_policy_must_be_false");
  if (registry?.environment_policy?.secrets_included !== false) addError(errors, "registry_secrets_boundary_failed");
  return {
    ok: errors.length === 0,
    errors,
    operation_count: operations.length,
    active_operation_count: operations.filter((operation) => operation.status === "active").length,
    shadow_operation_count: operations.filter((operation) => operation.status === "shadow").length,
    blocked_operation_count: operations.filter((operation) => operation.status === "blocked").length,
    secrets_included: false,
  };
}

const validation = validateCanonicalBusinessOperationRegistry(REGISTRY);
if (!validation.ok) throw new Error(`Invalid canonical business operation registry: ${validation.errors.map((error) => error.code).join(",")}`);

export const CANONICAL_BUSINESS_OPERATION_REGISTRY = Object.freeze(clone(REGISTRY));
export const CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT = digest(REGISTRY);
export const CANONICAL_BUSINESS_OPERATION_SURFACES = SURFACES;

export function getCanonicalBusinessOperationRegistry() {
  return clone(CANONICAL_BUSINESS_OPERATION_REGISTRY);
}

export function listCanonicalBusinessOperations({ status = null, domain = null } = {}) {
  return CANONICAL_BUSINESS_OPERATION_REGISTRY.operations
    .filter((operation) => !status || operation.status === status)
    .filter((operation) => !domain || operation.domain === domain)
    .map(clone);
}

export function resolveCanonicalBusinessOperation(operationKey) {
  const normalized = String(operationKey || "").trim();
  const operation = CANONICAL_BUSINESS_OPERATION_REGISTRY.operations.find((candidate) => candidate.operation_key === normalized);
  return operation ? clone(operation) : null;
}

export function getCanonicalBusinessOperationReadback() {
  return {
    ...validateCanonicalBusinessOperationRegistry(CANONICAL_BUSINESS_OPERATION_REGISTRY),
    revision: CANONICAL_BUSINESS_OPERATION_REGISTRY.revision,
    fingerprint: CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT,
    active_projection_count: CANONICAL_BUSINESS_OPERATION_REGISTRY.operations.reduce((count, operation) => (
      count + Object.values(operation.projection_policy || {}).filter((value) => value === "active").length
    ), 0),
    shadow_projection_count: CANONICAL_BUSINESS_OPERATION_REGISTRY.operations.reduce((count, operation) => (
      count + Object.values(operation.projection_policy || {}).filter((value) => value === "shadow").length
    ), 0),
    secrets_included: false,
  };
}

export const _testingCanonicalBusinessOperationRegistry = {
  canonicalize,
  digest,
  REGISTRY,
  SOURCE_REGISTRY,
  SPEC020_OPERATIONS,
  SURFACES,
  buildRegistry,
};
