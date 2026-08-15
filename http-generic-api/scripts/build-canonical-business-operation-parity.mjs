import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_BUSINESS_OPERATION_REGISTRY,
  CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT,
  CANONICAL_BUSINESS_OPERATION_SURFACES,
  validateCanonicalBusinessOperationRegistry,
} from "../canonicalBusinessOperationRegistry.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "canonical-business-operation-parity.generated.json");
const REVISION_BOUND_ACTIONS = new Set(["update", "archive", "restore", "deactivate", "activate", "supersede", "revoke", "validate"]);

function projectionSummary(operation) {
  return Object.fromEntries(CANONICAL_BUSINESS_OPERATION_SURFACES.map((surface) => [surface, operation.projection_policy?.[surface] || "not_projected"]));
}

function buildParity(registry) {
  const validation = validateCanonicalBusinessOperationRegistry(registry);
  if (!validation.ok) throw new Error(`Cannot generate canonical operation parity: ${validation.errors.map((error) => error.code).join(",")}`);
  const operations = [...registry.operations]
    .sort((left, right) => left.operation_key.localeCompare(right.operation_key))
    .map((operation) => ({
      operation_key: operation.operation_key,
      domain: operation.domain,
      lifecycle_action: operation.lifecycle_action,
      resource_type: operation.resource_type,
      environment: operation.environment,
      status: operation.status,
      effect_class: operation.effect_class,
      risk_class: operation.risk_class,
      approval_required: operation.approval_required,
      approval_contract: operation.approval_contract || null,
      readback_required: operation.readback_required,
      readback_contract: operation.readback_contract || null,
      optimistic_concurrency_required: operation.optimistic_concurrency_required,
      idempotency_required: operation.idempotency_required,
      identity_resolution_contract: operation.identity_resolution_contract || null,
      relationship_resolution_contract: operation.relationship_resolution_contract || null,
      capability_profile: operation.capability_profile || null,
      tool_discovery_required: operation.tool_discovery_required === true,
      executor_ref: operation.executor_ref,
      scope_keys: operation.scope_keys || [],
      projections: projectionSummary(operation),
      intentional_exclusions: Object.entries(projectionSummary(operation))
        .filter(([, status]) => ["blocked", "not_projected"].includes(status))
        .map(([surface, status]) => ({ surface, status, reason: operation.projection_notes?.[surface] || operation.projection_notes?.all || "No projection binding is active." })),
    }));
  const active = operations.filter((operation) => operation.status === "active");
  const writes = operations.filter((operation) => operation.effect_class !== "read_only");
  const performanceGates = {
    known_intent_list_tools_calls: operations.filter((operation) => operation.intent_resolution?.strategy === "list_tools").length,
    mutation_without_expected_revision: writes.filter((operation) => REVISION_BOUND_ACTIONS.has(operation.lifecycle_action) && operation.optimistic_concurrency_required !== true).length,
    mutation_without_required_readback: writes.filter((operation) => operation.readback_required !== true).length,
    hard_delete_without_dependency_plan: operations.filter((operation) => ["purge", "hard_delete"].includes(operation.lifecycle_action) && operation.dependency_plan_required !== true).length,
  };
  return {
    schema_version: "canonical-business-operation-parity-v1",
    revision: registry.revision,
    registry_fingerprint: CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT,
    environment_policy: registry.environment_policy,
    surfaces: [...CANONICAL_BUSINESS_OPERATION_SURFACES],
    counts: {
      operation_count: operations.length,
      active_operation_count: active.length,
      shadow_operation_count: operations.filter((operation) => operation.status === "shadow").length,
      blocked_operation_count: operations.filter((operation) => operation.status === "blocked").length,
      read_only_operation_count: operations.filter((operation) => operation.effect_class === "read_only").length,
      write_or_shadow_operation_count: writes.length,
      active_remote_mcp_operation_count: operations.filter((operation) => operation.projections.remote_mcp === "active").length,
      active_custom_gpt_operation_count: operations.filter((operation) => ["active", "compatibility"].includes(operation.projections.custom_gpt)).length,
    },
    operations,
    performance_gates: performanceGates,
    safety: {
      shadow_writes_activated: false,
      blocked_hosts_projected: false,
      production_mutation_allowed: false,
      provider_mutation_allowed: false,
      purge_allowed: false,
      secrets_included: false,
    },
    provenance: {
      generated_by: "build-canonical-business-operation-parity.mjs",
      source: "canonicalBusinessOperationRegistry.js (canonical JSON plus governed Spec extensions)",
      secrets_included: false,
    },
  };
}

const output = `${JSON.stringify(buildParity(CANONICAL_BUSINESS_OPERATION_REGISTRY), null, 2)}\n`;
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output, "utf8");
console.log(JSON.stringify({ ok: true, output: "canonical-business-operation-parity.generated.json", registry_fingerprint: CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT, operation_count: CANONICAL_BUSINESS_OPERATION_REGISTRY.operations.length, secrets_included: false }));
