import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_BUSINESS_OPERATION_REGISTRY,
  CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT,
  CANONICAL_BUSINESS_OPERATION_SURFACES,
  getCanonicalBusinessOperationReadback,
  listCanonicalBusinessOperations,
  resolveCanonicalBusinessOperation,
  validateCanonicalBusinessOperationRegistry,
} from "./canonicalBusinessOperationRegistry.js";

const parity = JSON.parse(readFileSync(new URL("./canonical-business-operation-parity.generated.json", import.meta.url), "utf8"));
const validation = validateCanonicalBusinessOperationRegistry();
const readback = getCanonicalBusinessOperationReadback();

assert.equal(validation.ok, true, `canonical registry invalid: ${JSON.stringify(validation.errors)}`);
assert.equal(validation.secrets_included, false);
assert.equal(readback.secrets_included, false);
assert.equal(parity.registry_fingerprint, CANONICAL_BUSINESS_OPERATION_REGISTRY_FINGERPRINT);
assert.deepEqual(parity.surfaces, CANONICAL_BUSINESS_OPERATION_SURFACES);
assert.equal(parity.safety.shadow_writes_activated, false);
assert.equal(parity.safety.production_mutation_allowed, false);
assert.equal(parity.safety.provider_mutation_allowed, false);
assert.equal(parity.safety.purge_allowed, false);
assert.equal(parity.safety.secrets_included, false);
assert.equal(parity.counts.operation_count, CANONICAL_BUSINESS_OPERATION_REGISTRY.operations.length);
assert.equal(parity.counts.active_remote_mcp_operation_count, 2);
assert.equal(resolveCanonicalBusinessOperation("assets:update")?.optimistic_concurrency_required, true);
assert.equal(resolveCanonicalBusinessOperation("brand:update")?.status, "blocked");
assert.equal(resolveCanonicalBusinessOperation("hostinger:deploy")?.projection_policy.remote_mcp, "blocked");
assert.equal(resolveCanonicalBusinessOperation("assets:archive")?.projection_policy.remote_mcp, "blocked");
assert.equal(resolveCanonicalBusinessOperation("workspaces:list")?.projection_policy.remote_mcp, "active");
assert.equal(listCanonicalBusinessOperations({ status: "shadow" }).every((operation) => operation.approval_required || operation.operation_key === "approvals:request"), true);
assert.equal(listCanonicalBusinessOperations().every((operation) => {
  const serialized = JSON.stringify(operation);
  return !serialized.includes("auth.mad4b.com")
    && !serialized.includes("mcp.mad4b.com")
    && !serialized.includes("activation.mad4b.com")
    && !serialized.includes("activation_dev.mad4b.com");
}), true);
assert.equal(listCanonicalBusinessOperations().filter((operation) => operation.effect_class !== "read_only").every((operation) => operation.readback_required === true && operation.idempotency_required === true), true);
assert.equal(parity.operations.every((operation) => operation.intentional_exclusions.every((exclusion) => ["blocked", "not_projected"].includes(exclusion.status))), true);
console.log(JSON.stringify({
  ok: true,
  contract: "canonical-business-operation-registry-v1",
  operation_count: parity.counts.operation_count,
  active_operation_count: parity.counts.active_operation_count,
  shadow_operation_count: parity.counts.shadow_operation_count,
  blocked_operation_count: parity.counts.blocked_operation_count,
  active_remote_mcp_operation_count: parity.counts.active_remote_mcp_operation_count,
  production_mutation_allowed: parity.safety.production_mutation_allowed,
  secrets_included: false,
}));
