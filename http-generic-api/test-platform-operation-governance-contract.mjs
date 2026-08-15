import assert from "node:assert/strict";
import {
  canonicalBrandCreateOperation,
  conservativeFallbackOperationInference,
  resolveOperationGovernance,
  validateOperationDescriptor,
} from "./platformOperationGovernanceContract.js";

const brandCreate = canonicalBrandCreateOperation();
const valid = validateOperationDescriptor(brandCreate);
assert.equal(valid.valid, true);
assert.equal(valid.normalized.operation_key, "brand.create");
assert.equal(valid.normalized.effect_class, "internal_write");
assert.equal(valid.normalized.readback_contract, "same_cycle_required");
assert.equal(valid.normalized.tool_discovery_required, false);

const resolved = resolveOperationGovernance({
  descriptor: brandCreate,
  caller: { risk_class: "low", approval_contract: "none" },
});
assert.equal(resolved.status, "ready");
assert.equal(resolved.risk_class, "medium");
assert.equal(resolved.approval_contract, "policy_resolved");
assert.equal(resolved.approval_required, true);
assert.equal(resolved.caller_attempted_lowering, true);
assert.equal(resolved.tool_discovery_required, false);

const elevated = resolveOperationGovernance({
  descriptor: brandCreate,
  policy: { minimum_risk: "high", approval_contract: "explicit" },
});
assert.equal(elevated.risk_class, "high");
assert.equal(elevated.approval_contract, "explicit");
assert.equal(elevated.approval_required, true);

const invalidDiscovery = validateOperationDescriptor({
  ...brandCreate,
  tool_discovery_required: true,
});
assert.equal(invalidDiscovery.valid, false);
assert.ok(invalidDiscovery.errors.includes("known_brand_create_must_not_discover_tools"));

const invalidExternal = validateOperationDescriptor({
  operation_key: "provider.publish",
  resource_type: "asset",
  effect_class: "external_write",
  risk_class: "medium",
  approval_contract: "policy_resolved",
  readback_contract: "same_cycle_required",
  authority_required: true,
  idempotency_required: true,
});
assert.equal(invalidExternal.valid, false);
assert.ok(invalidExternal.errors.includes("risk_below_effect_floor"));
assert.ok(invalidExternal.errors.includes("approval_below_effect_floor"));
assert.ok(invalidExternal.errors.includes("readback_below_effect_floor"));

const fallback = conservativeFallbackOperationInference("brand.create");
assert.equal(fallback.source, "compatibility_text_fallback");
assert.equal(fallback.risk_class, "high");
assert.equal(fallback.approval_required, true);
assert.equal(fallback.dispatch_allowed, false);

const unknownRead = conservativeFallbackOperationInference("brand.preview");
assert.equal(unknownRead.risk_class, "low");
assert.equal(unknownRead.dispatch_allowed, true);

console.log("platform operation governance contract tests passed");
