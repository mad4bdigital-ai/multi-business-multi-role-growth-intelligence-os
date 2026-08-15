import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REGISTRY = JSON.parse(readFileSync(new URL("./canonical-business-operation-registry.json", import.meta.url), "utf8"));
const SURFACES = Object.freeze(["custom_gpt", "system_layer", "remote_mcp", "rest", "frontend", "internal_agent"]);
const VALID_STATUSES = new Set(["active", "shadow", "blocked"]);
const VALID_PROJECTION_STATUSES = new Set(["active", "compatibility", "shadow", "blocked", "not_projected"]);
const WRITE_EFFECTS = new Set(["internal_write", "external_write", "destructive"]);
const BLOCKED_HOSTS = new Set(REGISTRY.environment_policy.blocked_public_hosts || []);

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
    if (keys.has(operationKey)) addError(errors, "duplicate_operation_key", { operation_key: operationKey });
    keys.add(operationKey);
    if (!operation?.domain || !operation?.lifecycle_action || !operation?.resource_type) {
      addError(errors, "operation_identity_incomplete", { operation_key: operationKey || null });
    }
    if (!VALID_STATUSES.has(operation?.status)) addError(errors, "invalid_operation_status", { operation_key: operationKey || null, status: operation?.status || null });
    if (!Array.isArray(operation?.principal_scopes) || operation.principal_scopes.length === 0) {
      addError(errors, "principal_scopes_missing", { operation_key: operationKey || null });
    }
    if (WRITE_EFFECTS.has(operation?.effect_class)) {
      if (operation.status === "active") addError(errors, "write_operation_must_not_be_active", { operation_key: operationKey });
      if (operation.operation_key !== "approvals:request" && operation.approval_required !== true) addError(errors, "write_operation_approval_required", { operation_key: operationKey });
      if (operation.readback_required !== true) addError(errors, "write_operation_readback_required", { operation_key: operationKey });
      if (operation.idempotency_required !== true) addError(errors, "write_operation_idempotency_required", { operation_key: operationKey });
      if (["update", "archive", "restore", "deactivate", "activate", "supersede"].includes(operation.lifecycle_action)
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
  SURFACES,
};
